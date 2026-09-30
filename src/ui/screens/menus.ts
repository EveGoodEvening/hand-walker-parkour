// src/ui/screens/menus.ts —— 各界面的 DOM 构建（DESIGN.md §7.1、§7.2）。CORE 写初版（框架），之后归 WP8。
// 只用淡入淡出；按钮可用方向键 ↑↓ 移动焦点、回车确认；Esc / 退格返回上一级（暂停界面的 Esc 由 Game 处理）。
import type { ScreenName } from '../../core/types';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function button(label: string, onClick: () => void, parent: HTMLElement, disabled = false): HTMLButtonElement {
  const b = h('button', '', label, parent);
  b.type = 'button';
  b.setAttribute('data-ui-control', '1');
  b.disabled = disabled;
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) onClick(); });
  return b;
}

/** 一个界面容器。 */
export class ScreenEl {
  readonly el: HTMLDivElement;
  constructor(parent: HTMLElement, readonly name: ScreenName, solid = false) {
    this.el = h('div', `hw-screen hw-${name}${solid ? ' solid' : ''}`, undefined, parent);
    this.el.setAttribute('data-screen', name);
  }
  clear(): HTMLDivElement { this.el.replaceChildren(); return this.el; }
  show(on: boolean): void {
    this.el.classList.toggle('on', on);
    if (on) {
      const first = this.el.querySelector<HTMLButtonElement>('button:not([disabled])');
      try { first?.focus({ preventScroll: true }); } catch { /* 焦点失败不致命 */ }
    }
  }
  buttons(): HTMLButtonElement[] { return Array.from(this.el.querySelectorAll<HTMLButtonElement>('button:not([disabled])')); }
}

/** 方向键在当前界面的按钮间移动焦点。 */
export function moveFocus(screen: ScreenEl, dir: 1 | -1): void {
  const bs = screen.buttons();
  if (!bs.length) return;
  const i = bs.indexOf(document.activeElement as HTMLButtonElement);
  const next = bs[(i + dir + bs.length) % bs.length] ?? bs[0];
  next?.focus();
}
