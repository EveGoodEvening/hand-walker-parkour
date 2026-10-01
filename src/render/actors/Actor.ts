// src/render/actors/Actor.ts —— 主角（ViewSystem order 30，DESIGN.md §5.5、§5.6、§8.7）。WP5。
// 跑段：CrawlAnimator（handCycle）按插值后的快照驱动；站立段：Stand 姿势；静场：放在 StillSet.playerAnchor，
// 按 set 的缺省姿势，`actor` cue 覆盖 N 秒（§8.5「主角在静场 / 停拍中的脚本姿势」）。
// 每个模拟 tick 写一帧 PoseHistory（§5.8）：两次渲染之间隔了多个 tick 时（无头测试 step(n) 之后才渲染），
// 按首尾快照线性插出中间各 tick 的姿势补进历史，保证替身的 0.35 s 延迟在任何推进方式下都有数据。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { STILL_ORIGIN } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp, lerp, smoothstep } from '../../core/math';
import { getSet } from '../../core/registry';
import { copyPose, createPose, type Pose } from '../../core/rig';
import type { PoseClipId, SimSnapshot } from '../../core/types';
import type { CompiledChapter, CompiledSegment } from '../../levels/schema';
import { clipPose, SET_DEFAULT_CLIP } from './clips';
import { CrawlAnimator, crawlPose, jumpDur, PoseBuilder, type CrawlInput } from './handCycle';
import { applyPosture, blendPoses, standing, standPose } from './poses';
import { applyThirdHand } from './ThirdHand';
import { patchGroupAlpha, stepUpperFade, upperAlpha, upperFadeWanted } from './readability';
import type { ActorRigFactory, Rig } from './rigBuild';
import { WP5, type PoseTestName } from './shared';

const _m = new THREE.Matrix4();

/**
 * 镜头在他眼睛里、但要看见自己手的静场（修复轮 U5）：只画某些分组（readability.ts 的 BONE_GROUP：腿、手、手臂、躯干与头）。
 * 4-6 看水：画面下沿伸进来按在水里的双手，身体其余部分不画（否则挡满画面）。
 */
export const EYE_GROUPS: Readonly<Record<string, readonly [number, number, number, number]>> = { water: [0, 1, 1, 0] };

function crawlInputFrom(prev: SimSnapshot, next: SimSnapshot, a: number, out: CrawlInput): CrawlInput {
  const P = prev.player, N = next.player;
  out.s = lerp(P.s, N.s, a); out.x = lerp(P.x, N.x, a); out.y = lerp(P.y, N.y, a); out.floorY = lerp(P.floorY, N.floorY, a);
  out.beat = lerp(P.beat, N.beat, a); out.stride = N.stride; out.cadence = N.cadence || 4.8; out.speed = N.speed;
  out.duck = lerp(P.duck, N.duck, a); out.air = N.mode === 'air'; out.airT = N.airT;
  out.mode = N.mode; out.modeT = N.modeT; out.laneTarget = N.laneTarget;
  out.twitch = lerp(P.twitch, N.twitch, a); out.drift = lerp(P.drift, N.drift, a); out.lookBack = lerp(P.lookBack, N.lookBack, a);
  return out;
}

