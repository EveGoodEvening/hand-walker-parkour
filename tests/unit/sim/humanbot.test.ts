// tests/unit/sim/humanbot.test.ts —— human 机器人（DESIGN.md §2.8、§8.10 WP1 验收 6 的工具；报告见 scripts/bot-difficulty.mjs）。
import { describe, expect, it } from 'vitest';
import type { ChapterId } from '../../../src/core/types';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { Driver, MECH_RUN } from './fixtures';

describe('human 机器人（验收 6 的工具）', () => {
  function runBot(def: ChapterDef, seed: number) {
    const d = new Driver(def, undefined, 1);
    d.sim.setAutopilot('human');
    d.sim.setBotSeed(seed);
    for (let i = 0; i < 120 * 400 && !d.sim.isEnded; i++) {
      d.stepOne();
      if (d.snap.player.mode === 'fall' && d.sim.fallTime > 0.5) d.sim.retry();
    }
    return { d, stats: { ...d.sim.botStats } };
  }
  it('反应时间与失误率：失误约 5%，腿部意外之后至少 0.12 s 才响应', () => {
    let inputs = 0, errors = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { d, stats } = runBot(MECH_RUN, seed);
      inputs += stats.inputs; errors += stats.errors;
      expect(d.of('chapter:end').length).toBe(1);
      // 腿偏移：预警之后第一次掰正 / 换道不早于 0.12 s
      const warn = d.of('drift').filter((e) => e.data.phase === 'warn');
      for (const w of warn) {
        const resp = d.events.find((e) => e.tick > w.tick && e.type === 'action' && (e.data.kind === 'straighten'));
        if (resp) expect((resp.tick - w.tick) / 120).toBeGreaterThanOrEqual(0.12 - 1e-9);
      }
    }
    expect(inputs).toBeGreaterThan(30);
    expect(errors / inputs).toBeGreaterThan(0.01);
    expect(errors / inputs).toBeLessThan(0.12);
  });
  it('不同种子会走出不同的结果，会受击，但大多数时候不摔', () => {
    const outcomes = new Set<string>();
    let hits = 0, falls = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const { d } = runBot(availableChapters().includes('ch1') ? (getChapter('ch1' as ChapterId) as ChapterDef) : MECH_RUN, seed);
      outcomes.add(d.sim.hash());
      hits += d.of('hit').length;
      falls += d.snap.stats.falls;
    }
    expect(outcomes.size).toBeGreaterThan(4);
    expect(hits).toBeGreaterThan(0);
    expect(falls).toBeLessThan(seeds.length * 2);
  });
});
