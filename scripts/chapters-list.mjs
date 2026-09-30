// scripts/chapters-list.mjs —— 读出已实现的章节 id（不编译 TS：按章节文件是否导出 null 判断）。CORE 写初版，归 WP1。
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
export function availableChapters() {
  return ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'].filter((c) => {
    const p = resolve(ROOT, 'src/levels/chapters', `${c}.ts`);
    if (!existsSync(p)) return false;
    return !/ChapterDef \| null = null;/.test(readFileSync(p, 'utf8'));
  });
}
