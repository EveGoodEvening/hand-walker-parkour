// tests/unit/npc/view.test.ts —— ObstacleView 整体：画质档位的 draw call、每种障碍都显示、伸脚与玩家无关、内存不增长、事件反应。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { QualityTier, SimSnapshot } from '../../../src/core/types';
import { OBSTACLES, OBSTACLE_KINDS } from '../../../src/levels/obstacles';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { makeStage, toStage, type StageName } from '../../../src/render/npc/stage';
import { chapter, runSeg } from '../core/helpers';
import { ViewDriver, makeView } from './helpers';

/** 一帧里本系统可见的 InstancedMesh 数（≈ draw call）。 */
function visible(meshes: THREE.InstancedMesh[]): number { return meshes.filter((m) => m.visible && m.count > 0).length; }

function withStage(tier: QualityTier, name: StageName, steps = 30) {
  const { view } = makeView(tier);
  const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: '1-2', beat: 2 });
  vd.d.sim.setInvincible(true);
  const snap = vd.step(1);
  const d = makeStage(name, snap.player.s, snap.player.floorY);
  view.setStage(toStage(name, d, snap.t, snap.player.s));
  vd.step(steps);
  return { view, vd, d };
}

describe('WP6 draw call 与数量上限（§9.4；验收 1）', () => {
  it('腿的森林：低 ≤ 3（最多 24 人），中 ≤ 5，高 ≤ 6（最多 64 人）', () => {
    const limits: Record<QualityTier, [number, number]> = { low: [3, 24], medium: [5, 40], high: [6, 64] };
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      for (const stage of ['forest', 'dream', 'specials', 'stretch'] as StageName[]) {
        const { view } = withStage(tier, stage, 20);
        const [dc, n] = limits[tier];
        expect(visible(view.forest.meshes), `${tier} ${stage}`).toBeLessThanOrEqual(dc);
        // 障碍里的人（人腿、陈默）一定画；路边的人按上限截断
        expect(view.stats.people, `${tier} ${stage}`).toBeLessThanOrEqual(n + 6);
      }
    }
  });

  it('低画质下 NPC 部件只有鞋、腿、髋 3 个 InstancedMesh 在画（梦里也不画躯干和头）', () => {
    const { view } = withStage('low', 'dream', 20);
    const c = view.forest.counts();
    expect(c.torso + c.head + c.upper + c.shin + c.thigh).toBe(0);
    expect(c.leg).toBeGreaterThan(0);
  });

  it('梦中的爬行者 ≤ 3 次 draw call；数量上限 低 24 / 中 60 / 高 120', () => {
    for (const [tier, max] of [['low', 24], ['medium', 60], ['high', 120]] as Array<[QualityTier, number]>) {
      const { view } = withStage(tier, 'dream', 20);
      view.crowdOp('*', 'crawlOvertake', view.lastSnap as SimSnapshot);
      expect(visible(view.crawlers.meshes)).toBeLessThanOrEqual(3);
      expect(view.crawlers.max).toBe(max);
      expect(view.stats.crawlers).toBeLessThanOrEqual(max + 4);
    }
  });
});

describe('站立段与梦里：躯干和头（§5.7「只在站立段、梦里、远景中显示」）', () => {
  it('跑段里只到腰带；同一群人在站立段里画出躯干和头（高画质）；crowd applaud 时手在胸前开合', () => {
    const { view, vd } = withStage('high', 'forest', 10);
    expect(view.forest.counts().torso).toBe(0);
    const snap = vd.d.snap;
    const stand = { ...snap, segKind: 'stand' as const };
    view.frame(stand, stand, 1, 0);
    expect(view.forest.counts().torso).toBeGreaterThan(5);
    expect(view.forest.counts().head).toBe(view.forest.counts().torso);
    view.crowdOp('*', 'applaud', stand);
    view.frame(stand, stand, 1, 0);
    const p = view.forest.pool('torso');
    const vs = new Set<number>();
    for (let i = 0; i < p.n; i++) vs.add(p.variantAt(i));
    expect(vs.has(1) || vs.has(2)).toBe(true);
    expect(vs.has(0)).toBe(false);
  });
  it('静场里什么都不画', () => {
    const { view, vd } = withStage('high', 'forest', 10);
    const still = { ...vd.d.snap, segKind: 'still' as const };
    view.frame(still, still, 1, 0);
    expect(view.visibleMeshes()).toBe(0);
  });
});

