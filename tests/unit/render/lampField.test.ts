// tests/unit/render/lampField.test.ts —— LampField（DESIGN.md §5.3，WP3 验收 4、5）。
import { describe, expect, it } from 'vitest';
import type { LampSpec } from '../../../src/core/contracts';
import {
  FLICKER_CELL, LAMP_FADE, LampField, RING_LIFE, SOUND_HOLD, SOUND_REACH, flickerLevel, reducedFlickerLevel,
} from '../../../src/render/lampField';

const tubes = (from: number, to: number, every = 2): LampSpec[] => {
  const out: LampSpec[] = [];
  for (let s = from; s <= to; s += every) out.push({ s, x: 0, y: 3, kind: 'tube', flickerable: true });
  return out;
};

/** 按 1 ms 采样，统计任意 1 s 窗口内「亮 → 灭」的次数最大值。 */
function maxDipsPerSecond(level: (t: number) => number, seconds: number): { max: number; total: number } {
  const dt = 0.001;
  const dips: number[] = [];
  let prevOn = level(0) > 0.9;
  for (let t = dt; t < seconds; t += dt) {
    const on = level(t) > 0.9;
    if (prevOn && !on) dips.push(t);
    prevOn = on;
  }
  let max = 0;
  for (let i = 0, j = 0; i < dips.length; i++) {
    while ((dips[i] as number) - (dips[j] as number) >= 1) j++;
    max = Math.max(max, i - j + 1);
  }
  return { max, total: dips.length };
}

describe('闪烁（§5.3：每盏灯每秒亮灭 ≤ 3 次）', () => {
  it('任意 1 s 窗口内熄灭 ≤ 3 次（300 盏灯 × 60 s）', () => {
    let worst = 0, total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = maxDipsPerSecond((t) => flickerLevel(t, seed * 2654435761), 60);
      worst = Math.max(worst, r.max);
      total += r.total;
    }
    expect(worst).toBeLessThanOrEqual(3);
    // 真的在闪：平均每盏灯每秒至少 0.5 次
    expect(total / (300 * 60)).toBeGreaterThan(0.5);
    expect(FLICKER_CELL).toBeGreaterThanOrEqual(1 / 3);
  });

  it('熄灭时是一次短暂的暗（0.05–0.16 s，亮度 0.05–0.3）', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let run = 0, longest = 0;
      for (let t = 0; t < 20; t += 0.001) {
        const v = flickerLevel(t, seed);
        expect(v === 1 || (v >= 0.05 && v <= 0.31)).toBe(true);
        run = v < 1 ? run + 0.001 : 0;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThanOrEqual(0.17);
    }
  });

  it('「减少闪烁」：0.5 Hz 平滑明暗，最低 0.4', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let min = 1, max = 0, prev = reducedFlickerLevel(0, seed), maxStep = 0;
      for (let t = 0.001; t < 10; t += 0.001) {
        const v = reducedFlickerLevel(t, seed);
        min = Math.min(min, v); max = Math.max(max, v); maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v;
        expect(reducedFlickerLevel(t + 2, seed)).toBeCloseTo(v, 6);     // 周期 2 s = 0.5 Hz
      }
      expect(min).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(max).toBeLessThanOrEqual(1 + 1e-9);
      expect(maxStep).toBeLessThan(0.002);                                // 平滑，没有跳变
    }
  });

  it('LampField 里闪烁的灯：电平也满足 ≤ 3 次 / 秒；减少闪烁时电平 ≥ 0.4', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 60));
    lf.now = 0;
    lf.op('flicker', 0, 60);
    const [a, b] = lf.range(0, 60);
    expect(b - a).toBe(31);
    for (let i = a; i < b; i++) expect(maxDipsPerSecond((t) => lf.level(i, t), 30).max).toBeLessThanOrEqual(3);
    lf.reducedFlicker = true;
    for (let i = a; i < b; i++) for (let t = 0; t < 10; t += 0.01) expect(lf.level(i, t)).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});

