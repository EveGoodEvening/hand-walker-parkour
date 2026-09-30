// src/render/kits/school/shell.ts —— 校园 kit 的公共构件（DESIGN.md §5.9、§5.8，WP3）。不注册任何东西。
// 坐标：chunk 局部坐标（contracts.ts KitChunk）：x 横向，y 相对 floorY(ctx.s0)，z = −(s − ctx.s0)。
// 走廊截面：墙在 x = ±1.8（与 compile.ts 的 HALF_WALL、反光面的平面一致），开口处留洞，洞后是镜中房间（深 3.8 m）。
// 墙面：踢脚线 / 墙裙（贴图集 wainscot，鞋踢痕在 5–15 cm）/ 墙裙上沿 / 灰泥（贴图集 plaster）；顶点色带假 AO。
// 视觉节拍：地面铜条每拍一道（纹理，v = 拍），灯管每 2 拍一盏，楼梯扶手栏杆每拍一根。
import type { LampSpec, Opening } from '../../../core/contracts';
import { CORRIDOR_WIDTH } from '../../../core/constants';
import { clamp, smoothstep } from '../../../core/math';
import type { QualityTier, Rng } from '../../../core/types';
import type { CompiledSurface } from '../../../levels/schema';
import { KitGeo, subRect, type Rect, type V3 } from '../../geom';
import { mixHex } from '../../../core/geo';
import type { HwKitChunkContext, HwKitExt } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import { ATLAS, ATLAS_WHITE_UV, WALL_PERIOD } from '../../textures/school';

export const HW = CORRIDOR_WIDTH / 2;         // 1.8
export const ROOM_DEPTH = 3.8;               // 镜中房间深度（R6）
export const WALL_T = 0.14;                  // 墙厚（开口的窗台、门套）

export interface Env {
  ctx: HwKitChunkContext; hw: HwKitExt | undefined;
  s0: number; s1: number; L: number; stride: number; segS0: number; segS1: number;
  tier: QualityTier; low: boolean; high: boolean; rng: Rng;
  generic: boolean;
  /** 本 chunk 与段首 / 段尾 4 m 区间相交。 */
  head: boolean; tail: boolean;
  /** 章首（前面没有跑段）：段首 chunk 往回多建 back 米，镜头在段首时身后不是空的。 */
  back: number;
  period: number;
  surfaces: readonly CompiledSurface[];
  openings: readonly Opening[];
  z(s: number): number;
  /** 局部地面高度（相对 floorY(s0)）。 */
  fy(s: number): number;
}

export function makeEnv(ctx: HwKitChunkContext): Env {
  const hw = ctx.hw;
  const s0 = ctx.s0, s1 = ctx.s1, stride = ctx.stride > 0 ? ctx.stride : 1;
  const segS0 = ctx.seg.s0, segS1 = ctx.seg.s1;
  const full = hw?.chunkLen ?? Math.max(s1 - s0, 1e-3);
  const period = full / Math.max(1, Math.round(full / WALL_PERIOD));
  const generic = hw?.generic ?? false;
  return {
    ctx, hw, s0, s1, L: s1 - s0, stride, segS0, segS1,
    tier: ctx.quality.tier, low: ctx.quality.tier === 'low', high: ctx.quality.tier === 'high', rng: ctx.rng,
    generic, head: !generic && s0 < segS0 + 4 + 1e-6, tail: !generic && s1 > segS1 - 4 - 1e-6,
    back: !generic && hw && hw.prev === null && s0 <= segS0 + 1e-6 ? 3.6 : 0,
    period,
    surfaces: generic ? [] : ctx.seg.surfaces ?? [],
    openings: generic ? [] : ctx.openings,
    z: (s) => -(s - s0),
    fy: (s) => ctx.floorY(s),
  };
}

/** 本 chunk 内、段内拍号为整数倍 every 的位置（加 offset 拍），返回世界 s。 */
export function beatsIn(e: Env, every: number, offset = 0, pad = 0): number[] {
  const out: number[] = [];
  const b0 = Math.ceil(((e.s0 + pad - e.segS0) / e.stride - offset) / every - 1e-6);
  for (let k = b0; ; k++) {
    const s = e.segS0 + (k * every + offset) * e.stride;
    if (s >= e.s1 - pad - 1e-6) break;
    if (s >= e.s0 + pad - 1e-6) out.push(s);
  }
  return out;
}

/** 本 chunk 内间距 step 米的位置（相对段首对齐，所以通用变体之间连续）。 */
export function stepsIn(e: Env, step: number, offset = 0, pad = 0): number[] {
  const out: number[] = [];
  const k0 = Math.ceil((e.s0 + pad - e.segS0 - offset) / step - 1e-6);
  for (let k = k0; ; k++) {
    const s = e.segS0 + offset + k * step;
    if (s >= e.s1 - pad - 1e-6) break;
    out.push(s);
  }
  return out;
}

export function geos(): { floor: KitGeo; stat: KitGeo; emi: KitGeo } {
  return { floor: new KitGeo(ATLAS_WHITE_UV), stat: new KitGeo(ATLAS_WHITE_UV), emi: new KitGeo(ATLAS_WHITE_UV) };
}

// ——————————————————— 地面 ———————————————————
export interface FloorOpts { x0?: number; x1?: number; color: number; ao?: number; tex?: number; beatV?: boolean }
/**
 * 平地面：一整块（沿 s 不切），靠墙 0.35 m 变暗（假 AO）。
 * uv：u = (x + 0.5) / tex；v = 段内拍号（beatV，缺省；水磨石的铜条每拍一道）或 s / tex（瓷砖）。
 */
export function flatFloor(g: KitGeo, e: Env, o: FloorOpts): void {
  const x0 = o.x0 ?? -HW, x1 = o.x1 ?? HW, ao = o.ao ?? 0.6, t = o.tex ?? 1;
  const za = e.back, zb = -e.L;
  const vOf = (ls: number) => (o.beatV === false ? (ls + (e.s0 - e.segS0)) / t : ls / e.stride);
  const vA = vOf(-e.back), vB = vOf(e.L);
  const xs = [x0, Math.min(x1, x0 + 0.35), Math.max(x0, x1 - 0.35), x1];
  const sh = [ao, 1, 1, ao];
  for (let i = 0; i < 3; i++) {
    const a = xs[i] as number, b = xs[i + 1] as number;
    if (b <= a + 1e-6) continue;
    const ua = (a + 0.5) / t, ub = (b + 0.5) / t;
    const sa = sh[i] as number, sb = sh[i + 1] as number;
    g.quad([a, 0, za], [b, 0, za], [b, 0, zb], [a, 0, zb], o.color,
      [[ua, vA], [ub, vA], [ub, vB], [ua, vB]], [sa, sb, sb, sa]);
  }
}

