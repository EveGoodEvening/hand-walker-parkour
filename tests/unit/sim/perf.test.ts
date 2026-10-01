// tests/unit/sim/perf.test.ts —— 模拟性能（DESIGN.md §9.4、§8.10 WP1 验收 7）：单 tick 平均 < 0.3 ms（第三章为样本）。
import { describe, expect, it } from 'vitest';
import type { Action, ChapterId } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';

describe('模拟性能（验收 7）：单 tick 平均 < 0.3 ms（第三章为样本；没有时用已实现的最后一章）', () => {
  it('含 perfect 自动驾驶（求解计入）与不含两种', () => {
    const ids = availableChapters();
    const id: ChapterId = ids.includes('ch3') ? 'ch3' : (ids[ids.length - 1] as ChapterId);
    const def = getChapter(id) as ChapterDef;
    for (const ap of ['perfect', 'off'] as const) {
      const sim = new Sim(solver);
      sim.load(compile(def));
      sim.setAutopilot(ap);
      sim.setInvincible(ap === 'off');
      const held = new Set<Action>();
      let n = 0;
      const t0 = performance.now();
      while (!sim.isEnded && n < 120 * 400) { sim.step([], held); sim.drain(); n++; if (sim.segment.kind !== 'run' && ap === 'off') sim.skipStill(); }
      const ms = (performance.now() - t0) / n;
      expect(n).toBeGreaterThan(1000);
      expect(ms, `${id} autopilot ${ap}: ${ms.toFixed(4)} ms/tick`).toBeLessThan(0.3);
    }
  });
});
