// src/sim/Solver.ts —— 求解器：车道 × 时间的 BFS（DESIGN.md §2.8 R2、§8.9-7）。CORE 编写，归 WP1。
// 步长 0.05 s（= 6 tick），两次输入至少相隔 minGap（缺省 0.22 s）。支持静止、周期（swing / stretch）、
// 移动（walk）和到点（yield / shift / fallInto）障碍。
// 做法：按时间分层的动态规划（等价于分层 BFS，按代价取最优）。每个节点保存一份 PlayerState + PaceState，
// 用与 Sim 完全相同的代码逐 tick 推进和判定碰撞，所以求出的路线在实际模拟里逐 tick 复现（自动驾驶按位置执行）。
// 代价：输入次数 × 10 + 不在中道的时间 × 0.02 − 拾取纸条 × 25（让自动驾驶顺手捡纸条，最多多花两次输入）。
import type { Plan, PlanStep, SolveFrom, SolverAPI } from '../core/contracts';
import { TICK_DT } from '../core/constants';
import type { AABB, Lane } from '../core/types';
import type { CompiledObstacle, CompiledSegment, RunSegmentDef } from '../levels/schema';
import { classify, obstacleBox, playerBox, wouldHit } from './Collision';
import { advancePace, clonePace, createPaceState, nominalCadence, paceEvents, type PaceEvent, type PaceState } from './Pace';
import { PlayerState } from './Player';
import { obstacleState, type ObstacleState } from './Track';
import { TUNING } from './tuning';

const GRID = 6;                       // tick / 格
const GRID_DT = GRID * TICK_DT;       // 0.05 s

type Act = 'none' | 'left' | 'right' | 'jump' | 'duck';
interface Node {
  p: PlayerState;
  pace: PaceState;
  cost: number;
  lastInputTick: number;              // 距段内起点的 tick 序号
  busyUntilTick: number;
  releaseAtTick: number;              // 伏低松手的 tick（-1 = 无）
  parent: Node | null;
  steps: PlanStep[];                  // 本格新增的动作
  taken: number[];                    // 已拾取的纸条 id
  tick: number;
  done: boolean;
}

export interface SolveOptions {
  noAsk?: boolean; minGap?: number; cadenceMul?: number; from?: SolveFrom;
  forbid?: ReadonlyArray<readonly [number, number]>; margin?: number;
}

function clonePlayer(p: PlayerState): PlayerState {
  const q = new PlayerState();
  Object.assign(q, p);
  return q;
}

/** 某一 tick 的碰撞检测：返回 'hit' | 'ok'，并更新 onSoft / 纸条。 */
function checkTick(seg: CompiledSegment, obs: readonly CompiledObstacle[], p: PlayerState, pace: PaceState, margin: number,
  box: AABB, prev: AABB, ob: AABB, st: ObstacleState, taken: number[] | null): boolean {
  const beat = (pace.s - seg.s0) / seg.stride;
  playerBox(pace.s, p.x, p.y, p.duck, p.twitch, box);
  const inflated: AABB = { x0: box.x0 - margin * 0.5, x1: box.x1 + margin * 0.5, y0: box.y0, y1: box.y1 + margin * 0.5, s0: box.s0 - margin, s1: box.s1 + margin };
  p.onSoft = false;
  for (const o of obs) {
    if (o.behavior.type !== 'walk' && (o.s0 > pace.s + 3 || o.s1 < pace.s - 3)) continue;
    obstacleState(o, pace.tSeg, beat, st);
    if (!st.active) continue;
    if (o.s0 + st.ds > pace.s + 3 || o.s1 + st.ds < pace.s - 3) continue;
    obstacleBox(o, st, ob);
    if (o.cls === 'soft') {
      const r = classify(box, prev, o, ob, false);
      if (r.type === 'soft') { p.onSoft = true; p.surfaceSoftKind = o.kind === 'leaves' ? 'leavesWet' : 'water'; }
      continue;
    }
    if (o.cls === 'pickup') {
      if (taken && !taken.includes(o.id) && classify(box, prev, o, ob, false).type === 'pickup') taken.push(o.id);
      continue;
    }
    if (wouldHit(inflated, o, ob)) return true;
  }
  prev.x0 = box.x0; prev.x1 = box.x1; prev.y0 = box.y0; prev.y1 = box.y1; prev.s0 = box.s0; prev.s1 = box.s1;
  return false;
}

