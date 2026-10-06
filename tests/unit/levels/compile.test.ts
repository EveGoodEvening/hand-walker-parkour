// tests/unit/levels/compile.test.ts —— 编译、行速记、谱面模式（DESIGN.md §8.5 编译规则）。
import { describe, expect, it } from 'vitest';
import { compile, obstacleX, TUNING_ASK_IGNORE } from '../../../src/levels/compile';
import { expandPattern } from '../../../src/levels/patterns';
import { parseLanes } from '../../../src/levels/shorthand';
import { PlayerState } from '../../../src/sim/Player';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, MECH_STILL, runSeg, SEVEN } from '../sim/fixtures';

describe('谱面模式（§8.5）', () => {
  it('tripleVault / zigzag / lowBar / forestGate / wetWeave；mirror 左右翻转', () => {
    expect(expandPattern({ at: 10, pattern: 'tripleVault', lane: -1 })).toEqual([[10, 'L..'], [14, 'L..'], [18, 'L..']]);
    expect(expandPattern({ at: 10, pattern: 'zigzag', gap: 3 })).toEqual([[10, 'B.B'], [13, '.B.'], [16, 'B.B']]);
    expect(expandPattern({ at: 5, pattern: 'lowBar', lane: 1, gap: 2 })).toEqual([[5, '..L'], [7, '..H']]);
    expect(expandPattern({ at: 0, pattern: 'forestGate' })).toEqual([[0, 'BBH'], [4, 'H.B'], [8, 'B.B']]);
    expect(expandPattern({ at: 0, pattern: 'wetWeave', mirror: true })).toEqual([[0, 'BWW'], [4, '..B']]);
  });
  it('行速记：三个格子，未知符号报错；也可以直接写障碍种类', () => {
    expect(parseLanes('B.L')).toEqual(['B', '.', 'L']);
    expect(parseLanes(['.', 'footOut', '.'])).toEqual(['.', 'footOut', '.']);
    expect(() => parseLanes('B.')).toThrow();
    expect(() => parseLanes('B.X')).toThrow();
  });
});

describe('compile', () => {
  it('items：车道数组、all、len（拍）；纸条；楼梯的 floorY', () => {
    const c = compile(chapter([runSeg({
      stride: 1.1, stairs: { dir: 'down', risePerBeat: 0.15 },
      items: [{ at: 10, lane: [1, -1], kind: 'legs' }, { at: 20, lane: 'all', kind: 'longTable', len: 3 }],
      notes: [{ at: 30, lane: 0, note: 'n' }],
    })]));
    const seg = c.segments[0]!;
    const legs = seg.obstacles.find((o) => o.kind === 'legs')!;
    expect(legs.lanes).toEqual([-1, 1]);
    expect(obstacleX(legs)).toEqual([-1.1 - 0.26, 1.1 + 0.26]);
    const table = seg.obstacles.find((o) => o.kind === 'longTable')!;
    expect(table.s1 - table.s0).toBeCloseTo(3.3, 9);
    expect(seg.obstacles.find((o) => o.cls === 'pickup')!.params.note).toBe('n');
    expect(seg.floorY(seg.s0 + 10 * 1.1)).toBeCloseTo(-1.5, 9);
  });
  it("「让一下」的 'seeded'：编译期按章种子定下，同一种子结果相同；概率与 §2.4 ask.ignoreChance 一致", () => {
    expect(TUNING_ASK_IGNORE).toBe(TUNING.ask.ignoreChance);
    const def = chapter([runSeg({ crowd: true, items: Array.from({ length: 40 }, (_, i) => ({ at: 10 + i, lane: 1 as const, kind: 'legs' as const, behavior: { type: 'askable' as const, ignore: 'seeded' as const } })) })]);
    const a = compile(def, 3).segments[0]!.obstacles.map((o) => o.params.askIgnore);
    expect(compile(def, 3).segments[0]!.obstacles.map((o) => o.params.askIgnore)).toEqual(a);
    expect(a.every((v) => v === 0 || v === 1)).toBe(true);
  });
  it('站立段：按步事件（atStep）不进编译后的 events，时刻事件照常', () => {
    const c = compile(MECH_STILL);
    const seven = c.segments.find((s) => s.def.id === SEVEN.id)!;
    expect(seven.kind).toBe('stand');
    expect(seven.events.map((e) => e.body.type)).toEqual(['hint']);
    expect((seven.def.events as unknown[]).length).toBe(5);
  });
});

describe('PlayerState.copyFrom（求解器节点复制）', () => {
  it('复制全部字段：新加字段忘了写进 copyFrom 会在这里失败', () => {
    const a = new PlayerState();
    let i = 1;
    for (const k of Object.keys(a) as Array<keyof PlayerState>) {
      const v = a[k];
      if (typeof v === 'number') (a as unknown as Record<string, unknown>)[k] = i++ / 7;
      else if (typeof v === 'boolean') (a as unknown as Record<string, unknown>)[k] = !v;
      else (a as unknown as Record<string, unknown>)[k] = `v${i++}`;
    }
    const b = new PlayerState().copyFrom(a);
    expect({ ...b }).toEqual({ ...a });
  });
});
