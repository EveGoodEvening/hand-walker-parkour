// src/render/actors/surfaces.ts —— 反光面（DESIGN.md §5.8）：墙镜 / 窗 / 端墙镜的「镜中房间 + 玻璃叠加层」，水洼的模板门户。WP5。
// 墙镜和窗不用模板：kit 按 openings 在墙上开洞，洞后面放一个暗色的镜中房间（深 3.75 m，比 kit 自己的房间内缩 1–3 cm，
// 避免 z-fighting），替身就站在房间里（Doubles 负责）。窗户的房间里画窗外景（傍晚 / 操场 / 夜街）。
// 中高画质（mirrorChunkCopy）在镜中房间的背墙上画出「镜中走廊」：墙裙、灯带（同一个几何体，不加 draw call）。
// 水洼：地面先画且不写深度（WP3）；遮罩写模板位 0x80（renderOrder −19）；替身只在 0x80 内显示（−18，深度照常测试）；
// 水面叠加层（透明 −17）。没有模板缓冲时（或强制关闭）：水洼只画叠加层，外加一个模糊的剪影贴花（替身在水洼上方时）。
// 活动数量按画质：镜面 mirrorsActive、水洼 puddlesActive；只显示离玩家最近、在前方视野里的那几个。读章时建好，游戏中不建几何体。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { CORRIDOR_WIDTH, RENDER_ORDER, STENCIL } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { GeoBuilder, mixHex } from '../../core/geo';
import { clamp, lerp } from '../../core/math';
import type { SimSnapshot } from '../../core/types';
import type { CompiledChapter, CompiledSurface } from '../../levels/schema';
import { WP5 } from './shared';

const HALF = CORRIDOR_WIDTH / 2;     // 1.8
const ROOM = 3.75;
const H = 2.97;
/** 端墙镜的半宽（与 CORE 占位 kit 的 0.95 一致；kit 在端墙上开同样宽的洞）。 */
export const END_HALF_W = 0.95;

export type SurfaceKind = 'side' | 'end' | 'floor';

export interface SurfaceView {
  id: string;
  src: CompiledSurface;
  kind: SurfaceKind;
  /** 侧墙：−1 左、+1 右。 */
  sign: -1 | 1;
  /** 墙面 x（侧墙）、端墙里程（end）、地面 y（floor）。 */
  planeX: number; planeS: number; floorY: number;
  s0: number; s1: number; y0: number; y1: number;
  /** 世界坐标里的反射矩阵（以镜面为对称面）。 */
  reflect: THREE.Matrix4;
  /** 水洼的中心与半径（floor）。 */
  cx: number; cs: number; rx: number; rs: number;
  group: THREE.Group;
  room?: THREE.Mesh; glass?: THREE.Mesh; mask?: THREE.Mesh; overlay?: THREE.Mesh; blob?: THREE.Mesh;
  roomMat?: THREE.MeshBasicMaterial;
  active: boolean;
  /** 窗户记忆闪回时背景压暗（0..1）。 */
  memory: number;
}

/** 以平面 x = x0 为对称面的反射矩阵。 */
export function reflectX(x0: number, out = new THREE.Matrix4()): THREE.Matrix4 { return out.set(-1, 0, 0, 2 * x0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); }
/** 以平面 z = z0 为对称面。 */
export function reflectZ(z0: number, out = new THREE.Matrix4()): THREE.Matrix4 { return out.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 2 * z0, 0, 0, 0, 1); }
/** 以平面 y = y0 为对称面。 */
export function reflectY(y0: number, out = new THREE.Matrix4()): THREE.Matrix4 { return out.set(1, 0, 0, 0, 0, -1, 0, 2 * y0, 0, 0, 1, 0, 0, 0, 0, 1); }
/** 以任意平面（n·p + d = 0，n 单位向量）为对称面。 */
export function reflectPlane(p: THREE.Plane, out = new THREE.Matrix4()): THREE.Matrix4 {
  const { x: a, y: b, z: c } = p.normal; const d = p.constant;
  return out.set(1 - 2 * a * a, -2 * a * b, -2 * a * c, -2 * a * d, -2 * a * b, 1 - 2 * b * b, -2 * b * c, -2 * b * d,
    -2 * a * c, -2 * b * c, 1 - 2 * c * c, -2 * c * d, 0, 0, 0, 1);
}

