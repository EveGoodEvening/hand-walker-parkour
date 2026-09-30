// tests/unit/npc/behaviors.test.ts —— NPC 行为的纯函数（DESIGN.md §5.7 行为表）。
import { describe, expect, it } from 'vitest';
import {
  GAZE, GAZE_TOTAL, PART, SHIFT, SILENCE, WALK, clapClosed, gazeAmount, gazeSince, partOffset, shiftBlend, silenceClock, silenceLevel,
  stretchActive, stretchVisual, walkPose,
} from '../../../src/render/npc/behaviors';
import { obstacleState } from '../../../src/render/npc/simBridge';
import type { CompiledObstacle } from '../../../src/levels/schema';

const DEG = Math.PI / 180;

describe('turnShoes：鞋尖 0.4 s 转向玩家，停 0.5 s，再转回（§5.7）', () => {
  it('时间轴', () => {
    expect(GAZE).toEqual({ radius: 3, turn: 0.4, hold: 0.5, back: 0.4 });
    expect(gazeAmount(-0.01)).toBe(0);
    expect(gazeAmount(0)).toBe(0);
    expect(gazeAmount(0.2)).toBeCloseTo(0.5, 5);
    expect(gazeAmount(0.4)).toBe(1);
    expect(gazeAmount(0.85)).toBe(1);
    expect(gazeAmount(0.9 + 0.2)).toBeCloseTo(0.5, 5);
    expect(gazeAmount(GAZE_TOTAL)).toBe(0);
    expect(gazeAmount(5)).toBe(0);
  });
  it('进入 3 m 的时刻按距离和速度倒推（test 模式下隔很多 tick 才渲染一帧也对）', () => {
    expect(gazeSince(3.5, 0, 5)).toBe(-1);            // 还没进入
    expect(gazeSince(3, 0, 5)).toBeCloseTo(0, 6);
    expect(gazeSince(2, 0, 5)).toBeCloseTo(0.2, 6);   // 1 m 以前 ÷ 5 m/s
    expect(gazeSince(1, 1.8, 5)).toBeCloseTo((Math.sqrt(9 - 1.8 * 1.8) - 1) / 5, 6);
    expect(gazeSince(0, 3.2, 5)).toBe(-1);            // 横向 3.2 m：永远在 3 m 以外
  });
});

describe('stretch：伸进过道的脚只按自己的节律（§5.7、D11；WP6 验收 3）', () => {
  const foot = (period: number, phase: number, outFrac: number): CompiledObstacle => ({
    id: 5, kind: 'footOut', cls: 'low', archetype: 'footOut', lanes: [0], beat: 10, s0: 10, s1: 10.3, y0: 0, y1: 0.16, halfW: 0.3,
    behavior: { type: 'stretch', period, phase, outFrac }, npc: true, params: {},
  });
  it('碰撞状态与 sim/Track.ts 完全相同，而且与玩家拍号无关', () => {
    const o = foot(2.4, 0.3, 0.5);
    const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
    for (let t = 0; t < 10; t += 1 / 120) {
      const a = obstacleState(o, t, 0, st).active;
      expect(obstacleState(o, t, 999, st).active).toBe(a);
      expect(obstacleState(o, t, -1, st).active).toBe(a);
      expect(stretchActive(t, 2.4, 0.3, 0.5)).toBe(a);
    }
  });
  it('画面包住碰撞：碰撞生效时画面一定完全伸出；伸出过渡在生效之前，收回过渡在结束之后', () => {
    for (const [P, ph, f] of [[2.4, 0.3, 0.5], [1.8, 0, 0.3], [3, 0.77, 0.8], [0.6, 0.1, 0.5]] as const) {
      let sawPartial = false;
      for (let t = 0; t < 12; t += 1 / 240) {
        const v = stretchVisual(t, P, ph, f);
        expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
        if (stretchActive(t, P, ph, f)) expect(v).toBe(1);
        if (v > 0 && v < 1) sawPartial = true;
      }
      expect(sawPartial).toBe(true);
    }
  });
});

describe('walk / idle / 让一下 / 人墙移动 / 安静的一秒 / 鼓掌', () => {
  it('walk：腿绕髋摆动 ±22°，膝盖屈 0–35°（外加 3° 的放松）', () => {
    const w = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, bob: 0 };
    let maxHip = 0, maxKnee = 0, minKnee = 9;
    for (let d = 0; d < 5; d += 0.01) {
      walkPose(d, w);
      maxHip = Math.max(maxHip, Math.abs(w.hipL), Math.abs(w.hipR));
      maxKnee = Math.max(maxKnee, w.kneeL, w.kneeR); minKnee = Math.min(minKnee, w.kneeL, w.kneeR);
      expect(w.hipL).toBeCloseTo(-w.hipR, 9);
    }
    expect(maxHip).toBeCloseTo(WALK.hipAmp, 2);
    expect(maxHip).toBeCloseTo(22 * DEG, 2);
    expect(maxKnee).toBeCloseTo(38 * DEG, 2);
    expect(minKnee).toBeCloseTo(3 * DEG, 2);
  });
  it('让一下：0.5 s 后开始，横移 0.6 m', () => {
    expect(PART).toEqual({ delay: 0.5, move: 0.35, dist: 0.6 });
    expect(partOffset(0)).toBe(0);
    expect(partOffset(0.49)).toBe(0);
    expect(partOffset(0.5 + 0.35)).toBeCloseTo(0.6, 9);
    expect(partOffset(3)).toBeCloseTo(0.6, 9);
  });
  it('人墙移动：1.2 s 前鞋尖先转，平移以碰撞切换时刻为中心', () => {
    expect(SHIFT.warn).toBe(1.2);
    expect(shiftBlend(-1.25, 0).turn).toBe(0);
    expect(shiftBlend(-0.8, 0).turn).toBe(1);
    expect(shiftBlend(-0.8, 0).move).toBe(0);
    expect(shiftBlend(-0.25, 0).move).toBe(0);
    expect(shiftBlend(0.15, 0).move).toBe(1);
    expect(shiftBlend(2, 0).turn).toBe(0);
  });
  it('安静的一秒：静止 1 s（动画时钟不走），再用 0.6 s 恢复', () => {
    expect(SILENCE).toEqual({ hold: 1.0, recover: 0.6 });
    const s = [10];
    expect(silenceClock(9, s)).toBe(9);
    expect(silenceClock(10.5, s)).toBeCloseTo(10, 9);
    expect(silenceClock(11, s)).toBeCloseTo(10, 9);
    expect(silenceClock(11.6, s)).toBeCloseTo(11.6 - 1 - 0.3, 9);
    expect(silenceClock(20, s)).toBeCloseTo(20 - 1.3, 9);
    // 单调不减
    let last = -Infinity;
    for (let t = 8; t < 14; t += 0.01) { const c = silenceClock(t, [9, 9.5, 12]); expect(c).toBeGreaterThanOrEqual(last - 1e-9); last = c; }
    expect(silenceLevel(10.5, s)).toBe(1);
    expect(silenceLevel(11.3, s)).toBeCloseTo(0.5, 6);
    expect(silenceLevel(12, s)).toBe(0);
  });
  it('鼓掌：约每秒 3 下，开合交替', () => {
    let changes = 0, prev = clapClosed(0, 0.2);
    for (let t = 0; t < 2; t += 1 / 240) { const c = clapClosed(t, 0.2); if (c !== prev) changes++; prev = c; }
    expect(changes / 2 / 2).toBeGreaterThan(2.5);
    expect(changes / 2 / 2).toBeLessThan(3.5);
  });
});
