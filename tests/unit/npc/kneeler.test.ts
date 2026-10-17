// tests/unit/npc/kneeler.test.ts —— 梦里跪着的人读得出是人（审查 npc-seated-3/4/5）；弱化轮廓不画头发片（npc-standing-4）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compile } from '../../../src/levels/compile';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, CompiledObstacle } from '../../../src/levels/schema';
import { ArchetypePoolImpl, createArchetypeMaterial, type PlaceCtx } from '../../../src/render/npc/archetype';
import { REACH_GAP_X } from '../../../src/render/npc/archetypes/armBar';
import { ARCHETYPE_DEFS } from '../../../src/render/npc/defs';
import { LegForest } from '../../../src/render/npc/LegForest';
import { SOFT_HIDE, patchNpcShader } from '../../../src/render/npc/material';
import { reachNeighbours } from '../../../src/render/npc/ObstacleView';
import { obstacleState } from '../../../src/render/npc/simBridge';
import { fakeCtx } from './helpers';

const ctx = fakeCtx('low');
const pool = (id: string) => {
  const d = ARCHETYPE_DEFS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return new ArchetypePoolImpl(d, createArchetypeMaterial(ctx, d), 8);
};
const kneeler = pool('kneeler');

/** 变体 v 里满足 keep 的三角形各自的 y 区间。 */
function yIntervals(geo: THREE.BufferGeometry, v: number, keep: (c: THREE.Vector3) => boolean): Array<[number, number]> {
  const pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
  const out: Array<[number, number]> = [];
  const a = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const vi = hw.getX(i);
    if (!(vi === v || vi < 0)) continue;
    c.set(0, 0, 0);
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) { a.fromBufferAttribute(pos, i + k); c.addScaledVector(a, 1 / 3); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); }
    if (keep(c)) out.push([y0, y1]);
  }
  return out;
}

/** 区间并集从 lo 到 hi 中间最大的空当。 */
function largestGap(iv: Array<[number, number]>, lo: number, hi: number): number {
  const s = [...iv].sort((p, q) => p[0] - q[0]);
  let reach = lo, gap = 0;
  for (const [a, b] of s) { if (a > reach) gap = Math.max(gap, a - reach); reach = Math.max(reach, b); if (reach >= hi) break; }
  return Math.max(gap, hi - reach);
}

