// tests/unit/npc/view.test.ts —— ObstacleView 整体：画质档位的 draw call、每种障碍都显示、伸脚与玩家无关、内存不增长、事件反应。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { QualityTier, SimSnapshot } from '../../../src/core/types';
import { OBSTACLES, OBSTACLE_KINDS } from '../../../src/levels/obstacles';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { customStage, makeStage, toStage, type StageName } from '../../../src/render/npc/stage';
import { chapter, runSeg } from '../core/helpers';
import { ViewDriver, faceBack, fakeCtx, instancedBounds, makeView, stageView } from './helpers';
import { FEET, LegForest, newPerson } from '../../../src/render/npc/LegForest';
import { EMBER_PEAK, emberGlow, lookFor } from '../../../src/render/npc/specials';
import { LAMP_PEAK, lampGlow } from '../../../src/render/npc/archetypes/armBar';
import { reducedPulse } from '../../../src/render/npc/behaviors';
import { OVERTAKE_LIFE } from '../../../src/render/npc/ObstacleView';

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

  it('低画质下 NPC 部件最多 3 个 InstancedMesh：feet（鞋 + 腿）、hipsLow、special（梦里也不画躯干和头）', () => {
    for (const stage of ['dream', 'specials', 'forest'] as StageName[]) {
      const { view } = withStage('low', stage, 20);
      const c = view.forest.counts();
      expect(c.torso + c.head + c.upper + c.shin + c.thigh + c.shoe + c.hips, stage).toBe(0);
      expect(c.feet, stage).toBeGreaterThan(0);
      expect(c.hipsLow, stage).toBeGreaterThan(0);
      // 特殊人物（陈默、周主任）只在 special 里，普通人不进去
      expect(c.special > 0, stage).toBe(stage === 'specials');
    }
  });

  it('NPC 三角形（按 renderer.info 的算法，几何体全部三角形 × 实例数）：低画质 ≤ 8k（§9.4，最多 24 人）', () => {
    const LOW_BUDGET = 8000;
    const rows: string[] = [];
    // 第一章 1-1（教室里两侧坐满的人）、1-2 陈默和储物柜、几个舞台（特殊人物、人墙、梦里）
    for (const [seg, beat] of [['1-1', 3], ['1-2', 112], ['1-2', 150]] as const) {
      const { view } = makeView('low');
      const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: seg, beat });
      vd.d.sim.setInvincible(true);
      vd.step(20);
      rows.push(`${seg}@${beat}: ${view.stats.people} 人 ${view.forest.triangles()}`);
      expect(view.forest.triangles(), `${seg}@${beat}`).toBeLessThanOrEqual(LOW_BUDGET);
    }
    for (const stage of ['forest', 'specials', 'dream', 'stretch'] as StageName[]) {
      const { view } = withStage('low', stage, 20);
      rows.push(`${stage}: ${view.stats.people} 人 ${view.forest.triangles()}`);
      expect(view.forest.triangles(), stage).toBeLessThanOrEqual(LOW_BUDGET);
    }
    // 24 个普通人 + 每人一双垂着的手（最坏情况）也在预算内
    const f = new LegForest(); f.init(fakeCtx('low'));
    const p = newPerson(lookFor('student', 1, 'tris'));
    p.arms = true;
    f.begin(); for (let i = 0; i < 24; i++) f.add(p); f.end();
    expect(f.triangles()).toBeLessThanOrEqual(LOW_BUDGET);
    expect(rows.length).toBe(7);
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
    const t0 = view.time;
    vd.step(30);
    expect(view.time).toBeGreaterThan(t0);
    expect(view.animClock(t0 + 0.5)).toBeCloseTo(view.animClock(t0), 6);
    expect(view.animClock(t0 + 2)).toBeGreaterThan(view.animClock(t0) + 0.5);
  });

  it('安静的一秒（看渲染矩阵）：站着的人、路边走路的人位置和腿姿一起停；碰撞盒还在走的行人位置和腿姿一起动，不滑行', () => {
    // 路边走路的人和障碍在同一个舞台里，按 x 区分：|x| ≥ 1.5 是路边的人
    const { view, vd } = stageView('high', [
      { kind: 'legs', lane: -1, at: 16, behavior: { type: 'walk', speed: 1.2 } },
      { kind: 'legs', lane: 1, at: 16 },
    ], { steps: 30, groups: [{ id: 'w', kind: 'walkers', from: 0, to: 40, side: 'both', density: 1 }] });
    const snap = vd.d.snap;
    view.onEvent({ type: 'hit', tick: snap.tick, data: { severity: 'stumble', kind: 'legs', obstacleId: -1, lane: 0, steady: 2, crowd: true, firstLegHit: false } }, snap);
    const grab = () => {
      const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const out = { walker: [] as number[], stand: [] as number[], decor: [] as number[], walkerThigh: [] as number[], standThigh: [] as number[] };
      const hips = view.forest.pool('hips');
      for (let i = 0; i < hips.n; i++) {
        hips.matrixAt(i, m).decompose(v, q, sc);
        if (Math.abs(v.x) >= 1.5) out.decor.push(v.x, v.z);
        else if (v.x < 0) out.walker.push(v.z); else out.stand.push(v.z);
      }
      const th = view.forest.pool('thigh');
      for (let i = 0; i < th.n; i++) {
        th.matrixAt(i, m).decompose(v, q, sc);
        if (Math.abs(v.x) >= 1.4) continue;             // 路边的人在 |x| = 1.58，大腿在 1.46 以外
        (v.x < 0 ? out.walkerThigh : out.standThigh).push(q.x, q.y, q.z, q.w);
      }
      return out;
    };
    vd.step(12);
    const a = grab();
    vd.step(60);                                       // 仍在 1 s 的静止里
    const b = grab();
    expect(a.walker.length).toBeGreaterThan(0);
    expect(a.decor.length).toBeGreaterThan(4);
    // 站着的人、路边走路的人：一动不动
    expect(b.stand).toEqual(a.stand);
    expect(b.standThigh).toEqual(a.standThigh);
    expect(b.decor).toEqual(a.decor);
    // 行人障碍：碰撞盒按段内时间继续走（0.5 s × 1.2 m/s），腿也跟着迈步
    expect((a.walker[0] ?? 0) - (b.walker[0] ?? 0)).toBeCloseTo(0.6, 2);
    expect(b.walkerThigh.some((x, i) => Math.abs(x - (a.walkerThigh[i] ?? x)) > 0.01)).toBe(true);
  });

  it('low 被碰到：记住碰倒时刻，0.3 s 内向前倒下；retry 后复原', () => {
    const def = chapter([runSeg({ id: 'k', beats: 40, rows: [[15, '.L.']], follower: { mode: 'hidden', steady: 3 } })]);
    const { view, ctx } = makeView('low');
    faceBack(ctx);                // 碰倒之后玩家已经越过它：回头看（U6：平时越过的障碍会缩小消失）
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
    // 「进入 3 m」的凝视记录 20 s 后清掉：只剩最近 20 s 里经过的人
    expect(view.internalSizes().gazeMemo).toBeLessThan(120);
    expect(view.internalSizes().gazeEvents).toBeLessThan(40);
  });
});

