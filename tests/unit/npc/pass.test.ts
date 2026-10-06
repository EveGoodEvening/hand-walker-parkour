// tests/unit/npc/pass.test.ts —— 越过的障碍不在镜头和主角之间停留（U6）。
// 镜头在主角身后 2.35 m 以上；以前越过的障碍要到身后 5 m 才裁掉，约 0.4 s 里在画面下部形成一道横跨全屏的暗条
// （3-4 静音段里整屏被挡）。现在远端 s1 < s − 0.55（碰撞盒后沿之后 0.3 m）之后 0.12 s 内缩为 0；回头时照常画。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, CompiledObstacle } from '../../../src/levels/schema';
import { BEHIND_LOOK, PASS_BEHIND, PASS_FADE, cameraBackness } from '../../../src/render/npc/ObstacleView';
import { ViewDriver, faceBack, makeView } from './helpers';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/** 某个障碍在原型池里的实例（按位置找）：返回最大的缩放（没有实例 = 0）。 */
function scaleOf(view: ReturnType<typeof makeView>['view'], o: CompiledObstacle): number {
  const pool = view.pools.get(o.archetype);
  if (!pool) return 0;
  let best = 0;
  for (let i = 0; i < pool.pool.n; i++) {
    pool.pool.matrixAt(i, _m).decompose(_p, _q, _s);
    if (-_p.z < o.s0 - 0.3 || -_p.z > o.s1 + 0.3) continue;
    best = Math.max(best, _s.x, _s.y, _s.z);
  }
  return best;
}

/** 3-4 的第一个车棚横档（bikeRack，bar），以及一个从它前面开始的快照。 */
function setup() {
  const { view, ctx } = makeView('low');
  const vd = new ViewDriver(view, getChapter('ch3') as ChapterDef, { segment: '3-4', beat: 10 });
  vd.d.sim.setInvincible(true);
  const base = vd.step(1);
  const seg = vd.ch.segments.find((x) => x.def.id === '3-4');
  const rack = seg?.obstacles.find((o) => o.kind === 'bikeRack');
  expect(rack?.cls).toBe('bar');
  return { view, ctx, base, rack: rack as CompiledObstacle };
}

/** 假快照：同一段，玩家在 s，时刻 t，速度 v，回头程度 lookBack。 */
function at(base: SimSnapshot, s: number, t: number, v: number, lookBack = 0): SimSnapshot {
  return { ...base, t, player: { ...base.player, s, speed: v, lookBack } };
}

