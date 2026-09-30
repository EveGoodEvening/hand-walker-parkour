// src/sim/HumanBot.ts —— human 机器人（DESIGN.md §2.8、§8.10 WP1 验收 6）。WP1。难度报告用（scripts/bot-difficulty.mjs）。
// 模型（只用 rng.bot，与模拟的 rng.sim 互不影响）：
//   · 路线：和 perfect 一样从模拟的当前状态求解（滚动视野 45 m），但执行时带人的误差。
//   · 可预见的动作（看得见的障碍，R4 保证提前 ≥ 1.2 s 可读）：按计划时刻 ± 定时误差执行，误差 ~ N(0, 60 ms)
//     （「反应时间 250 ± 60 ms」的离散部分；均值部分被「提前看见」抵消）。
//   · 意外（腿自主抬起、腿偏移的预警，受击，自己按错之后）：必须等反应时间 ~ N(250, 60) ms 之后才能动。
//   · 5% 失误：换道按反方向，或者输入晚 150 ms（非换道动作只有后者）。按错方向后过一个反应时间重新规划。
//   · 不开口（「让一下」）；回头窗口里 70% 的概率在随机时刻回头。静场、站立段按提示在反应时间之后照做。
import type { Plan, PlanStep, SolverAPI } from '../core/contracts';
import { createRng, type Mulberry32 } from '../core/rng';
import type { Action, InputEvent } from '../core/types';
import type { AutopilotView } from './Autopilot';
import { StillPilot } from './StillPilot';
import { motionEvents, type SolveOptions } from './Solver';
import { TUNING } from './tuning';

export const HUMAN = {
  reactMean: 0.25, reactSd: 0.06, jitterSd: 0.06, errorRate: 0.05, lateSec: 0.15, horizon: 45, lookChance: 0.7,
} as const;

interface Sched { s: number; action: Action; phase: 'down' | 'up'; kind: 'primary' | 'release' | 'aux'; wrong?: boolean }

