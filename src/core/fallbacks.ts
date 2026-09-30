// src/core/fallbacks.ts —— 注册表的 CORE 回落实现（DESIGN.md §8.2 规则 3、§8.9-10）。CORE 冻结。
// 某个包还没注册时用这些：统一亮度的 LampField 桩、最简材质工厂、纹理库桩、13 个氛围预设的近似值（§5.2）。
// 它们只保证「游戏能跑、画面看得清」，不追求效果；正式实现由 WP3 注册后自动替换。
import * as THREE from 'three';
import type { LampFieldAPI, LampFieldUniforms, LampSpec, MaterialsAPI, TextureBank } from './contracts';
import type { AtmospherePreset } from './registry';
import type { AtmosphereId } from './types';

/** 统一亮度的 LampField 桩：纹理恒为 1；op() 只记录闪烁区间，供占位世界读取（全局明灭）。 */
export class FlatLampField implements LampFieldAPI {
  readonly uniforms: LampFieldUniforms;
  private lamps = new Map<string, readonly LampSpec[]>();
  /** 最近一次 flicker / out / on 操作（占位世界用来做全局明灭）。 */
  readonly ops: Array<{ op: string; s0: number; s1: number; every?: number; delay?: number }> = [];
  constructor() {
    const data = new Uint8Array(256 * 4).fill(255);
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    this.uniforms = {
      uLampField: { value: tex }, uLampBase: { value: 0 }, uLampScale: { value: 1 / 128 }, uLampGain: { value: 0 },
      uLampColor: { value: new THREE.Color(0xeef6ff) }, uChalk: { value: 0 }, uChalkColor: { value: new THREE.Color(0xc7d0d3) },
    };
  }
  addLamps(owner: string, lamps: readonly LampSpec[]): void { this.lamps.set(owner, lamps); }
  removeLamps(owner: string): void { this.lamps.delete(owner); }
  op(op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings', s0: number, s1: number, o: { every?: number; delay?: number } = {}): void {
    this.ops.push({ op, s0, s1, ...o });
    if (this.ops.length > 32) this.ops.shift();
  }
  soundTrigger(_s: number): void { /* 桩 */ }
  ring(_s: number, _x: number, _strength: number, _radius: number): void { /* 桩 */ }
  brightnessAt(_s: number): number { return 1; }
}

/** 最简材质工厂：Lambert / Basic，补全 aChalk 属性（全 0）。 */
export class FlatMaterials implements MaterialsAPI {
  lambert(o: { vertexColors?: boolean; map?: THREE.Texture; transparent?: boolean; opacity?: number; flat?: boolean } = {}): THREE.MeshLambertMaterial {
    const p: THREE.MeshLambertMaterialParameters = { vertexColors: o.vertexColors ?? false, flatShading: o.flat ?? true };
    if (o.map) p.map = o.map;
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity ?? 1; }
    return new THREE.MeshLambertMaterial(p);
  }
  basic(o: { color?: number; map?: THREE.Texture; transparent?: boolean; opacity?: number; additive?: boolean; lampLit?: boolean } = {}): THREE.MeshBasicMaterial {
    const p: THREE.MeshBasicMaterialParameters = { color: o.color ?? 0xffffff };
    if (o.map) p.map = o.map;
    if (o.transparent || o.additive) { p.transparent = true; p.opacity = o.opacity ?? 1; p.depthWrite = false; }
    if (o.additive) p.blending = THREE.AdditiveBlending;
    return new THREE.MeshBasicMaterial(p);
  }
  ensureChalkAttr(g: THREE.BufferGeometry): void {
    if (g.getAttribute('aChalk')) return;
    const n = g.getAttribute('position')?.count ?? 0;
    g.setAttribute('aChalk', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  }
}

