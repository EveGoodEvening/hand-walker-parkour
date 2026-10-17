// src/render/actors/ground.ts —— 楼梯的地面形状（视觉修复 actors-1，渲染用）。
// 模拟按连续的坡线 floorY 走（碰撞、求解器不变），kits/school/stairs.ts 却画一级一级的平踏面：拍 k 的踏面覆盖 [k − 0.5, k + 0.5] 拍，
// 高度 = 坡线在 k 处的值（限制在段内）。主角的手按在踏面上、追尾镜头按身后的台阶抬高，都按这里的公式；
// 与 kit 画出来的几何体是否一致由 tests/unit/actors/stairs.test.ts 直接构建 stairs kit 的 chunk 核对（公式不放进 WP1 / WP3 的文件）。
import { clamp } from '../../core/math';
import type { CompiledChapter, CompiledSegment, RunSegmentDef } from '../../levels/schema';
import type { GroundProfile } from './handCycle';

/** s 所在踏面的中心里程（限制在段内）。 */
export function stairStepCentre(s: number, segS0: number, segS1: number, stride: number): number {
  return clamp(segS0 + Math.floor((s - segS0) / stride + 0.5) * stride, segS0, segS1);
}

function isStairs(g: CompiledSegment | undefined): boolean {
  return !!g && g.kind === 'run' && !!(g.def as RunSegmentDef).stairs;
}

/** s 处地面（台阶踏面）的高度：楼梯段按踏面取，其他段就是 floorY。 */
export function stepFloorY(seg: CompiledSegment, s: number): number {
  return isStairs(seg) ? seg.floorY(stairStepCentre(s, seg.s0, seg.s1, seg.stride)) : seg.floorY(s);
}

/**
 * 章节的地面形状：按里程找所在的跑段（从当前段往两边找），楼梯段取踏面高度，斜率按坡线在 ±0.3 m 上的差分（进出楼梯时 0.6 m 内渐变）。
 * 复用同一个对象（不建闭包）。只在当前段或相邻段是楼梯时交给 CrawlInput，平地的姿势不变。
 */
export class ChapterGround implements GroundProfile {
  ch: CompiledChapter | null = null;
  seg = 0;
  /** 记下章节和当前段；返回当前段或相邻段有没有楼梯。 */
  active(ch: CompiledChapter | null, seg: number): boolean {
    this.ch = ch; this.seg = seg;
    if (!ch) return false;
    for (let k = Math.max(0, seg - 1); k <= Math.min(ch.segments.length - 1, seg + 1); k++) if (isStairs(ch.segments[k])) return true;
    return false;
  }
  private at(s: number): CompiledSegment | null {
    const segs = this.ch?.segments;
    if (!segs || !segs.length) return null;
    const c = Math.min(Math.max(0, this.seg), segs.length - 1);
    for (let d = 0; d <= 6; d++) {
      const g = segs[(d & 1) ? c + ((d + 1) >> 1) : c - (d >> 1)];   // c, c + 1, c − 1, c + 2, …
      if (g && g.kind === 'run' && s >= g.s0 && s < g.s1) return g;
    }
    return segs[c] as CompiledSegment;
  }
  stepY(s: number): number { const g = this.at(s); return g ? stepFloorY(g, s) : 0; }
  /** 坡线（模拟的 floorY）在 s 处的高度。 */
  rampY(s: number): number { const g = this.at(s); return g ? g.floorY(s) : 0; }
  slope(s: number): number { return (this.rampY(s + 0.3) - this.rampY(s - 0.3)) / 0.6; }
}
