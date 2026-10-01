// src/render/kits/outside/lib/kit.ts —— 户外 kit 的 chunk 构建框架（DESIGN.md §5.8、§5.9、§8.4 KitChunk）。
// 一个 chunk = floor（不写深度，最先画）+ static（Lambert 顶点色）+ emissive（灯头、亮窗、路灯碎金）三个几何体 = ≤ 3 次 draw call。
// 几何体用局部坐标：x 横向，y 相对 floorY(s0)，z = −(s − s0)；灯用世界里程 s（contracts.ts KitChunk）。
// 规则：
//   · 反复出现的元素（灯、栅栏、树、楼的开间）一律按「段首 seg.s0 起算的绝对里程」排布，跨 chunk 连续，
//     元素只在锚点所在的 chunk 里建；伸出 chunk 的部分 ≤ 6 m（身后保留 1 个 chunk，回头时也不会缺一块）。
//   · 随机数用 keyRng(段 id, 元素序号)，同一个元素无论在哪个 chunk 里建都一样。
//   · 墙上开口（Opening）：镜子 / 窗的平面在 x = ±1.8（compile.ts HALF_WALL）。有开口的一侧，在开口处建一块墙板并留洞，
//     洞后面放深 3.8 m 的「镜中房间」（§5.8、§5.8 末条：从三条车道都看得到替身）；该侧的其他陈设让开这个体积。
import type { KitChunk, KitChunkContext, LampSpec, Opening } from '../../../../core/contracts';
import { CORRIDOR_WIDTH } from '../../../../core/constants';
import type { CompiledSurface } from '../../../../levels/schema';
import { C, mix, shade } from './colors';
import { OGeo } from './geo';
import { Tone } from './tone';

/** 开口所在的墙面：x = ±HALF（与 compile.ts 的 HALF_WALL 一致）。 */
export const HALF = CORRIDOR_WIDTH / 2;
/** 镜中房间深度（§5.8：≥ 3.8 m）。 */
export const ROOM_DEPTH = 3.8;

export type SideKey = 'L' | 'R';
export const sideSign = (k: SideKey): -1 | 1 => (k === 'L' ? -1 : 1);

export type RoomStyle = 'dark' | 'bright' | 'nightStreet';

export class ChunkWork {
  readonly floor = new OGeo();
  readonly stat = new OGeo();
  readonly emi = new OGeo();
  readonly lamps: LampSpec[] = [];
  readonly s0: number;
  readonly s1: number;
  readonly L: number;
  /** 画质档：0 低、1 中、2 高。 */
  readonly q: 0 | 1 | 2;
  readonly segId: string;

  constructor(readonly ctx: KitChunkContext) {
    this.s0 = ctx.s0; this.s1 = ctx.s1; this.L = ctx.s1 - ctx.s0;
    this.q = ctx.quality.tier === 'low' ? 0 : ctx.quality.tier === 'medium' ? 1 : 2;
    this.segId = ctx.seg.def.id;
    // 发光体缺省不跟 LampField 明灭（窗、镜中的雾）；灯头、灯的倒影用 lampLit() 包起来
    this.emi.steadyValue = 1;
  }

  /** 跟着灯明灭的发光体（灯头、灯的倒影、栏杆灯）：aSteady = 0。 */
  lampLit(fn: () => void): void { this.emi.withSteady(0, fn); }

  /** 世界里程 → 局部 z。 */
  z(s: number): number { return -(s - this.s0); }
  /** 段内拍号 → 世界里程。 */
  sAt(beat: number): number { return this.ctx.seg.s0 + beat * this.ctx.stride; }
  /** 段内里程（相对段首）。 */
  rel(s: number): number { return s - this.ctx.seg.s0; }
  /** 锚点是否属于本 chunk（半开区间）。 */
  owns(s: number): boolean { return s >= this.s0 - 1e-6 && s < this.s1 - 1e-6; }
  /** [a, b] 与本 chunk 的交集。 */
  clip(a: number, b: number): [number, number] | null {
    const x = Math.max(a, this.s0), y = Math.min(b, this.s1);
    return y - x > 1e-4 ? [x, y] : null;
  }
  /** 按「段首 + phase + k·step」遍历本 chunk 内的锚点。 */
  grid(step: number, phase: number, fn: (s: number, k: number) => void): void {
    const base = this.ctx.seg.s0 + phase;
    let k = Math.ceil((this.s0 - base) / step - 1e-6);
    for (; ; k++) {
      const s = base + k * step;
      if (s >= this.s1 - 1e-6) break;
      if (s >= this.s0 - 1e-6) fn(s, k);
    }
  }

