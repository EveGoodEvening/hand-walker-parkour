// src/render/actors/PlanarShadow.ts —— 平面影子（DESIGN.md §3「影子与本体不一致」、§5.8）。WP5。
// 影子是独立骨架的平面投影：投影矩阵作为影子 mesh 的 matrixWorld（matrixAutoUpdate = false、frustumCulled = false），
// DetachedBindMode、bindMatrix = I；Basic #0B0F12 不透明度 0.38；模板位 0x7F「Increment + Equal 0」，重叠处只压暗一次
// （和 three 的 ShadowMesh 同一做法）。没有模板时关掉模板（接受重叠处发深）。
// 光线方向取氛围预设的 planarDir（缺省让影子落在前右方，追尾镜头随时看得到）；atmosphere cue 时按秒插值。
// 影子异常事件期间（修复轮 U5）光线压低到前右方，影子伸出 2–3 m（SHADOW_EVENT）；追来的第二个影子不透明度 0.5。
// 低画质（planarShadow = 'events'）：平时只画圆形暗斑，只在影子异常事件期间换成平面投影。
// 模式（ShadowMode）：normal、jellyfish（展开四肢的水母，1-5）、threeHands / pointBack（胸口伸出的手指向身后，2-9）、
// pointMirror（指向走廊尽头的镜子，2-10）、long（拉长，4-1）、liesDown（你站着，它趴下、双手前伸，4-3）、
// reversed（头朝反方向，5-3）、chase（第二个影子在身后按稳度的距离爬，比你快一点，5-3）、blob（只画暗斑）。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { RENDER_ORDER, STENCIL } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { FALLBACK_ATMOSPHERES } from '../../core/fallbacks';
import { clamp, DEG, easeInOutSine, lerp } from '../../core/math';
import { getAtmosphere } from '../../core/registry';
import { BONE_INDEX, copyPose, createPose, type Pose } from '../../core/rig';
import type { AtmosphereId, ShadowMode, SimSnapshot } from '../../core/types';
import type { CompiledSegment } from '../../levels/schema';
import { armTo, crawlPose, PoseBuilder, setHand, type CrawlInput } from './handCycle';
import type { ActorRigFactory, Rig } from './rigBuild';
import { WP5 } from './shared';
import { radialTexture } from './surfaces';
import { applyThirdHand } from './ThirdHand';

function planarDirOf(id: AtmosphereId): [number, number, number] {
  return (getAtmosphere(id) ?? FALLBACK_ATMOSPHERES[id]).planarDir;
}

/** 沿方向 L（光线行进方向，L.y < 0）投影到平面 y = h 的矩阵（w 保持 1）。 */
export function shadowMatrix(L: THREE.Vector3, h: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const ly = Math.min(-0.05, L.y);
  return out.set(1, -L.x / ly, 0, (L.x * h) / ly, 0, 0, 0, h, 0, -L.z / ly, 1, (L.z * h) / ly, 0, 0, 0, 1);
}

/**
 * 「美术上永远落在你的前右方，追尾镜头随时看得到」（§3）：爬姿的身体只有 0.3–0.6 m 高，
 * 光线太陡时影子全压在身体下面。这里保证水平分量 ≥ 1.2 × 竖直分量（光线仰角 ≤ 约 40°），方向不变。
 */
export function readableLight(dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(dir);
  const hz = Math.hypot(out.x, out.z), vy = Math.max(0.05, -out.y);
  const minRatio = 1.2;
  if (hz > 1e-4 && hz < minRatio * vy) { const k = (minRatio * vy) / hz; out.x *= k; out.z *= k; }
  out.y = -vy;
  return out.normalize();
}

/**
 * 影子异常事件期间（修复轮 U5）：光线压得很低、方向固定在前右方，影子伸出身体 2–3 m，追尾镜头和站立机位都看得见。
 * 以前只保证「水平 ≥ 1.2 × 竖直」，影子只伸出约 1.3 m，被身体挡住；4-3 的影子还朝后落，与「它选择了另一个方向」不符。
 * 水平 / 竖直比按姿势自己算：影子的尖（最远的关节投影）落在根的前右方 EVENT_TIP 米处，比例限制在 [RATIO_MIN, RATIO_MAX]。
 */
