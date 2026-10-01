// tests/unit/render/plates.test.ts —— 关卡数据里的门牌放大、自发光（U6）。
// 5-11 翻转之后的「高二（7）班」以前按通用班牌的尺寸画（0.38 × 0.12 m，1280×720 下约 45×14 px，字高约 6 px），
// 在 voidDark 里又暗，反字读不出。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CompiledSegment, CompiledSurface } from '../../../src/levels/schema';
import { createRng } from '../../../src/core/rng';
import { compile } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import type { ChapterDef, CompiledChapter } from '../../../src/levels/schema';
import type { HwKitChunkContext } from '../../../src/render/kitContext';
import { corridorKit } from '../../../src/render/kits/school/corridor';
import '../../../src/render/kits/school/classroom';
import '../../../src/render/kits/placeholder';
import { DATA_PLATE, DOOR_PLATE, SteadyStatGeo, dataPlates, makeEnv } from '../../../src/render/kits/school/shell';
import { ATLAS, ATLAS_WHITE_UV, platePx } from '../../../src/render/textures/school';
import { patchSteadyGlow } from '../../../src/render/lampField';
import { World } from '../../../src/render/ChunkStreamer';
import { registerAtmospheres } from '../../../src/render/atmosphere';
import { fakeCtx } from './helpers';

registerAtmospheres();

const PLATE: CompiledSurface = { id: 'plate7b', kind: 'doorPlate', side: 'L', from: 213, to: 213, y: [1.3, 1.6], text: '高二（7）班', s0: 106, s1: 106, plane: [1, 0, 0, 1.8] } as CompiledSurface;

function segment(surfaces: CompiledSurface[]): CompiledSegment {
  return {
    def: { id: '5-11', kind: 'run', kit: 'corridor', variant: 'void' } as never, index: 0, kind: 'run', s0: 100, s1: 140, stride: 1.1,
    cadenceAt: () => 5, timeAt: (b) => b / 5, beatAt: (t) => t * 5, floorY: () => 0,
    obstacles: [], surfaces, windows: [], npcGroups: [], events: [], checkpoints: [0],
  };
}

function ctxFor(seg: CompiledSegment, s0: number, s1: number): HwKitChunkContext {
  const ctx = fakeCtx('low');
  return {
    seg, variant: 'void', s0, s1, stride: seg.stride, floorY: () => 0, openings: [], quality: ctx.quality, rng: createRng(3, 'plate'), mat: ctx.mat, tex: ctx.tex,
    hw: { generic: false, prev: null, next: null, chunkLen: 13.2, plateRect: () => ATLAS.plates[0] },
  };
}