/** 背景配色：镜子（暗）/ 各种窗外景。top、bottom 为背墙上下渐变，floor 为地面。 */
const BACKDROPS: Record<string, { top: number; bottom: number; floor: number; ceil: number; band?: number }> = {
  darkRoom: { top: 0x1c262c, bottom: 0x121a1f, floor: 0x161f24, ceil: 0x10171b },
  mirrorChunk: { top: 0x3a474d, bottom: 0x24302f, floor: 0x3d4546, ceil: 0x2c3538 },
  evening: { top: 0xb9c4cb, bottom: 0x7d8a92, floor: 0x5d676c, ceil: 0xc4ced4, band: 0x4d585e },
  playground: { top: 0xdce6ec, bottom: 0xa9b8c2, floor: 0x6f7b72, ceil: 0xdce6ec, band: 0x5e6b5a },
  nightStreet: { top: 0x121a20, bottom: 0x0b1014, floor: 0x1c2227, ceil: 0x0b1014, band: 0x1e272d },
};

export class ReflectSurfaces implements ViewSystem {
  readonly id = 'wp5.surfaces';
  readonly owner = 'WP5' as const;
  readonly order = 40;
  private ctx!: ViewContext;
  readonly views = new Map<string, SurfaceView>();
  private list: SurfaceView[] = [];
  private glassMat!: THREE.MeshBasicMaterial;
  private windowGlassMat!: THREE.MeshBasicMaterial;
  private chipMat!: THREE.MeshBasicMaterial;
  private maskMat!: THREE.MeshBasicMaterial;
  private overlayMat!: THREE.MeshBasicMaterial;
  private overlayNoStencilMat!: THREE.MeshBasicMaterial;
  private blobMat!: THREE.MeshBasicMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  /** 调试水洼（__game.ext.wp5Puddle）：读章时预建一个，放在需要的位置。 */
  debugPuddle: SurfaceView | null = null;

