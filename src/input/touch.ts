// src/input/touch.ts —— 触摸输入（DESIGN.md §2.2、D8）。WP8。
// 只认第一根手指；情境按钮、界面按钮单独处理（带 data-ui-control 的元素不进这里）。
//   · run：四向滑动（下滑不抬手 = 按住）；轻点没有玩法含义（D8）。
//   · still：按住屏幕任意处 = ↓（taps3 / tap / any 模式下每次按下都算一下）。
//   · stand：起身前按住屏幕 = ↑；起身后（standHalves）按住左半 / 右半屏 = ← / →。
//   · menu：轻触屏幕空白处 = 确认（「按任意键 / 轻触」跳过开场卡、失败后重来，§7.2）；鼠标点击也算。
// 意图时刻用 pointerdown 的 timeStamp（滑动另加 40 ms，见 gestures.ts）。
import type { Action } from '../core/types';
import { SwipeRecognizer, type SwipeConfig } from './gestures';

export type TouchContextKind = 'run' | 'still' | 'stand' | 'menu';
export interface TouchSink {
  press(a: Action, t: number): void;
  release(a: Action, t: number): void;
  context(): { kind: TouchContextKind; standHalves: boolean };
}

export class TouchInput {
  private pointerId: number | null = null;
  private held: Action | null = null;
  readonly swipe: SwipeRecognizer;
  private el: HTMLElement | null = null;
  constructor(private sink: TouchSink, cfg?: Partial<SwipeConfig>) { this.swipe = new SwipeRecognizer(cfg); }

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /** 当前是否有手指按着（测试用）。 */
  get tracking(): boolean { return this.pointerId !== null; }

  onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('button, [data-ui-control]')) return;       // 界面按钮、情境按钮单独处理
    const ctx = this.sink.context();
    const t = e.timeStamp;
    if (ctx.kind === 'menu') {
      if (e.button > 0) return;                                        // 只认主键 / 手指
      if (e.isPrimary === false) return;
      this.sink.press('confirm', t); this.sink.release('confirm', t);
      return;
    }
    if (e.pointerType === 'mouse') return;                             // 游玩时鼠标只用于点界面按钮
    if (this.pointerId !== null) return;                               // 只认第一根手指
    this.pointerId = e.pointerId;
    try { this.el?.setPointerCapture?.(e.pointerId); } catch { /* 合成事件没有活动指针 */ }
    if (ctx.kind === 'run') { this.swipe.down(e.clientX, e.clientY, t); e.preventDefault(); return; }
    if (ctx.kind === 'still') { this.held = 'down'; this.sink.press('down', t); e.preventDefault(); return; }
    if (ctx.kind === 'stand') {
      const w = this.el?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 1;
      this.held = ctx.standHalves ? (e.clientX < w / 2 ? 'left' : 'right') : 'up';
      this.sink.press(this.held, t);
      e.preventDefault();
    }
  }

  onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.swipe.isActive) return;
    for (const g of this.swipe.move(e.clientX, e.clientY, e.timeStamp)) {
      if (g.kind !== 'swipe') continue;
      if (g.dir === 'down') { this.sink.press('down', g.t); this.held = 'down'; }
      else { this.sink.press(g.dir, g.t); this.sink.release(g.dir, g.t); }
    }
    e.preventDefault();
  }

  onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.swipe.up(e.clientX, e.clientY, e.timeStamp);
    if (this.held) { this.sink.release(this.held, e.timeStamp); this.held = null; }
  }

  /** 情境切换时丢掉正在跟踪的手指（按住的动作由 Input.releaseAll 统一松开）。 */
  reset(): void {
    this.pointerId = null;
    this.held = null;
    if (this.swipe.isActive) this.swipe.cancel(0);
  }
}
