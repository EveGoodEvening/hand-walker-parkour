// src/core/loop.ts —— 固定步长主循环（DESIGN.md §2.3、§8.3）。CORE 冻结。
// 累加器模式：120 Hz；每帧最多追 8 个 tick；dt 上限 0.1 s；支持 timeScale。
// `?test=1` 时 rAF 只渲染、不推进模拟（由 __game.step / advance 同步推进），那时本类只用 manual 模式。
import { TICK_HZ } from './constants';

export interface LoopHooks {
  /** 推进一个 tick（1/120 s 模拟时间）。 */
  tick(): void;
  /** 渲染一帧：alpha 为插值系数，dt 为真实秒数（已乘 timeScale）。 */
  frame(alpha: number, dt: number): void;
}

export class FixedLoop {
  readonly step = 1 / TICK_HZ;
  timeScale = 1;
  /** true = 只渲染，不推进（test 模式或暂停）。 */
  manual = false;
  maxCatchUp = 8;
  private acc = 0;
  private last = -1;
  private raf = 0;
  private running = false;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const rafFn = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame;
    if (!rafFn) return;
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = rafFn(loop);
    };
    this.raf = rafFn(loop);
  }

  stop(): void {
    this.running = false;
    const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame;
    caf?.(this.raf);
  }

  /** 处理一帧（rAF 回调或测试直接调用）。nowMs 为 performance.now()。 */
  frame(nowMs: number): number {
    const dtReal = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, (nowMs - this.last) / 1000));
    this.last = nowMs;
    const dt = dtReal * this.timeScale;
    let n = 0;
    if (!this.manual) {
      this.acc += dt;
      while (this.acc >= this.step && n < this.maxCatchUp) {
        this.hooks.tick();
        this.acc -= this.step;
        n++;
      }
      if (n >= this.maxCatchUp) this.acc = 0; // 追不上就丢弃，避免死亡螺旋
    }
    this.hooks.frame(this.manual ? 1 : this.acc / this.step, dt);
    return n;
  }

  /** 重置累加器（暂停恢复、读章之后调用，避免一次性追帧）。 */
  resetClock(): void { this.acc = 0; this.last = -1; }
}
