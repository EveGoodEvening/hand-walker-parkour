// tests/unit/sim/stand.test.ts —— 站立段与静场（DESIGN.md §3「站起来」、§4.4 4-3、§4.5 5-8、§8.5 StillInput、§8.10 WP1 验收 2）。
// 七步：1000 次随机输入，全部在第 7 步摔倒，不早也不晚；第 2 步必定撑地一次；θ 只影响画面。
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../../src/core/constants';
import { createRng } from '../../../src/core/rng';
import type { Action } from '../../../src/core/types';
import { DREAM_RISE_SEC } from '../../../src/sim/Stand';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, DREAM, Driver, MECH_STILL, runSeg, SEVEN, stillSeg } from './fixtures';

const ST = TUNING.stand;
const sevenCh = () => chapter([SEVEN, runSeg({ id: 'after', beats: 20 })]);

describe('七步（5-8）', () => {
  /** 随机输入跑完七步，返回摔倒那一步、撑地的步、各步相对站起的 tick、θ 序列摘要。 */
  function randomRun(seed: number) {
    const r = createRng(seed, 'seven-input');
    const d = new Driver(sevenCh(), undefined, seed);
    const keys: Action[] = ['left', 'right', 'up', 'down'];
    let risenTick = -1;
    let thetaSum = 0;
    for (let i = 0; i < 120 * 40 && d.snap.segment === 'seven'; i++) {
      // 随机按键 / 松开（包括在起身时乱松 ↑）
      if (r.next() < 0.08) { const k = r.pick(keys); if (d.isHeld(k)) d.release(k); else d.press(k); }
      const out = d.stepOne();
      for (const e of out) if (e.type === 'stand' && e.data.phase === 'risen') risenTick = e.tick;
      thetaSum += Math.abs(d.snap.player.stand?.theta ?? 0);
    }
    const st = d.of('stand');
    return {
      falls: st.filter((e) => e.data.phase === 'fall').map((e) => e.data.step),
      plants: st.filter((e) => e.data.phase === 'plant').map((e) => e.data.step),
      steps: st.filter((e) => e.data.phase === 'step').map((e) => e.data.step),
      stepTicks: st.filter((e) => e.data.phase === 'step' || e.data.phase === 'fall').map((e) => e.tick - risenTick),
      gameFalls: d.of('fall').length, statFalls: d.snap.stats.falls, reached: d.snap.segment, thetaSum,
    };
  }
  it('1000 次随机输入：全部在第 7 步摔倒；第 2 步必定撑地一次；步点的时刻与输入无关（θ 只影响画面）', () => {
    let ref: number[] | null = null;
    const thetas = new Set<number>();
    for (let seed = 1; seed <= 1000; seed++) {
      const r = randomRun(seed);
      expect(r.falls, `seed ${seed}`).toEqual([7]);
      expect(r.plants, `seed ${seed}`).toEqual([2]);
      expect(r.steps, `seed ${seed}`).toEqual([1, 2, 3, 4, 5, 6]);
      expect(r.gameFalls).toBe(0);                 // 不是失败：没有 fall 事件，也不计摔倒
      expect(r.statFalls).toBe(0);
      expect(r.reached).toBe('after');
      if (!ref) ref = r.stepTicks; else expect(r.stepTicks, `seed ${seed}`).toEqual(ref);
      thetas.add(Math.round(r.thetaSum * 1000));
    }
    expect(thetas.size).toBeGreaterThan(100);        // 输入确实改变了晃动（画面）
  });
  it('步点：每 0.9 s 一步；第 2 步之后撑地 0.6 s', () => {
    const r = randomRun(1);
    const gaps = r.stepTicks.map((t, i) => (i ? t - (r.stepTicks[i - 1] as number) : t)).map((n) => n * TICK_DT);
    expect(gaps[0]).toBeCloseTo(ST.stepPeriod, 1);
    expect(gaps[1]).toBeCloseTo(ST.stepPeriod, 1);
    expect(gaps[2]).toBeCloseTo(ST.stepPeriod + 0.6, 1);
    for (const g of gaps.slice(3)) expect(g).toBeCloseTo(ST.stepPeriod, 1);
  });
  it('起身：按住 ↑ 逐秒出字，满 3 s 站起；提前松手沉回去、计时重来（出字也重来）', () => {
    const d = new Driver(sevenCh());
    d.until(() => d.snap.still?.prompt === 'rise', 240);
    expect(d.snap.player.stand?.phase).toBe('wait');
    d.press('up');
    d.step(Math.round(2.5 / TICK_DT));
    expect(d.snap.player.stand?.phase).toBe('rising');
    expect(d.snap.player.mode).toBe('rise');
    d.release('up');
    d.step(2);
    expect(d.snap.player.stand?.phase).toBe('wait');
    expect(d.snap.player.stand?.held).toBe(0);
    d.press('up');
    const n = d.until(() => d.snap.player.stand?.phase === 'walking', 120 * 5);
    expect(n * TICK_DT).toBeCloseTo(3, 1);
    const lines = d.of('cue').filter((c) => c.data.body.type === 'text').map((c) => (c.data.body as { line: string }).line);
    expect(lines.slice(0, 5)).toEqual(['c1.note', 'c1.duty', 'c1.note', 'c1.duty', 'c1.holdIt']);
    expect(d.of('stand').map((e) => e.data.phase).slice(0, 3)).toEqual(['rise', 'rise', 'risen']);
    expect(d.snap.still?.prompt).toBe('balance');
    const pr = d.of('prompt').at(-1)!.data;
    expect(pr.hint).toBe('balance');
  });
  it('8 s 不按再提示一次；12 s 后腿自己站起来', () => {
    const d = new Driver(sevenCh());
    d.until(() => d.snap.still?.prompt === 'rise', 240);
    const before = d.of('prompt').length;
    d.step(Math.round(8.1 / TICK_DT));
    expect(d.of('prompt').length).toBe(before + 1);            // 再提示一次
    expect(d.of('prompt').at(-1)!.data.hint).toBe('rise');
    d.until(() => d.snap.player.stand?.phase === 'walking', 120 * 6);
    expect(d.snap.still!.t).toBeCloseTo(SEVEN.input!.at, 1);  // 等待不计入时间线
  });
  it('按步事件（atStep / delay）在对应的步触发；onDone 在站起之后', () => {
    const d = new Driver(sevenCh());
    d.sim.setAutopilot('perfect');
    d.until(() => d.snap.segment === 'after', 120 * 30);
    const beats = d.snap.beatsFired;
    expect(beats).toEqual(['rightFootMoved', 'almostFell', 'seventhFall', 'afterFall']);
    const tick = (id: string) => d.of('beat').find((b) => b.data.id === id)!.tick;
    const fall = d.of('stand').find((e) => e.data.phase === 'fall')!.tick;
    expect(tick('seventhFall')).toBeGreaterThanOrEqual(fall);
    expect((tick('afterFall') - fall) * TICK_DT).toBeCloseTo(1.6, 1);
    expect(d.of('stand').find((e) => e.data.phase === 'fall')!.data.step).toBe(7);
  });
  it('摔倒后模式是 down（不是失败的 fall）', () => {
    const d = new Driver(sevenCh());
    d.sim.setAutopilot('perfect');
    d.until(() => d.of('stand').some((e) => e.data.phase === 'fall'), 120 * 30);
    d.step(2);
    expect(d.snap.player.mode).toBe('down');
    expect(d.snap.player.stand?.phase).toBe('fallen');
  });
});