/** 铜条（视觉节拍，§5.9）：每拍一道 2 cm 宽的黄铜色细条，比地面高 2 mm，放在 static 里（写深度、吃灯光）。 */
export function brassStrips(g: KitGeo, e: Env, color: number = PAL.brass, x0 = -HW, x1 = HW, base: (s: number) => number = () => 0): void {
  for (const s of beatsIn(e, 1, 0, 0)) {
    const z = e.z(s), y = base(s) + 0.002;
    g.quad([x0, y, z + 0.015], [x1, y, z + 0.015], [x1, y, z - 0.015], [x0, y, z - 0.015], color, null, [0.86, 0.86, 0.86, 0.86]);
  }
}

/** 地面上的一块深色覆盖（水痕、积灰）：同样贴水磨石纹理，只是更暗。 */
export function floorPatch(g: KitGeo, e: Env, xc: number, s: number, w: number, l: number, color: number, t = 1, y = 0.002): void {
  const x0 = xc - w / 2, x1 = xc + w / 2, sa = s - l / 2, sb = s + l / 2;
  const za = e.z(sa), zb = e.z(sb);
  const ua = (x0 + 0.5) / t, ub = (x1 + 0.5) / t, va = (sa - e.s0) / e.stride / t, vb = (sb - e.s0) / e.stride / t;
  g.quad([x0, y, za], [x1, y, za], [x1, y, zb], [x0, y, zb], color, [[ua, va], [ub, va], [ub, vb], [ua, vb]]);
}

/**
 * 地面上一块不规则的湿痕 / 污迹：扇形三角形，中心是 color，边缘是 rim（缺省白 = 与地面相同），所以边缘自然过渡。
 * 贴同一张地面纹理（uv 与 flatFloor 一致），比地面高 y。
 */
export function floorBlob(g: KitGeo, e: Env, xc: number, s: number, rx: number, rs: number, color: number, seed: number, rim = 0xffffff, y = 0.002): void {
  const n = 9;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.7 + 0.3 * Math.sin(a * 3 + seed * 12.3) + 0.15 * Math.cos(a * 5 + seed * 4.1);
    pts.push([xc + Math.cos(a) * rx * k, s + Math.sin(a) * rs * k]);
  }
  const uvOf = (x: number, ss: number): [number, number] => [x + 0.5, (ss - e.s0) / e.stride];
  const c: [number, number] = [xc, s];
  for (let i = 0; i < n; i++) {
    const p = pts[i] as [number, number], q = pts[(i + 1) % n] as [number, number];
    const cx = clamp(c[0], -HW, HW), px = clamp(p[0], -HW, HW), qx = clamp(q[0], -HW, HW);
    const cs = clamp(c[1], e.s0, e.s1), ps = clamp(p[1], e.s0, e.s1), qs = clamp(q[1], e.s0, e.s1);
    // 三角形 c → p → q（z = −s，这个顺序的法线朝上）
    g.quad([cx, y, e.z(cs)], [px, y, e.z(ps)], [qx, y, e.z(qs)], [cx, y, e.z(cs)], [color, rim, rim, color],
      [uvOf(cx, cs), uvOf(px, ps), uvOf(qx, qs), uvOf(cx, cs)]);
  }
}

/**
 * 家具下的接触阴影：地面上一块柔边的暗矩形（中心 color，外圈渐变到 rim = 地面顶点色），画进 floor 几何体，贴同一张地面纹理。
 * 让桌椅、柜子、实验台「落」在地上，而不是浮着。uvOf(x, z) 与该 kit 地面的 uv 映射一致。
 */
export function contactShadow(g: KitGeo, xc: number, zc: number, w: number, d: number, uvOf: (x: number, z: number) => [number, number],
  color = 0x9aa2a6, rim = 0xffffff, feather = 0.18, y = 0.0015, zRange: readonly [number, number] | null = null): void {
  // 夹在本 chunk 的 z 范围内（地面不写深度，越界的部分会被下一个 chunk 的地面盖掉，留下一道硬边）
  const lo = zRange ? zRange[0] : -Infinity, hi = zRange ? zRange[1] : Infinity;
  const cz = (z: number) => Math.min(hi, Math.max(lo, z));
  const x0 = xc - w / 2, x1 = xc + w / 2, z0 = cz(zc - d / 2), z1 = cz(zc + d / 2);
  const X0 = x0 - feather, X1 = x1 + feather, Z0 = cz(z0 - feather), Z1 = cz(z1 + feather);
  if (z1 - z0 < 1e-3) return;
  const P = (x: number, z: number): V3 => [x, y, z];
  const U = (x: number, z: number) => uvOf(x, z);
  // 中心（从上往下看逆时针：x 增、z 减）
  g.quad(P(x0, z1), P(x1, z1), P(x1, z0), P(x0, z0), color, [U(x0, z1), U(x1, z1), U(x1, z0), U(x0, z0)]);
  // 四条羽化边
  g.quad(P(X0, Z1), P(X1, Z1), P(x1, z1), P(x0, z1), [rim, rim, color, color], [U(X0, Z1), U(X1, Z1), U(x1, z1), U(x0, z1)]);
  g.quad(P(x0, z0), P(x1, z0), P(X1, Z0), P(X0, Z0), [color, color, rim, rim], [U(x0, z0), U(x1, z0), U(X1, Z0), U(X0, Z0)]);
  g.quad(P(X0, Z1), P(x0, z1), P(x0, z0), P(X0, Z0), [rim, color, color, rim], [U(X0, Z1), U(x0, z1), U(x0, z0), U(X0, Z0)]);
  g.quad(P(x1, z1), P(X1, Z1), P(X1, Z0), P(x1, z0), [color, rim, rim, color], [U(x1, z1), U(X1, Z1), U(X1, Z0), U(x1, z0)]);
}

/** 与 flatFloor 相同的 uv 映射（beatV：v = 段内拍号；否则 v = 米 / tex）。 */
/** 本 chunk 地面的 z 范围（contactShadow 的 zRange）。 */
export function chunkZ(e: Env): [number, number] { return [-e.L, e.back]; }

export function floorUV(e: Env, tex = 1, beatV = true): (x: number, z: number) => [number, number] {
  return (x, z) => [(x + 0.5) / tex, beatV ? -z / e.stride : (-z + (e.s0 - e.segS0)) / tex];
}

