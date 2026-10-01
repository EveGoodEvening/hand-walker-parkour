// tests/unit/npc/upper.test.ts —— 腰带顶面不再是黑盖子；站立段和近处的人墙画上身（U6）。
// 以前站着的人读成带盖的垃圾桶（腰带的顶面用的是头发的黑），站立视线和近处人墙看到的是齐腰截断的裤腿柱。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChapterId, QualityTier, SimSnapshot } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { C } from '../../../src/render/npc/colors';
import { HIPS_LOW, HIPS_SPECIAL, LegForest, NEAR_UPPER, newPerson } from '../../../src/render/npc/LegForest';
import { HIPS, lookFor } from '../../../src/render/npc/specials';
import { ViewDriver, fakeCtx, makeView } from './helpers';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** 某个变体（含共用部分）里朝上（+y）的三角形的顶点色（线性 RGB）。 */
function upFaceColors(geo: THREE.BufferGeometry, variant: number): Array<[number, number, number]> {
  const pos = geo.getAttribute('position'), col = geo.getAttribute('color'), hw = geo.getAttribute('aHw');
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < pos.count; i += 3) {
    const v = hw.getX(i);
    if (v >= 0 && Math.abs(v - variant) > 0.5) continue;
    _a.fromBufferAttribute(pos, i); _b.fromBufferAttribute(pos, i + 1); _c.fromBufferAttribute(pos, i + 2);
    const n = _b.sub(_a).cross(_c.sub(_a)).normalize();
    if (n.y < 0.99) continue;
    for (let k = 0; k < 3; k++) out.push([col.getX(i + k), col.getY(i + k), col.getZ(i + k)]);
  }
  return out;
}

const hairLin = new THREE.Color().setHex(C.hair);
const isHair = (c: readonly number[]) => Math.abs((c[0] as number) - hairLin.r) < 1e-3 && Math.abs((c[1] as number) - hairLin.g) < 1e-3 && Math.abs((c[2] as number) - hairLin.b) < 1e-3;

describe('腰带的顶面（U6）', () => {
  it('普通人、裙装、运动裤、班长：朝上的面没有一个是头发的黑（腰带只剩四个侧面是黑的，上面是衬衫下摆）', () => {
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      const f = new LegForest(); f.init(fakeCtx(tier));
      const hi = f.pool('hips').mesh.geometry, lo = f.pool('hipsLow').mesh.geometry, sp = f.pool('special').mesh.geometry;
      const cases: Array<[THREE.BufferGeometry, number, string]> = [
        [hi, HIPS.trousers, 'hips.trousers'], [hi, HIPS.skirt, 'hips.skirt'], [hi, HIPS.trackPants, 'hips.trackPants'], [hi, HIPS.books, 'hips.books'],
        [lo, HIPS_LOW.indexOf(HIPS.trousers), 'hipsLow.trousers'], [lo, HIPS_LOW.indexOf(HIPS.skirt), 'hipsLow.skirt'],
        [lo, HIPS_LOW.indexOf(HIPS.trackPants), 'hipsLow.trackPants'], [sp, HIPS_SPECIAL.indexOf(HIPS.books), 'special.books'],
      ];
      for (const [geo, v, name] of cases) {
        const up = upFaceColors(geo, v);
        expect(up.length, `${tier} ${name}`).toBeGreaterThan(0);
        expect(up.some(isHair), `${tier} ${name}`).toBe(false);
      }
    }
    // 伸脚的人（footOut 原型）同样：坐着的人腰带顶面不是黑的；上身变体一直在，头顶是头发
    const { view } = makeView('high');
    const fo = view.pools.get('footOut');
    expect(fo).toBeDefined();
    if (fo) {
      const seated = upFaceColors(fo.geo, fo.variantIndex('seated'));
      expect(seated.some(isHair)).toBe(false);
      expect(fo.variantIndex('upper')).toBeGreaterThanOrEqual(0);
    }
  });

  it('衬衫下摆比腰带高 10–15 cm，着衣服色（instanceColor）', () => {
    const f = new LegForest(); f.init(fakeCtx('high'));
    const geo = f.pool('hips').mesh.geometry;
    const pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
    let top = -Infinity, beltTop = -Infinity;
    const col = geo.getAttribute('color');
    const mine = (i: number) => { const v = hw.getX(i); return v < 0 || v === HIPS.trousers; };
    for (let i = 0; i < pos.count; i++) {
      if (!mine(i)) continue;
      top = Math.max(top, pos.getY(i));
      if (isHair([col.getX(i), col.getY(i), col.getZ(i)])) beltTop = Math.max(beltTop, pos.getY(i));
    }
    // 腰带以上的顶点（下摆）全部着色
    let hemVerts = 0;
    for (let i = 0; i < pos.count; i++) if (mine(i) && pos.getY(i) > beltTop + 1e-3) { hemVerts++; expect(hw.getZ(i)).toBe(1); }
    expect(hemVerts).toBeGreaterThan(0);
    expect(top - beltTop).toBeGreaterThanOrEqual(0.1 - 1e-6);
    expect(top - beltTop).toBeLessThanOrEqual(0.15 + 1e-6);
  });
});