describe('凝视记录的清理', () => {
  it('人走过去 20 s 以后，「进入 3 m」的记录被清掉（不累积到重来）', () => {
    const { view, vd } = withStage('high', 'forest', 1);
    for (let i = 0; i < 20 && view.internalSizes().gazeMemo === 0; i++) vd.step(30);
    expect(view.internalSizes().gazeMemo).toBeGreaterThan(0);
    // 玩家站到很远的地方（没有人在 3 m 内），时间过去 25 s
    const far = { ...vd.d.snap, t: vd.d.snap.t + 25, player: { ...vd.d.snap.player, s: vd.d.snap.player.s + 500 } };
    view.frame(far, far, 1, 0);
    expect(view.internalSizes().gazeMemo).toBe(0);
  });
});

describe('R12：人腿的粉笔与朝向无关', () => {
  it('朝玩家、背对、侧身时，腿朝镜头（+z）的那些面都写了 aChalk', () => {
    for (const tier of ['low', 'high'] as QualityTier[]) {
      const f = new LegForest(); f.init(fakeCtx(tier));
      for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.7]) {
        const p = newPerson(lookFor('student', 1, 'r12'));
        p.yaw = yaw; p.arms = true;
        f.begin(); f.add(p); f.end();
        let facing = 0, chalked = 0;
        const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), n = new THREE.Vector3();
        for (const id of (tier === 'low' ? ['feet'] : ['shin', 'thigh']) as Array<'feet' | 'shin' | 'thigh'>) {
          const pool = f.pool(id);
          const geo = pool.mesh.geometry;
          const nor = geo.getAttribute('normal'), hw = geo.getAttribute('aHw'), ch = geo.getAttribute('aChalk');
          for (let i = 0; i < pool.n; i++) {
            pool.matrixAt(i, m);
            nm.getNormalMatrix(m);
            const v = pool.variantAt(i);
            if (id === 'feet' && v !== FEET.leg) continue;     // 低画质的 feet 里还有鞋（浅色鞋底不写粉笔）
            for (let k = 0; k < nor.count; k += 3) {
              const vi = hw.getX(k);
              if (vi >= 0 && Math.abs(vi - v) > 0.5) continue;
              n.set(nor.getX(k), nor.getY(k), nor.getZ(k)).applyMatrix3(nm).normalize();
              if (n.z < 0.5) continue;
              facing++;
              if (ch.getX(k) > 0 && ch.getX(k + 1) > 0 && ch.getX(k + 2) > 0) chalked++;
            }
          }
        }
        expect(facing, `${tier} yaw ${yaw}`).toBeGreaterThan(0);
        expect(chalked, `${tier} yaw ${yaw}`).toBe(facing);
      }
    }
  });
});

