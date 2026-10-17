// src/render/kits/school/seats.ts —— 教室课桌椅、食堂餐桌凳的排布（纯函数，Node 可测，不依赖 three）。
// kit 按它摆家具，WP6 的路边坐着的人（crowds.ts seatedRow）按它找座位：同一个来源，人才坐在 kit 自己的椅子、圆凳上，
// 不会另带一把椅子坐在过道里（视觉审查 school-sets-1 / -2、npc-seated-7）。
// 坐标一律用段内里程 s（世界 s），不是 chunk 局部 z：chunk 从段首按 hwChunkLen 切，排布相对段首对齐，所以与 chunk 的切法无关。
import { CHUNK_LEN } from '../../../core/constants';
import type { Lane } from '../../../core/types';
import { WALL_PERIOD } from '../../textures/school';

/** WP3 kit 的 chunk 长度：整 2 拍（ChunkStreamer 按它切段）。 */
export function hwChunkLen(stride: number): number {
  return 2 * Math.max(1, Math.round(CHUNK_LEN / (2 * stride))) * stride;
}

/** 墙面周期：chunk 长度整除（shell.ts makeEnv）。 */
export function wallPeriod(chunkLen: number): number {
  return chunkLen / Math.max(1, Math.round(chunkLen / WALL_PERIOD));
}

/** shell.ts stepsIn 的纯版本：[s0, s1) 内、相对段首 offset + k·step 的位置，离 chunk 两头 pad 以内的不要。 */
export function stepsBetween(segS0: number, s0: number, s1: number, step: number, offset = 0, pad = 0): number[] {
  const out: number[] = [];
  const k0 = Math.ceil((s0 + pad - segS0 - offset) / step - 1e-6);
  for (let k = k0; ; k++) {
    const s = segS0 + offset + k * step;
    if (s >= s1 - pad - 1e-6) break;
    out.push(s);
  }
  return out;
}

/** 按 ChunkStreamer 的切法逐个 chunk 回调（最后一个可能更短）。 */
function eachChunk(seg: SeatSeg, fn: (s0: number, s1: number) => void): void {
  const len = hwChunkLen(seg.stride);
  const n = Math.max(1, Math.ceil((seg.s1 - seg.s0) / len - 1e-6));
  for (let i = 0; i < n; i++) {
    const s0 = seg.s0 + i * len, s1 = Math.min(seg.s1, s0 + len);
    if (s1 - s0 < 0.05) continue;
    fn(s0, s1);
  }
}

export interface SeatSeg { s0: number; s1: number; stride: number }

// ——————————————————— 教室 ———————————————————
/** 课桌列的 |x|（低画质省掉最外一列）。 */
export const CLASS_DESK_X: readonly number[] = [1.78, 2.42, 3.5, 4.12];
export const CLASS_DESK_X_LOW: readonly number[] = [1.78, 2.42, 3.5];
/** 靠过道的一列：不随机缺座、不抖动，坐着的同学坐在这一列的椅子上。 */
export const CLASS_INNER_X = 1.78;
/** 椅子中心在课桌后方（+z，即 s 更小的一侧）0.42 m。 */
export const CLASS_CHAIR_DS = 0.42;
/** 门厅长度（段尾下一段不是教室时，前墙在段尾前 VESTIBULE）。 */
export const CLASS_VESTIBULE = 3.4;

/** 一个 chunk 里课桌行的 s（课桌中心）。roomEnd = min(chunk 尾, 前墙)。 */
export function classroomRowsIn(segS0: number, s0: number, s1: number, period: number, roomEnd: number): number[] {
  if (roomEnd <= s0 + 0.5) return [];
  const step = period / Math.max(1, Math.round(period / 1.33));
  return stepsBetween(segS0, s0, s1, step, 0.7, 0.25).filter((s) => s <= roomEnd - 0.9);
}

