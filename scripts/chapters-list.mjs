// scripts/chapters-list.mjs —— 读出已实现的章节 id（给不能直接 import TS 的 .mjs 脚本用）。CORE 写初版，WP1 维护。
// 首选：`tsx scripts/validate-levels.ts --meta`（按 chapters/index 的 getChapter 判断，和游戏里一致）；
// 失败时退回：按章节文件是否还是 CORE 的 null 桩（`ChapterDef | null = null;`）判断。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** 各章元数据：{ id, implemented, requiredBeats?, outroIds?, segments? }（不含 test 章）。 */
export function chapterMeta() {
  const r = spawnSync('npx', ['tsx', 'scripts/validate-levels.ts', '--meta'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) {
    try { return JSON.parse(r.stdout).filter((m) => m.id !== 'test'); } catch { /* 退回 */ }
  }
  return ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'].map((id) => {
    const p = resolve(ROOT, 'src/levels/chapters', `${id}.ts`);
    const implemented = existsSync(p) && !/ChapterDef \| null = null;/.test(readFileSync(p, 'utf8'));
    return { id, implemented };
  });
}

export function availableChapters() {
  return chapterMeta().filter((m) => m.implemented).map((m) => m.id);
}