describe('LampField 亮度场', () => {
  it('每 2 m 一盏管灯：灯下与两灯之间都在 0.8–1.0，灯的节拍看得见但不刺眼', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 200));
    lf.update(0, 50, 0);
    const at = (s: number) => lf.field[Math.floor((s - lf.textureBase) / 0.5)] as number;
    for (let s = 30; s < 120; s += 0.25) { expect(at(s)).toBeGreaterThan(0.75); expect(at(s)).toBeLessThan(1.05); }
    expect(at(40.25) - at(41.25)).toBeGreaterThan(0.05);                  // 灯下更亮
    expect(lf.brightnessAt(40)).toBeGreaterThan(0.8);
  });

  it('熄灭 / 点亮：200 ms 渐变；熄灭后亮度落到 lampFloor', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 100));
    lf.floor = 0.15;
    lf.now = 10;
    const before = lf.brightnessAt(50);
    lf.op('out', 30, 70);
    lf.now = 10 + LAMP_FADE / 2;
    const half = lf.brightnessAt(50);
    lf.now = 10 + LAMP_FADE + 0.01;
    const after = lf.brightnessAt(50);
    expect(before).toBeGreaterThan(0.8);
    expect(half).toBeGreaterThan(after); expect(half).toBeLessThan(before);
    expect(after).toBeCloseTo(0.15, 5);
    // 区间外的灯不受影响
    expect(lf.brightnessAt(10)).toBeGreaterThan(0.8);
    lf.op('on', 30, 70);
    lf.now += LAMP_FADE + 0.01;
    expect(lf.brightnessAt(50)).toBeGreaterThan(0.8);
  });

  it('delay：到点才开始渐变', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 40));
    lf.now = 0;
    lf.op('out', 0, 40, { delay: 1 });
    lf.now = 0.9; expect(lf.brightnessAt(20)).toBeGreaterThan(0.8);
    lf.now = 1.3; expect(lf.brightnessAt(20)).toBeLessThan(0.05);
  });

  it('every：每 3 盏闪一盏（3-1「每三盏就有一盏在闪烁」）', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 58));
    lf.now = 0;
    lf.op('flicker', 0, 58, { every: 3 });
    const flick: number[] = [];
    for (let i = 0; i < lf.count; i++) {
      let dips = 0;
      for (let t = 0; t < 30; t += 0.005) if (lf.level(i, t) < 0.9) dips++;
      if (dips > 0) flick.push(i);
    }
    expect(flick).toEqual(Array.from({ length: 10 }, (_, k) => k * 3));
  });

  it('窗不受开关灯影响', () => {
    const lf = new LampField();
    lf.addLamps('a', [{ s: 10, x: -1.5, y: 2, kind: 'window', flickerable: false }]);
    lf.now = 0;
    lf.op('out', 0, 20);
    lf.now = 1;
    expect(lf.level(0)).toBe(1);
  });

  it('声控灯：默认黑；落地 / 拍地点亮前方 8 m 内的灯 4 s；5-2 晚 0.5 s 才亮', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 40, 3));
    lf.now = 0;
    lf.op('sound', 0, 40, { delay: 0.5 });
    lf.now = 0.3;
    expect(lf.brightnessAt(10)).toBeLessThan(0.01);
    lf.soundTrigger(9);
    lf.now = 0.6; expect(lf.brightnessAt(12)).toBeLessThan(0.5);        // 犹豫半拍
    lf.now = 1.0; expect(lf.brightnessAt(12)).toBeGreaterThan(0.6);
    expect(lf.brightnessAt(9 + SOUND_REACH + 4)).toBeLessThan(0.05);     // 8 m 以外不亮
    lf.now = 0.3 + 0.5 + SOUND_HOLD + LAMP_FADE + 0.05;
    expect(lf.brightnessAt(12)).toBeLessThan(0.01);
  });

  it('掌光环：palmRings 区间内每一掌亮一圈，0.9 s 后消失', () => {
    const lf = new LampField();
    lf.floor = 0.15;
    lf.now = 5;
    lf.op('palmRings', 100, 200);
    expect(lf.palmAt(150)).toBe(true);
    expect(lf.palmAt(90)).toBe(false);
    lf.ring(150, 0, 0.9, 1.1);
    expect(lf.brightnessAt(150)).toBeGreaterThan(0.8);
    let rings = 0; lf.forEachRing(() => { rings++; });
    expect(rings).toBe(1);
    lf.now = 5 + RING_LIFE + 0.01;
    expect(lf.brightnessAt(150)).toBeCloseTo(0.15, 5);
    rings = 0; lf.forEachRing(() => { rings++; });
    expect(rings).toBe(0);
  });

  it('静场：整张纹理取常数；重来：所有灯回到常亮', () => {
    const lf = new LampField();
    lf.addLamps('a', tubes(0, 40));
    lf.uniformLevel = 1;
    lf.update(0, 20, -200);
    expect(Array.from(lf.field).every((v) => v === 1)).toBe(true);
    lf.uniformLevel = null;
    lf.now = 0; lf.op('out', 0, 40); lf.now = 1;
    expect(lf.brightnessAt(20)).toBeLessThan(0.05);
    lf.resetStates();
    expect(lf.brightnessAt(20)).toBeGreaterThan(0.8);
  });
});