export class Solver implements SolverAPI {
  /** 最近一次求解扩展的节点数（性能诊断）。 */
  lastExpanded = 0;
  /** 求解的时间上限（秒），防止停拍很长的段无限展开。 */
  maxSeconds = 240;

  solve(seg: CompiledSegment, opts: SolveOptions = {}): Plan | null {
    if (seg.kind !== 'run') return emptyPlan(0);
    const def = seg.def as RunSegmentDef;
    const minGap = Math.max(opts.minGap ?? 0.22, 0.22);
    const margin = opts.margin ?? 0.05;
    const mul = opts.cadenceMul ?? 1;
    const forbid = opts.forbid ?? [];
    const noJump = def.controls?.jump === false;
    const from: SolveFrom = opts.from ?? { s: seg.s0, lane: 0, tSeg: 0 };
    const evs: PaceEvent[] = paceEvents(seg);
    const obs = seg.obstacles;
    const endBeat = def.beats;
    const gapTicks = Math.ceil(minGap / TICK_DT - 1e-9);

    const p0 = new PlayerState();
    p0.reset(from.lane);
    const start: Node = {
      p: p0, pace: createPaceState(seg, from.s, from.tSeg), cost: 0, lastInputTick: -1e9, busyUntilTick: 0, releaseAtTick: -1,
      parent: null, steps: [], taken: [], tick: 0, done: false,
    };
    const box: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
    const prev: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
    const ob: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
    const st: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
    const isForbidden = (t: number) => forbid.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);

