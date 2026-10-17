// 路边坐着的人坐在 kit 自己的家具上（视觉审查 school-sets-1 / -2 / -8、npc-seated-2 / -7）：
// 按真实章节建教室、食堂 kit（拦截 KitGeo.box / prism 记下课桌、椅子、餐桌、圆凳、方柱），再展开人群，逐个比位置。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EnvKit } from '../../../src/core/contracts';
import { createRng } from '../../../src/core/rng';
import { compile } from '../../../src/levels/compile';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, CompiledChapter, CompiledSegment, RunSegmentDef } from '../../../src/levels/schema';
import { KitGeo } from '../../../src/render/geom';
import type { HwKitChunkContext } from '../../../src/render/kitContext';
import { canteenKit } from '../../../src/render/kits/school/canteen';
import { classroomKit } from '../../../src/render/kits/school/classroom';
import { footOutSeats, hwChunkLen } from '../../../src/render/kits/school/seats';
import { expandChapter, type Decor } from '../../../src/render/npc/crowds';
import { FEET, LegForest, newPerson } from '../../../src/render/npc/LegForest';
import { lookFor } from '../../../src/render/npc/specials';
import { ATLAS } from '../../../src/render/textures/school';
import { fakeCtx } from './helpers';

interface Box { x0: number; x1: number; s0: number; s1: number; y1: number; tag: string; cx: number; cs: number }
type Pick = (c: readonly number[], sz: readonly number[]) => string | null;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** 按 ChunkStreamer 的切法建整段（全部按专建 chunk），记下 pick 认出的 box 与 prism（圆凳，tag 'stool'）。 */
function kitFurniture(ch: CompiledChapter, seg: CompiledSegment, kit: EnvKit, pick: Pick): Box[] {
  const out: Box[] = [];
  const proto = KitGeo.prototype as unknown as Record<'box' | 'prism', (...a: unknown[]) => unknown>;
  const box0 = proto.box, prism0 = proto.prism;
  let cs0 = 0;
  proto.box = function (this: KitGeo, c: number[], sz: number[], ...rest: unknown[]) {
    const tag = pick(c, sz);
    if (tag) out.push({ x0: c[0]! - sz[0]! / 2, x1: c[0]! + sz[0]! / 2, s0: cs0 - c[2]! - sz[2]! / 2, s1: cs0 - c[2]! + sz[2]! / 2, y1: c[1]! + sz[1]! / 2, tag, cx: c[0]!, cs: cs0 - c[2]! });
    return box0.call(this, c, sz, ...rest);
  } as never;
  proto.prism = function (this: KitGeo, c: number[], r: number, h: number, ...rest: unknown[]) {
    if (near(r, 0.15) && near(h, 0.03)) out.push({ x0: c[0]! - r, x1: c[0]! + r, s0: cs0 - c[2]! - r, s1: cs0 - c[2]! + r, y1: c[1]! + h / 2, tag: 'stool', cx: c[0]!, cs: cs0 - c[2]! });
    return prism0.call(this, c, r, h, ...rest);
  } as never;
  try {
    const ctx = fakeCtx('high');
    const len = hwChunkLen(seg.stride);
    const idx = ch.segments.indexOf(seg);
    const nb = (dir: -1 | 1) => {
      for (let j = idx + dir; j >= 0 && j < ch.segments.length; j += dir) {
        const s = ch.segments[j] as CompiledSegment;
        if (s.kind === 'still') continue;
        const d = s.def as RunSegmentDef;
        return { kit: d.kit, variant: d.variant };
      }
      return null;
    };
    const variant = (seg.def as RunSegmentDef).variant;
    for (let i = 0; seg.s0 + i * len < seg.s1 - 0.05; i++) {
      const s0 = seg.s0 + i * len, s1 = Math.min(seg.s1, s0 + len);
      cs0 = s0;
      const kctx: HwKitChunkContext = {
        seg, variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0), openings: [],
        quality: ctx.quality, rng: createRng(ch.seed, `chunk:${seg.def.id}:${i}`), mat: ctx.mat, tex: ctx.tex,
        hw: { generic: false, prev: nb(-1), next: nb(1), chunkLen: len, plateRect: () => ATLAS.plates[0] ?? null },
      };
      kit.build(kctx);
    }
  } finally { proto.box = box0; proto.prism = prism0; }
  return out;
}

const overlaps = (b: Box, x0: number, x1: number, s0: number, s1: number) => b.x0 < x1 && b.x1 > x0 && b.s0 < s1 && b.s1 > s0;