// ——————————————————— 墙 ———————————————————
export interface WallStyle {
  height: number;
  baseboard: number; baseboardH: number;
  wainscot: number; wainscotTop: number;
  rim: number;
  wall: number;
  /** 下半截贴瓷砖（厕所）：瓷砖到 tileTop 米高，颜色 tileColor。 */
  tileTop?: number; tileColor?: number;
}
export const CORRIDOR_WALL: WallStyle = {
  height: 3.1, baseboard: SCHOOL.baseboard, baseboardH: 0.1, wainscot: PAL.wainscot, wainscotTop: 1.1, rim: PAL.wainscotTop, wall: PAL.wall,
};

export interface Hole { s0: number; s1: number; y0: number; y1: number }

/** 墙面顶点的明暗：贴地变暗、贴顶略暗。 */
export function wallShade(y: number, h: number): number {
  return (0.72 + 0.28 * smoothstep(0, 0.7, y)) * (0.86 + 0.14 * smoothstep(h, h - 0.6, y));
}

/**
 * 一侧墙面上 [sa, sb] × [ya, yb] 这一块（按墙裙分色、贴图集取 uv，uv 周期对齐 e.period）。
 * side −1 = 左墙（x = xw，朝 +x）；+1 = 右墙（朝 −x）。base(s) = 墙面基线（平地为 0，楼梯为斜线）。
 */
export function wallPiece(g: KitGeo, e: Env, side: -1 | 1, st: WallStyle, sa: number, sb: number, ya: number, yb: number,
  xw = side * HW, base: (s: number) => number = () => 0): void {
  if (sb - sa < 1e-4 || yb - ya < 1e-4) return;
  const H = st.height;
  const pStart = e.segS0 + Math.floor((sa - e.segS0 + 1e-6) / e.period) * e.period;
  const ua = (sa - pStart) / e.period, ub = (sb - pStart) / e.period;
  const bands: Array<[number, number, number, Rect | null, number, number]> = [];   // [y0, y1, color, rect, v0frac, v1frac]
  const wt = st.wainscotTop;
  if (st.tileTop !== undefined) {
    bands.push([0, st.tileTop, st.tileColor ?? PAL.tile, ATLAS.tile, 0, st.tileTop / 0.9]);
    bands.push([st.tileTop, st.tileTop + 0.04, st.rim, null, 0, 1]);
    bands.push([st.tileTop + 0.04, H, st.wall, ATLAS.plaster, 0, 1]);
  } else {
    bands.push([0, st.baseboardH, st.baseboard, ATLAS.wainscot, 0, st.baseboardH / wt]);
    bands.push([st.baseboardH, wt, st.wainscot, ATLAS.wainscot, st.baseboardH / wt, 1]);
    bands.push([wt, wt + 0.045, st.rim, null, 0, 1]);
    bands.push([wt + 0.045, H, st.wall, ATLAS.plaster, 0, 1]);
  }
  for (const [b0, b1, color, rect, f0, f1] of bands) {
    const y0 = Math.max(ya, b0), y1 = Math.min(yb, b1);
    if (y1 <= y0 + 1e-5) continue;
    const fv = (y: number) => f0 + (f1 - f0) * ((y - b0) / (b1 - b0));
    let r: Rect | null = null;
    if (rect) {
      // 瓷砖按 0.9 m 周期在 u 方向重复：用段内米数取模
      if (rect === ATLAS.tile) {
        const tu = (s: number) => ((s - e.segS0) % 0.9 + 0.9) % 0.9 / 0.9;
        const u0 = tu(sa), u1 = tu(sb) <= u0 + 1e-6 ? 1 : tu(sb);
        const tv = (y: number) => (y % 0.9) / 0.9;
        const v0 = tv(y0), v1 = tv(y1) <= v0 + 1e-6 ? 1 : tv(y1);
        r = subRect(rect, clamp(u0, 0, 1), clamp(u1, 0, 1), clamp(v0, 0, 1), clamp(v1, 0, 1));
      } else r = subRect(rect, clamp(ua, 0, 1), clamp(ub, 0, 1), clamp(fv(y0), 0, 1), clamp(fv(y1), 0, 1));
    }
    const za = e.z(sa), zb = e.z(sb);
    const ba = base(sa), bb = base(sb);
    const sh0 = wallShade(y0, H), sh1 = wallShade(y1, H);
    // 贴地的一段往地面以下多伸 6 cm：墙与地面在 T 形接缝处不会漏出背景色的亮点（低画质没有抗锯齿时明显）
    const yLo = y0 <= 1e-6 ? -0.06 : y0;
    if (side < 0) {
      const p: [V3, V3, V3, V3] = [[xw, ba + yLo, za], [xw, bb + yLo, zb], [xw, bb + y1, zb], [xw, ba + y1, za]];
      if (r) g.quad(p[0], p[1], p[2], p[3], color, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], [sh0, sh0, sh1, sh1]);
      else g.quad(p[0], p[1], p[2], p[3], color, null, [sh0, sh0, sh1, sh1]);
    } else {
      const p: [V3, V3, V3, V3] = [[xw, bb + yLo, zb], [xw, ba + yLo, za], [xw, ba + y1, za], [xw, bb + y1, zb]];
      if (r) g.quad(p[0], p[1], p[2], p[3], color, [[r[2], r[1]], [r[0], r[1]], [r[0], r[3]], [r[2], r[3]]], [sh0, sh0, sh1, sh1]);
      else g.quad(p[0], p[1], p[2], p[3], color, null, [sh0, sh0, sh1, sh1]);
    }
    // 墙裙上沿：一道凸出 1.5 cm 的小台
    if (color === st.rim && b1 - b0 < 0.1) {
      const xo = xw - side * 0.015;
      if (side < 0) g.quad([xo, ba + y1, za], [xo, bb + y1, zb], [xw, bb + y1, zb], [xw, ba + y1, za], st.rim, null, [1.05, 1.05, 1.05, 1.05]);
      else g.quad([xo, bb + y1, zb], [xo, ba + y1, za], [xw, ba + y1, za], [xw, bb + y1, zb], st.rim, null, [1.05, 1.05, 1.05, 1.05]);
    }
  }
}

