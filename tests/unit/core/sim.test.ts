// tests/unit/core/sim.test.ts —— CORE 验收 3 的模拟部分（DESIGN.md §8.9）：换道、撑跃、伏低、绊 / 撞、回稳、失败规则、
// 检查点恢复、稳度 → 相位差、静场超时、确定性。
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../../src/core/constants';
import { createRng } from '../../../src/core/rng';
import type { Action } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import type { ChapterDef } from '../../../src/levels/schema';
import { classify, playerBox } from '../../../src/sim/Collision';
import { lagFor } from '../../../src/sim/Follower';
import { jumpDuration } from '../../../src/sim/Player';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';
import { Steady } from '../../../src/sim/Steady';
import { TUNING } from '../../../src/sim/tuning';
import type { CompiledObstacle } from '../../../src/levels/schema';
import { chapter, Driver, runSeg } from './helpers';

const empty = () => chapter([runSeg()]);

describe('换道', () => {
  it('干地面 0.14 s（±1 tick）到达相邻车道中心', () => {
    const d = new Driver(empty());
    d.step(30);
    d.press('right'); d.stepOne(); d.release('right');
    const n = d.until(() => Math.abs(d.snap.player.x - 1.1) < 1e-9, 120);
    const sec = (n + 1) * TICK_DT;
    expect(Math.abs(sec - TUNING.laneChange.dry)).toBeLessThanOrEqual(TICK_DT + 1e-9);
    expect(d.snap.player.lane).toBe(1);
  });
  it('越界忽略；进行中可以排队 1 次', () => {
    const d = new Driver(empty());
    d.step(10);
    d.tap('left'); d.tap('left');           // 第二次排队
    d.step(60);
    expect(d.snap.player.laneTarget).toBe(-1);
    d.tap('left');                           // 已在最左：忽略
    d.step(30);
    expect(d.snap.player.x).toBeCloseTo(-1.1, 6);
  });
  it('水渍上换道 0.22 s', () => {
    const d = new Driver(chapter([runSeg({ rows: [[20, 'WWW', 6]] })]));
    d.until(() => d.snap.player.beat >= 21);
    d.press('right'); d.stepOne(); d.release('right');
    const n = d.until(() => Math.abs(d.snap.player.x - 1.1) < 1e-9, 120);
    expect(Math.abs((n + 1) * TICK_DT - TUNING.laneChange.wet)).toBeLessThanOrEqual(TICK_DT + 1e-9);
  });
});

describe('撑跃', () => {
  for (const cad of [4.4, 5.0, 5.8, 6.4]) {
    it(`步频 ${cad}：滞空 3 拍并落在 [0.48, 0.72] s`, () => {
      const d = new Driver(chapter([runSeg({ cadence: cad })]));
      d.step(40);
      const b0 = d.snap.player.beat;
      d.tap('up');
      const n = d.until(() => d.snap.player.mode !== 'air', 200);
      const sec = (n + 1) * TICK_DT;
      expect(sec).toBeGreaterThanOrEqual(0.48 - TICK_DT);
      expect(sec).toBeLessThanOrEqual(0.72 + TICK_DT);
      const beats = d.snap.player.beat - b0;
      const expected = jumpDuration(cad) * cad;
      expect(Math.abs(beats - expected)).toBeLessThan(0.1);
      if (3 / cad >= 0.48 && 3 / cad <= 0.72) expect(Math.abs(beats - 3)).toBeLessThan(0.1);
      expect(d.of('land').length).toBe(1);
    });
  }
  it('空中按 ↑ 在落地时执行（输入缓冲 120 ms）', () => {
    const d = new Driver(empty());
    d.step(20); d.tap('up');
    const air = jumpDuration(4.8);
    d.step(Math.floor((air - 0.08) / TICK_DT));
    d.tap('up');
    d.until(() => d.of('land').length === 1, 200);
    d.step(3);
    expect(d.snap.player.mode).toBe('air');
  });
});

describe('伏低', () => {
  for (const kind of ['mopAcross', 'deskBar', 'chairBar', 'longTable'] as const) {
    it(`伏低能过 ${kind}（下沿 ≥ 0.36 m），不伏低会撞`, () => {
      const mk = () => chapter([runSeg({ items: [{ at: 20, lane: 0, kind }] })]);
      const ok = new Driver(mk());
      ok.until(() => ok.snap.player.beat >= 18.5);
      ok.press('down');
      ok.until(() => ok.snap.player.beat >= 24);
      ok.release('down');
      expect(ok.of('hit').length).toBe(0);
      const bad = new Driver(mk());
      bad.until(() => bad.snap.player.beat >= 24);
      expect(bad.of('hit').map((h) => h.data.severity)).toEqual(['crash']);
    });
  }
});

