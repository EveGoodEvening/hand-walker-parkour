// tests/unit/npc/upper.test.ts —— 腰带顶面不再是黑盖子；站立段和人墙画上身（U6）。
// 以前站着的人读成带盖的垃圾桶（腰带的顶面用的是头发的黑），站立视线和近处人墙看到的是齐腰截断的裤腿柱。
// 上身按组 / 段决定（站立段要显示的组、人群段 2-2 / 5-6 的人墙、梦里的人），与玩家远近、画面上还有谁无关。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChapterId, QualityTier, SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { C } from '../../../src/render/npc/colors';
import { expandChapter } from '../../../src/render/npc/crowds';
import { HIPS_LOW, HIPS_SPECIAL, LOW_UPPER, LegForest, newPerson } from '../../../src/render/npc/LegForest';
import { isCrowdSegment, isWallGroup, isWallSegment } from '../../../src/render/npc/ObstacleView';
import { HIPS, lookFor, specialLook } from '../../../src/render/npc/specials';
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
    // 伸脚的人（footOut 原型）同样：坐着的人腰带顶面不是黑的；坐着的人只建到腰带（没有上身变体）
    const { view } = makeView('high');
    const fo = view.pools.get('footOut');
    expect(fo).toBeDefined();
    if (fo) {
      const seated = upFaceColors(fo.geo, fo.variantIndex('seated'));
      expect(seated.length).toBeGreaterThan(0);
      expect(seated.some(isHair)).toBe(false);
      expect(fo.variantIndex('upper')).toBe(-1);
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

type View = ReturnType<typeof makeView>['view'];

/** 本帧画出来的人（以髋部实例为准；垂着的手、低画质 special 里人墙的上身是附属实例，不算）：位置、髋离地高度、模型最高点（离地）。 */
function people(view: View, snap: SimSnapshot): Array<{ s: number; x: number; hip: number; top: number; d: number }> {
  const f = view.forest;
  const uppers = (['torso', 'head', 'upper', 'special'] as const).map((id) => f.pool(id));
  const out: Array<{ s: number; x: number; hip: number; top: number; d: number }> = [];
  const lowArms = HIPS_LOW.indexOf(HIPS.arms);
  for (const hp of f.hipsPools()) {
    for (let i = 0; i < hp.n; i++) {
      const v = hp.variantAt(i);
      if (hp === f.pool('hipsLow') && v === lowArms) continue;
      if (hp === f.pool('special') && v === LOW_UPPER) continue;
      if (hp === f.pool('hips') && v === HIPS.arms) continue;
      hp.matrixAt(i, _m); _v.setFromMatrixPosition(_m);
      const px = _v.x, pz = _v.z, hip = _v.y - snap.player.floorY;
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
      out.push({ s: -pz, x: px, hip, top: top - snap.player.floorY, d: Math.hypot(-pz - snap.player.s, px - snap.player.x) });
    }
  }
  return out;
}

/** 站着的人（髋离地 > 0.7 m；坐着的人髋高 0.46 m）。 */
const standing = (p: { hip: number }) => p.hip > 0.7;

describe('人墙的组与段（U6）', () => {
  it('人群段 = 2-2、5-6；人墙段 = 人群段 + 紧挨着站立段（4-3、5-8）的前一个跑段（4-2、5-7）；人墙的组 = 人墙段的组', () => {
    const crowd: string[] = [], segs: string[] = [], walls: string[] = [];
    for (const id of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as ChapterId[]) {
      const ch = compile(getChapter(id) as ChapterDef);
      for (const sg of ch.segments) if (isCrowdSegment(sg)) crowd.push(sg.def.id);
      ch.segments.forEach((sg, i) => { if (isWallSegment(ch.segments, i)) segs.push(sg.def.id); });
      const { groups } = expandChapter(ch.seed, ch.segments);
      for (const g of groups) if (isWallGroup(g, ch.segments)) walls.push(`${ch.segments[g.seg]?.def.id}:${g.key}`);
    }
    expect(crowd).toEqual(['2-2', '5-6']);
    expect(segs).toEqual(['2-2', '4-2', '5-6', '5-7']);
    expect(walls).toEqual(['2-2:tables', '2-2:standing', '4-2:ring2', '4-2:imitators', '5-6:recessSides', '5-7:class5', '5-7:queue5']);
  });
});

describe('站立段与人墙：上身和没有五官的头（U6）', () => {
  const cases: Array<[ChapterId, string, number]> = [['ch4', '4-3', 2], ['ch5', '5-8', 2], ['ch5', '5-6', 10], ['ch5', '5-6', 60], ['ch2', '2-2', 40], ['ch2', '2-2', 80], ['ch5', '5-7', 16]];
  for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
    it(`${tier}：离玩家 ≤ 6 m 的站着的人模型最高点 ≥ 1.35 m；画面里本段的站着的人不论远近都有上身（4-3、5-8 站立段；5-6、2-2 人墙；5-7 排队的同学）`, () => {
      const rows: string[] = [];
      for (const [ch, seg, beat] of cases) {
        const { view } = makeView(tier);
        const vd = new ViewDriver(view, getChapter(ch) as ChapterDef, { segment: seg, beat });
        vd.d.sim.setInvincible(true);
        const snap = vd.step(20);
        const sg = vd.ch.segments[snap.segIndex];
        const all = people(view, snap).filter(standing);
        const near = all.filter((p) => p.d <= 6);
        // 跑段只看本段里的人（前一段走过来的路人不是人墙）；站立段看身边的人（前一个跑段的组。5-8 前方 37 m 外是 5-11 走廊里的人腿障碍，
        // 那是 5-11 的人，只到腰带）
        const mine = sg && snap.segKind === 'run' ? all.filter((p) => p.s >= sg.s0 + 2 && p.s <= sg.s1) : all.filter((p) => p.s <= (sg?.s0 ?? 0) + 10);
        rows.push(`${seg}@${beat} ${snap.segKind}: 近处 ${near.length} 人，最低 ${Math.min(...near.map((p) => p.top)).toFixed(2)} m；本段 ${mine.length} 人，最远 ${Math.max(...mine.map((p) => p.d)).toFixed(1)} m`);
        expect(near.length, `${tier} ${seg}@${beat}`).toBeGreaterThan(2);
        for (const p of near) expect(p.top, `${tier} ${seg}@${beat} 近处`).toBeGreaterThanOrEqual(1.35);
        if (snap.segKind === 'run') expect(Math.max(...mine.map((p) => p.d)), `${tier} ${seg}@${beat}`).toBeGreaterThan(10);
        for (const p of mine) expect(p.top, `${tier} ${seg}@${beat} d=${p.d.toFixed(1)}`).toBeGreaterThanOrEqual(1.35);
      }
      expect(rows.length).toBe(cases.length);
    });
  }

  it('别处（1-2 走廊）和坐着的人（2-2 餐桌边、伸脚的人）只到腰带，不论离玩家多近', () => {
    for (const tier of ['low', 'high'] as QualityTier[]) {
      // 1-2：路边的人和障碍里的人走到身边也不长出上身（陈默的上身是他自己的髋部件）
      const { view } = makeView(tier);
      const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: '1-2', beat: 20 });
      vd.d.sim.setInvincible(true);
      let seen = 0, near = 0;
      for (let k = 0; k < 40; k++) {
        const snap = vd.step(6);
        const c = view.forest.counts();
        expect(c.torso + c.head + c.upper, `${tier} 1-2 t=${snap.t.toFixed(2)}`).toBe(0);
        expect(view.forest.lowUppers(), `${tier} 1-2 t=${snap.t.toFixed(2)}`).toBe(0);
        for (const p of people(view, snap)) { seen++; if (p.d < 3) near++; if (p.hip > 0.7) expect(p.top, `${tier} 1-2`).toBeLessThan(1.3); }
      }
      expect(seen).toBeGreaterThan(40);
      expect(near).toBeGreaterThan(0);
    }
    // 2-2 坐着的人（餐桌边、伸脚的人）只到腰带
    const { view } = makeView('high');
    const vd = new ViewDriver(view, getChapter('ch2') as ChapterDef, { segment: '2-2', beat: 40 });
    vd.d.sim.setInvincible(true);
    const snap = vd.step(20);
    const seated = people(view, snap).filter((p) => !standing(p));
    expect(seated.length).toBeGreaterThan(3);
    for (const p of seated) expect(p.top).toBeLessThan(0.9);
  });

  it('人墙的上身从远到近都是同一个样子（不从腰里长出来）：5-6 一路走过去，每一帧站着的人都有上身、上身不缩放', () => {
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      const { view } = makeView(tier);
      const vd = new ViewDriver(view, getChapter('ch5') as ChapterDef, { segment: '5-6', beat: 4 });
      vd.d.sim.setInvincible(true);
      const pool = view.forest.pool(tier === 'low' ? 'special' : tier === 'medium' ? 'upper' : 'torso');
      const sc = new THREE.Vector3();
      for (let k = 0; k < 30; k++) {
        const snap = vd.step(8);
        // 越过的障碍会整体缩小消失（pass.test.ts）：只看还没越过的人
        const ahead = (s: number) => s >= snap.player.s - 0.5;
        const st = people(view, snap).filter((p) => standing(p) && ahead(p.s));
        let uppers = 0;
        for (let i = 0; i < pool.n; i++) {
          if (tier === 'low' && pool.variantAt(i) !== LOW_UPPER) continue;
          pool.matrixAt(i, _m);
          if (!ahead(-_v.setFromMatrixPosition(_m).z)) continue;
          uppers++;
          sc.setFromMatrixColumn(_m, 1);
          expect(sc.length(), `${tier} t=${snap.t.toFixed(2)}`).toBeCloseTo(1, 6);
        }
        expect(uppers, `${tier} t=${snap.t.toFixed(2)}`).toBe(st.length);
        for (const p of st) expect(p.top).toBeGreaterThanOrEqual(1.35);
      }
    }
  });

  it('低画质：人墙的上身和特殊人物在同一个 special 部件里，同一帧谁也不让（仍 ≤ 3 次 draw call），drawRange 只盖住用到的变体', () => {
    const f = new LegForest(); f.init(fakeCtx('low'));
    const sp = f.pool('special');
    const up = sp.variantRange(LOW_UPPER), chen = sp.variantRange(HIPS_SPECIAL.indexOf(HIPS.fullUpper)), zhou = sp.variantRange(HIPS_SPECIAL.indexOf(HIPS.jacket));
    expect(up?.[0]).toBe(0);                                                  // 上身排在最前面
    const upTris = ((up?.[1] ?? 0) - (up?.[0] ?? 0)) / 3;
    expect(upTris).toBe(42);
    const wall = newPerson(lookFor('student', 1, 'wall'));
    wall.wall = true;
    const chenMo = newPerson(specialLook('chenMo'));
    const visible = () => f.meshes.filter((m) => m.visible && m.count > 0).length;
    const geo = sp.mesh.geometry;
    // 只有人墙：每个上身只付 42 个三角形
    f.begin(); for (let i = 0; i < 5; i++) f.add(wall); f.end();
    expect(f.lowUppers()).toBe(5);
    expect([geo.drawRange.start, geo.drawRange.count]).toEqual([up?.[0], (up?.[1] ?? 0) - (up?.[0] ?? 0)]);
    expect(sp.triangles()).toBe(5 * upTris);
    // 陈默也在画面里：上身照样画（以前这一帧上身被整池清掉），drawRange 盖住两段
    f.begin(); for (let i = 0; i < 5; i++) f.add(wall); f.add(chenMo); f.end();
    expect(f.lowUppers()).toBe(5);
    expect(sp.n).toBe(6);
    expect(geo.drawRange.start).toBe(0);
    expect(geo.drawRange.start + geo.drawRange.count).toBe(chen?.[1]);
    expect(visible()).toBeLessThanOrEqual(3);
    // 只有周主任：只画夹克那一段
    const zhouP = newPerson(specialLook('directorZhou'));
    f.begin(); f.add(zhouP); f.end();
    expect([geo.drawRange.start, geo.drawRange.start + geo.drawRange.count]).toEqual(zhou);
    expect(f.lowUppers()).toBe(0);
    // 不是人墙的人（wall = false）低画质不画上身，中、高画质也只在 upper（梦里、站立段）时画
    const plain = newPerson(lookFor('student', 1, 'plain'));
    f.begin(); f.add(plain); f.end();
    expect(sp.n).toBe(0);
  });
});