export class PlayerActor implements ViewSystem {
  readonly id = 'actors';
  readonly owner = 'WP5' as const;
  readonly order = 30;
  private ctx!: ViewContext;
  private factory!: ActorRigFactory;
  rig!: Rig;
  private readonly b = new PoseBuilder();
  private readonly b2 = new PoseBuilder();
  private readonly anim = new CrawlAnimator();
  private readonly inp: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 4.8, speed: 0, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };
  private readonly inp2: CrawlInput = { ...this.inp };
  private readonly last: CrawlInput = { ...this.inp };
  private lastTick = -1;
  private lastT = 0;
  private lastSeg = -1;
  private readonly clipOut = createPose();
  private readonly mix = createPose();
  /** actor cue：脚本姿势覆盖。 */
  private clip: { id: PoseClipId; t0: number; until: number } | null = null;
  private clipWeight = 0;
  private lastFrameT = 0;
  /** 站立段摔倒的时刻（模拟时钟；−1 = 没有摔倒）。 */
  private fallT0 = -1;
  private chapter: CompiledChapter | null = null;
  /** 上半身淡出（readability.ts）：权重与着色器 uniform（四个分组的不透明度：腿、手、手臂、躯干与头）。 */
  private fadeW = 0;
  private readonly groupU = { value: new THREE.Vector4(1, 1, 1, 1) };
  /** 本帧上半身（手臂、躯干与头）的不透明度（测试 / wp5State 用）。 */
  get upperAlpha(): number { return this.groupU.value.w; }
  /** 本帧四个分组的不透明度（测试用）。 */
  get groupAlpha(): THREE.Vector4 { return this.groupU.value; }

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    this.factory = ctx.rig as unknown as ActorRigFactory;
    const mat = patchGroupAlpha(ctx.mat.lambert({ vertexColors: true, flat: true }), this.groupU);
    mat.name = 'rigPlayer';
    this.rig = this.factory.make('player', mat);
    this.rig.root.name = 'player';
    ctx.scene.add(this.rig.root);
  }

  /** actor cue（§8.7，WP5）。seconds 缺省 = 一直保持到下一段。 */
  playClip(clip: PoseClipId, seconds: number | undefined, t: number): void {
    this.clip = { id: clip, t0: t, until: seconds && seconds > 0 ? t + seconds : Infinity };
  }

  /** 换段：衣物颜色按段的氛围补偿（户外，rigBuild.clothAlbedo）。 */
  onSegment(seg: CompiledSegment): void { this.factory?.setAtmosphere(seg.def.atmosphere); }

  onEvent(e: GameEvent): void {
    if (e.type === 'cue' && e.data.body.type === 'atmosphere') this.factory?.setAtmosphere(e.data.body.id);
    if (e.type === 'land') this.anim.onLand();
    if (e.type === 'segment' || e.type === 'retry') { this.clip = null; this.clipWeight = 0; this.fallT0 = -1; }
  }

  onReset(): void { this.anim.reset(); this.lastTick = -1; this.clip = null; this.clipWeight = 0; this.fadeW = 0; this.groupU.value.set(1, 1, 1, 1); }

  async loadChapter(ch: CompiledChapter): Promise<void> { this.chapter = ch; this.fadeW = 0; this.groupU.value.set(1, 1, 1, 1); }

  setQuality(): void { this.factory.setQuality(this.ctx.quality); }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const same = prev.segIndex === next.segIndex && prev.segKind === next.segKind;
    const a = same ? alpha : 1;
    const t = lerp(prev.t, next.t, a);
    const rig = this.rig;
    const hist = this.factory.history;
    // 脚本姿势的权重（0.3 s 淡入淡出）
    const clipOn = !!this.clip && t < this.clip.until;
    let sdt = t - this.lastFrameT;
    if (!(sdt >= 0) || sdt > 60) sdt = 0;
    this.lastFrameT = t;
    this.clipWeight = clamp(this.clipWeight + (clipOn ? 1 : -1) * sdt / 0.3, 0, 1);
    if (!clipOn && this.clipWeight <= 0) this.clip = null;
    rig.root.matrixAutoUpdate = true;
    rig.root.position.set(0, 0, 0); rig.root.quaternion.identity(); rig.root.scale.set(1, 1, 1);

    if (next.segKind !== 'run' || WP5.poseTest) { this.fadeW = 0; this.groupU.value.set(1, 1, 1, 1); }
    if (next.segKind === 'run') {
      crawlInputFrom(prev, next, a, this.inp);
      this.backfill(next);
      if (!WP5.poseTest) {
        // 本车道前方有必需障碍：上半身淡到 40%（回头时不淡，镜头在他前面）
        const seg = this.chapter?.segments[next.segIndex];
        const N = next.player;
        const want = !!seg && seg.kind === 'run' && N.lookBack < 0.3 && N.mode !== 'fall'
          && upperFadeWanted(seg.obstacles, this.inp.s, N.lane, N.laneTarget, N.speed);
        this.fadeW = stepUpperFade(this.fadeW, want, sdt);
        const ua = upperAlpha(this.fadeW);
        // 停拍里镜头绕到水洼另一侧回看（3-4）：主角整个藏起来（影子还在），水里的倒影不被他挡住
        const hide = WP5.hidePlayer;
        this.groupU.value.set(1 - hide, 1 - hide, ua * (1 - hide), ua * (1 - hide));
      }
      let pose = WP5.poseTest ? this.testPose(WP5.poseTest, t) : this.anim.update(this.inp, dt, this.b);
      if (this.clip && this.clipWeight > 0) {
        clipPose(this.clip.id, t - this.clip.t0, this.b2, this.clipOut, { x: this.inp.x, y: this.inp.floorY, s: this.inp.s, yaw: pose.root[3] ?? 0 });
        pose = blendPoses(pose, this.clipOut, smoothstep(0, 1, this.clipWeight), this.mix);
      }
      rig.apply(pose);
      rig.setProps({ head: next.player.carrying === 'tray' ? 'tray' : 'none', back: next.player.carrying === 'bag' ? 'bag' : 'none' });
      rig.root.visible = true;
      copyPose(WP5.playerPose, pose);
      WP5.playerVisible = true;
      WP5.playerRoot.set(this.inp.x, this.inp.floorY, -this.inp.s);
      hist.push(t, pose);
      this.remember(next);
      return;
    }
    if (next.segKind === 'stand') {
      const fallen = next.player.stand?.phase === 'fallen';
      if (fallen && this.fallT0 < 0) this.fallT0 = t;
      if (!fallen) this.fallT0 = -1;
      const pose = standPose(next, prev, a, this.b, fallen ? t - this.fallT0 : undefined);
      rig.apply(pose);
      rig.root.visible = true;
      copyPose(WP5.playerPose, pose);
      WP5.playerVisible = true;
      WP5.playerRoot.set(pose.root[0] as number, next.player.floorY, -(pose.root[2] as number));
      hist.push(t, pose);
      this.lastTick = -1;
      return;
    }
    // 静场：放在锚点（相对 STILL_ORIGIN）
    const st = next.still;
    const setId = st?.set ?? 'placeholder';
    const variant = st?.variant ?? 'default';
    const set = getSet(setId);
    const anchor = set ? set.playerAnchor(variant) : _m.identity();
    const base = SET_DEFAULT_CLIP[`${setId}.${variant}`] ?? SET_DEFAULT_CLIP[setId] ?? null;
    const clipId = this.clip && this.clipWeight > 0 ? this.clip.id : base;
    if (!clipId) {
      // 镜头在他眼睛里（缺省姿势为 null）：不画主角，但锚点照样更新，镜头和静场替身都相对它摆（lead 集成）
      WP5.stillAnchor.makeTranslation(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z).multiply(anchor);
      rig.root.visible = false; WP5.playerVisible = false; this.lastTick = -1; return;
    }
    const eg = EYE_GROUPS[`${setId}.${variant}`] ?? EYE_GROUPS[setId];
    if (eg) this.groupU.value.set(eg[0], eg[1], eg[2], eg[3]); else this.groupU.value.set(1, 1, 1, 1);
    const tc = this.clip ? t - this.clip.t0 : (st?.t ?? 0);
    const pose = clipPose(clipId, tc, this.b, this.clipOut, { x: 0, y: 0, s: 0, yaw: 0 });
    if (this.clip && base && this.clipWeight < 1) {
      clipPose(base, st?.t ?? 0, this.b2, this.mix, { x: 0, y: 0, s: 0, yaw: 0 });
      blendPoses(this.mix, pose, smoothstep(0, 1, this.clipWeight), this.mix);
      rig.apply(this.mix);
    } else rig.apply(pose);
    rig.root.matrixAutoUpdate = false;
    rig.root.matrix.makeTranslation(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z).multiply(anchor);
    rig.root.matrixWorldNeedsUpdate = true;
    rig.root.visible = true;
    WP5.stillAnchor.copy(rig.root.matrix);
    copyPose(WP5.playerPose, pose);
    WP5.playerVisible = true;
    WP5.playerRoot.setFromMatrixPosition(rig.root.matrix);
    hist.push(t, pose);
    this.lastTick = -1;
  }

  /** poseTest（§8.8）：在玩家当前位置冻结一个展示姿势。 */
  private testPose(name: PoseTestName, t: number): Pose {
    const I = this.inp2;
    Object.assign(I, this.inp);
    I.beat = Math.floor(I.beat) + 0.22; I.mode = 'crawl'; I.air = false; I.duck = 0; I.twitch = 0; I.y = 0; I.land = 0; I.legHip = 0; I.legKnee = 0; I.lookBack = 0;
    switch (name) {
      case 'jump': I.air = true; I.mode = 'air'; I.airT = jumpDur(I.cadence) * 0.45; I.y = 0.55; break;
      case 'duck': I.duck = 1; I.mode = 'duck'; break;
      case 'twitch': I.twitch = 1; break;
      case 'stand': return applyPosture(standing({ knee: 12, lean: 10, arms: 'hover' }), { x: I.x, y: I.floorY, s: I.s, yaw: 0 }, this.b);
      default: break;
    }
    const p = crawlPose(I, this.b);
    if (name === 'thirdHand') {
      applyThirdHand(this.b, 'shush', 1, t, {});
      this.b.fkAll();
      return this.b.finish();
    }
    return p;
  }

  /** 两次渲染之间隔了多个 tick：按首尾快照插出中间各 tick 的姿势写进历史（纯函数 crawlPose，不动弹簧状态）。 */
  private backfill(next: SimSnapshot): void {
    const hist = this.factory.history;
    if (this.lastTick < 0 || next.segIndex !== this.lastSeg || next.tick <= this.lastTick + 1) return;
    const n = next.tick - this.lastTick;
    const from = Math.max(1, n - 150);
    const L = this.last, C = this.inp, I = this.inp2;
    for (let k = from; k < n; k++) {
      const f = k / n;
      Object.assign(I, C);
      I.s = lerp(L.s, C.s, f); I.x = lerp(L.x, C.x, f); I.y = lerp(L.y, C.y, f); I.floorY = lerp(L.floorY, C.floorY, f);
      I.beat = lerp(L.beat, C.beat, f); I.duck = lerp(L.duck, C.duck, f); I.twitch = lerp(L.twitch, C.twitch, f);
      I.air = f < 0.5 ? L.air : C.air; I.mode = f < 0.5 ? L.mode : C.mode;
      I.land = 0; I.legHip = 0; I.legKnee = 0;
      hist.push(lerp(this.lastT, next.t, f), crawlPose(I, this.b2));
    }
  }

  private remember(next: SimSnapshot): void {
    Object.assign(this.last, this.inp);
    this.lastTick = next.tick; this.lastT = next.t; this.lastSeg = next.segIndex;
  }
}

export const playerActor = new PlayerActor();
