// tests/unit/npc/behaviors.test.ts —— NPC 行为的纯函数（DESIGN.md §5.7 行为表）。
import { describe, expect, it } from 'vitest';
import {
  GAZE, GAZE_TOTAL, LEG, PART, SHIFT, SILENCE, WALK, clapClosed, gazeAmount, gazeSince, partOffset, shiftBlend, silenceClock, silenceLevel,
  stretchActive, stretchVisual, walkOnGround, walkPose,
} from '../../../src/render/npc/behaviors';
import { treadY } from '../../../src/render/stairTread';
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
      // 两条腿相差半个周期。支撑期髋角不再是正弦（脚要踩住地面），所以不是 hipL = −hipR，而是右腿 = 左腿走过一步之后的姿势
      const r = { hipR: w.hipR, kneeR: w.kneeR };
      walkPose(d + WALK.stepLen, w);
      expect(r.hipR).toBeCloseTo(w.hipL, 9);
      expect(r.kneeR).toBeCloseTo(w.kneeL, 9);
    }
    expect(maxHip).toBeCloseTo(WALK.hipAmp, 2);
    expect(maxHip).toBeCloseTo(22 * DEG, 2);
    expect(maxKnee).toBeCloseTo(38 * DEG, 2);
    expect(minKnee).toBeCloseTo(3 * DEG, 2);
  });
  it('walk：最低的脚踝一直着地（起伏抵掉髋摆），支撑脚不沿 s 滑', () => {
    const w = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, bob: 0 };
    // 与 LegForest 的正向运动学一致：大腿转 −hip，小腿再转 +knee；脚踝相对髋的高度、沿朝向的位置
    const ay = (h: number, k: number) => w.bob - (LEG.thigh * Math.cos(h) + LEG.shin * Math.cos(k - h));
    const az = (d: number, h: number, k: number) => d + LEG.thigh * Math.sin(h) + LEG.shin * Math.sin(h - k);
    const stance: number[] = [];
    for (let d = 0; d < 5; d += 0.004) {
      walkPose(d, w);
      expect(w.bob).toBeLessThanOrEqual(1e-9);
      expect(Math.min(ay(w.hipL, w.kneeL), ay(w.hipR, w.kneeR)) + LEG.thigh + LEG.shin).toBeCloseTo(0, 3);
      // 左腿第二个支撑期 [2.5, 3.5] 步长（一个周期两步；两头各让 1 cm）
      if (d > 2.5 * WALK.stepLen + 0.01 && d < 3.5 * WALK.stepLen - 0.01) stance.push(az(d, w.hipL, w.kneeL));
    }
    expect(stance.length).toBeGreaterThan(100);
    expect(Math.max(...stance) - Math.min(...stance)).toBeLessThan(0.01);
  });
  it('walkOnGround：平地上与 walkPose 完全相同', () => {
    const a = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, bob: 0 }, b = { ...a };
    for (let d = 0; d < 5; d += 0.013) {
      walkPose(d, a);
      expect(walkOnGround(d, 3 + d, 1, () => 0.25, b)).toBe(0.25);
      expect(b).toEqual(a);
    }
  });
  it('walkOnGround：楼梯上身体随步子连续升降，支撑脚踩在自己的踏面上（以前按里程取踏面，每 0.6 m 整个人跳 15 cm）', () => {
    const w = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, bob: 0 };
    const fwd = (h: number, k: number) => LEG.thigh * Math.sin(h) + LEG.shin * Math.sin(h - k);
    const ext = (h: number, k: number) => LEG.thigh * Math.cos(h) + LEG.shin * Math.cos(k - h);
    for (const rise of [0.15, -0.15]) for (const dir of [1, -1]) {
      const seg = { s0: 0, s1: 60, stride: 0.6, floorY: (s: number) => (s / 0.6) * rise, def: { stairs: { dir: 'up', risePerBeat: 0.15 } } } as never;
      const g = (s: number) => treadY(seg, s);
      let prevY = NaN, prevA: number[] | null = null, maxDy = 0, maxDa = 0, stLo = 0, stHi = 0, swingSink = 0, n = 0;
      const plants = new Map<number, [number, number]>();
      for (let d = 0; d < 30; d += 0.004) {
        const sNow = 30 + dir * d;
        const y = walkOnGround(d + 0.37, sNow, dir, g, w);
        if (!Number.isNaN(prevY)) maxDy = Math.max(maxDy, Math.abs(y - prevY));
        prevY = y;
        // 与 LegForest 一致：脚踝高度 = 根 + 髋高 + 起伏 − 竖直伸展；这里把「髋高 − 腿长」（脚踝离地的高度）记作 0
        const legs = [[w.hipL, w.kneeL], [w.hipR, w.kneeR]] as const;
        const A = legs.map(([h, k]) => y + w.bob + LEG.thigh + LEG.shin - ext(h, k));
        const Z = legs.map(([h, k]) => sNow + dir * fwd(h, k));
        if (prevA) for (let j = 0; j < 2; j++) maxDa = Math.max(maxDa, Math.abs((A[j] as number) - (prevA[j] as number)));
        prevA = A;
        // 支撑腿：左腿相位 [L/2, 1.5L)
        const L = WALK.stepLen, q = (d + 0.37) % (2 * L);
        const st = q >= L / 2 && q < 1.5 * L ? 0 : 1;
        const zs = Z[st] as number;
        const gap = (A[st] as number) - g(zs);
        stLo = Math.min(stLo, gap); stHi = Math.max(stHi, gap);
        // 同一个支撑期（两头各让 1 cm）里落脚点的范围
        const v = (d + 0.37 - L / 2) / L, key = Math.floor(v), fr = v - key;
        if (fr * L > 0.01 && (1 - fr) * L > 0.01) { const r = plants.get(key) ?? [zs, zs]; plants.set(key, [Math.min(r[0], zs), Math.max(r[1], zs)]); }
        // 摆动脚（离踏面边沿 3 cm 以上）只许在落脚前的最后一小段里擦过台阶的前沿
        const zw = Z[1 - st] as number;
        const edge = Math.abs((((zw / 0.6) % 1) + 1) % 1 - 0.5) * 0.6;
        if (edge > 0.03) { n++; if ((A[1 - st] as number) < g(zw) - 0.01) swingSink++; }
      }
      // 身体：每 4 mm 最多变 6 mm（台阶高 15 cm 摊在半步里，平滑过渡）
      expect(maxDy).toBeLessThan(0.006);
      // 两只脚踝的高度也是连续的（不在一帧里跳一级）
      expect(maxDa).toBeLessThan(0.03);
      // 支撑脚：踩在落脚处的踏面上，不陷；浮起不超过平地上的 walkPose（支撑期末摆动腿刚离地、竖直更长时，支撑脚跟抬起约 1.6 cm）
      expect(stLo).toBeGreaterThan(-1e-3);
      expect(stHi).toBeLessThan(0.016);
      // 支撑脚不沿 s 滑（IK 只弯膝，脚踝前后位置不变）
      expect(plants.size).toBeGreaterThan(40);
      for (const [a, b] of plants.values()) expect(b - a).toBeLessThan(0.01);
      expect(swingSink / n).toBeLessThan(0.01);
    }
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
