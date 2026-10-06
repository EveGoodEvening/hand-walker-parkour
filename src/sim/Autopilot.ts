// src/sim/Autopilot.ts —— 自动驾驶（DESIGN.md §2.8、§8.9-7、§8.10 WP1）。CORE 编写 perfect 初版，WP1 补全。
// perfect：每进一段（以及重来、跳转、意外受击之后）从模拟的**完整当前状态**求解一次（空中、伏低、腿部状态、减速中都照实带入），
//   按里程执行求解器给出的动作；掰正按腿偏移的反方向键。不开口（「不说话也一定有路」，求解用 noAsk）。
//   求解失败（例如受击后正卡在障碍里）时每 0.25 s 重试一次。
// human：见 HumanBot.ts（反应时间 250 ± 60 ms、5% 失误），难度报告用。
// 静场：需要输入时自动完成（按住 ↓ / 按一下 / 连按三下 / 任意键）。站立段：按住 ↑ 起身，走路时按 ← → 稳住（只影响画面）。
// 回头窗口：开始 0.5 拍后按一次回头（R10 保证这段时间没有必需动作）。
import type { Plan, PlanStep, SolverAPI } from '../core/contracts';
import type { Action, InputEvent, Lane, StandSnap } from '../core/types';
import type { CompiledSegment, StillInput } from '../levels/schema';
import { HumanBot } from './HumanBot';
import { StillPilot, type KeyEv } from './StillPilot';
import type { PaceState } from './Pace';
import type { PlayerState } from './Player';
import type { SolveOptions } from './Solver';

export interface AutopilotView {
  seg(): CompiledSegment;
  segKind(): 'run' | 'still' | 'stand';
  s(): number; tSeg(): number; laneTarget(): Lane; tMs(): number;
  stillInput(): StillInput | null; stillWaiting(): boolean;
  lookAvailable(): boolean; beat(): number; lookWindowFrom(): number | null;
  cadenceMul(): number;
  /** WP1：模拟的完整状态（求解器从这里开始）。 */
  player(): PlayerState;
  pace(): PaceState;
  ask(): { asked: readonly number[]; parts: ReadonlyArray<readonly [number, number]>; used: number };
  /** 站立段快照（非站立段为 null）。 */
  stand(): StandSnap | null;
  /** 章种子（机器人 rng 的默认种子）。 */
  seed(): number;
  /** 受击计数（机器人用来察觉意外）。 */
  hits(): number;
}

export class Autopilot {
  mode: 'off' | 'perfect' | 'human' = 'off';
  private plan: Plan | null = null;
  private planSeg = -1;
  private cursor = 0;
  private held = new Set<Action>();
  private pendingUp: Action[] = [];
  private lookedWindow = -1;
  private retryAt = -1;
  private readonly still = new StillPilot();
  readonly human: HumanBot;
  failed = false;

  constructor(private solver: SolverAPI) {
    this.human = new HumanBot(solver);
  }

  get active(): boolean { return this.mode !== 'off'; }

  /** 需要重新求解（进段、重来、跳转、受击）。 */
  invalidate(): void {
    this.plan = null; this.planSeg = -1; this.cursor = 0; this.held.clear(); this.pendingUp.length = 0; this.retryAt = -1;
    this.still.reset();
    this.human.invalidate();
  }

  currentPlan(): Plan | null { return this.mode === 'human' ? this.human.currentPlan() : this.plan; }

  /** 生成本 tick 的输入。返回的 held 集合合并了人工输入。 */
  inputs(v: AutopilotView, base: readonly InputEvent[], baseHeld: ReadonlySet<Action>): { events: InputEvent[]; held: Set<Action> } {
    if (this.mode === 'human') return this.human.inputs(v, base, baseHeld);
    const events: InputEvent[] = [...base];
    const t = v.tMs();
    const push = (action: Action, phase: 'down' | 'up') => events.push({ action, phase, t, device: 'keyboard' });
    for (const a of this.pendingUp) push(a, 'up');
    this.pendingUp.length = 0;
    const seg = v.seg();
    let stillHeld: ReadonlySet<Action> = new Set();
    if (v.segKind() === 'run') {
      if ((!this.plan || this.planSeg !== seg.index) && (this.retryAt < 0 || t / 1000 >= this.retryAt)) {
        const opts: SolveOptions = {
          start: { p: v.player(), pace: v.pace(), asked: v.ask().asked, parts: v.ask().parts, asksUsed: v.ask().used },
          cadenceMul: v.cadenceMul(), noAsk: true,
        };
        this.plan = this.solver.solve(seg, opts);
        this.planSeg = this.plan ? seg.index : -1;
        this.cursor = 0;
        this.failed = !this.plan;
        this.retryAt = this.plan ? -1 : t / 1000 + 0.25;
        if (this.held.has('down')) { push('down', 'up'); this.held.delete('down'); }
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
            case 'straighten': {
              const a: Action = v.player().drDir === 1 ? 'left' : 'right';
              push(a, 'down'); this.pendingUp.push(a);
              break;
            }
            default: break;
          }
        }
      }
      // 回头窗口：开始 0.5 拍后回头一次（R10 保证这段时间没有必需动作）
      const wf = v.lookWindowFrom();
      if (v.lookAvailable() && wf !== null && v.beat() >= wf + 0.5 && this.lookedWindow !== Math.round(wf * 100) + seg.index * 1e6) {
        this.lookedWindow = Math.round(wf * 100) + seg.index * 1e6;
        push('look', 'down'); this.pendingUp.push('look');
      }
    } else {
      this.plan = null; this.planSeg = -1;
      if (this.held.size) { for (const a of this.held) push(a, 'up'); this.held.clear(); }
      const kev: KeyEv[] = [];
      stillHeld = this.still.step(v, 0, kev, true);
      for (const k of kev) push(k.action, k.phase);
    }
    const held = new Set<Action>(baseHeld);
    for (const h of this.held) held.add(h);
    for (const h of stillHeld) held.add(h);
    return { events, held };
  }
}