describe('绊与撞的判定（§2.5）', () => {
  const o = (cls: CompiledObstacle['cls'], y0: number, y1: number): CompiledObstacle => ({
    id: 1, kind: cls === 'low' ? 'bag' : cls === 'bar' ? 'longTable' : 'bin', cls, archetype: 'lowBox', lanes: [0], beat: 0,
    s0: 10, s1: 10.5, y0, y1, halfW: 0.5, behavior: { type: 'static' }, npc: false, params: {},
  });
  const box = (s: number, x = 0, y = 0, duck = 0) => playerBox(s, x, y, duck, 0, { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0, });
  const ob = (q: CompiledObstacle) => ({ x0: -q.halfW, x1: q.halfW, y0: q.y0, y1: q.y1, s0: q.s0, s1: q.s1 });
  it('低矮：任意相交都算绊', () => {
    const q = o('low', 0, 0.3);
    expect(classify(box(9.9), box(9.8), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'stumble' });
  });
  it('横档：内层相交且竖直穿透 > 0.12 m 算撞', () => {
    const q = o('bar', 0.4, 0.76);   // 穿透 0.15
    expect(classify(box(10.2), box(10.1), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'crash' });
  });
  it('横档：擦边（竖直穿透 ≤ 0.12 m）只算绊', () => {
    const q = o('bar', 0.45, 0.76);  // 穿透 0.10
    expect(classify(box(10.2), box(10.1), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'stumble' });
  });
  it('横档：伏低过渡中被擦到只算绊', () => {
    const q = o('bar', 0.4, 0.76);
    expect(classify(box(10.2, 0, 0, 0.3), box(10.1, 0, 0, 0.2), q, ob(q), true)).toMatchObject({ type: 'hit', severity: 'stumble' });
  });
  it('挡道：正面内层相交算撞；侧面或外层擦边算绊；横向相距 < 0.1 m 只是擦肩', () => {
    const q = o('block', 0, 1.2);
    expect(classify(box(9.9), box(9.8), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'crash', mode: 'blockFront' });
    expect(classify(box(10.2, 0.6), box(10.1, 1.0), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'stumble' });
    expect(classify(box(10.2, 0.7), box(10.1, 0.7), q, ob(q), false)).toMatchObject({ type: 'hit', severity: 'stumble', mode: 'blockGraze' });
    expect(classify(box(10.2, 0.78), box(10.1, 0.78), q, ob(q), false)).toMatchObject({ type: 'nearMiss' });
  });
  it('模拟里：绊 −1，撞 −2', () => {
    const d = new Driver(chapter([runSeg({ items: [{ at: 20, lane: 0, kind: 'bag' }, { at: 30, lane: 0, kind: 'bin' }] })]));
    d.until(() => d.snap.player.beat > 25);
    expect(d.snap.player.steady).toBe(2);
    d.until(() => d.snap.player.beat > 32 || d.of('fall').length > 0);
    const hits = d.of('hit').map((h) => [h.data.severity, h.data.steady]);
    expect(hits).toEqual([['stumble', 2], ['crash', 0]]);
  });
});

describe('稳度', () => {
  it('连续 16 拍没有受击 +1', () => {
    const d = new Driver(chapter([runSeg({ items: [{ at: 20, lane: 0, kind: 'bag' }] })]));
    d.until(() => d.of('hit').length === 1);
    const hitBeat = d.snap.player.beat;
    expect(d.snap.player.steady).toBe(2);
    d.until(() => d.snap.player.beat >= hitBeat + 15.8);
    expect(d.snap.player.steady).toBe(2);
    d.until(() => d.snap.player.beat >= hitBeat + 16.2);
    expect(d.snap.player.steady).toBe(3);
  });
  it('回稳：施压段 24 拍，辅助模式 12 拍，干脆一次 +4 拍', () => {
    const s = new Steady();
    s.value = 1; s.max = 2;
    expect(s.progress(23.9, 'pressure')).toBe(false);
    expect(s.progress(0.2, 'pressure')).toBe(true);
    const a = new Steady(); a.assist = true; a.value = 1;
    expect(a.progress(12, 'behind')).toBe(true);
    const c = new Steady(); c.value = 2;
    c.progress(12, 'behind');
    expect(c.crisp('behind')).toBe(true);
    expect(c.value).toBe(3);
  });
  it('受击会让稳度跌破 0 才摔倒', () => {
    const cases: Array<[number, 'stumble' | 'crash', 'ok' | 'fall', number]> = [
      [3, 'crash', 'ok', 1], [2, 'crash', 'ok', 0], [1, 'stumble', 'ok', 0], [1, 'crash', 'fall', 1], [0, 'stumble', 'fall', 0],
    ];
    for (const [v, sev, res, after] of cases) {
      const s = new Steady(); s.value = v;
      expect(s.hit(sev, 'behind', false)).toBe(res);
      expect(s.value).toBe(after);
    }
    const h = new Steady(); h.value = 0;
    expect(h.hit('crash', 'hidden', false)).toBe('ok');   // hidden 模式最低停在 0，不会失败
    expect(h.value).toBe(0);
  });
  it('模拟里：稳度 1 时撞一次就摔倒，发出 fall', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'behind', steady: 1 }, items: [{ at: 10, lane: 0, kind: 'bin' }] })]));
    d.until(() => d.of('fall').length > 0, 120 * 20);
    expect(d.snap.player.mode).toBe('fall');
    expect(d.snap.stats.falls).toBe(1);
  });
});

