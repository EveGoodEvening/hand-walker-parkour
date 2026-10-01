// tests/unit/sim/context.test.ts —— 回头、让一下、前方的它、追随者的各种模式、静音、翻转、端盘、步态
// （DESIGN.md §2.6、§3、§4、§8.5 EventBody 的模拟类成员、§8.7）。
import { describe, expect, it } from 'vitest';
import { AHEAD_DISTANCE, TICK_DT } from '../../../src/core/constants';
import { compile } from '../../../src/levels/compile';
import { LEADER_MIN, RECEDE_SPEED } from '../../../src/sim/Leader';
import { solver } from '../../../src/sim/Solver';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, Driver, MECH_RUN, perfectRun, runSeg } from './fixtures';

describe('回头（§3、R10）', () => {
  const win = (o: { auto?: boolean; gain?: 0 | 1 } = {}) => ({ id: 'w', from: 20, to: 30, type: 'lookBack' as const, auto: o.auto ?? false, gain: o.gain ?? 1,
    then: [{ at: 0, type: 'text' as const, line: 'c1.empty' as const }, { at: 1.2, type: 'text' as const, line: 'c1.shadowProne' as const, id: 'after' }] });
  it('窗口外按 Q 没有用；窗口内情境按钮可用，按 Q 回头：0.25 + 0.4 + 0.25 s，then 按相对秒数触发', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'behind', steady: 2 }, windows: [win()] })]));
    d.step(60); d.tap('look'); d.step(2);
    expect(d.of('lookBack').length).toBe(0);
    d.until(() => d.snap.player.beat >= 21, 120 * 10);
    const pr = d.of('prompt').at(-1)!.data;
    expect(pr).toEqual({ hint: 'look', context: { look: true, ask: false } });
    d.tap('look');
    expect(d.of('lookBack').map((e) => e.data)).toEqual([{ phase: 'start', gain: 1, auto: false }]);
    expect(d.snap.player.steady).toBe(3);                     // 每章第一次回头稳度 +1
    d.step(Math.round(0.3 / TICK_DT));
    expect(d.snap.player.lookBack).toBe(1);
    d.until(() => d.of('lookBack').length === 2, 240);
    expect(d.of('lookBack')[1]!.data.phase).toBe('end');
    const dur = (d.of('lookBack')[1]!.tick - d.of('lookBack')[0]!.tick) * TICK_DT;
    expect(dur).toBeCloseTo(TUNING.lookBack.turn + TUNING.lookBack.hold + TUNING.lookBack.back, 1);
    d.until(() => d.snap.beatsFired.includes('after'), 240);
    expect(d.snap.stats.lookBacks).toBe(1);
    expect(d.of('prompt').at(-1)!.data.context.look).toBe(false);
  });
  it('auto 窗口：玩家不按 Q，窗口结束时自动回头一次', () => {
    const d = new Driver(chapter([runSeg({ windows: [win({ auto: true })] })]));
    d.until(() => d.of('lookBack').length > 0, 120 * 20);
    expect(d.of('lookBack')[0]!.data).toMatchObject({ phase: 'start', auto: true });
    expect(d.snap.player.beat).toBeCloseTo(30, 0);
  });
  it('非 auto 窗口过了就过了；收益每章只给一次', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'behind', steady: 1 }, windows: [win(), { ...win(), id: 'w2', from: 60, to: 70 }] })]));
    d.until(() => d.snap.player.beat >= 32, 120 * 20);
    expect(d.of('lookBack').length).toBe(0);
    d.until(() => d.snap.player.beat >= 61, 120 * 20);
    d.tap('look');
    expect(d.of('lookBack')[0]!.data.gain).toBe(1);
    const d2 = new Driver(chapter([runSeg({ follower: { mode: 'behind', steady: 1 }, windows: [win(), { ...win(), id: 'w2', from: 60, to: 70 }] })]));
    d2.until(() => d2.snap.player.beat >= 21, 120 * 20); d2.tap('look');
    d2.until(() => d2.snap.player.beat >= 61, 120 * 20); d2.tap('look');
    expect(d2.of('lookBack').filter((e) => e.data.phase === 'start').map((e) => e.data.gain)).toEqual([1, 0]);
  });
  it('重来回到检查点时的收益状态：检查点之前没拿过，重来后第一次回头仍然 +1；检查点之前拿过的，重来后仍是 0', () => {
    const def = chapter([runSeg({ follower: { mode: 'behind', steady: 1 }, checkpoints: [40], windows: [win(), { ...win(), id: 'w2', from: 60, to: 70 }] })]);
    const gains = (d: Driver) => d.of('lookBack').filter((e) => e.data.phase === 'start').map((e) => e.data.gain);
    const a = new Driver(def);
    a.until(() => a.snap.player.beat >= 21, 120 * 20); a.tap('look');
    a.until(() => a.snap.player.beat >= 32, 120 * 20);
    a.sim.retry();                                            // 回到段首（检查点 @0）：那时还没回过头
    a.until(() => a.snap.player.beat >= 21, 120 * 20); a.tap('look');
    expect(gains(a)).toEqual([1, 1]);
    a.until(() => a.snap.player.beat >= 45, 120 * 20);       // 过了 @40 的检查点：此时已经拿过收益
    a.sim.retry();
    a.until(() => a.snap.player.beat >= 61, 120 * 20); a.tap('look');
    expect(gains(a)).toEqual([1, 1, 0]);
  });
});

