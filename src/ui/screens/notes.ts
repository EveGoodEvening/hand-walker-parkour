// src/ui/screens/notes.ts —— 纸条翻看（DESIGN.md §7.2 Notes、§3「纸条」、附录 B.3）。WP8。
// 已获得的纸条排成一行（放不下时换行，不出横向滚动条）；点开后用 CSS 3D 翻转看正反两面。
// 大多数两面都是白的；折着的那张（n1-desk）在第二章打开之前打不开（save.notesOpened 里没有它）。
// 被雨泡过的两张（n3-b、n3-c）纸面发皱。纸条没有任何奖励，不写编号，不写「a/b」。
import type { SaveData } from '../../core/save';
import { availableChapters, getChapter } from '../../levels/chapters/index';
import type { NoteDef } from '../../levels/schema';
import { button, h } from '../dom';
import { fillPaper } from '../hud/Hud';
import { STR } from '../strings';

/** 纸面的外观（数据里没有的呈现细节，附录 B.3）。 */
const WET = new Set(['n3-b', 'n3-c']);

/** 全部章节里定义过的纸条（按章节顺序）。 */
export function allNoteDefs(): NoteDef[] {
  return availableChapters(true).flatMap((c) => getChapter(c)?.notes ?? []);
}
export function noteDef(id: string): NoteDef | null { return allNoteDefs().find((n) => n.id === id) ?? null; }

export interface NoteItem { id: string; def: NoteDef | null; openable: boolean; folded: boolean; wet: boolean }

/** 纸条界面的条目（纯函数）：只列已获得的；折着且没打开过的不能翻看。 */
export function noteItems(sv: SaveData): NoteItem[] {
  const defs = allNoteDefs();
  const order = (id: string) => { const i = defs.findIndex((d) => d.id === id); return i < 0 ? 1e9 : i; };
  return [...sv.notes].sort((a, b) => order(a) - order(b)).map((id) => {
    const def = defs.find((d) => d.id === id) ?? null;
    const folded = !!def?.folded && !sv.notesOpened.includes(id);
    return { id, def, openable: !folded, folded, wet: WET.has(id) };
  });
}

export class NotesScreen {
  private viewer: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  constructor(private el: HTMLElement, private onBack: () => void) {}

  build(sv: SaveData): void {
    this.el.replaceChildren();
    this.viewer = null; this.card = null;
    h('div', 'hw-h', STR.notes, this.el);
    const row = h('div', 'hw-notes-row', undefined, this.el);
    for (const it of noteItems(sv)) {
      const b = button('', () => this.open(it), row, !it.openable);
      b.className = `hw-note-thumb${it.folded ? ' folded' : ''}${it.wet ? ' wet' : ''}${it.def?.face === 'doodle' ? ' doodle' : ''}`;
      b.setAttribute('data-note', it.id);
      b.setAttribute('aria-label', STR.note);
    }
    const menu = h('div', 'hw-menu', undefined, this.el);
    const back = button(STR.back, () => this.onBack(), menu);
    back.classList.add('hw-back');
    // 翻看层
    const viewer = h('div', 'hw-note-viewer', undefined, this.el);
    const card = h('div', 'hw-paper', undefined, viewer);
    const inner = h('div', 'hw-paper-inner', undefined, card);
    h('div', 'hw-paper-face front', undefined, inner);
    h('div', 'hw-paper-face back', undefined, inner);
    viewer.addEventListener('click', () => this.close());
    const flip = button('', () => card.classList.toggle('flipped'), card);
    flip.className = 'hw-note-flip';
    flip.setAttribute('aria-label', STR.note);
    this.viewer = viewer; this.card = card;
  }

  get isOpen(): boolean { return !!this.viewer?.classList.contains('on'); }

  open(it: NoteItem): void {
    if (!it.openable || !this.viewer || !this.card) return;
    const faces = this.card.querySelectorAll<HTMLElement>('.hw-paper-face');
    fillPaper(faces[0] as HTMLElement, it.def, 'front');
    fillPaper(faces[1] as HTMLElement, it.def, 'back');
    this.card.classList.remove('flipped');
    this.card.classList.toggle('wet', it.wet);
    this.viewer.classList.add('on');
    const fb = this.viewer.querySelector<HTMLButtonElement>('.hw-note-flip');
    try { fb?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  flip(): void { this.card?.classList.toggle('flipped'); }

  /** 关闭翻看层；返回是否真的关了（Esc 用）。 */
  close(): boolean {
    if (!this.isOpen) return false;
    this.viewer?.classList.remove('on');
    const first = this.el.querySelector<HTMLButtonElement>('.hw-note-thumb:not([disabled])') ?? this.el.querySelector<HTMLButtonElement>('.hw-back');
    try { first?.focus({ preventScroll: true }); } catch { /* ignore */ }
    return true;
  }
}
