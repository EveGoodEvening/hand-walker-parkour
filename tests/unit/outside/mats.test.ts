// tests/unit/outside/mats.test.ts —— WP4 对 MaterialsAPI 的适配层（render/sets/outside/lib/mats.ts；契约申请 2026-10-01）。
// 不依赖 CORE 桩「每次返回新实例」的具体行为：换成一个按参数缓存的 MaterialsAPI，WP4 的改动不能漏到别人的材质上。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { MaterialsAPI, ViewContext } from '../../../src/core/contracts';
import { FlatMaterials } from '../../../src/core/fallbacks';
import { getSet } from '../../../src/core/registry';
import type { SetId } from '../../../src/core/types';
import '../../../src/render/sets/outside/bathroom';
import '../../../src/render/sets/outside/bedroom';
import '../../../src/render/sets/outside/bus';
import '../../../src/render/sets/outside/home';
import '../../../src/render/sets/outside/infirmary';
import '../../../src/render/sets/outside/palmEye';
import '../../../src/render/sets/outside/water';
import { MAT_POLICY, tuneMat, wp4Basic } from '../../../src/render/sets/outside/lib/mats';
import { Outdoor } from '../../../src/render/weather/outdoor';
import { viewContext } from './helpers';

/** 按参数缓存的材质工厂（WP3 可能的一种实现）：同样的参数返回同一个实例，并且挂了 onBeforeCompile 补丁。 */
class CachingMaterials implements MaterialsAPI {
  private flat = new FlatMaterials();
  private cache = new Map<string, THREE.Material>();
  readonly patch = (_s: unknown) => { /* LampField 补丁 */ };
  private key(kind: string, o: object): string {
    return kind + JSON.stringify(o, (k, v: unknown) => (k === 'map' && v ? (v as THREE.Texture).uuid : v));
  }
  lambert(o: Parameters<MaterialsAPI['lambert']>[0] = {}): THREE.MeshLambertMaterial {
    const k = this.key('l', o);
    let m = this.cache.get(k) as THREE.MeshLambertMaterial | undefined;
    if (!m) { m = this.flat.lambert(o); m.onBeforeCompile = this.patch; this.cache.set(k, m); }
    return m;
  }
  basic(o: Parameters<MaterialsAPI['basic']>[0] = {}): THREE.MeshBasicMaterial {
    const k = this.key('b', o);
    let m = this.cache.get(k) as THREE.MeshBasicMaterial | undefined;
    if (!m) { m = this.flat.basic(o); m.onBeforeCompile = this.patch; this.cache.set(k, m); }
    return m;
  }
  ensureChalkAttr(g: THREE.BufferGeometry): void { this.flat.ensureChalkAttr(g); }
}

const SETS: Array<[SetId, string]> = [
  ['bus', 'default'], ['home', 'default'], ['bathroom', 'default'], ['palmEye', 'default'], ['water', 'default'],
  ['bedroom', 'feet'], ['bedroom', 'ceiling'], ['infirmary', 'bed'], ['infirmary', 'ceiling'],
];

function withMat(mat: MaterialsAPI): ViewContext { return { ...viewContext('medium', true), mat }; }
function materials(o: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  o.traverse((c) => { const m = (c as THREE.Mesh).material; if (m) out.push(...(Array.isArray(m) ? m : [m])); });
  return out;
}
const pristine = (m: THREE.Material) => ({
  stencilWrite: m.stencilWrite, depthWrite: m.depthWrite, colorWrite: m.colorWrite, vertexColors: m.vertexColors, toneMapped: m.toneMapped,
  fog: (m as THREE.MeshBasicMaterial).fog, opacity: m.opacity,
});

describe('MaterialsAPI 适配层：WP4 的改动只落在 WP4 独占的实例上', () => {
  afterEach(() => { MAT_POLICY.clone = 'onReuse'; });

  it('同一个实例第二次交给 WP4 时先克隆，并带上 onBeforeCompile / customProgramCacheKey', () => {
    const api = new CachingMaterials();
    const a = wp4Basic(api, { color: 0xffffff }, { vertexColors: true });
    const b = wp4Basic(api, { color: 0xffffff }, { colorWrite: false, depthWrite: false });
    expect(b).not.toBe(a);
    expect(a.colorWrite).toBe(true);
    expect(a.depthWrite).toBe(true);
    expect(b.onBeforeCompile).toBe(api.patch);
    // 第三次：从原样副本克隆，不带上前两次的改动
    const c = wp4Basic(api, { color: 0xffffff });
    expect(c.vertexColors).toBe(false);
    expect(c.colorWrite).toBe(true);
    expect(b.customProgramCacheKey).toBe(a.customProgramCacheKey);
    // CORE 桩每次返回新实例：不克隆，原样使用
    const flat = new FlatMaterials();
    const m = flat.basic({ color: 0xffffff });
    expect(tuneMat(m, { vertexColors: true })).toBe(m);
  });

  it('按参数缓存时，WP4 的 set 之间互不污染（水面的模板测试、遮罩的 colorWrite 不会漏到别的 set）', () => {
    const api = new CachingMaterials();
    const roots = SETS.map(([id, v]) => getSet(id)!.build(withMat(api), v));
    const water = roots[SETS.findIndex(([id]) => id === 'water')]!;
    const stencilled = new Set(materials(water).filter((m) => m.stencilWrite));
    expect(stencilled.size).toBeGreaterThan(0);
    for (const r of roots) {
      if (r === water) continue;
      for (const m of materials(r)) {
        expect(stencilled.has(m)).toBe(false);
        expect(m.stencilWrite).toBe(false);
        expect(m.colorWrite).toBe(true);
      }
    }
  });

  it("MAT_POLICY.clone = 'always'：WP3 自己的 World 用的同一个实例，建完全部 set 和户外系统之后原样不动", () => {
    MAT_POLICY.clone = 'always';
    const api = new CachingMaterials();
    // World 先拿到的实例（与 WP4 请求的参数相同）
    const world = [api.lambert({ vertexColors: true, flat: true }), api.basic({ color: 0xffffff }),
      api.basic({ color: 0xffffff, additive: true, transparent: true, opacity: 1 })];
    const before = world.map(pristine);
    const ctx = withMat(api);
    for (const [id, v] of SETS) getSet(id)!.build(ctx, v);
    const o = new Outdoor();
    o.init(ctx);
    expect(world.map(pristine)).toEqual(before);
    for (const m of world) expect(m.map).toBe(null);
  });

  it('kits / sets / weather 里不直接写材质的渲染状态（只经 mats.ts）', () => {
    const roots = ['sets/outside', 'weather', 'kits/outside'].map((d) => fileURLToPath(new URL(`../../../src/render/${d}`, import.meta.url)));
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    for (const r of roots) walk(r);
    const bad = /\.(depthWrite|colorWrite|stencil\w*|toneMapped|vertexColors|fog)\s*=(?!=)/;
    for (const f of files) {
      if (f.endsWith(join('lib', 'mats.ts'))) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => { if (!l.trim().startsWith('//')) expect(bad.test(l), `${f}:${i + 1} ${l.trim()}`).toBe(false); });
    }
  });
});