describe('梦中站立（4-3）', () => {
  const dreamCh = () => chapter([DREAM, runSeg({ id: 'after', beats: 20 })]);
  it('自动起身 1.2 s，零扰动，走三步后站住；段落照 duration 结束', () => {
    const d = new Driver(dreamCh());
    d.until(() => d.snap.segment === 'after', 120 * 20);
    const st = d.of('stand').map((e) => `${e.data.phase}${e.data.step ?? ''}`);
    expect(st).toEqual(['rise', 'risen', 'step1', 'step2', 'step3']);
    expect(d.of('stand').filter((e) => e.data.phase === 'step').every((e) => e.data.theta === 0)).toBe(true);
    const risen = d.of('stand').find((e) => e.data.phase === 'risen')!.tick;
    expect(risen * TICK_DT).toBeCloseTo(DREAM_RISE_SEC, 1);
    expect(d.snap.t).toBeCloseTo(DREAM.duration, 1);
  });
  it('← → 只挪动重心（0.6 m/s，限制在三条车道内）；↓ 没有用', () => {
    const d = new Driver(dreamCh());
    d.step(Math.round(1.5 / TICK_DT));
    d.press('right');
    d.step(120);
    expect(d.snap.player.x).toBeCloseTo(ST.dreamSidestep, 1);
    d.step(600);
    expect(d.snap.player.x).toBeCloseTo(1.1, 6);
    d.release('right');
    d.tap('down');
    d.step(10);
    expect(d.snap.player.mode).toBe('stand');
    expect(d.of('hit').length).toBe(0);
  });
});

