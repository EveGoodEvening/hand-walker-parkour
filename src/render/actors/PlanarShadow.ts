// src/render/actors/PlanarShadow.ts —— 平面影子（DESIGN.md §3「影子与本体不一致」、§5.8）。WP5。
// 影子是独立骨架的平面投影：投影矩阵作为影子 mesh 的 matrixWorld（matrixAutoUpdate = false、frustumCulled = false），
// DetachedBindMode、bindMatrix = I；Basic #0B0F12 不透明度 0.38；模板位 0x7F「Increment + Equal 0」，重叠处只压暗一次
// （和 three 的 ShadowMesh 同一做法）。没有模板时关掉模板（接受重叠处发深）。
// 光线方向取氛围预设的 planarDir（缺省让影子落在前右方，追尾镜头随时看得到）；atmosphere cue 时按秒插值。
// 低画质（planarShadow = 'events'）：平时只画圆形暗斑，只在影子异常事件期间换成平面投影。
// 模式（ShadowMode）：normal、jellyfish（展开四肢的水母，1-5）、threeHands / pointBack（胸口伸出的手指向身后，2-9）、
// pointMirror（指向走廊尽头的镜子，2-10）、long（拉长，4-1）、liesDown（你站着，它趴下、双手前伸，4-3）、
// reversed（头朝反方向，5-3）、chase（第二个影子在身后按稳度的距离爬，比你快一点，5-3）、blob（只画暗斑）。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { RENDER_ORDER, STENCIL } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { FALLBACK_ATMOSPHERES } from '../../core/fallbacks';
import { clamp, DEG, lerp } from '../../core/math';
import { getAtmosphere } from '../../core/registry';
import { copyPose, createPose, type Pose } from '../../core/rig';
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

const _L = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, -1);

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
  private readonly dirFrom = new THREE.Vector3();
  private readonly dirTo = new THREE.Vector3();
  private dirK = 1; private dirDur = 1.5;
  private lastT = 0;
  private readonly b = new PoseBuilder();
  private readonly pose = createPose();
  private readonly pose2 = createPose();
  private readonly crawl: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 4.8, speed: 4.8, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };
  /** 调试：本帧是否画了平面投影 / 暗斑。 */
  state = { planar: false, blob: false, second: false, stencil: true };

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    const f = ctx.rig as unknown as ActorRigFactory;
    const mk = (stencil: boolean) => {
      const m = ctx.mat.basic({ color: 0x0b0f12, transparent: true, opacity: 0.38 });
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
    const mode = WP5.poseTest === 'shadowThreeHands' ? 'threeHands' : this.mode;
    const event = mode !== 'normal' && mode !== 'blob';
    const q = this.ctx.quality.planarShadow;
    const still = next.segKind === 'still';
    const planar = WP5.playerVisible && mode !== 'blob' && (event || (q !== 'events' && !still));
    const blob = WP5.playerVisible && !planar && !still;
    const stencil = this.ctx.stencil && !WP5.forceNoStencil;
    this.state.planar = planar; this.state.blob = blob; this.state.stencil = stencil;
    const mat = stencil ? this.matStencil : this.matPlain;
    const L = readableLight(this.dir, _L);
    if (mode === 'long') { L.y *= 0.45; L.normalize(); }
    // —— 主影子 ——
    this.main.root.visible = planar;
    if (planar) {
      const pose = this.shadowPose(mode, next, t);
      this.main.apply(pose);
      if (still) this.main.root.matrix.copy(WP5.stillAnchor); else this.main.root.matrix.identity();
      this.main.root.matrixWorldNeedsUpdate = true;
      const h = (still ? WP5.playerRoot.y : lerp(prev.player.floorY, next.player.floorY, alpha)) + 0.004;
      shadowMatrix(L, h, this.main.mesh.matrixWorld);
      if (this.main.mesh.material !== mat) this.main.mesh.material = mat;
    }
    // —— 第二个影子（5-3 chase）——
    const chase = planar && mode === 'chase' && !still;
    this.second.root.visible = chase;
    this.state.second = chase;
    if (chase) {
      const N = next.player;
      const dist = next.follower.distance > 0 ? next.follower.distance : 2;
      const I = this.crawl;
      I.s = N.s - dist; I.x = N.x; I.floorY = N.floorY; I.stride = N.stride; I.cadence = N.cadence || 5;
      I.beat = N.beat * 1.06 + (t - this.modeT0) * 0.35; I.laneTarget = N.laneTarget; I.speed = N.speed;
      copyPose(this.pose2, crawlPose(I, this.b));
      this.second.apply(this.pose2);
      this.second.root.matrix.identity(); this.second.root.matrixWorldNeedsUpdate = true;
      shadowMatrix(L, N.floorY + 0.004, this.second.mesh.matrixWorld);
      if (this.second.mesh.material !== mat) this.second.mesh.material = mat;
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
          b.toWorld(_v.set(sx * 0.62, 0, -0.55), _w); _w.y = N.floorY + 0.03;
          armTo(b, side, _w, 1.4);
          setHand(b, side, sx * -35 * DEG, 0, 0, 0, 0);
          _d.set(sx * 0.7, -0.2, 0.7).normalize();
          b.aim(`thigh${side}`, DOWN, FWD, _d, DOWN);
          _d.set(sx * 0.8, 0, 0.6).normalize();
          b.aim(`shin${side}`, DOWN, FWD, _d, DOWN);
        }
        b.fkAll();
        return b.finish();
      }
      case 'threeHands': case 'pointBack': {
        // 从胸口伸出、越过身体指向身后（向外上方抬起，投影才不会埋在身体的影子里）
        _d.set(0.55, 0.3, 0.78).normalize();
        applyThirdHand(b, 'point', clamp(u / 1.2, 0, 1), u, { dir: _d });
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
        // 你站着，影子趴下去，双手向前伸
        const I = this.crawl, N = next.player;
        const x = N.x + (N.stand?.x ?? 0);
        I.s = N.s; I.x = x; I.floorY = N.floorY; I.beat = 0.2; I.stride = 1; I.duck = 0.8; I.laneTarget = x / 1.1; I.speed = 0;
        crawlPose(I, b);
        I.duck = 0;
        for (const side of ['L', 'R'] as const) {
          b.toWorld(_v.set(side === 'L' ? -0.2 : 0.2, 0, -0.95), _w); _w.y = N.floorY + 0.03;
          armTo(b, side, _w, 0.6);
        }
        b.fkAll();
        return b.finish();
      }
      case 'reversed': {
        // 头朝反方向（小区门口）
        const r = src.root;
        const out = copyPose(this.pose, src);
        out.root[3] = (r[3] as number) + Math.PI;
        out.root[2] = (r[2] as number) - 0.35;
        return out;
      }
      default: return copyPose(this.pose, src);
    }
  }
}