describe('窗口上的必备节拍（附录 C：id 可以挂在窗口上）', () => {
  const def = (look: { auto?: boolean } = {}) => chapter([runSeg({
    beats: 80, cadence: 4.6, crowd: true,
    windows: [
      { id: 'restBeat', from: 20, to: 30, type: 'rest', then: [{ at: 0.5, type: 'sfx', sfx: 'shush', id: 'restThen' }] },
      { id: 'askBeat', from: 40, to: 50, type: 'ask' },
      { id: 'lookBeat', from: 55, to: 65, type: 'lookBack', gain: 0, ...look },
    ],
  })], { requiredBeats: ['restBeat', 'restThen', 'askBeat'] });
  it('perfect 跑完：rest、ask 窗口的 id 与 rest 窗口 then 里的 id 都进 beatsFired', () => {
    const r = perfectRun(def(), 1);
    expect(r.ended).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it('不按任何键：rest / ask 窗口在段内拍号到达 from 时触发，then 按相对秒数；非 auto 回头窗口不触发，auto 的在窗口结束时触发', () => {
    const d = new Driver(def());
    d.until(() => d.snap.beatsFired.includes('restBeat'), 120 * 20);
    expect(d.snap.player.beat).toBeGreaterThanOrEqual(20);
    expect(d.snap.player.beat).toBeLessThan(20.1);
    expect(d.snap.beatsFired).not.toContain('restThen');
    const t0 = d.snap.t;
    d.until(() => d.snap.beatsFired.includes('restThen'), 240);
    expect(d.snap.t - t0).toBeCloseTo(0.5, 1);
    d.until(() => d.snap.beatsFired.includes('askBeat'), 120 * 20);
    expect(d.snap.player.beat).toBeGreaterThanOrEqual(40);
    expect(d.snap.player.beat).toBeLessThan(40.1);
    d.until(() => d.sim.isEnded, 120 * 30);
    expect(d.snap.beatsFired).toEqual(['restBeat', 'restThen', 'askBeat']);
    expect(d.of('beat').map((e) => e.data.id)).toEqual(['restBeat', 'restThen', 'askBeat']);
    const a = new Driver(def({ auto: true }));
    a.until(() => a.sim.isEnded, 120 * 60);
    expect(a.snap.beatsFired).toEqual(['restBeat', 'restThen', 'askBeat', 'lookBeat']);
  });
  it('从检查点进段：已经结束的窗口不再触发；正处在窗口里的第一 tick 就触发', () => {
    const past = new Driver(def(), { segment: 's1', beat: 35 });
    past.until(() => past.snap.player.beat >= 38, 120 * 10);
    expect(past.snap.beatsFired).toEqual([]);
    const inside = new Driver(def(), { segment: 's1', beat: 45 });
    inside.step(1);
    expect(inside.snap.beatsFired).toEqual(['askBeat']);
  });
});

describe('让一下（§3、R2 noAsk）', () => {
  const crowd = (ignore: boolean | 'seeded' = false, o = {}) => chapter([runSeg({
    crowd: true, cadence: 4.6,
    items: [{ at: 30, lane: [-1, 0, 1], kind: 'legs', behavior: { type: 'askable', ignore } }],
    windows: [{ from: 20, to: 30, type: 'ask' }], ...o,
  })]);
  it('只在窗口里、前方 6 m 内有可请求的人时可用；按 E：0.5 s 后让开，之后不再碰撞', () => {
    const d = new Driver(crowd(false));
    d.until(() => d.snap.player.beat >= 18, 120 * 10);
    d.tap('ask');
    expect(d.of('ask').length).toBe(0);                          // 窗口外
    d.until(() => d.of('prompt').some((p) => p.data.context.ask), 120 * 5);
    expect(d.snap.player.beat).toBeGreaterThanOrEqual(24 - 1e-6);  // 6 m 以内
    d.tap('ask');
    expect(d.of('ask').map((e) => e.data.result)).toEqual(['part']);
    expect(d.of('action').some((a) => a.data.kind === 'ask')).toBe(true);
    d.until(() => d.snap.player.beat >= 33, 120 * 10);
    expect(d.of('hit').length).toBe(0);
  });
  it('不动的人（ignore）照样挡路；每段最多开口 2 次', () => {
    const d = new Driver(crowd(true));
    d.until(() => d.snap.player.beat >= 25, 120 * 10);
    d.tap('ask'); d.tap('ask');
    expect(d.of('ask').map((e) => e.data.result)).toEqual(['ignore']);
    d.until(() => d.snap.player.beat >= 32 || d.of('fall').length > 0, 120 * 10);
    expect(d.of('hit').length).toBe(1);
    const e = new Driver(chapter([runSeg({ crowd: true, items: [20, 22, 24].map((at) => ({ at, lane: 1 as const, kind: 'legs' as const, behavior: { type: 'askable' as const, ignore: false } })) })]));
    e.until(() => e.snap.player.beat >= 15, 120 * 10); e.tap('ask');
    e.until(() => e.snap.player.beat >= 17.5, 120 * 10); e.tap('ask');
    e.until(() => e.snap.player.beat >= 19, 120 * 10); e.tap('ask');
    expect(e.of('action').filter((a) => a.data.kind === 'ask').length).toBe(2);
  });
  it("'seeded'：由章种子决定，约 30% 不动（编译期定下，Sim 与求解器一致）", () => {
    let ignored = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const c = compile(crowd('seeded'), seed);
      ignored += Number(c.segments[0]!.obstacles[0]!.params.askIgnore);
    }
    expect(ignored / 400).toBeGreaterThan(0.22);
    expect(ignored / 400).toBeLessThan(0.38);
  });
  it('非人群段不能开口', () => {
    const d = new Driver(crowd(false, { crowd: false }));
    d.until(() => d.snap.player.beat >= 26, 120 * 10);
    d.tap('ask');
    expect(d.of('ask').length).toBe(0);
  });
  it('求解器：不开口无解时 noAsk = null，允许开口时路线里带开口', () => {
    const seg = compile(crowd(false)).segments[0]!;
    expect(solver.solve(seg, { noAsk: true })).toBeNull();
    const p = solver.solve(seg, { noAsk: false });
    expect(p).not.toBeNull();
    expect((p as unknown as { asks: number[] }).asks.length).toBe(1);
  });
});

describe('前方的它（ahead）', () => {
  const ahead = (o = {}) => chapter([runSeg({
    stride: 1.1, cadence: 5, follower: { mode: 'ahead', steady: 3 },
    rows: [[20, '.B.'], [40, 'B..'], [60, '..B'], [80, '.B.'], [100, 'B.B']],
    events: [{ at: 4, type: 'leader', op: 'appear' }, { at: 150, type: 'leader', op: 'recede' }], ...o,
  })]);
  it('出现之前没有 leaderS；出现后在前方 3 m，按求解器路线换道', () => {
    const d = new Driver(ahead());
    d.sim.setAutopilot('perfect');
    d.step(30);
    expect(d.snap.follower.leaderS).toBeNull();
    d.until(() => d.snap.player.beat >= 6, 240);
    const f = d.snap.follower;
    expect(f.leaderS! - d.snap.player.s).toBeCloseTo(3, 6);
    expect(f.distance).toBeCloseTo(3, 6);
    const plan = solver.solve(compile(ahead()).segments[0]!, { noAsk: true })!;
    const lanes = new Set<number>();
    for (let i = 0; i < 120 * 20; i++) {
      d.stepOne();
      const ff = d.snap.follower;
      if (ff.leaderS === null || ff.leaderS > compile(ahead()).segments[0]!.s1 - 1) break;
      lanes.add(ff.leaderLane!);
      expect(ff.leaderLane).toBe(plan.laneAt(ff.leaderS));
    }
    expect(lanes.size).toBeGreaterThan(1);
  });
  it('稳度 3 / 2 / 1 / 0 → 3 / 6 / 9 / 12 m，300 ms 滑变，永远不比 3 m 更近', () => {
    expect([3, 2, 1, 0].map((s) => AHEAD_DISTANCE[s])).toEqual([3, 6, 9, 12]);
    const d = new Driver(chapter([runSeg({ follower: { mode: 'ahead', steady: 3 }, items: [{ at: 20, lane: 0, kind: 'bag' }, { at: 30, lane: 0, kind: 'bin' }] })]));
    d.until(() => d.of('hit').length === 1, 120 * 10);
    d.step(Math.round(0.15 / TICK_DT));
    const mid = d.snap.follower.distance;
    expect(mid).toBeGreaterThan(3); expect(mid).toBeLessThan(6);
    d.step(Math.round(0.2 / TICK_DT));
    expect(d.snap.follower.distance).toBeCloseTo(6, 6);
    d.until(() => d.of('hit').length === 2 || d.of('fall').length > 0, 120 * 10);
    d.step(60);
    expect(d.snap.follower.distance).toBeCloseTo(12, 6);   // 稳度 0
    for (let i = 0; i < 400; i++) { d.stepOne(); if (d.snap.follower.leaderS !== null) expect(d.snap.follower.leaderS - d.snap.player.s).toBeGreaterThanOrEqual(LEADER_MIN - 1e-9); }
  });
  it('recede：渐渐走远；重来时按检查点之前的 leader 事件恢复', () => {
    const d = new Driver(ahead({ checkpoints: [100] }));
    d.sim.setAutopilot('perfect');
    d.until(() => d.snap.player.beat >= 152, 120 * 60);
    const d0 = d.snap.follower.distance;
    d.step(120);
    expect(d.snap.follower.distance - d0).toBeCloseTo(RECEDE_SPEED, 1);
    d.sim.goto('s1', 100);
    d.step(5);
    expect(d.snap.follower.leaderS).not.toBeNull();
    expect(d.snap.follower.distance).toBeCloseTo(3, 6);
  });
  it('ahead 的触地提前 0.25 拍（相位差为负），从前方传来', () => {
    const d = new Driver(chapter([runSeg({ cadence: 5, follower: { mode: 'ahead', steady: 3 } })]));
    d.step(240);
    const f = d.of('followerContact');
    expect(f.length).toBeGreaterThan(10);
    expect(f[0]!.data.lagBeats).toBeCloseTo(-0.25, 6);
    expect(f[0]!.data.from).toBe('front');
  });
});

describe('追随者模式、静音、翻转、端盘', () => {
  it('pressure：上限 2；影子的距离 = 0.5 + 稳度 × 0.75（稳度 2 = 2 m）；lagOverride 1 拍', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'pressure', steady: 2, hud: 'shadow', voice: 'none' } })]));
    d.step(10);
    expect(d.snap.player.steadyMax).toBe(2);
    expect(d.snap.follower.distance).toBeCloseTo(2, 6);
    expect(d.snap.follower.hud).toBe('shadow');
    const e = new Driver(chapter([runSeg({ follower: { mode: 'behind', lagOverride: 1 } })]));
    e.step(10);
    expect(e.snap.follower.lagBeats).toBe(1);
  });
  it('synced：满稳度与你同拍，稳度越低越散', () => {
    const d = new Driver(chapter([runSeg({ follower: { mode: 'synced', steady: 3 }, items: [{ at: 20, lane: 0, kind: 'bag' }] })]));
    d.step(10);
    expect(d.snap.follower.lagBeats).toBe(0);
    d.until(() => d.of('hit').length === 1, 120 * 10);
    d.step(60);
    expect(d.snap.follower.lagBeats).toBeCloseTo(0.12, 6);
  });
  it('hush（按拍）置 hush 标志；flip 置 flip 标志并在重来时按事件恢复', () => {
    const d = new Driver(chapter([runSeg({ cadence: 5, checkpoints: [30], events: [{ at: 10, type: 'hush', beats: 10 }, { at: 20, type: 'flip', on: true }] })]));
    d.until(() => d.snap.player.beat >= 11, 1200);
    expect(d.snap.hush).toBe(true);
    d.until(() => d.snap.player.beat >= 21, 1200);
    expect(d.snap.hush).toBe(false);
    expect(d.snap.flip).toBe(true);
    d.until(() => d.snap.player.beat >= 31, 1200);
    d.sim.retry();
    expect(d.snap.flip).toBe(true);
  });
  it('端盘：不能撑跃，carrying = tray；2 s 内换道 3 次晃出汤汁', () => {
    const d = new Driver(chapter([runSeg({ controls: { jump: false } })]));
    d.step(20);
    expect(d.snap.player.carrying).toBe('tray');
    d.tap('up'); d.step(5);
    expect(d.snap.player.mode).not.toBe('air');
    d.tap('left'); d.step(40); d.tap('right'); d.step(40); d.tap('right'); d.step(5);
    expect(d.of('cue').map((c) => c.data.body)).toContainEqual({ type: 'sfx', sfx: 'soupSpill' });
  });
  it('步态：每拍恰好一次掌根（整数拍附近不重复），三段子事件齐全', () => {
    for (const cad of [4.4, 4.8, 5.0, 6.0]) {
      const d = new Driver(chapter([runSeg({ cadence: cad, beats: 400 })]));
      d.step(120 * 20);
      const heel = d.of('contact').filter((c) => c.data.part === 'heel').length;
      expect(heel, `cadence ${cad}`).toBe(Math.floor(d.snap.player.beat + 1e-9));
      expect(d.of('contact').filter((c) => c.data.part === 'knuckle').length).toBeGreaterThanOrEqual(heel - 1);
    }
  });
  it('机制章：减速、停拍里的自动爬行、段中换挡都在快照里体现', () => {
    const d = new Driver(MECH_RUN, { segment: 'm-5', beat: 0 });
    d.until(() => d.snap.player.mode === 'stop', 120 * 20);
    d.step(2);
    expect(d.snap.player.speed).toBe(0);
    d.until(() => d.snap.player.speed > 0 && d.snap.player.mode === 'stop', 120 * 5);
    expect(d.snap.player.speed).toBeCloseTo(2, 6);             // autoCrawl
    const e = new Driver(MECH_RUN, { segment: 'm-3', beat: 96 });
    e.until(() => e.snap.player.beat >= 101, 120 * 10);
    expect(e.snap.player.cadence).toBeCloseTo(5.4, 1);
  });
});
