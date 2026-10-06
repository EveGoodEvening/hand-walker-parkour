// src/render/kits/outside/track.ts —— 操场 kit（DESIGN.md §4.5 5-7、5-8，§5.1，§5.9）。
// 塑胶跑道 #7A4B44、白线 #CFD3D2、草 #5E6B5A；阴天（overcast），天是灰白色的、没有云（天由 weather/outdoor.ts 与背景色负责）。
// 玩家在跑道内侧几条道上爬（「趴在跑道边缘」）：白线正好落在三条车道的分界上（x = ±0.55、±1.65），外面还有几条道。
// 陈设：内侧路牙、内场草坪（修剪的深浅条纹）和远处的球门，外侧收着的一排栏架（「栏架」，不在车道里，不是障碍）、
//      铁丝网、看台、树。视觉节拍：内道白线旁每拍一道短刻痕。
import type { EnvKit, KitChunk, KitChunkContext } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import { C, mix, shade } from './lib/colors';
import { keyRng } from './lib/geo';
import { ChunkWork, openingPanels } from './lib/kit';
import { tree } from './lib/props';

export const TRACK_VARIANTS = ['default'] as const;
/** 跑道白线的 x（车道分界 ±0.55、±1.65，向外每 1.1 m 一条）。 */
export const TRACK_LINES = [-1.65, -0.55, 0.55, 1.65, 2.75, 3.85, 4.95, 6.05] as const;
const TRACK_IN = -1.9, TRACK_OUT = 6.3;

