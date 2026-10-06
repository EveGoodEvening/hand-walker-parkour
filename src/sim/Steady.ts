// src/sim/Steady.ts —— 稳度：唯一的失败源（DESIGN.md §2.6、D4）。CORE 编写，归 WP1。
// 扣：绊 −1，撞 −2，软障碍 0。回：连续 16 拍没有受击 +1（施压段、同拍段 24 拍，辅助模式 12 拍）；干脆一次回稳计数 +4 拍
// （施压段、同拍段不加，辅助模式照加；§10.5）。
// 失败：受击后稳度会跌破 0 时摔倒。hidden 模式照常扣，但最低停在 0，不会失败。
import type { FollowerMode, HitSeverity } from '../core/types';
import { TUNING } from './tuning';

const S = TUNING.steady;

export class Steady {
  value: number = S.max;
  max: number = S.max;
  /** 距上次受击以来累计的拍数（回稳计数）。 */
  regen = 0;
  assist = false;

  /** 按追随者模式得到上限：pressure 缺省 2；辅助模式 +1（§2.6）。 */
  static maxFor(mode: FollowerMode, override: number | undefined, assist: boolean): number {
    const base = override ?? (mode === 'pressure' ? S.pressureMax : S.max);
    return base + (assist ? TUNING.assist.steadyBonus : 0);
  }

  regenBeats(mode: FollowerMode): number {
    if (this.assist) return TUNING.assist.regenBeats;
    // 同拍（4-5「同拍考试」）和施压一样 24 拍回 1（最终 QA，DESIGN §10.5）；上限仍是 3
    return mode === 'pressure' ? S.pressureRegenBeats : mode === 'synced' ? S.syncedRegenBeats : S.regenBeats;
  }

  setMax(max: number): void { this.max = max; if (this.value > max) this.value = max; }
  fill(): void { this.value = this.max; this.regen = 0; }

  /**
   * 受击。返回 'fall' 表示摔倒（失败）。hidden 模式或无敌时不会返回 fall。
   */
  hit(sev: HitSeverity, mode: FollowerMode, invincible: boolean): 'ok' | 'fall' {
    const dmg = sev === 'crash' ? 2 : 1;
    this.regen = 0;
    const next = this.value - dmg;
    if (next < 0) {
      if (mode === 'hidden' || invincible) { this.value = 0; return 'ok'; }
      return 'fall';
    }
    this.value = next;
    return 'ok';
  }

  /** 推进 dBeats 拍；返回是否 +1。 */
  progress(dBeats: number, mode: FollowerMode): boolean {
    if (dBeats <= 0) return false;
    if (this.value >= this.max) { this.regen = 0; return false; }
    this.regen += dBeats;
    if (this.regen >= this.regenBeats(mode)) {
      this.regen = 0;
      this.value = Math.min(this.max, this.value + 1);
      return true;
    }
    return false;
  }

  /** 干脆给回稳计数加的拍数：缺省 4（§2.2）；施压段、同拍段 0（§10.5：技巧高潮里干脆只有声音上的对齐）；辅助模式照常 4。 */
  crispBeats(mode: FollowerMode): number {
    if (!this.assist && (mode === 'pressure' || mode === 'synced')) return S.pressureCrispBonusBeats;
    return S.crispBonusBeats;
  }

  /** 干脆：回稳计数 +crispBeats 拍。返回是否因此 +1。 */
  crisp(mode: FollowerMode): boolean { return this.progress(this.crispBeats(mode), mode); }

  /** 回头收益（每章第一次 +1，§3）。 */
  gain(n: number): void { this.value = Math.min(this.max, this.value + n); }
}
