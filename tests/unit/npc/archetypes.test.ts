// tests/unit/npc/archetypes.test.ts —— 18 个原型、每种障碍都有外观、模型边缘与碰撞盒偏差 ≤ 5 cm（WP6 验收 4、5）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ArchetypeId } from '../../../src/core/contracts';
import { OBSTACLES, OBSTACLE_KINDS, type ObstacleKind } from '../../../src/levels/obstacles';
import { ArchetypePoolImpl, MAX_EXPAND, createArchetypeMaterial, dimsOf } from '../../../src/render/npc/archetype';
import { ARCHETYPE_DEFS } from '../../../src/render/npc/defs';
import { variantTriangles } from '../../../src/render/npc/material';
import { obstacleTwist, obstacleYaw } from '../../../src/render/npc/behaviors';
import { CRAWL } from '../../../src/render/npc/Crawlers';
import { FOOT_CHAIR_X, FOOT_HIP } from '../../../src/render/npc/archetypes/footOut';
import type { QualityTier } from '../../../src/core/types';
import type { Spec } from '../../../src/render/npc/stage';
import { fakeCtx, instancedBounds, stageView } from './helpers';

const ALL: ArchetypeId[] = ['footOut', 'lowBox', 'bucket', 'curb', 'bikeDown', 'kneeler', 'tableBar', 'chairBar', 'armBar',
  'shutter', 'legs', 'cart', 'column', 'vehicle', 'stallDoor', 'crawler', 'floorDecal', 'note'];

const ctx = fakeCtx('low');
const pools = new Map(ARCHETYPE_DEFS.filter((d) => !d.delegate).map((d) => [d.id, new ArchetypePoolImpl(d, createArchetypeMaterial(ctx, d), 4)]));

/** 某变体的包围盒；排除 y ≤ floor 的地面暗带（深缝），可选只取 |x| ≤ xMax 的部分（车道上方）。 */
function bounds(geo: THREE.BufferGeometry, v: number, o: { floor?: number; xMax?: number } = {}): THREE.Box3 {
  const pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
  const box = new THREE.Box3(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const vi = hw.getX(i);
    if (!(vi === v || vi < 0)) continue;
    // 以三角形为单位：整个三角形都在地面暗带高度的不算
    const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
    if (o.floor !== undefined && Math.max(...ys) <= o.floor) continue;
    for (let k = 0; k < 3; k++) {
      p.set(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (o.xMax !== undefined && Math.abs(p.x) > o.xMax) continue;
      box.expandByPoint(p);
    }
  }
  return box;
}

/** 跨过 x = x0 这条竖线的三角形里最低的高度（地面暗带除外）。 */
function lowestOver(geo: THREE.BufferGeometry, v: number, x0: number): number {
  const pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
  let lo = Infinity;
  for (let i = 0; i < pos.count; i += 3) {
    const vi = hw.getX(i);
    if (!(vi === v || vi < 0)) continue;
    const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)], ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
    if (Math.max(...ys) <= 0.0045) continue;
    if (Math.min(...xs) <= x0 && Math.max(...xs) >= x0) lo = Math.min(lo, Math.min(...ys));
  }
  return lo;
}