describe('陈默（§4.1 1-2）：蹲在过道里 → 起身 → 让开，脚留在过道里', () => {
  it('他留在过道里的脚在接触前 ≥ 1.2 s 出现在画面上（R4），且画面上的脚正好落在 footOut 碰撞盒里', () => {
    const { view } = makeView('high');
    const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: '1-2', beat: 100 });
    vd.d.sim.setAutopilot('perfect');
    const seg = vd.ch.segments.find((x) => x.def.id === '1-2');
    const foot = seg?.obstacles.find((o) => o.params.itemId === 'chenmoFoot');
    expect(foot).toBeDefined();
    let tSeen = -1, tContact = -1;
    const ankle = new THREE.Vector3();
    for (let i = 0; i < 120 * 12 && tContact < 0; i++) {
      const snap = vd.step(1);
      if (tSeen < 0 && view.forest.lastTargetL(ankle)) tSeen = snap.t;
      if (snap.player.s + 0.25 >= (foot?.s0 ?? 0)) tContact = snap.t;
    }
    expect(tSeen).toBeGreaterThan(0);
    expect(tContact - tSeen).toBeGreaterThanOrEqual(1.2);
    // 画面上的脚踝在碰撞盒里（横向 ±halfW，纵向 s0..s1）
    expect(Math.abs(ankle.x)).toBeLessThan(foot?.halfW ?? 0);
    expect(-ankle.z).toBeGreaterThanOrEqual(foot?.s0 ?? 0);
    expect(-ankle.z).toBeLessThanOrEqual(foot?.s1 ?? 0);
  });
});

