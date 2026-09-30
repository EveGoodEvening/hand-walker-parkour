// src/render/actors/Doubles.ts —— 替身（DESIGN.md §3「倒影慢半拍」「影子与本体不一致」「第三只手」、§5.8）。WP5。
// 替身共用主角几何体，自带骨架。姿态来源：history（按 t − delay 采样 PoseHistory）、oracle（按求解器路线预演）、script（PoseClipId）。
// 覆盖项：headLag（头部再延迟）、headDownHold（保持低头）、thirdHand（手势 + IK 目标）、speedFactor、stopAtDistance、clip（混合到脚本姿势）。
// 放置：
//   侧墙镜 / 窗：以墙面为对称面反射（three 检测到行列式为负会自动翻转正面，flatShading 的法线由屏幕导数算出，不会反）；
//     替身站在镜中房间里，离玻璃的深度随玩家到墙的距离压缩（0.45–3.2 m），沿 s 放在镜头前方约半个视角处（从三条车道都看得见）。
//   端墙镜：以镜面为对称面（scale.z = −1），替身「迎面爬来」，深度 = 0.2 × 玩家到镜面的距离（0.5–3.2 m）。
//   水洼：scale.y = −1 放在地面以下，模板 0x80 内显示（renderOrder −18）；没有模板时画模糊剪影贴花。
//   世界：5-6 站着的「我」、4-3 镜中站着的「我」等，直接放在世界里；avoidPlayerLane 永远走相邻车道，不碰撞。
//   静场：StillSet.surfaces(variant) 给出的平面，相对主角锚点反射。
// 记忆（memory cue，1-2 窗玻璃里倒立的人）：script 'handstand'，去饱和、带一点傍晚的灰，1.2 s 闪现（减少闪烁：0.4 s 淡入淡出）。
// 第三只手只出现在反光面里（附录 A-12：搭肩只在 3-10 / 5-4 的镜子里），这里不检查剧本，只按 cue 执行。
import * as THREE from 'three';
import type { Plan, ViewContext, ViewSystem } from '../../core/contracts';
import { STILL_ORIGIN } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp, DEG, lerp, smoothstep } from '../../core/math';
import { getSet } from '../../core/registry';
import { BONE_INDEX, copyPose, createPose, type Pose } from '../../core/rig';
import type { PoseClipId, SimSnapshot, ThirdHandGesture } from '../../core/types';
import type { CompiledChapter, CompiledSegment, DoubleMod, DoubleSpec } from '../../levels/schema';
import { clipPose } from './clips';
import { crawlPose, jumpDur, PoseBuilder, type CrawlInput } from './handCycle';
import { blendPoses } from './poses';
import type { ActorRigFactory, Rig } from './rigBuild';
import { WP5 } from './shared';
import { FOLLOW } from '../camera/shots';
import { vFromH } from '../camera/CameraRig';
import { reflectPlane, type ReflectSurfaces, type SurfaceView } from './surfaces';
import { applyThirdHand, gestureExtend, type ThirdHandTarget } from './ThirdHand';

type Kind = 'side' | 'end' | 'floor' | 'world' | 'still' | 'memory';

interface Rec {
  id: string; spec: DoubleSpec; kind: Kind; t0: number;
  surf: SurfaceView | null;
  delay: number; headLag: number;
  headDown: { t0: number; hold: number } | null;
  third: { g: ThirdHandGesture; t0: number; hold: number } | null;
  clip: PoseClipId | null; clipT0: number; clipBlend: number;
  speedFactor: number; stopAt: number | null; stopped: boolean;
  offS: number; worldS: number; worldX: number; worldXv: number; lane: number; walk: number;
  sAhead: number; sAheadInit: boolean;
  alpha: number; fadeIn: number; fadeOut: { t0: number; dur: number } | null; until: number;
  memorySec: number;
  /** 本帧头部的世界坐标（镜头焦点）。 */
  head: THREE.Vector3;
}

interface Slot { rig: Rig; box: THREE.Group; body: THREE.MeshLambertMaterial; puddle: THREE.MeshLambertMaterial; memory: THREE.MeshLambertMaterial; pose: Pose; tmp: Pose; rec: Rec | null }

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _pl = new THREE.Plane();
const _tgt: ThirdHandTarget = {};
const _tp = new THREE.Vector3(), _td = new THREE.Vector3(), _m3 = new THREE.Matrix4();