describe('WP6 障碍原型（§8.4 ArchetypeFactory、§8.5 obstacles.ts）', () => {
  it('18 个原型各有一个定义（import.meta.glob 自动收集）', () => {
    expect(ARCHETYPE_DEFS.map((d) => d.id).sort()).toEqual([...ALL].sort());
  });

  it('obstacles.ts 里的每种障碍都有外观：要么有同名变体，要么由 LegForest / Crawlers 负责', () => {
    for (const k of OBSTACLE_KINDS) {
      const a = OBSTACLES[k].archetype;
      const def = ARCHETYPE_DEFS.find((d) => d.id === a);
      expect(def, `${k} → ${a}`).toBeDefined();
      if (def?.delegate) { expect(['legs', 'crawler']).toContain(a); continue; }
      expect(def?.variants.some((v) => v.kind === k), `${k} 在 ${a} 里没有变体`).toBe(true);
    }
  });

  it('每个原型只有一个 InstancedMesh（legs / crawler 除外，见契约注释）', () => {
    for (const [id, p] of pools) {
      const meshes: THREE.Object3D[] = [];
      p.object.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o); });
      expect(meshes.length, id).toBe(1);
    }
  });

  it('模型边缘与碰撞盒的偏差 ≤ 5 cm（x、s 两向；low 的顶边；bar 的下沿）', () => {
    const tol = MAX_EXPAND + 1e-3;
    const report: string[] = [];
    for (const k of OBSTACLE_KINDS) {
      const sp = OBSTACLES[k];
      const p = pools.get(sp.archetype);
      if (!p) continue;
      const v = p.variantOf(k);
      // footOut：膝盖、大腿和椅面在车道外沿（坐着的那个人），只检查车道上方的部分
      const xMax = k === 'footOut' ? sp.halfW + MAX_EXPAND : undefined;
      const b = bounds(p.geo, v, { floor: 0.0045, ...(xMax ? { xMax } : {}) });
      const d = dimsOf(k);
      const dx0 = Math.abs(b.min.x + sp.halfW), dx1 = Math.abs(b.max.x - sp.halfW);
      const dz0 = Math.abs(b.min.z + sp.depth / 2), dz1 = Math.abs(b.max.z - sp.depth / 2);
      if (k !== 'footOut') { if (dx0 > tol) report.push(`${k} x0 ${dx0.toFixed(3)}`); }
      else if (dx0 > tol) report.push(`${k} x0 ${dx0.toFixed(3)}`);
      if (k !== 'footOut' && dx1 > tol) report.push(`${k} x1 ${dx1.toFixed(3)}`);
      if (dz0 > tol) report.push(`${k} s1 ${dz0.toFixed(3)}`);
      if (dz1 > tol) report.push(`${k} s0 ${dz1.toFixed(3)}`);
      if (sp.cls === 'low') {
        const dt = b.max.y - sp.y1;
        if (dt < -0.03 || dt > tol) report.push(`${k} top ${dt.toFixed(3)}`);
      }
      if (sp.cls === 'bar') {
        // 横档：车道中线上方最低的那个面（决定能不能伏低钻过去）在 5 cm 内；上沿不能低于碰撞上沿
        const lowest = lowestOver(p.geo, v, 0);
        if (Math.abs(lowest - sp.y0) > tol) report.push(`${k} bottom ${(lowest - sp.y0).toFixed(3)}`);
        if (b.max.y < sp.y1 - 0.01) report.push(`${k} top ${(b.max.y - sp.y1).toFixed(3)}`);
      }
      if (sp.cls === 'block' && Math.abs(b.max.y - sp.y1) > tol) report.push(`${k} top ${(b.max.y - sp.y1).toFixed(3)}`);
      void d;
    }
    expect(report).toEqual([]);
  });

  it('横档下面是空的：车道中间、下沿以下没有任何模型（伏低能钻过去）', () => {
    for (const k of OBSTACLE_KINDS) {
      const sp = OBSTACLES[k];
      if (sp.cls !== 'bar') continue;
      const p = pools.get(sp.archetype);
      if (!p) continue;
      const geo = p.geo, v = p.variantOf(k);
      const pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
      for (let i = 0; i < pos.count; i += 3) {
        const vi = hw.getX(i);
        if (!(vi === v || vi < 0)) continue;
        const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)], ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
        // 玩家伏低时的碰撞盒：|x| ≤ 0.22，y ≤ 0.30；地面暗带（y ≤ 0.005）除外
        const inX = Math.min(...xs) < 0.22 && Math.max(...xs) > -0.22;
        const inY = Math.max(...ys) > 0.006 && Math.min(...ys) < 0.3;
        if (inX && inY) throw new Error(`${k}: 伏低空间里有三角形 x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)} y ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)}`);
      }
    }
  });

  it('三角形预算：每个原型几何体（含全部变体）≤ 700 个三角形', () => {
    for (const [id, p] of pools) {
      const tris = p.geo.getAttribute('position').count / 3;
      expect(tris, id).toBeLessThanOrEqual(700);
      for (let v = 0; v < p.def.variants.length; v++) expect(variantTriangles(p.geo, v)).toBeGreaterThan(0);
    }
  });

  it('low 的顶边、bar 的下沿都写了粉笔（aChalk = 1），暗场由 LampField 点亮（R12）', () => {
    for (const k of OBSTACLE_KINDS) {
      const sp = OBSTACLES[k];
      if (sp.cls !== 'low' && sp.cls !== 'bar' && sp.cls !== 'block') continue;
      const p = pools.get(sp.archetype);
      if (!p) continue;
      const v = p.variantOf(k);
      const hw = p.geo.getAttribute('aHw'), ch = p.geo.getAttribute('aChalk');
      let n = 0;
      for (let i = 0; i < hw.count; i++) if ((hw.getX(i) === v || hw.getX(i) < 0) && ch.getX(i) >= 0.99) n++;
      expect(n, `${k} 没有粉笔线`).toBeGreaterThan(0);
    }
  });

  it('契约接口 place / hit / hide：按段内时间放置，碰倒后 low 向前倒下', () => {
    const p = new ArchetypePoolImpl(ARCHETYPE_DEFS.find((d) => d.id === 'lowBox') as never, new THREE.MeshLambertMaterial(), 4);
    const o = { id: 1, kind: 'bag' as ObstacleKind, cls: 'low' as const, archetype: 'lowBox' as const, lanes: [0 as const], beat: 10, s0: 10, s1: 10.3, y0: 0, y1: 0.28, halfW: 0.2, behavior: { type: 'static' as const }, npc: false, params: {} };
    p.place(0, o, 0);
    expect(p.pool.n).toBe(1);
    expect(p.pool.mesh.count).toBe(1);
    const m = p.pool.matrixAt(0, new THREE.Matrix4());
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.z).toBeCloseTo(-10.15, 5);
    p.hit(0, 'stumble');
    p.place(0, o, 1);
    const q = new THREE.Quaternion(); p.pool.matrixAt(0, m).decompose(pos, q, new THREE.Vector3());
    expect(Math.abs(new THREE.Euler().setFromQuaternion(q).x)).toBeGreaterThan(1);
    p.hide(0);
    expect(p.pool.mesh.count).toBe(0);
  });
});

