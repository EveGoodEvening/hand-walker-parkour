// tests/unit/sim/legs.test.ts —— 腿自主抬起（按住它）与腿偏移（掰正）（DESIGN.md §3、§2.4 twitch / drift、§8.10 WP1 验收 1）。
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../../src/core/constants';
import { TUNING } from '../../../src/sim/tuning';
import { twitchStart, twitchUpdate, type TwitchBody } from '../../../src/sim/Twitch';
import { chapter, Driver, MECH_RUN, runSeg } from './fixtures';

const TW = TUNING.twitch;

describe('腿自主抬起：状态机（纯函数）', () => {
  const body = (): TwitchBody => ({ twPhase: 0, twT: 0, twNeed: 0.25, twHeld: 0, twitch: 0 });
  function run(b: TwitchBody, seconds: number, held: (t: number) => boolean): string[] {
    const out: string[] = [];
    for (let t = 0; t < seconds; t += TICK_DT) { const o = twitchUpdate(b, TICK_DT, held(t)); if (o) out.push(`${o}@${(t + TICK_DT).toFixed(3)}`); }
    return out;
  }
  it('不按：预警 0.6 s → 抬起 1.2 s → 结束；抬起期间碰撞高度标志 = 1', () => {
    const b = body(); twitchStart(b);
    const ev = run(b, 2.5, () => false);
    expect(ev.map((e) => e.split('@')[0])).toEqual(['rise', 'end']);
    expect(Number(ev[0]!.split('@')[1])).toBeCloseTo(TW.warn, 2);
    expect(Number(ev[1]!.split('@')[1])).toBeCloseTo(TW.warn + TW.rise, 2);
  });
  it('预警里连续按住 ↓ 满 0.25 s：压住，腿根本不抬', () => {
    const b = body(); twitchStart(b, 0.25);
    const ev = run(b, 2.5, (t) => t >= 0.25);          // 反应 250 ms 后按住
    expect(ev.map((e) => e.split('@')[0])).toEqual(['suppressed']);
    expect(Math.abs(Number(ev[0]!.split('@')[1]) - 0.5)).toBeLessThanOrEqual(TICK_DT + 1e-9);
  });
  it('必须连续按住：按 0.2 s 松开再按不算累计', () => {
    const b = body(); twitchStart(b, 0.25);
    const ev = run(b, 2.5, (t) => (t >= 0.05 && t < 0.25) || (t >= 0.3 && t < 0.5));
    expect(ev.map((e) => e.split('@')[0])).toEqual(['rise', 'end']);
  });
  it('第五章 0.5 s：按 0.3 s 不够', () => {
    const b = body(); twitchStart(b, 0.5);
    expect(run(b, 2.5, (t) => t < 0.3).map((e) => e.split('@')[0])).toEqual(['rise', 'end']);
    const c = body(); twitchStart(c, 0.5);
    expect(run(c, 2.5, (t) => t >= 0.05).map((e) => e.split('@')[0])).toEqual(['suppressed']);
  });
  it('晚了（已经抬起）再按住：腿被按回去，抬起提前结束', () => {
    const b = body(); twitchStart(b, 0.25);
    const ev = run(b, 2.5, (t) => t >= 0.8);
    expect(ev.map((e) => e.split('@')[0])).toEqual(['rise', 'suppressed']);
    expect(Math.abs(Number(ev[1]!.split('@')[1]) - 1.05)).toBeLessThanOrEqual(TICK_DT + 1e-9);
  });
});