  /**
   * 周期性的长条区段 [base + phase + k·step, … + len]，按本 chunk 裁剪后逐个交给 fn（跨 chunk 的长物件用它，
   * 每个 chunk 只画自己那一截，隐藏 chunk 时不会整块消失）。first / last 表示真正的起点 / 终点落在本 chunk 里。
   */
  spans(step: number, phase: number, len: number, fn: (a: number, b: number, k: number, first: boolean, last: boolean) => void): void {
    const base = this.ctx.seg.s0 + phase;
    let k = Math.floor((this.s0 - base - len) / step);
    for (; base + k * step < this.s1; k++) {
      const a0 = base + k * step, b0 = a0 + len;
      const r = this.clip(a0, b0);
      if (!r) continue;
      fn(r[0], r[1], k, Math.abs(r[0] - a0) < 1e-6, Math.abs(r[1] - b0) < 1e-6);
    }
  }

  /** 本 chunk 里某一侧的开口。 */
  openings(side: SideKey): readonly Opening[] { return this.ctx.openings.filter((o) => o.side === side); }
  /** s 是否落在某一侧开口的「镜中房间」保留区内（含余量）。 */
  nearOpening(side: SideKey, s: number, pad = 1.2): boolean {
    return this.ctx.openings.some((o) => o.side === side && s > o.s0 - pad && s < o.s1 + pad);
  }
  surface(o: Opening): CompiledSurface | undefined { return (this.ctx.seg.surfaces ?? []).find((q) => q.id === o.surfaceId); }

  lamp(s: number, x: number, y: number, kind: LampSpec['kind'], flickerable: boolean): void {
    this.lamps.push({ s, x, y, kind, flickerable });
  }

  finish(): KitChunk {
    // §5.1 的色板是画面上的颜色：按段的氛围把顶点色反推成反照率（暗场景不动，见 tone.ts）
    const tone = Tone.of(this.ctx.seg.def.atmosphere);
    tone.applyArrays(this.floor.col, this.floor.nor, this.floor.pos, 'floor');
    tone.applyArrays(this.stat.col, this.stat.nor, this.stat.pos, 'static');
    tone.applyArrays(this.emi.col, this.emi.nor, this.emi.pos, 'emissive');
    const f = this.floor.build();
    const s = this.stat.build();
    const e = this.emi.vertexCount ? this.emi.build({ steady: true }) : undefined;
    this.ctx.mat.ensureChalkAttr(f); this.ctx.mat.ensureChalkAttr(s); if (e) this.ctx.mat.ensureChalkAttr(e);
    return e ? { floor: f, static: s, emissive: e, lamps: this.lamps } : { floor: f, static: s, lamps: this.lamps };
  }
}

/**
 * 在 x = σ·HALF 的墙面上建一段墙（[sa, sb] × [0, yTop]），按开口留洞并在洞后建镜中房间。
 * color(y) 给出分层颜色（例如墙裙）。只在 x = ±HALF 的墙上用：替身按这个平面反射（§5.8）。
 */
export function wallWithOpenings(w: ChunkWork, side: SideKey, sa: number, sb: number, yTop: number,
  bands: ReadonlyArray<readonly [number, number, number]>, room: RoomStyle, thickness = 0.12): void {
  const r = w.clip(sa, sb);
  if (!r) return;
  const sg = sideSign(side), x = sg * HALF, facing = (-sg) as 1 | -1;
  const ops = w.openings(side).map((o) => ({ o, a: Math.max(r[0], o.s0), b: Math.min(r[1], o.s1) })).filter((q) => q.b > q.a + 1e-4);
  const cuts = new Set<number>([r[0], r[1]]);
  for (const q of ops) { cuts.add(q.a); cuts.add(q.b); }
  const xs = Array.from(cuts).sort((a, b) => a - b);
  const piece = (a: number, b: number, y0: number, y1: number) => {
    for (const [b0, b1, c] of bands) {
      const ya = Math.max(y0, b0), yb = Math.min(y1, b1);
      if (yb > ya + 1e-4) w.stat.wallX(x, w.z(a), w.z(b), ya, yb, c, facing);
    }
  };
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number, b = xs[i + 1] as number;
    const mid = (a + b) / 2;
    const hit = ops.find((q) => mid > q.a && mid < q.b);
    if (!hit) { piece(a, b, 0, yTop); continue; }
    const o = hit.o;
    piece(a, b, 0, o.y0);
    piece(a, b, o.y1, yTop);
    const surf = w.surface(o);
    const style: RoomStyle = surf?.backdrop === 'playground' || surf?.backdrop === 'evening' ? 'bright' : surf?.backdrop === 'nightStreet' ? 'nightStreet' : room;
    // 开口跨 chunk 时只在真正的两端画端墙，否则房间中间会多出一堵墙
    mirrorRoom(w, side, a, b, style, 3.0, Math.abs(a - o.s0) < 1e-4, Math.abs(b - o.s1) < 1e-4);
    // 窗台（墙厚）
    const xi = sg * (HALF + thickness);
    w.stat.face([x, o.y0, w.z(a)], [xi, o.y0, w.z(a)], [xi, o.y0, w.z(b)], [x, o.y0, w.z(b)], 0x9aa3a4, [0, 1, 0]);
    w.stat.face([x, o.y1, w.z(a)], [xi, o.y1, w.z(a)], [xi, o.y1, w.z(b)], [x, o.y1, w.z(b)], 0x7d878b, [0, -1, 0]);
  }
}