describe('检查点恢复', () => {
  it('retry 回到最近的检查点，稳度回满，纸条保留，摔倒次数累计', () => {
    const def = chapter([runSeg({
      follower: { mode: 'behind', steady: 3 }, checkpoints: [40],
      notes: [{ at: 30, lane: 0, note: 'nx' }],
      items: [{ at: 60, lane: 0, kind: 'bin' }, { at: 68, lane: 'all', kind: 'bin' }],   // 撞（3→1），过了无敌时间再撞 → 摔倒
    })]);
    const d = new Driver(def);
    d.until(() => d.of('fall').length > 0, 120 * 40);
    expect(d.snap.checkpoint).toEqual({ segment: 's1', beat: 40 });
    expect(d.snap.stats.notes).toContain('nx');
    d.sim.retry();
    const s = d.snap;
    expect(s.player.beat).toBeCloseTo(40, 6);
    expect(s.player.steady).toBe(3);
    expect(s.player.mode).not.toBe('fall');
    expect(s.stats.falls).toBe(1);
    expect(s.stats.notes).toContain('nx');
    d.step(10);
    expect(d.snap.player.beat).toBeGreaterThan(40);
  });
});

describe('稳度 → 相位差（§2.6）', () => {
  it('behind / synced / pressure 表', () => {
    expect([3, 2, 1, 0].map((s) => lagFor('behind', s, null))).toEqual([0.5, 0.33, 0.17, 0]);
    expect([3, 2, 1, 0].map((s) => lagFor('synced', s, null))).toEqual([0, 0.12, 0.25, 0.38]);
    expect([2, 1, 0].map((s) => lagFor('pressure', s, null))).toEqual([0.33, 0.17, 0]);
    expect(lagFor('behind', 3, 1)).toBe(1);   // lagOverride（3-2 楼梯）
  });
  it('追随者触地 = 自己的触地延迟 lag / cadence 重放', () => {
    const d = new Driver(chapter([runSeg({ cadence: 5 })]));
    d.step(240);
    const own = d.of('contact').filter((e) => e.data.part === 'heel');
    const fol = d.of('followerContact').filter((e) => e.data.part === 'heel');
    expect(fol.length).toBeGreaterThan(5);
    const f = fol[2]!.data;
    const nearest = own.map((o) => f.t - o.data.t).filter((x) => x > 0).sort((a, b) => a - b)[0]!;
    expect(nearest).toBeCloseTo(0.5 / 5, 3);
    expect(f.lagBeats).toBeCloseTo(0.5, 6);
  });
  it('hidden / absent 没有追随者触地', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'absent' } })]));
    d.step(240);
    expect(d.of('followerContact').length).toBe(0);
    expect(d.of('contact').length).toBeGreaterThan(20);
  });
});

describe('三段触地', () => {
  it('掌根 → 指节 +26 ms·k → 指腹 +52 ms·k，偶数拍左手', () => {
    const d = new Driver(chapter([runSeg({ cadence: 4.8 })]));
    d.step(120);
    const c = d.of('contact');
    const heel = c.find((e) => e.data.part === 'heel')!;
    const kn = c.find((e) => e.data.part === 'knuckle' && e.data.t > heel.data.t)!;
    const pad = c.find((e) => e.data.part === 'pad' && e.data.t > heel.data.t)!;
    expect(kn.data.t - heel.data.t).toBeCloseTo(0.026, 4);
    expect(pad.data.t - heel.data.t).toBeCloseTo(0.052, 4);
    for (const h of c.filter((e) => e.data.part === 'heel')) {
      const beatIndex = Math.round(h.data.s);     // 段首 s0 = 0，步幅 1：掌根时刻里程约等于整数拍
      expect(h.data.hand).toBe(beatIndex % 2 === 0 ? 'L' : 'R');
    }
  });
});