describe('腿自主抬起：模拟里', () => {
  const seg = (o = {}) => chapter([runSeg({ cadence: 4.8, events: [{ at: 20, type: 'twitch', hold: 0.25, say: 'c1.holdIt' }], ...o })]);
  it('抬起期间碰撞盒高 0.85 m、速度 ×0.85、模式 halfStand；事件 warn → rise → end', () => {
    const d = new Driver(seg());
    d.until(() => d.of('twitch').some((e) => e.data.phase === 'rise'), 120 * 10);
    d.step(24);
    const p = d.snap.player;
    expect(p.hitbox.y1 - p.hitbox.y0).toBeCloseTo(0.85, 6);
    expect(p.speed).toBeCloseTo(4.8 * TW.speedMul, 6);
    expect(p.mode).toBe('halfStand');
    expect(p.twitch).toBeGreaterThan(0.5);
    d.until(() => d.of('twitch').some((e) => e.data.phase === 'end'), 120 * 5);
    d.step(2);
    expect(d.snap.player.hitbox.y1).toBeCloseTo(0.55, 6);
    expect(d.of('twitch').map((e) => e.data.phase)).toEqual(['warn', 'rise', 'end']);
  });
  it('按住 ↓ 压住：发 suppressed + action hold；第一次压住时低语 say，第二次不再说', () => {
    const def = chapter([runSeg({ cadence: 4.8, events: [
      { at: 20, type: 'twitch', hold: 0.25, say: 'c1.holdIt' }, { at: 40, type: 'twitch', hold: 0.25, say: 'c1.holdIt' },
    ] })]);
    const d = new Driver(def);
    for (const at of [20, 40]) {
      d.until(() => d.snap.player.beat >= at + 1, 120 * 20);     // 约 0.2 s 后
      d.press('down');
      d.step(60);
      d.release('down');
    }
    d.step(10);
    expect(d.of('twitch').map((e) => e.data.phase)).toEqual(['warn', 'suppressed', 'warn', 'suppressed']);
    expect(d.of('action').filter((a) => a.data.kind === 'hold').length).toBe(2);
    const says = d.of('cue').filter((c) => c.data.body.type === 'text');
    expect(says.length).toBe(1);
    expect(says[0]!.data.body).toMatchObject({ type: 'text', line: 'c1.holdIt', style: 'whisper' });
  });
  it('第二章式：抬起落在横档前 0.4 s，一次 ↓ 同时完成按住和伏低，0 受击；不按就撞', () => {
    // 4.8 掌/s：twitch @25 → 抬起 5.81 s；横档 @30 接触 6.20 s（差 0.39 s）
    const mk = () => chapter([runSeg({ cadence: 4.8, rows: [[30, 'HHH']], events: [{ at: 25, type: 'twitch', hold: 0.25 }] })]);
    const ok = new Driver(mk());
    ok.until(() => ok.snap.player.beat >= 26.2, 120 * 10);         // 预警开始后约 0.25 s
    ok.press('down');
    ok.until(() => ok.snap.player.beat >= 33, 120 * 10);
    ok.release('down');
    expect(ok.of('twitch').map((e) => e.data.phase)).toEqual(['warn', 'suppressed']);
    expect(ok.of('hit').length).toBe(0);
    const bad = new Driver(mk());
    bad.until(() => bad.snap.player.beat >= 33, 120 * 10);
    expect(bad.of('hit').map((h) => h.data.severity)).toEqual(['crash']);
  });
  it('腿的动作与玩家车道无关：换道不影响相位', () => {
    const a = new Driver(seg()), b = new Driver(seg());
    b.step(30); b.tap('left');
    a.until(() => a.of('twitch').length >= 3, 120 * 10);
    b.until(() => b.of('twitch').length >= 3, 120 * 10);
    expect(a.of('twitch').map((e) => e.tick)).toEqual(b.of('twitch').map((e) => e.tick));
  });
});

describe('腿偏移与掰正（第五章）', () => {
  const mk = (dir: -1 | 1, say?: 'c1.holdIt') => chapter([runSeg({ cadence: 5, events: [say ? { at: 20, type: 'drift', dir, say } : { at: 20, type: 'drift', dir }] })]);
  it('预警 0.6 s（鞋尖偏转到 ±1），之后被迫换到偏移那一侧的车道', () => {
    const d = new Driver(mk(-1));
    d.until(() => d.of('drift').length === 1, 120 * 10);
    const t0 = d.snap.t;
    d.step(36);
    expect(d.snap.player.drift).toBeLessThan(-0.5);
    d.until(() => d.of('drift').some((e) => e.data.phase === 'moved'), 120);
    expect(d.snap.t - t0).toBeCloseTo(TUNING.drift.warn, 1);
    d.step(40);
    expect(d.snap.player.lane).toBe(-1);
    expect(d.of('drift').map((e) => e.data.phase)).toEqual(['warn', 'moved']);
  });
  it('预警期间按反方向：掰正，留在原车道；发 countered + action straighten + say', () => {
    const d = new Driver(mk(-1, 'c1.holdIt'));
    d.until(() => d.of('drift').length === 1, 120 * 10);
    d.step(30);                         // 0.25 s 后
    d.tap('right');
    d.step(80);
    expect(d.snap.player.lane).toBe(0);
    expect(d.of('drift').map((e) => e.data.phase)).toEqual(['warn', 'countered']);
    expect(d.of('action').find((a) => a.data.kind === 'straighten')?.data.dir).toBe(1);
    expect(d.of('action').some((a) => a.data.kind === 'lane')).toBe(false);
    expect(d.of('cue').map((c) => c.data.body)).toContainEqual({ type: 'text', line: 'c1.holdIt' });
  });
  it('预警期间按同方向是普通换道；已经在最边上时被迫换道不动', () => {
    const d = new Driver(mk(-1));
    d.until(() => d.of('drift').length === 1, 120 * 10);
    d.tap('left');
    d.step(100);
    expect(d.snap.player.lane).toBe(-1);
    expect(d.of('drift').map((e) => e.data.phase)).toEqual(['warn', 'moved']);
    expect(d.of('action').filter((a) => a.data.kind === 'lane').length).toBe(1);
  });
  it('预警结束之后再按反方向就是普通换道', () => {
    const d = new Driver(mk(1));
    d.until(() => d.of('drift').some((e) => e.data.phase === 'moved'), 120 * 10);
    d.step(40);
    expect(d.snap.player.lane).toBe(1);
    d.tap('left');
    d.step(40);
    expect(d.snap.player.lane).toBe(0);
  });
});

describe('自动驾驶在机制章里 0 受击（腿自主抬起、腿偏移都在求解器里）', () => {
  it('MECH_RUN 种子 1：0 受击、必备节拍全部触发', () => {
    const d = new Driver(MECH_RUN, undefined, 1);
    d.sim.setAutopilot('perfect');
    d.until(() => d.of('chapter:end').length > 0, 120 * 300);
    expect(d.of('hit')).toEqual([]);
    expect([...d.snap.beatsFired].sort()).toEqual([...MECH_RUN.requiredBeats].sort());
  });
});
