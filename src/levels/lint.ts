// src/levels/lint.ts —— 内容 lint（DESIGN.md §2.8 R11、R13、R14，附录 B.8，§8.10 WP2 验收 4–6）。归 WP2。
// 纯函数，Node 可跑，不 import three，也**不 import sourceQuotes.ts**（原文由调用方传入，避免被打进产物）。
// 用法：
//   · tests/unit/content/**：lintContent({ chapters, sources: SOURCE_CHAPTERS })，零 error。
//   · WP8：lintStrings(STR) 等（附录 B.8 同时作用于 ui/strings.ts；键名 Q、E、Enter 例外）。
//   · WP1 的 scripts/validate-levels.ts：同上调用 lintContent，与校验器一起报告（见 docs/contract-requests/WP2.md）。
import { LIMITS, TEXT } from '../core/constants';
import type { SetId } from '../core/types';
import { compile } from './compile';
import { KIT_VARIANTS, SET_VARIANTS } from './kitSymbols';
import { LINES, LINE_HOOKS, type LineEntry } from './lines';
import type { ChapterDef, EventBody, SegmentDef, StillInput } from './schema';

export interface LintIssue { level: 'error' | 'warn'; rule: string; where: string; msg: string }
export type SourceTexts = Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, string>>>;

/** 附录 B.8 词表。 */
export const BANNED_WORDS: readonly string[] = [
  'yyds', '绝绝子', '破防', '内卷', '躺平', '666', '哈哈', '恭喜', '完美', '胜利', '通关', '成就', '解锁', '连击', '分数', '评级',
];
/** 附录 B.8：三份提案里出现过、禁止出现的自创句（包含即违规）。 */
export const BANNED_SENTENCES: readonly string[] = [
  '肩膀上，多了一只手。', '节奏散了。', '它没有等你。', '你前面。', '它搭上了我的肩。', '它走远了。', '走了四步。',
];
/** 附录 B.8：第四章原文混入英文的两句，禁止引用（包括它们的任何片段）。 */
export const FORBIDDEN_SOURCE: readonly string[] = [
  '广场 suddenly 变得很安静。',
  '纹路很清楚，但没有灰，没有雨水，没有 chalk 的粉末。',
];
/** 唯一允许的感叹号（R14）。 */
export const ALLOWED_EXCLAMATION = '看！';
/** ui/strings.ts 里允许出现的拉丁字母（键名，附录 B.8）。 */
export const ALLOWED_KEY_NAMES: readonly string[] = ['Enter', 'Q', 'E'];
/** 只有这三张纸条有字（§3「纸条」、附录 B.3、WP2 验收 4）。 */
export const NOTES_WITH_TEXT: ReadonlySet<string> = new Set(['n1-desk', 'n1-a', 'n5-note']);

/** 显示字数：按 Unicode 码点计（「……」「——」各算 2 字）。 */
export function charCount(s: string): number { return Array.from(s).length; }

const LATIN = /[A-Za-zＡ-Ｚａ-ｚ]/;
const EMOJI = /\p{Extended_Pictographic}/u;
/** 「走了 N 步」：N 只能是七（附录 B.8、附录 D）。 */
const WALKED_N = /走了\s*([^\s步，。]{1,4})\s*步/g;

/** 单条文字的规则（R14、附录 B.8）。allowKeys = true 时允许键名 Q、E、Enter（ui/strings.ts）。 */
export function lintText(text: string, where: string, o: { allowKeys?: boolean; maxChars?: number } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const err = (rule: string, msg: string) => out.push({ level: 'error', rule, where, msg });
  let probe = text;
  if (o.allowKeys) for (const k of ALLOWED_KEY_NAMES) probe = probe.replace(new RegExp(`(?<![A-Za-z])${k}(?![A-Za-z])`, 'g'), '');
  if (LATIN.test(probe)) err('B.8-latin', `latin letters in 「${text}」`);
  if (EMOJI.test(text)) err('B.8-emoji', `emoji in 「${text}」`);
  if ((text.includes('！') || text.includes('!')) && text !== ALLOWED_EXCLAMATION) err('B.8-exclamation', `exclamation mark in 「${text}」 (only 「看！」 is allowed)`);
  for (const w of BANNED_WORDS) if (text.toLowerCase().includes(w)) err('B.8-word', `banned word 「${w}」 in 「${text}」`);
  for (const s of BANNED_SENTENCES) if (text.includes(s)) err('B.8-sentence', `banned invented sentence 「${s}」`);
  for (const m of text.matchAll(WALKED_N)) if (m[1] !== '七') err('B.8-steps', `「走了 N 步」 with N = ${m[1]} (only 七 is allowed)`);
  for (const f of FORBIDDEN_SOURCE) if (text.length >= 2 && f.includes(text)) err('B.8-forbidden-quote', `「${text}」 quotes a forbidden chapter-4 sentence`);
  const max = o.maxChars ?? TEXT.maxChars;
  if (charCount(text) > max) err('R14-length', `「${text}」 has ${charCount(text)} chars > ${max}`);
  return out;
}