/** 每个离玩家 ≤ r 的人（以髋部实例为准）：同一个髋矩阵位置上的上身实例的最高点（离地，米）。 */
function nearTops(view: ReturnType<typeof makeView>['view'], snap: SimSnapshot, r: number): number[] {
  const f = view.forest;
  const uppers = (['torso', 'head', 'upper', 'upperLow', 'special'] as const).map((id) => f.pool(id));
  const tops: number[] = [];
  for (const hp of f.hipsPools()) {
    for (let i = 0; i < hp.n; i++) {
      if (hp === f.pool('hipsLow') && hp.variantAt(i) === HIPS_LOW.indexOf(HIPS.arms)) continue;     // 垂着的手是同一个人的附属实例
      if (hp === f.pool('hips') && hp.variantAt(i) === HIPS.arms) continue;
      hp.matrixAt(i, _m); _v.setFromMatrixPosition(_m);
      const px = _v.x, pz = _v.z;
      if (Math.hypot(-pz - snap.player.s, px - snap.player.x) > r) continue;
      let top = -Infinity;
      // 陈默的上身就在自己的髋部件里（special / hips 的 fullUpper）
      for (const pool of [...uppers, hp]) {
        const geo = pool.mesh.geometry, pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
        for (let j = 0; j < pool.n; j++) {
          pool.matrixAt(j, _m); _v.setFromMatrixPosition(_m);
          if (Math.abs(_v.x - px) > 1e-4 || Math.abs(_v.z - pz) > 1e-4) continue;
          const variant = pool.variantAt(j);
          for (let k = 0; k < pos.count; k++) {
            const vi = hw.getX(k);
            if (vi >= 0 && Math.abs(vi - variant) > 0.5) continue;
            top = Math.max(top, _v.fromBufferAttribute(pos, k).applyMatrix4(_m).y);
          }
        }
      }
      tops.push(top - snap.player.floorY);
    }
  }
  return tops;
}

describe('站立段与近处的人墙：上身和没有五官的头（U6）', () => {
  const cases: Array<[ChapterId, string, number]> = [['ch4', '4-3', 2], ['ch5', '5-8', 2], ['ch5', '5-6', 10], ['ch5', '5-6', 60], ['ch2', '2-2', 30], ['ch2', '2-2', 80]];
  for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
    it(`${tier}：离玩家 ≤ 6 m 的人模型最高点 ≥ 1.35 m（4-3、5-8 站立段；5-6、2-2 两侧人墙）`, () => {
      const rows: string[] = [];
      for (const [ch, seg, beat] of cases) {
        const { view } = makeView(tier);
        const vd = new ViewDriver(view, getChapter(ch) as ChapterDef, { segment: seg, beat });
        vd.d.sim.setInvincible(true);
        const snap = vd.step(20);
        const tops = nearTops(view, snap, NEAR_UPPER.r);
        rows.push(`${seg}@${beat} ${snap.segKind}: ${tops.length} 人，最低 ${Math.min(...tops).toFixed(2)} m`);
        expect(tops.length, `${tier} ${seg}@${beat}`).toBeGreaterThan(2);
        for (const t of tops) expect(t, `${tier} ${seg}@${beat}`).toBeGreaterThanOrEqual(1.35);
      }
      expect(rows.length).toBe(cases.length);
    });
  }

  it('从腰里长出来：NEAR_UPPER.r 以外 grow 米内竖直缩放，再远就没有上身', () => {
    const f = new LegForest(); f.init(fakeCtx('low'));
    const p = newPerson(lookFor('student', 1, 'grow'));
    const heights: number[] = [];
    for (const near of [1, 0.5, 0]) {
      p.near = near;
      f.begin(); f.add(p); f.end();
      heights.push(f.pool('upperLow').n);
      if (near > 0) {
        f.pool('upperLow').matrixAt(0, _m);
        const sy = new THREE.Vector3().setFromMatrixColumn(_m, 1).length();
        expect(sy).toBeCloseTo(near, 6);
      }
    }
    expect(heights).toEqual([1, 1, 0]);
  });

  it('低画质：特殊人物在画面里的那一帧，近处的上身让出来（腿的森林仍 ≤ 3 次 draw call）', () => {
    const f = new LegForest(); f.init(fakeCtx('low'));
    const p = newPerson(lookFor('student', 1, 'a'));
    p.near = 1;
    const chen = newPerson({ ...lookFor('student', 1, 'b'), hips: HIPS.fullUpper });
    f.begin(); f.add(p); f.add(chen); f.end();
    expect(f.pool('special').n).toBe(1);
    expect(f.pool('upperLow').n).toBe(0);
    expect(f.meshes.filter((m) => m.visible).length).toBeLessThanOrEqual(3);
    f.begin(); f.add(p); f.end();
    expect(f.pool('upperLow').n).toBe(1);
  });
});