/** 整面侧墙：按贴图周期与洞切段。 */
export function sideWall(g: KitGeo, e: Env, side: -1 | 1, st: WallStyle, holes: readonly Hole[], xw = side * HW,
  base: (s: number) => number = () => 0, sFrom = e.s0, sTo = e.s1): void {
  const cuts = new Set<number>([sFrom, sTo]);
  const k0 = Math.ceil((sFrom - e.segS0) / e.period - 1e-6), k1 = Math.floor((sTo - e.segS0) / e.period + 1e-6);
  for (let k = k0; k <= k1; k++) { const s = e.segS0 + k * e.period; if (s > sFrom && s < sTo) cuts.add(s); }
  for (const h of holes) { if (h.s0 > sFrom && h.s0 < sTo) cuts.add(h.s0); if (h.s1 > sFrom && h.s1 < sTo) cuts.add(h.s1); }
  const xs = Array.from(cuts).sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number, b = xs[i + 1] as number;
    const mid = (a + b) / 2;
    const hs = holes.filter((h) => mid > h.s0 && mid < h.s1).sort((p, q) => p.y0 - q.y0);
    if (hs.length === 0) { wallPiece(g, e, side, st, a, b, 0, st.height, xw, base); continue; }
    let y = 0;
    for (const h of hs) { wallPiece(g, e, side, st, a, b, y, h.y0, xw, base); y = Math.max(y, h.y1); }
    wallPiece(g, e, side, st, a, b, y, st.height, xw, base);
  }
}

/** 洞的侧面（墙厚）：窗台、过梁、两侧门套。朝向走廊内侧可见。 */
export function holeReveal(g: KitGeo, e: Env, side: -1 | 1, h: Hole, color: number, xw = side * HW, depth = WALL_T): void {
  const xi = xw + side * depth;
  const za = e.z(Math.max(h.s0, e.s0)), zb = e.z(Math.min(h.s1, e.s1));
  const [x0, x1] = side < 0 ? [xi, xw] : [xw, xi];
  // 窗台（朝上）、过梁（朝下）
  g.quad([x0, h.y0, za], [x1, h.y0, za], [x1, h.y0, zb], [x0, h.y0, zb], color, null, [0.95, 0.95, 0.95, 0.95]);
  g.quad([x0, h.y1, zb], [x1, h.y1, zb], [x1, h.y1, za], [x0, h.y1, za], color, null, [0.8, 0.8, 0.8, 0.8]);
  // 两侧（只在洞的端点落在本 chunk 内时画）
  if (h.s0 >= e.s0 - 1e-6) g.quad([x1, h.y0, za], [x0, h.y0, za], [x0, h.y1, za], [x1, h.y1, za], color, null, [0.85, 0.85, 0.85, 0.85]);
  if (h.s1 <= e.s1 + 1e-6) g.quad([x0, h.y0, zb], [x1, h.y0, zb], [x1, h.y1, zb], [x0, h.y1, zb], color, null, [0.85, 0.85, 0.85, 0.85]);
}

// ——————————————————— 天花板与灯 ———————————————————
export function ceilingQuad(g: KitGeo, e: Env, x0: number, x1: number, y: number, color: number, base: (s: number) => number = () => 0): void {
  const pStart = e.segS0 + Math.floor((e.s0 - e.segS0 + 1e-6) / e.period) * e.period;
  const cuts: number[] = [e.s0];
  for (let s = pStart + e.period; s < e.s1 - 1e-6; s += e.period) cuts.push(s);
  cuts.push(e.s1);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i] as number, b = cuts[i + 1] as number;
    const ua = (a - pStart - i * e.period) / e.period, ub = (b - pStart - i * e.period) / e.period;
    const r = subRect(ATLAS.ceiling, clamp(ua, 0, 1), clamp(ub, 0, 1), 0, 1);
    const za = e.z(a), zb = e.z(b), ya = base(a) + y, yb = base(b) + y;
    // 朝下：从下往上看逆时针
    g.quad([x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za], color, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], [0.72, 0.72, 0.72, 0.72]);
  }
}

export interface TubeOpts { every?: number; offset?: number; xs?: readonly number[]; y: number; across?: boolean; len?: number; flickerable?: boolean; kind?: LampSpec['kind']; base?: (s: number) => number }
/** 灯管：每 every 拍一盏（缺省 2 拍，§5.9）。发光几何（跟灯走）+ 金属灯罩（static）+ LampSpec。 */
export function tubes(emi: KitGeo, stat: KitGeo, e: Env, lamps: LampSpec[], o: TubeOpts): void {
  const every = o.every ?? 2, xs = o.xs ?? [0], len = o.len ?? 1.15;
  for (const s of beatsIn(e, every, o.offset ?? 1, 0.3)) {
    const z = e.z(s), b = o.base?.(s) ?? 0;
    for (const x of xs) {
      if (o.across) {
        stat.box([x, b + o.y + 0.035, z], [len + 0.1, 0.035, 0.2], SCHOOL.pipe, { faces: '-y+z-z+x-x' });
        emi.box([x, b + o.y - 0.005, z], [len, 0.045, 0.075], PAL.tube, { faces: '-y+z-z+x-x' });
      } else {
        stat.box([x, b + o.y + 0.035, z], [0.2, 0.035, len + 0.1], SCHOOL.pipe, { faces: '-y+x-x+z-z' });
        emi.box([x, b + o.y - 0.005, z], [0.075, 0.045, len], PAL.tube, { faces: '-y+x-x+z-z' });
      }
      lamps.push({ s, x, y: b + o.y, kind: o.kind ?? 'tube', flickerable: o.flickerable ?? true });
    }
  }
}

// ——————————————————— 窗、门、牌 ———————————————————
export interface WindowStyle { top: number; bottom: number; frame: number; horizon?: number | null; night?: boolean }
export const DAY_WINDOW: WindowStyle = { top: PAL.windowTop, bottom: PAL.windowBottom, frame: 0x9aa4a7, horizon: 0x74848d };
export const NORTH_WINDOW: WindowStyle = { top: 0xb9c6cf, bottom: 0x8e9ca3, frame: 0x9aa4a7, horizon: 0x76858d };
export const NIGHT_WINDOW: WindowStyle = { top: 0x1a2a33, bottom: 0x10181e, frame: 0x3a464d, horizon: 0x0c1115, night: true };

/**
 * 侧墙上的窗（墙要事先按 hole 留洞）：发光的玻璃（aSteady = 1，不跟灯走）+ 远处楼群的剪影 + 窗框竖梃。
 * 玻璃放在墙厚的外沿。
 */