/** lines.ts 的全部条目：R14 + 附录 B.8；给了原文时，quote = true 的句子必须是出处章节原文的连续片段。 */
export function lintLines(lines: Readonly<Record<string, LineEntry>> = LINES, sources?: SourceTexts): LintIssue[] {
  const out: LintIssue[] = [];
  for (const [id, e] of Object.entries(lines)) {
    const where = `lines.${id}`;
    if (!e.t) out.push({ level: 'error', rule: 'R14-empty', where, msg: 'empty text' });
    out.push(...lintText(e.t, where));
    if (e.t.includes('\n')) out.push({ level: 'error', rule: 'R14-newline', where, msg: 'a line must not contain a newline (split quotes that span paragraphs)' });
    if (/["“”「」]/.test(e.t)) out.push({ level: 'error', rule: 'R14-quote-marks', where, msg: 'quotes are stored without quotation marks (the UI adds them by style)' });
    if (!e.quote) out.push({ level: 'error', rule: 'R14-quote', where, msg: 'every line in lines.ts must be an original quote (quote: true)' });
    if (e.quote && sources) {
      const src = sources[e.ch];
      if (src === undefined) out.push({ level: 'warn', rule: 'R14-quote', where, msg: `no source text for chapter ${e.ch}` });
      else if (!src.includes(e.t)) {
        const other = ([1, 2, 3, 4, 5] as const).filter((c) => sources[c]?.includes(e.t));
        out.push({ level: 'error', rule: 'R14-quote', where, msg: `「${e.t}」 is not a verbatim fragment of chapter ${e.ch}${other.length ? ` (found in chapter ${other.join(', ')})` : ''}` });
      }
    }
  }
  return out;
}

/** ui/strings.ts（WP8）：递归检查所有字符串值；允许键名 Q、E、Enter。 */
export function lintStrings(strings: unknown, where = 'strings'): LintIssue[] {
  const out: LintIssue[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') out.push(...lintText(v, path, { allowKeys: true }));
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(strings, where);
  return out;
}

/** 事件体里引用的全部 LineId（含 twitch / drift 的 say、board 的 line）。 */
function linesOfBody(b: EventBody): string[] {
  switch (b.type) {
    case 'text': return Array.isArray(b.line) ? [...b.line] : [b.line as string];
    case 'board': return b.line ? [b.line] : [];
    case 'twitch': case 'drift': return b.say ? [b.say] : [];
    default: return [];
  }
}

type AnyEvent = { at?: number; atStep?: number; id?: string } & EventBody;

/** 一段里的全部事件（含 slow / stop 的 timeline、窗口 then、输入的 onDone），递归展开。 */
export function segmentEvents(sd: SegmentDef): AnyEvent[] {
  const out: AnyEvent[] = [];
  const add = (list: readonly unknown[] | undefined) => {
    for (const x of list ?? []) {
      const e = x as AnyEvent;
      out.push(e);
      if (e.type === 'slow' || e.type === 'stop') add((e as { timeline?: readonly unknown[] }).timeline);
    }
  };
  add(sd.events as readonly unknown[] | undefined);
  if (sd.kind === 'run') for (const w of sd.windows ?? []) add(w.then);
  if (sd.kind !== 'run' && sd.input) add(sd.input.onDone);
  return out;
}

function inputLines(inp: StillInput | undefined): string[] {
  if (!inp) return [];
  return [...(inp.progress ?? []).map((p) => p.line as string), ...(inp.onDone ?? []).flatMap((e) => linesOfBody(e))];
}

/** 一章引用的全部 LineId。 */
export function chapterLineIds(def: ChapterDef): Set<string> {
  const ids = new Set<string>(def.card as string[]);
  for (const l of def.outro.lines) {
    if ('line' in l) ids.add(l.line);
    else for (const x of inputLines(l.input)) ids.add(x);
  }
  for (const n of def.notes) { if (n.front) ids.add(n.front); if (n.back) ids.add(n.back); }
  for (const sd of def.segments) {
    for (const e of segmentEvents(sd)) for (const x of linesOfBody(e)) ids.add(x);
    if (sd.kind !== 'run') for (const x of inputLines(sd.input)) ids.add(x);
  }
  return ids;
}

/** 一章的数据规则：文字引用与行数、纸条、静场时长、kit / set 变体、端盘段无低矮（R11）。 */
export function lintChapter(def: ChapterDef): LintIssue[] {
  const out: LintIssue[] = [];
  const at = (where: string) => `${def.id}${where ? ` ${where}` : ''}`;
  const err = (rule: string, where: string, msg: string) => out.push({ level: 'error', rule, where: at(where), msg });
  const warn = (rule: string, where: string, msg: string) => out.push({ level: 'warn', rule, where: at(where), msg });
  const known = LINES as Readonly<Record<string, LineEntry>>;

  if (def.card.length < 1 || def.card.length > 2) err('B.1', 'card', `opening card must have 1–2 lines, has ${def.card.length}`);
  for (const id of chapterLineIds(def)) if (!known[id]) err('lines', '', `unknown line id ${id}`);

  // —— 纸条（附录 B.3，验收 4）——
  if (def.notes.length > LIMITS.notesPerChapter) err('notes', 'notes', `${def.notes.length} notes > ${LIMITS.notesPerChapter}`);
  const noteIds = new Set<string>();
  for (const n of def.notes) {
    if (noteIds.has(n.id)) err('notes', n.id, 'duplicate note id');
    noteIds.add(n.id);
    const hasText = !!n.front || !!n.back || n.face === 'doodle';
    if (hasText && !NOTES_WITH_TEXT.has(n.id)) err('notes', n.id, 'only n1-desk, n1-a and n5-note may carry text or a doodle');
  }
  const placed = new Set<string>(), gained = new Set<string>();

  // —— 逐段 ——
  const evIds = new Map<string, string>();
  for (const sd of def.segments) {
    const where = sd.id;
    if (sd.kind === 'run' || sd.kind === 'stand') {
      if (!KIT_VARIANTS[sd.kit].includes(sd.variant)) err('variant', where, `variant ${sd.variant} is not a ${sd.kit} variant`);
    }
    if (sd.kind === 'still') {
      const v = sd.variant ?? 'default';
      const allowed = SET_VARIANTS[sd.set as SetId];
      if (!allowed.includes(v)) err('variant', where, `variant ${v} is not a ${sd.set} variant`);
    }
    if (sd.kind !== 'run' && sd.duration > LIMITS.stillMaxSec) err('R13', where, `${sd.kind} lasts ${sd.duration} s > ${LIMITS.stillMaxSec} s`);
    if (sd.kind === 'run') for (const n of sd.notes ?? []) placed.add(n.note);
    for (const e of segmentEvents(sd)) {
      if (e.id) {
        const prev = evIds.get(e.id);
        if (prev !== undefined) warn('ids', where, `event id ${e.id} also used in ${prev}`);
        else evIds.set(e.id, where);
      }
      if (e.type === 'noteGet') gained.add(e.note);
      if (e.type === 'text') {
        const n = Array.isArray(e.line) ? e.line.length : 1;
        if (n > TEXT.maxLines) err('R14-lines', where, `text event shows ${n} lines > ${TEXT.maxLines}`);
        if (e.style === 'other' && !e.speaker) warn('speaker', where, `「${linesOfBody(e).map((l) => known[l]?.t ?? l).join('')}」 is style other without a speaker`);
      }
    }
  }
  for (const n of def.notes) {
    if (n.pickup && !placed.has(n.id)) err('notes', n.id, 'pickup note is never placed in a run segment');
    if (!n.pickup && !gained.has(n.id)) err('notes', n.id, 'story note is never given (noteGet)');
  }
  for (const id of placed) if (!noteIds.has(id)) err('notes', id, 'placed note has no NoteDef in this chapter');

  // —— R11：端盘段没有低矮障碍 ——
  const compiled = compile(def);
  for (const seg of compiled.segments) {
    if (seg.kind !== 'run') continue;
    const d = seg.def as Extract<SegmentDef, { kind: 'run' }>;
    if (d.controls?.jump === false) {
      for (const o of seg.obstacles) if (o.cls === 'low') err('R11', d.id, `low obstacle ${o.kind} @${o.beat} in a tray segment`);
    }
  }
  return out;
}

/** 全部内容：lines.ts（含原文比对）+ 各章 + 跨章规则（纸条 id 唯一、noteOpen 引用存在、没有孤立的台词）。 */
export function lintContent(o: { chapters: readonly ChapterDef[]; sources?: SourceTexts; lines?: Readonly<Record<string, LineEntry>> }): LintIssue[] {
  const lines = o.lines ?? (LINES as Readonly<Record<string, LineEntry>>);
  const out: LintIssue[] = [...lintLines(lines, o.sources)];
  const allNotes = new Map<string, string>();
  const used = new Set<string>(Object.values(LINE_HOOKS));
  for (const id of Object.keys(lines)) if (id.startsWith('fail.')) used.add(id);
  for (const def of o.chapters) {
    out.push(...lintChapter(def));
    for (const n of def.notes) {
      if (allNotes.has(n.id)) out.push({ level: 'error', rule: 'notes', where: `${def.id} ${n.id}`, msg: `note id also defined in ${allNotes.get(n.id)}` });
      allNotes.set(n.id, def.id);
    }
    for (const id of chapterLineIds(def)) used.add(id);
  }
  for (const def of o.chapters) {
    for (const sd of def.segments) for (const e of segmentEvents(sd)) {
      if (e.type === 'noteOpen' && !allNotes.has(e.note)) out.push({ level: 'error', rule: 'notes', where: `${def.id} ${sd.id}`, msg: `noteOpen of unknown note ${e.note}` });
    }
  }
  for (const id of Object.keys(lines)) if (!used.has(id)) out.push({ level: 'warn', rule: 'lines-unused', where: `lines.${id}`, msg: 'line is not referenced by any chapter or hook' });
  return out;
}
