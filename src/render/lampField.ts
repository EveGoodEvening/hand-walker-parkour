// src/render/lampField.ts —— LampField：沿 s 的灯光亮度场（DESIGN.md §5.3，WP3）。
// 一张 256×1 的 DataTexture 覆盖玩家身后 24 m 到前方 104 m（共 128 m，每 texel 0.5 m）：
//   R = 该处的照明亮度 ÷ 2（所有灯的核函数之和 + 掌光环，不低于氛围的 lampFloor），G = 该处灯管「自身」的亮度（发光体用）。
// 每帧按灯的开、关、闪、声控状态重算并上传；闪烁与熄灭会真的照亮或压暗障碍、NPC 和墙，开销只有一次纹理采样。
// 时间一律用模拟时钟秒（test 模式下截图可复现）。运行时不分配：灯表在读章时建好，掌光环是定长环形缓冲。
// 闪烁：每盏灯每秒亮灭 ≤ 3 次（每 0.5 s 一格、每格至多一次熄灭，任意 1 s 窗口最多跨 3 格）；
// 「减少闪烁」时换成 0.5 Hz 的平滑明暗（最低 0.4）。熄灭和声控灯的开关一律 200 ms 渐变。
import * as THREE from 'three';
import type { LampFieldAPI, LampFieldUniforms, LampSpec } from '../core/contracts';
import { clamp } from '../core/math';
import { hashString } from '../core/hash';

export const LAMP_TEXELS = 256;
export const LAMP_TEXEL_M = 0.5;
export const LAMP_SPAN = LAMP_TEXELS * LAMP_TEXEL_M;   // 128 m
export const LAMP_BEHIND = 24;
/** R 通道存 亮度 ÷ LAMP_RANGE（UNORM8 只能存 0..1）。着色器里乘回来。 */
export const LAMP_RANGE = 2;
/** 渐变时间（熄灭、点亮、声控）。 */
export const LAMP_FADE = 0.2;
/** 声控灯（TUNING.soundLight）：点亮前方 reach 米内的灯，持续 hold 秒。 */
export const SOUND_REACH = 8, SOUND_HOLD = 4;
/** 掌光环寿命（秒）。 */
export const RING_LIFE = 0.9;
const RING_CAP = 32;

/** 各类灯的核函数：σ（米）、峰值、灯体半长（G 通道覆盖范围）。管灯每 2 米一盏时叠加后在 0.82（两灯之间）到 0.98（灯下）之间起伏：地面上看得见灯的节拍。窗只补一点光。 */
export const LAMP_KIND: Record<LampSpec['kind'], { sigma: number; peak: number; half: number }> = {
  tube: { sigma: 0.8, peak: 0.9, half: 0.62 },
  bulb: { sigma: 1.5, peak: 0.95, half: 0.18 },
  street: { sigma: 2.6, peak: 1.0, half: 0.3 },
  window: { sigma: 1.6, peak: 0.12, half: 0.8 },
};
const KIND_INDEX: Record<LampSpec['kind'], number> = { tube: 0, bulb: 1, street: 2, window: 3 };
const KIND_BY_INDEX: Array<LampSpec['kind']> = ['tube', 'bulb', 'street', 'window'];

// ——————————————————— 闪烁（纯函数，单元测试用） ———————————————————
function mix32(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}
/** 闪烁的时间格（秒）。每格至多一次熄灭，所以任意 1 s 窗口至多 3 次。 */
export const FLICKER_CELL = 0.5;
/**
 * 闪烁倍率：大部分时间 1；偶尔掉到 0.05–0.3，持续 0.05–0.16 s。
 * 同一 seed 的序列确定；seed 不同的灯相位互不相同。
 */