export function windowPane(emi: KitGeo, stat: KitGeo, e: Env, side: -1 | 1, h: Hole, ws: WindowStyle, mullion = 1.2, xw = side * HW): void {
  const xg = xw + side * WALL_T;
  const sa = Math.max(h.s0, e.s0), sb = Math.min(h.s1, e.s1);
  if (sb - sa < 1e-3) return;
  const za = e.z(sa), zb = e.z(sb);
  const q = (y0: number, y1: number, c0: number, c1: number) => {
    if (side < 0) emi.quad([xg, y0, za], [xg, y0, zb], [xg, y1, zb], [xg, y1, za], [c0, c0, c1, c1]);
    else emi.quad([xg, y0, zb], [xg, y0, za], [xg, y1, za], [xg, y1, zb], [c0, c0, c1, c1]);
  };
  emi.withSteady(1, () => {
    if (ws.horizon != null) {
      // 窗外：天（渐变）+ 对面那栋教学楼（一条楼带、一排排更暗的窗）+ 楼下的一截地面
      const yg = h.y0 + (h.y1 - h.y0) * 0.18, yb0 = yg, yb1 = h.y0 + (h.y1 - h.y0) * 0.55;
      q(h.y0, yg, ws.horizon, ws.horizon);
      q(yg, h.y1, ws.bottom, ws.top);
      const xs = xg - side * 0.01, xw2 = xg - side * 0.015;
      const band = (a: number, b: number, y0: number, y1: number, c: number, x: number) => {
        if (side < 0) emi.quad([x, y0, e.z(a)], [x, y0, e.z(b)], [x, y1, e.z(b)], [x, y1, e.z(a)], c);
        else emi.quad([x, y0, e.z(b)], [x, y0, e.z(a)], [x, y1, e.z(a)], [x, y1, e.z(b)], c);
      };
      const bc = mixHex(ws.horizon, ws.bottom, 0.35);
      band(sa, sb, yb0, yb1, bc, xs);
      if (!e.low && !ws.night) {
        const rows = 3, pitch = 0.42;
        for (let r = 0; r < rows; r++) {
          const y0 = yb0 + 0.05 + r * ((yb1 - yb0 - 0.08) / rows), y1 = y0 + (yb1 - yb0) / rows * 0.45;
          for (let s = Math.ceil((sa - e.segS0) / pitch) * pitch + e.segS0 + 0.08; s + 0.2 < sb; s += pitch) band(s, s + 0.2, y0, y1, ws.horizon, xw2);
        }
      }
    } else q(h.y0, h.y1, ws.bottom, ws.top);
  });
  // 竖梃与中横档（static，在玻璃前）
  const xm = xg - side * 0.03;
  for (const s of stepsIn(e, mullion, 0)) {
    if (s <= h.s0 + 0.05 || s >= h.s1 - 0.05) continue;
    stat.box([xm, (h.y0 + h.y1) / 2, e.z(s)], [0.05, h.y1 - h.y0, 0.05], ws.frame, { faces: side < 0 ? '+x+z-z' : '-x+z-z' });
  }
  const yr = h.y0 + (h.y1 - h.y0) * 0.62;
  stat.box([xm, yr, (za + zb) / 2], [0.05, 0.05, za - zb], ws.frame, { faces: side < 0 ? '+x+y-y' : '-x+y-y' });
}

/** 暖气片（窗下）：一个扁盒 + 竖向散热片（高画质）。 */
export function radiator(g: KitGeo, e: Env, side: -1 | 1, s: number, w = 1.1, xw = side * HW): void {
  const x = xw - side * 0.07, z = e.z(s);
  g.box([x, 0.45, z], [0.08, 0.5, w], SCHOOL.radiator, { faces: side < 0 ? '+x+y+z-z' : '-x+y+z-z', bottomShade: 0.7 });
  if (!e.low) {
    const n = Math.round(w / 0.1);
    for (let i = 0; i < n; i++) g.box([x - side * 0.045, 0.45, z - w / 2 + (i + 0.5) * (w / n)], [0.015, 0.46, 0.035], 0x7b878d, { faces: side < 0 ? '+x+z-z' : '-x+z-z' });
  }
  // 管子
  g.box([x, 0.14, z], [0.035, 0.035, w + 0.3], SCHOOL.pipe, { faces: side < 0 ? '+x+y' : '-x+y' });
}

export interface DoorOpts { width?: number; height?: number; leaf?: number; frame?: number; windowPane?: number | null; plate?: Rect | null; open?: number }
/** 侧墙上的门（墙要事先按 hole 留洞到 height）：门套、门扇（可以半开）、门上小窗、门上方垂直于墙的班牌。 */
export function sideDoor(stat: KitGeo, emi: KitGeo, e: Env, side: -1 | 1, s: number, o: DoorOpts = {}): Hole {
  const w = o.width ?? 0.95, h = o.height ?? 2.15, xw = side * HW;
  const hole: Hole = { s0: s - w / 2, s1: s + w / 2, y0: 0, y1: h };
  const frame = o.frame ?? SCHOOL.doorFrame, leaf = o.leaf ?? SCHOOL.doorLeaf;
  const za = e.z(hole.s0), zb = e.z(hole.s1);
  // 门套（凸出墙面 2 cm）
  const xf = xw - side * 0.02;
  stat.box([xf, h + 0.04, (za + zb) / 2], [0.05, 0.08, w + 0.16], frame, { faces: side < 0 ? '+x-y+y+z-z' : '-x-y+y+z-z' });
  stat.box([xf, h / 2, za + 0.04], [0.05, h, 0.08], frame, { faces: side < 0 ? '+x+z-z' : '-x+z-z' });
  stat.box([xf, h / 2, zb - 0.04], [0.05, h, 0.08], frame, { faces: side < 0 ? '+x+z-z' : '-x+z-z' });
  // 门扇：在墙厚里（关着）或向内半开
  const xd = xw + side * 0.06;
  const open = o.open ?? 0;
  if (open <= 0.01) {
    stat.box([xd, h / 2, (za + zb) / 2], [0.04, h, w], leaf, { faces: side < 0 ? '+x' : '-x', bottomShade: 0.85 });
    if (o.windowPane !== null) {
      const pc = o.windowPane ?? 0x1a2a33;
      const xp = xd - side * 0.022;
      const pz0 = (za + zb) / 2 + w * 0.2, pz1 = (za + zb) / 2 - w * 0.2;
      emi.withSteady(1, () => {
        if (side < 0) emi.quad([xp, 1.35, pz0], [xp, 1.35, pz1], [xp, 1.9, pz1], [xp, 1.9, pz0], pc);
        else emi.quad([xp, 1.35, pz1], [xp, 1.35, pz0], [xp, 1.9, pz0], [xp, 1.9, pz1], pc);
      });
    }
    // 门把手
    stat.box([xd - side * 0.04, 1.0, za - 0.12], [0.04, 0.03, 0.12], PAL.steel, { faces: side < 0 ? '+x+y-y+z-z' : '-x+y-y+z-z' });
  } else {
    // 半开：门扇绕近端铰链向房间里转 open × 90°，门洞里看得见房间的暗
    const ang = open * Math.PI / 2;
    const hx = xw + side * 0.06, hz = za;
    const ex = hx + side * Math.sin(ang) * w, ez = hz - Math.cos(ang) * w;
    stat.quad(side < 0 ? [hx, 0, hz] : [ex, 0, ez], side < 0 ? [ex, 0, ez] : [hx, 0, hz], side < 0 ? [ex, h, ez] : [hx, h, hz], side < 0 ? [hx, h, hz] : [ex, h, ez], leaf);
    const xr = xw + side * 1.2;
    stat.quad(side < 0 ? [xr, 0, za] : [xr, 0, zb], side < 0 ? [xr, 0, zb] : [xr, 0, za], side < 0 ? [xr, h, zb] : [xr, h, za], side < 0 ? [xr, h, za] : [xr, h, zb], 0x2a3136);
    const [xa, xb] = side < 0 ? [xr, xw] : [xw, xr];
    stat.quad([xa, 0.001, za], [xb, 0.001, za], [xb, 0.001, zb], [xa, 0.001, zb], 0x3a4246);
    stat.quad([xa, h, zb], [xb, h, zb], [xb, h, za], [xa, h, za], 0x30383c);
    stat.quad([xa, 0, zb], [xb, 0, zb], [xb, h, zb], [xa, h, zb], 0x353d41);
  }
  holeReveal(stat, e, side, hole, frame, xw, 0.06);
  // 垂直于墙的班牌（两面都能读）
  if (o.plate) plateSign(stat, e, side, s, 2.42, o.plate);
  return hole;
}

