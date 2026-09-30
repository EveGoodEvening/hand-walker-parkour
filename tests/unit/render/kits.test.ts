// tests/unit/render/kits.test.ts —— 校园 kit（DESIGN.md §5.9，WP3 验收 1、6）：
// 每个 chunk ≤ 3 次 draw call、三角形 ≤ 6k（低）/ 12k（高）；灯管每 2 拍一盏；墙镜开口处确实是洞，洞后面有镜中房间。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EnvKit, KitChunk, Opening } from '../../../src/core/contracts';
import { KIT_VARIANTS } from '../../../src/levels/kitSymbols';
import type { CompiledSegment, CompiledSurface } from '../../../src/levels/schema';
import { createRng } from '../../../src/core/rng';
import type { HwKitChunkContext } from '../../../src/render/kitContext';
import { canteenKit } from '../../../src/render/kits/school/canteen';
import { classroomKit } from '../../../src/render/kits/school/classroom';
import { corridorKit } from '../../../src/render/kits/school/corridor';
import { labRoomKit } from '../../../src/render/kits/school/labRoom';
import { stairsKit } from '../../../src/render/kits/school/stairs';
import { washroomKit } from '../../../src/render/kits/school/washroom';
import { ATLAS } from '../../../src/render/textures/school';
import { fakeCtx, triCount } from './helpers';

const KITS: EnvKit[] = [classroomKit, corridorKit, washroomKit, stairsKit, canteenKit, labRoomKit];

function segment(kit: string, variant: string, o: { stride?: number; beats?: number; surfaces?: CompiledSurface[]; stairs?: { dir: 'up' | 'down'; risePerBeat: number } } = {}): CompiledSegment {
  const stride = o.stride ?? (kit === 'stairs' ? 0.6 : 1);
  const beats = o.beats ?? 80;
  const s0 = 100, s1 = s0 + beats * stride;
  const st = o.stairs ?? (kit === 'stairs' ? { dir: variant.includes('Up') ? 'up' : 'down', risePerBeat: 0.16 } as const : undefined);
  const floorY = (s: number) => (st ? (st.dir === 'up' ? 1 : -1) * st.risePerBeat * Math.max(0, Math.min(beats, (s - s0) / stride)) : 0);
  return {
    def: { id: 'seg', kind: 'run', kit, variant, stairs: st } as never, index: 0, kind: 'run', s0, s1, stride,
    cadenceAt: () => 5, timeAt: (b) => b / 5, beatAt: (t) => t * 5, floorY,
    obstacles: [], surfaces: o.surfaces ?? [], windows: [], npcGroups: [], events: [], checkpoints: [0],
  };
}

function chunk(kit: EnvKit, seg: CompiledSegment, variant: string, i: number, tier: 'low' | 'high', o: { generic?: boolean; openings?: Opening[]; prev?: boolean; next?: boolean } = {}): { kc: KitChunk; s0: number; s1: number } {
  const ctx = fakeCtx(tier);
  const len = 2 * Math.max(1, Math.round(12 / (2 * seg.stride))) * seg.stride;
  const s0 = seg.s0 + i * len, s1 = Math.min(seg.s1, s0 + len);
  const kctx: HwKitChunkContext = {
    seg, variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0), openings: o.openings ?? [],
    quality: ctx.quality, rng: createRng(3, `${kit.id}:${variant}:${i}`), mat: ctx.mat, tex: ctx.tex,
    hw: { generic: o.generic ?? false, prev: o.prev === false ? null : { kit: 'corridor', variant: 'morning' }, next: o.next === false ? null : { kit: 'corridor', variant: 'morning' }, chunkLen: len, plateRect: () => ATLAS.plates[0] },
  };
  return { kc: kit.build(kctx), s0, s1 };
}

/** 在 static 几何体里找位于平面 axis = value 上的三角形，检查点 (u, v) 是否被覆盖。 */
function covered(g: THREE.BufferGeometry, axis: 'x' | 'z', value: number, u: number, v: number): boolean {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const a = new THREE.Vector2(), b = new THREE.Vector2(), c = new THREE.Vector2(), q = new THREE.Vector2(u, v);
  const tri = new THREE.Triangle(), P = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    const on = (k: number) => Math.abs((axis === 'x' ? p.getX(k) : p.getZ(k)) - value) < 1e-3;
    if (!on(i) || !on(i + 1) || !on(i + 2)) continue;
    const uv = (k: number, out: THREE.Vector2) => out.set(axis === 'x' ? p.getZ(k) : p.getX(k), p.getY(k));
    uv(i, a); uv(i + 1, b); uv(i + 2, c);
    tri.set(new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0), new THREE.Vector3(c.x, c.y, 0));
    if (tri.getArea() < 1e-8) continue;
    if (tri.containsPoint(P.set(q.x, q.y, 0))) return true;
  }
  return false;
}

