// tests/unit/sim/numbers.test.ts —— §2.4 的全部数值（DESIGN.md §8.10 WP1 验收 1）：撑跃起跳窗口、伏低太晚、撞与绊的分界（含 0.12 m
// 的精确边界）、内层盒、回稳 16 / 24 / 12 拍、干脆 ±60 ms（辅助 ±100 ms、触摸意图补偿）、换道、辅助模式、「放慢一点」。
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../../src/core/constants';
import type { AABB } from '../../../src/core/types';
import { DEFAULT_SWIPE } from '../../../src/input/gestures';
import type { CompiledObstacle } from '../../../src/levels/schema';
import { classify, playerBox } from '../../../src/sim/Collision';
import { jumpDuration } from '../../../src/sim/Player';
import { crispDelta } from '../../../src/sim/Sim';
import { Steady } from '../../../src/sim/Steady';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, Driver, runSeg } from './fixtures';

const box = (): AABB => ({ x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 });

/** 在 beat 处起跳，数撞到几次（0 = 越过）。 */
function jumpAt(cad: number, takeoff: number, at = 40): number {
  const d = new Driver(chapter([runSeg({ cadence: cad, items: [{ at, lane: 0, kind: 'mopBucket' }] })]));
  d.until(() => d.snap.player.beat >= takeoff - 1e-9, 120 * 30);
  d.tap('up');
  d.until(() => d.snap.player.beat >= at + 3, 120 * 30);
  return d.of('hit').length;
}

describe('撑跃（§2.4 容错验算）', () => {
  for (const cad of [4.4, 4.8, 5.4, 5.8]) {
    it(`步频 ${cad}、步幅 1.0：越过 0.35 m 的低矮障碍，合法起跳窗口 ≥ ±0.5 拍`, () => {
      const ok: number[] = [];
      for (let b = 35.5; b <= 40; b += 0.05) if (jumpAt(cad, b) === 0) ok.push(b);
      expect(ok.length).toBeGreaterThan(0);
      // 连续的一段
      const lo = Math.min(...ok), hi = Math.max(...ok);
      for (let b = lo; b <= hi; b += 0.05) expect(ok.some((x) => Math.abs(x - b) < 1e-6), `takeoff ${b.toFixed(2)}`).toBe(true);
      expect(hi - lo + 0.05).toBeGreaterThanOrEqual(1.0);          // ±0.5 拍
      expect(hi - lo).toBeLessThan(1.3);                            // 设计值约 ±0.54 拍，不会宽得离谱
      // 滞空 3 拍、落在 [0.48, 0.72] s
      expect(jumpDuration(cad) * cad).toBeCloseTo(3, 6);
    });
  }
  it('滞空时间夹在 [0.48, 0.72] s', () => {
    expect(jumpDuration(4.0)).toBeCloseTo(0.72, 9);
    expect(jumpDuration(7.0)).toBeCloseTo(0.48, 9);
  });
});

describe('伏低（§2.4）', () => {
  function duckAt(pressBeat: number | null): string[] {
    const d = new Driver(chapter([runSeg({ cadence: 4.8, items: [{ at: 30, lane: 0, kind: 'longTable' }] })]));
    if (pressBeat !== null) {
      d.until(() => d.snap.player.beat >= pressBeat - 1e-9, 120 * 30);
      d.press('down');
    }
    d.until(() => d.snap.player.beat >= 33, 120 * 30);
    return d.of('hit').map((h) => h.data.severity);
  }
  it('提前伏低能过；伏低做到一半被擦到只算绊；不伏低爬过去一定撞', () => {
    expect(duckAt(29.0)).toEqual([]);
    // 接触前 0–0.03 s 才按：碰到时伏低还在 0.06 s 的过渡里 → 只算绊
    for (const b of [29.6, 29.65, 29.7, 29.72]) expect(duckAt(b), `press @${b}`).toEqual(['stumble']);
    expect(duckAt(null)).toEqual(['crash']);
  });
  it('伏低碰撞盒顶 0.30 m，横档下沿 ≥ 0.36 m：净空 ≥ 6 cm；爬行盒顶 0.55 m', () => {
    expect(playerBox(0, 0, 0, 1, 0, box()).y1).toBeCloseTo(TUNING.duck.height, 9);
    expect(playerBox(0, 0, 0, 0, 0, box()).y1).toBeCloseTo(0.55, 9);
    expect(playerBox(0, 0, 0, 0, 1, box()).y1).toBeCloseTo(0.85, 9);   // 腿自主抬起
  });
});