export const SHADOW_EVENT = { tip: 2.5, liesDownTip: 3.9, ratioMin: 3, liesDownRatioMin: 1.2, ratioMax: 8, longRatio: 5, blendSec: 0.5, defaultDir: [0.5, -0.866] as const } as const;
/**
 * 4-3 趴下的影子（修复轮 U5 第二轮）：脚在你脚前 feetGap 米（影子连着你的脚，以前根放在 2.3 m 外，看起来和你断开），
 * 整个影子沿光线方向拉长到伸出的手落在 SHADOW_EVENT.liesDownTip 处（低角度的光把影子拉长；只拉长度，不加宽），
 * 站立机位看得见的地面从你前方约 1.3 m 起：趴着的头、肩和向前伸的双手都在画面里。拉长倍数限制在 [1, maxStretch]。
 */
export const LIES_DOWN = { feetGap: 0.1, maxStretch: 2.6 } as const;
/**
 * 2-9 pointBack（修复轮 B3 第三轮）：第三只手从影子的胸口伸出来，水平地指向黑板（锚点空间里的方向；静场的锚点不转，
 * 角色空间 = 锚点空间）。labBoard（WP3）的黑板在主角正前方 3.3 m，「教室后面的黑板」只能按镜头算：镜头从低头看影子的机位
 * 顺着这只手的方向慢慢转到黑板（camera/shots.ts 的 STILL_TURN_BACK.labBoard）。以前指向右后方 (0.8, 0.2, 0.56)，
 * 镜头顺着它转过去，身后什么也没有，黑板上的字反而在镜头转回来时写出。手不往上抬：抬高的手被低角度的光拉向前右方，
 * 投影就不再指着黑板。grow：手伸出来要多少秒（4.4 s 伸出、5.0 s 伸直，5.2 s 镜头才转）。
 */
export const POINT_BACK = { dir: [-0.5, 0, -0.866] as const, grow: 0.6 } as const;
/**
 * 从静场一开始就画平面影子（按事件光线）的 set（修复轮 B3 第三轮）：2-9 的镜头先低头看影子（「我低头看着自己的影子。……
 * 趴在地上，和我一样的姿势。」），4.4 s 才多出一只手。以前静场只在影子事件期间画影子，地上是空的，影子到 4.4 s 才凭空出现。
 * tip / ratioMin：影子的尖离根多远（米）、光线水平 / 竖直比的下限（取代 SHADOW_EVENT.tip / ratioMin）。
 */
export const STILL_SHADOW: Readonly<Record<string, { tip: number; ratioMin: number }>> = { labBoard: { tip: 2.5, ratioMin: 3 } };
/** 沿水平单位方向 (dx, dz) 以点 (px, pz) 为中心拉长 k 倍的矩阵（y 不变）。 */
export function stretchMatrix(px: number, pz: number, dx: number, dz: number, k: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const e = k - 1;
  const a11 = 1 + e * dx * dx, a13 = e * dx * dz, a33 = 1 + e * dz * dz;
  return out.set(a11, 0, a13, px - (a11 * px + a13 * pz), 0, 1, 0, 0, a13, 0, a33, pz - (a13 * px + a33 * pz), 0, 0, 0, 1);
}
/**
 * 事件期间影子的水平方向（单位向量 x、z）：氛围的方向在前右 25°–60° 之间就沿用，否则用缺省的前右 30°。
 * 正前方（梦 dream 的 (0.1, −0.9)）不行：拉长的影子在追尾 / 站立机位里被压缩成主角身后的一团灰影。
 */
