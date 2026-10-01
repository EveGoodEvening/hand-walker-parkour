// src/audio/lights.ts —— 嗡鸣跟随的「灯光亮度」（DESIGN.md §6.2「灯管嗡鸣」「声控灯」、§5.3）。WP7。
// 有 WP3 的 LampField 时直接读 brightnessAt(玩家里程)；只有 CORE 的统一亮度桩时，按 `lights` cue 自己估一个：
// flicker 区间里按拍闪（间隔 ≥ 0.34 s，保证每秒 ≤ 3 次）；out 压暗；sound 区间默认黑，撑跃落地或 ↓ 拍地后亮 4 s。
import type { SimSnapshot } from '../core/types';
import type { EventBody } from '../levels/schema';

type LightsCue = Extract<EventBody, { type: 'lights' }>;

export class LightModel {
  private out = false;
  private flicker: { from: number; to: number; every: number } | null = null;
  private sound: { from: number; to: number } | null = null;
  private litFrom = -1;
  private litUntil = -1;
  private lastK = -1;
  private dipUntil = -1;
  private lastDip = -10;
  /** 第五章的声控灯晚 0.5 s 才亮（§3「声控灯」）。 */
  soundDelay = 0;
  /** 设置「减少闪烁」（附录 A-10：要完全生效）：flicker 区间不再按拍闪。 */
  reducedFlicker = false;

  reset(): void {
    this.out = false; this.flicker = null; this.sound = null; this.litFrom = -1; this.litUntil = -1; this.lastK = -1; this.dipUntil = -1;
  }

  onCue(b: LightsCue, snap: SimSnapshot): void {
    const from = b.from ?? snap.segBeat, to = b.to ?? from + 1e6;
    switch (b.op) {
      case 'out': this.out = true; break;
      case 'on': this.out = false; this.sound = null; break;
      case 'flicker': this.flicker = { from, to, every: Math.max(0.5, b.every ?? 1) }; this.lastK = -1; break;
      case 'sound': this.sound = { from, to }; this.soundDelay = snap.chapter === 'ch5' ? 0.5 : 0; break;
      default: break;
    }
  }

  /** 撑跃落地或 ↓ 拍地：声控灯亮 4 s。返回是否触发（给继电器「咔」用）。 */
  trigger(snap: SimSnapshot): boolean {
    if (!this.sound || snap.segBeat < this.sound.from || snap.segBeat > this.sound.to) return false;
    const wasLit = snap.t >= this.litFrom && snap.t < this.litUntil;
    if (!wasLit) this.litFrom = snap.t + this.soundDelay;
    this.litUntil = snap.t + this.soundDelay + 4;
    return !wasLit;
  }

  /** 玩家处的亮度（0..1）。 */
  brightness(snap: SimSnapshot): number {
    let b = this.out ? 0.12 : 1;
    const beat = snap.segBeat;
    if (this.sound && beat >= this.sound.from && beat <= this.sound.to) b = snap.t >= this.litFrom && snap.t < this.litUntil ? 1 : 0;
    const f = this.flicker;
    if (f && !this.reducedFlicker && beat >= f.from && beat <= f.to) {
      const k = Math.floor((beat - f.from) / f.every);
      if (k !== this.lastK) {
        this.lastK = k;
        if (snap.t - this.lastDip >= 0.34) { this.dipUntil = snap.t + 0.09; this.lastDip = snap.t; }
      }
      if (snap.t < this.dipUntil) b *= 0.15;
    }
    return b;
  }
}
