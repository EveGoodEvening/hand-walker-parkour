// tests/unit/levels/density.test.ts —— §2.8 必需动作密度的度量（评审 U2，bot:difficulty 报告里每个跑段的绝对密度）。
import { describe, expect, it } from 'vitest';
import { compile } from '../../../src/levels/compile';
import type { RunSegmentDef } from '../../../src/levels/schema';
import { DENSITY_TARGET, DENSITY_WARN_FRAC, densityWarning, segmentDensity } from '../../../src/levels/validate';
import { solver } from '../../../src/sim/Solver';
import { chapter, runSeg } from '../sim/fixtures';

const seg = (o: Partial<RunSegmentDef>) =>
  compile(chapter([runSeg({ id: 'd', beats: 40, stride: 1.0, cadence: 5.0, events: [{ at: 1, type: 'hint', hint: 'lane' }], ...o })], {
    notes: [{ id: 'nz', face: 'blank', front: null, back: null, folded: false, pickup: true }],
  })).segments[0]!;

describe('segmentDensity：去掉纸条，按本章最小间隔求最少输入', () => {
  it('挡道、低矮、横档各一行：3 次输入（右道的纸条不算，不为它绕路）', () => {
    const d = segmentDensity(seg({ rows: [[10, '.B.'], [20, 'LLL'], [30, 'HHH']], notes: [{ at: 5, lane: 1, note: 'nz' }] }), 0.9, solver)!;
    expect(d.inputs).toBe(3);
    expect(d.route.split(' ').map((x) => x[0]).slice(1)).toEqual(['j', 'd']);
    expect(d.inputsPer10Beats).toBeCloseTo(0.75, 9);
    expect(d.inputsPerSec).toBeCloseTo(3 / 8, 9);          // 40 拍 ÷ 5 掌/s = 8 s
    expect(d.gapRelaxed).toBe(false);
    // 最长空闲：段首、三次输入（约 @9、@19、@29）、段末之间，最长约 2 s
    expect(d.maxIdleSec).toBeGreaterThan(1.5);
    expect(d.maxIdleSec).toBeLessThan(3);
  });
  it('只能紧挨着做的两个动作：按本章间隔无解时退回 0.22 s，标 gapRelaxed', () => {
    const d = segmentDensity(seg({ rows: [[10, 'LLL'], [12, 'HHH']] }), 0.9, solver)!;
    expect(d.inputs).toBe(2);
    expect(d.gapRelaxed).toBe(true);
    expect(segmentDensity(seg({ rows: [[10, 'LLL'], [12, 'HHH']] }), 0.3, solver)!.gapRelaxed).toBe(false);
  });
  it('空段：0 次输入，最长空闲 = 整段', () => {
    const d = segmentDensity(seg({}), 0.9, solver)!;
    expect(d.inputs).toBe(0);
    expect(d.maxIdleSec).toBeCloseTo(8, 1);
  });
});

describe('densityWarning：§2.8 / §4 点名的段低于目标的 60%', () => {
  it('点名的段与目标（区间下沿）', () => {
    expect(Object.keys(DENSITY_TARGET).sort()).toEqual(['1-5', '2-7', '2-8', '3-4', '3-6', '4-1', '4-5', '5-11', '5-3']);
    expect(DENSITY_WARN_FRAC).toBe(0.6);
  });
  it('精确边界：等于 60% 不报，略低才报；没有目标的段不报', () => {
    const edge = DENSITY_TARGET['4-5']! * DENSITY_WARN_FRAC;
    expect(densityWarning({ segment: '4-5', inputsPer10Beats: edge })).toBeNull();
    expect(densityWarning({ segment: '4-5', inputsPer10Beats: edge - 0.001 })).toContain('4-5');
    expect(densityWarning({ segment: '2-7', inputsPer10Beats: 0.22 })).toContain('< 60%');
    expect(densityWarning({ segment: '1-1', inputsPer10Beats: 0 })).toBeNull();
  });
});