/** 给 Lambert 加去饱和 + 色调（与 WP3 的 onBeforeCompile 串联，不覆盖）。 */
export function tintLambert(mat: THREE.MeshLambertMaterial, desat: number, tint: [number, number, number]): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uWp5Desat = { value: desat };
    sh.uniforms.uWp5Tint = { value: new THREE.Vector3(...tint) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWp5Desat; uniform vec3 uWp5Tint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), uWp5Desat) * uWp5Tint;');
  };
  mat.customProgramCacheKey = () => `${prevKey()}|wp5tint`;
  return mat;
}

export class DoubleSystem implements ViewSystem {
  readonly id = 'wp5.doubles';
  readonly owner = 'WP5' as const;
  readonly order = 42;
  private ctx!: ViewContext;
  private factory!: ActorRigFactory;
  private readonly slots: Slot[] = [];
  private readonly b = new PoseBuilder();
  private readonly b2 = new PoseBuilder();
  private chapter: CompiledChapter | null = null;
  private seg: CompiledSegment | null = null;
  private plan: Plan | null = null;
  private planSeg = -1;
  private lastT = 0;
  private readonly crawlIn: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 4.8, speed: 4.8, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };

  constructor(private readonly surfaces: ReflectSurfaces) {}

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    this.factory = ctx.rig as unknown as ActorRigFactory;
    for (let i = 0; i < 4; i++) {
      const body = ctx.mat.lambert({ vertexColors: true, flat: true, transparent: true, opacity: 1 });
      const puddle = ctx.mat.lambert({ vertexColors: true, flat: true, transparent: true, opacity: 1 });
      puddle.stencilWrite = true; puddle.stencilRef = 0x80; puddle.stencilFuncMask = 0x80; puddle.stencilWriteMask = 0;
      puddle.stencilFunc = THREE.EqualStencilFunc; puddle.stencilZPass = THREE.KeepStencilOp;
      const memory = tintLambert(ctx.mat.lambert({ vertexColors: true, flat: true, transparent: true, opacity: 1 }), 0.85, [0.8, 0.8, 0.82]);
      for (const m of [body, puddle, memory]) { m.depthWrite = true; m.name = `wp5.double${i}`; }
      const rig = this.factory.make('double', body);
      const box = new THREE.Group();
      box.matrixAutoUpdate = false;
      box.name = `double${i}`;
      box.add(rig.root);
      box.visible = false;
      ctx.scene.add(box);
      this.slots.push({ rig, box, body, puddle, memory, pose: createPose(), tmp: createPose(), rec: null });
    }
  }

  async loadChapter(ch: CompiledChapter): Promise<void> { this.chapter = ch; this.clear(); }
  onSegment(seg: CompiledSegment): void {
    this.seg = seg;
    // 离开这一段：世界 / 静场 / 记忆替身立即结束；挂在反光面上的替身等反光面离开视野再结束
    for (const sl of this.slots) {
      const r = sl.rec;
      if (!r) continue;
      if (r.kind === 'world' || r.kind === 'still' || r.kind === 'memory') this.free(sl);
    }
  }
  onEvent(e: GameEvent): void {
    if (e.type === 'retry' || e.type === 'chapter:start') this.clear();
  }
  onReset(): void { this.clear(); }

  clear(): void { for (const sl of this.slots) this.free(sl); WP5.focus = null; }
  private free(sl: Slot): void { sl.rec = null; sl.box.visible = false; }

  /** 替身所在的槽位下标（没有返回 −1）。 */
  slotIndexOf(id: string): number { return this.slots.findIndex((s) => s.rec?.id === id); }

  /** 活动替身（调试 / 测试用）。 */
  active(): Array<{ id: string; kind: Kind; alpha: number; visible: boolean; head: number[] }> {
    return this.slots.filter((s) => s.rec).map((s) => ({ id: (s.rec as Rec).id, kind: (s.rec as Rec).kind, alpha: (s.rec as Rec).alpha, visible: s.box.visible, head: (s.rec as Rec).head.toArray() }));
  }

  // ———————————————————— cue ————————————————————
  /** double cue。 */
  spawn(spec: DoubleSpec, snap: SimSnapshot): void {
    const surf = spec.surface === 'world' ? null : this.surfaces.views.get(spec.surface) ?? null;
    let kind: Kind = 'world';
    if (surf) kind = surf.kind;
    else if (spec.surface !== 'world') kind = 'still';
    this.start(spec, kind, surf, snap.t, snap);
  }

  private start(spec: DoubleSpec, kind: Kind, surf: SurfaceView | null, t: number, snap: SimSnapshot): Rec | null {
    // 同 id 重新出现：复用
    let sl = this.slots.find((s) => s.rec?.id === spec.id) ?? this.slots.find((s) => !s.rec);
    if (!sl) {
      // 挤掉最老的（按开始时间）
      sl = this.slots.reduce((a, b) => ((a.rec?.t0 ?? 0) <= (b.rec?.t0 ?? 0) ? a : b));
    }
    const rec: Rec = {
      id: spec.id, spec, kind, t0: t, surf,
      delay: spec.delay ?? (spec.source === 'history' ? 0.35 : 0), headLag: spec.headLag ?? 0,
      headDown: spec.headDownHold ? { t0: t, hold: spec.headDownHold } : null,
      third: spec.thirdHand ? { g: spec.thirdHand.gesture, t0: t + spec.thirdHand.at, hold: spec.thirdHand.hold } : null,
      clip: null, clipT0: t, clipBlend: 0,
      speedFactor: 1, stopAt: null, stopped: false,
      offS: 0, worldS: snap.player.s + (spec.anchor?.sAhead ?? 8), worldX: (spec.anchor?.lane ?? 0) * 1.1, worldXv: 0, lane: spec.anchor?.lane ?? 0, walk: 0,
      sAhead: 0, sAheadInit: false,
      alpha: 0, fadeIn: kind === 'memory' ? 0 : 0.35, fadeOut: null, until: spec.ttl && spec.ttl > 0 ? t + spec.ttl : Infinity,
      memorySec: 0, head: new THREE.Vector3(),
    };
    if (rec.spec.avoidPlayerLane && rec.lane === snap.player.laneTarget) rec.lane = snap.player.laneTarget === 0 ? -1 : 0;
    rec.worldX = rec.lane * 1.1;
    sl.rec = rec;
    return rec;
  }

  /** doubleMod cue。 */
  modify(target: string, mod: DoubleMod, t: number): void {
    const r = this.slots.find((s) => s.rec?.id === target)?.rec;
    if (!r) return;
    if (mod.delay !== undefined) r.delay = mod.delay;
    if (mod.headLag !== undefined) r.headLag = mod.headLag;
    if (mod.headDownHold !== undefined) r.headDown = { t0: t, hold: mod.headDownHold };
    if (mod.thirdHand) r.third = { g: mod.thirdHand.gesture, t0: t + mod.thirdHand.at, hold: mod.thirdHand.hold };
    if (mod.clip) { r.clip = mod.clip; r.clipT0 = t; }
    if (mod.speedFactor !== undefined) { r.speedFactor = mod.speedFactor; if (r.stopped) { r.stopped = false; r.stopAt = null; } }
    if (mod.stopAtDistance !== undefined) r.stopAt = mod.stopAtDistance;
  }

  /** doubleEnd cue。 */
  end(target: string, fade: number | undefined, t: number): void {
    const r = this.slots.find((s) => s.rec?.id === target)?.rec;
    if (r && !r.fadeOut) r.fadeOut = { t0: t, dur: Math.max(0.001, fade ?? 0.5) };
  }

  /** memory cue：1-2 窗玻璃里倒立的人（what = handstandWindow）。 */
  memory(surface: string, seconds: number, snap: SimSnapshot): void {
    const surf = this.surfaces.views.get(surface) ?? null;
    if (!surf || surf.kind !== 'side') return;
    const spec: DoubleSpec = { id: `memory:${surface}`, surface, source: 'script', clip: 'handstand' };
    const r = this.start(spec, 'memory', surf, snap.t, snap);
    if (r) { r.memorySec = Math.max(0.2, seconds); r.until = snap.t + r.memorySec; surf.memory = 1; }
  }

  // ———————————————————— 每帧 ————————————————————
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const same = prev.segIndex === next.segIndex;
    const a = same ? alpha : 1;
    const t = lerp(prev.t, next.t, a);
    let step = t - this.lastT;
    if (!(step >= 0) || step > 60) step = 0;
    this.lastT = t;
    let focus: Rec | null = null;
    for (const sl of this.slots) {
      const r = sl.rec;
      if (!r) continue;
      if (t >= r.until && !r.fadeOut) r.fadeOut = { t0: r.until, dur: r.kind === 'memory' ? (this.ctx.settings.reducedFlicker ? 0.4 : 0.001) : 0.5 };
      // 透明度
      let al = r.fadeIn > 0 ? clamp((t - r.t0) / r.fadeIn, 0, 1) : 1;
      if (r.kind === 'memory' && this.ctx.settings.reducedFlicker) al = clamp((t - r.t0) / 0.4, 0, 1);
      if (r.fadeOut) {
        const k = clamp((t - r.fadeOut.t0) / r.fadeOut.dur, 0, 1);
        al *= 1 - k;
        if (k >= 1) { this.free(sl); continue; }
      }
      r.alpha = al;
      // 挂在反光面上的替身：反光面远远落在身后就结束
      if (r.surf && r.surf.kind !== 'floor' && r.surf.s1 < next.player.s - 8) { this.free(sl); continue; }
      const ok = this.place(sl, r, prev, next, a, t, step, dt);
      sl.box.visible = ok && al > 0.002;
      const mat = r.kind === 'floor' ? sl.puddle : r.kind === 'memory' ? sl.memory : sl.body;
      if (sl.rig.mesh.material !== mat) sl.rig.mesh.material = mat;
      mat.opacity = al;
      sl.rig.mesh.renderOrder = r.kind === 'floor' ? -18 : 0;
      if (sl.box.visible && r.kind !== 'memory' && r.kind !== 'world' && al > 0.5) focus = !focus || r.t0 > focus.t0 ? r : focus;
      if (r.surf) this.surfaces.want(r.surf.id);
    }
    // 镜头焦点：最近出现的那个镜中 / 水洼替身
    if (focus) {
      const kind = focus.kind === 'end' ? 'end' : focus.kind === 'floor' ? 'floor' : focus.kind === 'side' ? 'side' : 'world';
      WP5.focus = WP5.focus ?? { point: new THREE.Vector3(), kind, weight: 0 };
      WP5.focus.point.copy(focus.head); WP5.focus.kind = kind; WP5.focus.weight = focus.alpha;
    } else if (WP5.focus) WP5.focus.weight = 0;
  }

  /** 算姿势与放置矩阵；返回是否应该显示。 */
  private place(sl: Slot, r: Rec, prev: SimSnapshot, next: SimSnapshot, a: number, t: number, step: number, dt: number): boolean {
    const P = prev.player, N = next.player;
    const sNow = lerp(P.s, N.s, a), xNow = lerp(P.x, N.x, a), fyNow = lerp(P.floorY, N.floorY, a);
    const hist = this.factory.history;
    const pose = sl.pose;
    // —— 1. 姿态来源 ——
    const src = r.spec.source;
    let haveHist = false;
    if (src === 'history') {
      haveHist = hist.sample(t - r.delay, pose);
      if (!haveHist) copyPose(pose, WP5.playerPose);
      if (r.headLag > 0 && hist.sample(t - r.delay - r.headLag, sl.tmp)) {
        for (const bn of ['neck', 'head'] as const) {
          const i = BONE_INDEX[bn] * 4;
          for (let k = 0; k < 4; k++) pose.q[i + k] = sl.tmp.q[i + k] as number;
        }
      }
    } else if (src === 'oracle') {
      this.oraclePose(r, next, sNow, pose);
    } else {
      clipPose((r.spec.clip ?? 'standIdle') as PoseClipId, t - r.t0, this.b2, pose, { x: 0, y: 0, s: 0, yaw: 0 });
    }
    // 覆盖项：混合到脚本姿势
    if (r.clip) {
      r.clipBlend = clamp(r.clipBlend + Math.max(dt, 1 / 60) / 0.4, 0, 1);
      clipPose(r.clip, t - r.clipT0, this.b2, sl.tmp, { x: 0, y: 0, s: 0, yaw: 0 });
      sl.tmp.root.set(pose.root);
      blendPoses(pose, sl.tmp, smoothstep(0, 1, r.clipBlend), pose);
    }
    // —— 2. 放置 ——
    const box = sl.box;
    const root = pose.root;
    const scripted = src !== 'history' && src !== 'oracle';
    // attachBehind：站在另一个替身身后（同一面镜子，同一个反射），第三只手搭在它的肩上（3-10 / 5-4）
    const host = r.spec.attachBehind ? this.slots.find((q) => q.rec?.id === r.spec.attachBehind && q !== sl) : undefined;
    if (host && host.rec) {
      if (!host.box.visible) return false;
      root[0] = host.pose.root[0] as number; root[1] = (root[1] as number) + (host.rec.surf?.floorY ?? fyNow); root[2] = (host.pose.root[2] as number) - 0.5; root[3] = host.pose.root[3] as number;
      box.matrix.copy(host.box.matrix);
    } else switch (r.kind) {
      case 'side': case 'memory': {
        const v = r.surf as SurfaceView;
        if (!v.active) return false;
        const xh = scripted ? xNow : (root[0] as number);
        const d = r.kind === 'memory' ? 0.5 : clamp(0.25 + 0.25 * Math.abs(xh - v.planeX), 0.4, 3.2);
        const xd = v.planeX + v.sign * d;                 // 替身在镜中房间里的世界 x
        const target = this.aheadFor(xd, sNow, xNow);
        if (!r.sAheadInit) { r.sAhead = target; r.sAheadInit = true; }
        else r.sAhead += (target - r.sAhead) * (1 - Math.exp(-step / 0.5));
        if (scripted) r.offS += (r.speedFactor - 1) * N.speed * step;
        root[0] = v.planeX - v.sign * d;                  // 反射前的位置（走廊里）
        root[2] = sNow + r.sAhead + r.offS;
        if (scripted) {
          // 脚本姿势的根高度（clip 的 lift）加在地面上；记忆里倒立的人以手腕为轴悬在窗台下沿附近
          root[1] = (root[1] as number) + (r.kind === 'memory' ? v.floorY + v.y0 - 0.2 : v.floorY);
          root[3] = 0;
        }
        box.matrix.copy(v.reflect);
        if (r.kind === 'memory') {
          // 记忆里的人按 0.82 缩放（以手腕所在处为中心），整个人落在窗框里
          const k = 0.82;
          _m.makeTranslation(root[0] as number, root[1] as number, -(root[2] as number)).multiply(_m2.makeScale(k, k, k))
            .multiply(_m3.makeTranslation(-(root[0] as number), -(root[1] as number), root[2] as number));
          box.matrix.multiply(_m);
        }
        break;
      }
      case 'end': {
        const v = r.surf as SurfaceView;
        if (!v.active) return false;
        const D = Math.max(0, v.planeS - sNow);
        const d = clamp(0.2 * D, 0.5, 3.2);
        root[0] = (scripted ? xNow : (root[0] as number)) * 0.5;
        root[2] = v.planeS - d;
        if (scripted) { root[1] = (root[1] as number) + v.floorY; root[3] = 0; }
        box.matrix.copy(v.reflect);
        break;
      }
      case 'floor': {
        const v = r.surf as SurfaceView;
        if (!v.active) return false;
        if (scripted) { root[0] = v.cx; root[1] = (root[1] as number) + v.floorY; root[2] = v.cs; root[3] = Math.PI; }
        box.matrix.copy(v.reflect);
        const inside = Math.abs((root[0] as number) - v.cx) < v.rx + 0.4 && Math.abs((root[2] as number) - v.cs) < v.rs + 0.6;
        // 没有模板：只画模糊剪影贴花
        if (!this.surfaces.stencil) {
          if (v.blob) {
            v.blob.visible = inside && r.alpha > 0.05;
            v.blob.position.set((root[0] as number) - v.cx, 0.005, -((root[2] as number) - v.cs) - 0.35);
            (v.blob.material as THREE.MeshBasicMaterial).opacity = 0.55 * r.alpha;
          }
          this.b.load(pose); this.headOf(r, sl);
          return false;
        }
        if (v.blob) v.blob.visible = false;
        if (!inside) { this.b.load(pose); this.headOf(r, sl); return false; }
        break;
      }
      case 'world': {
        if (next.segKind === 'still') return false;
        const an = r.spec.anchor ?? {};
        // 相对玩家的速度（负 = 迎面）；stopAtDistance 到了就在世界里停住
        if (!r.stopped) {
          r.offS += (an.speed ?? 0) * r.speedFactor * step;
          r.worldS = sNow + (an.sAhead ?? 8) + r.offS;
          if (r.stopAt !== null && r.worldS - sNow <= r.stopAt) { r.stopped = true; r.worldS = sNow + r.stopAt; }
        } else r.offS = r.worldS - sNow - (an.sAhead ?? 8);
        // avoidPlayerLane：永远走相邻车道
        if (r.spec.avoidPlayerLane && r.lane === N.laneTarget) r.lane = N.laneTarget === 0 ? (r.lane <= 0 ? -1 : 1) : 0;
        const tx = r.lane * 1.1;
        const w = 6, hs = Math.min(step, 0.05);
        r.worldXv += (w * w * (tx - r.worldX) - 2 * w * r.worldXv) * hs; r.worldX += r.worldXv * hs;
        const moving = !r.stopped && Math.abs((an.speed ?? 0) * r.speedFactor) > 0.01;
        const toward = (an.speed ?? 0) < 0 || r.stopped;
        if (scripted) {
          if (moving) r.walk += Math.abs(N.speed - (an.speed ?? 0)) * step;
          if ((r.spec.clip ?? 'walkUpright') === 'walkUpright' && !r.clip) {
            clipPose('walkUpright', moving ? r.walk / 1.2 : 0.25, this.b2, pose, { x: 0, y: 0, s: 0, yaw: 0 });
          }
          root[1] = (root[1] as number) + fyNow;
        }
        root[0] = r.worldX; root[2] = r.worldS; root[3] = toward ? Math.PI : 0;
        box.matrix.identity();
        break;
      }
      case 'still': {
        if (next.segKind !== 'still' || !next.still) return false;
        const set = getSet(next.still.set);
        const sf = set?.surfaces?.(next.still.variant)?.find((q) => q.id === r.spec.surface);
        if (!sf) return false;
        _pl.copy(sf.plane).translate(_v.set(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z));
        reflectPlane(_pl, box.matrix).multiply(WP5.stillAnchor);
        if (!scripted) { root[0] = 0; root[1] = 0; root[2] = 0; root[3] = 0; }
        break;
      }
    }
    // —— 3. 低头保持、第三只手 ——
    const b = this.b;
    b.load(pose);
    if (r.headDown) {
      const u = t - r.headDown.t0;
      const w = smoothstep(0, 0.15, u) * (1 - smoothstep(r.headDown.hold, r.headDown.hold + 0.3, u));
      if (w > 0) { b.addLocal('neck', -0.35 * w, 0, 0); b.addLocal('head', -0.75 * w, 0, 0); b.fkAll(BONE_INDEX.head); }
      if (u > r.headDown.hold + 0.3) r.headDown = null;
    }
    if (r.third) {
      const u = t - r.third.t0;
      const e = gestureExtend(u, r.third.hold);
      if (e > 0) {
        this.thirdTarget(r, sl, next);
        applyThirdHand(b, r.third.g, e, u, _tgt);
        b.fkAll(BONE_INDEX.arm3Upper);
      } else if (u > 0) r.third = null;
    }
    // attachBehind：站在另一个替身身后，第三只手搭在它的肩上（3-10 / 5-4）
    const out = b.finish();
    copyPose(pose, out);
    sl.rig.apply(pose);
    box.matrixWorldNeedsUpdate = true;
    this.headOf(r, sl);
    return true;
  }

  /** 头的世界坐标（替身本帧）。 */
  private headOf(r: Rec, sl: Slot): void {
    const hi = BONE_INDEX.head;
    this.b.toWorld(this.b.wp[hi] as THREE.Vector3, r.head);
    r.head.y += 0.1;
    r.head.applyMatrix4(sl.box.matrix);
  }

  /**
   * 侧墙替身沿 s 放在哪里：让它落在追尾镜头前方约半个水平视角处（三条车道都看得见）。
   * 用追尾机位的解析位置（§5.4），不读上一帧的相机（无头测试里上一帧可能是很久以前）。
   */
  private aheadFor(xDouble: number, sNow: number, xNow: number): number {
    const aspect = this.ctx.camera.aspect || 16 / 9;
    const portrait = aspect < 1;
    const F = portrait ? FOLLOW.portrait : FOLLOW.landscape;
    const vfov = portrait ? Math.min(F.vMax, vFromH(FOLLOW.landscape.hfov, aspect)) : clamp(vFromH(FOLLOW.landscape.hfov, aspect), FOLLOW.landscape.vMin, FOLLOW.landscape.vMax);
    const halfH = Math.atan(Math.tan((vfov * DEG) / 2) * aspect);
    const ang = clamp(halfH * 0.62, 10 * DEG, 27 * DEG);
    const dx = Math.abs(xDouble - F.k * xNow);
    return clamp(dx / Math.tan(ang) - F.back, 0.8, 12);
  }

  /** 第三只手的目标（反射前的坐标）。 */
  private thirdTarget(r: Rec, sl: Slot, next: SimSnapshot): void {
    _tgt.point = undefined; _tgt.dir = undefined;
    const g = r.third?.g;
    const inv = sl.box.matrix;       // 反射矩阵是自己的逆（世界 ↔ 反射前）
    if (g === 'forehead') {
      _tp.copy(WP5.playerRoot);
      // 玩家额头：取主角头骨的世界位置
      this.b2.load(WP5.playerPose);
      this.b2.jointWorld('head', _tp); _tp.y += 0.1;
      if (next.segKind === 'still') _tp.applyMatrix4(WP5.stillAnchor);
      _tgt.point = _tp.applyMatrix4(_m.copy(inv).invert());
    } else if (g === 'palmGlass' && r.surf) {
      const v = r.surf;
      if (v.kind === 'side') { _tp.set(v.planeX, v.floorY + 0.95, -(this.b.pose.root[2] as number) - 0.35); _td.set(v.sign, 0, 0); }
      else { _tp.set(this.b.pose.root[0] as number, v.floorY + 0.7, -v.planeS); _td.set(0, 0, -1); }
      _tgt.point = _tp; _tgt.dir = _td;
    } else if (g === 'shoulder' && r.spec.attachBehind) {
      const other = this.slots.find((s) => s.rec?.id === r.spec.attachBehind);
      if (other) { this.b2.load(other.pose); this.b2.jointWorld('upperArmR', _tp); _tgt.point = _tp; }
    } else if (g === 'point') {
      _td.set(0, 0, r.kind === 'side' || r.kind === 'end' ? -1 : 1); _tgt.dir = _td;
    }
  }

  /** oracle：按求解器路线预演 lead 秒之后的爬行姿势。 */
  private oraclePose(r: Rec, next: SimSnapshot, sNow: number, out: Pose): void {
    const seg = this.seg ?? this.chapter?.segments[next.segIndex] ?? null;
    if (seg && seg.kind === 'run' && this.planSeg !== seg.index) {
      this.plan = this.ctx.solver.solve(seg); this.planSeg = seg.index;
    }
    const N = next.player;
    const lead = r.spec.lead ?? 0.35;
    const so = sNow + lead * Math.max(0.5, N.speed);
    const I = this.crawlIn;
    I.s = so; I.stride = N.stride; I.cadence = N.cadence || 4.8; I.speed = N.speed; I.floorY = seg ? seg.floorY(so) : N.floorY;
    I.beat = seg ? (so - seg.s0) / seg.stride : N.beat;
    const lane = this.plan ? this.plan.laneAt(so) : N.laneTarget;
    I.x = lane * 1.1; I.laneTarget = lane;
    const act = this.plan ? this.plan.actionAt(so) : 'none';
    I.air = act === 'jump'; I.duck = act === 'duck' ? 1 : 0;
    I.airT = I.air ? jumpDur(I.cadence) * 0.5 : 0; I.y = I.air ? 0.45 : 0;
    copyPose(out, crawlPose(I, this.b2));
  }
}
