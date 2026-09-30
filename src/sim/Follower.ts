// src/sim/Follower.ts —— 追随者基础（DESIGN.md §2.6、D5）。CORE 编写，归 WP1。
// 追随者 = 稳度的声音化身：它的落地就是你自己的落地事件延迟重放（「我停，它也停」自然成立）。
// 六种模式；稳度 → 相位差查 LAG_BEATS；档位之间 300 ms 滑变；lagOverride（3-2 楼梯 = 1 拍）。
import { AHEAD_DISTANCE, AHEAD_LAG, FOLLOWER_SLIDE, LAG_BEATS } from '../core/constants';
import type { ContactPart, FollowerMode, FollowerSnap, Hand, Lane } from '../core/types';
import type { FollowerDef } from '../levels/schema';

export function voiceFor(mode: FollowerMode): 'echo' | 'none' {
  return mode === 'behind' || mode === 'pressure' || mode === 'synced' || mode === 'ahead' ? 'echo' : 'none';
}
export function hudFor(mode: FollowerMode): 'dots' | 'shadow' | 'none' {
  return mode === 'hidden' || mode === 'absent' ? 'none' : 'dots';
}

/** 稳度 → 目标相位差（拍）。 */
export function lagFor(mode: FollowerMode, steady: number, lagOverride: number | null | undefined): number {
  if (lagOverride !== null && lagOverride !== undefined) return lagOverride;
  const i = Math.max(0, Math.floor(steady));
  switch (mode) {
    case 'behind': return LAG_BEATS.behind[Math.min(i, LAG_BEATS.behind.length - 1)] as number;
    case 'pressure': return LAG_BEATS.pressure[Math.min(i, LAG_BEATS.pressure.length - 1)] as number;
    case 'synced': return LAG_BEATS.synced[Math.min(i, LAG_BEATS.synced.length - 1)] as number;
    case 'ahead': return AHEAD_LAG;
    default: return 0;
  }
}

interface Replay { t: number; hand: Hand; part: ContactPart; lag: number }

export class Follower {
  mode: FollowerMode = 'hidden';
  voice: 'echo' | 'none' = 'none';
  hud: 'dots' | 'shadow' | 'none' = 'none';
  from: 'behind' | 'front' = 'behind';
  lagOverride: number | null = null;
  steadyMaxOverride: number | undefined;
  lag = 0;
  private lagFrom = 0;
  private lagTo = 0;
  private slideT = 1;
  leaderS: number | null = null;
  leaderLane: Lane | null = null;
  private queue: Replay[] = [];

  /** 应用段首或事件里的 FollowerDef（部分字段）。返回是否改变了模式。 */
  apply(def: Partial<FollowerDef>): boolean {
    const prev = this.mode;
    if (def.mode) {
      this.mode = def.mode;
      this.voice = voiceFor(def.mode);
      this.hud = hudFor(def.mode);
      this.from = def.mode === 'ahead' ? 'front' : 'behind';
      this.lagOverride = null;
      this.steadyMaxOverride = undefined;
    }
    if (def.voice) this.voice = def.voice;
    if (def.hud) this.hud = def.hud;
    if (def.from) this.from = def.from;
    if (def.lagOverride !== undefined) this.lagOverride = def.lagOverride;
    if (def.steadyMax !== undefined) this.steadyMaxOverride = def.steadyMax;
    if (this.mode !== prev) this.queue.length = 0;
    return this.mode !== prev;
  }

  /** 立即把相位差设为目标（读章、重来时）。 */
  snapTo(steady: number): void {
    this.lagTo = this.lagFrom = this.lag = lagFor(this.mode, steady, this.lagOverride);
    this.slideT = 1;
  }

  /** 目标相位差变化时开始 300 ms 滑变；返回目标是否变化。 */
  retarget(steady: number): boolean {
    const target = lagFor(this.mode, steady, this.lagOverride);
    if (Math.abs(target - this.lagTo) < 1e-9) return false;
    this.lagFrom = this.lag; this.lagTo = target; this.slideT = 0;
    return true;
  }

  update(dt: number): void {
    if (this.slideT < 1) {
      this.slideT = Math.min(1, this.slideT + dt / FOLLOWER_SLIDE);
      this.lag = this.lagFrom + (this.lagTo - this.lagFrom) * this.slideT;
    }
  }

  /** 自己的一次触地 → 排一次追随者触地（有声音的模式才排）。 */
  onContact(t: number, hand: Hand, part: ContactPart, cadence: number): void {
    if (this.voice === 'none' || this.mode === 'hidden' || this.mode === 'absent') return;
    const c = Math.max(0.5, cadence);
    const lag = this.lag;
    const delay = lag >= 0 ? lag / c : (1 + lag) / c;
    this.queue.push({ t: t + delay, hand, part, lag });
  }

  /** 取出到期的追随者触地。 */
  due(now: number, out: Replay[]): Replay[] {
    out.length = 0;
    let n = 0;
    while (n < this.queue.length && (this.queue[n] as Replay).t <= now + 1e-9) n++;
    for (let i = 0; i < n; i++) out.push(this.queue[i] as Replay);
    this.queue.splice(0, n);
    return out;
  }

  clearQueue(): void { this.queue.length = 0; }

  distance(steady: number): number {
    const i = Math.max(0, Math.min(AHEAD_DISTANCE.length - 1, Math.floor(steady)));
    if (this.mode === 'ahead') return AHEAD_DISTANCE[i] as number;
    if (this.mode === 'pressure' && this.hud === 'shadow') return 0.5 + steady * 0.75;
    return 0;
  }

  snapshot(steady: number): FollowerSnap {
    return {
      mode: this.mode, voice: this.voice, hud: this.hud, from: this.from,
      lagBeats: this.lag, distance: this.distance(steady), leaderS: this.leaderS, leaderLane: this.leaderLane,
    };
  }
}
