// tests/unit/sim/hooks.test.ts —— 测试钩子与代码取用的台词（评审 U2）：
//   · __game.obstaclesAhead() 按 obstacleState 实时计算（ds 含走动位移、lanes 是此刻覆盖的车道、不参与碰撞的不列出，新增 len / behavior）；
//   · 4-3 梦中按 ↓ 的字取 LINE_HOOKS.dreamDownPress，不再按文字反查。
import { describe, expect, it } from 'vitest';
import type { ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import { LINE_HOOKS } from '../../../src/levels/lines';
import { swingOpen } from '../../../src/sim/Track';
import { Driver } from './fixtures';

const ch = (id: string) => getChapter(id as ChapterId);

describe('obstaclesAhead：实时状态', () => {
  it('1-3 隔间门：门荡进车道时列出（lanes 含右道），贴墙时不参与碰撞、不列出', () => {
    const def = ch('ch1');
    if (!def) return;
    const d = new Driver(def, { segment: '1-3', beat: 8 });
    const door = d.sim.segment.obstacles.find((o) => o.kind === 'stallDoor')!;
    const b = door.behavior as { type: 'swing'; period: number; phase: number };
    expect(b.type).toBe('swing');
    let open: number[] | null = null, closed: number[] | null = null;
    for (let i = 0; i < 120 * 3 && (open === null || closed === null); i++) {
      d.stepOne();
      const tSeg = d.sim.segment.timeAt(8) + d.snap.t;
      const a = d.sim.obstaclesAhead(30).find((o) => o.id === door.id);
      const amount = swingOpen(b.period, b.phase, tSeg);
      if (amount > 0.6 && open === null) open = a?.lanes ?? [];
      if (amount < 0.4 && closed === null) closed = a?.lanes ?? [];
    }
    expect(open).toEqual([1]);
    expect(closed).toEqual([]);
  });
  it('走动的人：ds 的变化 = −(玩家速度 − 他的速度) × Δt（2-2 同向走、2-4 迎面走）；静止障碍按玩家速度减小', () => {
    const def = ch('ch2');
    if (!def) return;
    for (const [seg, beat] of [['2-2', 30], ['2-4', 4]] as Array<[string, number]>) {
      const d = new Driver(def, { segment: seg, beat });
      const walker = d.sim.segment.obstacles.find((o) => o.behavior.type === 'walk')!;
      const v = (walker.behavior as { type: 'walk'; speed: number }).speed;
      d.step(12);
      const pick = (stId?: number) => {
        const list = d.sim.obstaclesAhead(60);
        const w = list.find((o) => o.id === walker.id)!;
        const st = list.find((o) => (stId === undefined ? o.behavior.type === 'static' && o.ds > 15 : o.id === stId))!;
        return { w: w.ds, st: st.ds, stId: st.id, s: d.snap.player.s, t: d.snap.t };
      };
      const p0 = pick();
      d.step(60);
      const p1 = pick(p0.stId);
      const dt = p1.t - p0.t, ds = p1.s - p0.s;
      expect(p1.st - p0.st).toBeCloseTo(-ds, 6);
      expect(p1.w - p0.w).toBeCloseTo(-ds + v * dt, 6);
      // 迎面走来的人（v < 0）比静止障碍逼近得快，同向走的人（v > 0）慢
      if (v < 0) expect(p1.w - p0.w).toBeLessThan(p1.st - p0.st); else expect(p1.w - p0.w).toBeGreaterThan(p1.st - p0.st);
      const w = d.sim.obstaclesAhead(60).find((o) => o.id === walker.id)!;
      expect(w.behavior).toEqual(walker.behavior);
    }
  });
  it('1-2 储物柜：len ≈ 14 m；旧字段（id、kind、cls、lanes、ds、beat）都在', () => {
    const def = ch('ch1');
    if (!def) return;
    const d = new Driver(def, { segment: '1-2', beat: 90 });
    d.step(2);
    const lockers = d.sim.obstaclesAhead(40).filter((o) => o.kind === 'locker' && o.len > 5);
    expect(lockers.length).toBeGreaterThan(0);
    for (const l of lockers) {
      expect(Math.abs(l.len - 14)).toBeLessThan(0.5);
      expect(Object.keys(l)).toEqual(expect.arrayContaining(['id', 'kind', 'cls', 'lanes', 'ds', 'beat', 'len', 'behavior']));
      expect(l.cls).toBe('block');
    }
  });
});

describe('4-3 梦中站立：按 ↓ 的字', () => {
  it('取 LINE_HOOKS.dreamDownPress，只显示一次', () => {
    const def = ch('ch4');
    if (!def) return;
    const d = new Driver(def, { segment: '4-3', beat: 0 });
    d.step(30);
    d.clear();
    d.press('down'); d.step(3); d.release('down'); d.step(3);
    d.press('down'); d.step(3); d.release('down'); d.step(3);
    const lines = d.of('cue').filter((e) => e.data.body.type === 'text' && e.data.body.line === LINE_HOOKS.dreamDownPress);
    expect(lines.length).toBe(1);
  });
});
