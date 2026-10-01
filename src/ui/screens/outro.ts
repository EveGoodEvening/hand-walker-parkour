// src/ui/screens/outro.ts —— 结尾卡（DESIGN.md §7.2 Outro、§4.4 第四章可交互结尾、§4.5 第五章 → 演职卡、附录 B.1、B.6）。WP8。
// 结尾句逐行淡入，间隔 0.9 s；最后一行小字统计；下面是「下一章」「重玩本章」「回到标题」。不评级。
// 第四章：先显示第一句 → 提示「↓ ↓ ↓」（每按一下算一下；超时自动）→ 其余两句。输入只影响画面上的节奏，不计分。
// 第五章（没有下一章）：统计出现后停一会儿，自动进入演职卡。
// 结尾卡期间模拟不推进，这里用真实时间计时。
import type { Device } from '../../core/types';
import { button, h } from '../dom';
import { hintText, STR } from '../strings';
import { outroStats, outroSteps, type OutroData, type OutroInputStep } from './cards';

export const OUTRO_LINE_GAP = 0.9;
export const CREDITS_AFTER = 3.2;

export interface OutroActions { next(): void; replay(): void; toTitle(): void; device(): Device }

export class OutroScreen {
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private waiting: { step: OutroInputStep; taps: number; need: number; resolve: () => void } | null = null;
  private card: HTMLDivElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  constructor(private el: HTMLElement, private a: OutroActions) {}

  get awaitingInput(): boolean { return !!this.waiting; }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.waiting = null;
  }

  private later(sec: number, fn: () => void): void { this.timers.push(setTimeout(fn, Math.max(0, sec * 1000))); }

  build(d: OutroData): void {
    this.dispose();
    this.el.replaceChildren();
    const card = h('div', 'hw-card hw-outro', undefined, this.el);
    this.card = card;
    const steps = outroSteps(d);
    const firstInput = steps.findIndex((s) => s.kind === 'input');
    const menu = h('div', 'hw-menu hw-outro-actions', undefined, this.el);
    const addLine = (text: string, delay: number) => { const e = h('div', 'line', text, card); e.style.animationDelay = `${delay.toFixed(2)}s`; return e; };
    const finish = (delay: number, lineCount: number) => {
      const st = h('div', 'stats', outroStats(d), card);
      const at = delay + lineCount * OUTRO_LINE_GAP;
      st.style.animationDelay = `${at.toFixed(2)}s`;
      if (d.next) button(STR.next, this.a.next, menu);
      button(STR.replay, this.a.replay, menu);
      button(STR.toTitle, this.a.toTitle, menu);
      menu.style.animationDelay = `${(at + 0.4).toFixed(2)}s`;
      menu.classList.add('late');
      if (!d.next && d.chapter === 'ch5') this.later(at + CREDITS_AFTER, () => this.a.next());
    };
    if (firstInput < 0) {
      const lines = steps.map((s) => (s.kind === 'line' ? s.text : ''));
      lines.forEach((l, i) => addLine(l, 0.3 + i * OUTRO_LINE_GAP));
      finish(0.3, lines.length);
      return;
    }
    // 可交互：输入之前的行 → 提示 → 等输入 → 其余行
    const pre = steps.slice(0, firstInput).flatMap((s) => (s.kind === 'line' ? [s.text] : []));
    pre.forEach((l, i) => addLine(l, 0.3 + i * OUTRO_LINE_GAP));
    const step = steps[firstInput] as OutroInputStep;
    const post = steps.slice(firstInput + 1).flatMap((s) => (s.kind === 'line' ? [s.text] : []));
    const hintAt = 0.3 + pre.length * OUTRO_LINE_GAP + 0.6;
    const hint = h('div', 'hint', hintText(step.input.hint, this.a.device()), card);
    hint.style.animationDelay = `${hintAt.toFixed(2)}s`;
    this.hintEl = hint;
    const done = () => {
      if (!this.waiting) return;
      this.waiting = null;
      hint.classList.add('done');
      post.forEach((l, i) => addLine(l, 0.4 + i * OUTRO_LINE_GAP));
      finish(0.4, post.length);
    };
    this.later(hintAt, () => {
      this.waiting = { step, taps: 0, need: step.input.mode === 'taps3' ? 3 : 1, resolve: done };
      this.later(Math.max(0.5, step.input.timeout), done);
    });
  }

  /** 结尾卡输入：key 为 'down'（↓ / S / 轻触）或 'any'。返回是否被结尾卡用掉。 */
  press(key: 'down' | 'any'): boolean {
    const w = this.waiting;
    if (!w) return false;
    const mode = w.step.input.mode;
    if (mode !== 'any' && key !== 'down') return true;
    w.taps++;
    if (this.card && this.hintEl) this.hintEl.setAttribute('data-taps', String(w.taps));
    if (w.taps >= w.need) w.resolve();
    return true;
  }
}
