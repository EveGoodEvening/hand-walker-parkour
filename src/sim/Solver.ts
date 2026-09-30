// src/sim/Solver.ts —— 求解器：车道 × 时间的 BFS（DESIGN.md §2.8 R2、§8.9-7、§8.10 WP1）。CORE 编写初版，WP1 补全。
// 步长 0.05 s（= 6 tick），两次输入至少相隔 minGap（缺省 0.22 s）。
// 支持：静止、周期（swing / stretch）、移动（walk）和到点（yield / shift / fallInto）障碍；停拍、减速、段中换挡（Pace）；
// 腿自主抬起（按住 ↓ 压住，或让它抬起来：碰撞盒 0.85 m、速度 ×0.85）；腿偏移（掰正，或被迫换道）；
// 「让一下」（noAsk = false 时可以开口，前方 6 m 内的人 0.5 s 后让开；noAsk = true 时只能靠自己）；
// 休息窗 forbid（校验器用：窗内不许开始新输入）。
// 做法：按时间分层的动态规划（等价于分层 BFS，按代价取最优）。每个节点保存一份 PlayerState + PaceState，
// 用与 Sim 完全相同的函数逐 tick 推进和判定碰撞，所以求出的路线在实际模拟里逐 tick 复现（自动驾驶按里程执行）。
// 代价：输入次数 × 10（开口 15、长按每拍 +0.5）+ 不在中道的时间 × 0.02 − 拾取纸条 × 25。
//
// 与冻结契约（core/contracts.ts）的关系：SolverAPI.solve(seg, opts) 照旧；本文件的 SolveOptions 是它的超集，
// 多出来的字段（untilS / start / maxSeconds）只给 WP1 自己的自动驾驶、领跑者和难度机器人用，调用时用变量传入。
// Plan 对象另带 asks（开口的里程）——PlanStep 的 action 联合里没有 'ask'，所以放在旁路字段里（见 contract-requests/WP1.md）。
import type { Plan, PlanStep, SolveFrom, SolverAPI } from '../core/contracts';
import { TICK_DT } from '../core/constants';
import type { AABB, Lane } from '../core/types';
import type { CompiledObstacle, CompiledSegment, EventBody, RunSegmentDef } from '../levels/schema';
import { askIgnores, askTargets } from './Ask';
import { classify, obstacleBox, playerBox, wouldHit } from './Collision';
import { driftCounter, driftStart, driftUpdate } from './Drift';
import { advancePace, clonePace, createPaceState, nominalCadence, paceEvents, type PaceEvent, type PaceState } from './Pace';
import { PlayerState } from './Player';
import { obstacleState, type ObstacleState } from './Track';
import { twitchSpeedMul, twitchStart, twitchUpdate } from './Twitch';
import { TUNING } from './tuning';

const GRID = 6;                       // tick / 格
const GRID_DT = GRID * TICK_DT;       // 0.05 s
/** 长按伏低的选项（从伏低开始算的拍数；0 = 点一下，最短 2 拍）。 */
const HOLD_BEATS = [3, 5, 7] as const;

type Act = 'none' | 'left' | 'right' | 'jump' | 'duck' | 'straighten' | 'ask';
type MotionBody = Extract<EventBody, { type: 'twitch' } | { type: 'drift' }>;
export interface MotionEvent { at: number; body: MotionBody }

interface Node {
  p: PlayerState;
  pace: PaceState;
  cost: number;
  lastInputTick: number;              // 距求解起点的 tick 序号
  busyUntilTick: number;
  /** ↓ 是否按住（腿自主抬起的「压住」只看这个）。 */
  keyDown: boolean;
  releaseTick: number;                // 点一下：这个 tick 松手（-1 = 无）
  releaseBeat: number;                // 长按：到这个段内拍号松手（-1 = 无）
  mCursor: number;                    // 下一个腿部事件（twitch / drift）的下标
  asksLeft: number;
  asked: number[];
  parts: number[];                    // [id, 段内时刻, id, 段内时刻, …]
  parent: Node | null;
  steps: PlanStep[];                  // 本格新增的动作
  askS: number[];                     // 本格新增的开口里程
  taken: number[];                    // 已拾取的纸条 id
  tick: number;
  done: boolean;
}

