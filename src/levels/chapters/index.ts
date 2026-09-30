// src/levels/chapters/index.ts —— 章节索引（DESIGN.md §8.2）。CORE 冻结。
// 静态 import 全部章节文件（validate 脚本在 Node 里用 tsx 跑，不能依赖 import.meta.glob）。
// 章节文件导出 null 表示「尚未实现」：不出现在可玩列表里，但标题的章节列表照常显示「——」。
import type { ChapterId } from '../../core/types';
import type { ChapterDef } from '../schema';
import ch1 from './ch1';
import ch2 from './ch2';
import ch3 from './ch3';
import ch4 from './ch4';
import ch5 from './ch5';
import test from './test';

/** 正式章节的顺序（test 不在其中）。 */
export const CHAPTER_ORDER: readonly ChapterId[] = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'];

const TABLE: Record<ChapterId, ChapterDef | null> = {
  ch1: ch1 as ChapterDef, ch2: ch2 as ChapterDef | null, ch3: ch3 as ChapterDef | null, ch4: ch4 as ChapterDef | null,
  ch5: ch5 as ChapterDef | null, test: test as ChapterDef,
};

/** 取章节定义；未实现的章返回 null。 */
export function getChapter(id: ChapterId): ChapterDef | null { return TABLE[id] ?? null; }

/** 已实现（可玩）的章节 id，按顺序；includeTest 为 true 时末尾附上 test。 */
export function availableChapters(includeTest = false): ChapterId[] {
  const out = CHAPTER_ORDER.filter((c) => TABLE[c] !== null);
  if (includeTest) out.push('test');
  return out;
}

/** 下一章（已实现的）；没有则 null。 */
export function nextChapterOf(id: ChapterId): ChapterId | null {
  const i = CHAPTER_ORDER.indexOf(id);
  if (i < 0) return null;
  for (let j = i + 1; j < CHAPTER_ORDER.length; j++) {
    const c = CHAPTER_ORDER[j] as ChapterId;
    if (TABLE[c]) return c;
  }
  return null;
}
