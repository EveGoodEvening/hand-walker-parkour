// src/ui/screens/cards.ts —— 开场卡、暂停、失败卡、结尾卡、演职卡（DESIGN.md §7.2、§2.7、附录 B.1、B.4–B.7）。WP8。
// 只用淡入淡出（CSS 动画，真实时间）；失败卡的提示按模拟时间在 1.2 s 出现（UI.frame 负责切换，?test=1 下也成立）。
import type { ChapterId, RunStats } from '../../core/types';
import { getChapter } from '../../levels/chapters/index';
import { lineText } from '../../levels/lines';
import type { StillInput } from '../../levels/schema';
import { button, h } from '../dom';
import type { ProgressView } from '../hud/progress';
import { statsLine, STR } from '../strings';

export interface IntroData { chapter: ChapterId; title: string; name: string; lines: string[] }
export interface FailData { line: string }
export interface OutroData { chapter: ChapterId; stats: RunStats; next: ChapterId | null; lines: string[]; notes: { got: number; total: number } | null }
export interface PauseData { slowAvailable?: boolean; slowOn?: boolean }

/** 开场卡：「第一章」小字 → 0.6 s 章名大字 → 再 0.6 s 开场句（一句拆两行时每行再晚 0.6 s）。 */
export function buildIntro(el: HTMLElement, d: IntroData | undefined): void {
  el.replaceChildren();
  if (!d) return;
  const card = h('div', 'hw-card hw-intro', undefined, el);
  h('div', 'small', d.title, card);
  const big = h('div', 'big', d.name, card);
  big.style.animationDelay = '.6s';
  d.lines.forEach((l, i) => { const e = h('div', 'line', l, card); e.style.animationDelay = `${1.2 + i * 0.6}s`; });
}

/** 暂停：画面压暗，「暂停」；继续 / 从检查点重来 / 设置 / （放慢一点）/ 回到标题；下方 1 px 章节进度线。 */
export function buildPause(el: HTMLElement, d: PauseData, prog: ProgressView | null,
  a: { resume(): void; retry(): void; settings(): void; slow(on: boolean): void; toTitle(): void }): void {
  el.replaceChildren();
  h('div', 'hw-h', STR.pause, el);
  const menu = h('div', 'hw-menu', undefined, el);
  button(STR.resume, a.resume, menu);
  button(STR.retry, a.retry, menu);
  button(STR.settings, a.settings, menu);
  if (d.slowAvailable) {
    // 「放慢一点」：同一检查点连续失败 3 次后安静地多出来；只对本段生效，速度 ×0.9；不弹窗、不劝说（§2.7）
    const label = () => `${STR.slower}　${d.slowOn ? STR.on : STR.off}`;
    const b = button(label(), () => { d.slowOn = !d.slowOn; a.slow(!!d.slowOn); b.textContent = label(); }, menu);
    b.classList.add('hw-slow');
  }
  button(STR.toTitle, a.toTitle, menu);
  if (prog) {
    const bar = h('div', 'hw-progress', undefined, el);
    bar.setAttribute('aria-hidden', 'true');
    for (const m of prog.marks) { const k = h('i', 'tick', undefined, bar); k.style.left = `${(m * 100).toFixed(2)}%`; }
    const dot = h('b', 'dot', undefined, bar);
    dot.style.left = `${(prog.pos * 100).toFixed(2)}%`;
  }
}

/** 失败卡：中间一行身体感受的原文句子；提示与按钮先藏着，1.2 s（模拟时间）后由 UI 显示。 */
export function buildFail(el: HTMLElement, d: FailData | undefined, touch: boolean, a: { again(): void; back(): void }):
  { prompt: HTMLDivElement; actions: HTMLDivElement } {
  el.replaceChildren();
  const card = h('div', 'hw-card hw-fail', undefined, el);
  h('div', 'line', d?.line ?? '', card);
  const prompt = h('div', 'prompt', touch ? STR.failTouch : STR.failKey, card);
  const actions = h('div', 'hw-menu hw-fail-actions hidden', undefined, el);
  button(STR.again, a.again, actions);
  button(STR.back, a.back, actions);
  return { prompt, actions };
}

/** 结尾卡里需要玩家输入的那一步（第四章「↓ ↓ ↓」）。 */
export interface OutroStep { kind: 'line'; text: string }
export interface OutroInputStep { kind: 'input'; input: StillInput; id?: string }

/** 结尾卡的步骤：Game 只传了文字行；有输入的章从章节数据里读完整顺序。 */
export function outroSteps(d: OutroData): Array<OutroStep | OutroInputStep> {
  const def = getChapter(d.chapter);
  const src = def?.outro.lines ?? [];
  if (!src.some((l) => 'input' in l)) return d.lines.map((text) => ({ kind: 'line' as const, text }));
  return src.map((l) => ('line' in l ? { kind: 'line' as const, text: lineText(l.line) } : { kind: 'input' as const, input: l.input, ...(l.id ? { id: l.id } : {}) }));
}

/** 演职卡（B.7）。 */
export function buildCredits(el: HTMLElement, toTitle: () => void): void {
  el.replaceChildren();
  const card = h('div', 'hw-card hw-credits', undefined, el);
  STR.credits.forEach((l, i) => { const e = h('div', 'line', l, card); e.style.animationDelay = `${0.4 + i * 1.2}s`; });
  const menu = h('div', 'hw-menu', undefined, el);
  const b = button(STR.toTitle, toTitle, menu);
  b.style.animationDelay = `${0.4 + STR.credits.length * 1.2}s`;
  b.classList.add('late');
}

/** 结尾统计行（B.6；第四章不显示纸条）。 */
export function outroStats(d: OutroData): string {
  return statsLine(d.stats.timeMs, d.stats.falls, d.stats.lookBacks, d.chapter === 'ch4' ? null : d.notes);
}