    let layer: Node[] = [start];
    let expanded = 0;
    const maxLayers = Math.ceil(this.maxSeconds / GRID_DT);
    let finished: Node[] = [];
    for (let g = 0; g < maxLayers && layer.length; g++) {
      const next = new Map<string, Node>();
      for (const node of layer) {
        const free = node.tick >= node.busyUntilTick && node.tick - node.lastInputTick >= gapTicks && !node.p.air && !node.p.moving
          && !node.p.ducking && node.p.duck === 0;
        const tNow = node.pace.tSeg;
        const acts: Array<{ act: Act; hold: number }> = [{ act: 'none', hold: 0 }];
        if (free && !isForbidden(tNow)) {
          if (node.p.laneTarget > -1) acts.push({ act: 'left', hold: 0 });
          if (node.p.laneTarget < 1) acts.push({ act: 'right', hold: 0 });
          if (!noJump) acts.push({ act: 'jump', hold: 0 });
          for (const h of [1, 5, 9, 13]) acts.push({ act: 'duck', hold: h });
        }
        for (const a of acts) {
          expanded++;
          const child = this.expand(seg, obs, evs, node, a.act, a.hold, mul, margin, endBeat, gapTicks, box, prev, ob, st);
          if (!child) continue;
          if (child.done) { finished.push(child); continue; }
          const key = this.key(child, gapTicks, seg);
          const old = next.get(key);
          if (!old || child.cost < old.cost) next.set(key, child);
        }
      }
      layer = Array.from(next.values());
      // 已有到达终点的路线，且当前层的最优代价不可能更好时提前结束
      if (finished.length && layer.length) {
        const bestDone = Math.min(...finished.map((n) => n.cost));
        const bestLayer = Math.min(...layer.map((n) => n.cost));
        if (bestLayer >= bestDone + 100) layer = [];
      }
    }
    this.lastExpanded = expanded;
    if (!finished.length) return null;
    finished.sort((a, b) => a.cost - b.cost || a.tick - b.tick);
    return buildPlan(finished[0] as Node, from.lane);
  }

  /** 去重键：只编码会影响未来的状态（已结束的动作一律归一，否则状态数会爆炸）。 */
  private key(n: Node, gapTicks: number, seg: CompiledSegment): string {
    const p = n.p;
    const busy = Math.max(0, n.busyUntilTick - n.tick);
    const cool = Math.max(0, Math.min(gapTicks, n.tick - n.lastInputTick));
    const air = p.air ? `a${Math.round(p.airT / TICK_DT)}${p.fastFall ? 'f' : ''}` : '';
    const duck = p.ducking || p.duck > 0 ? `d${p.ducking ? 1 : 0}${p.duckHeld ? 1 : 0}${Math.round(p.duck * 100)}_${Math.round(((n.pace.s - seg.s0) / seg.stride - p.duckStartBeat) * 100)}` : '';
    const move = p.moving ? `m${Math.round(p.laneT / TICK_DT)}_${Math.round(p.laneFromX * 100)}` : '';
    const rel = n.releaseAtTick >= 0 ? n.releaseAtTick - n.tick : -1;
    return `${p.laneTarget}|${air}|${duck}|${move}|${busy}|${rel}|${cool}|${n.taken.length}|${p.onSoft ? 1 : 0}`;
  }

  private expand(seg: CompiledSegment, obs: readonly CompiledObstacle[], evs: readonly PaceEvent[], node: Node, act: Act, hold: number,
    mul: number, margin: number, endBeat: number, gapTicks: number, box: AABB, prev: AABB, ob: AABB, st: ObstacleState): Node | null {
    const p = clonePlayer(node.p);
    const pace = clonePace(node.pace);
    const taken = node.taken.slice();
    const steps: PlanStep[] = [];
    let cost = node.cost;
    let lastInputTick = node.lastInputTick;
    let busyUntilTick = node.busyUntilTick;
    let releaseAtTick = node.releaseAtTick;
    let tick = node.tick;
    // 上一 tick 的玩家盒
    playerBox(pace.s, p.x, p.y, p.duck, p.twitch, prev);
    for (let k = 0; k < GRID; k++) {
      const beatNow = (pace.s - seg.s0) / seg.stride;
      const cad = nominalCadence(seg, pace, beatNow);
      // —— 输入（与 Sim.handleAction 同序）——
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
          releaseAtTick = tick + hold;
          busyUntilTick = tick + hold;
          steps.push({ t, s, action: 'duck' });
        }
        lastInputTick = tick;
        cost += 10;
      }
      if (releaseAtTick >= 0 && tick >= releaseAtTick && p.duckHeld) {
        p.duckHeld = false;
        steps.push({ t: pace.tSeg, s: pace.s, action: 'duckRelease' });
        releaseAtTick = -1;
      }
      // —— 推进（与 Sim.stepRun 同序）——
      p.updateHit(TICK_DT);
      advancePace(seg, pace, evs, mul * p.hitMul, TICK_DT);
      const beat = (pace.s - seg.s0) / seg.stride;
      if (p.updateAir(TICK_DT)) {
        if (p.duckAfterLandBeats > 0) { p.startDuck(beat, p.duckAfterLandBeats); p.duckHeld = false; p.duckAfterLandBeats = 0; }
      }
      p.updateLane(TICK_DT, p.onSoft);
      p.updateDuck(TICK_DT, beat);
      tick++;
      if (checkTick(seg, obs, p, pace, margin, box, prev, ob, st, taken)) return null;
      if (p.laneTarget !== 0) cost += 0.02 / GRID;
      if (pace.ended || beat >= endBeat) {
        cost -= taken.length * 25;
        return { p, pace, cost, lastInputTick, busyUntilTick, releaseAtTick, parent: node, steps, taken, tick, done: true };
      }
    }
    if (p.ducking || p.duck > 0) busyUntilTick = Math.max(busyUntilTick, tick + 1);
    return { p, pace, cost, lastInputTick, busyUntilTick, releaseAtTick, parent: node, steps, taken, tick, done: false };
  }
}

function emptyPlan(lane: Lane): Plan {
  return { steps: [], laneAt: () => lane, actionAt: () => 'none' };
}

function buildPlan(end: Node, startLane: Lane): Plan {
  const steps: PlanStep[] = [];
  const chain: Node[] = [];
  for (let n: Node | null = end; n; n = n.parent) chain.push(n);
  chain.reverse();
  for (const n of chain) steps.push(...n.steps);
  // 车道随里程变化的分段表
  const laneMarks: Array<{ s: number; lane: Lane }> = [{ s: -Infinity, lane: startLane }];
  let lane = startLane;
  const acts: Array<{ s: number; a: 'jump' | 'duck' }> = [];
  for (const st of steps) {
    const s = st.s ?? 0;
    if (st.action === 'left' || st.action === 'right') {
      lane = Math.max(-1, Math.min(1, lane + (st.action === 'left' ? -1 : 1))) as Lane;
      laneMarks.push({ s, lane });
    } else if (st.action === 'jump' || st.action === 'duck') acts.push({ s, a: st.action });
  }
  return {
    steps,
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
/** tuning 引用（避免 tree-shaking 掉 TUNING 的类型依赖）。 */
export const SOLVER_GRID_SEC = GRID_DT + 0 * TUNING.tickHz;
