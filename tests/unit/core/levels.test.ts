// tests/unit/core/levels.test.ts —— 关卡编译、求解器、校验器（DESIGN.md §8.5、§2.8、§8.9 验收 4）。
import { describe, expect, it } from 'vitest';
import { compile, cadenceFns } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import test from '../../../src/levels/chapters/test';
import { availableChapters, getChapter, nextChapterOf } from '../../../src/levels/chapters/index';
import { LINES } from '../../../src/levels/lines';
import { OBSTACLES } from '../../../src/levels/obstacles';
import type { ChapterDef } from '../../../src/levels/schema';
import { expandPattern } from '../../../src/levels/patterns';
import { validateChapter } from '../../../src/levels/validate';
import { solver } from '../../../src/sim/Solver';
import { chapter, runSeg } from './helpers';

describe('compile（§8.5）', () => {
  it('第一章：6 段，长度 = 各跑段拍数 × 步幅，检查点', () => {
    const c = compile(ch1 as ChapterDef);
    expect(c.segments.map((s) => `${s.def.id}:${s.kind}`)).toEqual(['1-1:run', '1-2:run', '1-3:run', '1-4:still', '1-5:run', '1-6:run']);
    expect(c.length).toBeCloseTo(28 + 176 + 72 + 212 + 30, 6);
    expect(c.segments[1]!.checkpoints).toEqual([0, 96]);
    const lockers = c.segments[1]!.obstacles.filter((o) => o.kind === 'locker');
    expect(lockers.map((o) => o.s1 - o.s0)).toEqual([14, 14]);
    expect(c.segments[4]!.obstacles.filter((o) => o.cls === 'pickup').map((o) => o.params.note)).toEqual(['n1-b']);
    // 行速记：HHH 在 corridor.morning 下是长桌，三条车道各一个
    expect(c.segments[1]!.obstacles.filter((o) => o.beat === 68).map((o) => o.kind)).toEqual(['longTable', 'longTable', 'longTable']);
  });
  it('同一种子编译结果完全相同；ID 在章内唯一', () => {
    const a = compile(ch1 as ChapterDef, 5), b = compile(ch1 as ChapterDef, 5);
    const ka = a.segments.flatMap((s) => s.obstacles.map((o) => `${o.id}:${o.kind}:${o.s0}`));
    expect(ka).toEqual(b.segments.flatMap((s) => s.obstacles.map((o) => `${o.id}:${o.kind}:${o.s0}`)));
    expect(new Set(ka.map((k) => k.split(':')[0])).size).toBe(ka.length);
  });
  it('步频渐变：t(b) = B/(c1−c0)·ln(c(b)/c0)，beatAt 是反函数', () => {
    const f = cadenceFns([5.0, 5.4], 212);
    expect(f.timeAt(0)).toBe(0);
    expect(f.timeAt(212)).toBeCloseTo((212 / 0.4) * Math.log(5.4 / 5), 6);
    for (const b of [10, 100, 211]) expect(f.beatAt(f.timeAt(b))).toBeCloseTo(b, 6);
    const g = cadenceFns(4.4, 28);
    expect(g.timeAt(22)).toBeCloseTo(5, 6);
  });
  it('模式展开：tripleVault / zigzag', () => {
    expect(expandPattern({ at: 178, pattern: 'tripleVault', lane: 0, gap: 5 })).toEqual([[178, '.L.'], [183, '.L.'], [188, '.L.']]);
    expect(expandPattern({ at: 10, pattern: 'zigzag', gap: 3 })).toEqual([[10, 'B.B'], [13, '.B.'], [16, 'B.B']]);
  });
  it('fullWidth 障碍覆盖三条车道且一行只生成一个', () => {
    const c = compile(chapter([runSeg({ kit: 'street', variant: 'schoolGate', rows: [[20, 'HHH']] })]));
    const gates = c.segments[0]!.obstacles.filter((o) => o.kind === 'gateBar');
    expect(gates.length).toBe(1);
    expect(gates[0]!.lanes).toEqual([-1, 0, 1]);
  });
});

describe('章节索引', () => {
  it('第一章与测试章可用；未实现的章返回 null', () => {
    expect(availableChapters()).toContain('ch1');
    expect(availableChapters(true)).toContain('test');
    expect(getChapter('ch1')?.name).toBe('早自习');
    if (!getChapter('ch2')) expect(nextChapterOf('ch1')).toBeNull();
  });
});