/**
 * 人腿、陈默、爬行者不在原型池里（legs → LegForest，crawler → Crawlers），按 ObstacleView 实际画出来的实例算世界包围盒，
 * 和碰撞盒比较（WP6 验收 4）。横向、纵向只看玩家碰撞盒最高 0.85 m 以下的部分（再往上玩家碰不到）。
 */
describe('人腿 / 陈默 / 爬行者：世界包围盒与碰撞盒偏差 ≤ 5 cm（验收 4）', () => {
  const tol = MAX_EXPAND + 1e-3;
  const BAND = 0.85;
  /** 碰撞盒中心在 (cx, cz)、半宽 hw、半深 hd：返回超差的描述（空 = 全部在 ±5 cm 内）。 */
  const check = (tag: string, b: THREE.Box3, cx: number, cz: number, hw: number, hd: number, out: string[], o: { x?: boolean; z?: boolean } = {}) => {
    const sides: Array<[string, number, number]> = [];
    if (o.x !== false) sides.push(['x0', -(b.min.x - cx), hw], ['x1', b.max.x - cx, hw]);
    if (o.z !== false) sides.push(['s1', -(b.min.z - cz), hd], ['s0', b.max.z - cz, hd]);
    for (const [k, v, want] of sides) if (Math.abs(v - want) > tol) out.push(`${tag} ${k} ${v.toFixed(3)}（碰撞 ${want.toFixed(3)}）`);
  };
  const tiers: QualityTier[] = ['low', 'medium', 'high'];

  it('单车道人腿：所有朝向（朝玩家 / 背对 / 扭上身）都填满 0.52 × 0.30 的碰撞盒', () => {
    const out: string[] = [];
    const kinds = new Set<string>();
    for (const tier of tiers) {
      for (let k = 0; k < 40; k++) {
        const { view, obstacles } = stageView(tier, [{ kind: 'legs', lane: 1, at: 7 }], { idBase: 5000 + k });
        const o = obstacles[0] as (typeof obstacles)[number];
        const yaw = obstacleYaw(o.id, 0), tw = obstacleTwist(o.id, 0);
        kinds.add(`${Math.abs(yaw) < 1 ? 'front' : 'back'}${tw ? '+twist' : ''}`);
        const fy = view.lastSnap?.player.floorY ?? 0;
        const b = instancedBounds(view.forest.meshes, { yMax: fy + BAND });
        check(`${tier} id ${o.id} yaw ${yaw.toFixed(2)} twist ${tw}`, b, 1.1, -(o.s0 + o.s1) / 2, OBSTACLES.legs.halfW, OBSTACLES.legs.depth / 2, out);
        expect(b.min.y - fy).toBeGreaterThanOrEqual(-0.01);
      }
    }
    expect([...kinds].sort()).toEqual(['back', 'back+twist', 'front', 'front+twist']);
    expect(out).toEqual([]);
  });

  it('凝视（鞋尖转向玩家）时也不超差', () => {
    const out: string[] = [];
    let turnedPeople = 0, total = 0;
    const shoeYaws = (view: ReturnType<typeof stageView>['view']) => {
      const shoes = view.forest.pool('shoe');
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), ys: number[] = [];
      for (let i = 0; i < shoes.n; i++) { shoes.matrixAt(i, m).decompose(new THREE.Vector3(), q, new THREE.Vector3()); ys.push(e.setFromQuaternion(q, 'YXZ').y); }
      return ys;
    };
    for (const tier of ['low', 'high'] as QualityTier[]) {
      for (let k = 0; k < 12; k++) {
        const { view, vd, obstacles } = stageView(tier, [{ kind: 'legs', lane: 1, at: 9 }], { idBase: 6000 + k });
        const o = obstacles[0] as (typeof obstacles)[number];
        const snap = vd.d.snap;
        const before = shoeYaws(view);
        // 受击：半径 5 m 内的鞋尖都转过来；在转到位、停住的那 0.5 s 里取样
        view.onEvent({ type: 'hit', tick: snap.tick, data: { severity: 'stumble', kind: 'legs', obstacleId: -1, lane: 1, steady: 2, crowd: false, firstLegHit: false } }, { ...snap, player: { ...snap.player, s: (o.s0 + o.s1) / 2 - 2 } });
        let turned = false;
        for (const steps of [48, 12, 12, 12]) {
          vd.step(steps);
          const now = shoeYaws(view);
          // 鞋尖相对凝视之前转过的角度（idle 只有 ±6° 的外八字，不随时间变）
          if (now.some((y, i) => Math.abs(Math.atan2(Math.sin(y - (before[i] ?? y)), Math.cos(y - (before[i] ?? y)))) > 0.08)) turned = true;
          const fy = view.lastSnap?.player.floorY ?? 0;
          check(`${tier} gaze id ${o.id}`, instancedBounds(view.forest.meshes, { yMax: fy + BAND }), 1.1, -(o.s0 + o.s1) / 2, OBSTACLES.legs.halfW, OBSTACLES.legs.depth / 2, out);
        }
        total++;
        if (turned) turnedPeople++;
      }
    }
    // 朝着玩家站的人只需要转一点；至少一半的人鞋尖明显转过来，说明取样确实落在凝视里
    expect(turnedPeople).toBeGreaterThanOrEqual(total / 2);
    expect(out).toEqual([]);
  });

  it('特殊人物（周主任、马老师）和多车道人墙：外侧的人站在车道中心，外沿落在 x0 / x1 上', () => {
    const out: string[] = [];
    const cases: Array<[string, Spec, number, number]> = [
      ['周主任', { kind: 'legs', lane: 0, at: 7, id: 'directorZhou' }, 0, 0],
      ['马老师', { kind: 'legs', lane: 0, at: 7, id: 'teacherMa' }, 0, 0],
      ['人墙 0,1', { kind: 'legs', lane: [0, 1], at: 7 }, 0, 1],
      ['人墙 -1,0', { kind: 'legs', lane: [-1, 0], at: 7 }, -1, 0],
      ['人墙 -1,0,1', { kind: 'legs', lane: [-1, 0, 1], at: 7 }, -1, 1],
    ];
    for (const tier of tiers) {
      for (const [tag, spec, l0, l1] of cases) {
        const { view, obstacles } = stageView(tier, [spec]);
        const o = obstacles[0] as (typeof obstacles)[number];
        const fy = view.lastSnap?.player.floorY ?? 0;
        const b = instancedBounds(view.forest.meshes, { yMax: fy + BAND });
        const x0 = l0 * 1.1 - o.halfW, x1 = l1 * 1.1 + o.halfW;
        check(`${tier} ${tag}`, b, (x0 + x1) / 2, -(o.s0 + o.s1) / 2, (x1 - x0) / 2, OBSTACLES.legs.depth / 2, out);
      }
    }
    expect(out).toEqual([]);
  });

  it('陈默蹲着（0.70 × 0.50 × 1.00）：横向、纵向、头顶都在 ±5 cm 内，脚不穿地', () => {
    const out: string[] = [];
    for (const tier of tiers) {
      const { view, obstacles } = stageView(tier, [{ kind: 'chenMo', lane: 0, at: 5, id: 'chenmo', behavior: { type: 'yield', atBeat: 4 } }]);
      const o = obstacles[0] as (typeof obstacles)[number];
      const fy = view.lastSnap?.player.floorY ?? 0;
      const b = instancedBounds(view.forest.meshes);
      check(`${tier} 陈默`, b, 0, -(o.s0 + o.s1) / 2, OBSTACLES.chenMo.halfW, OBSTACLES.chenMo.depth / 2, out);
      if (Math.abs(b.max.y - fy - OBSTACLES.chenMo.y1) > tol) out.push(`${tier} 陈默 top ${(b.max.y - fy).toFixed(3)}`);
      expect(b.min.y - fy).toBeGreaterThanOrEqual(-0.01);
    }
    expect(out).toEqual([]);
  });

  it('梦里的爬行者（0.60 × 1.10 × 0.55）：整个爬行周期里横向、纵向、背顶都在 ±5 cm 内', () => {
    const out: string[] = [];
    for (const speed of [3, -2]) {
      const { view, vd, obstacles } = stageView('high', [{ kind: 'crawler', lane: 0, at: 9, behavior: { type: 'walk', speed } }]);
      const o = obstacles[0] as (typeof obstacles)[number];
      for (let k = 0; k < 16; k++) {
        vd.step(7);
        const t = (view.lastSnap?.t ?? 0) - (view.stage?.t0 ?? 0);
        const fy = view.lastSnap?.player.floorY ?? 0;
        const b = instancedBounds(view.crawlers.meshes);
        check(`爬行者 v ${speed} 第 ${k} 帧`, b, 0, -((o.s0 + o.s1) / 2 + speed * t), OBSTACLES.crawler.halfW, OBSTACLES.crawler.depth / 2, out);
        if (Math.abs(b.max.y - fy - OBSTACLES.crawler.y1) > tol) out.push(`爬行者 top ${(b.max.y - fy).toFixed(3)}`);
      }
    }
    expect(out).toEqual([]);
    expect(CRAWL.shoulderX).toBeGreaterThan(0.2);
  });

  it('走路的人：横向在 ±5 cm 内（沿 s 的外沿随步态前后摆，见 docs/lessons/WP6.md）', () => {
    const out: string[] = [];
    for (const speed of [1.2, -1.2]) {
      const { view, vd, obstacles } = stageView('low', [{ kind: 'legs', lane: -1, at: 12, behavior: { type: 'walk', speed } }]);
      const o = obstacles[0] as (typeof obstacles)[number];
      for (let k = 0; k < 20; k++) {
        vd.step(6);
        const fy = view.lastSnap?.player.floorY ?? 0;
        check(`walk ${speed} 第 ${k} 帧`, instancedBounds(view.forest.meshes, { yMax: fy + BAND }), -1.1, 0, OBSTACLES.legs.halfW, 0, out, { z: false });
      }
      void o;
    }
    expect(out).toEqual([]);
  });

  it('伸进中道的脚：坐着的人和椅子在两条车道之间的空当里，不伸进相邻车道玩家碰撞盒（|x − 1.1| ≥ 0.22）', () => {
    for (const id of [0, 1]) {
      const { view, obstacles } = stageView('high', [{ kind: 'footOut', lane: 0, at: 7 }], { idBase: 7000 + id });
      const pool = view.pools.get('footOut');
      expect(pool?.pool.n).toBe(2);                    // 人 + 椅子
      const b = instancedBounds(pool ? [pool.pool.mesh] : []);
      expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(1.1 - 0.22);
      expect(Math.max(-b.min.x, b.max.x)).toBeGreaterThan(FOOT_CHAIR_X);
      // 椅面上坐着人（胯在椅面以上），不是一块漂浮的椅面
      const fy = view.lastSnap?.player.floorY ?? 0;
      expect(b.max.y - fy).toBeGreaterThan(FOOT_HIP.y + 0.1);
      void obstacles;
    }
  });
});
