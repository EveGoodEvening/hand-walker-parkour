// src/sim/Leader.ts —— 前方的它（DESIGN.md §2.6 ahead、§3「前方的它」、D5、D13、§4.5 5-11）。WP1。
// ahead 模式：领跑者在你前方 3 / 6 / 9 / 12 m（稳度 3 / 2 / 1 / 0），**永远不会比 3 m 更近**，档位之间 300 ms 滑变。
// 它按求解器路线在它所在的位置上做出正确动作：leaderLane = plan.laneAt(leaderS)（画面用 ctx.solver 的 plan.actionAt 取动作）。
// 事件：leader appear（在雾里出现）/ recede（渐渐走远：距离每秒 +2.5 m，光圈一个个淡进雾里）。
// ahead 模式的跑段里如果没有任何 leader 事件，进段即出现（兜底，便于测试与数据遗漏）。
// 路线在读章时（开场卡期间）就求好（prepare），游戏过程中不再求解，避免 5-11 进段时卡一帧。
import { AHEAD_DISTANCE, FOLLOWER_SLIDE } from '../core/constants';
import type { Plan, SolverAPI } from '../core/contracts';
import type { Lane } from '../core/types';
import type { CompiledChapter, CompiledSegment } from '../levels/schema';

/** 走远的速度（米 / 秒）。 */
export const RECEDE_SPEED = 2.5;
/** 最近距离（米）。 */
export const LEADER_MIN = 3;

export function aheadDistance(steady: number): number {
  const i = Math.max(0, Math.min(AHEAD_DISTANCE.length - 1, Math.floor(steady)));
  return Math.max(LEADER_MIN, AHEAD_DISTANCE[i] as number);
}

export class LeaderRuntime {
  visible = false;
  receding = false;
  /** 当前距离（不含走远的部分）。 */
  dist = LEADER_MIN;
  extra = 0;
  private from = LEADER_MIN;
  private to = LEADER_MIN;
  private slideT = 1;
  private plan: Plan | null = null;
  private planSeg = -1;
  private readonly routes = new Map<number, Plan | null>();
  lane: Lane = 0;
  s: number | null = null;

  /** 读章时预先求好可能出现领跑者的跑段的路线（段首 follower 是 ahead，或段里有 leader / ahead 事件）。 */
  prepare(ch: CompiledChapter, solver: SolverAPI): void {
    this.routes.clear();
    for (const seg of ch.segments) {
      if (seg.kind !== 'run') continue;
      const ahead = seg.def.follower.mode === 'ahead' || seg.events.some((e) => e.body.type === 'leader' || (e.body.type === 'follower' && e.body.def.mode === 'ahead'));
      if (ahead) this.routes.set(seg.index, solver.solve(seg, { noAsk: true }));
    }
  }

  reset(): void {
    this.visible = false; this.receding = false; this.extra = 0; this.slideT = 1; this.plan = null; this.planSeg = -1;
    this.lane = 0; this.s = null;
  }

  /** 进段时调用：换段就丢掉旧路线（段内求解一次，惰性）。 */
  enterSegment(seg: CompiledSegment, active: boolean): void {
    if (this.planSeg !== seg.index) { this.plan = null; this.planSeg = -1; }
    if (!active || seg.kind !== 'run') { this.s = null; return; }
    const hasEvents = seg.events.some((e) => e.body.type === 'leader');
    if (!hasEvents) this.appear();
  }

  appear(): void { this.visible = true; this.receding = false; this.extra = 0; this.slideT = 1; this.dist = this.to; this.from = this.to; }
  recede(): void { if (this.visible) this.receding = true; }

  /** 稳度变化或进入 ahead 模式时：目标距离，300 ms 滑变（snap = 立即）。 */
  target(steady: number, snap = false): void {
    const d = aheadDistance(steady);
    if (snap) { this.dist = this.from = this.to = d; this.slideT = 1; return; }
    if (Math.abs(d - this.to) < 1e-9) return;
    this.from = this.dist; this.to = d; this.slideT = 0;
  }

  /** 每 tick 调用（只在 ahead 模式的跑段）。s 为玩家里程。 */
  update(dt: number, seg: CompiledSegment, s: number, solver: SolverAPI): void {
    if (!this.visible || seg.kind !== 'run') { this.s = null; return; }
    if (this.slideT < 1) {
      this.slideT = Math.min(1, this.slideT + dt / FOLLOWER_SLIDE);
      this.dist = this.from + (this.to - this.from) * this.slideT;
    }
    if (this.receding) this.extra += RECEDE_SPEED * dt;
    this.dist = Math.max(LEADER_MIN, this.dist);
    this.s = s + this.dist + this.extra;
    if (this.planSeg !== seg.index) {
      this.plan = this.routes.has(seg.index) ? (this.routes.get(seg.index) ?? null) : solver.solve(seg, { noAsk: true });
      this.routes.set(seg.index, this.plan);
      this.planSeg = seg.index;
    }
    const ls = Math.min(this.s, seg.s1 - 1e-6);
    this.lane = this.plan ? this.plan.laneAt(ls) : 0;
  }

  /** 距离（FollowerSnap.distance）。 */
  distance(): number { return this.dist + this.extra; }
}