describe('台词与障碍表', () => {
  it('第一章台词每行 ≤ 24 字，没有拉丁字母和 emoji，除「看！」外没有感叹号', () => {
    for (const [id, e] of Object.entries(LINES)) {
      expect(Array.from(e.t).length, id).toBeLessThanOrEqual(24);
      expect(/[A-Za-z]/.test(e.t), id).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(e.t), id).toBe(false);
      if ((e.t as string) !== '看！') expect(e.t.includes('！'), id).toBe(false);
    }
  });
  it('横档下沿 ≥ 0.36 m；低矮 ≤ 0.35 m；挡道 ≥ 0.9 m（爬行者例外）', () => {
    for (const [k, o] of Object.entries(OBSTACLES)) {
      if (o.cls === 'bar') expect(o.y0, k).toBeGreaterThanOrEqual(0.36);
      if (o.cls === 'low') expect(o.y1, k).toBeLessThanOrEqual(0.35);
      if (o.cls === 'block' && k !== 'crawler') expect(o.y1, k).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe('求解器（R2）', () => {
  it('第一章每个跑段都有 0 受击的解', () => {
    const c = compile(ch1 as ChapterDef);
    for (const seg of c.segments) if (seg.kind === 'run') expect(solver.solve(seg), seg.def.id).not.toBeNull();
  });
  it('一整行挡道时无解', () => {
    const c = compile(chapter([runSeg({ rows: [[20, 'BBB']] })]));
    expect(solver.solve(c.segments[0]!)).toBeNull();
  });
  it('周期障碍（摆门）按时间求解：只剩中道时，门开着就有解、关着就无解', () => {
    // 玩家约在 t = (20 − 0.25) / 4.8 ≈ 4.11 s 经过；phase 让门那时正好荡开（open ≈ 0）或正好横在车道里（open ≈ 1）
    const tPass = (20 - 0.25) / 4.8;
    const phaseOpen = 1 - ((tPass / 1.8) % 1);
    const mk = (phase: number) => compile(chapter([runSeg({ rows: [[20, 'B.B']], items: [{ at: 20, lane: 0, kind: 'stallDoor', behavior: { type: 'swing', period: 1.8, phase } }] })]));
    expect(solver.solve(mk(phaseOpen).segments[0]!)).not.toBeNull();
    expect(solver.solve(mk((phaseOpen + 0.5) % 1).segments[0]!)).toBeNull();
  });
});

describe('校验器（§8.9 验收 4：ch1 与 test 通过 R1–R8、R13）', () => {
  for (const def of [ch1, test] as ChapterDef[]) {
    it(`${def.id} 没有 error`, () => {
      const r = validateChapter(def, solver);
      expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(r.stats.nonRunRatio).toBeLessThanOrEqual(0.25);
    });
  }
  it('能抓到违规：R1（一行三个挡道）、R5（文字后 0.8 s 内需要动作）、R8（检查点后 1.6 s 内需要动作）、静态（缺节拍 id）', () => {
    const bad = chapter([runSeg({ beats: 60, cadence: 4.4, rows: [[30, 'BBB']] })]);
    expect(validateChapter(bad, solver).issues.map((i) => i.rule)).toContain('R1');
    const r5 = chapter([runSeg({ beats: 60, cadence: 4.4, rows: [[30, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 29, type: 'text', line: 'c1.hey' }] })]);
    expect(validateChapter(r5, solver).issues.map((i) => i.rule)).toContain('R5');
    const r8 = chapter([runSeg({ beats: 60, cadence: 4.4, rows: [[4, 'LLL']], events: [{ at: 0, type: 'hint', hint: 'jump' }] })]);
    expect(validateChapter(r8, solver).issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['R8']));
    const miss = chapter([runSeg({ beats: 40 })], { requiredBeats: ['nope'] });
    expect(validateChapter(miss, solver).issues.map((i) => i.rule)).toContain('static');
  });
  it('R13：静场超过 15 s 报错', () => {
    const long = chapter([{ id: 'st', kind: 'still', set: 'placeholder', atmosphere: 'morning', duration: 16, follower: { mode: 'hidden' }, events: [] }, runSeg({ beats: 400 })]);
    expect(validateChapter(long, solver).issues.map((i) => i.rule)).toContain('R13');
  });
});