export interface SolveOptions {
  noAsk?: boolean; minGap?: number; cadenceMul?: number; from?: SolveFrom;
  forbid?: ReadonlyArray<readonly [number, number]>; margin?: number;
  /** WP1 扩展：到这个里程就算完成（领跑者、难度机器人的滚动求解）。 */
  untilS?: number;
  /** WP1 扩展：从模拟的完整状态开始（空中、伏低、腿部状态、减速中……）；给出时 from 只取 lane 以外的字段作参考。 */
  start?: { p: PlayerState; pace: PaceState; asked?: readonly number[]; parts?: ReadonlyArray<readonly [number, number]>; asksUsed?: number };
  /** WP1 扩展：展开的时间上限（秒）。 */
  maxSeconds?: number;
}

/** 求解结果：契约里的 Plan，另带开口的里程（旁路字段）。 */
export interface SolverPlan extends Plan { readonly asks: readonly number[] }

function clonePlayer(p: PlayerState): PlayerState {
  const q = new PlayerState();
  Object.assign(q, p);
  return q;
}

/** 段内的腿部事件（twitch / drift），按拍排序。Sim 在同一位置触发它们。 */
export function motionEvents(seg: CompiledSegment): MotionEvent[] {
  if (seg.kind !== 'run') return [];
  return seg.events.filter((e): e is MotionEvent => e.body.type === 'twitch' || e.body.type === 'drift') as MotionEvent[];
}

