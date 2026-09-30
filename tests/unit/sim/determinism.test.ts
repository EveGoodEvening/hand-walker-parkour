// tests/unit/sim/determinism.test.ts —— 确定性（DESIGN.md §8.3、§8.10 WP1 验收 3）：20 个种子，同一输入脚本跑 3000 tick，hash() 完全一致。
// 章节列表来自 chapters/index：WP2 合并之前第二到五章是返回 null 的桩，自动跳过；合并之后自动覆盖。
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/core/rng';
import type { Action, InputEvent } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';
import { MECH_RUN, MECH_STILL } from './fixtures';

const CHAPTERS: Array<[string, ChapterDef]> = [
  ...availableChapters().map((id) => [id, getChapter(id) as ChapterDef] as [string, ChapterDef]),
  ['mech-run', MECH_RUN], ['mech-still', MECH_STILL],
];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('确定性（验收 3）：20 个种子，同一输入脚本跑 3000 tick，hash() 完全一致', () => {
  function script(seed: number): Map<number, Action> {
    const r = createRng(seed, 'script');
    const m = new Map<number, Action>();
    const acts: Action[] = ['left', 'right', 'up', 'down', 'look', 'ask'];
    for (let t = 30; t < 3000; t += 12 + r.int(50)) m.set(t, r.pick(acts));
    return m;
  }
  function run(def: ChapterDef, seed: number, bot = false): string {
    const sim = new Sim(solver);
    sim.load(compile(def, seed), undefined, seed);
    if (bot) { sim.setAutopilot('human'); sim.setBotSeed(seed); }
    const sc = script(seed);
    const held = new Set<Action>();
    let up: Action | null = null;
    for (let t = 0; t < 3000; t++) {
      const evs: InputEvent[] = [];
      if (up) { evs.push({ action: up, phase: 'up', t: (t * 1000) / 120, device: 'keyboard' }); held.delete(up); up = null; }
      const a = sc.get(t);
      if (a) { evs.push({ action: a, phase: 'down', t: (t * 1000) / 120, device: 'keyboard' }); held.add(a); if (a !== 'down' || t % 3) up = a; }
      sim.step(evs, held);
      sim.drain();
    }
    return sim.hash();
  }
  for (const [name, def] of CHAPTERS) {
    it(`${name}`, () => {
      const hashes = new Set<string>();
      for (const seed of SEEDS) {
        const a = run(def, seed), b = run(def, seed);
        expect(a, `seed ${seed}`).toBe(b);
        hashes.add(a);
      }
      expect(hashes.size).toBeGreaterThan(1);
    });
  }
  it('human 机器人：同一种子同一结果', () => {
    for (const seed of [1, 2, 3]) expect(run(MECH_RUN, seed, true)).toBe(run(MECH_RUN, seed, true));
  });
});