describe('伸进过道的脚：坐着的那个人', () => {
  it('人坐在车道外沿自己的椅子上；路边 seatedRow 里坐在同一位置的人去掉，不叠成两个', () => {
    const groups = [{ id: 'row', kind: 'seatedRow' as const, from: 0, to: 30, side: 'R' as const, density: 1 }];
    const d = customStage([{ kind: 'footOut', lane: 1, at: 10 }], 100, 0, { groups });
    const seatX = 1.1 + 0.72, seatS = 100 + 10 + 0.15;
    const clash = (list: typeof d.decor) => list.filter((x) => Math.abs(x.x - seatX) < 0.6 && Math.abs(x.s - seatS) < 0.9).length;
    expect(clash(d.decor)).toBeGreaterThan(0);
    const { view } = makeView('high');
    const st = toStage('stretch', d, 0, 100, false);
    view.setStage(st);
    expect(clash(st.decor)).toBe(0);
    expect(st.decor.length).toBeGreaterThan(10);
  });
});

describe('crowd cue、特殊 NPC、4-3 超过你的人', () => {
  it('组名拼错：不做任何事，只警告一次；\'*\' 作用于全部组', () => {
    const { view, vd } = withStage('high', 'forest', 10);
    const stand = { ...vd.d.snap, segKind: 'stand' as const };
    const clapVariants = () => { view.frame(stand, stand, 1, 0); const p = view.forest.pool('torso'); const vs = new Set<number>(); for (let i = 0; i < p.n; i++) vs.add(p.variantAt(i)); return vs; };
    view.crowdOp('forestl_typo', 'applaud', stand);
    view.crowdOp('forestl_typo', 'applaud', stand);
    expect(view.warnings.length).toBe(1);
    expect([...clapVariants()]).toEqual([0]);
    view.crowdOp('forestL', 'applaud', stand);           // 只有这一组鼓掌
    const vs = clapVariants();
    expect(vs.has(0)).toBe(true);
    expect(vs.has(1) || vs.has(2)).toBe(true);
  });

  it('周主任（暖色的烟头）只在第三章出现；其他章节里同名的人按普通人画', () => {
    for (const [id, want] of [['ch3', true], ['ch2', false]] as const) {
      const def = chapter([runSeg({ id: 'z', beats: 60, items: [{ at: 14, lane: 0, kind: 'legs', id: 'directorZhou' }], follower: { mode: 'hidden', steady: 3 } })], { id });
      const { view } = makeView('high');
      const vd = new ViewDriver(view, def);
      vd.d.sim.setInvincible(true);
      vd.step(20);
      const hips = view.forest.pool('hips');
      let jacket = false, glow = 0;
      for (let i = 0; i < hips.n; i++) { if (hips.variantAt(i) === 2) jacket = true; glow = Math.max(glow, hips.glowAt(i)); }
      expect(jacket, id).toBe(want);
      expect(glow > 0, id).toBe(want);
    }
  });

  it('crawlOvertake：离开本段就收掉；最多持续 OVERTAKE_LIFE 秒', () => {
    const { view, vd } = stageView('high', []);
    // 4-3：玩家站着不动（站立段），爬行的人从身后两侧超过去
    const base = { ...vd.d.snap, segKind: 'stand' as const };
    const at = (dt: number) => { const sn = { ...base, t: base.t + dt }; view.frame(sn, sn, 1, 0); return sn; };
    view.crowdOp('*', 'crawlOvertake', at(0));
    at(2);
    expect(view.stats.crawlers).toBeGreaterThan(0);
    view.onEvent({ type: 'segment', tick: base.tick + 1, data: { index: 0, id: 'next', kind: 'run' } } as never, { ...base, t: base.t + 2 });
    at(2.1);
    expect(view.stats.crawlers).toBe(0);
    // 同一时刻发出的 cue 不被段事件清掉；过了寿命自己消失
    const s3 = at(3);
    view.crowdOp('*', 'crawlOvertake', s3);
    view.onEvent({ type: 'segment', tick: base.tick + 2, data: { index: 0, id: 'next', kind: 'run' } } as never, s3);
    at(5);
    expect(view.stats.crawlers).toBeGreaterThan(0);
    at(3 + OVERTAKE_LIFE + 0.1);
    expect(view.stats.crawlers).toBe(0);
  });
});