export function flickerLevel(t: number, seed: number): number {
  const c = Math.floor(t / FLICKER_CELL);
  const h = mix32((seed ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0);
  if ((h & 0xff) > 150) return 1;                        // ≈ 59% 的格子有一次熄灭
  const dur = 0.05 + (((h >>> 8) & 0xff) / 255) * 0.11;
  const off = (((h >>> 16) & 0xff) / 255) * (FLICKER_CELL - dur - 0.02);
  const u = t - c * FLICKER_CELL;
  if (u < off || u >= off + dur) return 1;
  return 0.05 + ((h >>> 24) / 255) * 0.25;
}
/** 「减少闪烁」：0.5 Hz 平滑明暗，范围 0.4–1.0。 */
export function reducedFlickerLevel(t: number, seed: number): number {
  const ph = ((seed & 0xffff) / 65536) * Math.PI * 2;
  return 0.7 + 0.3 * Math.cos(Math.PI * t + ph);
}

// ——————————————————— 材质补丁（§5.3，已对照 three 0.186.1 的 meshlambert / meshbasic 着色器） ———————————————————
/** LampFieldUniforms 之外的扩展 uniform：uLampY0 = 当前地面高度（hwH 按离地高度算，楼梯和静场不会整体变暗）。 */
export interface HwLampUniforms extends LampFieldUniforms { uLampY0: { value: number } }

const VERT_COMMON = '#include <common>\nvarying vec3 vHwWorld;\nattribute float aChalk;\nvarying float vChalk;';
const VERT_PROJECT = `#include <project_vertex>
  vec4 hwWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hwWp = instanceMatrix * hwWp;
  #endif
  vHwWorld = (modelMatrix * hwWp).xyz;
  vChalk = aChalk;`;

/** Lambert：环境光里加 LampField 与粉笔描边（零额外 draw call）。 */
export function patchLambert(mat: THREE.MeshLambertMaterial, u: LampFieldUniforms): void {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', VERT_COMMON)
      .replace('#include <project_vertex>', VERT_PROJECT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHwWorld; varying float vChalk; uniform sampler2D uLampField;
        uniform float uLampBase, uLampScale, uLampGain, uChalk, uLampY0; uniform vec3 uLampColor, uChalkColor;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float hwS = (-vHwWorld.z - uLampBase) * uLampScale;
        float hwL = texture2D(uLampField, vec2(hwS, 0.5)).r * ${LAMP_RANGE.toFixed(1)};
        float hwH = 0.55 + 0.45 * smoothstep(0.0, 3.0, vHwWorld.y - uLampY0);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uLampColor * hwL * hwH * uLampGain;
        reflectedLight.indirectDiffuse += uChalkColor * vChalk * uChalk;`);
  };
  mat.customProgramCacheKey = () => 'hwLampField';
  (mat as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = { aChalk: [0] };
}

/**
 * Basic（发光体，lampLit）：按 G 通道（灯自身的亮度）明灭，闪烁时灯管本身也跟着暗。
 * 顶点属性 aSteady = 1 的部分（窗）不受影响；没有这个属性时按 0 处理（整件跟着灯走）。
 */
export function patchBasicLamp(mat: THREE.MeshBasicMaterial, u: LampFieldUniforms): void {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHwWorld;\nattribute float aSteady;\nvarying float vSteady;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hwWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hwWp = instanceMatrix * hwWp;
        #endif
        vHwWorld = (modelMatrix * hwWp).xyz;
        vSteady = aSteady;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHwWorld; varying float vSteady; uniform sampler2D uLampField; uniform float uLampBase, uLampScale;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hwOwn = texture2D(uLampField, vec2((-vHwWorld.z - uLampBase) * uLampScale, 0.5)).g;
        diffuseColor.rgb *= mix(0.07 + 0.93 * hwOwn, 1.0, vSteady);`);
  };
  mat.customProgramCacheKey = () => 'hwLampBasic';
  (mat as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = { aSteady: [0] };
}

// ——————————————————— LampField ———————————————————
interface Ring { s: number; x: number; strength: number; radius: number; t0: number }
interface PalmRange { s0: number; s1: number }

/** 灯的运行状态（结构数组，读章时一次建好）。 */
class LampTable {
  n = 0;
  s = new Float64Array(0);
  x = new Float32Array(0);
  kind = new Uint8Array(0);
  flickerable = new Uint8Array(0);
  seed = new Uint32Array(0);
  flicker = new Uint8Array(0);
  sound = new Uint8Array(0);
  from = new Float32Array(0);
  to = new Float32Array(0);
  tChange = new Float64Array(0);
  trigStart = new Float64Array(0);
  trigEnd = new Float64Array(0);
  soundDelay = new Float32Array(0);

  build(list: ReadonlyArray<LampSpec>): void {
    const sorted = [...list].sort((a, b) => a.s - b.s);
    const n = sorted.length;
    this.n = n;
    this.s = new Float64Array(n); this.x = new Float32Array(n); this.kind = new Uint8Array(n); this.flickerable = new Uint8Array(n); this.seed = new Uint32Array(n);
    this.flicker = new Uint8Array(n); this.sound = new Uint8Array(n);
    this.from = new Float32Array(n).fill(1); this.to = new Float32Array(n).fill(1); this.tChange = new Float64Array(n).fill(-1e9);
    this.trigStart = new Float64Array(n).fill(-1e9); this.trigEnd = new Float64Array(n).fill(-1e9); this.soundDelay = new Float32Array(n);
    sorted.forEach((l, i) => {
      this.s[i] = l.s; this.x[i] = l.x; this.kind[i] = KIND_INDEX[l.kind] ?? 0; this.flickerable[i] = l.flickerable ? 1 : 0;
      this.seed[i] = hashString(`lamp:${l.s.toFixed(3)}:${l.x.toFixed(2)}:${i}`);
    });
  }

  reset(): void {
    this.flicker.fill(0); this.sound.fill(0); this.from.fill(1); this.to.fill(1); this.tChange.fill(-1e9);
    this.trigStart.fill(-1e9); this.trigEnd.fill(-1e9); this.soundDelay.fill(0);
  }

  /** 第一个 s ≥ v 的下标。 */
  lower(v: number): number {
    let lo = 0, hi = this.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if ((this.s[m] as number) < v) lo = m + 1; else hi = m; }
    return lo;
  }

  /** 开关（不含闪烁）的电平。 */
  base(i: number, t: number): number {
    const tc = this.tChange[i] as number;
    const from = this.from[i] as number, to = this.to[i] as number;
    let lv = t <= tc ? from : from + (to - from) * Math.min(1, (t - tc) / LAMP_FADE);
    if (this.sound[i]) {
      const a = (t - (this.trigStart[i] as number)) / LAMP_FADE, b = ((this.trigEnd[i] as number) - t) / LAMP_FADE;
      lv *= clamp(Math.min(a, b), 0, 1);
    }
    return lv;
  }
}

