// src/render/kits/outside/plaza.ts —— 梦中广场 kit（DESIGN.md §4.4、§5.1、§5.2、§5.9）。
// 「一块平坦的、浅灰色的广场，大得看不见边。广场上没有树，没有灯柱，只有很多很多人，站着，围成一圈，看中间。」
// 发白、几乎没有颜色的浅灰（单元测试检查每个顶点的饱和度）。没有灯（LampField 增益 0），没有五官。
// 变体：bright（4-1、4-2、4-3）人群围成一个接一个的弧；gray（4-5、4-6）人稀了、退远了，段尾是一大片灰色的水
//      （「广场突然到了尽头。不是墙，不是悬崖，是水。」）。
// 大镜子：数据里的 mirror 开口（4-5 @196–206 右侧）→ 一块几乎没有边框的镜板（「没有边框」），洞后是发白的镜中广场。
// 围观人群是远景剪影；近处会动的人（onlookerRing、模仿者、爬行者）由 WP6 画。
import type { EnvKit, KitChunk, KitChunkContext } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { CompiledSegment } from '../../../levels/schema';
import { C, mix, shade } from './lib/colors';
import { keyRng } from './lib/geo';
import { ChunkWork, HALF, openingPanels, type SideKey } from './lib/kit';
import { standingFigure } from './lib/props';

export const PLAZA_VARIANTS = ['bright', 'gray'] as const;
export type PlazaVariant = (typeof PLAZA_VARIANTS)[number];

/** gray 变体段尾的水从哪里开始（段尾前 5 m）。 */
export function waterStart(seg: CompiledSegment): number { return seg.s1 - 5; }

/** 人群内沿：一个接一个的弧（「你在人群之间回旋」）。side = ±1。 */
export function crowdInner(rel: number, side: -1 | 1, gray: boolean): number {
  const ph = side < 0 ? 0 : 0.5;
  const a = Math.abs(Math.sin(Math.PI * (rel / 30 + ph)));
  return gray ? 7.0 + 4.0 * a : 4.2 + 4.6 * a;
}

function plazaFloor(w: ChunkWork, sa: number, sb: number, gray: boolean): void {
  const za = w.z(sa), zb = w.z(sb);
  const base = gray ? mix(C.plaza, 0xa9b0b3, 0.35) : C.plaza;
  const seam = gray ? shade(base, 0.9) : C.plazaSeam;
  // 远处：两大块
  w.floor.flat(0, -80, -9, za, zb, base);
  w.floor.flat(0, 9, 80, za, zb, base);
  // 近处：大块石板，横缝每拍一道（视觉节拍），纵缝 1.5 m；相邻石板深浅略有不同（打磨过的光滑地面）
  const stride = w.ctx.stride, s0 = w.ctx.seg.s0;
  const cols = [-9, -7.5, -6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6, 7.5, 9];
  const rng = keyRng(w.segId, 'plazaTile', Math.round(sa * 10));
  for (let k = Math.floor((sa - s0) / stride); s0 + k * stride < sb; k++) {
    const a = Math.max(sa, s0 + k * stride), b = Math.min(sb, s0 + (k + 1) * stride);
    if (b - a < 1e-4) continue;
    for (let i = 0; i + 1 < cols.length; i++) {
      const x0 = cols[i] as number, x1 = cols[i + 1] as number;
      const t = ((k + i) % 2 === 0 ? 0.03 : 0) + rng.next() * 0.03;
      w.floor.flat(0, x0, x1, w.z(a), w.z(b), shade(base, 1 + t));
    }
    const sj = s0 + k * stride;
    if (sj >= sa - 1e-6 && sj < sb) { const z = w.z(sj); w.floor.flat(0.001, -9, 9, z + 0.012, z - 0.012, seam); }
  }
  if (w.q > 0) for (const x of cols) w.floor.flat(0.001, x - 0.012, x + 0.012, za, zb, seam);
}

