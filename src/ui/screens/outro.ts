// src/ui/screens/outro.ts —— 结尾卡（DESIGN.md §7.2 Outro、§4.4 第四章可交互结尾、§4.5 第五章 → 演职卡、附录 B.1、B.6）。WP8。
// 结尾句逐行淡入，间隔 1.8 s（U4：§7.2 的 0.9 s 读不完一句）；最后一行小字统计；下面是「下一章」「重玩本章」「回到标题」。不评级。
// 第四章：先显示第一句 → 提示「↓ ↓ ↓」（每按一下算一下；超时自动）→ 其余两句。输入只影响画面上的节奏，不计分。
// 第五章（终章，没有下一章）：两句之间 2.8 s；最后一句之后留 5 s 空白，什么都不出；然后才是统计和按钮，
// 统计出现 7 s 后自动进入演职卡。
// 结尾卡期间模拟不推进，这里用真实时间计时。
// 等输入的开始和结束在 window 上发 OUTRO_AWAIT_EVENT（修复轮 B3）：这段时间里任何键都是结尾卡的输入，声音包不发菜单音。
import type { Device } from '../../core/types';
import { button, h } from '../dom';
import { hintText, STR } from '../strings';
import { outroStats, outroSteps, type OutroData, type OutroInputStep } from './cards';

/** 结尾句的行间隔（秒），第一至第四章。 */
export const OUTRO_LINE_GAP = 1.8;
/** 第四章的输入提示在输入之前那一句开始淡入之后多久出现（e2e:chapters 在 2.5 s 时按 ↓，提示要在那之前出来）。 */
export const OUTRO_HINT_AFTER = 1.6;
/** 终章（第五章）：行间隔、最后一句之后的空白、统计出现之后到演职卡。 */
export const FINAL_OUTRO = { lineGap: 2.8, blankAfter: 5.0 } as const;
export const CREDITS_AFTER = 7.0;
/** 第一句开始淡入的时刻。 */
const FIRST_AT = 0.3;
/**
 * 结尾卡开始 / 结束等输入时在 window 上发的事件（detail = true / false，修复轮 B3）。等输入时界面把每一次按键都当作结尾卡的输入
 * （↓ 是床单上的一下，别的键什么也不做），声音包（audio/ui.ts）据此不发菜单的「移动」「确认」声。
 */
export const OUTRO_AWAIT_EVENT = 'hw-ui-await';

function announceAwait(on: boolean): void {
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent(OUTRO_AWAIT_EVENT, { detail: on }));
  } catch { /* 没有 DOM（单元测试）就不发 */ }
}

export interface OutroActions {
  next(): void; replay(): void; toTitle(): void; device(): Device;
  /** lead 集成：结尾卡输入每一下（n = 第几下）和超时自动完成（n = 0）都报给 Game（GameCommands.outroInput）。 */
  input?(id: string | undefined, n: number): void;
}

export class OutroScreen {
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private waiting: { step: OutroInputStep; taps: number; need: number; resolve: () => void } | null = null;
  private card: HTMLDivElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  /** 本卡的时间表（秒，从 build 起算；测试用）：统计出现、演职卡。 */
  timing: { statsAt: number; creditsAt: number | null } = { statsAt: 0, creditsAt: null };
  constructor(private el: HTMLElement, private a: OutroActions) {}

  get awaitingInput(): boolean { return !!this.waiting; }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.waiting) { this.waiting = null; announceAwait(false); }
  }

  private later(sec: number, fn: () => void): void { this.timers.push(setTimeout(fn, Math.max(0, sec * 1000))); }

  build(d: OutroData): void {
    this.dispose();
    this.el.replaceChildren();
    const card = h('div', 'hw-card hw-outro', undefined, this.el);
    this.card = card;
    const steps = outroSteps(d);
    const firstInput = steps.findIndex((s) => s.kind === 'input');
    const final = !d.next && d.chapter === 'ch5';
    const gap = final ? FINAL_OUTRO.lineGap : OUTRO_LINE_GAP;
    const menu = h('div', 'hw-menu hw-outro-actions', undefined, this.el);
    const addLine = (text: string, delay: number) => { const e = h('div', 'line', text, card); e.style.animationDelay = `${delay.toFixed(2)}s`; return e; };
    /** 统计与按钮：最后一句（从 delay 起第 lineCount 句）之后一个行间隔；终章之后留空白（elapsed = 这一段之前已经过去的秒数）。 */
    const finish = (delay: number, lineCount: number, elapsed: number) => {
      const st = h('div', 'stats', outroStats(d), card);
      const last = delay + Math.max(0, lineCount - 1) * gap;
      const at = lineCount > 0 ? last + (final ? FINAL_OUTRO.blankAfter : gap) : delay;
      st.style.animationDelay = `${at.toFixed(2)}s`;
      if (d.next) button(STR.next, this.a.next, menu);
      button(STR.replay, this.a.replay, menu);
      button(STR.toTitle, this.a.toTitle, menu);
      menu.style.animationDelay = `${(at + 0.4).toFixed(2)}s`;
      menu.classList.add('late');
      this.timing = { statsAt: elapsed + at, creditsAt: final ? elapsed + at + CREDITS_AFTER : null };
      if (final) this.later(at + CREDITS_AFTER, () => this.a.next());
    };
    if (firstInput < 0) {
      const lines = steps.map((s) => (s.kind === 'line' ? s.text : ''));
      lines.forEach((l, i) => addLine(l, FIRST_AT + i * gap));
      finish(FIRST_AT, lines.length, 0);
      return;
    }
    // 可交互：输入之前的行 → 提示 → 等输入 → 其余行
    const pre = steps.slice(0, firstInput).flatMap((s) => (s.kind === 'line' ? [s.text] : []));
    pre.forEach((l, i) => addLine(l, FIRST_AT + i * gap));
    const step = steps[firstInput] as OutroInputStep;
    const post = steps.slice(firstInput + 1).flatMap((s) => (s.kind === 'line' ? [s.text] : []));
    const hintAt = pre.length ? FIRST_AT + (pre.length - 1) * gap + OUTRO_HINT_AFTER : FIRST_AT + 0.3;
    const hint = h('div', 'hint', hintText(step.input.hint, this.a.device()), card);
    hint.style.animationDelay = `${hintAt.toFixed(2)}s`;
    this.hintEl = hint;
    const t0 = Date.now();
    const done = () => {
      if (!this.waiting) return;
      if (this.waiting.taps === 0) this.a.input?.(step.id, 0);
      this.waiting = null;
      announceAwait(false);
      hint.classList.add('done');
      post.forEach((l, i) => addLine(l, 0.4 + i * gap));
      finish(0.4, post.length, (Date.now() - t0) / 1000);
    };
    this.later(hintAt, () => {
      this.waiting = { step, taps: 0, need: step.input.mode === 'taps3' ? 3 : 1, resolve: done };
      announceAwait(true);
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
    this.a.input?.(w.step.id, w.taps);
    if (this.card && this.hintEl) this.hintEl.setAttribute('data-taps', String(w.taps));
    if (w.taps >= w.need) w.resolve();
    return true;
  }
}
