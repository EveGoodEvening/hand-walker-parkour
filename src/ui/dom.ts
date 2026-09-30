// src/ui/dom.ts —— DOM 小工具与「每帧最多一次 DOM 写入」的批处理（DESIGN.md §7 总则、§8.10 WP8 验收 6）。WP8。
// 游玩中的一切 DOM 写入都先记进 DomBatch，UI.frame() 末尾 flush() 一次；事件处理只改模型、不碰 DOM。
// DomBatch 按「元素 × 属性」缓存上一次写入的值，值没变就不写，所以静止的画面每帧零写入。

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** 界面按钮：data-ui-control 让触摸输入忽略它（不当成滑动或「轻触」）。 */
export function button(label: string, onClick: () => void, parent: HTMLElement, disabled = false): HTMLButtonElement {
  const b = h('button', '', label, parent);
  b.type = 'button';
  b.setAttribute('data-ui-control', '1');
  b.disabled = disabled;
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) onClick(); });
  return b;
}

type Cache = Map<string, string>;

export class DomBatch {
  private cache = new WeakMap<Element, Cache>();
  private pending: Array<() => void> = [];
  /** flush() 真正写了 DOM 的次数（测试用）。 */
  flushes = 0;
  /** 最近一次 flush 写入的操作数。 */
  lastOps = 0;

  private c(el: Element): Cache {
    let m = this.cache.get(el);
    if (!m) { m = new Map(); this.cache.set(el, m); }
    return m;
  }
  private changed(el: Element, key: string, value: string): boolean {
    const m = this.c(el);
    if (m.get(key) === value) return false;
    m.set(key, value);
    return true;
  }

  style(el: HTMLElement, prop: string, value: string): void {
    if (this.changed(el, `s:${prop}`, value)) this.pending.push(() => { if (value) el.style.setProperty(prop, value); else el.style.removeProperty(prop); });
  }
  cls(el: Element, name: string, on: boolean): void {
    if (this.changed(el, `c:${name}`, on ? '1' : '0')) this.pending.push(() => el.classList.toggle(name, on));
  }
  text(el: HTMLElement, value: string): void {
    if (this.changed(el, 't', value)) this.pending.push(() => { el.textContent = value; });
  }
  attr(el: Element, name: string, value: string): void {
    if (this.changed(el, `a:${name}`, value)) this.pending.push(() => el.setAttribute(name, value));
  }
  /** 任意结构性写入（增删子元素）。调用方自己保证只在需要时调用。 */
  run(fn: () => void): void { this.pending.push(fn); }
  /** 让缓存忘掉某个元素（元素被移除后）。 */
  forget(el: Element): void { this.cache.delete(el); }

  get dirty(): boolean { return this.pending.length > 0; }

  /** 一次性写入全部待写操作；返回是否写了东西。 */
  flush(): boolean {
    if (!this.pending.length) { this.lastOps = 0; return false; }
    const ops = this.pending;
    this.pending = [];
    for (const f of ops) f();
    this.flushes++;
    this.lastOps = ops.length;
    return true;
  }
}