describe('减少闪烁（§7.3、附录 A-10）', () => {
  it('周主任的烟头、电子栏杆的红灯：0.5 Hz 平滑明暗，最低不低于峰值的 0.4；关闭时仍是原来的明灭', () => {
    const run = (reduced: boolean) => {
      const { view, vd } = stageView('high', [{ kind: 'legs', lane: 0, at: 30, id: 'directorZhou' }, { kind: 'barrierArm', lane: 'all', at: 34 }]);
      (view.ctx.settings as { reducedFlicker?: boolean }).reducedFlicker = reduced;
      const ember: number[] = [], lamp: number[] = [], ts: number[] = [];
      const armBar = view.pools.get('armBar');
      for (let k = 0; k < 48; k++) {
        vd.step(10);
        const hips = view.forest.pool('hips');
        let g = 0;
        for (let i = 0; i < hips.n; i++) g = Math.max(g, hips.glowAt(i));
        let l = 0;
        if (armBar) for (let i = 0; i < armBar.pool.n; i++) l = Math.max(l, armBar.pool.glowAt(i));
        ember.push(g); lamp.push(l); ts.push(view.time);
      }
      return { ember, lamp, ts };
    };
    const on = run(true), off = run(false);
    for (const [arr, peak] of [[on.ember, EMBER_PEAK], [on.lamp, LAMP_PEAK]] as const) {
      expect(Math.min(...arr)).toBeGreaterThanOrEqual(0.4 * peak - 1e-6);
      expect(Math.max(...arr)).toBeLessThanOrEqual(peak + 1e-6);
      arr.forEach((g, i) => expect(g).toBeCloseTo(peak * reducedPulse(on.ts[i] ?? 0), 5));
    }
    expect(reducedPulse(0.25)).toBeCloseTo(reducedPulse(2.25), 9);   // 周期 2 s = 0.5 Hz
    expect(Math.min(...off.ember)).toBeLessThan(0.4 * EMBER_PEAK);   // 不开的时候烟头明灭得更深
    expect(emberGlow(1.234, false)).not.toBeCloseTo(emberGlow(1.234, true), 3);
    expect(lampGlow(1.234, true)).toBeCloseTo(LAMP_PEAK * reducedPulse(1.234), 9);
  });
});