function crowd(w: ChunkWork, gray: boolean): void {
  const rows = gray ? (w.q === 0 ? 1 : 2) : (w.q === 0 ? 2 : 3);
  const spacing = w.q === 0 ? 1.0 : w.q === 1 ? 0.8 : 0.62;
  const detail = (w.q === 0 ? 0 : w.q === 1 ? 1 : 2) as 0 | 1 | 2;
  for (const side of [-1, 1] as const) {
    const key: SideKey = side < 0 ? 'L' : 'R';
    w.grid(spacing, side < 0 ? 0.1 : 0.4, (s, k) => {
      const rel = w.rel(s);
      const x0 = crowdInner(rel, side, gray);
      for (let r = 0; r < rows; r++) {
        const rng = keyRng(w.segId, 'crowd', side, k, r);
        if (gray && rng.next() < 0.55) continue;           // 人稀了
        if (!gray && rng.next() < 0.08) continue;
        const x = side * (x0 + r * 0.8 + rng.next() * 0.35);
        const ss = s + (rng.next() - 0.5) * spacing * 0.6;
        // 镜子后面的保留区：让开（替身站在镜中广场里）
        if (Math.abs(x) < HALF + 4.4 && w.nearOpening(key, ss, 2.5)) continue;
        if (Math.abs(x) < HALF + 0.6) continue;
        const yaw = Math.atan2(side, 0) + (rng.next() - 0.5) * 0.6;
        const tone = rng.next();
        const body = gray ? mix(C.crowd, C.crowdDark, tone) : mix(0x9aa2a6, C.crowd, tone);
        const legs = shade(body, 0.88);
        const head = gray ? mix(0x8f979b, 0x7e878b, tone) : mix(0xaeb5b8, 0x9ea6aa, tone);
        standingFigure(w.stat, x, w.z(ss), yaw, rng, { body, legs, head, detail, armsUp: !gray && rng.next() < 0.18 });
      }
    });
  }
}

function water(w: ChunkWork, sW: number): void {
  const r = w.clip(sW, w.s1);
  const zW = w.z(Math.max(sW, w.s0));
  const zEnd = r ? w.z(w.s1) - 60 : zW;
  if (!r && sW >= w.s1) return;
  // 一大片灰色的水，一直铺到雾里；水边一道更深的线，水面上几条亮一点的横带（映着天）
  w.floor.flat(-0.03, -80, 80, zW, zEnd, C.plazaWater);
  w.floor.flat(-0.029, -80, 80, zW, zW - 0.12, shade(C.plazaWater, 0.75));
  const rng = keyRng(w.segId, 'water');
  for (let i = 0; i < 6 + w.q * 4; i++) {
    const z = zW - 1.5 - rng.next() * 40, len = 0.1 + rng.next() * 0.3;
    const x0 = -30 + rng.next() * 40, x1 = x0 + 6 + rng.next() * 24;
    w.floor.flat(-0.028, x0, x1, z, z - len, mix(C.plazaWater, C.plazaSky, 0.18 + rng.next() * 0.12));
  }
  w.stat.wallZ(zW - 0.001, -80, 80, -0.03, 0, shade(C.plaza, 0.7), 1);
}

export function buildPlazaChunk(ctx: KitChunkContext): KitChunk {
  const w = new ChunkWork(ctx);
  const gray = ctx.variant === 'gray';
  const sW = gray ? waterStart(ctx.seg) : Infinity;
  const land = w.clip(w.s0, Math.min(w.s1, sW));
  if (land) plazaFloor(w, land[0], land[1], gray);
  if (gray && sW < w.s1) water(w, sW);
  crowd(w, gray);
  // 大镜子：几乎没有边框（4 cm），洞后面是发白的镜中广场
  for (const side of ['L', 'R'] as const) {
    if (w.openings(side).length) openingPanels(w, side, 'bright', 0xb3babd, 0xa3aaad, 0.06, 0.05, 0);
  }
  return w.finish();
}

export const plazaKit: EnvKit & { isSpecial(seg: CompiledSegment, s0: number, s1: number): boolean } = {
  id: 'plaza', owner: 'WP4', variants: PLAZA_VARIANTS,
  build: buildPlazaChunk,
  ambience: () => 'dream',
  reverb: () => 'plaza',
  isSpecial(seg, s0, s1) {
    return (seg.def as { variant?: string }).variant === 'gray' && waterStart(seg) < s1 + 6 && seg.s1 > s0;
  },
};

registerKit(plazaKit);