/** 段内障碍的空间索引：非移动障碍按 s0 排序 + 移动障碍单列。 */
interface ObIndex { statics: CompiledObstacle[]; walkers: CompiledObstacle[]; maxLen: number; s0s: Float64Array }
const indexCache = new WeakMap<CompiledSegment, ObIndex>();
function obIndex(seg: CompiledSegment): ObIndex {
  const hit = indexCache.get(seg);
  if (hit) return hit;
  const statics = seg.obstacles.filter((o) => o.behavior.type !== 'walk').sort((a, b) => a.s0 - b.s0 || a.id - b.id);
  const walkers = seg.obstacles.filter((o) => o.behavior.type === 'walk');
  const maxLen = statics.reduce((m, o) => Math.max(m, o.s1 - o.s0), 0);
  const idx: ObIndex = { statics, walkers, maxLen, s0s: Float64Array.from(statics.map((o) => o.s0)) };
  indexCache.set(seg, idx);
  return idx;
}
/** 最后一个 s0 ≤ s 的下标（没有则 −1）。 */
function lastAtOrBefore(a: Float64Array, s: number): number {
  let lo = 0, hi = a.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if ((a[m] as number) <= s) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

/** 需要长按伏低的里程区间：深的横档附近、腿自主抬起附近。 */
function longDuckZones(seg: CompiledSegment, mev: readonly MotionEvent[]): Array<[number, number]> {
  const z: Array<[number, number]> = [];
  for (const o of seg.obstacles) if (o.cls === 'bar' && o.s1 - o.s0 > 0.9) z.push([o.s0 - 4, o.s0]);
  void mev;   // 腿自主抬起：只在预警 / 抬起期间（p.twPhase ≠ 0）提供长按，见 solve()
  return z;
}

export class Solver implements SolverAPI {
  /** 最近一次求解扩展的节点数（性能诊断）。 */
  lastExpanded = 0;
  /** 调试：每层的节点数。 */
  trace: number[] | null = null;
  /** 求解的时间上限（秒），防止停拍很长的段无限展开。 */
  maxSeconds = 240;

  solve(seg: CompiledSegment, opts: SolveOptions = {}): SolverPlan | null {
    if (seg.kind !== 'run') return emptyPlan(0);
    const def = seg.def as RunSegmentDef;
    const minGap = Math.max(opts.minGap ?? 0.22, 0.22);
    const margin = opts.margin ?? 0.05;
    const mul = opts.cadenceMul ?? 1;
    const forbid = opts.forbid ?? [];
    const noJump = def.controls?.jump === false;
    const noAsk = opts.noAsk === true || def.crowd !== true;
    const evs: PaceEvent[] = paceEvents(seg);
    const mev = motionEvents(seg);
    const zones = longDuckZones(seg, mev);
    const endBeat = def.beats;
    const untilS = opts.untilS ?? Infinity;
    const gapTicks = Math.ceil(minGap / TICK_DT - 1e-9);
    const index = obIndex(seg);

    let p0: PlayerState, pace0: PaceState, startLane: Lane;
    if (opts.start) {
      p0 = clonePlayer(opts.start.p);
      p0.duckHeld = false;          // 求解起点假定 ↓ 没有按住（自动驾驶重新规划前会先松开 ↓）
      p0.jumpBuffer = 0;
      pace0 = clonePace(opts.start.pace);
      startLane = p0.laneTarget;
    } else {
      const from: SolveFrom = opts.from ?? { s: seg.s0, lane: 0, tSeg: 0 };
      p0 = new PlayerState();
      p0.reset(from.lane);
      pace0 = createPaceState(seg, from.s, from.tSeg);
      startLane = from.lane;
    }
    const beat0 = (pace0.s - seg.s0) / seg.stride;
    let mCursor = 0;
    // 从模拟中途开始：已经触发过的（at ≤ 当前拍）跳过；从检查点开始：恰好在检查点上的事件还没触发
    const midway = !!opts.start;
    while (mCursor < mev.length && (mev[mCursor] as MotionEvent).at < beat0 + (midway ? 1e-9 : -1e-9)) mCursor++;
    const parts0: number[] = [];
    for (const [id, t] of opts.start?.parts ?? []) parts0.push(id, t);
    const start: Node = {
      p: p0, pace: pace0, cost: 0, lastInputTick: -1e9, busyUntilTick: 0, keyDown: false, releaseTick: -1, releaseBeat: -1, mCursor,
      asksLeft: TUNING.ask.perSegment - (opts.start?.asksUsed ?? 0), asked: [...(opts.start?.asked ?? [])], parts: parts0,
      parent: null, steps: [], askS: [], taken: [], tick: 0, done: false,
    };
    const scratch = { box: box0(), prev: box0(), ob: box0(), infl: box0(), st: { active: true, ds: 0, x0: 0, x1: 0, amount: 1 } as ObstacleState, tmp: [] as CompiledObstacle[] };
    const isForbidden = (t: number) => forbid.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);
    const inZone = (s: number) => zones.some(([a, b]) => s >= a && s <= b);

    let layer: Node[] = [start];
    let expanded = 0;
    const maxLayers = Math.ceil((opts.maxSeconds ?? this.maxSeconds) / GRID_DT);
    const finished: Node[] = [];
    const ctx = { seg, index, evs, mev, mul, margin, endBeat, untilS, gapTicks, scratch };
    for (let g = 0; g < maxLayers && layer.length; g++) {
      const next = new Map<string, Node>();
      for (const node of layer) {
        const p = node.p;
        const gapOk = node.tick - node.lastInputTick >= gapTicks;
        const free = node.tick >= node.busyUntilTick && gapOk && !p.air && !p.moving && !p.ducking && p.duck === 0 && !node.keyDown;
        const tNow = node.pace.tSeg;
        const acts: Array<{ act: Act; hold: number }> = [{ act: 'none', hold: 0 }];
        const forbidden = isForbidden(tNow);
        if (!forbidden && gapOk && p.drPhase === 1) acts.push({ act: 'straighten', hold: 0 });
        if (free && !forbidden) {
          const drifting = p.drPhase === 1;
          if (p.laneTarget > -1 && !(drifting && p.drDir === 1)) acts.push({ act: 'left', hold: 0 });
          if (p.laneTarget < 1 && !(drifting && p.drDir === -1)) acts.push({ act: 'right', hold: 0 });
          if (!noJump) acts.push({ act: 'jump', hold: 0 });
          acts.push({ act: 'duck', hold: 0 });
          if (p.twPhase !== 0 || inZone(node.pace.s)) for (const h of HOLD_BEATS) acts.push({ act: 'duck', hold: h });
          if (!noAsk && node.asksLeft > 0) {
            const beat = (node.pace.s - seg.s0) / seg.stride;
            if (askTargets(seg, node.pace.s, beat, node.asked, scratch.tmp).length) acts.push({ act: 'ask', hold: 0 });
          }
        }
        for (const a of acts) {
          expanded++;
          const child = this.expand(ctx, node, a.act, a.hold);
          if (!child) continue;
          if (child.done) { finished.push(child); continue; }
          const key = this.key(child, gapTicks, seg);
          const old = next.get(key);
          if (!old || child.cost < old.cost) next.set(key, child);
        }
      }
      layer = Array.from(next.values());
      if (this.trace) this.trace.push(layer.length);
      // 已有到达终点的路线，且当前层的最优代价不可能更好时提前结束
      if (finished.length && layer.length) {
        let bestDone = Infinity, bestLayer = Infinity;
        for (const n of finished) bestDone = Math.min(bestDone, n.cost);
        for (const n of layer) bestLayer = Math.min(bestLayer, n.cost);
        if (bestLayer >= bestDone + 100) layer = [];
      }
    }
    this.lastExpanded = expanded;
    if (!finished.length) return null;
    finished.sort((a, b) => a.cost - b.cost || a.tick - b.tick);
    return buildPlan(finished[0] as Node, startLane);
  }

  /** 去重键：只编码会影响未来的状态（已结束的动作一律归一，否则状态数会爆炸）。 */
  private key(n: Node, gapTicks: number, seg: CompiledSegment): string {
    const p = n.p;
    const busy = Math.max(0, n.busyUntilTick - n.tick);
    const cool = Math.max(0, Math.min(gapTicks, n.tick - n.lastInputTick));
    const beat = (n.pace.s - seg.s0) / seg.stride;
    const air = p.air ? `a${Math.round(p.airT / TICK_DT)}${p.fastFall ? 'f' : ''}` : '';
    const duck = p.ducking || p.duck > 0 ? `d${p.ducking ? 1 : 0}${p.duckHeld ? 1 : 0}${Math.round(p.duck * 100)}_${Math.round((beat - p.duckStartBeat) * 100)}` : '';
    const move = p.moving ? `m${Math.round(p.laneT / TICK_DT)}_${Math.round(p.laneFromX * 100)}${p.laneQueue ?? ''}` : '';
    const key = n.keyDown ? `k${n.releaseTick >= 0 ? n.releaseTick - n.tick : Math.round((n.releaseBeat - beat) * 20)}` : '';
    const tw = p.twPhase ? `t${p.twPhase}_${Math.round(p.twT / TICK_DT)}_${Math.round(p.twHeld / TICK_DT)}` : '';
    const dr = p.drPhase ? `r${p.drDir}_${Math.round(p.drT / TICK_DT)}` : '';
    let ask = '';
    if (n.asked.length) {
      // 已经让开的人只记「让开了」，不记是哪一刻让开的（否则每个开口时刻都是一条永不合并的分支）
      ask = `q${n.asksLeft}_${n.asked.length}`;
      for (let i = 0; i < n.parts.length; i += 2) {
        const dt = (n.parts[i + 1] as number) - n.pace.tSeg;
        ask += dt <= 0 ? `,p${n.parts[i]}` : `,${n.parts[i]}:${Math.round(dt / TICK_DT)}`;
      }
    }
    return `${p.laneTarget}|${Math.round(n.pace.s * 5)}|${air}|${duck}|${move}|${key}|${busy}|${cool}|${tw}|${dr}|${n.mCursor}|${ask}|${n.taken.length}|${p.onSoft ? 1 : 0}`;
  }

  private expand(ctx: {
    seg: CompiledSegment; index: ObIndex; evs: readonly PaceEvent[]; mev: readonly MotionEvent[]; mul: number; margin: number; endBeat: number;
    untilS: number; gapTicks: number; scratch: { box: AABB; prev: AABB; ob: AABB; infl: AABB; st: ObstacleState; tmp: CompiledObstacle[] };
  }, node: Node, act: Act, hold: number): Node | null {
    const { seg, index, evs, mev, mul, margin, endBeat, untilS, gapTicks, scratch } = ctx;
    const p = clonePlayer(node.p);
    const pace = clonePace(node.pace);
    let taken = node.taken;
    const steps: PlanStep[] = [];
    const askS: number[] = [];
    let cost = node.cost;
    let { lastInputTick, busyUntilTick, keyDown, releaseTick, releaseBeat, mCursor, asksLeft } = node;
    let asked = node.asked;
    let parts = node.parts;
    let tick = node.tick;
    // 上一 tick 的玩家盒
    playerBox(pace.s, p.x, p.y, p.duck, p.twitch, scratch.prev);
    for (let k = 0; k < GRID; k++) {
      const beatNow = (pace.s - seg.s0) / seg.stride;
      const cad = nominalCadence(seg, pace, beatNow);
      // —— 输入（与 Sim.handleInput 同序）——
      if (k === 0 && act !== 'none') {
        const s = pace.s, t = pace.tSeg;
        if (act === 'left' || act === 'right') {
          p.laneInput(act === 'left' ? -1 : 1, p.onSoft);
          busyUntilTick = tick + Math.max(gapTicks, Math.ceil(p.laneDur / TICK_DT));
          steps.push({ t, s, action: act });
        } else if (act === 'jump') {
          p.startJump(cad);
          busyUntilTick = tick + Math.ceil(p.airDur / TICK_DT) + 1;
          steps.push({ t, s, action: 'jump' });
        } else if (act === 'duck') {
          p.startDuck(beatNow);
          keyDown = true;
          if (hold > 0) { releaseTick = -1; releaseBeat = beatNow + hold; cost += hold * 0.5; }
          else { releaseTick = tick + 1; releaseBeat = -1; }
          steps.push({ t, s, action: 'duck' });
        } else if (act === 'straighten') {
          driftCounter(p, (-p.drDir) as -1 | 1);
          steps.push({ t, s, action: 'straighten' });
        } else if (act === 'ask') {
          const targets = askTargets(seg, s, beatNow, asked, scratch.tmp);
          asked = asked.concat(targets.map((o) => o.id)).sort((a, b) => a - b);
          const np = parts.slice();
          for (const o of targets) if (!askIgnores(o)) np.push(o.id, t + TUNING.ask.delay);
          parts = np;
          asksLeft--;
          askS.push(s);
          cost += 5;
        }
        lastInputTick = tick;
        cost += 10;
      }
      if (keyDown && ((releaseTick >= 0 && tick >= releaseTick) || (releaseBeat >= 0 && beatNow >= releaseBeat - 1e-9))) {
        keyDown = false; releaseTick = -1; releaseBeat = -1;
        p.duckHeld = false;
        steps.push({ t: pace.tSeg, s: pace.s, action: 'duckRelease' });
      }
      // —— 推进（与 Sim.stepRun 同序）——
      p.updateHit(TICK_DT);
      twitchUpdate(p, TICK_DT, keyDown);
      driftUpdate(p, TICK_DT, p.onSoft);
      advancePace(seg, pace, evs, mul * p.hitMul * twitchSpeedMul(p), TICK_DT);
      const beat = (pace.s - seg.s0) / seg.stride;
      if (p.updateAir(TICK_DT)) {
        if (p.duckAfterLandBeats > 0) { p.startDuck(beat, p.duckAfterLandBeats); p.duckHeld = false; p.duckAfterLandBeats = 0; }
      }
      p.updateLane(TICK_DT, p.onSoft);
      p.updateDuck(TICK_DT, beat);
      while (mCursor < mev.length && (mev[mCursor] as MotionEvent).at <= beat + 1e-9) {
        const e = mev[mCursor++] as MotionEvent;
        if (e.body.type === 'twitch') twitchStart(p, e.body.hold); else driftStart(p, e.body.dir);
      }
      tick++;
      const tk = taken === node.taken ? taken.slice() : taken;
      if (this.hitTick(seg, index, p, pace, margin, parts, scratch, tk)) return null;
      taken = tk;
      if (p.laneTarget !== 0) cost += 0.02 / GRID;
      if (pace.ended || beat >= endBeat || pace.s >= untilS) {
        cost -= taken.length * 25;
        return { p, pace, cost, lastInputTick, busyUntilTick, keyDown, releaseTick, releaseBeat, mCursor, asksLeft, asked, parts, parent: node, steps, askS, taken, tick, done: true };
      }
    }
    if (p.ducking || p.duck > 0) busyUntilTick = Math.max(busyUntilTick, tick + 1);
    return { p, pace, cost, lastInputTick, busyUntilTick, keyDown, releaseTick, releaseBeat, mCursor, asksLeft, asked, parts, parent: node, steps, askS, taken, tick, done: false };
  }

  /** 某一 tick 的碰撞检测：会受击返回 true；同时更新 onSoft 与拾取的纸条。 */
  private hitTick(seg: CompiledSegment, index: ObIndex, p: PlayerState, pace: PaceState, margin: number, parts: readonly number[],
    sc: { box: AABB; prev: AABB; ob: AABB; infl: AABB; st: ObstacleState }, taken: number[]): boolean {
    const beat = (pace.s - seg.s0) / seg.stride;
    const box = playerBox(pace.s, p.x, p.y, p.duck, p.twitch, sc.box);
    const infl = sc.infl;
    infl.x0 = box.x0 - margin * 0.5; infl.x1 = box.x1 + margin * 0.5; infl.y0 = box.y0; infl.y1 = box.y1 + margin * 0.5;
    infl.s0 = box.s0 - margin; infl.s1 = box.s1 + margin;
    p.onSoft = false;
    const s = pace.s;
    const hi = lastAtOrBefore(index.s0s, s + 3);
    let hit = false;
    for (let i = hi; i >= 0 && !hit; i--) {
      const o = index.statics[i] as CompiledObstacle;
      if (o.s0 < s - 3 - index.maxLen) break;
      hit = this.check(o, p, pace, beat, parts, sc, box, infl, taken);
    }
    for (let i = 0; i < index.walkers.length && !hit; i++) hit = this.check(index.walkers[i] as CompiledObstacle, p, pace, beat, parts, sc, box, infl, taken);
    if (hit) return true;
    const prev = sc.prev;
    prev.x0 = box.x0; prev.x1 = box.x1; prev.y0 = box.y0; prev.y1 = box.y1; prev.s0 = box.s0; prev.s1 = box.s1;
    return false;
  }

  private check(o: CompiledObstacle, p: PlayerState, pace: PaceState, beat: number, parts: readonly number[],
    sc: { prev: AABB; ob: AABB; st: ObstacleState }, box: AABB, infl: AABB, taken: number[]): boolean {
    const s = pace.s;
    const st = obstacleState(o, pace.tSeg, beat, sc.st);
    if (!st.active) return false;
    if (parts.length && partedAt(parts, o.id, pace.tSeg)) return false;
    if (o.s0 + st.ds > s + 3 || o.s1 + st.ds < s - 3) return false;
    const ob = obstacleBox(o, st, sc.ob);
    if (o.cls === 'soft') {
      if (classify(box, sc.prev, o, ob, false).type === 'soft') { p.onSoft = true; p.surfaceSoftKind = o.kind === 'leaves' ? 'leavesWet' : 'water'; }
      return false;
    }
    if (o.cls === 'pickup') {
      if (!taken.includes(o.id) && classify(box, sc.prev, o, ob, false).type === 'pickup') taken.push(o.id);
      return false;
    }
    return wouldHit(infl, o, ob);
  }
}