describe('centerShoes 与多车道平铺', () => {
  it('centerShoes：站着的人转向走廊中央，走路的人不横着走；受击的凝视照样叠加', () => {
    const { view, vd } = stageView('high', [], { groups: [
      { id: 'w', kind: 'walkers', from: 0, to: 30, side: 'both', density: 1 },
      { id: 'l', kind: 'lineSides', from: 0, to: 30, side: 'both', density: 1 },
    ] });
    view.crowdOp('*', 'centerShoes', vd.d.snap);
    vd.step(2);
    const hips = view.forest.pool('hips');
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    let walkers = 0, standers = 0;
    // 路边：走路的人在 |x| = 1.58、站着的在 1.57–1.62（都是 1.5 以外）。走路的人的朝向是 0 或 π，站着的转到 ±π/2 附近
    for (let i = 0; i < hips.n; i++) {
      hips.matrixAt(i, m).decompose(v, q, new THREE.Vector3());
      const yaw = e.setFromQuaternion(q, 'YXZ').y;
      if (Math.abs(Math.abs(yaw) - Math.PI / 2) < 0.4) standers++;
      else if (Math.abs(yaw) < 0.2 || Math.abs(Math.abs(yaw) - Math.PI) < 0.2) walkers++;
    }
    expect(standers).toBeGreaterThan(4);
    expect(walkers).toBeGreaterThan(4);
    // 受击：附近的鞋尖从「朝中央」再转向玩家
    const shoeYaws = () => { const p = view.forest.pool('shoe'); const out: number[] = []; for (let i = 0; i < p.n; i++) { p.matrixAt(i, m).decompose(v, q, new THREE.Vector3()); out.push(e.setFromQuaternion(q, 'YXZ').y); } return out; };
    const before = shoeYaws();
    const snap = vd.d.snap;
    view.onEvent({ type: 'hit', tick: snap.tick, data: { severity: 'stumble', kind: 'legs', obstacleId: -1, lane: 0, steady: 2, crowd: false, firstLegHit: false } }, snap);
    vd.step(60);
    const after = shoeYaws();
    expect(after.length).toBe(before.length);
    expect(after.some((y, i) => Math.abs(y - (before[i] ?? y)) > 0.1)).toBe(true);
  });

  it('turnShoes：走路的人只转鞋尖、腿不跟着转（不横着走），脚不踩进 ±1.8 的墙里', () => {
    for (const tier of ['low', 'high'] as QualityTier[]) {
      const { view, vd } = stageView(tier, [], { groups: [{ id: 'w', kind: 'walkers', from: 0, to: 40, side: 'both', density: 1 }] });
      const feet = () => instancedBounds(view.forest.meshes, { yMax: (vd.d.snap.player.floorY ?? 0) + 0.3 });
      const b0 = feet();
      view.crowdOp('*', 'turnShoes', vd.d.snap);
      let worst = 0;
      for (let k = 0; k < 8; k++) {
        vd.step(8);
        const b = feet();
        worst = Math.max(worst, -b.min.x, b.max.x);
      }
      expect(view.stats.people, tier).toBeGreaterThan(6);
      expect(worst, tier).toBeLessThanOrEqual(1.8);
      expect(Math.max(-b0.min.x, b0.max.x), tier).toBeLessThanOrEqual(1.8);
    }
  });

  it('跨两条车道的书包：每条车道一个名义宽度的书包，不横向拉伸；外沿在碰撞盒的 x0 / x1 上', () => {
    const { view } = stageView('high', [{ kind: 'bag', lane: [0, 1], at: 8 }]);
    const pool = view.pools.get('lowBox');
    expect(pool?.pool.n).toBe(2);
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const xs: number[] = [];
    for (let i = 0; i < (pool?.pool.n ?? 0); i++) { pool?.pool.matrixAt(i, m).decompose(v, q, sc); xs.push(v.x); expect(sc.x).toBeCloseTo(1, 6); }
    expect(xs.sort((a, b) => a - b)[0]).toBeCloseTo(0, 6);
    expect(xs[1]).toBeCloseTo(1.1, 6);
  });
});