/**
 * 没有连续墙的一侧（户外街道、广场）：在每个开口处立一块比开口宽 0.5 m 的墙板，留洞，洞后建镜中房间。
 * 板的正面朝车道，背面也画（从斜后方看得到）。
 */
export function openingPanels(w: ChunkWork, side: SideKey, room: RoomStyle, panel: number, rim: number, margin = 0.5, topPad = 0.35, minTop = 2.4): void {
  const sg = sideSign(side), x = sg * HALF;
  for (const o of w.openings(side)) {
    const pa = o.s0 - margin, pb = o.s1 + margin;
    const top = Math.max(o.y1 + topPad, minTop);
    const bands: Array<readonly [number, number, number]> = [[0, top, panel]];
    wallWithOpenings(w, side, pa, pb, top, bands, room, 0.06);
    const r = w.clip(pa, pb);
    if (!r) continue;
    // 背面与顶边、两端
    const xb = sg * (HALF + 0.06);
    w.stat.wallX(xb, w.z(r[0]), w.z(r[1]), 0, top, mix(panel, C.ink, 0.35), sg);
    w.stat.flat(top, Math.min(x, xb), Math.max(x, xb), w.z(r[0]), w.z(r[1]), rim, true);
    if (Math.abs(r[0] - pa) < 1e-6) w.stat.wallZ(w.z(pa), Math.min(x, xb), Math.max(x, xb), 0, top, rim, 1);
    if (Math.abs(r[1] - pb) < 1e-6) w.stat.wallZ(w.z(pb), Math.min(x, xb), Math.max(x, xb), 0, top, rim, -1);
  }
}

/** 开口后面的镜中房间（只画朝向开口的内表面）。 */
export function mirrorRoom(w: ChunkWork, side: SideKey, sa: number, sb: number, style: RoomStyle, H = 3.0, nearEnd = true, farEnd = true): void {
  const sg = sideSign(side);
  const xw = sg * HALF, xb = sg * (HALF + ROOM_DEPTH);
  const za = w.z(sa), zb = w.z(sb);
  const [xa0, xa1] = sg < 0 ? [xb, xw] : [xw, xb];
  const inward = (-sg) as 1 | -1;
  if (style === 'bright') {
    // 广场 / 操场：一整块浅灰的「镜碑」，朝车道的一面整面是镜子（「没有边框」）。
    // 里面：同一片发白的地面，背墙和两端是雾色（从镜子里看过去就是更远的雾）；外面：和地面同样的材质，受光照、会进雾。
    const top = Math.min(H, 2.75);
    const shell = mix(C.plaza, C.crowd, 0.12);
    w.stat.flat(0.001, xa0, xa1, za, zb, C.plaza, true);
    w.emi.wallX(xb - sg * 0.02, za, zb, 0, top, C.dreamFog, inward);
    if (nearEnd) w.emi.wallZ(za - 0.02, xa0, xa1, 0, top, C.dreamFog, -1);
    if (farEnd) w.emi.wallZ(zb + 0.02, xa0, xa1, 0, top, C.dreamFog, 1);
    // 外壳（Lambert）
    w.stat.wallX(xb, za, zb, 0, top, shade(shell, 0.95), (sg as 1 | -1));
    w.stat.flat(top, xa0, xa1, za, zb, shade(shell, 1.04), true);
    if (nearEnd) w.stat.wallZ(za, xa0, xa1, 0, top, shell, 1);
    if (farEnd) w.stat.wallZ(zb, xa0, xa1, 0, top, shade(shell, 0.9), -1);
    return;
  }
  const dark = style === 'nightStreet' ? 0x141b20 : 0x1a2328, darker = style === 'nightStreet' ? 0x0d1216 : 0x121a1f;
  w.stat.wallX(xb, za, zb, 0, H, darker, inward);
  w.stat.flat(0.001, xa0, xa1, za, zb, dark, true);
  w.stat.flat(H, xa0, xa1, za, zb, dark, false);
  if (nearEnd) w.stat.wallZ(za, xa0, xa1, 0, H, dark, -1);
  if (farEnd) w.stat.wallZ(zb, xa0, xa1, 0, H, dark, 1);
  if (style === 'nightStreet') {
    // 玻璃后面远处的街：几粒冷色的光
    const n = 3 + w.q * 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const zz = za + (zb - za) * t;
      const y = 1.1 + ((i * 37) % 7) * 0.12;
      w.emi.wallX(xb - sg * 0.01, zz + 0.05, zz - 0.05, y, y + 0.08, C.windowLitCold, inward);
    }
  }
}