  get stencil(): boolean { return this.ctx.stencil && !WP5.forceNoStencil; }

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    const glassMap = ctx.tex.get('dirtyGlass');
    this.glassMat = ctx.mat.basic({ color: 0x1a2a33, transparent: true, opacity: 0.25, map: glassMap });
    this.windowGlassMat = ctx.mat.basic({ color: 0x9fb4c0, transparent: true, opacity: 0.12, map: glassMap });
    this.chipMat = ctx.mat.basic({ color: 0xc7d0d3, transparent: true, opacity: 0.55, map: ctx.tex.get('crackLine') });
    for (const m of [this.glassMat, this.windowGlassMat, this.chipMat]) { m.depthWrite = false; m.side = THREE.DoubleSide; }
    const mask = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    mask.stencilWrite = true; mask.stencilRef = STENCIL.puddleBit; mask.stencilWriteMask = STENCIL.puddleBit;
    mask.stencilFunc = THREE.AlwaysStencilFunc; mask.stencilZPass = THREE.ReplaceStencilOp;
    mask.stencilFail = THREE.KeepStencilOp; mask.stencilZFail = THREE.KeepStencilOp;
    this.maskMat = mask;
    const ov = ctx.mat.basic({ color: 0x22323b, transparent: true, opacity: 0.32 });
    ov.depthWrite = false;
    ov.stencilWrite = true; ov.stencilRef = STENCIL.puddleBit; ov.stencilFuncMask = STENCIL.puddleBit; ov.stencilWriteMask = 0;
    ov.stencilFunc = THREE.EqualStencilFunc; ov.stencilZPass = THREE.KeepStencilOp;
    this.overlayMat = ov;
    const ovn = ctx.mat.basic({ color: 0x22323b, transparent: true, opacity: 0.45 });
    ovn.depthWrite = false;
    this.overlayNoStencilMat = ovn;
    this.blobMat = ctx.mat.basic({ color: 0x0b1014, transparent: true, opacity: 0.55, map: radialTexture() });
    this.blobMat.depthWrite = false;
  }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    for (const v of this.list) { this.ctx.scene.remove(v.group); v.roomMat?.dispose(); }
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.views.clear(); this.list = [];
    for (const seg of ch.segments) {
      for (const su of seg.surfaces) {
        const v = this.build(su, seg.floorY(su.s0));
        if (v) { this.views.set(v.id, v); this.list.push(v); }
      }
    }
    // 调试水洼：1.1 m × 1.6 m，中道（像素检查用；平时不显示）
    const dbg: CompiledSurface = { id: '__wp5DebugPuddle', kind: 'puddle', side: 'floor', from: 0, to: 0, lane: 0, s0: 0, s1: 1.6, plane: [0, 1, 0, 0] };
    this.debugPuddle = this.build(dbg, 0);
    if (this.debugPuddle) { this.views.set(dbg.id, this.debugPuddle); this.list.push(this.debugPuddle); }
  }

  /** 把调试水洼挪到 (x, s) 处（地面 y）。 */
  placeDebugPuddle(x: number, s: number, floorY: number): SurfaceView | null {
    const v = this.debugPuddle;
    if (!v) return null;
    const len = v.s1 - v.s0;
    v.s0 = s - len / 2; v.s1 = s + len / 2; v.cx = x; v.cs = s; v.floorY = floorY;
    v.group.position.set(x, floorY, -s);
    reflectY(floorY, v.reflect);
    v.src = { ...v.src, s0: v.s0, s1: v.s1 };
    return v;
  }

  private build(su: CompiledSurface, floorY: number): SurfaceView | null {
    const group = new THREE.Group();
    group.name = `surface:${su.id}`;
    group.visible = false;
    const base: Omit<SurfaceView, 'kind' | 'sign' | 'planeX' | 'planeS' | 'reflect'> = {
      id: su.id, src: su, floorY, s0: su.s0, s1: su.s1, y0: su.y?.[0] ?? 0.2, y1: su.y?.[1] ?? 1.8,
      cx: 0, cs: 0, rx: 0, rs: 0, group, active: false, memory: 0,
    };
    const hq = this.ctx.quality.mirrorChunkCopy;
    if ((su.kind === 'mirror' || su.kind === 'window' || su.kind === 'carMirror') && (su.side === 'L' || su.side === 'R')) {
      const sign = su.side === 'L' ? -1 : 1;
      const xw = sign * HALF;
      const v: SurfaceView = { ...base, kind: 'side', sign, planeX: xw, planeS: 0, reflect: reflectX(xw) };
      const bd = BACKDROPS[su.backdrop ?? (su.kind === 'window' ? 'evening' : 'darkRoom')] ?? (BACKDROPS.darkRoom as (typeof BACKDROPS)['darkRoom']);
      const g = new GeoBuilder();
      const z0 = -(su.s0 + 0.02), z1 = -(su.s1 - 0.02);
      const xi = sign * (HALF + 0.012), xb = sign * (HALF + ROOM);
      const [xa, xc] = sign < 0 ? [xb, xi] : [xi, xb];
      // 背墙：渐变；镜子在中高画质画出镜中走廊的墙裙与腰线
      const bands: Array<[number, number, number, number]> = [];
      if (su.kind !== 'window' && hq && (su.backdrop ?? 'darkRoom') === 'darkRoom') {
        bands.push([0, 1.1, 0x1b2a29, 0x1b2a29], [1.1, 1.15, 0x24302f, 0x24302f], [1.15, H, 0x202a2f, 0x2a353b]);
      } else if (bd.band !== undefined) {
        bands.push([0, 0.9, bd.floor, bd.band], [0.9, 1.25, bd.band, bd.bottom], [1.25, H, bd.bottom, bd.top]);
      } else bands.push([0, H, bd.bottom, bd.top]);
      for (const [ya, yb, ca, cb] of bands) {
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          const y0 = lerp(ya, yb, i / steps), y1 = lerp(ya, yb, (i + 1) / steps);
          const c = mixHex(ca, cb, (i + 0.5) / steps);
          if (sign < 0) g.quad([xb, y0, z0], [xb, y0, z1], [xb, y1, z1], [xb, y1, z0], c);
          else g.quad([xb, y0, z1], [xb, y0, z0], [xb, y1, z0], [xb, y1, z1], c);
        }
      }
      // 地面、天花板、两端
      g.quad([xa, 0.004, z0], [xc, 0.004, z0], [xc, 0.004, z1], [xa, 0.004, z1], bd.floor);
      g.quad([xa, H, z1], [xc, H, z1], [xc, H, z0], [xa, H, z0], bd.ceil);
      g.quad([xa, 0, z1], [xc, 0, z1], [xc, H, z1], [xa, H, z1], mixHex(bd.floor, bd.bottom, 0.5));
      g.quad([xc, 0, z0], [xa, 0, z0], [xa, H, z0], [xc, H, z0], mixHex(bd.floor, bd.bottom, 0.5));
      if (hq && su.kind !== 'window') {
        // 镜中走廊的灯带（每 2 m 一盏，淡）
        for (let s = su.s0 + 1; s < su.s1 - 0.5; s += 2) {
          const xm = sign * (HALF + ROOM * 0.55);
          g.box([xm, H - 0.02, -s], [0.12, 0.02, 1.0], 0x6d7a80, { faces: '-y' });
        }
      }
      const geo = g.build({ chalk: true });
      this.geos.push(geo);
      const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
      const room = new THREE.Mesh(geo, roomMat);
      room.renderOrder = RENDER_ORDER.opaque;
      room.matrixAutoUpdate = false; room.updateMatrix();
      group.add(room);
      // 玻璃叠加层
      const gg = new THREE.PlaneGeometry(su.s1 - su.s0, v.y1 - v.y0);
      this.geos.push(gg);
      const glass = new THREE.Mesh(gg, su.kind === 'window' ? this.windowGlassMat : this.glassMat);
      glass.position.set(sign * (HALF - 0.004), floorY + (v.y0 + v.y1) / 2, -(su.s0 + su.s1) / 2);
      glass.rotation.y = sign < 0 ? Math.PI / 2 : -Math.PI / 2;
      glass.renderOrder = RENDER_ORDER.glass;
      glass.updateMatrix(); glass.matrixAutoUpdate = false;
      group.add(glass);
      room.position.y = floorY; room.updateMatrix();
      if (su.chipped) group.add(this.chip(sign * (HALF - 0.006), floorY + v.y1 - 0.25, -(su.s1 - 0.3), sign < 0 ? Math.PI / 2 : -Math.PI / 2));
      v.room = room; v.glass = glass; v.roomMat = roomMat;
      this.ctx.scene.add(group);
      return v;
    }
    if ((su.kind === 'endMirror' || su.kind === 'mirror') && su.side === 'end') {
      const ze = -su.s0;
      const v: SurfaceView = { ...base, kind: 'end', sign: 1, planeX: 0, planeS: su.s0, s1: su.s0, reflect: reflectZ(ze) };
      const bd = BACKDROPS[su.backdrop ?? 'darkRoom'] ?? (BACKDROPS.darkRoom as (typeof BACKDROPS)['darkRoom']);
      const g = new GeoBuilder();
      const hx = END_HALF_W - 0.02, zi = ze - 0.012, zb = ze - ROOM;
      for (let i = 0; i < 3; i++) {
        const y0 = (H * i) / 3, y1 = (H * (i + 1)) / 3;
        g.quad([-hx, y0, zb], [hx, y0, zb], [hx, y1, zb], [-hx, y1, zb], mixHex(bd.bottom, bd.top, (i + 0.5) / 3));
      }
      if (hq && (su.backdrop ?? 'darkRoom') === 'darkRoom') {
        g.quad([-hx, 0.02, zb + 0.005], [hx, 0.02, zb + 0.005], [hx, 1.1, zb + 0.005], [-hx, 1.1, zb + 0.005], 0x1b2a29);
        g.box([0, H - 0.02, (zi + zb) / 2], [0.12, 0.02, 1.2], 0x6d7a80, { faces: '-y' });
      }
      g.quad([-hx, 0.004, zi], [hx, 0.004, zi], [hx, 0.004, zb], [-hx, 0.004, zb], bd.floor);
      g.quad([-hx, H, zb], [hx, H, zb], [hx, H, zi], [-hx, H, zi], bd.ceil);
      g.quad([-hx, 0, zi], [-hx, 0, zb], [-hx, H, zb], [-hx, H, zi], mixHex(bd.floor, bd.bottom, 0.5));
      g.quad([hx, 0, zb], [hx, 0, zi], [hx, H, zi], [hx, H, zb], mixHex(bd.floor, bd.bottom, 0.5));
      const geo = g.build({ chalk: true });
      this.geos.push(geo);
      const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
      const room = new THREE.Mesh(geo, roomMat);
      room.position.y = floorY; room.updateMatrix(); room.matrixAutoUpdate = false;
      group.add(room);
      const gg = new THREE.PlaneGeometry(2 * END_HALF_W, v.y1 - v.y0);
      this.geos.push(gg);
      const glass = new THREE.Mesh(gg, this.glassMat);
      glass.position.set(0, floorY + (v.y0 + v.y1) / 2, ze + 0.004);
      glass.renderOrder = RENDER_ORDER.glass;
      glass.updateMatrix(); glass.matrixAutoUpdate = false;
      group.add(glass);
      if (su.chipped) group.add(this.chip(END_HALF_W - 0.3, floorY + v.y1 - 0.3, ze + 0.006, 0));
      v.room = room; v.glass = glass; v.roomMat = roomMat;
      this.ctx.scene.add(group);
      return v;
    }
    if (su.kind === 'puddle' && su.side === 'floor') {
      const lane = su.lane ?? 0;
      const cx = lane * 1.1, cs = (su.s0 + su.s1) / 2;
      const rx = 0.5, rs = Math.max(0.5, (su.s1 - su.s0) / 2);
      const v: SurfaceView = { ...base, kind: 'floor', sign: 1, planeX: 0, planeS: 0, reflect: reflectY(floorY), cx, cs, rx, rs };
      // 不规则的椭圆（局部坐标，group 放在水洼中心）
      const g = new GeoBuilder();
      const n = 22;
      const rng = (i: number) => { const s = Math.sin((i + 1) * 12.9898 + cs * 78.233) * 43758.5453; return s - Math.floor(s); };
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 0.86 + 0.14 * rng(i);
        pts.push([Math.cos(a) * rx * r, -Math.sin(a) * rs * r]);
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i] as [number, number], q = pts[(i + 1) % n] as [number, number];
        g.tri([0, 0.003, 0], [p[0], 0.003, p[1]], [q[0], 0.003, q[1]], 0xffffff);
      }
      const geo = g.build({ chalk: true });
      this.geos.push(geo);
      const mask = new THREE.Mesh(geo, this.maskMat);
      mask.renderOrder = RENDER_ORDER.puddleMask;
      const overlay = new THREE.Mesh(geo, this.overlayMat);
      overlay.renderOrder = RENDER_ORDER.puddleOverlay;
      const bgeo = new THREE.PlaneGeometry(0.5, 1.1);
      bgeo.rotateX(-Math.PI / 2);
      this.geos.push(bgeo);
      const blob = new THREE.Mesh(bgeo, this.blobMat);
      blob.position.y = 0.005;
      blob.renderOrder = RENDER_ORDER.puddleOverlay + 1;
      blob.visible = false;
      group.add(mask, overlay, blob);
      group.position.set(cx, floorY, -cs);
      v.mask = mask; v.overlay = overlay; v.blob = blob;
      this.ctx.scene.add(group);
      return v;
    }
    return null;
  }

  private chip(x: number, y: number, z: number, ry: number): THREE.Mesh {
    const gg = new THREE.PlaneGeometry(0.5, 0.4);
    this.geos.push(gg);
    const m = new THREE.Mesh(gg, this.chipMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = RENDER_ORDER.glass + 1;
    return m;
  }

  onEvent(e: GameEvent): void {
    if (e.type === 'retry' || e.type === 'chapter:start') for (const v of this.list) v.memory = 0;
  }

  /** 是否在当前活动集合里（替身只在活动的反光面上显示）。 */
  isActive(id: string): boolean { return this.views.get(id)?.active ?? false; }
  /** 强制激活（替身在上面时，优先于距离排序）。 */
  private wanted = new Set<string>();
  private readonly cand: SurfaceView[] = [];
  want(id: string): void { this.wanted.add(id); }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const s = lerp(prev.player.s, next.player.s, next.segIndex === prev.segIndex ? alpha : 1);
    const run = next.segKind !== 'still';
    const far = this.ctx.quality.chunksAhead * 12 + 6;
    let mirrors = this.ctx.quality.mirrorsActive, puddles = this.ctx.quality.puddlesActive;
    const cand = this.cand;
    cand.length = 0;
    if (run) for (const v of this.list) if (v.s1 > s - 4 && v.s0 < s + far) cand.push(v);
    cand.sort((a, b) => (this.wanted.has(b.id) ? 1 : 0) - (this.wanted.has(a.id) ? 1 : 0) || Math.abs(a.s0 - s) - Math.abs(b.s0 - s));
    const stencil = this.stencil;
    for (const v of this.list) v.active = false;
    for (const v of cand) {
      if (v.kind === 'floor') { if (puddles <= 0) continue; puddles--; } else { if (mirrors <= 0) continue; mirrors--; }
      v.active = true;
    }
    for (const v of this.list) {
      v.group.visible = v.active;
      if (v.kind === 'floor' && v.mask && v.overlay) {
        v.mask.visible = stencil;
        v.overlay.material = stencil ? this.overlayMat : this.overlayNoStencilMat;
      }
      if (v.roomMat) {
        v.memory = Math.max(0, v.memory - dt * 0.8);
        v.roomMat.color.setScalar(1 - 0.35 * clamp(v.memory, 0, 1));
      }
    }
    this.wanted.clear();
  }
}

/** 径向渐变（中心不透明、边缘透明）的小 DataTexture：模糊剪影 / 暗斑用。 */
export function radialTexture(size = 32): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const r = Math.sqrt(u * u + v * v);
    const a = Math.max(0, 1 - r);
    const i = (y * size + x) * 4;
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