function gauss(r: Mulberry32): number {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class HumanBot {
  private rng: Mulberry32 = createRng(1, 'bot');
  private seedSet: number | null = null;
  private plan: Plan | null = null;
  private planSeg = -1;
  private planUntil = 0;
  private queue: Sched[] = [];
  private held = new Set<Action>();
  private pendingUp: Action[] = [];
  private replanAt = -1;
  private lastHits = -1;
  private lookDecided = -1;
  private lookAt = -1;
  private readonly still = new StillPilot();
  private stillDelay = -1;
  /** 统计：执行过的输入数与失误数（测试用）。 */
  readonly stats = { inputs: 0, errors: 0, wrongDir: 0, late: 0, replans: 0 };

  constructor(private solver: SolverAPI) {}

  /** 机器人的种子（rng.bot）。不设时取章种子。 */
  setSeed(seed: number): void { this.seedSet = seed >>> 0; this.rng = createRng(this.seedSet, 'bot'); }

  invalidate(): void {
    this.plan = null; this.planSeg = -1; this.queue = []; this.replanAt = -1;
    this.still.reset(); this.stillDelay = -1;
    for (const a of this.held) this.pendingUp.push(a);
    this.held.clear();
  }

  currentPlan(): Plan | null { return this.plan; }

  private react(): number { return Math.max(0.12, Math.min(0.45, HUMAN.reactMean + HUMAN.reactSd * gauss(this.rng))); }

  inputs(v: AutopilotView, base: readonly InputEvent[], baseHeld: ReadonlySet<Action>): { events: InputEvent[]; held: Set<Action> } {
    if (this.seedSet === null && this.lastHits < 0) this.rng = createRng(v.seed(), 'bot');
    const events: InputEvent[] = [...base];
    const tMs = v.tMs();
    const t = tMs / 1000;
    const push = (action: Action, phase: 'down' | 'up') => events.push({ action, phase, t: tMs, device: 'keyboard' });
    for (const a of this.pendingUp) push(a, 'up');
    this.pendingUp.length = 0;
    const seg = v.seg();
    const hits = v.hits();
    if (this.lastHits >= 0 && hits > this.lastHits && v.segKind() === 'run') {
      // 意外：受击之后反应一下再重新规划
      this.queue = this.queue.filter((q) => q.kind === 'release');
      this.plan = null;
      this.replanAt = t + this.react();
    }
    this.lastHits = hits;
    let extraHeld: ReadonlySet<Action> = new Set();
    if (v.segKind() === 'run') {
      const s = v.s();
      const needPlan = !this.plan || this.planSeg !== seg.index || s >= this.planUntil - 10;
      if (needPlan && (this.replanAt < 0 || t >= this.replanAt)) this.replan(v, push);
      // 执行到期的动作
      while (this.queue.length && (this.queue[0] as Sched).s <= s + 1e-9) {
        const q = this.queue.shift() as Sched;
        if (q.phase === 'down') this.held.add(q.action); else this.held.delete(q.action);
        push(q.action, q.phase);
        if (q.kind !== 'release' && q.phase === 'down' && q.action !== 'down') this.pendingUp.push(q.action), this.held.delete(q.action);
        if (q.wrong) {
          // 按错方向：反应过来之后重新规划
          this.queue = this.queue.filter((x) => x.kind === 'release');
          this.plan = null;
          this.replanAt = t + this.react();
        }
      }
      // 回头窗口：70% 的概率在窗口里的随机时刻回头
      const wf = v.lookWindowFrom();
      if (v.lookAvailable() && wf !== null) {
        const key = seg.index * 1e6 + Math.round(wf * 100);
        if (this.lookDecided !== key) {
          this.lookDecided = key;
          this.lookAt = this.rng.next() < HUMAN.lookChance ? t + this.react() + this.rng.next() * 1.0 : -1;
        }
        if (this.lookAt >= 0 && t >= this.lookAt) { push('look', 'down'); this.pendingUp.push('look'); this.lookAt = -1; }
      }
    } else {
      this.plan = null; this.planSeg = -1; this.queue = [];
      if (this.held.size) { for (const a of this.held) push(a, 'up'); this.held.clear(); }
      if (v.stillWaiting() && this.stillDelay < 0) this.stillDelay = this.react();
      if (!v.stillWaiting()) this.stillDelay = -1;
      const kev: Array<{ action: Action; phase: 'down' | 'up' }> = [];
      extraHeld = this.still.step(v, Math.max(0, this.stillDelay), kev, this.rng.next() < 0.5);
      for (const k of kev) push(k.action, k.phase);
    }
    const held = new Set<Action>(baseHeld);
    for (const h of this.held) held.add(h);
    for (const h of extraHeld) held.add(h);
    return { events, held };
  }

  private replan(v: AutopilotView, push: (a: Action, p: 'down' | 'up') => void): void {
    this.stats.replans++;
    const seg = v.seg();
    if (this.held.has('down')) { push('down', 'up'); this.held.delete('down'); }
    this.queue = [];
    const s = v.s();
    const opts: SolveOptions = {
      start: { p: v.player(), pace: v.pace(), asked: v.ask().asked, parts: v.ask().parts, asksUsed: v.ask().used },
      cadenceMul: v.cadenceMul(), noAsk: true, untilS: s + HUMAN.horizon,
    };
    this.plan = this.solver.solve(seg, opts);
    this.planSeg = seg.index;
    this.planUntil = s + HUMAN.horizon;
    this.replanAt = -1;
    if (!this.plan) { this.replanAt = v.tMs() / 1000 + 0.25; this.planSeg = -1; return; }
    const speed = Math.max(0.5, v.pace().base * v.cadenceMul());
    const mev = motionEvents(seg);
    const tNow = v.tMs() / 1000;
    const steps = this.plan.steps as readonly PlanStep[];
    let shift = 0;
    for (const st of steps) {
      const sp = st.s ?? s;
      if (st.action === 'duckRelease') { this.queue.push({ s: sp + shift, action: 'down', phase: 'up', kind: 'release' }); continue; }
      this.stats.inputs++;
      let dt = HUMAN.jitterSd * gauss(this.rng);
      let wrong = false;
      if (this.rng.next() < HUMAN.errorRate) {
        this.stats.errors++;
        if ((st.action === 'left' || st.action === 'right') && this.rng.next() < 0.5) { wrong = true; this.stats.wrongDir++; }
        else { dt = Math.abs(dt) + HUMAN.lateSec; this.stats.late++; }
      }
      let sExec = sp + dt * speed;
      // 意外：腿自主抬起 / 腿偏移的预警开始之后，至少要过一个反应时间才能响应
      if (st.action === 'duck' || st.action === 'straighten') {
        for (const e of mev) {
          const ws = seg.s0 + e.at * seg.stride;
          const relevant = st.action === 'straighten' ? e.body.type === 'drift' : e.body.type === 'twitch';
          if (relevant && sp >= ws - 0.05 && sp <= ws + (TUNING.twitch.warn + TUNING.twitch.rise) * speed) {
            sExec = Math.max(sExec, ws + this.react() * speed);
          }
        }
      }
      // 已经过去的动作（求解起点之前）立即执行
      sExec = Math.max(sExec, s);
      shift = sExec - sp;
      let action: Action;
      switch (st.action) {
        case 'left': action = wrong ? 'right' : 'left'; break;
        case 'right': action = wrong ? 'left' : 'right'; break;
        case 'jump': action = 'up'; break;
        case 'duck': action = 'down'; break;
        case 'straighten': action = v.player().drDir === 1 ? 'left' : 'right'; break;
        default: continue;
      }
      if (st.action === 'straighten') {
        // 掰正的方向由执行时的偏移决定：记下偏移方向（事件的 dir）
        const e = mev.find((m) => m.body.type === 'drift' && Math.abs(seg.s0 + m.at * seg.stride - sp) < 6 * speed);
        if (e && e.body.type === 'drift') action = e.body.dir === 1 ? 'left' : 'right';
      }
      const q: Sched = { s: sExec, action, phase: 'down', kind: 'primary' };
      if (wrong) q.wrong = true;
      this.queue.push(q);
    }
    this.queue.sort((a, b) => a.s - b.s);
    void tNow;
  }
}
