// tests/unit/npc/archetypes.test.ts —— 18 个原型、每种障碍都有外观、模型边缘与碰撞盒偏差 ≤ 5 cm（WP6 验收 4、5）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ArchetypeId } from '../../../src/core/contracts';
import { OBSTACLES, OBSTACLE_KINDS, type ObstacleKind } from '../../../src/levels/obstacles';
import { ArchetypePoolImpl, MAX_EXPAND, createArchetypeMaterial, dimsOf } from '../../../src/render/npc/archetype';
import { ARCHETYPE_DEFS } from '../../../src/render/npc/defs';
import { variantTriangles } from '../../../src/render/npc/material';
import { fakeCtx } from './helpers';

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
