// tests/unit/npc/upper.test.ts —— 普通 NPC 的弱化轮廓；人墙、梦里与站立段的完整着色。
// 上身始终连着腰部，显示风格按段决定，不随远近变化；特殊人物不叠加第二个上身。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChapterId, QualityTier, SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { C } from '../../../src/render/npc/colors';
import { expandChapter } from '../../../src/render/npc/crowds';
import { HIPS_LOW, HIPS_SPECIAL, LOW_UPPER, LegForest } from '../../../src/render/npc/LegForest';
import { isCrowdSegment, isStandGroup, isWallGroup, isWallSegment, standRevealOf } from '../../../src/render/npc/ObstacleView';
import { HIPS } from '../../../src/render/npc/specials';
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
    // 伸脚的人与轮廓同属 seated，转身、收脚时保持连在一起。
    const { view } = makeView('high');
    const fo = view.pools.get('footOut');
    expect(fo).toBeDefined();
    if (fo) {
      const seated = upFaceColors(fo.geo, fo.variantIndex('seated'));
      expect(seated.length).toBeGreaterThan(0);
      expect(seated.some(isHair)).toBe(false);
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
function people(view: View, snap: SimSnapshot): Array<{ s: number; x: number; hip: number; top: number; d: number; scale: number }> {
  const f = view.forest;
  const uppers = (['torso', 'head', 'upper', 'special'] as const).map((id) => f.pool(id));
  const out: Array<{ s: number; x: number; hip: number; top: number; d: number; scale: number }> = [];
  const lowArms = HIPS_LOW.indexOf(HIPS.arms);
  for (const hp of f.hipsPools()) {
    for (let i = 0; i < hp.n; i++) {
      const v = hp.variantAt(i);
      if (hp === f.pool('hipsLow') && v === lowArms) continue;
      if (hp === f.pool('special') && v === LOW_UPPER) continue;
      if (hp === f.pool('hips') && v === HIPS.arms) continue;
      hp.matrixAt(i, _m); _v.setFromMatrixPosition(_m);
      const px = _v.x, pz = _v.z, hip = _v.y - snap.player.floorY;
      const scale = _v.setFromMatrixColumn(_m, 1).length();
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
      out.push({ s: -pz, x: px, hip, top: top - snap.player.floorY, d: Math.hypot(-pz - snap.player.s, px - snap.player.x), scale });
    }
  }
  return out;
}

/** 站着的人（髋离地 > 0.7 m；坐着的人髋高 0.46 m）。 */
const standing = (p: { hip: number }) => p.hip > 0.7;

/** 完整着色的上身数量（弱化轮廓不计入，头与躯干不重复计数）。 */
function detailedUppers(f: LegForest): number {
  let n = 0;
  for (const id of ['torso', 'upper', 'special'] as const) {
    const pool = f.pool(id);
    for (let i = 0; i < pool.n; i++) {
      if (id === 'special' && pool.variantAt(i) !== LOW_UPPER) continue;
      if (pool.glowAt(i) >= 0) n++;
    }
  }
  return n;
}

describe('人墙的组与段（U6）', () => {
  it('人墙段 = 人群段 = 2-2、5-6（一直画上身）；站立段 4-3、5-8 显示前一个跑段 4-2、5-7 的组（只在站立段进行时画上身）', () => {
    const crowd: string[] = [], segs: string[] = [], reveal: string[] = [], walls: string[] = [], stands: string[] = [];
    for (const id of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as ChapterId[]) {
      const ch = compile(getChapter(id) as ChapterDef);
      for (const sg of ch.segments) if (isCrowdSegment(sg)) crowd.push(sg.def.id);
      ch.segments.forEach((sg, i) => {
        if (isWallSegment(ch.segments, i)) segs.push(sg.def.id);
        const k = standRevealOf(ch.segments, i);
        if (k >= 0) reveal.push(`${sg.def.id}→${ch.segments[k]?.def.id}`);
      });
      const { groups } = expandChapter(ch.seed, ch.segments);
      for (const g of groups) {
        if (isWallGroup(g, ch.segments)) walls.push(`${ch.segments[g.seg]?.def.id}:${g.key}`);
        if (isStandGroup(g, ch.segments)) stands.push(`${ch.segments[g.seg]?.def.id}:${g.key}`);
      }
    }
    expect(crowd).toEqual(['2-2', '5-6']);
    expect(segs).toEqual(['2-2', '5-6']);
    expect(reveal).toEqual(['4-2→4-3', '5-7→5-8']);
    expect(walls).toEqual(['2-2:tables', '2-2:standing', '5-6:recessSides']);
    expect(stands).toEqual(['4-2:ring2', '4-2:imitators', '5-7:class5', '5-7:queue5', '5-7:teacherMa']);
  });
});

describe('站立段与人墙：上身和没有五官的头（U6）', () => {
  const cases: Array<[ChapterId, string, number]> = [['ch4', '4-3', 2], ['ch5', '5-8', 2], ['ch5', '5-6', 10], ['ch5', '5-6', 60], ['ch2', '2-2', 40], ['ch2', '2-2', 80]];
  for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
    it(`${tier}：离玩家 ≤ 6 m 的站着的人模型最高点 ≥ 1.35 m；画面里本段的站着的人不论远近都有上身（4-3、5-8 站立段；5-6、2-2 人墙）`, () => {
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
        // 那是 5-11 的人，仍用弱化轮廓）
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

  it('5-7 爬行时同学有弱化轮廓；进 5-8 后恢复完整着色，远近与画质都不造成截断', () => {
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      const { view } = makeView(tier);
      // 从 @10 起看（再往前，身后 5 m 内还有 5-6 人群段的人墙，它们一直有上身）
      const vd = new ViewDriver(view, getChapter('ch5') as ChapterDef, { segment: '5-7', beat: 10 });
      vd.d.sim.setInvincible(true);
      const sg = vd.ch.segments.find((x) => x.def.id === '5-7');
      expect(sg).toBeDefined();
      const legs = new Set((sg?.obstacles ?? []).filter((o) => o.archetype === 'legs').map((o) => o.id));
      expect(legs.size).toBe(2);
      let frames = 0, seen = 0, far = 0, near = 0, legFrames = 0;
      let snap = vd.d.snap;
      // 每 tick 渲染一帧，好拿到站立段的第一帧
      for (let k = 0; k < 2400 && snap.segKind === 'run'; k++) {
        snap = vd.step(1);
        if (snap.segKind !== 'run') break;
        frames++;
        expect(detailedUppers(view.forest), `${tier} 5-7 t=${snap.t.toFixed(2)}`).toBe(0);
        if (k % 60 === 0) {
          for (const p of people(view, snap).filter(standing)) {
            seen++; if (p.d > 10) far++; if (p.d <= 6) near++;
            expect(p.top, `${tier} 5-7 t=${snap.t.toFixed(2)} d=${p.d.toFixed(1)}`).toBeGreaterThanOrEqual(1.35);
          }
        }
        // 「排队同学的腿」（5-7 @24、@58 的 legs 障碍）在画面里
        const ahead = sg ? sg.obstacles.some((o) => legs.has(o.id) && o.s1 > snap.player.s - 0.5 && o.s0 < snap.player.s + 30) : false;
        if (ahead) legFrames++;
      }
      expect(frames, tier).toBeGreaterThan(1000);
      expect(legFrames, tier).toBeGreaterThan(200);
      expect(far, tier).toBeGreaterThan(10);
      expect(near, tier).toBeGreaterThan(0);
      expect(seen, tier).toBeGreaterThan(40);
      // 5-7 → 5-8：轮廓恢复完整着色。镜头这一帧还在追尾的位置，马老师和近处的同学就在画面里，
      // 所以界面在这一帧用黑场切进 5-8（ui/hud/overlays.ts 的 segmentCut，standCut.test.ts，修复轮 B3 r2）
      expect(snap.segKind, tier).toBe('stand');
      // 身边的人（5-7 的组）；前方 5-11 走廊里的人继续保持弱化轮廓。
      const st = people(view, snap).filter((p) => standing(p) && p.s <= snap.player.s + 10);
      expect(detailedUppers(view.forest), tier).toBeGreaterThan(2);
      expect(st.length, tier).toBeGreaterThan(2);
      for (const p of st) expect(p.top, `${tier} 5-8 第一帧 d=${p.d.toFixed(1)}`).toBeGreaterThanOrEqual(1.35);
    }
  });

  it('走廊路人和坐着的人始终有连接腰部的弱化上身，走近也不切换成完整着色', () => {
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      // 陈默的完整上身属于他自己的髋部件，不叠加轮廓。
      const { view } = makeView(tier);
      const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: '1-2', beat: 20 });
      vd.d.sim.setInvincible(true);
      let seen = 0, near = 0;
      for (let k = 0; k < 40; k++) {
        const snap = vd.step(6);
        expect(detailedUppers(view.forest), `${tier} 1-2 t=${snap.t.toFixed(2)}`).toBe(0);
        for (const p of people(view, snap)) {
          seen++; if (p.d < 3) near++;
          // 越过的障碍会整体收拢；上身必须与髋保持同一缩放，不能提前消失。
          expect(p.top - p.hip, `${tier} 1-2`).toBeGreaterThanOrEqual(0.7 * p.scale - 1e-6);
        }
      }
      expect(seen).toBeGreaterThan(40);
      expect(near).toBeGreaterThan(0);
    }
    // 餐桌边坐着的人同样保留完整高度的轮廓。
    const { view } = makeView('high');
    const vd = new ViewDriver(view, getChapter('ch2') as ChapterDef, { segment: '2-2', beat: 40 });
    vd.d.sim.setInvincible(true);
    const snap = vd.step(20);
    const seated = people(view, snap).filter((p) => !standing(p));
    expect(seated.length).toBeGreaterThan(3);
    for (const p of seated) expect(p.top - p.hip).toBeGreaterThan(0.7);
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

});