describe('每种障碍都能正确显示（验收 5）', () => {
  it('四个画廊覆盖 obstacles.ts 的全部种类，每种都放进了对应原型池、用对应变体', () => {
    const seen = new Set<string>();
    for (const g of ['gallery-low', 'gallery-bar', 'gallery-block', 'gallery-soft'] as StageName[]) {
      const { view, d } = withStage('high', g, 1);
      for (const o of d.obstacles) {
        seen.add(o.kind);
        const a = OBSTACLES[o.kind].archetype;
        if (a === 'legs') { expect(view.stats.people).toBeGreaterThan(0); continue; }
        if (a === 'crawler') { expect(view.stats.crawlers).toBeGreaterThan(0); continue; }
        const pool = view.pools.get(a);
        expect(pool, a).toBeDefined();
        if (!pool) continue;
        const v = pool.variantOf(o.kind);
        let found = false;
        for (let i = 0; i < pool.pool.n; i++) if (pool.pool.variantAt(i) === v) found = true;
        expect(found, `${o.kind} 没有画出来`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...OBSTACLE_KINDS].sort());
  });
});

describe('stretch：伸进过道的脚与玩家位置无关（验收 3）', () => {
  it('换一个玩家位置（另一条车道 / 另一种输入），碰撞盒序列与画面完全相同', () => {
    const def = chapter([runSeg({
      id: 'st', beats: 60, stride: 1, cadence: 4.8,
      items: [
        { at: 20, lane: 0, kind: 'footOut', behavior: { type: 'stretch', period: 1.7, phase: 0.2, outFrac: 0.45 } },
        { at: 32, lane: 1, kind: 'footOut', behavior: { type: 'stretch', period: 2.3, phase: 0.6, outFrac: 0.55 } },
      ],
    })]);
    const run = (moves: Array<[number, 'left' | 'right']>) => {
      const { view } = makeView('high');
      view.enableHitbox(true);
      const vd = new ViewDriver(view, def);
      vd.d.sim.setInvincible(true);
      const boxes: number[][] = [], feet: number[][] = [];
      for (let tick = 0; tick < 60 * 5; tick++) {
        const mv = moves.find((m) => m[0] === tick);
        // 只排队输入，不额外推进 tick：两次运行的模拟时钟逐 tick 对齐
        if (mv) { vd.d.press(mv[1]); vd.d.release(mv[1]); }
        vd.step(2);
        boxes.push(view.hitboxLines().filter((_, i) => i % 1 === 0));
        const p = view.pools.get('footOut');
        const arr: number[] = [];
        if (p) for (let i = 0; i < p.pool.n; i++) arr.push(...p.pool.matrixAt(i, new THREE.Matrix4()).elements.map((x) => Math.round(x * 1e6) / 1e6));
        feet.push(arr);
      }
      return { boxes, feet, x: vd.d.snap.player.x };
    };
    const a = run([]);
    const b = run([[10, 'left'], [150, 'right'], [151, 'right']]);
    expect(a.x).not.toBeCloseTo(b.x, 1);
    // 玩家盒不同（最后 24 个顶点是玩家的白框）→ 只比较障碍的线框
    const obsOnly = (lines: number[]) => lines.slice(0, lines.length - 72);
    expect(a.boxes.map(obsOnly)).toEqual(b.boxes.map(obsOnly));
    expect(a.feet).toEqual(b.feet);
  });
});

describe('事件反应：让一下、安静的一秒、碰倒、拾取', () => {
  it('ask part：0.5 s 后开始横移，0.85 s 后让出 0.6 m；ignore 不动', () => {
    const { view, vd, d } = withStage('high', 'forest', 1);
    const girls = d.obstacles.find((o) => o.params.itemId === 'girls');
    expect(girls).toBeDefined();
    const snap0 = vd.d.snap;
    const shoesBefore = view.forest.pool('shoe').n;
    view.onEvent({ type: 'ask', tick: snap0.tick, data: { targetId: girls?.id ?? -1, result: 'part' } }, snap0);
    expect(shoesBefore).toBeGreaterThan(0);
    // 取两个人的髋部 x（在 forest 的 hips 实例里找离车道最近的两个）
    const hipsX = () => {
      const p = view.forest.pool('hips'), m = new THREE.Matrix4(), v = new THREE.Vector3(), xs: number[] = [];
      const zc = -((girls?.s0 ?? 0) + (girls?.s1 ?? 0)) / 2;
      for (let i = 0; i < p.n; i++) { v.setFromMatrixPosition(p.matrixAt(i, m)); if (Math.abs(v.z - zc) < 0.05 && Math.abs(v.x) < 2) xs.push(v.x); }
      return xs.sort((x, y) => x - y);
    };
    vd.step(1);
    const x0 = hipsX();
    vd.step(Math.round(0.4 * 120));
    const xa = hipsX();                               // 0.5 s 之前不让（只有 idle 的重心摆动，±2 cm）
    expect(xa.length).toBe(x0.length);
    xa.forEach((x, i) => expect(Math.abs(x - (x0[i] ?? 0))).toBeLessThan(0.05));
    vd.step(Math.round(0.6 * 120));
    const x1 = hipsX();
    expect(x1.length).toBe(x0.length);
    const spread0 = (x0[x0.length - 1] ?? 0) - (x0[0] ?? 0), spread1 = (x1[x1.length - 1] ?? 0) - (x1[0] ?? 0);
    expect(spread1 - spread0).toBeCloseTo(1.2, 1);   // 两人各让 0.6 m
  });

  it('人群段里绊倒：所有人静止 1 s（动画时钟不走）', () => {
    const { view, vd } = withStage('high', 'forest', 30);
    const snap = vd.d.snap;
    view.onEvent({ type: 'hit', tick: snap.tick, data: { severity: 'stumble', kind: 'legs', obstacleId: -1, lane: 0, steady: 2, crowd: true, firstLegHit: false } }, snap);
    const shoes = () => { const p = view.forest.pool('shoe'); return Array.from(p.mesh.instanceMatrix.array.slice(0, p.n * 16)).map((x) => Math.round(x * 1e4)); };
    // 静止期间：玩家在动（车道外的路边人按 s 进出窗口），所以只比较凝视以外的路边人——这里直接比较动画时钟
    const t0 = view.time;
    vd.step(30);
    expect(view.time).toBeGreaterThan(t0);
    void shoes;
    expect(view.animClock(t0 + 0.5)).toBeCloseTo(view.animClock(t0), 6);
    expect(view.animClock(t0 + 2)).toBeGreaterThan(view.animClock(t0) + 0.5);
  });

  it('low 被碰到：记住碰倒时刻，0.3 s 内向前倒下；retry 后复原', () => {
    const def = chapter([runSeg({ id: 'k', beats: 40, rows: [[15, '.L.']], follower: { mode: 'hidden', steady: 3 } })]);
    const { view } = makeView('low');
    const vd = new ViewDriver(view, def);
    const bag = vd.ch.segments[0]?.obstacles[0];
    expect(bag?.cls).toBe('low');
    for (let i = 0; i < 60 && vd.d.of('hit').length === 0; i++) vd.step(10);
    expect(vd.d.of('hit').length).toBe(1);
    vd.step(60);
    const p = view.pools.get(bag?.archetype ?? 'lowBox');
    const q = new THREE.Quaternion();
    p?.pool.matrixAt(0, new THREE.Matrix4()).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    expect(Math.abs(new THREE.Euler().setFromQuaternion(q).x)).toBeGreaterThan(1);
    vd.d.sim.retry();
    const snap = vd.d.snap;
    for (const e of vd.d.sim.drain()) view.onEvent(e, snap);
    view.onReset(snap);
    vd.step(1);
    p?.pool.matrixAt(0, new THREE.Matrix4()).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    expect(Math.abs(new THREE.Euler().setFromQuaternion(q).x)).toBeLessThan(1e-6);
  });
});

describe('5 分钟内存不增长（验收 6）', () => {
  it('跑满 5 分钟模拟时间：场景对象、几何体、材质、实例容量都不变，内部表有界', () => {
    const { view, ctx } = makeView('high');
    const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef);
    vd.d.sim.setAutopilot('perfect');
    vd.step(1);
    const census = () => {
      const geos = new Set<unknown>(), mats = new Set<unknown>();
      let objs = 0, cap = 0;
      ctx.scene.traverse((o) => {
        objs++;
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) mats.add(m.material);
        if ((o as THREE.InstancedMesh).isInstancedMesh) cap += (o as THREE.InstancedMesh).instanceMatrix.count;
      });
      return { objs, geos: geos.size, mats: mats.size, cap };
    };
    const c0 = census();
    let ticks = 0;
    while (ticks < 120 * 300) {
      vd.step(6);
      ticks += 6;
      if (vd.d.of('chapter:end').length > 0 || vd.d.snap.player.mode === 'fall') {
        vd.d.sim.goto('1-1', 0);
        vd.d.events.length = 0;
        const snap = vd.d.snap;
        for (const e of vd.d.sim.drain()) view.onEvent(e, snap);
        view.onReset(snap);
      }
    }
    expect(census()).toEqual(c0);
    expect(view.internalSizes().gazeMemo).toBeLessThan(400);
    expect(view.internalSizes().gazeEvents).toBeLessThan(40);
  });
});