describe('数据门牌（U6）', () => {
  it('dataPlates：牌面宽 ≥ 0.9 m、高 ≥ 0.28 m，牌面顶点 aSteady = 1；build() 自动带上 aSteady 属性', () => {
    const seg = segment([PLATE]);
    const e = makeEnv(ctxFor(seg, 100, 113.2));
    const g = new SteadyStatGeo(ATLAS_WHITE_UV);
    dataPlates(g, e);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    let steady = 0;
    for (let i = 0; i < g.vertexCount; i++) {
      if ((g.steady[i] as number) !== 1) continue;
      steady++;
      box.expandByPoint(v.set(g.pos[i * 3] as number, g.pos[i * 3 + 1] as number, g.pos[i * 3 + 2] as number));
      // 牌面贴的是门牌在贴图集里的矩形
      const u = g.uv[i * 2] as number, w = g.uv[i * 2 + 1] as number, r = ATLAS.plates[0];
      expect(u).toBeGreaterThanOrEqual(r[0] - 1e-6); expect(u).toBeLessThanOrEqual(r[2] + 1e-6);
      expect(w).toBeGreaterThanOrEqual(r[1] - 1e-6); expect(w).toBeLessThanOrEqual(r[3] + 1e-6);
    }
    expect(steady).toBe(12);                                  // 正反两面，各两个三角形
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThanOrEqual(0.9);              // 垂直于墙伸出来的长度
    expect(size.y).toBeGreaterThanOrEqual(0.28);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(1.45, 6);  // 挂在数据给的高度（U1：1.3–1.6 m）
    expect(box.min.x).toBeCloseTo(-1.8 + 0.04, 6);              // 从左墙上伸出来
    expect(box.max.x).toBeCloseTo(-1.8 + 0.04 + DATA_PLATE.len, 6);
    // 牌面与贴图集矩形同比例（字不变形）
    const r = ATLAS.plates[0];
    expect((r[2] - r[0]) / (r[3] - r[1])).toBeCloseTo(DATA_PLATE.len / DATA_PLATE.h, 2);
    const geo = g.build();
    const a = geo.getAttribute('aSteady');
    expect(a).toBeDefined();
    let ones = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) === 1) ones++;
    expect(ones).toBe(12);
    // 没有门牌的累积器不带 aSteady（与以前一样）
    expect(new SteadyStatGeo(ATLAS_WHITE_UV).build().getAttribute('aSteady')).toBeUndefined();
    // 通用班牌仍是原来的尺寸、不自发光
    expect(DOOR_PLATE).toEqual({ len: 0.38, h: 0.12, steady: false });
  });

  it('corridor.void 的专建 chunk：static 带 aSteady，门牌那几个顶点为 1', () => {
    const seg = segment([PLATE]);
    const kc = corridorKit.build(ctxFor(seg, 100, 113.2));
    const a = kc.static.getAttribute('aSteady');
    expect(a).toBeDefined();
    let ones = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) === 1) ones++;
    expect(ones).toBe(12);
  });

  it('贴图集：数据门牌的矩形宽 ≥ 256 px（中画质 512 px 的贴图集；高画质 512 px）；各矩形互不重叠、都在 0..1 里', () => {
    expect(platePx(512, 0).w).toBeGreaterThanOrEqual(256);
    expect(platePx(512, 1).w).toBeGreaterThanOrEqual(256);
    expect(platePx(1024, 0).w).toBeGreaterThanOrEqual(512);
    const rects: Array<[string, readonly [number, number, number, number]]> = [];
    for (const [k, r] of Object.entries(ATLAS)) {
      if (k === 'plates') ATLAS.plates.forEach((p, i) => rects.push([`plates${i}`, p]));
      else rects.push([k, r as readonly [number, number, number, number]]);
    }
    for (const [k, r] of rects) {
      expect(r[0], k).toBeGreaterThanOrEqual(0); expect(r[1], k).toBeGreaterThanOrEqual(0);
      expect(r[2], k).toBeLessThanOrEqual(1); expect(r[3], k).toBeLessThanOrEqual(1);
      expect(r[2] > r[0] && r[3] > r[1], k).toBe(true);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [ka, a] = rects[i] as [string, readonly number[]], [kb, b] = rects[j] as [string, readonly number[]];
        const overlap = Math.min(a[2] as number, b[2] as number) - Math.max(a[0] as number, b[0] as number) > 1e-6
          && Math.min(a[3] as number, b[3] as number) - Math.max(a[1] as number, b[1] as number) > 1e-6;
        expect(overlap, `${ka} × ${kb}`).toBe(false);
      }
    }
    // 白色区的中心在白色区里
    const w = ATLAS.white;
    expect(ATLAS_WHITE_UV[0]).toBeGreaterThan(w[0]); expect(ATLAS_WHITE_UV[0]).toBeLessThan(w[2]);
    expect(ATLAS_WHITE_UV[1]).toBeGreaterThan(w[1]); expect(ATLAS_WHITE_UV[1]).toBeLessThan(w[3]);
  });

  it('自发光补丁：aSteady 的面加一份「贴图 × 顶点色」作为自发光；没有这个属性时按 0', () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    patchSteadyGlow(m, 1);
    const sh = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as never);
    expect(sh.vertexShader).toContain('attribute float aSteady;');
    expect(sh.vertexShader).toContain('vHwSteady = aSteady;');
    expect(sh.fragmentShader).toContain('totalEmissiveRadiance += diffuseColor.rgb * vHwSteady');
    expect(m.customProgramCacheKey()).toContain('hwSteady');
    expect((m as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues.aSteady).toEqual([0]);
  });

  it('World：读章后带门牌的 chunk 用校园贴图集材质（自发光补丁、≥ 4 倍各向异性），static 里有 aSteady = 1 的顶点', async () => {
    const ctx = fakeCtx('low');
    const ch: CompiledChapter = compile(ch1 as ChapterDef);
    (ctx.surfaces as unknown as { load(c: CompiledChapter): void }).load(ch);
    const w = new World();
    w.init(ctx);
    await w.loadChapter(ch);
    expect(w.atlasTex.anisotropy).toBeGreaterThanOrEqual(4);
    let found = 0;
    w.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name !== 'static') return;
      const a = mesh.geometry.getAttribute('aSteady');
      if (!a) return;
      let ones = 0;
      for (let i = 0; i < a.count; i++) if (a.getX(i) === 1) ones++;
      if (ones === 0) return;
      found++;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      expect(mat.map).toBe(w.atlasTex);
      expect(mat.customProgramCacheKey()).toContain('hwSteady');
    });
    expect(found).toBe(1);                                    // 1-1 的「高二（7）班」
  });
});