describe('校园 kit：预算（§5.9、WP3 验收 1）', () => {
  it('6 个 kit 覆盖 KIT_VARIANTS 里的全部变体', () => {
    for (const k of KITS) expect([...k.variants].sort()).toEqual([...KIT_VARIANTS[k.id]].sort());
    for (const k of KITS) expect(k.owner).toBe('WP3');
  });

  for (const kit of KITS) {
    for (const variant of kit.variants) {
      it(`${kit.id}.${variant}：每个 chunk ≤ 3 个几何体，三角形 ≤ 6k（低）/ 12k（高）`, () => {
        for (const tier of ['low', 'high'] as const) {
          const seg = segment(kit.id, variant);
          const len = 2 * Math.max(1, Math.round(12 / (2 * seg.stride))) * seg.stride;
          const last = Math.ceil((seg.s1 - seg.s0) / len - 1e-6) - 1;
          for (const [i, generic, prev, next] of [[0, false, false, true], [1, true, true, true], [2, false, true, true], [last, false, true, false]] as const) {
            const { kc, s0, s1 } = chunk(kit, seg, variant, i, tier, { generic, prev, next });
            const geos = [kc.floor, kc.static, kc.emissive].filter(Boolean);
            expect(geos.length).toBeLessThanOrEqual(3);
            const tris = geos.reduce((n, g) => n + triCount(g), 0);
            expect(tris).toBeLessThanOrEqual(tier === 'low' ? 6000 : 12000);
            expect(tris).toBeGreaterThan(50);
            for (const l of kc.lamps) { expect(l.s).toBeGreaterThanOrEqual(s0 - 0.01); expect(l.s).toBeLessThanOrEqual(s1 + 0.01); }
            // 局部坐标：chunk 起点的地面在 y = 0 附近
            const box = new THREE.Box3().setFromBufferAttribute(kc.floor.getAttribute('position') as THREE.BufferAttribute);
            expect(box.max.z).toBeLessThanOrEqual(3.61);
            expect(box.min.z).toBeGreaterThanOrEqual(-(s1 - s0) - 0.01);
            expect(kc.floor.getAttribute('uv')).toBeTruthy();
            expect(kc.static.getAttribute('aChalk')).toBeTruthy();
          }
        }
      });
    }
  }

  it('室内灯管每 2 拍一盏（视觉节拍，§5.9）', () => {
    for (const kit of [corridorKit, classroomKit, washroomKit, canteenKit, labRoomKit]) {
      const seg = segment(kit.id, kit.variants[0] as string);
      const { kc } = chunk(kit, seg, kit.variants[0] as string, 1, 'low', { generic: true });
      const ss = kc.lamps.filter((l) => l.kind === 'tube').map((l) => l.s).sort((a, b) => a - b);
      expect(ss.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < ss.length; i++) expect((ss[i] as number) - (ss[i - 1] as number)).toBeCloseTo(2 * seg.stride, 6);
    }
    // 走廊的「虚空」变体没有灯（只有掌光）
    const v = chunk(corridorKit, segment('corridor', 'void'), 'void', 1, 'low', { generic: true });
    expect(v.kc.lamps.length).toBe(0);
  });

  it('楼梯段地面写深度；其余地面带贴图提示与光泽', () => {
    const st = chunk(stairsKit, segment('stairs', 'dayDown'), 'dayDown', 1, 'low', { generic: true }).kc;
    expect(st.floor.userData.hwDepthWrite).toBe(true);
    const co = chunk(corridorKit, segment('corridor', 'wet'), 'wet', 1, 'low', { generic: true }).kc;
    expect(co.floor.userData.hwFloorMap.id).toBe('terrazzo');
    expect(co.floor.userData.hwGloss).toBeGreaterThan(0.5);
  });
});

describe('开口（§5.8，WP3 验收 6）', () => {
  it('侧墙镜：开口处确实是洞，洞后 3.8 m 有镜中房间的背墙；开口外仍然是墙', () => {
    for (const [kit, variant] of [[corridorKit, 'morning'], [washroomKit, 'morning'], [corridorKit, 'labNorth'], [classroomKit, 'morning'], [canteenKit, 'windowWall']] as const) {
      const seg = segment(kit.id, variant);
      const len = 12;
      const op: Opening = { side: 'L', s0: seg.s0 + len + 2, s1: seg.s0 + len + 8, y0: 0.25, y1: 1.6, surfaceId: 'm' };
      const surf = { id: 'm', kind: 'mirror', side: 'L', from: 14, to: 20, s0: op.s0, s1: op.s1, y: [0.25, 1.6], backdrop: 'darkRoom', plane: [1, 0, 0, 1.8] } as CompiledSurface;
      seg.surfaces.push(surf);
      const { kc, s0 } = chunk(kit, seg, variant, 1, 'low', { openings: [op] });
      const z = (s: number) => -(s - s0);
      expect(covered(kc.static, 'x', -1.8, z(op.s0 + 3), 0.9)).toBe(false);          // 洞
      expect(covered(kc.static, 'x', -1.8 - 3.8, z(op.s0 + 3), 0.9)).toBe(true);     // 镜中房间的背墙
      if (kit !== classroomKit) expect(covered(kc.static, 'x', -1.8, z(op.s1 + 1.5), 0.6)).toBe(true); // 开口外是墙
    }
  });

  it('端墙镜：横墙中间留镜子大小的洞，两侧是墙', () => {
    const seg = segment('corridor', 'mirrorEnd', { beats: 30 });
    const op: Opening = { side: 'end', s0: seg.s1, s1: seg.s1, y0: 0.15, y1: 1.9, surfaceId: 'e' };
    const { kc, s0 } = chunk(corridorKit, seg, 'mirrorEnd', 2, 'low', { openings: [op], next: false });
    const ze = -(op.s0 - s0);
    expect(covered(kc.static, 'z', ze, 0, 1.0)).toBe(false);
    expect(covered(kc.static, 'z', ze, 1.4, 1.0)).toBe(true);
    expect(covered(kc.static, 'z', ze, 0, 2.5)).toBe(true);
    expect(covered(kc.static, 'z', ze - 3.8, 0, 1.0)).toBe(true);
  });
});
