// src/sim/LookBack.ts —— 回头（DESIGN.md §3「回头」、D7、§2.4 lookBack、§2.8 R10）。CORE 写在 Sim 里的初版，WP1 抽出并补全。
// 情境动作：只在回头窗口（WindowDef type 'lookBack'）内可用，键盘 Q，触屏右下角情境按钮。
// 镜头 0.25 s 转 160°，停 0.4 s，0.25 s 转回（期间照常前进，窗口保证安全）；追随者的声音停 1.2 s（WP7 读 lookBack 事件）。
// 收益：窗口 gain = 1 且是本章第一次回头时稳度 +1，之后为 0。auto = true 的窗口在窗口结束时如果玩家还没回头，自动回头一次
// （1-5「到 @136 自动回头」）；auto 为假的窗口过了就过了（3-6 收益 0，不自动）。窗口的 then 在回头开始时按相对秒数排进 timeline。
import type { CompiledSegment, CompiledWindow } from '../levels/schema';
import { TUNING } from './tuning';

const L = TUNING.lookBack;
export type WinState = 'pending' | 'active' | 'done';

export class LookBackRuntime {
  /** 每个窗口的状态（与 seg.windows 下标对应；非 lookBack 窗口恒为 done）。 */
  states: WinState[] = [];
  /** 回头动作的计时（秒，< 0 表示没有在回头）。 */
  t = -1;
  gain: 0 | 1 = 0;
  auto = false;
  /** 本章是否已经拿过回头收益（每章第一次 +1）。 */
  gainUsed = false;
  /** 此刻是否处在可以回头的窗口里（情境按钮可见）。 */
  available = false;
  private seg: CompiledSegment | null = null;

  /** 读章时调用：收益记录清零。 */
  resetChapter(): void { this.gainUsed = false; this.t = -1; this.available = false; }

  /** 进段：beat 之前已经结束的窗口标为 done。 */
  enterSegment(seg: CompiledSegment, beat: number): void {
    this.seg = seg;
    this.states = seg.windows.map((w) => (w.type !== 'lookBack' || w.to < beat ? 'done' : 'pending'));
    this.t = -1;
    this.available = false;
  }

  /** 当前可用的窗口下标（-1 = 没有）。 */
  activeIndex(): number { return this.states.indexOf('active'); }
  activeWindow(): CompiledWindow | null {
    const i = this.activeIndex();
    return i >= 0 ? (this.seg?.windows[i] ?? null) : null;
  }

  /**
   * 按段内拍号推进窗口：到 from 变为可用；到 to 时 auto 窗口自动回头（通过 onAuto 回调），否则关闭。
   * 返回可用性是否变化。
   */
  updateWindows(beat: number, onAuto: (i: number) => void): boolean {
    const wins = this.seg?.windows ?? [];
    let avail = false;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (!w || w.type !== 'lookBack') continue;
      if (this.states[i] === 'pending' && beat >= w.from) this.states[i] = 'active';
      if (this.states[i] === 'active') {
        if (beat >= w.to) {
          if (w.auto) onAuto(i); else this.states[i] = 'done';
        } else avail = true;
      }
    }
    const changed = avail !== this.available;
    this.available = avail;
    return changed;
  }

  /** 开始回头（玩家按 Q 或自动）。返回 { gain, window }；窗口不可用时返回 null。 */
  start(i: number, auto: boolean): { gain: 0 | 1; window: CompiledWindow } | null {
    const w = this.seg?.windows[i];
    if (!w || this.states[i] !== 'active') return null;
    this.states[i] = 'done';
    this.t = 0;
    this.auto = auto;
    const gain: 0 | 1 = w.gain === 1 && !this.gainUsed ? 1 : 0;
    if (gain) this.gainUsed = true;
    this.gain = gain;
    this.available = false;
    return { gain, window: w };
  }

  /** 推进回头动作；返回 true 表示本 tick 回头结束（发 lookBack end）。 */
  update(dt: number): boolean {
    if (this.t < 0) return false;
    this.t += dt;
    if (this.t >= L.turn + L.hold + L.back) { this.t = -1; return true; }
    return false;
  }

  /** 镜头转向身后的程度 0..1（PlayerSnap.lookBack）。 */
  value(): number {
    if (this.t < 0) return 0;
    const t = this.t;
    if (t < L.turn) return t / L.turn;
    if (t < L.turn + L.hold) return 1;
    return Math.max(0, 1 - (t - L.turn - L.hold) / L.back);
  }
}

/** 一次回头动作的总时长（秒）。 */
export const LOOK_TOTAL = L.turn + L.hold + L.back;