function setup(chId: 'ch1' | 'ch2', segId: string, kit: EnvKit, pick: Pick) {
  const ch = compile(getChapter(chId) as ChapterDef);
  const seg = ch.segments.find((s) => s.def.id === segId) as CompiledSegment;
  const boxes = kitFurniture(ch, seg, kit, pick);
  const { decor } = expandChapter(ch.seed, ch.segments);
  return { seg, boxes, decor: decor.filter((d) => d.seg === seg.index) };
}

describe('坐着的人坐在 kit 的家具上', () => {
  const classPick: Pick = (_c, sz) => (near(sz[0]!, 0.6) && near(sz[1]!, 0.03) ? 'desk' : near(sz[0]!, 0.38) && near(sz[1]!, 0.025) ? 'chair' : null);
  const canteenPick: Pick = (_c, sz) => (near(sz[0]!, 0.5) && sz[1]! > 3 ? 'pillar' : near(sz[0]!, 1.2) && near(sz[1]!, 0.03) ? 'table' : null);

  it('1-1 教室：每个坐着的同学都坐在靠过道一列的课桌椅上，不另带椅子，不压课桌', () => {
    const { seg, boxes, decor } = setup('ch1', '1-1', classroomKit, classPick);
    const seated = decor.filter((d) => d.pose === 'seat');
    expect(seated.length).toBeGreaterThan(20);
    const chairs = boxes.filter((b) => b.tag === 'chair'), desks = boxes.filter((b) => b.tag === 'desk');
    for (const d of seated) {
      const where = `x ${d.x.toFixed(2)} @${(d.s - seg.s0).toFixed(2)}`;
      expect(d.kitSeat, where).toBe(true);
      // 髋部在椅子座面中心 5 cm 内（座面中心 = box 中心）
      expect(chairs.some((c) => Math.abs(c.cx - d.x) < 0.05 && Math.abs(c.cs - d.s) < 0.05), where).toBe(true);
      // 身体（髋部 ±0.18）不进课桌
      expect(desks.some((b) => overlaps(b, d.x - 0.18, d.x + 0.18, d.s - 0.18, d.s + 0.18)), where).toBe(false);
      // 面朝黑板（−z），背对玩家
      expect(Math.cos(d.yaw), where).toBeLessThan(-0.9);
    }
    // 伸脚的人（自带椅子，|x| ≈ 1.82）身边同侧没有 kit 的课桌椅
    const feet = footOutSeats(seg.obstacles);
    expect(feet.length).toBe(2);
    for (const f of feet) {
      const hit = boxes.filter((b) => Math.sign(b.cx) === f.side && overlaps(b, f.side * 1.82 - 0.25, f.side * 1.82 + 0.25, f.s - 0.3, f.s + 0.3));
      expect(hit.map((b) => `${b.tag}@${(b.cs - seg.s0).toFixed(2)}`), `footOut @${(f.s - seg.s0).toFixed(2)}`).toEqual([]);
    }
  });

  for (const segId of ['2-2', '2-4', '2-6']) {
    it(`${segId} 食堂：坐着的人坐在靠过道一列餐桌的圆凳上、面朝桌子；站着的人不进餐桌和方柱`, () => {
      const { seg, boxes, decor } = setup('ch2', segId, canteenKit, canteenPick);
      const seated = decor.filter((d) => d.pose === 'seat');
      expect(seated.length).toBeGreaterThan(10);
      const stools = boxes.filter((b) => b.tag === 'stool'), tables = boxes.filter((b) => b.tag === 'table'), pillars = boxes.filter((b) => b.tag === 'pillar');
      for (const d of seated) {
        const where = `x ${d.x.toFixed(2)} @${(d.s - seg.s0).toFixed(2)}`;
        expect(d.kitSeat, where).toBe(true);
        const st = stools.find((c) => Math.abs(c.cx - d.x) < 0.05 && Math.abs(c.cs - d.s) < 0.05);
        expect(st, where).toBeDefined();
        // 坐高与凳面一致（髋 0.46，凳面 0.435）
        expect(0.46 - (st as Box).y1, where).toBeGreaterThan(0);
        expect(0.46 - (st as Box).y1, where).toBeLessThan(0.05);
        // 朝向桌子中心：桌子在人的 −s（+z）一侧时 yaw ≈ 0，反之 yaw ≈ π
        const t = tables.find((b) => Math.abs(b.cx - d.x) < 0.4 && Math.abs(b.cs - d.s) < 0.6) as Box;
        expect(t, where).toBeDefined();
        const toward = t.cs < d.s ? 1 : -1;          // +z = −s
        expect(Math.cos(d.yaw) * toward, where).toBeGreaterThan(0.9);
        expect(pillars.some((b) => overlaps(b, d.x - 0.2, d.x + 0.2, d.s - 0.2, d.s + 0.2)), where).toBe(false);
      }
      for (const d of decor.filter((dd) => dd.pose === 'stand')) {
        const where = `stand x ${d.x.toFixed(2)} @${(d.s - seg.s0).toFixed(2)}`;
        expect([...tables, ...pillars, ...stools].some((b) => overlaps(b, d.x - 0.17, d.x + 0.17, d.s - 0.15, d.s + 0.15)), where).toBe(false);
      }
      // 每米的人数和以前（每 1.25 m 一人）相当：不加重 npcMax 与低画质预算
      const sides = segId === '2-6' ? 1 : 2;
      const dens = ((seg.def as RunSegmentDef).npcs ?? []).find((g) => g.kind === 'seatedRow')?.density ?? 0;
      const perM = seated.length / ((seg.s1 - seg.s0) * sides);
      expect(perM).toBeLessThan((dens / 1.25) * 1.3);
    });
  }

  it('餐桌的钢架把四只圆凳和中柱连成一体（每只圆凳的立杆都落在一根横梁上）', () => {
    const ch = compile(getChapter('ch2') as ChapterDef);
    const seg = ch.segments.find((s) => s.def.id === '2-2') as CompiledSegment;
    const beamPick: Pick = (_c, sz) => (near(sz[1]!, 0.04) && (near(sz[0]!, 0.04) || near(sz[2]!, 0.04)) && Math.max(sz[0]!, sz[2]!) > 0.5 ? 'beam' : null);
    const boxes = kitFurniture(ch, seg, canteenKit, beamPick);
    const beams = boxes.filter((b) => b.tag === 'beam'), stools = boxes.filter((b) => b.tag === 'stool');
    expect(stools.length).toBeGreaterThan(40);
    for (const st of stools) expect(beams.some((b) => b.x0 <= st.cx + 1e-6 && b.x1 >= st.cx - 1e-6 && b.s0 <= st.cs + 1e-6 && b.s1 >= st.cs - 1e-6), `stool ${st.cx.toFixed(2)} @${st.cs.toFixed(2)}`).toBe(true);
  });
});

