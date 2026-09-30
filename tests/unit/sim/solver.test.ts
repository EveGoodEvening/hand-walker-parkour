// tests/unit/sim/solver.test.ts —— 求解器完整版（DESIGN.md §2.8 R2、§8.10 WP1 验收 4）。
import { describe, expect, it } from 'vitest';
import { compile } from '../../../src/levels/compile';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { solver } from '../../../src/sim/Solver';
import { MECH_RUN, MECH_STILL } from './fixtures';

const CHAPTERS: Array<[string, ChapterDef]> = [
  ...availableChapters().map((id) => [id, getChapter(id) as ChapterDef] as [string, ChapterDef]),
  ['mech-run', MECH_RUN], ['mech-still', MECH_STILL],
];

describe('求解器：每个跑段、每个检查点都有解；人群段在 noAsk 下有解', () => {
  for (const [name, def] of CHAPTERS) {
    it(name, () => {
      const c = compile(def);
      for (const seg of c.segments) {
        if (seg.kind !== 'run') continue;
        for (const cp of seg.checkpoints) {
          const p = solver.solve(seg, { from: { s: seg.s0 + cp * seg.stride, lane: 0, tSeg: cp === 0 ? 0 : seg.timeAt(cp) }, noAsk: true });
          expect(p, `${seg.def.id} @${cp}`).not.toBeNull();
        }
      }
    });
  }
});