export function eventHeading(dir: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
  const h = Math.hypot(dir.x, dir.z);
  if (h > 1e-3 && dir.x >= 0.42 * h && dir.z <= -0.5 * h) return out.set(dir.x / h, dir.z / h);
  return out.set(SHADOW_EVENT.defaultDir[0], SHADOW_EVENT.defaultDir[1]);
}
/** 按水平方向 (hx, hz) 与水平 / 竖直比 r 组成光线方向（单位向量，y < 0）。 */
export function lightFrom(hx: number, hz: number, r: number, out: THREE.Vector3): THREE.Vector3 { return out.set(hx * r, -1, hz * r).normalize(); }

const _L = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _E = new THREE.Vector3(), _L2 = new THREE.Vector3();
const _h = new THREE.Vector2(), _r = new THREE.Vector3(), _S = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, -1);
const TIP_JOINTS = ['head', 'padL', 'padR', 'palmL', 'palmR', 'chest', 'pelvis', 'footL', 'footR', 'shinL', 'shinR', 'foreArmL', 'foreArmR', 'arm3Hand'] as const;

export class PlanarShadowSystem implements ViewSystem {
  readonly id = 'wp5.shadow';
  readonly owner = 'WP5' as const;
  readonly order = 44;
  private ctx!: ViewContext;
  private main!: Rig;
  private second!: Rig;
  private matStencil!: THREE.MeshBasicMaterial;
  private matPlain!: THREE.MeshBasicMaterial;
  private blob!: THREE.Mesh;
  private blobMat!: THREE.MeshBasicMaterial;
  mode: ShadowMode = 'normal';
  private modeT0 = 0;
  private modeUntil = Infinity;
  private readonly dir = new THREE.Vector3(0.3, -1, -0.55).normalize();
  /** 事件光线的权重（0..1，按模拟时间 blendSec 过渡）。 */
  private eventK = 0;
  /** 第二个影子（追来的那个）：不透明度 0.5，自己的材质（模板同一组位，与你的影子不叠）。 */
  private matSecond!: THREE.MeshBasicMaterial;
  private matSecondPlain!: THREE.MeshBasicMaterial;
  private readonly dirFrom = new THREE.Vector3();
  private readonly dirTo = new THREE.Vector3();
  private dirK = 1; private dirDur = 1.5;
  private lastT = 0;
  /** 上一帧的段下标（换段进静场时事件光线直接到位）。 */
  private segIdx = -1;
  private readonly b = new PoseBuilder();
  private readonly pose = createPose();
  private readonly pose2 = createPose();
  private readonly crawl: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 4.8, speed: 4.8, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };
  /** 调试：本帧是否画了平面投影 / 暗斑；事件光线的水平 / 竖直比与权重。 */
  state = { planar: false, blob: false, second: false, stencil: true, ratio: 0, eventK: 0, stretch: 1 };
  /** 4-3 趴下的影子沿光线拉长的倍数（shadowPose 按姿势算，frame 按事件权重用）。 */
  private lieStretch = 1;
  /** 本帧主影子用的光线方向（测试用）。 */
  readonly light = new THREE.Vector3();

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    const f = ctx.rig as unknown as ActorRigFactory;
    const mk = (stencil: boolean, opacity = 0.38) => {
      const m = ctx.mat.basic({ color: 0x0b0f12, transparent: true, opacity });
      m.depthWrite = false; m.side = THREE.FrontSide;   // 压扁的闭合网格：朝上的面投下来是正面，朝下的面被剔除（没有模板时也只一层）
      m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
      if (stencil) {
        m.stencilWrite = true; m.stencilRef = 0; m.stencilFuncMask = STENCIL.shadowMask; m.stencilWriteMask = STENCIL.shadowMask;
        m.stencilFunc = THREE.EqualStencilFunc; m.stencilZPass = THREE.IncrementStencilOp; m.stencilFail = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp;
      }
      m.name = stencil ? 'wp5.shadowStencil' : 'wp5.shadowPlain';
      return m;
    };
    this.matStencil = mk(true); this.matPlain = mk(false);
    this.matSecond = mk(true, 0.5); this.matSecondPlain = mk(false, 0.5);
    this.matSecond.name = 'wp5.shadowSecond'; this.matSecondPlain.name = 'wp5.shadowSecondPlain';
    this.main = f.make('shadow', this.matStencil);
    this.second = f.make('shadow', this.matStencil);
    for (const r of [this.main, this.second]) {
      r.mesh.renderOrder = RENDER_ORDER.planarShadow;
      r.root.matrixAutoUpdate = false;
      r.root.visible = false;
      ctx.scene.add(r.root);
    }
    this.blobMat = ctx.mat.basic({ color: 0x0b0f12, transparent: true, opacity: 0.34, map: radialTexture() });
    this.blobMat.depthWrite = false;
    const g = new THREE.PlaneGeometry(0.62, 1.05);
    g.rotateX(-Math.PI / 2);
    this.blob = new THREE.Mesh(g, this.blobMat);
    this.blob.renderOrder = RENDER_ORDER.planarShadow;
    this.blob.visible = false;
    this.blob.frustumCulled = false;
    ctx.scene.add(this.blob);
    this.dirTo.copy(this.dir); this.dirFrom.copy(this.dir);
  }

  /** shadow cue。 */
  setMode(mode: ShadowMode, seconds: number | undefined, t: number): void {
    this.mode = mode; this.modeT0 = t;
    this.modeUntil = seconds && seconds > 0 ? t + seconds : Infinity;
  }

  onSegment(seg: CompiledSegment): void { this.aim(planarDirOf(seg.def.atmosphere), 1.5); }
  onEvent(e: GameEvent): void {
    if (e.type === 'cue' && e.data.body.type === 'atmosphere') this.aim(planarDirOf(e.data.body.id), e.data.body.seconds);
    if (e.type === 'retry' || e.type === 'chapter:start') { this.mode = 'normal'; this.modeUntil = Infinity; }
  }
  onReset(): void { this.mode = 'normal'; this.modeUntil = Infinity; }

  private aim(d: readonly [number, number, number], seconds: number): void {
    this.dirFrom.copy(this.dir);
    this.dirTo.set(d[0], d[1], d[2]).normalize();
    if (this.dirTo.y > -0.05) this.dirTo.y = -0.05;
    this.dirK = 0; this.dirDur = Math.max(0.001, seconds);
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const t = lerp(prev.t, next.t, next.segIndex === prev.segIndex ? alpha : 1);
    let sdt = t - this.lastT;
    if (!(sdt >= 0) || sdt > 60) sdt = 0;
    this.lastT = t;
    void dt;
    if (t > this.modeUntil) { this.mode = 'normal'; this.modeUntil = Infinity; }
    if (this.dirK < 1) {
      this.dirK = clamp(this.dirK + sdt / this.dirDur, 0, 1);
      this.dir.lerpVectors(this.dirFrom, this.dirTo, this.dirK).normalize();
    }
    // lead 集成（WP2 的数据约定）：5-3 只在 @30 发一次 shadow reversed；追随者是 pressure 且 HUD 为 shadow（@44 起）时，
    // 反向的影子离开你、在身后按 follower.distance 追来（同 chase）。按快照判断，所以从段中检查点重来后也照样在。
    const shadowFollower = next.segKind === 'run' && next.follower.mode === 'pressure' && next.follower.hud === 'shadow';
    const mode = WP5.poseTest === 'shadowThreeHands' ? 'threeHands'
      : shadowFollower && (this.mode === 'normal' || this.mode === 'reversed') ? 'chase' : this.mode;
    const q = this.ctx.quality.planarShadow;
    const still = next.segKind === 'still';
    // 事件光线：影子事件期间，以及 STILL_SHADOW 的整个静场（2-9：影子从一开始就趴在地上）
    const stillShadow = still ? STILL_SHADOW[next.still?.set ?? ''] : undefined;
    const event = (mode !== 'normal' && mode !== 'blob') || (!!stillShadow && mode !== 'blob');
    const planar = WP5.playerVisible && mode !== 'blob' && (event || (q !== 'events' && !still));
    const blob = WP5.playerVisible && !planar && !still;
    const stencil = this.ctx.stencil && !WP5.forceNoStencil;
    this.state.planar = planar; this.state.blob = blob; this.state.stencil = stencil;
    const mat = stencil ? this.matStencil : this.matPlain;
    this.eventK = WP5.poseTest ? (event ? 1 : 0) : clamp(this.eventK + (event ? 1 : -1) * sdt / SHADOW_EVENT.blendSec, 0, 1);
    // 跳变（> 0.25 s）或换段进了静场：直接到位（静场开头不要看见影子从短拉长）
    if (sdt > 0.25 || (still && next.segIndex !== this.segIdx)) this.eventK = event ? 1 : 0;
    this.segIdx = next.segIndex;
    const L = readableLight(this.dir, _L);
    // —— 主影子 ——
    this.main.root.visible = planar;
    if (planar) {
      const pose = this.shadowPose(mode, next, t);
      this.main.apply(pose);
      if (still) this.main.root.matrix.copy(WP5.stillAnchor); else this.main.root.matrix.identity();
      this.main.root.matrixWorldNeedsUpdate = true;
      const h = (still ? WP5.playerRoot.y : lerp(prev.player.floorY, next.player.floorY, alpha)) + 0.004;
      if (this.eventK > 0) {
        // 事件光线：前右方，按姿势算水平 / 竖直比，影子的尖落在根前右方约 2.5 m
        const hd = eventHeading(this.dir, _h);
        // 趴下的影子（4-3）本身就躺在地上，靠拉长（LIES_DOWN）伸到前右方，光线用最小的比例
        const r = mode === 'long' ? SHADOW_EVENT.longRatio
          : mode === 'liesDown' ? SHADOW_EVENT.liesDownRatioMin
          : this.tipRatio(hd, still, h - 0.004, stillShadow?.tip ?? SHADOW_EVENT.tip, stillShadow?.ratioMin);
        lightFrom(hd.x, hd.y, r, _E);
        L.lerp(_E, easeInOutSine(this.eventK)).normalize();
        this.state.ratio = r;
      } else this.state.ratio = Math.hypot(L.x, L.z) / Math.max(1e-6, -L.y);
      this.state.eventK = this.eventK;
      this.light.copy(L);
      shadowMatrix(L, h, this.main.mesh.matrixWorld);
      // 趴下的影子：以你的脚为中心沿光线拉长（先拉长、再投影）
      const k = mode === 'liesDown' ? lerp(1, this.lieStretch, easeInOutSine(this.eventK)) : 1;
      this.state.stretch = k;
      if (k > 1 + 1e-6) {
        const hd = eventHeading(this.dir, _h);
        this.main.mesh.matrixWorld.multiply(stretchMatrix(WP5.playerRoot.x, WP5.playerRoot.z, hd.x, hd.y, k, _S));
      }
      if (this.main.mesh.material !== mat) this.main.mesh.material = mat;
    }
    // —— 第二个影子（5-3 chase）：身后按 follower.distance 追来；不透明度 0.5，头歪着一点；
    //    用陡一些的光投在它自己脚下，不和你的影子叠在一起（你的影子投向前右方）——
    const chase = planar && mode === 'chase' && !still;
    this.second.root.visible = chase;
    this.state.second = chase;
    if (chase) {
      const N = next.player;
      const dist = next.follower.distance > 0 ? next.follower.distance : 2;
      const I = this.crawl;
      I.s = N.s - dist; I.x = N.x + 0.3; I.floorY = N.floorY; I.stride = N.stride; I.cadence = N.cadence || 5;
      I.beat = N.beat * 1.06 + (t - this.modeT0) * 0.35; I.laneTarget = N.laneTarget + 0.3 / 1.1; I.speed = N.speed;
      const b = this.b;
      crawlPose(I, b);
      b.addLocal('neck', 0, 0.35, 0.25); b.addLocal('head', 0.2, 0.3, 0.3);
      b.fkAll(BONE_INDEX.head);
      copyPose(this.pose2, b.finish());
      this.second.apply(this.pose2);
      this.second.root.matrix.identity(); this.second.root.matrixWorldNeedsUpdate = true;
      const hd = eventHeading(this.dir, _h);
      shadowMatrix(lightFrom(hd.x, hd.y, 0.8, _L2), N.floorY + 0.004, this.second.mesh.matrixWorld);
      const m2 = stencil ? this.matSecond : this.matSecondPlain;
      if (this.second.mesh.material !== m2) this.second.mesh.material = m2;
    }
    // —— 暗斑（低画质的平时状态）——
    this.blob.visible = blob;
    if (blob) {
      const N = next.player, Pp = prev.player;
      const x = lerp(Pp.x, N.x, alpha), s = lerp(Pp.s, N.s, alpha), fy = lerp(Pp.floorY, N.floorY, alpha), y = lerp(Pp.y, N.y, alpha);
      const k = (0.28 + y) / -Math.min(-0.05, L.y);
      this.blob.position.set(x + L.x * k, fy + 0.004, -s + L.z * k - 0.05);
      const sc = 1 / (1 + y * 1.5);
      this.blob.scale.set(sc, 1, sc);
      this.blobMat.opacity = 0.34 * sc;
    }
  }

  /**
   * 事件光线的水平 / 竖直比：影子的尖（各关节投影里沿 hd 最远的那个）落在根前方 SHADOW_EVENT.tip 米处。
   * 姿势刚由 shadowPose 写进 this.b（关节位置在角色空间里，静场里再乘锚点）。
   */
  private tipRatio(hd: THREE.Vector2, still: boolean, ground: number, tip: number, min: number = SHADOW_EVENT.ratioMin): number {
    const b = this.b;
    // 影子的尖 = 各关节投影里最远的那个：只要有一个关节投到 tip 就够了，取各关节所需比例的最小值
    let need = Infinity;
    // 从主角的根量（不是影子姿势自己的根：趴下 / 反向的影子把根挪开了）
    const rx = WP5.playerRoot.x, rz = WP5.playerRoot.z;
    for (const j of TIP_JOINTS) {
      const i = BONE_INDEX[j];
      b.toWorld(b.wp[i] as THREE.Vector3, _v);
      if (still) _v.applyMatrix4(WP5.stillAnchor);
      const f = (_v.x - rx) * hd.x + (_v.z - rz) * hd.y, hgt = _v.y - ground;
      if (hgt < 0.05) continue;
      need = Math.min(need, (tip - f) / hgt);
    }
    return clamp(Number.isFinite(need) ? need : SHADOW_EVENT.ratioMax, min, SHADOW_EVENT.ratioMax);
  }

  /** 按模式生成影子的姿势。 */
  private shadowPose(mode: ShadowMode, next: SimSnapshot, t: number): Pose {
    const b = this.b;
    const src = WP5.playerPose;
    b.load(src);
    const u = t - this.modeT0;
    switch (mode) {
      case 'jellyfish': {
        // 「像一只展开四肢的水母」：身体压低，四肢向外摊开
        const I = this.crawl, N = next.player;
        I.s = N.s; I.x = N.x; I.floorY = N.floorY; I.beat = N.beat; I.stride = N.stride; I.cadence = N.cadence || 5; I.duck = 1; I.laneTarget = N.laneTarget; I.speed = N.speed;
        crawlPose(I, b);
        I.duck = 0;
        for (const side of ['L', 'R'] as const) {
          const sx = side === 'L' ? -1 : 1;
          b.toWorld(_v.set(sx * 0.74, 0, -0.62), _w); _w.y = N.floorY + 0.03;
          armTo(b, side, _w, 1.4);
          setHand(b, side, sx * -35 * DEG, 0, 0, 0, 0);
          _d.set(sx * 0.8, -0.15, 0.6).normalize();
          b.aim(`thigh${side}`, DOWN, FWD, _d, DOWN);
          _d.set(sx * 0.9, 0, 0.45).normalize();
          b.aim(`shin${side}`, DOWN, FWD, _d, DOWN);
        }
        b.fkAll();
        return b.finish();
      }
      case 'threeHands': {
        // 从胸口伸出、向外侧指向身后（伸出身体的轮廓，投影才不会埋在身体的影子里）
        _d.set(0.8, 0.2, 0.56).normalize();
        applyThirdHand(b, 'point', WP5.poseTest ? 1 : clamp(u / 1.2, 0, 1), u, { dir: _d });
        b.fkAll();
        return b.finish();
      }
      case 'pointBack': {
        // 2-9：指向黑板（POINT_BACK 的注释）
        const D = POINT_BACK.dir;
        _d.set(D[0], D[1], D[2]).normalize();
        applyThirdHand(b, 'point', WP5.poseTest ? 1 : clamp(u / POINT_BACK.grow, 0, 1), u, { dir: _d });
        b.fkAll();
        return b.finish();
      }
      case 'pointMirror': {
        _d.set(-0.12, 0.3, -1).normalize();
        applyThirdHand(b, 'point', clamp(u / 1.2, 0, 1), u, { dir: _d });
        b.fkAll();
        return b.finish();
      }
      case 'liesDown': {
        // 你站着，影子趴下去，双手向前伸（4-3「它选择了另一个方向」）：它沿着前右方的光线趴在地上，脚在你脚边，手伸向前右方。
        // 修复轮 U5 第二轮：根不再放在 2.3 m 外；脚放在你脚前 LIES_DOWN.feetGap 米，再在 frame() 里沿光线拉长（lieStretch）
        const I = this.crawl, N = next.player;
        const x = N.x + (N.stand?.x ?? 0), rz = -N.s;
        const hd = eventHeading(this.dir, _h);
        const hx = hd.x, hz = hd.y;
        const yaw = Math.atan2(-hx, -hz);                     // 角色的前方（−z）转到 hd
        const along = (j: number): number => { b.toWorld(b.wp[j] as THREE.Vector3, _v); return (_v.x - x) * hx + (_v.z - rz) * hz; };
        const lie = (back: number): Pose => {
          I.s = N.s - hz * back; I.x = x + hx * back; I.floorY = N.floorY; I.beat = 0.2; I.stride = 1; I.duck = 0.8; I.laneTarget = I.x / 1.1; I.speed = 0;
          crawlPose(I, b);
          I.duck = 0;
          const p = b.finish();
          p.root[3] = yaw;
          b.load(p);
          for (const side of ['L', 'R'] as const) {
            b.toWorld(_v.set(side === 'L' ? -0.2 : 0.2, 0, -0.95), _w); _w.y = N.floorY + 0.03;
            armTo(b, side, _w, 0.6);
          }
          b.fkAll();
          return b.finish();
        };
        lie(0);
        const feet = Math.min(along(BONE_INDEX.footL), along(BONE_INDEX.footR));
        const out = lie(LIES_DOWN.feetGap - feet);
        let tip = 0;
        for (const j of TIP_JOINTS) if (j !== 'arm3Hand') tip = Math.max(tip, along(BONE_INDEX[j]));
        this.lieStretch = clamp(SHADOW_EVENT.liesDownTip / Math.max(0.3, tip), 1, LIES_DOWN.maxStretch);
        return out;
      }
      case 'reversed': {
        // 头朝反方向（小区门口）
        const r = src.root;
        const out = copyPose(this.pose, src);
        out.root[3] = (r[3] as number) + Math.PI;
        out.root[2] = (r[2] as number) - 0.35;
        b.load(out);                                  // tipRatio 按构建器里的姿势量关节
        return out;
      }
      default: return copyPose(this.pose, src);
    }
  }
}
