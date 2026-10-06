// src/ui/screens/menus.ts —— 界面容器与焦点导航（DESIGN.md §7.1、§7.2）。WP8。
// 只用淡入淡出；按钮可用 ↑↓（或 W / S）移动焦点、回车确认；设置行用 ← → 改值；Esc / 退格返回上一级。
import type { ScreenName } from '../../core/types';
import { button, h } from '../dom';

export { button, h };

/** 一个界面容器（类名 hw-s-<name>，测试用 [data-screen=…] 选；不要与内部元素重名，见 AGENTS.md Lessons）。 */
export class ScreenEl {
  readonly el: HTMLDivElement;
  constructor(parent: HTMLElement, readonly name: ScreenName, solid = false) {
    this.el = h('div', `hw-screen hw-s-${name}${solid ? ' solid' : ''}`, undefined, parent);
    this.el.setAttribute('data-screen', name);
  }
  clear(): HTMLDivElement { this.el.replaceChildren(); return this.el; }
  get visible(): boolean { return this.el.classList.contains('on'); }
  show(on: boolean): void {
    const was = this.visible;
    this.el.classList.toggle('on', on);
    if (on && !was) this.focusFirst();
  }
  focusFirst(): void {
    const first = this.buttons()[0];
    try { first?.focus({ preventScroll: true }); } catch { /* 焦点失败不致命 */ }
  }
  buttons(): HTMLButtonElement[] {
    return Array.from(this.el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter((b) => !b.closest('.hidden'));
  }
}

/** 方向键在当前界面的按钮间移动焦点。 */
export function moveFocus(screen: ScreenEl, dir: 1 | -1): void {
  const bs = screen.buttons();
  if (!bs.length) return;
  const i = bs.indexOf(document.activeElement as HTMLButtonElement);
  const next = i < 0 ? bs[dir > 0 ? 0 : bs.length - 1] : bs[(i + dir + bs.length) % bs.length];
  focusVisible(next);
}

/** 聚焦并滚进可见区域（设置列表在矮屏上会滚动）。 */
export function focusVisible(b: HTMLElement | null | undefined): void {
  if (!b) return;
  try { b.focus({ preventScroll: true }); } catch { /* ignore */ }
  try { b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
}