/** 整段教室的课桌行（vestibule = 段尾有门厅）。 */
export function classroomRows(seg: SeatSeg, vestibule: boolean): number[] {
  const period = wallPeriod(hwChunkLen(seg.stride));
  const frontS = vestibule ? seg.s1 - CLASS_VESTIBULE : Number.POSITIVE_INFINITY;
  const out: number[] = [];
  eachChunk(seg, (s0, s1) => { out.push(...classroomRowsIn(seg.s0, s0, s1, period, Math.min(s1, frontS))); });
  return out;
}

/** 伸脚的人（footOut）坐在哪一侧：车道的符号，中道按 id 奇偶（archetypes/footOut.ts footSide 调用它）。 */
export function footOutSide(lanes: readonly Lane[], id: number): 1 | -1 {
  const lane = lanes[0] ?? 0;
  if (lane < 0) return -1;
  if (lane > 0) return 1;
  return id % 2 === 0 ? 1 : -1;
}

export interface FootSeat { s: number; side: 1 | -1 }
/** 段里伸脚的人坐的位置（碰撞盒中心的 s 与一侧）。 */
export function footOutSeats(obstacles: ReadonlyArray<{ kind: string; lanes: readonly Lane[]; id: number; s0: number; s1: number }>): FootSeat[] {
  const out: FootSeat[] = [];
  for (const o of obstacles) if (o.kind === 'footOut') out.push({ s: (o.s0 + o.s1) / 2, side: footOutSide(o.lanes, o.id) });
  return out;
}

/**
 * 伸脚的人坐在靠过道那一列（|x| ≈ 1.82），带着自己的椅子：这一行同侧靠过道的课桌椅不摆，免得椅子叠椅子。
 * 课桌椅占 [行 − 0.62, 行 + 0.22]，伸脚的人约占 ±0.3。
 */
export function classroomFootClash(row: number, side: 1 | -1, feet: readonly FootSeat[]): boolean {
  return feet.some((f) => f.side === side && row - 0.62 < f.s + 0.3 && row + 0.22 > f.s - 0.3);
}

// ——————————————————— 食堂 ———————————————————
/** 连体餐桌的 x（左侧打饭台下的一列不摆）。 */
export function canteenTableXs(look: { windows: boolean; counter: boolean }): number[] {
  const xs = look.windows ? [2.85, 4.45] : [-4.45, -2.85, 2.85, 4.45];
  return look.counter ? xs.filter((x) => x >= -3.5) : xs;
}
/** 靠过道的一列餐桌：不随机缺桌、不抖动，坐着的人坐在这一列的圆凳上。 */
export const CANTEEN_INNER_X = 2.85;
/** 圆凳相对桌子中心（桌子不转时）：x ± STOOL_DX，s ± STOOL_DS。 */
export const STOOL_DX = 0.35;
export const STOOL_DS = 0.55;
/** 方柱：x = ±1.95，0.5 m 见方（底部包边 0.52）。 */
export const CANTEEN_PILLAR_X = 1.95;
export const CANTEEN_PILLAR_HALF = 0.26;

export function canteenRowStep(period: number): number { return period / Math.max(1, Math.round(period / 1.9)); }

/** 一个 chunk 里餐桌行的 s（桌子中心）。 */
export function canteenRowsIn(segS0: number, s0: number, s1: number, period: number): number[] {
  const step = canteenRowStep(period);
  return stepsBetween(segS0, s0, s1, step, step / 2, 0.6);
}

/** 一个 chunk 里方柱的 s。 */
export function canteenPillarsIn(segS0: number, s0: number, s1: number, period: number): number[] {
  return stepsBetween(segS0, s0, s1, period * 2, period, 0.3);
}

/** 整段食堂的餐桌行与方柱。 */
export function canteenLayout(seg: SeatSeg): { rows: number[]; pillars: number[] } {
  const period = wallPeriod(hwChunkLen(seg.stride));
  const rows: number[] = [], pillars: number[] = [];
  eachChunk(seg, (s0, s1) => { rows.push(...canteenRowsIn(seg.s0, s0, s1, period)); pillars.push(...canteenPillarsIn(seg.s0, s0, s1, period)); });
  return { rows, pillars };
}
