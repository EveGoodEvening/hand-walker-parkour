// src/render/actors/planCache.ts —— 渲染端求解器路线的缓存（修复轮 U5）。WP5。
// 领跑者（Leader）和 oracle 替身（Doubles）都要按求解器路线摆姿势。以前它们各自在第一帧可见时现解一次（100–140 ms 的卡顿），
// 现在按「求解器 × 编译段」记住无参数调用的结果（WeakMap，换章后随段对象一起回收），读章时对用得到路线的段预热一次。
// 不改 sim/Solver.ts（归 U2）。
import type { Plan, SolverAPI } from '../../core/contracts';
import type { CompiledChapter, CompiledSegment } from '../../levels/schema';

const PLANS = new WeakMap<SolverAPI, WeakMap<CompiledSegment, Plan | null>>();

/** 段的求解器路线（跑段才有；同一个求解器、同一个编译段只求解一次）。 */
export function planFor(solver: SolverAPI, seg: CompiledSegment): Plan | null {
  let m = PLANS.get(solver);
  if (!m) { m = new WeakMap(); PLANS.set(solver, m); }
  if (m.has(seg)) return m.get(seg) ?? null;
  const p = seg.kind === 'run' ? solver.solve(seg) : null;
  m.set(seg, p);
  return p;
}

/** 这一段会不会用到路线：领跑者（追随者 ahead）或 oracle 替身。 */
export function needsPlan(seg: CompiledSegment): boolean {
  if (seg.kind !== 'run') return false;
  const def = seg.def as { follower?: { mode?: string } };
  if (def.follower?.mode === 'ahead') return true;
  return /"source":"oracle"|"mode":"ahead"/.test(JSON.stringify(seg.def));
}

/** 读章时预热：对用得到路线的段各求解一次。 */
export function prewarmPlans(solver: SolverAPI, ch: CompiledChapter): void {
  for (const seg of ch.segments) if (needsPlan(seg)) planFor(solver, seg);
}
