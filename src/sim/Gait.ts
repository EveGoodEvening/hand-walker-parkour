// src/sim/Gait.ts —— 位置驱动的步态与三段触地（DESIGN.md §2.3）。CORE 编写，归 WP1。
// beat = (s − s0) / stride；每跨过一个整数拍就是一次落掌，偶数拍左手、奇数拍右手。
// 掌根在 t0；指节在 t0 + 26 ms × k；指腹在 t0 + 52 ms × k；k = clamp(4.8 / cadence, 0.8, 1.2)。
import type { ContactPart, Hand } from '../core/types';
import { TUNING } from './tuning';

const G = TUNING.gait;

export function subScale(cadence: number): number {
  const [lo, hi] = G.subScaleClamp;
  return Math.min(hi, Math.max(lo, G.subScaleRef / Math.max(0.1, cadence)));
}
export function handOfBeat(beatIndex: number): Hand { return ((beatIndex % 2) + 2) % 2 === 0 ? 'L' : 'R'; }

export interface PendingContact { t: number; hand: Hand; part: ContactPart; heavy: boolean; crisp: boolean }

/**
 * 触地调度器：检测整数拍的跨越，立即发出掌根，并把指节、指腹排进待发队列（按模拟时间逐 tick 取出）。
 */
export class GaitClock {
  readonly pending: PendingContact[] = [];

  reset(): void { this.pending.length = 0; }

  /**
   * prevBeat → beat 这一 tick 内跨过的整数拍。t0/t1 为这一 tick 的起止模拟时间（秒）。
   * 返回跨过的整数拍序号（可能 0 个或多个）。掌根按线性插值得到精确时刻。
   */
  cross(prevBeat: number, beat: number, t0: number, t1: number, cadence: number, onHeel: (beatIndex: number, t: number) => void): void {
    if (beat <= prevBeat) return;
    // 上一 tick 已经把「差 1e-9 就到整数」的拍算作跨过了（下面的 ≤ beat + 1e-9），这里要用同一个容差，
    // 否则同一拍会在两个 tick 里各落一次掌（WP1 修：CORE 版本在 4.8 掌/s 时约六成的拍重复发出掌根）。
    const first = Math.floor(prevBeat + 1e-9) + 1;
    for (let b = first; b <= beat + 1e-9; b++) {
      const f = (b - prevBeat) / (beat - prevBeat);
      const t = t0 + (t1 - t0) * Math.min(1, Math.max(0, f));
      onHeel(b, t);
      const k = subScale(cadence);
      const hand = handOfBeat(b);
      this.pending.push({ t: t + (G.knuckleMs / 1000) * k, hand, part: 'knuckle', heavy: false, crisp: false });
      this.pending.push({ t: t + (G.padMs / 1000) * k, hand, part: 'pad', heavy: false, crisp: false });
    }
  }

  /** 撑跃落地：双手的三段声相隔 12 ms 叠加（§6.2）。 */
  landing(t: number, cadence: number, onHeel: (hand: Hand, t: number) => void): void {
    const k = subScale(cadence);
    for (const [hand, off] of [['L', 0], ['R', 0.012]] as const) {
      onHeel(hand, t + off);
      this.pending.push({ t: t + off + (G.knuckleMs / 1000) * k, hand, part: 'knuckle', heavy: true, crisp: false });
      this.pending.push({ t: t + off + (G.padMs / 1000) * k, hand, part: 'pad', heavy: true, crisp: false });
    }
  }

  /** 取出 t ≤ now 的待发子事件（保持时间顺序）。 */
  due(now: number, out: PendingContact[]): PendingContact[] {
    out.length = 0;
    if (this.pending.length === 0) return out;
    this.pending.sort((a, b) => a.t - b.t);
    let n = 0;
    while (n < this.pending.length && (this.pending[n] as PendingContact).t <= now + 1e-9) n++;
    for (let i = 0; i < n; i++) out.push(this.pending[i] as PendingContact);
    this.pending.splice(0, n);
    return out;
  }
}