describe('撞与绊的分界（§2.5、§10.1）', () => {
  const bar = (y0: number): CompiledObstacle => ({
    id: 1, kind: 'mopAcross', cls: 'bar', archetype: 'armBar', lanes: [0], beat: 0, s0: 10, s1: 10.1, y0, y1: y0 + 0.08, halfW: 0.55,
    behavior: { type: 'static' }, npc: false, params: {},
  });
  const ob = (o: CompiledObstacle, dx = 0): AABB => ({ x0: -o.halfW + dx, x1: o.halfW + dx, y0: o.y0, y1: o.y1, s0: o.s0, s1: o.s1 });
  const p = (s: number, x = 0) => playerBox(s, x, 0, 0, 0, box());
  it('竖直穿透恰好 0.12 m 只算绊，超过一点就是撞（爬行盒顶 0.55 m）', () => {
    const exact = bar(0.43);                       // 0.55 − 0.43 = 0.12（浮点里是 0.12000000000000005）
    expect(classify(p(10), p(9.99), exact, ob(exact), false)).toMatchObject({ type: 'hit', severity: 'stumble', mode: 'barGraze' });
    const over = bar(0.4299);
    expect(classify(p(10), p(9.99), over, ob(over), false)).toMatchObject({ type: 'hit', severity: 'crash', mode: 'barCrash' });
    const under = bar(0.4301);
    expect(classify(p(10), p(9.99), under, ob(under), false)).toMatchObject({ type: 'hit', severity: 'stumble' });
  });
  it('内层盒只在横向缩到 85%：外层擦边算绊，内层相交才会撞', () => {
    const o = bar(0.36);
    const half = o.halfW, inner = half * TUNING.hitbox.lethalShrink;
    const pw = TUNING.hitbox.halfW;
    // 玩家盒的边缘刚好越过外层但没进内层
    const xGraze = half + pw - 0.01;
    expect(xGraze - pw).toBeGreaterThan(inner);
    expect(classify(p(10, xGraze), p(9.99, xGraze), o, ob(o), false)).toMatchObject({ severity: 'stumble' });
    const xIn = inner + pw - 0.01;
    expect(classify(p(10, xIn), p(9.99, xIn), o, ob(o), false)).toMatchObject({ severity: 'crash' });
  });
  it('模拟里：擦边只扣 1，撞扣 2；撞上横档会自动压低钻过去', () => {
    const d = new Driver(chapter([runSeg({ items: [{ at: 20, lane: 0, kind: 'mopAcross' }] })]));
    d.until(() => d.snap.player.beat > 22);
    const h = d.of('hit');
    expect(h.map((e) => [e.data.severity, e.data.steady])).toEqual([['crash', 1]]);
    expect(d.of('hit').length).toBe(1);
  });
});

describe('回稳（§2.6）：16 / 24 / 12 拍', () => {
  function regenBeats(o: { mode: 'behind' | 'pressure'; assist?: boolean }): number {
    const d = new Driver(chapter([runSeg({ follower: { mode: o.mode, steady: o.mode === 'pressure' ? 2 : 3 }, items: [{ at: 20, lane: 0, kind: 'bag' }] })]));
    if (o.assist) d.sim.setAssist(true);
    d.until(() => d.of('hit').length === 1);
    const hitBeat = d.snap.player.beat;
    const v = d.snap.player.steady;
    d.until(() => d.snap.player.steady > v, 120 * 40);
    return d.snap.player.beat - hitBeat;
  }
  it('behind 16 拍', () => { expect(regenBeats({ mode: 'behind' })).toBeCloseTo(16, 0); });
  it('pressure 24 拍（上限 2）', () => { expect(regenBeats({ mode: 'pressure' })).toBeCloseTo(24, 0); });
  it('辅助模式 12 拍、上限 +1', () => {
    expect(regenBeats({ mode: 'behind', assist: true })).toBeCloseTo(12, 0);
    expect(Steady.maxFor('behind', undefined, true)).toBe(4);
    expect(Steady.maxFor('pressure', undefined, true)).toBe(3);
  });
});