describe('梦里跪着的人（kneeler）', () => {
  it('跪伏：从地面到背上，臀部那一列没有悬空（大腿把小腿和盆骨连起来）', () => {
    const v = kneeler.variantIndex('kneel');
    // 臀部和脚跟那一列（背后看见的部分）：|x| ≤ 0.15，z ∈ [0.05, 0.25]
    const iv = yIntervals(kneeler.geo, v, (c) => Math.abs(c.x) <= 0.15 && c.z >= 0.05 && c.z <= 0.25);
    expect(largestGap(iv, 0, 0.33)).toBeLessThan(0.01);
  });

  it('伸手拦路的人：跪坐的臀部压在脚跟上，没有悬空', () => {
    for (const name of ['reachL', 'reachR', 'reachBoth']) {
      const iv = yIntervals(kneeler.geo, kneeler.variantIndex(name), (c) => Math.abs(c.x) <= 0.15 && c.z >= 0.1 && c.z <= 0.34);
      expect(largestGap(iv, 0, 0.3), name).toBeLessThan(0.01);
    }
  });

  it('外侧那只手收在身体宽度以内；reachBoth 两侧都没有垂下的手', () => {
    const w = (name: string) => {
      const pos = kneeler.geo.getAttribute('position'), hw = kneeler.geo.getAttribute('aHw');
      let m = 0;
      for (let i = 0; i < pos.count; i++) if (hw.getX(i) === kneeler.variantIndex(name)) m = Math.max(m, Math.abs(pos.getX(i)));
      return m;
    };
    for (const name of ['reachL', 'reachR', 'reachBoth']) expect(w(name), name).toBeLessThanOrEqual(0.19);
  });

  it('摔倒侧躺：在碰撞盒（0.64 × 0.60 × 0.35）外沿 ±6 cm 内，最高处不超过 0.35', () => {
    const v = kneeler.variantIndex('fallen');
    const pos = kneeler.geo.getAttribute('position'), hw = kneeler.geo.getAttribute('aHw');
    const box = new THREE.Box3(), p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) if (hw.getX(i) === v) box.expandByPoint(p.fromBufferAttribute(pos, i));
    expect(box.max.y).toBeLessThanOrEqual(0.35);
    expect(Math.max(-box.min.x, box.max.x)).toBeLessThanOrEqual(0.32 + 0.065);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(0.30 + 0.065);
  });

  it('4-5 的 reach 行：跪着的人互相隔开 ≥ 0.4 m，离旁边人腿障碍的中心 ≥ 0.45 m，相邻两道 reach 共用车道缝上的一个人', () => {
    const ch = compile(getChapter('ch4') as ChapterDef);
    const seg = ch.segments.find((s) => s.def.id === '4-5');
    if (!seg) throw new Error('4-5');
    const arm = pool('armBar');
    const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
    const placed: Array<{ x: number; s: number; variant: string }> = [];
    const pc: PlaceCtx = {
      o: null as unknown as CompiledObstacle, st, floorY: 0, tSeg: 0, beat: -1, t: 0, knockedAt: null, chapter: 'ch4', kit: 'plaza',
      playerX: 0, playerS: 0, partX: 0, bps: 5, reducedFlicker: false,
      side: (_id, m, variant) => { const v = new THREE.Vector3().setFromMatrixPosition(m); placed.push({ x: v.x, s: -v.z, variant }); },
    };
    const reaches = seg.obstacles.filter((o) => o.kind === 'reach');
    expect(reaches.length).toBeGreaterThanOrEqual(8);
    let shared = 0;
    for (const o of reaches) {
      obstacleState(o, 0, -1, st);
      pc.o = o; pc.reachNb = reachNeighbours(o, seg.obstacles);
      arm.begin(); arm.placeEx(pc); arm.end();
    }
    for (const k of placed) if (k.variant === 'reachBoth') { shared++; expect(Math.abs(Math.abs(k.x) - REACH_GAP_X)).toBeLessThan(1e-6); }
    expect(shared).toBeGreaterThanOrEqual(4);   // 75、232.5 两行各两处车道缝
    for (const a of placed) {
      for (const b of placed) if (a !== b && Math.abs(a.s - b.s) < 0.3) expect(Math.abs(a.x - b.x), `@s ${a.s.toFixed(1)}`).toBeGreaterThanOrEqual(0.4);
      for (const q of seg.obstacles) {
        if (q.kind !== 'legs' || Math.abs((q.s0 + q.s1) / 2 - a.s) > 0.5) continue;
        obstacleState(q, 0, -1, st);
        expect(Math.abs((st.x0 + st.x1) / 2 - a.x), `legs @s ${a.s.toFixed(1)}`).toBeGreaterThanOrEqual(0.45);
      }
    }
  });
});

describe('弱化轮廓的头（npc-standing-4）', () => {
  it('着色器：弱化实例收掉 SOFT_HIDE 的顶点，完整着色不受影响', () => {
    const lam = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    expect(patchNpcShader(lam, true)).toBe(true);
    expect(lam.vertexShader).toContain('if ( aHw.y < -1.5 && iHw.y < -0.5 ) transformed = vec3( 0.0 );');
    expect(lam.vertexShader).toContain('aHw.y < -1.5 ? 0.0 : -aHw.y');
    // 弱化 + 自发光（softGlow）：烟头这类逐顶点发光的部分不弱化，强度按 instanceGlow 解出
    expect(lam.vertexShader).toContain('vHwSoft = aHw.y > 0.5 ? 0.0 :');
    expect(lam.vertexShader).toContain('iHw.y < -0.5 ? -iHw.y - 1.0 : max( iHw.y, 0.0 )');
  });

  it('头发片（且只有头发片）标了 SOFT_HIDE：高画质 head、中画质 upper', () => {
    const f = new LegForest(); f.init(fakeCtx('high'));
    for (const id of ['head', 'upper'] as const) {
      const geo = f.pool(id).mesh.geometry, pos = geo.getAttribute('position'), hw = geo.getAttribute('aHw');
      let hidden = 0;
      for (let i = 0; i < pos.count; i++) {
        if (hw.getY(i) !== SOFT_HIDE) continue;
        hidden++;
        // 头发片在后脑（z ≤ −0.05），不低于头底（髋关节以上 0.66 m；长发片垂到 0.67）
        expect(pos.getZ(i), id).toBeLessThanOrEqual(-0.049);
        expect(pos.getY(i), id).toBeGreaterThanOrEqual(0.66);
      }
      expect(hidden, id).toBeGreaterThan(0);
    }
  });
});
