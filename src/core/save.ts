// src/core/save.ts —— 存档（DESIGN.md §7.3、§8.4）。CORE 实现，接口冻结。
// 键名 `hw-parkour:v1`。存：已解锁的章、最后到达的检查点、纸条、纸条是否打开过、已显示过的提示、设置。**不存最好成绩。**
// 所有读写 try/catch；localStorage 不可用或抛异常时退回内存，游戏照常运行。
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';
import type { ChapterId, HintId } from './types';

export interface SaveData { v: 1; unlocked: ChapterId[]; last: { chapter: ChapterId; segment: string; beat: number } | null; notes: string[]; notesOpened: string[]; hintsSeen: HintId[]; firstRunShown: boolean }
export interface SaveAPI { load(): SaveData; patch(p: Partial<SaveData>): void; reset(): void }   // 所有读写 try/catch，失败时退回内存

export const SAVE_KEY = 'hw-parkour:v1';
export const SETTINGS_KEY = 'hw-parkour:v1:settings';

const CHAPTERS: readonly ChapterId[] = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'test'];

export function defaultSave(): SaveData {
  return { v: 1, unlocked: ['ch1'], last: null, notes: [], notesOpened: [], hintsSeen: [], firstRunShown: false };
}

function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const unlocked = strs(r.unlocked).filter((c): c is ChapterId => (CHAPTERS as readonly string[]).includes(c));
  if (unlocked.length) d.unlocked = Array.from(new Set<ChapterId>(['ch1', ...unlocked]));
  d.notes = strs(r.notes);
  d.notesOpened = strs(r.notesOpened);
  d.hintsSeen = strs(r.hintsSeen) as HintId[];
  d.firstRunShown = r.firstRunShown === true;
  const last = r.last as Record<string, unknown> | null | undefined;
  if (last && typeof last === 'object' && typeof last.segment === 'string' && typeof last.beat === 'number'
    && (CHAPTERS as readonly string[]).includes(String(last.chapter))) {
    d.last = { chapter: last.chapter as ChapterId, segment: last.segment, beat: last.beat };
  }
  return d;
}

/** 取 localStorage；任何异常（隐私模式、被禁用、happy-dom 缺失）都返回 null。 */
function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch { return null; }
}

export function readJson(key: string): unknown {
  try {
    const s = storage();
    const v = s?.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
export function writeJson(key: string, v: unknown): void {
  try { storage()?.setItem(key, JSON.stringify(v)); } catch { /* 退回内存 */ }
}
export function removeKey(key: string): void {
  try { storage()?.removeItem(key); } catch { /* ignore */ }
}

/** 存档实现：内存里始终有一份，localStorage 只是镜像。 */
export function createSave(): SaveAPI {
  let mem = sanitizeSave(readJson(SAVE_KEY));
  return {
    load: () => structuredCloneSafe(mem),
    patch(p) { mem = sanitizeSave({ ...mem, ...p }); writeJson(SAVE_KEY, mem); },
    reset() { mem = defaultSave(); removeKey(SAVE_KEY); },
  };
}

export function loadSettings(): Settings {
  return sanitizeSettings(readJson(SETTINGS_KEY) ?? DEFAULT_SETTINGS);
}
export function storeSettings(s: Settings): void { writeJson(SETTINGS_KEY, s); }

function structuredCloneSafe<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