describe('干脆（§2.2）：意图时刻距最近一次掌根 ±60 ms', () => {
  /** 在掌根之后 offMs 毫秒（意图时刻）按 →，返回这次换道是否干脆。offMs 可以为负：在下一次掌根之前。 */
  function crispAt(offMs: number, o: { assist?: boolean; device?: 'keyboard' | 'touch'; physicalMs?: number } = {}): boolean {
    const d = new Driver(chapter([runSeg({ cadence: 4.8 })]));
    if (o.assist) d.sim.setAssist(true);
    if (o.device) d.device = o.device;
    d.step(240);
    d.clear();
    // 等下一次掌根
    d.until(() => d.of('contact').some((c) => c.data.part === 'heel'), 240);
    const heel = d.of('contact').find((c) => c.data.part === 'heel')!.data.t;
    const intent = heel * 1000 + offMs;
    const now = d.snap.t * 1000;
    if (offMs >= 0) {
      // 掌根之后：等到意图时刻所在的 tick 再按
      d.until(() => d.snap.t * 1000 >= intent - 1e-6, 240);
      d.tap('right', intent - d.snap.t * 1000);
    } else {
      // 下一次掌根之前 |offMs|：先推进到下一次掌根前的那个 tick
      const period = 1000 / 4.8 / (o.assist ? TUNING.assist.speedMul : 1);
      const next = heel * 1000 + period;
      d.until(() => d.snap.t * 1000 >= next + offMs - 1e-6, 240);
      d.tap('right', next + offMs - d.snap.t * 1000);
    }
    void now;
    const a = d.of('action').find((x) => x.data.kind === 'lane');
    return a?.data.crisp ?? false;
  }
  it('±60 ms 以内干脆，61 ms 不干脆（掌根之后与之前）', () => {
    expect(crispAt(0)).toBe(true);
    expect(crispAt(60)).toBe(true);
    expect(crispAt(61)).toBe(false);
    expect(crispAt(-60)).toBe(true);
    expect(crispAt(-61)).toBe(false);
  });
  it('辅助模式放宽到 ±100 ms', () => {
    expect(crispAt(100, { assist: true })).toBe(true);
    expect(crispAt(101, { assist: true })).toBe(false);
  });
  it('触摸：意图时刻 = pointerdown + 40 ms（输入层补偿后交给模拟）', () => {
    expect(DEFAULT_SWIPE.intentOffsetMs).toBe(TUNING.steady.touchIntentOffset * 1000);
    // 物理按下在掌根后 20 ms：意图时刻 +60 ms，仍然干脆；物理按下在 +21 ms：意图 +61 ms，不干脆
    expect(crispAt(20 + DEFAULT_SWIPE.intentOffsetMs, { device: 'touch' })).toBe(true);
    expect(crispAt(21 + DEFAULT_SWIPE.intentOffsetMs, { device: 'touch' })).toBe(false);
  });
  it('干脆只让回稳计数 +4 拍，并让下一次掌根带 crisp 标记', () => {
    expect(crispDelta(1.0, 0.95, 1.2)).toBeCloseTo(0.05, 9);
    expect(crispDelta(1.0, -1, 1.03)).toBeCloseTo(0.03, 9);
    const s = new Steady(); s.value = 2;
    s.progress(12, 'behind');
    expect(s.crisp('behind')).toBe(true);
    expect(s.value).toBe(3);
    const d = new Driver(chapter([runSeg({ cadence: 4.8 })]));
    d.step(240); d.clear();
    d.until(() => d.of('contact').some((c) => c.data.part === 'heel'), 240);
    d.tap('right');                                       // 就在掌根的这个 tick
    d.clear();
    d.until(() => d.of('contact').some((c) => c.data.part === 'heel'), 240);
    expect(d.of('contact').find((c) => c.data.part === 'heel')!.data.crisp).toBe(true);
  });
});

describe('换道、辅助模式与「放慢一点」', () => {
  it('换道 0.14 s（干）/ 0.22 s（湿），可以预排 1 次', () => {
    expect(TUNING.laneChange.dry).toBe(0.14);
    expect(TUNING.laneChange.wet).toBe(0.22);
    const d = new Driver(chapter([runSeg()]));
    d.step(30);
    d.tap('right');
    const n = d.until(() => Math.abs(d.snap.player.x - 1.1) < 1e-9, 60);
    expect(Math.abs((n + 1) * TICK_DT - 0.14)).toBeLessThanOrEqual(TICK_DT + 1e-9);
  });
  it('辅助模式：速度 ×0.9', () => {
    const a = new Driver(chapter([runSeg({ cadence: 5 })]));
    const b = new Driver(chapter([runSeg({ cadence: 5 })]));
    b.sim.setAssist(true);
    a.step(600); b.step(600);
    expect(b.snap.player.s / a.snap.player.s).toBeCloseTo(0.9, 2);
  });
  it('「放慢一点」：速度 ×0.9，离开本段即重置（§10.1）；重来同一段时保留', () => {
    const def = chapter([runSeg({ id: 'a', beats: 40, cadence: 5 }), runSeg({ id: 'b', beats: 40, cadence: 5 })]);
    const d = new Driver(def);
    d.sim.setSlowOption(true);
    d.step(120);
    expect(d.snap.slowOption).toBe(true);
    expect(d.snap.player.speed).toBeCloseTo(5 * 0.9, 6);
    d.sim.retry();
    expect(d.snap.slowOption).toBe(true);
    d.until(() => d.snap.segment === 'b', 120 * 20);
    expect(d.snap.slowOption).toBe(false);
    d.step(10);
    expect(d.snap.player.speed).toBeCloseTo(5, 6);
  });
});