function partedAt(parts: readonly number[], id: number, tSeg: number): boolean {
  for (let i = 0; i < parts.length; i += 2) if (parts[i] === id && tSeg >= (parts[i + 1] as number) - 1e-9) return true;
  return false;
}

function box0(): AABB { return { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }; }

function emptyPlan(lane: Lane): SolverPlan {
  return { steps: [], asks: [], laneAt: () => lane, actionAt: () => 'none' };
}

function buildPlan(end: Node, startLane: Lane): SolverPlan {
  const steps: PlanStep[] = [];
  const asks: number[] = [];
  const chain: Node[] = [];
  for (let n: Node | null = end; n; n = n.parent) chain.push(n);
  chain.reverse();
  for (const n of chain) { steps.push(...n.steps); asks.push(...n.askS); }
  // 车道随里程变化的分段表（被迫换道由腿偏移造成，不在 steps 里：按实际路线的车道记录）
  const laneMarks: Array<{ s: number; lane: Lane }> = [{ s: -Infinity, lane: startLane }];
  let lane = startLane;
  for (const n of chain) {
    const lt = n.p.laneTarget;
    if (lt !== lane) { lane = lt; laneMarks.push({ s: n.pace.s, lane }); }
  }
  for (const st of steps) if (st.action === 'left' || st.action === 'right') {
    // 用动作开始的里程修正分段表里对应的一格（chain 的粒度是 0.05 s）
    const i = laneMarks.findIndex((m) => m.s >= (st.s ?? 0) - 1e-9);
    if (i > 0) (laneMarks[i] as { s: number }).s = st.s ?? (laneMarks[i] as { s: number }).s;
  }
  const acts: Array<{ s: number; a: 'jump' | 'duck' }> = [];
  for (const st of steps) if (st.action === 'jump' || st.action === 'duck') acts.push({ s: st.s ?? 0, a: st.action });
  return {
    steps,
    asks,
    laneAt(s: number): Lane {
      let l = startLane;
      for (const m of laneMarks) { if (m.s <= s) l = m.lane; else break; }
      return l;
    },
    actionAt(s: number) {
      for (const a of acts) if (Math.abs(a.s - s) < 0.05) return a.a;
      return 'none';
    },
  };
}

export const solver = new Solver();
/** 求解网格（秒）。 */
export const SOLVER_GRID_SEC = GRID_DT;