describe('静场', () => {
  it('输入超时自动完成，不罚；等待时间不计入 duration', () => {
    const def = chapter([{
      id: 'st', kind: 'still', set: 'placeholder', atmosphere: 'morning', duration: 6, follower: { mode: 'hidden' },
      events: [{ at: 1, type: 'text', line: 'c1.note', id: 'a' }],
      input: { at: 2, hint: 'hold', mode: 'hold', holdSeconds: 0.5, timeout: 4, onDone: [{ at: 0.5, type: 'text', line: 'c1.holdIt', id: 'b' }] },
    }, runSeg({ id: 'after', beats: 20 })]);
    const d = new Driver(def);
    d.until(() => d.snap.still?.prompt === 'hold', 120 * 5);
    expect(d.snap.t).toBeCloseTo(2, 1);
    const n = d.until(() => d.snap.still?.prompt !== 'hold', 120 * 10);
    expect(n * TICK_DT).toBeCloseTo(4, 1);            // 超时 4 s
    d.until(() => d.snap.segment === 'after', 120 * 10);
    expect(d.snap.t).toBeCloseTo(6 + 4, 0);           // duration + 等待
    expect(d.snap.beatsFired).toEqual(expect.arrayContaining(['a', 'b']));
    expect(d.snap.stats.falls).toBe(0);
  });
  it('按住 ↓ 0.5 s 完成', () => {
    const def = chapter([{
      id: 'st', kind: 'still', set: 'placeholder', atmosphere: 'morning', duration: 4, follower: { mode: 'hidden' }, events: [],
      input: { at: 1, hint: 'hold', mode: 'hold', holdSeconds: 0.5, timeout: 4 },
    }, runSeg({ id: 'after', beats: 20 })]);
    const d = new Driver(def);
    d.until(() => d.snap.still?.prompt === 'hold', 120 * 3);
    d.press('down');
    const n = d.until(() => d.snap.still?.prompt !== 'hold', 120 * 3);
    expect((n + 1) * TICK_DT).toBeCloseTo(0.5, 1);
  });
});

describe('确定性', () => {
  function script(seed: number): Map<number, Action> {
    const r = createRng(seed, 'script');
    const m = new Map<number, Action>();
    const acts: Action[] = ['left', 'right', 'up', 'down'];
    for (let t = 30; t < 3000; t += 20 + r.int(60)) m.set(t, r.pick(acts));
    return m;
  }
  function run(def: ChapterDef, seed: number): string {
    const sim = new Sim(solver);
    sim.load(compile(def, seed), undefined, seed);
    const sc = script(seed);
    const held = new Set<Action>();
    let up: Action | null = null;
    for (let t = 0; t < 3000; t++) {
      const evs = [];
      if (up) { evs.push({ action: up, phase: 'up' as const, t: t * 1000 / 120, device: 'keyboard' as const }); held.delete(up); up = null; }
      const a = sc.get(t);
      if (a) { evs.push({ action: a, phase: 'down' as const, t: t * 1000 / 120, device: 'keyboard' as const }); held.add(a); up = a; }
      sim.step(evs, held);
      sim.drain();
    }
    return sim.hash();
  }
  it('5 个种子各跑 3000 tick，相同输入脚本得到相同 hash()', () => {
    const def = ch1 as ChapterDef;
    const hashes = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      const a = run(def, seed), b = run(def, seed);
      expect(a).toBe(b);
      hashes.add(a);
    }
    expect(hashes.size).toBeGreaterThan(1);
  });
});

describe('自动驾驶', () => {
  it('perfect 自动驾驶 0 摔倒跑完第一章，必备节拍全部触发', () => {
    const def = ch1 as ChapterDef;
    const d = new Driver(def);
    d.sim.setAutopilot('perfect');
    d.until(() => d.of('chapter:end').length > 0, 120 * 200);
    expect(d.of('chapter:end').length).toBe(1);
    expect(d.snap.stats.falls).toBe(0);
    expect(d.of('hit').length).toBe(0);
    expect([...d.snap.beatsFired].sort()).toEqual([...def.requiredBeats].sort());
  });
});