describe('越过的障碍（U6）', () => {
  it('车棚横档：远端越过 s − 0.55 之后 0.12 s 内缩为 0；越过之前照常大小', () => {
    const { view, base, rack } = setup();
    const v = 5.5, dt = 1 / 60;
    let s = rack.s0 - 6, t = base.t, prev = at(base, s, t, v);
    let tCross = Number.NaN, beforeMin = Infinity;
    const after: Array<[number, number]> = [];
    for (let i = 0; i < 240; i++) {
      s += v * dt; t += dt;
      const next = at(base, s, t, v);
      view.frame(prev, next, 1, dt);
      prev = next;
      const k = scaleOf(view, rack);
      if (s - PASS_BEHIND <= rack.s1) { if (s > rack.s0 - 3) beforeMin = Math.min(beforeMin, k); continue; }
      if (Number.isNaN(tCross)) tCross = t - (s - PASS_BEHIND - rack.s1) / v;
      after.push([t - tCross, k]);
    }
    // 越过之前：一直是原大（只是被主角挡住一部分）
    expect(beforeMin).toBeGreaterThan(0.99);
    // 越过之后：单调缩小，PASS_FADE（0.12 s）之后为 0
    expect(PASS_FADE).toBeLessThanOrEqual(0.12);
    let last = 1;
    for (const [dtc, k] of after) {
      expect(k).toBeLessThanOrEqual(last + 1e-9);
      last = k;
      if (dtc >= PASS_FADE + 1e-6) expect(k, `${dtc.toFixed(3)} s`).toBe(0);
    }
    expect(after.some(([dtc, k]) => dtc < PASS_FADE && k > 0 && k < 1)).toBe(true);
  });

  it('帧率很低时（每帧 0.2 s）越过的那一帧就已经是 0：越过的时刻按速度往回推', () => {
    const { view, base, rack } = setup();
    const v = 5.5;
    const s0 = rack.s1 + PASS_BEHIND - 0.1, s1 = s0 + v * 0.2;
    const a = at(base, s0, base.t + 1, v), b = at(base, s1, base.t + 1.2, v);
    view.frame(a, a, 1, 0);
    expect(scaleOf(view, rack)).toBeGreaterThan(0.99);
    view.frame(a, b, 1, 0.2);
    expect(scaleOf(view, rack)).toBe(0);
  });

  it('回头（lookBack > 0）或镜头转向身后（turnBack）时，身后 14 m 内越过的障碍照常画', () => {
    const { view, ctx, base, rack } = setup();
    const v = 5.5;
    const s = rack.s1 + 3;                                       // 已经越过 2.45 m
    const a = at(base, s, base.t + 2, v), b = at(base, s + 0.01, base.t + 2.5, v);
    view.frame(a, a, 1, 0); view.frame(a, b, 1, 0.5);
    expect(scaleOf(view, rack)).toBe(0);
    // 回头
    const lb = at(base, s + 0.01, base.t + 2.6, v, 1);
    view.frame(b, lb, 1, 0.1);
    expect(scaleOf(view, rack)).toBeGreaterThan(0.99);
    // 回头刚开始（镜头还在身后）就开始放大，看得见
    const lb2 = at(base, s + 0.01, base.t + 2.7, v, 0.1);
    view.frame(lb, lb2, 1, 0.1);
    expect(scaleOf(view, rack)).toBeGreaterThan(0);
    // 回头结束：又缩回 0
    const back = at(base, s + 0.02, base.t + 2.8, v, 0);
    view.frame(lb2, back, 1, 0.1);
    expect(scaleOf(view, rack)).toBe(0);
    // turnBack 机位：镜头朝向身后
    expect(cameraBackness(ctx.camera)).toBe(0);
    faceBack(ctx);
    expect(cameraBackness(ctx.camera)).toBe(1);
    view.frame(back, back, 1, 0);
    expect(scaleOf(view, rack)).toBeGreaterThan(0.99);
    // 身后 14 m 以外照样裁掉
    const far = at(base, rack.s1 + BEHIND_LOOK + 1, base.t + 4, v);
    view.frame(far, far, 1, 0);
    expect(scaleOf(view, rack)).toBe(0);
  });

  it('人腿障碍（腿的森林）同样缩小消失；retry / 重来后不残留', () => {
    const { view } = makeView('high');
    const vd = new ViewDriver(view, getChapter('ch5') as ChapterDef, { segment: '5-11', beat: 30 });
    vd.d.sim.setInvincible(true);
    const base = vd.step(1);
    const seg = vd.ch.segments.find((x) => x.def.id === '5-11');
    const legs = seg?.obstacles.find((o) => o.kind === 'legs' && o.s0 > base.player.s + 2);
    expect(legs).toBeDefined();
    if (!legs) return;
    const hipsNear = () => {
      const p = view.forest.pool('hips');
      let n = 0;
      for (let i = 0; i < p.n; i++) {
        p.matrixAt(i, _m).decompose(_p, _q, _s);
        if (-_p.z > legs.s0 - 0.5 && -_p.z < legs.s1 + 0.5 && _s.y > 0.5) n++;
      }
      return n;
    };
    const v = 5;
    const ahead = at(base, legs.s0 - 2, base.t + 1, v);
    view.frame(ahead, ahead, 1, 0);
    expect(hipsNear()).toBeGreaterThan(0);
    const past = at(base, legs.s1 + PASS_BEHIND + 0.3, base.t + 2, v), past2 = at(base, legs.s1 + PASS_BEHIND + 0.35, base.t + 2.2, v);
    view.frame(ahead, past, 1, 1); view.frame(past, past2, 1, 0.2);
    expect(hipsNear()).toBe(0);
    expect(view.internalSizes().passed).toBeGreaterThan(0);
    view.onReset(ahead);
    expect(view.internalSizes().passed).toBe(0);
    view.frame(ahead, ahead, 1, 0);
    expect(hipsNear()).toBeGreaterThan(0);
  });
});
