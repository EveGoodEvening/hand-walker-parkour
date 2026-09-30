// src/input/touch.ts —— 触摸输入（DESIGN.md §2.2、D8）。CORE 写初版，之后归 WP8。
// 只认第一根手指；跑段四向滑动（下滑不抬手即按住）；静场按住屏幕任意处 = ↓；站立段按住左 / 右半屏 = ← / →，
// 起身前（standHalves = false）按住屏幕 = ↑。情境按钮单独处理（Input.ts）。
import type { Action } from '../core/types';
import { SwipeRecognizer, type SwipeConfig } from './gestures';

export interface TouchSink {
  press(a: Action, t: number): void;
  release(a: Action, t: number): void;
  context(): { kind: 'run' | 'still' | 'stand' | 'menu'; standHalves: boolean };
}

export class TouchInput {
  private pointerId: number | null = null;
  private held: Action | null = null;
  readonly swipe: SwipeRecognizer;
  constructor(private sink: TouchSink, cfg?: SwipeConfig) { this.swipe = new SwipeRecognizer(cfg); }

  attach(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => this.onDown(e, el), { passive: false });
    el.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent, el: HTMLElement): void {
    if (e.pointerType === 'mouse') return;            // 鼠标只用于点界面按钮
    if ((e.target as HTMLElement | null)?.closest?.('button, [data-ui-control]')) return;
    if (this.pointerId !== null) return;              // 只认第一根手指
    this.pointerId = e.pointerId;
    const ctx = this.sink.context();
    const t = e.timeStamp;
    if (ctx.kind === 'run') { this.swipe.down(e.clientX, e.clientY, t); e.preventDefault(); return; }
    if (ctx.kind === 'still') { this.held = 'down'; this.sink.press('down', t); e.preventDefault(); return; }
    if (ctx.kind === 'stand') {
      const w = el.clientWidth || 1;
      this.held = ctx.standHalves ? (e.clientX < w / 2 ? 'left' : 'right') : 'up';
      this.sink.press(this.held, t);
      e.preventDefault();
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.swipe.isActive) return;
    for (const g of this.swipe.move(e.clientX, e.clientY, e.timeStamp)) {
      if (g.kind !== 'swipe') continue;
      if (g.dir === 'down') { this.sink.press('down', g.t); this.held = 'down'; }
      else { this.sink.press(g.dir, g.t); this.sink.release(g.dir, g.t); }
    }
    e.preventDefault();
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.swipe.up(e.clientX, e.clientY, e.timeStamp);
    if (this.held) { this.sink.release(this.held, e.timeStamp); this.held = null; }
  }
}
