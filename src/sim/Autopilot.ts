// src/sim/Autopilot.ts —— 自动驾驶（DESIGN.md §2.8、§8.9-7）。CORE 编写 perfect；human 由 WP1 实现（CORE 版本退化为 perfect）。
// perfect：每进一段（以及重来、跳转、意外受击之后）从当前状态求解一次，按里程执行求解器给出的动作。
// 静场里需要输入时自动完成（按住 ↓ / 按一下）；回头窗口开始 0.5 拍后按一次回头。
import type { Plan, PlanStep, SolverAPI } from '../core/contracts';
import type { Action, InputEvent, Lane } from '../core/types';
import type { CompiledSegment, StillInput } from '../levels/schema';

export interface AutopilotView {
  seg(): CompiledSegment;
  segKind(): 'run' | 'still' | 'stand';
  s(): number; tSeg(): number; laneTarget(): Lane; tMs(): number;
  stillInput(): StillInput | null; stillWaiting(): boolean;
  lookAvailable(): boolean; beat(): number; lookWindowFrom(): number | null;
  cadenceMul(): number;
}

export class Autopilot {
  mode: 'off' | 'perfect' | 'human' = 'off';
  private plan: Plan | null = null;
  private planSeg = -1;
  private cursor = 0;
  private held = new Set<Action>();
  private pendingUp: Action[] = [];
  private lookedWindow = -1;
  private stillTapDone = false;
  failed = false;

  constructor(private solver: SolverAPI) {}

  get active(): boolean { return this.mode !== 'off'; }

  /** 需要重新求解（进段、重来、跳转、受击）。 */
  invalidate(): void { this.plan = null; this.planSeg = -1; this.cursor = 0; this.held.clear(); this.pendingUp.length = 0; this.stillTapDone = false; }

  currentPlan(): Plan | null { return this.plan; }

  /** 生成本 tick 的输入。返回的 held 集合合并了人工输入。 */
  inputs(v: AutopilotView, base: readonly InputEvent[], baseHeld: ReadonlySet<Action>): { events: InputEvent[]; held: Set<Action> } {
    const events: InputEvent[] = [...base];
    const t = v.tMs();
    const push = (action: Action, phase: 'down' | 'up') => events.push({ action, phase, t, device: 'keyboard' });
    for (const a of this.pendingUp) push(a, 'up');
    this.pendingUp.length = 0;
    const seg = v.seg();
    if (v.segKind() === 'run') {
      if (!this.plan || this.planSeg !== seg.index) {
        this.plan = this.solver.solve(seg, { from: { s: v.s(), lane: v.laneTarget(), tSeg: v.tSeg() }, cadenceMul: v.cadenceMul() });
        this.planSeg = seg.index;
        this.cursor = 0;
        this.failed = !this.plan;
        this.stillTapDone = false;
        // 从中途开始时跳过已经过去的动作
        if (this.plan) while (this.cursor < this.plan.steps.length && ((this.plan.steps[this.cursor] as PlanStep).s ?? 0) < v.s() - 1e-6) this.cursor++;
      }
      const plan = this.plan;
      if (plan) {
        const s = v.s();
        while (this.cursor < plan.steps.length && ((plan.steps[this.cursor] as PlanStep).s ?? Infinity) <= s + 1e-9) {
          const st = plan.steps[this.cursor++] as PlanStep;
          switch (st.action) {
            case 'left': push('left', 'down'); this.pendingUp.push('left'); break;
            case 'right': push('right', 'down'); this.pendingUp.push('right'); break;
            case 'jump': push('up', 'down'); this.pendingUp.push('up'); break;
            case 'duck': push('down', 'down'); this.held.add('down'); break;
            case 'duckRelease': push('down', 'up'); this.held.delete('down'); break;
            default: break;
          }
        }
      }
      // 回头窗口：开始 0.5 拍后回头一次（R10 保证这段时间没有必需动作）
      const wf = v.lookWindowFrom();
      if (v.lookAvailable() && wf !== null && v.beat() >= wf + 0.5 && this.lookedWindow !== Math.round(wf * 100)) {
        this.lookedWindow = Math.round(wf * 100);
        push('look', 'down'); this.pendingUp.push('look');
      }
    } else {
      this.plan = null; this.planSeg = -1;
      const inp = v.stillInput();
      if (inp && v.stillWaiting()) {
        if (inp.mode === 'hold') { if (!this.held.has('down')) { push('down', 'down'); this.held.add('down'); } }
        else if (!this.stillTapDone || inp.mode === 'taps3') { push('down', 'down'); this.pendingUp.push('down'); this.stillTapDone = true; }
      } else if (this.held.has('down')) {
        push('down', 'up'); this.held.delete('down');
      }
      if (!v.stillWaiting()) this.stillTapDone = false;
    }
    const held = new Set<Action>(baseHeld);
    for (const h of this.held) held.add(h);
    return { events, held };
  }
}