describe('静场输入（§8.5 StillInput）', () => {
  it('hold + progress：按住逐秒出字，松手清零后重新出；满 2.5 s 完成，onDone 相对完成时刻', () => {
    const d = new Driver(MECH_STILL);
    d.until(() => d.snap.still?.prompt === 'hold', 240);
    d.press('down'); d.step(Math.round(1.5 / TICK_DT)); d.release('down'); d.step(2);
    d.press('down');
    const n = d.until(() => d.snap.still?.prompt !== 'hold', 120 * 5);
    expect(n * TICK_DT).toBeCloseTo(2.5, 1);
    const lines = d.of('cue').filter((c) => c.data.body.type === 'text').map((c) => (c.data.body as { line: string }).line);
    expect(lines).toEqual(['c1.note', 'c1.duty', 'c1.duty', 'c1.footMoved']);
    d.until(() => d.snap.beatsFired.includes('qb'), 120);
    expect(d.snap.beatsFired).toContain('qb');
  });
  it('tap：只认 ↓；any：任意游玩键；taps3：三下，每下一个触地子事件（床单上）', () => {
    const d = new Driver(MECH_STILL, { segment: 'q-tap', beat: 0 });
    d.until(() => d.snap.still?.prompt === 'kneel', 240);
    d.tap('left'); d.step(5);
    expect(d.snap.still?.prompt).toBe('kneel');
    d.tap('down'); d.step(2);
    expect(d.snap.still?.prompt).toBe(null);
    d.until(() => d.snap.still?.prompt === 'taps3', 120 * 5);
    d.clear();
    d.tap('down'); d.step(5); d.tap('down'); d.step(5);
    expect(d.snap.still?.prompt).toBe('taps3');
    d.tap('down'); d.step(2);
    expect(d.snap.still?.prompt).toBe(null);
    expect(d.of('contact').map((c) => `${c.data.part}:${c.data.surface}`)).toEqual(['heel:sheet', 'knuckle:sheet', 'pad:sheet']);
    d.until(() => d.snap.still?.prompt === 'anyKey', 120 * 5);
    d.tap('left'); d.step(2);
    expect(d.snap.still?.prompt).toBe(null);
  });
  it('超时自动完成，不罚', () => {
    const d = new Driver(chapter([stillSeg({ duration: 2, input: { at: 0.5, hint: 'anyKey', mode: 'any', timeout: 3 } }), runSeg({ id: 'after', beats: 10 })]));
    d.until(() => d.snap.segment === 'after', 120 * 10);
    expect(d.snap.t).toBeCloseTo(2 + 3, 1);
    expect(d.snap.stats.falls).toBe(0);
  });
  it('跳过：剩下的事件（含 onDone 与站立段的按步事件）立即全部触发', () => {
    const d = new Driver(sevenCh());
    d.step(10);
    d.sim.skipStill();
    expect(d.snap.segment).toBe('after');
    expect([...d.snap.beatsFired].sort()).toEqual(['afterFall', 'almostFell', 'rightFootMoved', 'seventhFall']);
  });
});