export function buildTrackChunk(ctx: KitChunkContext): KitChunk {
  const w = new ChunkWork(ctx);
  const za = 0, zb = -w.L;
  const rng = keyRng(w.segId, 'track', Math.round(w.s0 * 10));
  // —— 跑道面：按 1 拍 × 1.1 m 的块，颜色极轻微地抖（橡胶颗粒）——
  const stride = ctx.stride, s0 = ctx.seg.s0;
  for (let k = Math.floor((w.s0 - s0) / stride); s0 + k * stride < w.s1; k++) {
    const a = Math.max(w.s0, s0 + k * stride), b = Math.min(w.s1, s0 + (k + 1) * stride);
    if (b - a < 1e-4) continue;
    for (let x = TRACK_IN; x < TRACK_OUT - 1e-6; x += 1.1) {
      const x1 = Math.min(TRACK_OUT, x + 1.1);
      w.floor.flat(0, x, x1, w.z(a), w.z(b), shade(C.track, 0.96 + rng.next() * 0.08));
    }
    // 视觉节拍：内道白线外侧每拍一道短刻痕
    const sj = s0 + k * stride;
    if (w.owns(sj)) { const z = w.z(sj); w.floor.flat(0.002, -1.62, -1.47, z + 0.02, z - 0.02, mix(C.trackLine, C.track, 0.35)); }
  }
  for (const x of TRACK_LINES) w.floor.flat(0.001, x - 0.025, x + 0.025, za, zb, C.trackLine);
  // 起跑线（段首附近，横跨全部跑道）
  const startS = ctx.seg.s0 + 3 * stride;
  if (w.owns(startS)) { const z = w.z(startS); w.floor.flat(0.002, TRACK_IN, TRACK_OUT, z + 0.025, z - 0.025, C.trackLine); }
  // —— 内侧路牙（高出 6 cm）与内场草坪（修剪的深浅条纹）——
  w.stat.box([-1.97, 0.03, (za + zb) / 2], [0.14, 0.06, w.L], C.kerb, { faces: '+x+y-x' });
  w.spans(4, 0, 4, (a, b, k) => { w.floor.flat(0, -70, -2.04, w.z(a), w.z(b), k % 2 === 0 ? C.grass : C.grassDark); });
  // 外侧：水泥带、草地
  w.floor.flat(0, TRACK_OUT, 8.0, za, zb, 0x8a9294);
  w.floor.flat(0, 8.0, 70, za, zb, C.grassDark);
  // 外道上收着的一排栏架（道具，不在车道里）
  w.grid(2.2, 1.0, (s, k) => {
    const rr = keyRng(w.segId, 'hurdle', k);
    if (rr.next() < 0.35) return;
    const z = w.z(s), x = 4.4 + (rr.next() - 0.5) * 0.2;
    for (const dx of [-0.42, 0.42]) {
      w.stat.box([x + dx, 0.4, z], [0.04, 0.8, 0.04], 0x9aa3a6);
      w.stat.box([x + dx, 0.02, z + 0.18], [0.04, 0.04, 0.5], 0x9aa3a6);
    }
    w.stat.box([x, 0.76, z], [0.92, 0.1, 0.03], rr.next() < 0.5 ? 0xe0e4e5 : 0x2f3538);
  });
  // 铁丝网：立柱每 3 m，横丝三道
  const r = w.clip(w.s0, w.s1);
  if (r) {
    w.stat.box([8.2, 1.9, (za + zb) / 2], [0.03, 0.03, w.L], C.fence);
    w.stat.box([8.2, 1.1, (za + zb) / 2], [0.02, 0.02, w.L], C.fence);
    w.stat.box([8.2, 0.3, (za + zb) / 2], [0.02, 0.02, w.L], C.fence);
    if (w.q > 0) for (let y = 0.5; y < 1.9; y += 0.2) w.stat.box([8.2, y, (za + zb) / 2], [0.005, 0.005, w.L], mix(C.fence, 0x8a9294, 0.5), { faces: '-x' });
  }
  w.grid(3, 0, (s) => { w.stat.box([8.2, 1.0, w.z(s)], [0.06, 2.0, 0.06], C.fence); });
  // 看台：一段一段的台阶（水泥灰），后面一排树
  w.spans(24, 6, 18, (a, b, _k, first, last) => {
    const za2 = w.z(a), zb2 = w.z(b), zc = (za2 + zb2) / 2, len = b - a;
    for (let i = 0; i < 6; i++) {
      const x = 11 + i * 0.8, y = 0.4 + i * 0.4;
      w.stat.box([x, y / 2, zc], [0.8, y, len], shade(C.bleacher, 1 - i * 0.03), { faces: '+y-x' + (first ? '+z' : '') + (last ? '-z' : '') });
    }
  });
  if (w.q > 0) w.grid(7, 2, (s, k) => {
    const rr = keyRng(w.segId, 'trackTree', k);
    tree(w.stat, 17.5 + rr.next() * 2, w.z(s), rr, { trunk: C.trunk, trunk2: C.trunkPale, canopy: 0x4f5c55, canopy2: 0x57645c, h: 8, q: w.q });
  });
  // 内场远处的球门（白色门框，没有网）
  w.grid(40, 20, (s) => {
    const z = w.z(s), x = -26;
    w.stat.box([x, 1.2, z + 3.6], [0.1, 2.44, 0.1], 0xd4d8d8);
    w.stat.box([x, 1.2, z - 3.6], [0.1, 2.44, 0.1], 0xd4d8d8);
    w.stat.box([x, 2.44, z], [0.1, 0.1, 7.3], 0xd4d8d8);
  });
  // 远处：教学楼的剪影（阴天，冷灰），按 chunk 裁剪
  w.spans(30, 0, 26, (a, b, _k, first, last) => {
    const za2 = w.z(a), zb2 = w.z(b);
    w.stat.box([-48, 8, (za2 + zb2) / 2], [10, 16, b - a], 0x9aa2a6, { faces: '+x+y' + (first ? '+z' : '') + (last ? '-z' : '') });
    for (let f = 0; f < 4; f++) w.stat.wallX(-42.98, za2 - (first ? 1 : 0), zb2 + (last ? 1 : 0), 2 + f * 3.4, 3.4 + f * 3.4, 0x7f898e, 1);
  });
  for (const side of ['L', 'R'] as const) if (w.openings(side).length) openingPanels(w, side, 'bright', 0xa9b0b2, 0x8a9294);
  return w.finish();
}

export const trackKit: EnvKit = {
  id: 'track', owner: 'WP4', variants: TRACK_VARIANTS,
  build: buildTrackChunk,
  ambience: () => 'field',
  reverb: () => 'street',
};

registerKit(trackKit);
