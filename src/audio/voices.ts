// src/audio/voices.ts —— 声部池（DESIGN.md §6.1「同时发声上限 32，超出时抢占最老、最轻的声部」）。WP7。
// 每个一次性声音（手掌、音效、颗粒）占一个声部，直到它的缓冲播完。池满时：低优先级（环境颗粒）直接放弃；
// 其余抢占「估计当前电平」最低的声部——电平 = 峰值 × exp(−已播时间 / τ)，越老越轻越先被抢。
// 被抢的声部在新声音开始之前淡出并停止，所以任何时刻真正在响的一次性声部都 ≤ 32。
export const MAX_VOICES = 32;

export interface Voice {
  src: AudioScheduledSourceNode | null;
  g: GainNode;
  start: number;
  end: number;
  /** 线性峰值（估算用）。 */
  peak: number;
  tau: number;
  /** 0 = 环境颗粒（可放弃），1 = 普通，2 = 自己的掌声。 */
  prio: number;
}

export class VoicePool {
  readonly list: Voice[] = [];
  maxSeen = 0;
  stolen = 0;
  dropped = 0;
  constructor(readonly max = MAX_VOICES) {}

  /** 去掉已经播完的声部。 */
  prune(now: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) if ((this.list[i] as Voice).end <= now) this.list.splice(i, 1);
  }

  /** 估计 t 时刻的电平。 */
  static level(v: Voice, t: number): number {
    if (t < v.start) return v.peak * 1.5;          // 还没开始的声音最不该被抢
    return v.peak * Math.exp(-(t - v.start) / Math.max(1e-3, v.tau));
  }

  /**
   * 为一个 at 时刻开始、优先级 prio 的新声音腾出位置。返回 false 表示放弃这个新声音。
   * 「busy」= 在 at 之后还会响的全部声部（包括排在 at 之后才开始的），是新声音整个生命期里任何时刻在响的声部的超集。
   * 把它压到上限以下再加入新声音，任何时刻同时发声都 ≤ 上限。事件不总是按时间顺序到达（触地抖动 ±4 ms、
   * 环境颗粒提前 0.35 s 排程），所以可能要连抢好几个；抢不够就放弃新声音（不先抢一半）。
   */
  admit(now: number, at: number, prio: number): boolean {
    this.prune(now);
    const busy = this.list.filter((v) => v.end > at);
    const need = busy.length - this.max + 1;
    if (need <= 0) return true;
    if (prio <= 0) { this.dropped++; return false; }
    const cands = busy.filter((v) => v.prio <= prio);
    if (cands.length < need) { this.dropped++; return false; }
    cands.sort((a, b) => VoicePool.level(a, at) * (a.prio === 0 ? 0.1 : 1) - VoicePool.level(b, at) * (b.prio === 0 ? 0.1 : 1));
    for (let i = 0; i < need; i++) this.steal(cands[i] as Voice, now, at);
    return true;
  }

  /** 在 at 之前淡出并停止一个声部。 */
  private steal(v: Voice, now: number, at: number): void {
    const stopAt = Math.max(now, Math.min(at, Math.max(v.start, now) + 0.03));
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, Math.max(0.0005, (stopAt - now) / 5));
      v.src?.stop(stopAt);
    } catch { /* 已经停了 */ }
    v.end = Math.min(v.end, stopAt);
    this.stolen++;
  }

  add(v: Voice): void {
    this.list.push(v);
    let n = 0;
    for (const x of this.list) if (x.end > v.start && x.start <= v.start) n++;
    if (n > this.maxSeen) this.maxSeen = n;
  }

  /** t 时刻正在响的声部数。 */
  activeAt(t: number): number {
    let n = 0;
    for (const v of this.list) if (v.start <= t && v.end > t) n++;
    return n;
  }
}