export class LampField implements LampFieldAPI {
  readonly uniforms: HwLampUniforms;
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(LAMP_TEXELS * 4);
  /** CPU 侧的 R 值（未除以 LAMP_RANGE），brightnessAt 与测试用。 */
  readonly field = new Float32Array(LAMP_TEXELS);
  private readonly owners = new Map<string, readonly LampSpec[]>();
  private readonly t = new LampTable();
  private dirty = false;
  private readonly rings: Ring[] = Array.from({ length: RING_CAP }, () => ({ s: 0, x: 0, strength: 0, radius: 1, t0: -1e9 }));
  private ringHead = 0;
  private readonly palm: PalmRange[] = [];
  /** 当前模拟时钟（秒）。 */
  now = 0;
  /** 最低亮度（氛围的 lampFloor；暗色预设 0.15）。 */
  floor = 0;
  reducedFlicker = false;
  /** 静场：整张纹理取常数（set 自己用顶点色控制明暗）。 */
  uniformLevel: number | null = null;
  private base = 0;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, LAMP_TEXELS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.name = 'hw:lampField';
    for (let i = 0; i < LAMP_TEXELS; i++) { this.data[i * 4] = 128; this.data[i * 4 + 1] = 255; this.data[i * 4 + 3] = 255; }
    this.texture.needsUpdate = true;
    this.uniforms = {
      uLampField: { value: this.texture }, uLampBase: { value: 0 }, uLampScale: { value: 1 / LAMP_SPAN }, uLampGain: { value: 0.6 },
      uLampColor: { value: new THREE.Color(0xeef6ff) }, uChalk: { value: 0 }, uChalkColor: { value: new THREE.Color(0xc7d0d3) },
      uLampY0: { value: 0 },
    };
  }

  // ——— LampFieldAPI ———
  addLamps(owner: string, lamps: readonly LampSpec[]): void { this.owners.set(owner, lamps); this.dirty = true; }
  removeLamps(owner: string): void { if (this.owners.delete(owner)) this.dirty = true; }
  /** 清空全部灯（读章）。 */
  clear(): void { this.owners.clear(); this.palm.length = 0; this.dirty = true; this.clearRings(); }

  op(op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings', s0: number, s1: number, o: { every?: number; delay?: number } = {}): void {
    this.ensure();
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const every = Math.max(1, Math.round(o.every ?? 1));
    const delay = Math.max(0, o.delay ?? 0);
    if (op === 'palmRings') { this.palm.push({ s0: lo, s1: hi }); return; }
    const T = this.t, now = this.now;
    let k = 0;
    for (let i = T.lower(lo - 1e-3); i < T.n && (T.s[i] as number) <= hi + 1e-3; i++) {
      if (T.kind[i] === KIND_INDEX.window) continue;            // 窗不受开关灯影响
      if (every > 1 && k++ % every !== 0) continue;
      if (every <= 1) k++;
      switch (op) {
        case 'flicker': if (T.flickerable[i]) T.flicker[i] = 1; break;
        case 'out': this.schedule(i, 0, now + delay); break;
        case 'on': T.flicker[i] = 0; T.sound[i] = 0; this.schedule(i, 1, now + delay); break;
        case 'sound':
          // 声控灯默认是黑的，等声音（撑跃落地 / ↓ 拍地）才亮
          T.sound[i] = 1; T.soundDelay[i] = delay; T.flicker[i] = 0;
          T.trigStart[i] = -1e9; T.trigEnd[i] = -1e9;
          this.schedule(i, 1, now);
          break;
      }
    }
  }

  soundTrigger(s: number): void {
    this.ensure();
    const T = this.t, now = this.now;
    for (let i = T.lower(s - 1.5); i < T.n && (T.s[i] as number) <= s + SOUND_REACH; i++) {
      if (!T.sound[i]) continue;
      const start = now + (T.soundDelay[i] as number);
      const lit = now >= (T.trigStart[i] as number) && now <= (T.trigEnd[i] as number);
      if (!lit) T.trigStart[i] = start;
      T.trigEnd[i] = Math.max(T.trigEnd[i] as number, start + SOUND_HOLD);
    }
  }

  ring(s: number, x: number, strength: number, radius: number): void {
    const r = this.rings[this.ringHead] as Ring;
    this.ringHead = (this.ringHead + 1) % RING_CAP;
    r.s = s; r.x = x; r.strength = strength; r.radius = Math.max(0.2, radius); r.t0 = this.now;
  }

  brightnessAt(s: number): number {
    if (this.uniformLevel !== null) return this.uniformLevel;
    this.ensure();
    return Math.max(this.floor, this.sumAt(s, this.now));
  }

  // ——— 扩展（WP3 内部） ———
  /** s 是否处在 palmRings 区间内（World 在触地时查询）。 */
  palmAt(s: number): boolean { for (const r of this.palm) if (s >= r.s0 && s <= r.s1) return true; return false; }
  /** 活动的掌光环（贴花用）：回调参数 (s, x, age01, strength, radius)。 */
  forEachRing(fn: (s: number, x: number, age: number, strength: number, radius: number) => void): void {
    for (const r of this.rings) {
      const age = (this.now - r.t0) / RING_LIFE;
      if (age < 0 || age >= 1) continue;
      fn(r.s, r.x, age, r.strength, r.radius);
    }
  }
  /** 重来 / 读章：所有灯回到默认（常亮），清掉掌光环与 palmRings 区间。 */
  resetStates(): void { this.ensure(); this.t.reset(); this.palm.length = 0; this.clearRings(); }
  private clearRings(): void { for (const r of this.rings) r.t0 = -1e9; }
  /** 灯的数量（测试用）。 */
  get count(): number { this.ensure(); return this.t.n; }
  /** 第 i 盏灯的 s 与当前电平（含闪烁），贴花与测试用。 */
  lampS(i: number): number { return this.t.s[i] as number; }
  lampX(i: number): number { return this.t.x[i] as number; }
  lampKind(i: number): LampSpec['kind'] { return KIND_BY_INDEX[this.t.kind[i] as number] ?? 'tube'; }
  level(i: number, t = this.now): number {
    const T = this.t;
    let lv = T.base(i, t);
    if (lv > 0 && T.flicker[i]) lv *= this.reducedFlicker ? reducedFlickerLevel(t, T.seed[i] as number) : flickerLevel(t, T.seed[i] as number);
    return lv;
  }
  /** [s0, s1] 内的灯下标范围。 */
  range(s0: number, s1: number, out: [number, number] = [0, 0]): [number, number] {
    this.ensure(); out[0] = this.t.lower(s0); out[1] = this.t.lower(s1 + 1e-6); return out;
  }
  /** 第 i 个掌光环（没有返回 null）：给每帧的贴花用，不分配。 */
  ringAt(i: number): { s: number; x: number; age: number; strength: number; radius: number } | null {
    const r = this.rings[i];
    if (!r) return null;
    const age = (this.now - r.t0) / RING_LIFE;
    if (age < 0 || age >= 1) return null;
    const o = this.ringOut; o.s = r.s; o.x = r.x; o.age = age; o.strength = r.strength; o.radius = r.radius;
    return o;
  }
  private readonly ringOut = { s: 0, x: 0, age: 0, strength: 0, radius: 1 };
  get ringCapacity(): number { return RING_CAP; }

  private schedule(i: number, target: number, at: number): void {
    const T = this.t;
    const cur = T.base(i, Math.min(at, this.now));
    T.from[i] = T.sound[i] && target === 1 ? 1 : cur;
    T.to[i] = target;
    T.tChange[i] = at;
  }

  private ensure(): void {
    if (!this.dirty) return;
    const all: LampSpec[] = [];
    for (const l of this.owners.values()) all.push(...l);
    this.t.build(all);
    this.dirty = false;
  }

  private sumAt(s: number, t: number): number {
    const T = this.t;
    let v = 0;
    for (let i = T.lower(s - 8); i < T.n && (T.s[i] as number) <= s + 8; i++) {
      const lv = this.level(i, t);
      if (lv <= 0) continue;
      const k = LAMP_KIND[KIND_BY_INDEX[T.kind[i] as number] ?? 'tube'];
      const d = s - (T.s[i] as number);
      v += lv * k.peak * Math.exp(-(d * d) / (2 * k.sigma * k.sigma));
    }
    for (const r of this.rings) {
      const age = (t - r.t0) / RING_LIFE;
      if (age < 0 || age >= 1) continue;
      const d = s - r.s, sg = r.radius * 0.7;
      v += r.strength * (1 - age) * Math.exp(-(d * d) / (2 * sg * sg));
    }
    return v;
  }

  /**
   * 每帧：以 centerS 为中心重算 256 个 texel 并上传。floorY = 当前地面高度（hwH 用）。
   * 返回纹理起点 s（= uLampBase）。
   */
  update(now: number, centerS: number, floorY: number): number {
    this.now = now;
    this.ensure();
    const base = Math.floor((centerS - LAMP_BEHIND) / LAMP_TEXEL_M) * LAMP_TEXEL_M;
    this.base = base;
    this.uniforms.uLampBase.value = base;
    this.uniforms.uLampY0.value = floorY;
    const f = this.field, d = this.data;
    if (this.uniformLevel !== null) {
      const r = Math.round(clamp(this.uniformLevel / LAMP_RANGE, 0, 1) * 255);
      for (let i = 0; i < LAMP_TEXELS; i++) { f[i] = this.uniformLevel; d[i * 4] = r; d[i * 4 + 1] = 255; }
      this.texture.needsUpdate = true;
      return base;
    }
    f.fill(0);
    for (let i = 0; i < LAMP_TEXELS; i++) d[i * 4 + 1] = 255;
    const T = this.t;
    const s0 = base - 8, s1 = base + LAMP_SPAN + 8;
    for (let i = T.lower(s0); i < T.n && (T.s[i] as number) <= s1; i++) {
      const lv = this.level(i, now);
      const k = LAMP_KIND[KIND_BY_INDEX[T.kind[i] as number] ?? 'tube'];
      const ls = T.s[i] as number;
      // G：灯体覆盖的 texel 写自身电平
      const g = Math.round(clamp(lv, 0, 1) * 255);
      const ga = Math.max(0, Math.floor((ls - k.half - base) / LAMP_TEXEL_M)), gb = Math.min(LAMP_TEXELS - 1, Math.floor((ls + k.half - base) / LAMP_TEXEL_M));
      for (let j = ga; j <= gb; j++) d[j * 4 + 1] = g;
      if (lv <= 0) continue;
      const reach = k.sigma * 3;
      const ja = Math.max(0, Math.floor((ls - reach - base) / LAMP_TEXEL_M)), jb = Math.min(LAMP_TEXELS - 1, Math.ceil((ls + reach - base) / LAMP_TEXEL_M));
      const inv = 1 / (2 * k.sigma * k.sigma), amp = lv * k.peak;
      for (let j = ja; j <= jb; j++) {
        const dd = base + (j + 0.5) * LAMP_TEXEL_M - ls;
        f[j] = (f[j] as number) + amp * Math.exp(-dd * dd * inv);
      }
    }
    for (const r of this.rings) {
      const age = (now - r.t0) / RING_LIFE;
      if (age < 0 || age >= 1) continue;
      const sg = r.radius * 0.7, reach = sg * 3, amp = r.strength * (1 - age), inv = 1 / (2 * sg * sg);
      const ja = Math.max(0, Math.floor((r.s - reach - base) / LAMP_TEXEL_M)), jb = Math.min(LAMP_TEXELS - 1, Math.ceil((r.s + reach - base) / LAMP_TEXEL_M));
      for (let j = ja; j <= jb; j++) {
        const dd = base + (j + 0.5) * LAMP_TEXEL_M - r.s;
        f[j] = (f[j] as number) + amp * Math.exp(-dd * dd * inv);
      }
    }
    const fl = this.floor;
    for (let i = 0; i < LAMP_TEXELS; i++) {
      const v = Math.max(fl, f[i] as number);
      f[i] = v;
      d[i * 4] = Math.round(clamp(v / LAMP_RANGE, 0, 1) * 255);
    }
    this.texture.needsUpdate = true;
    return base;
  }

  /** 纹理起点（最近一次 update）。 */
  get textureBase(): number { return this.base; }
}
