// src/sim/HumanBot.ts —— human 机器人（DESIGN.md §2.8、§8.10 WP1 验收 6）。WP1。难度报告用（scripts/bot-difficulty.mjs）。
// 模型（只用 rng.bot，与模拟的 rng.sim 互不影响）：
//   · 路线：和 perfect 一样从模拟的当前状态求解（滚动视野 45 m），但执行时带人的误差。
//   · 可预见的动作（看得见的障碍，R4 保证提前 ≥ 1.2 s 可读）：按计划时刻 ± 定时误差执行，误差 ~ N(0, 60 ms)
//     （「反应时间 250 ± 60 ms」的离散部分；均值部分被「提前看见」抵消）。
//   · 意外（腿自主抬起、腿偏移的预警，受击，自己按错之后）：必须等反应时间 ~ N(250, 60) ms 之后才能动。
//   · 5% 失误：换道按反方向，或者输入晚 150 ms（非换道动作只有后者）。按错方向后过一个反应时间重新规划。
//   · 不开口（「让一下」）；回头窗口里 70% 的概率在随机时刻回头。静场、站立段按提示在反应时间之后照做。
// 评审 U2（以前的机器人照求解器的「最后一刻闪避」执行，再叠上 ±60 ms 的抖动就撞上，4-5 @144、5-3 @110 的超标是假阳性）：
//   · 规划先按 0.25 m 的碰撞余量求解（人不会贴着障碍过），无解再退回求解器缺省的 0.05 m。
//   · 换道：求解时加 laneLead 代价（Solver.ts），躲障碍的换道在接触前 ~ N(0.3, 0.1) s 完成，做不到时尽早（每次规划抽一次）。
//   · 横档：提前 ~ N(0.3, 0.08) s 按下 ↓ 并一直按住，过了横档再松手（不再只按最短的 2 拍）；不早于上一次撑跃落地（空中按 ↓ 是速降）。
//     相邻的横档合并成一次按住。腿自主抬起的那一下 ↓ 仍要等预警之后一个反应时间。
//   · 纸条：每张约 50% 的概率去捡（求解器只会每张都捡），不捡的从规划用的段里拿掉。
//   · 统计 laneLead：每次躲障碍的换道（原车道前方 3 s 内有必需障碍、目标车道没有它）从按键到接触的提前量。
import type { Plan, PlanStep, SolverAPI } from '../core/contracts';
import { LANE_WIDTH, TICK_DT } from '../core/constants';
import { clamp } from '../core/math';
import { createRng, type Mulberry32 } from '../core/rng';
import type { Action, InputEvent, Lane } from '../core/types';
import { obstacleX } from '../levels/compile';
import type { CompiledObstacle, CompiledSegment } from '../levels/schema';
import type { AutopilotView } from './Autopilot';
import { advancePace, clonePace, nominalCadence, paceEvents, type PaceState } from './Pace';
import { jumpDuration } from './Player';
import { StillPilot } from './StillPilot';
import { motionEvents, type SolveOptions } from './Solver';
import { obstacleState, type ObstacleState } from './Track';
import { TUNING } from './tuning';

export const HUMAN = {
  reactMean: 0.25, reactSd: 0.06, jitterSd: 0.06, errorRate: 0.05, lateSec: 0.15, horizon: 45, lookChance: 0.7,
  /** 规划用的碰撞余量（米）：先按它求解，无解再退回求解器缺省的 0.05。 */
  margin: 0.25,
  /** 躲障碍的换道提前量 ~ N(0.3, 0.1) s，夹在 [0.1, 0.6]（每次规划抽一次，交给求解器的 laneLead）。 */
  laneLeadMean: 0.3, laneLeadSd: 0.1,
  /** 横档：提前 ~ N(0.3, 0.08) s 按下 ↓，夹在 [0.15, 0.5]；过了横档后沿再多按住 0.1 m。 */
  duckLeadMean: 0.3, duckLeadSd: 0.08, duckPast: 0.1,
  /** 每张纸条去捡的概率。 */
  noteChance: 0.5,
  /** laneLead 统计：原车道前方多少秒内的必需障碍算「在躲它」。 */
  dodgeHorizon: 3,
} as const;

interface Sched { s: number; action: Action; phase: 'down' | 'up'; kind: 'primary' | 'release' | 'aux'; wrong?: boolean; lane?: boolean }

