// tests/unit/sim/solver.test.ts —— 求解器完整版（DESIGN.md §2.8 R2、§8.10 WP1 验收 4）。
import { describe, expect, it } from 'vitest';
import { compile } from '../../../src/levels/compile';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { solver } from '../../../src/sim/Solver';
import { chapter, MECH_RUN, MECH_STILL, runSeg } from './fixtures';

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

describe('Plan.actionAt：按动作的里程区间回答（领跑者画面逐帧采样，验收员第 1 轮 minor）', () => {
  it('5.4 m/s、30 fps 逐帧采样（每帧约 0.18 m）不漏掉任何一次撑跃或伏低；撑跃区间覆盖整个滞空', () => {
    const def = chapter([runSeg({ beats: 120, cadence: 5.4, rows: [[20, 'LLL'], [32, 'HHH'], [44, 'LLL'], [56, 'HHH'], [70, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 3, type: 'hint', hint: 'duck' }] })]);
    const seg = compile(def).segments[0]!;
    const plan = solver.solve(seg)!;
    expect(plan).not.toBeNull();
    const acts = plan.steps.filter((st) => st.action === 'jump' || st.action === 'duck');
    expect(acts.map((a) => a.action)).toEqual(['jump', 'duck', 'jump', 'duck', 'jump']);
    const ds = 5.4 / 30;
    for (const a of acts) {
      // 无论帧从哪里开始（相位 0…ds），都至少有一帧落在这个动作上
      for (const phase of [0, 0.3, 0.6, 0.9].map((k) => k * ds)) {
        let hit = false;
        for (let s = (a.s ?? 0) - 2 + phase; s < (a.s ?? 0) + 3; s += ds) if (plan.actionAt(s) === a.action) hit = true;
        expect(hit, `${a.action} @${a.s?.toFixed(2)} phase ${phase.toFixed(2)}`).toBe(true);
      }
      expect(plan.actionAt((a.s ?? 0) + 0.01)).toBe(a.action);
    }
    // 撑跃的区间约等于滞空距离（3 拍 / 5.4 掌/s ≈ 0.56 s × 5.4 m/s ≈ 3 m），伏低之间是 none
    const j = acts[0]!;
    let len = 0;
    for (let s = j.s ?? 0; plan.actionAt(s) === 'jump'; s += 0.05) len += 0.05;
    expect(len).toBeGreaterThan(2);
    expect(len).toBeLessThan(4.5);
    expect(plan.actionAt(((acts[0]!.s ?? 0) + (acts[1]!.s ?? 0)) / 2 + 1.5)).toBe('none');
  });
});
