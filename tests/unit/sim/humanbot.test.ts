// tests/unit/sim/humanbot.test.ts —— human 机器人（DESIGN.md §2.8、§8.10 WP1 验收 6 的工具；报告见 scripts/bot-difficulty.mjs）。
// 评审 U2：规划余量、提前换道（laneLead）、横档提前按住 ↓、纸条约 50%、laneLead 统计、真实章节上的确定性。
import { describe, expect, it } from 'vitest';
import type { ChapterId } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { HUMAN } from '../../../src/sim/HumanBot';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, Driver, MECH_RUN, runSeg } from './fixtures';

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
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe('human 机器人（验收 6 的工具）', () => {
  it('反应时间与失误率：失误约 5%，腿部意外之后至少 0.12 s 才响应', () => {
    let inputs = 0, errors = 0;
    for (const seed of SEEDS) {
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
    expect(inputs).toBeGreaterThan(100);
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
  it('躲障碍的换道：从按键到接触平均提前 ≥ 0.25 s（laneLead 统计；以前是求解器的「最后一刻」）', () => {
    let sum = 0, n = 0;
    const leads: number[] = [];
    for (const seed of SEEDS) {
      const { stats } = runBot(MECH_RUN, seed);
      sum += stats.laneLeadSum; n += stats.laneLeadN;
      // 逐次样本与和、次数一致（难度报告用样本算中位数和「< 0.25 s」的比例）
      expect(stats.laneLeads.length).toBe(stats.laneLeadN);
      expect(stats.laneLeads.reduce((a, b) => a + b, 0)).toBeCloseTo(stats.laneLeadSum, 9);
      leads.push(...stats.laneLeads);
    }
    expect(n).toBeGreaterThan(30);
    expect(sum / n).toBeGreaterThanOrEqual(0.25);
    // 均值会被「回中道时原车道远处还有障碍」的长样本拉高：中位数也要 ≥ 0.25 s；真正贴着接触（< 0.15 s）的不到两成
    // （laneLead ~ N(0.3, 0.1) 再叠 ±60 ms 抖动，本来就有约三成落在 0.25 s 以下，所以不拿 0.25 s 卡比例）
    leads.sort((a, b) => a - b);
    expect(leads[Math.floor(0.5 * (leads.length - 1))]).toBeGreaterThanOrEqual(0.25);
    expect(leads.filter((x) => x < 0.15).length / leads.length).toBeLessThan(0.2);
  });
  it('横档：提前按下 ↓、按住到过了横档（相邻横档合并成一次按住），不撞', () => {
    const BARS = chapter([runSeg({ id: 'bars', beats: 70, cadence: 5.0, rows: [[16, 'HHH'], [30, 'HHH'], [33, 'HHH'], [50, 'HHH']], events: [{ at: 2, type: 'hint', hint: 'duck' }] })]);
    const leads: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const d = new Driver(BARS, undefined, 1);
      d.sim.setAutopilot('human'); d.sim.setBotSeed(seed);
      const bars = d.sim.segment.obstacles.filter((o) => o.cls === 'bar' && o.lanes.includes(0));
      const press: number[] = [];
      let minDuck = 1;
      for (let i = 0; i < 120 * 20 && !d.sim.isEnded; i++) {
        const s0 = d.snap.player.s;
        for (const e of d.stepOne()) if (e.type === 'action' && e.data.kind === 'duck') press.push(s0);
        const s = d.snap.player.s;
        if (bars.some((b) => s + TUNING.hitbox.duckS > b.s0 && s - TUNING.hitbox.duckS < b.s1)) minDuck = Math.min(minDuck, d.snap.player.duck);
      }
      expect(d.of('hit').filter((h) => h.data.severity === 'crash'), `seed ${seed}`).toEqual([]);
      expect(minDuck, `seed ${seed}: fully down under every bar`).toBe(1);
      expect(press.length, `seed ${seed}: @30 and @33 share one press`).toBe(3);
      for (const b of [bars[0]!, bars[3]!]) {
        const p = press.filter((x) => x < b.s0).pop()!;
        leads.push((b.s0 - TUNING.hitbox.duckS - p) / 5.0);
      }
    }
    expect(Math.min(...leads)).toBeGreaterThan(0.1);
    expect(leads.reduce((a, b) => a + b, 0) / leads.length).toBeGreaterThanOrEqual(0.25);
  });
  it('纸条：每张约 50% 决定去捡（求解器自己每张都捡），捡到的比 perfect 少', () => {
    // 每张纸条都在右道、紧跟着一个挡道：要专门换进去再换出来
    const notes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, face: 'blank' as const, front: null, back: null, folded: false, pickup: true }));
    const NOTES = chapter([runSeg({
      id: 'notes', beats: 340, cadence: 4.8, notes: notes.map((n, i) => ({ at: 20 + i * 40, lane: 1 as const, note: n.id })),
      rows: notes.map((_, i) => [28 + i * 40, '..B'] as [number, string]), events: [{ at: 2, type: 'hint', hint: 'lane' }],
    })], { notes });
    const perfect = new Driver(NOTES, undefined, 1);
    perfect.sim.setAutopilot('perfect');
    perfect.until(() => perfect.sim.isEnded, 120 * 90);
    expect(perfect.snap.stats.notes.length).toBe(notes.length);
    let seen = 0, skipped = 0, got = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const { d, stats } = runBot(NOTES, seed);
      seen += stats.notesSeen; skipped += stats.notesSkipped; got += d.snap.stats.notes.length;
    }
    expect(seen).toBe(notes.length * seeds.length);
    expect(skipped / seen).toBeGreaterThan(1 - HUMAN.noteChance - 0.15);
    expect(skipped / seen).toBeLessThan(1 - HUMAN.noteChance + 0.15);
    expect(got).toBeLessThanOrEqual(seen - skipped);
    expect(got).toBeGreaterThan(0);
  });
  it('真实章节（4-5 从检查点 @144）：同一种子同一结果，不同种子不同结果', () => {
    const def = getChapter('ch4' as ChapterId);
    if (!def) return;
    const c = compile(def);
    const run = (seed: number) => {
      const sim = new Sim(solver);
      sim.load(c, { segment: '4-5', beat: 144 }, c.seed);
      sim.setAutopilot('human'); sim.setBotSeed(seed);
      for (let i = 0; i < 120 * 12; i++) { sim.step([], new Set()); sim.drain(); }
      return `${sim.hash()} ${JSON.stringify(sim.botStats)}`;
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
});