const REQUIRED: ReadonlySet<string> = new Set(['low', 'bar', 'block']);

function gauss(r: Mulberry32): number {
  const u = Math.max(1e-12, r.next()), v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 障碍此刻是否算「挡在 lane 上」（周期障碍不论开合都算）。 */
function covers(o: CompiledObstacle, st: ObstacleState, lane: number): boolean {
  if (!st.active && o.behavior.type !== 'swing' && o.behavior.type !== 'stretch') return false;
  const x = lane * LANE_WIDTH;
  return st.x0 < x + 0.22 && st.x1 > x - 0.22;
}

/** 计划里的一次伏低要钻的横档：该车道上、伏低点前方 4 m 内最近的 bar（没有则是为了压住腿等，返回 null）。 */
function barAhead(seg: CompiledSegment, sp: number, lane: Lane): CompiledObstacle | null {
  let best: CompiledObstacle | null = null;
  const x = lane * LANE_WIDTH;
  for (const o of seg.obstacles) {
    if (o.cls !== 'bar' || o.s1 < sp || o.s0 > sp + 4) continue;
    const [x0, x1] = obstacleX(o);
    if (!(x0 < x + 0.22 && x1 > x - 0.22)) continue;
    if (!best || o.s0 < best.s0) best = o;
  }
  return best;
}

/**
 * 规划时的名义时间轴（从此刻的 Pace 状态往前推，含减速、停拍、段中换挡与全局倍率，不含受击）：
 * 把「提前 / 推迟多少秒」换成里程。以前用此刻的速度换算，段首第一 tick 速度还是 0，提前量就没了。
 */
class Timeline {
  private t: number[] = [];
  private s: number[] = [];
  build(seg: CompiledSegment, pace: PaceState, mul: number, untilS: number): this {
    const p = clonePace(pace);
    const evs = paceEvents(seg);
    this.t = [p.tSeg]; this.s = [p.s];
    const t0 = p.tSeg;
    while (p.s < untilS && p.tSeg - t0 < 30 && !p.ended) {
      advancePace(seg, p, evs, mul, TICK_DT);
      this.t.push(p.tSeg); this.s.push(p.s);
    }
    return this;
  }
  /** 里程 → 段内时间（超出范围按两端的速度外推）。 */
  tAt(s: number): number { return interp(this.s, this.t, s); }
  /** 段内时间 → 里程。 */
  sAt(t: number): number { return interp(this.t, this.s, t); }
  /** 在里程 s 处挪动 dt 秒后的里程。 */
  shift(s: number, dt: number): number { return this.sAt(this.tAt(s) + dt); }
}
/** 单调（不减）数组 xs → ys 的线性插值；两端按最后一段的斜率外推（斜率为 0 时夹住）。 */
function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return x;
  if (n === 1) return ys[0] as number;
  let lo = 0, hi = n - 1;
  if (x <= (xs[0] as number)) { lo = 0; hi = 1; } else if (x >= (xs[n - 1] as number)) { lo = n - 2; hi = n - 1; } else {
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((xs[m] as number) <= x) lo = m; else hi = m; }
  }
  // 停拍里里程不变：在相同 x 的一串里取最后一个
  while (hi < n - 1 && (xs[hi] as number) === (xs[lo] as number)) { lo = hi; hi++; }
  const x0 = xs[lo] as number, x1 = xs[hi] as number, y0 = ys[lo] as number, y1 = ys[hi] as number;
  return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
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
  /** 每张纸条捡不捡（障碍 id → 捡）。进段、重来时重新决定。 */
  private noteTake = new Map<number, boolean>();
  private readonly ost: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  /**
   * 统计（测试与难度报告用）：执行过的输入数与失误数；laneLeadSum / laneLeadN：躲障碍的换道从按键到接触的提前量（秒）之和与次数；
   * notesSeen / notesSkipped：决定过的纸条数与决定不捡的数。
   */
  readonly stats = { inputs: 0, errors: 0, wrongDir: 0, late: 0, replans: 0, laneLeadSum: 0, laneLeadN: 0, notesSeen: 0, notesSkipped: 0 };

  constructor(private solver: SolverAPI) {}

  /** 机器人的种子（rng.bot）。不设时取章种子。 */
  setSeed(seed: number): void { this.seedSet = seed >>> 0; this.rng = createRng(this.seedSet, 'bot'); }

  invalidate(): void {
    this.plan = null; this.planSeg = -1; this.queue = []; this.replanAt = -1;
    this.still.reset(); this.stillDelay = -1;
    this.noteTake.clear();
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
      // 滚动视野：快到头时续一段；按着 ↓（长伏低、压腿）时先不续，免得续规划时松手
      const needPlan = !this.plan || this.planSeg !== seg.index || (s >= this.planUntil - 10 && !this.held.has('down'));
      if (needPlan && (this.replanAt < 0 || t >= this.replanAt)) this.replan(v, push);
      // 执行到期的动作
      while (this.queue.length && (this.queue[0] as Sched).s <= s + 1e-9) {
        const q = this.queue.shift() as Sched;
        if (q.lane && !q.wrong) this.recordLead(v, q.action === 'left' ? -1 : 1);
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

  /**
   * laneLead 统计：此刻按下的换道是不是在躲障碍——原车道（laneTarget）前方 dodgeHorizon 秒内最近的必需障碍，
   * 目标车道上没有它。是的话记下从按键到接触（障碍前沿到玩家盒前沿 ÷ 当前速度）的秒数。
   */
  private recordLead(v: AutopilotView, dir: -1 | 1): void {
    const seg = v.seg();
    const P = v.player();
    const from = P.laneTarget, to = from + dir;
    if (to < -1 || to > 1) return;
    const speed = Math.max(0.5, v.pace().base * v.cadenceMul() * P.hitMul);
    const front = v.s() + TUNING.hitbox.sFront;
    const tSeg = v.tSeg(), beat = v.beat();
    let best = Infinity;
    let bestCoversTo = false;
    for (const o of seg.obstacles) {
      if (!REQUIRED.has(o.cls)) continue;
      const st = obstacleState(o, tSeg, beat, this.ost);
      const ahead = o.s0 + st.ds - front;
      if (ahead < 0 || ahead > HUMAN.dodgeHorizon * speed || ahead >= best || !covers(o, st, from)) continue;
      best = ahead;
      bestCoversTo = covers(o, st, to);
    }
    if (best === Infinity || bestCoversTo) return;
    this.stats.laneLeadSum += best / speed;
    this.stats.laneLeadN++;
  }

  /** 这次规划要不要捡视野里的纸条（每张决定一次）；不捡的从规划用的段里拿掉。 */
  private notesFor(seg: CompiledSegment, s: number): CompiledSegment {
    let skip: number[] | null = null;
    for (const o of seg.obstacles) {
      if (o.cls !== 'pickup' || o.s1 < s || o.s0 > s + HUMAN.horizon + 5) continue;
      let take = this.noteTake.get(o.id);
      if (take === undefined) {
        take = this.rng.next() < HUMAN.noteChance;
        this.noteTake.set(o.id, take);
        this.stats.notesSeen++;
        if (!take) this.stats.notesSkipped++;
      }
      if (!take) (skip ??= []).push(o.id);
    }
    if (!skip) return seg;
    const drop = skip;
    return { ...seg, obstacles: seg.obstacles.filter((o) => !drop.includes(o.id)) };
  }

  private replan(v: AutopilotView, push: (a: Action, p: 'down' | 'up') => void): void {
    this.stats.replans++;
    const seg = v.seg();
    if (this.held.has('down')) { push('down', 'up'); this.held.delete('down'); }
    this.queue = [];
    const s = v.s();
    const r = this.rng;
    const laneLead = clamp(HUMAN.laneLeadMean + HUMAN.laneLeadSd * gauss(r), 0.1, 0.6);
    const segUse = this.notesFor(seg, s);
    const opts: SolveOptions = {
      start: { p: v.player(), pace: v.pace(), asked: v.ask().asked, parts: v.ask().parts, asksUsed: v.ask().used },
      cadenceMul: v.cadenceMul(), noAsk: true, untilS: s + HUMAN.horizon, laneLead,
    };
    const withMargin: SolveOptions = { ...opts, margin: HUMAN.margin };
    this.plan = this.solver.solve(segUse, withMargin) ?? this.solver.solve(segUse, opts);
    this.planSeg = seg.index;
    this.planUntil = s + HUMAN.horizon;
    this.replanAt = -1;
    if (!this.plan) { this.replanAt = v.tMs() / 1000 + 0.25; this.planSeg = -1; return; }
    const plan = this.plan;
    const P = v.player();
    const tl = new Timeline().build(seg, v.pace(), v.cadenceMul(), s + HUMAN.horizon + 10);
    const mev = motionEvents(seg);
    const steps = plan.steps as readonly PlanStep[];
    // 撑跃落地之前不能按 ↓（空中按 ↓ 是速降）：提前按 ↓ 不早于这个里程
    let landS = P.air ? tl.shift(s, Math.max(0, P.airDur - P.airT)) : s;
    let hold: Sched | null = null;            // 正在提前按住 ↓ 的那次松手（相邻横档合并）
    const ownRelease = new Set<number>();      // 由机器人自己安排松手的伏低：计划里的 duckRelease 不用
    let shift = 0;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i] as PlanStep;
      const sp = st.s ?? s;
      if (st.action === 'duckRelease') {
        if (!ownRelease.has(i)) this.queue.push({ s: sp + shift, action: 'down', phase: 'up', kind: 'release' });
        continue;
      }
      this.stats.inputs++;
      let dt = HUMAN.jitterSd * gauss(r);
      let wrong = false;
      if (r.next() < HUMAN.errorRate) {
        this.stats.errors++;
        if ((st.action === 'left' || st.action === 'right') && r.next() < 0.5) { wrong = true; this.stats.wrongDir++; }
        else { dt = Math.abs(dt) + HUMAN.lateSec; this.stats.late++; }
      }
      let sExec = tl.shift(sp, dt);
      // 横档：提前按下、按住到过了横档
      const bar = st.action === 'duck' ? barAhead(seg, sp, plan.laneAt(sp)) : null;
      if (bar) {
        const lead = clamp(HUMAN.duckLeadMean + HUMAN.duckLeadSd * gauss(r), 0.15, 0.5);
        sExec = Math.max(landS, tl.shift(sp, dt - lead));
      }
      // 意外：腿自主抬起 / 腿偏移的预警开始之后，至少要过一个反应时间才能响应
      if (st.action === 'duck' || st.action === 'straighten') {
        for (const e of mev) {
          const ws = seg.s0 + e.at * seg.stride;
          const relevant = st.action === 'straighten' ? e.body.type === 'drift' : e.body.type === 'twitch';
          if (relevant && sp >= ws - 0.05 && sp <= tl.shift(ws, TUNING.twitch.warn + TUNING.twitch.rise)) {
            sExec = Math.max(sExec, tl.shift(ws, this.react()));
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
        const e = mev.find((m) => m.body.type === 'drift' && Math.abs(tl.tAt(seg.s0 + m.at * seg.stride) - tl.tAt(sp)) < 6);
        if (e && e.body.type === 'drift') action = e.body.dir === 1 ? 'left' : 'right';
      }
      if (st.action === 'jump') {
        const beat = (sp - seg.s0) / seg.stride;
        landS = Math.max(landS, tl.shift(sExec, jumpDuration(nominalCadence(seg, v.pace(), beat)) + 0.03));
      }
      if (bar) {
        // 松手：过了横档后沿（伏低时玩家盒向后伸 duckS）再多一点，且不早于计划里的松手；之后略晚一点是人的习惯
        let j = i + 1;
        while (j < steps.length && (steps[j] as PlanStep).action !== 'duckRelease') j++;
        const planned = j < steps.length ? ((steps[j] as PlanStep).s ?? sp) : sp;
        if (j < steps.length) ownRelease.add(j);
        const sRel = tl.shift(Math.max(planned, bar.s1 + TUNING.hitbox.duckS + HUMAN.duckPast), Math.abs(gauss(r)) * HUMAN.jitterSd);
        if (hold && sExec <= hold.s + 1e-9) { hold.s = Math.max(hold.s, sRel); continue; }   // 还按着：接着按住
        hold = { s: sRel, action: 'down', phase: 'up', kind: 'release' };
        this.queue.push({ s: sExec, action: 'down', phase: 'down', kind: 'primary' }, hold);
        continue;
      }
      const q: Sched = { s: sExec, action, phase: 'down', kind: 'primary' };
      if (wrong) q.wrong = true;
      if (st.action === 'left' || st.action === 'right') q.lane = true;
      this.queue.push(q);
    }
    this.queue.sort((a, b) => a.s - b.s);
  }
}
