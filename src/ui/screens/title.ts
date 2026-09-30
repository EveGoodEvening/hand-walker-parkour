// src/ui/screens/title.ts —— 标题与章节界面（DESIGN.md §7.2 Title、Chapters）。WP8。
// 标题：右侧竖排大字「手行者」（逐字堆叠，不依赖竖排字形度量，见 AGENTS.md Lessons），下面一行小字「掌根，指节，指腹。」；
// 菜单只有「开始」（有存档时显示「继续」）、「章节」、「设置」、「纸条」；角落「改编自小说《手行者》」；
// 首次启动时一行「建议佩戴耳机……」；底部三个小点按掌根、指节、指腹的节奏缓缓亮起。背景是实时 3D（View 负责）。
// 章节：竖排 5 行。已完成的章行尾一道短横线加「纸条 a/b」（第四章不显示）；未解锁只显示「——」，不画锁。
import type { SaveAPI, SaveData } from '../../core/save';
import type { ChapterId } from '../../core/types';
import { availableChapters, CHAPTER_ORDER, getChapter, nextChapterOf } from '../../levels/chapters/index';
import { button, h } from '../dom';
import { CHAPTER_NAMES, notesLine, STR } from '../strings';

export interface TitleActions { onContinue(): void; onStart(): void; onChapters(): void; onSettings(): void; onNotes(): void }

export function buildTitle(el: HTMLElement, save: SaveAPI, a: TitleActions): void {
  el.replaceChildren();
  const vert = (cls: string, text: string) => { const box = h('div', cls, undefined, el); for (const ch of Array.from(text)) h('span', '', ch, box); };
  vert('hw-title', STR.title);
  vert('hw-sub', STR.subtitle);
  const menu = h('div', 'hw-menu hw-title-menu', undefined, el);
  const sv = save.load();
  if (sv.last && getChapter(sv.last.chapter)) button(STR.continue, a.onContinue, menu);
  else button(STR.start, a.onStart, menu);
  button(STR.chapters, a.onChapters, menu);
  button(STR.settings, a.onSettings, menu);
  button(STR.notes, a.onNotes, menu);
  h('div', 'hw-corner', STR.adapted, el);
  if (!sv.firstRunShown) { h('div', 'hw-notice', STR.firstRun, el); save.patch({ firstRunShown: true }); }
  const p = h('div', 'hw-pulse', undefined, el);
  for (let i = 0; i < 3; i++) h('i', '', undefined, p);
}

export interface ChapterRow { id: ChapterId; label: string; enabled: boolean; done: boolean; notes: string | null }

/** 某章是否打完：记录在界面存档里，或者下一章已经解锁（第一到四章）。 */
export function chapterDone(id: ChapterId, sv: SaveData, completed: readonly ChapterId[]): boolean {
  if (completed.includes(id)) return true;
  const i = CHAPTER_ORDER.indexOf(id);
  const nextId = i >= 0 && i + 1 < CHAPTER_ORDER.length ? CHAPTER_ORDER[i + 1] : null;
  return !!nextId && sv.unlocked.includes(nextId) && nextChapterOf(id) !== null;
}

/** 章节列表的行（纯函数）。 */
export function chapterRows(sv: SaveData, completed: readonly ChapterId[]): ChapterRow[] {
  const avail = new Set(availableChapters());
  return CHAPTER_ORDER.map((c) => {
    const def = getChapter(c);
    const enabled = !!def && avail.has(c) && sv.unlocked.includes(c);
    const done = enabled && chapterDone(c, sv, completed);
    let notes: string | null = null;
    if (done && c !== 'ch4' && def) {
      const pickups = def.notes.filter((n) => n.pickup).map((n) => n.id);
      if (pickups.length) notes = notesLine(pickups.filter((id) => sv.notes.includes(id)).length, pickups.length);
    }
    const label = c === 'ch1' || c === 'ch2' || c === 'ch3' || c === 'ch4' || c === 'ch5' ? CHAPTER_NAMES[c] : c;
    return { id: c, label: enabled ? label : STR.locked, enabled, done, notes };
  });
}

export function buildChapters(el: HTMLElement, rows: readonly ChapterRow[], onStart: (c: ChapterId) => void, onBack: () => void): void {
  el.replaceChildren();
  const menu = h('div', 'hw-menu hw-chapter-list', undefined, el);
  for (const r of rows) {
    const b = button('', () => onStart(r.id), menu, !r.enabled);
    b.classList.add('hw-chrow');
    b.setAttribute('data-chapter', r.id);
    h('span', 'name', r.label, b);
    if (r.done) {
      h('i', 'dash', undefined, b);
      if (r.notes) h('span', 'notes', r.notes, b);
    }
  }
  const back = button(STR.back, onBack, menu);
  back.classList.add('hw-back');
}
