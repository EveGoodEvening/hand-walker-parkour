// src/render/stairTread.ts —— 楼梯段画面上的踏面高度（stairs kit 与 NPC 共用，只管画面）。
// 编译段的 floorY 是一条连续的坡线（碰撞、Sim、求解器都用它）；stairs kit 画的是平的踏面：拍 k 的踏面覆盖 [k − 0.5, k + 0.5] 拍，
// 高度 = 坡线在 k 处的值。站在楼梯上的人按坡线摆会在踏面上浮起或陷进去半级（±7.5 cm），要按踏面摆。
import type { CompiledSegment, RunSegmentDef } from '../levels/schema';

/** 里程 s 所在踏面的中心里程（夹在段内）。 */
export function treadS(s: number, s0: number, s1: number, stride: number): number {
  const c = s0 + Math.floor((s - s0) / stride + 0.5) * stride;
  return Math.min(Math.max(c, s0), s1);
}

/** 画面上 s 处的地面高度：楼梯段取所在踏面的高度，别的段就是 floorY。 */
export function treadY(seg: Pick<CompiledSegment, 's0' | 's1' | 'stride' | 'floorY' | 'def'>, s: number): number {
  if (!(seg.def as RunSegmentDef).stairs) return seg.floorY(s);
  return seg.floorY(treadS(s, seg.s0, seg.s1, seg.stride));
}