/** 垂直于墙、从墙上伸出来的牌子：长 0.36、高 0.1，朝 +z 与 −z 两面，挂在 y 高处。 */
export function plateSign(g: KitGeo, e: Env, side: -1 | 1, s: number, y: number, r: Rect): void {
  const xw = side * HW, x0 = xw - side * 0.04, x1 = xw - side * 0.42;
  const [xa, xb] = side < 0 ? [x0, x1] : [x1, x0];
  const z = e.z(s);
  g.box([(xa + xb) / 2, y, z], [Math.abs(xb - xa), 0.12, 0.025], SCHOOL.doorFrame, { faces: '+y-y' });
  g.box([side < 0 ? xa - 0.02 : xb + 0.02, y, z], [0.04, 0.04, 0.02], PAL.steel);
  const zf = z + 0.013, zr = z - 0.013;
  g.quad([xa, y - 0.06, zf], [xb, y - 0.06, zf], [xb, y + 0.06, zf], [xa, y + 0.06, zf], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
  g.quad([xb, y - 0.06, zr], [xa, y - 0.06, zr], [xa, y + 0.06, zr], [xb, y + 0.06, zr], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
}

/** 贴在墙面上的纸（值日表、告示、海报）：一张四边形，比墙凸出 6 mm。 */
export function wallPaper(g: KitGeo, e: Env, side: -1 | 1, s: number, y: number, w: number, h: number, r: Rect, tilt = 0, xw = side * HW): void {
  const x = xw - side * 0.006;
  const za = e.z(s - w / 2), zb = e.z(s + w / 2);
  const dy = tilt * w;
  if (side < 0) g.quad([x, y - h / 2, za], [x, y - h / 2 + dy, zb], [x, y + h / 2 + dy, zb], [x, y + h / 2, za], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
  else g.quad([x, y - h / 2 + dy, zb], [x, y - h / 2, za], [x, y + h / 2, za], [x, y + h / 2 + dy, zb], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
}

/** 公告栏：浅灰边框 + 深一点的板 + 几张纸。 */
export function noticeBoard(g: KitGeo, e: Env, side: -1 | 1, s: number, w = 1.6, xw = side * HW): void {
  const x = xw - side * 0.015, z = e.z(s);
  g.box([x, 1.72, z], [0.03, 0.9, w], 0x8f9ea3, { faces: side < 0 ? '+x+y-y+z-z' : '-x+y-y+z-z' });
  g.box([x - side * 0.016, 1.72, z], [0.004, 0.8, w - 0.1], 0x6e7c82, { faces: side < 0 ? '+x' : '-x' });
  const rng = e.rng;
  let ss = s - w / 2 + 0.12;
  const xw2 = xw - side * 0.022;
  void HW;
  while (ss < s + w / 2 - 0.3) {
    const pw = 0.21 + rng.next() * 0.1, ph = 0.3 + rng.next() * 0.08;
    const which = rng.next();
    const r = which < 0.45 ? ATLAS.notice : which < 0.75 ? ATLAS.roster : ATLAS.poster;
    wallPaper(g, e, side, ss + pw / 2, 1.72 + (rng.next() - 0.5) * 0.25, pw, ph, r, (rng.next() - 0.5) * 0.08, xw2);
    ss += pw + 0.05 + rng.next() * 0.1;
  }
}

/** 消火栓箱：嵌在墙里的浅灰箱子，玻璃门（冷色，不用红色）。 */
export function hydrantBox(g: KitGeo, e: Env, side: -1 | 1, s: number): void {
  const x = side * (HW - 0.02), z = e.z(s);
  g.box([x, 1.0, z], [0.04, 0.8, 0.7], 0xb9c0c1, { faces: side < 0 ? '+x+y-y+z-z' : '-x+y-y+z-z', bottomShade: 0.9 });
  g.box([x - side * 0.022, 1.02, z], [0.004, 0.6, 0.5], 0x50606a, { faces: side < 0 ? '+x' : '-x' });
}

/** 数据里的门牌（kind doorPlate）：挂在对应一侧墙上、垂直于墙。 */
export function dataPlates(g: KitGeo, e: Env): void {
  for (const su of e.surfaces) {
    if (su.kind !== 'doorPlate' || (su.side !== 'L' && su.side !== 'R')) continue;
    if (su.s0 < e.s0 - 1e-6 || su.s0 >= e.s1) continue;
    const r = e.hw?.plateRect(su.text ?? '') ?? null;
    if (!r) continue;
    const y = su.y ? (su.y[0] + su.y[1]) / 2 : 2.0;
    plateSign(g, e, su.side === 'L' ? -1 : 1, su.s0, y, r);
  }
}

// ——————————————————— 开口与镜中房间（§5.8） ———————————————————
export interface MirrorRoomStyle { floor: number; wall: number; back: number; ceilingY: number }
export const DARK_ROOM: MirrorRoomStyle = { floor: 0x3a464d, wall: 0x3e4a52, back: 0x2e3a42, ceilingY: 3.1 };
/** 镜中房间里灯管倒影的颜色（暗，跟着真实的灯明灭）。 */
export const MIRROR_TUBE = 0x7c8994;

/** 侧墙开口 → 洞（给 sideWall 用）。 */
export function sideHoles(e: Env, side: 'L' | 'R'): Hole[] {
  return e.openings.filter((o) => o.side === side && o.s1 > e.s0 && o.s0 < e.s1).map((o) => ({ s0: o.s0, s1: o.s1, y0: o.y0, y1: o.y1 }));
}

/**
 * 侧墙开口后面的镜中房间：只画朝向开口的内表面（地、顶、背墙、两端）。
 * backdrop：darkRoom / mirrorChunk = 暗；playground / evening / nightStreet = 背墙换成发光的窗外（渐变 + 剪影）。
 */
export function mirrorRooms(stat: KitGeo, emi: KitGeo, e: Env, st: MirrorRoomStyle = DARK_ROOM): void {
  for (const o of e.openings) {
    if (o.side === 'end') continue;
    const sa = Math.max(o.s0, e.s0), sb = Math.min(o.s1, e.s1);
    if (sb - sa < 1e-3) continue;
    const side: -1 | 1 = o.side === 'L' ? -1 : 1;
    const su = e.surfaces.find((q) => q.id === o.surfaceId);
    const backdrop = su?.backdrop ?? 'darkRoom';
    const xw = side * (HW + WALL_T), xb = side * (HW + ROOM_DEPTH);
    const za = e.z(sa), zb = e.z(sb), H = st.ceilingY;
    const [xa0, xa1] = side < 0 ? [xb, xw] : [xw, xb];
    // 地面：暗，带几道反射的地砖线
    stat.quad([xa0, 0, za], [xa1, 0, za], [xa1, 0, zb], [xa0, 0, zb], [st.floor, st.floor, st.floor, st.floor], null, side < 0 ? [0.7, 1, 1, 0.7] : [1, 0.7, 0.7, 1]);
    for (const s of stepsIn(e, 1.0, 0)) {
      if (s <= sa || s >= sb) continue;
      stat.quad([xa0, 0.003, e.z(s) + 0.01], [xa1, 0.003, e.z(s) + 0.01], [xa1, 0.003, e.z(s) - 0.01], [xa0, 0.003, e.z(s) - 0.01], 0x55636b);
    }
    stat.quad([xa0, H, zb], [xa1, H, zb], [xa1, H, za], [xa0, H, za], st.wall, null, [0.6, 0.6, 0.6, 0.6]);
    if (o.s0 >= e.s0 - 1e-6) stat.quad([xa1, 0, za], [xa0, 0, za], [xa0, H, za], [xa1, H, za], st.wall);
    if (o.s1 <= e.s1 + 1e-6) stat.quad([xa0, 0, zb], [xa1, 0, zb], [xa1, H, zb], [xa0, H, zb], st.wall);
    const bright = backdrop === 'playground' || backdrop === 'evening' || backdrop === 'nightStreet';
    if (!bright) {
      const c = st.back;
      if (side < 0) stat.quad([xb, 0, za], [xb, 0, zb], [xb, H, zb], [xb, H, za], [c, c, 0x46545c, 0x46545c], null, [0.8, 0.8, 1.1, 1.1]);
      else stat.quad([xb, 0, zb], [xb, 0, za], [xb, H, za], [xb, H, zb], [c, c, 0x46545c, 0x46545c], null, [0.8, 0.8, 1.1, 1.1]);
      // 镜中那一侧的「对面墙」：几道竖向的暗影（门、隔板的倒影），只是比背墙略亮一点
      for (const s of stepsIn(e, 1.2, 0.3)) {
        if (s <= sa + 0.1 || s >= sb - 0.1) continue;
        const xq = xb - side * 0.012, z0 = e.z(s - 0.02), z1 = e.z(s + 0.02);
        if (side < 0) stat.quad([xq, 0.15, z0], [xq, 0.15, z1], [xq, 1.95, z1], [xq, 1.95, z0], 0x4e5c64);
        else stat.quad([xq, 0.15, z1], [xq, 0.15, z0], [xq, 1.95, z0], [xq, 1.95, z1], 0x4e5c64);
      }
      // 灯管的倒影：走廊中线那排灯以墙面为对称面映到 x = 2·xw，跟着真实的灯明灭（aSteady = 0）
      const xt = side * (2 * HW);
      for (const s of beatsIn(e, 2, 1, 0)) {
        if (s <= sa + 0.3 || s >= sb - 0.3) continue;
        const zt = e.z(s);
        emi.quad([xt - 0.04, H - 0.06, zt + 0.55], [xt + 0.04, H - 0.06, zt + 0.55], [xt + 0.04, H - 0.06, zt - 0.55], [xt - 0.04, H - 0.06, zt - 0.55], MIRROR_TUBE);
        emi.quad([xt - 0.04, H - 0.06, zt - 0.55], [xt + 0.04, H - 0.06, zt - 0.55], [xt + 0.04, H - 0.06, zt + 0.55], [xt - 0.04, H - 0.06, zt + 0.55], MIRROR_TUBE);
      }
      // 镜中那一侧的走廊墙线（暗）：墙裙的上沿
      const xr = xb - side * 0.01;
      if (side < 0) stat.quad([xr, 1.08, za], [xr, 1.08, zb], [xr, 1.14, zb], [xr, 1.14, za], 0x26323a);
      else stat.quad([xr, 1.08, zb], [xr, 1.08, za], [xr, 1.14, za], [xr, 1.14, zb], 0x26323a);
    } else {
      const ws: WindowStyle = backdrop === 'nightStreet' ? NIGHT_WINDOW
        : backdrop === 'evening' ? { top: 0x9aa9b4, bottom: 0x5f6f7a, frame: 0x50606a, horizon: 0x3f4c55 }
          : DAY_WINDOW;
      const h: Hole = { s0: sa, s1: sb, y0: 0, y1: H };
      windowPane(emi, stat, { ...e, rng: e.rng }, side, h, ws, 99, xb - side * WALL_T);
    }
  }
}

/** 端墙开口（端墙镜）：在 s = o.s0 处立一面横墙，中间留镜子大小的洞，洞后是镜中房间。 */
export function endWalls(stat: KitGeo, e: Env, st: WallStyle, frame: number = PAL.steel, room: MirrorRoomStyle = DARK_ROOM, emi: KitGeo | null = null): void {
  for (const o of e.openings) {
    if (o.side !== 'end' || o.s0 < e.s0 - 1e-6 || o.s0 > e.s1 + 1e-6) continue;
    const ze = e.z(o.s0), H = st.height, hx = 0.95;
    const face = (x0: number, x1: number, y0: number, y1: number, c: number) => {
      const s0 = wallShade(y0, H), s1 = wallShade(y1, H);
      stat.quad([x0, y0, ze], [x1, y0, ze], [x1, y1, ze], [x0, y1, ze], c, null, [s0, s0, s1, s1]);
    };
    // 横墙（按墙裙分色）
    const bands: Array<[number, number, number]> = [[0, st.baseboardH, st.baseboard], [st.baseboardH, st.wainscotTop, st.wainscot], [st.wainscotTop, st.wainscotTop + 0.045, st.rim], [st.wainscotTop + 0.045, H, st.wall]];
    for (const [b0, b1, c] of bands) {
      face(-HW, -hx, b0, b1, c); face(hx, HW, b0, b1, c);
      if (b1 <= o.y0) face(-hx, hx, b0, b1, c); else if (b0 < o.y0) face(-hx, hx, b0, o.y0, c);
      if (b0 >= o.y1) face(-hx, hx, b0, b1, c); else if (b1 > o.y1) face(-hx, hx, o.y1, b1, c);
    }
    // 镜框（凸出 3 cm）
    stat.box([0, o.y0 - 0.02, ze + 0.015], [2 * hx + 0.08, 0.04, 0.03], frame);
    stat.box([0, o.y1 + 0.02, ze + 0.015], [2 * hx + 0.08, 0.04, 0.03], frame);
    stat.box([-hx - 0.02, (o.y0 + o.y1) / 2, ze + 0.015], [0.04, o.y1 - o.y0, 0.03], frame);
    stat.box([hx + 0.02, (o.y0 + o.y1) / 2, ze + 0.015], [0.04, o.y1 - o.y0, 0.03], frame);
    // 镜中房间
    const zb = ze - ROOM_DEPTH;
    stat.quad([-hx, o.y0 - 0.001, ze], [hx, o.y0 - 0.001, ze], [hx, o.y0 - 0.001, zb], [-hx, o.y0 - 0.001, zb], room.floor, null, [1, 1, 0.6, 0.6]);
    if (o.y0 > 0.01) stat.quad([-hx, 0, ze - 0.001], [hx, 0, ze - 0.001], [hx, o.y0, ze - 0.001], [-hx, o.y0, ze - 0.001], room.wall);
    stat.quad([-hx, 0, zb], [hx, 0, zb], [hx, room.ceilingY, zb], [-hx, room.ceilingY, zb], room.back, null, [0.8, 0.8, 1.2, 1.2]);
    stat.quad([-hx, 0, ze], [-hx, 0, zb], [-hx, room.ceilingY, zb], [-hx, room.ceilingY, ze], room.wall, null, [0.9, 0.6, 0.6, 0.9]);
    stat.quad([hx, 0, zb], [hx, 0, ze], [hx, room.ceilingY, ze], [hx, room.ceilingY, zb], room.wall, null, [0.6, 0.9, 0.9, 0.6]);
    stat.quad([-hx, room.ceilingY, zb], [hx, room.ceilingY, zb], [hx, room.ceilingY, ze], [-hx, room.ceilingY, ze], room.wall, null, [0.5, 0.5, 0.5, 0.5]);
    for (let k = 1; k < 4; k++) {
      const z = ze - k * 0.95;
      stat.quad([-hx, o.y0 + 0.002, z + 0.01], [hx, o.y0 + 0.002, z + 0.01], [hx, o.y0 + 0.002, z - 0.01], [-hx, o.y0 + 0.002, z - 0.01], 0x55636b);
    }
    // 身后那排灯管的倒影：沿镜中房间的天花板往深处退
    if (emi) {
      const yt = Math.min(room.ceilingY, o.y1) - 0.08;
      for (let k = 0; k < 2; k++) {
        const z0 = ze - 0.6 - k * 2.0, z1 = z0 - 1.0;
        emi.quad([-0.04, yt, z1], [0.04, yt, z1], [0.04, yt, z0], [-0.04, yt, z0], MIRROR_TUBE);
        emi.quad([-0.04, yt, z0], [0.04, yt, z0], [0.04, yt, z1], [-0.04, yt, z1], MIRROR_TUBE);
      }
    }
  }
}

// ——————————————————— 段首段尾的门洞墙 ———————————————————
/**
 * 横墙（两面都画）：在 s 处横跨 [x0, x1]，高 h，中间留走廊截面大小的门洞（宽 2·HW，高 doorH）。
 * solid = true 时不留洞（章首身后、章尾）。
 */
export function crossWall(g: KitGeo, e: Env, s: number, x0: number, x1: number, h: number, doorH: number, st: WallStyle, solid = false, frame: number | null = SCHOOL.doorFrame): void {
  const z = e.z(s);
  const H = h;
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 1e-3 || y1 - y0 < 1e-3) return;
    const bands: Array<[number, number, number]> = [[0, st.baseboardH, st.baseboard], [st.baseboardH, st.wainscotTop, st.wainscot], [st.wainscotTop, st.wainscotTop + 0.045, st.rim], [st.wainscotTop + 0.045, H, st.wall]];
    for (const [b0, b1, c] of bands) {
      const ya = Math.max(y0, b0), yb = Math.min(y1, b1);
      if (yb <= ya) continue;
      const sa = wallShade(ya, H), sb = wallShade(yb, H);
      const yl = ya <= 1e-6 ? -0.06 : ya;
      g.quad([a, yl, z], [b, yl, z], [b, yb, z], [a, yb, z], c, null, [sa, sa, sb, sb]);          // 朝 +z
      g.quad([b, yl, z - 0.02], [a, yl, z - 0.02], [a, yb, z - 0.02], [b, yb, z - 0.02], c, null, [sa, sa, sb, sb]);   // 朝 −z
    }
  };
  if (solid) { piece(x0, x1, 0, H); return; }
  piece(x0, -HW, 0, H); piece(HW, x1, 0, H); piece(-HW, HW, doorH, H);
  if (frame !== null) {
    g.box([0, doorH + 0.04, z], [2 * HW + 0.1, 0.08, 0.2], frame, { faces: '-y+z-z' });
    if (x0 < -HW - 0.05) g.box([-HW - 0.04, doorH / 2, z], [0.08, doorH, 0.2], frame, { faces: '+x+z-z' });
    if (x1 > HW + 0.05) g.box([HW + 0.04, doorH / 2, z], [0.08, doorH, 0.2], frame, { faces: '-x+z-z' });
  }
}

/** 章首往回延伸的那一段天花板（不贴图集）。 */
export function ceilingBack(g: KitGeo, e: Env, x0: number, x1: number, y: number, color: number): void {
  if (e.back <= 0) return;
  const za = e.back, zb = 0;
  g.quad([x0, y, za], [x0, y, zb], [x1, y, zb], [x1, y, za], color, null, [0.72, 0.72, 0.72, 0.72]);
}