describe('低画质：坐着的人腿分两段', () => {
  it('大腿水平、小腿竖直，没有从髋斜到脚踝的 45° 直棍；站着的人仍是一根', () => {
    const f = new LegForest(); f.init(fakeCtx('low'));
    const p = newPerson(lookFor('student', 1, 'seat'));
    p.yaw = Math.PI; p.hipH = 0.46; p.hipL = p.hipR = Math.PI / 2; p.kneeL = p.kneeR = Math.PI / 2; p.seated = true;
    p.legYawL = -0.08; p.legYawR = 0.08; p.stance = 0.11;
    const legs = (): Array<{ o: THREE.Vector3; d: THREE.Vector3 }> => {
      const pool = f.pool('feet'), m = new THREE.Matrix4(), out: Array<{ o: THREE.Vector3; d: THREE.Vector3 }> = [];
      for (let i = 0; i < pool.n; i++) {
        if (pool.variantAt(i) !== FEET.leg) continue;
        pool.matrixAt(i, m);
        const o = new THREE.Vector3().setFromMatrixPosition(m);
        out.push({ o, d: new THREE.Vector3(0, -1, 0).applyMatrix4(m).sub(o) });
      }
      return out;
    };
    f.begin(); f.add(p); f.end();
    const seg = legs();
    expect(seg.length).toBe(4);
    let flat = 0, upright = 0;
    for (const { o, d } of seg) {
      const ang = Math.acos(Math.min(1, Math.abs(d.y) / d.length())) / (Math.PI / 180);
      expect(ang < 10 || ang > 80, `${ang.toFixed(1)}°`).toBe(true);
      if (ang > 80) { flat++; expect(o.y).toBeCloseTo(0.46, 2); } else { upright++; expect(o.y).toBeCloseTo(0.46, 2); }
    }
    expect(flat).toBe(2); expect(upright).toBe(2);
    const q = newPerson(lookFor('student', 1, 'stand'));
    f.begin(); f.add(q); f.end();
    expect(legs().length).toBe(2);
  });
});