/** 纹理库桩：未注册的 id 返回一张 1×1 白色纹理；注册过的生成器按 id+参数缓存（读章时生成一次）。 */
export class FlatTextureBank implements TextureBank {
  private gens = new Map<string, (size: number, p: Readonly<Record<string, string | number>>) => HTMLCanvasElement>();
  private cache = new Map<string, THREE.Texture>();
  private white: THREE.Texture | null = null;
  constructor(private size = 256) {}
  get(id: string, p: Readonly<Record<string, string | number>> = {}): THREE.Texture {
    const key = `${id}:${JSON.stringify(p)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const gen = this.gens.get(id);
    let tex: THREE.Texture;
    if (gen && typeof document !== 'undefined') {
      tex = new THREE.CanvasTexture(gen(this.size, p));
    } else {
      if (!this.white) { this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true; }
      tex = this.white;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }
  register(id: string, gen: (size: number, p: Readonly<Record<string, string | number>>) => HTMLCanvasElement): void { this.gens.set(id, gen); }
}

const A = (fog: [number, number, number], hemi: [number, number, number], dir: [number, number] | null, planarDir: [number, number, number],
  lampGain: number, chalkMin: number, dark: boolean, lampColor = 0xeef6ff): AtmospherePreset => ({
  fog: { color: fog[0], near: fog[1], far: fog[2] }, hemi: { sky: hemi[0], ground: hemi[1], intensity: hemi[2] },
  dir: dir ? { color: dir[0], intensity: dir[1], dir: [0.3, -1, -0.55] } : null, planarDir, lampGain, lampColor, chalkMin, dark, background: fog[0],
});

/** §5.2 的 13 个氛围预设（近似值；WP3 的 atmosphere.ts 注册正式版本后覆盖）。 */
export const FALLBACK_ATMOSPHERES: Record<AtmosphereId, AtmospherePreset> = {
  morning:     A([0xaab4b8, 10, 48], [0xdfe7ea, 0x5d6566, 1.2], [0xe9eef0, 1.6], [0.3, -1, -0.55], 0.6, 0, false),
  noon:        A([0xb5bcbc, 12, 50], [0xe4e8e6, 0x6a706c, 1.3], [0xe9eef0, 1.4], [0.15, -1, -0.3], 0.4, 0, false),
  labNorth:    A([0x8e9ca3, 8, 38], [0x9fb0b8, 0x4b5559, 1.0], [0xc9d6de, 0.6], [0.3, -1, -0.55], 0.8, 0, false),
  nightIndoor: A([0x0f151a, 6, 30], [0x3a4650, 0x0b0f12, 0.35], [0x9fb2c0, 0.15], [0.3, -1, -0.55], 1.4, 0.35, true),
  rainNight:   A([0x0e1419, 4, 26], [0x3a4650, 0x0b0f12, 0.25], null, [0.2, -1, -0.4], 1.2, 0.35, true, 0xc8a15a),
  busNight:    A([0x0b1014, 3, 14], [0x3a4650, 0x0b0f12, 0.2], null, [0.3, -1, -0.55], 0.8, 0, true),
  homeDark:    A([0x0b1014, 3, 14], [0x3a4650, 0x0b0f12, 0.15], null, [0.3, -1, -0.55], 0.5, 0, true),
  dream:       A([0xd9dee0, 20, 120], [0xf0f3f4, 0x9aa3a6, 1.8], [0xf0f3f4, 1.2], [0.1, -0.35, -0.9], 0, 0, false),
  dreamGray:   A([0xd9dee0, 20, 60], [0xf0f3f4, 0x9aa3a6, 1.6], [0xf0f3f4, 0.8], [0.1, -0.35, -0.9], 0, 0.2, false),
  dawn:        A([0x7f909a, 8, 45], [0x9fb2c0, 0x2a3035, 0.8], [0xc9d6de, 1.0], [0.1, -0.6, 0.8], 0.3, 0, false),
  overcast:    A([0xc3c8cb, 15, 70], [0xc3c8cb, 0x6e7476, 1.5], null, [0.3, -1, -0.55], 0.4, 0, false),
  fluorescent: A([0xdde4e6, 6, 25], [0xeef3f5, 0x8a9396, 1.4], null, [0.3, -1, -0.55], 0.6, 0, false),
  voidDark:    A([0x07090b, 4, 18], [0x3a4650, 0x07090b, 0.05], null, [0.3, -1, -0.55], 1.6, 0.4, true),
};
