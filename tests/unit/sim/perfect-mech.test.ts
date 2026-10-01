// tests/unit/sim/perfect-mech.test.ts —— perfect 自动驾驶（DESIGN.md §8.10 WP1 验收 4）：种子 1–20 跑完，0 摔倒、0 受击，
// 跑到 chapter:end，必备节拍全部触发（结尾卡输入上的除外）。每章一个文件，vitest 按文件并行。
// 章节未实现（WP2 合并前返回 null 的桩）时这个文件只有一个跳过的用例。
import { describe, expect, it } from 'vitest';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { MECH_RUN, MECH_STILL, perfectRun } from './fixtures';

const CHAPTERS: Array<[string, ChapterDef]> = [['mech-run', MECH_RUN], ['mech-still', MECH_STILL]];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('perfect 自动驾驶 · mech', () => {
  if (!CHAPTERS.length) { it.skip('mech 尚未实现（WP2）', () => {}); return; }
  for (const [name, d] of CHAPTERS) {
    describe(name, () => {
      it.each(SEEDS)('seed %i', (seed) => {
        const r = perfectRun(d, seed);
        expect(r.ended).toBe(true);
        expect(r.falls).toBe(0);
        expect(r.hits).toEqual([]);
        expect(r.missing).toEqual([]);
      });
    });
  }
});
