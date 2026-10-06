// src/render/kits/outside/lib/tone.ts —— 受光补偿：§5.1 的色板是「画面上看到的颜色」，不是反照率（DESIGN.md §5 总则、§5.1、§5.2）。
// three r186 的 Lambert 对半球光、平行光都要除以 π；NeutralToneMapping（曝光 1.0）的 toe 先从各通道减去约 0.04，
// 暗部的饱和度被抬高。直接把色板值当顶点色，阴天的跑道 #7A4B44 在画面上是 (51, 14, 5)，饱和度 0.9。
// 这里按段的氛围（§5.2 的半球光 + 平行光）把「画面上的目标色」反推成线性反照率（可以 > 1，顶点色是 Float32）：
//   反照率 = NeutralInverse(lin(色板)) ÷ E_ref
// E_ref 是参考受光：地面层用朝上的面（半球光 + 平行光）；static 用「背光的竖直面」（只有半球光：mix(地, 天, 0.5)），
// 也就是说色板是阴面的颜色，被平行光照到的面、高处朝上的面（箱顶、台阶）更亮，保留体积感，而且没有哪个面会比色板更暗、
// 被 toe 压得更饱和。贴地朝上的面（镜中房间的地）按地面算，镜子里外的地面一样亮。
// 发光体（Basic）只做色调映射的逆。暗场景（preset.dark，第三章的雨夜）不做完整补偿：那里的亮度由 LampField 的灯决定。
// 但 rainNight 的暗色按 DARK_LIFT 部分补偿（lead 集成 2026-10，DESIGN §10.3）：只改 kit 的地面与 static 顶点色，色相不变。
// LampField 的灯光（§5.3）不计入参考受光：路灯下面会更亮一些，这正是「灯的节拍」。
import * as THREE from 'three';
import { FALLBACK_ATMOSPHERES } from '../../../../core/fallbacks';
import { getAtmosphere, type AtmospherePreset } from '../../../../core/registry';
import type { AtmosphereId } from '../../../../core/types';

export type Lin3 = [number, number, number];
type N3 = readonly [number, number, number];

const _c = new THREE.Color();
/** sRGB 十六进制 → 线性 RGB。 */
export function lin(hex: number): Lin3 { _c.setHex(hex); return [_c.r, _c.g, _c.b]; }
/** 氛围预设（WP3 注册的正式版本优先，没有时用 CORE 的回落表）。 */
export function presetOf(id: AtmosphereId): AtmospherePreset { return getAtmosphere(id) ?? FALLBACK_ATMOSPHERES[id]; }

const START = 0.8 - 0.04, DESAT = 0.15, D = 1 - START;

/** three r186 的 NeutralToneMapping（tonemapping_pars_fragment，曝光 1.0）。 */
export function neutralTone(c: N3): Lin3 {
  let r = c[0], g = c[1], b = c[2];
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b);
  if (peak < START) return [r, g, b];
  const np = 1 - (D * D) / (peak + D - START);
  const k = np / peak;
  r *= k; g *= k; b *= k;
  const w = 1 - 1 / (DESAT * (peak - np) + 1);
  return [r + (np - r) * w, g + (np - g) * w, b + (np - b) * w];
}

/** NeutralToneMapping 的逆（解析解；目标峰值截到 0.98，再亮的颜色已经无法从色调映射里反推）。 */
export function neutralInverse(t: N3): Lin3 {
  const tt: Lin3 = [Math.min(0.98, Math.max(0, t[0])), Math.min(0.98, Math.max(0, t[1])), Math.min(0.98, Math.max(0, t[2]))];
  const pk = Math.max(tt[0], tt[1], tt[2]);
  let c: Lin3 = tt;
  if (pk >= START) {
    // 肩部：最大通道 = newPeak；先撤掉朝 newPeak 的去饱和，再按 peak / newPeak 放大
    const peak = (D * D) / (1 - pk) - D + START;
    const w = 1 - 1 / (DESAT * (peak - pk) + 1);
    c = tt.map((v) => Math.max(0, ((v - pk * w) / (1 - w)) * (peak / pk))) as Lin3;
  }
  // toe：最小通道 m' < 0.04 时 m' = 6.25x²，否则 m' = x − 0.04
  const m = Math.max(0, Math.min(c[0], c[1], c[2]));
  const x = m < 0.04 ? Math.sqrt(m / 6.25) : m + 0.04;
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  return [c[0] + off, c[1] + off, c[2] + off];
}

/** 线性 → sRGB 编码（0..1）。 */
export function lin2srgb(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 某个朝向 n 的面受到的光（线性，已经除以 π：Lambert 的 BRDF）。半球光按 three 的 mix(地, 天, 0.5·n.y + 0.5)。 */
export function irradiance(p: AtmospherePreset, n: N3, withDir = true): Lin3 {
  const sky = lin(p.hemi.sky), gr = lin(p.hemi.ground);
  const w = 0.5 * n[1] + 0.5;
  const out: Lin3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = ((gr[i] as number) + ((sky[i] as number) - (gr[i] as number)) * w) * p.hemi.intensity / Math.PI;
  if (withDir && p.dir && p.dir.intensity > 0) {
    const d = p.dir.dir, l = Math.hypot(d[0], d[1], d[2]) || 1;
    // dir 是光线行进的方向：受光面朝向 −dir
    const ndl = Math.max(0, -(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l);
    const dc = lin(p.dir.color);
    for (let i = 0; i < 3; i++) out[i] = (out[i] as number) + (dc[i] as number) * p.dir.intensity * ndl / Math.PI;
  }
  return out;
}

/** 参考受光：floor = 朝上的面（含平行光）；side = 背光的竖直面（只有半球光）。 */
export type ToneRef = 'floor' | 'side';
export function refIrradiance(p: AtmospherePreset, ref: ToneRef): Lin3 {
  return ref === 'floor' ? irradiance(p, [0, 1, 0]) : irradiance(p, [1, 0, 0], false);
}

/** 画面上的颜色（sRGB 编码 0..1）：反照率 × 受光 → Neutral → sRGB。雾、LampField 不计。单元测试用它对色。 */
export function screenColor(albedo: N3, p: AtmospherePreset, n: N3): Lin3 {
  const e = irradiance(p, n);
  const t = neutralTone([albedo[0] * e[0], albedo[1] * e[1], albedo[2] * e[2]]);
  return [lin2srgb(t[0]), lin2srgb(t[1]), lin2srgb(t[2])];
}
/** 发光体（Basic，不受光）在画面上的颜色。 */
export function screenColorBasic(c: N3): Lin3 {
  const t = neutralTone(c);
  return [lin2srgb(t[0]), lin2srgb(t[1]), lin2srgb(t[2])];
}

/** 反照率上限：再高就是在拿顶点色硬撑一个本来就暗的氛围。 */
export const ALBEDO_MAX = 4;

/**
 * 暗场景的部分补偿（lead 集成 2026-10，DESIGN §10.3）。rainNight 不做完整的受光补偿（亮度交给 LampField 的灯），
 * 但把色板值直接当反照率时，柏油 #1C2227、楼背墙这些暗色过了 Neutral 的 toe 全是黑的，3-4 整帧亮度中位数只有约 0.02，
 * 只调灯拉不上去（U6）。暗色的反照率乘 lift：线性亮度 ≤ DARK_LIFT_LO 时乘满，到 DARK_LIFT_HI 渐变回 1 倍
 * （粉笔白、栏杆红、标线这些本来看得见的颜色不动）；三个通道乘同一个倍数，色相、饱和度不变。
 * rainNight 取 3.4：两灯之间（LampField 0.25）柏油的画面亮度 0.011 → 0.036，3-4 最暗的一段（路灯坏了一半）整帧亮度中位数
 * 约 0.02 → 0.06；灯下最亮的楼背墙约 0.197，不超过色板（#2A3238，0.191）0.01 以上。
 * 发光体不动。只作用于 kit 的顶点色（applyArrays），albedo() 照旧原样返回（主角、NPC 不受影响）。
 */
export const DARK_LIFT: Partial<Record<AtmosphereId, number>> = { rainNight: 3.4 };
export const DARK_LIFT_LO = 0.05, DARK_LIFT_HI = 0.2;

/** 暗色的部分补偿：线性 RGB × 同一个倍数（见 DARK_LIFT）。 */
export function darkLift(c: N3, lift: number): Lin3 {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = Math.min(1, Math.max(0, (DARK_LIFT_HI - l) / (DARK_LIFT_HI - DARK_LIFT_LO)));
  const m = 1 + (lift - 1) * k;
  return [c[0] * m, c[1] * m, c[2] * m];
}

const TONES = new WeakMap<AtmospherePreset, Tone>();

/** 一个氛围下的补偿器。暗场景或受光太弱时不生效（原样返回）。 */
export class Tone {
  readonly active: boolean;
  private readonly eFloor: Lin3;
  private readonly eSide: Lin3;
  private readonly cache = new Map<string, Lin3>();

  constructor(readonly preset: AtmospherePreset, readonly lift = 1) {
    this.eFloor = refIrradiance(preset, 'floor');
    this.eSide = refIrradiance(preset, 'side');
    const lum = (e: Lin3) => 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
    this.active = !preset.dark && lum(this.eFloor) >= 0.05 && lum(this.eSide) >= 0.02;
  }

  /** 同一个预设对象共用一个补偿器（缓存跨 chunk 复用）。 */
  static of(id: AtmosphereId): Tone {
    const p = presetOf(id);
    let t = TONES.get(p);
    if (!t) { t = new Tone(p, p.dark ? DARK_LIFT[id] ?? 1 : 1); TONES.set(p, t); }
    return t;
  }

  /**
   * 画面上的目标色（线性）→ 反照率（线性）。ref = 'emissive' 只做色调映射的逆；
   * ref 是一个法线时按这个朝向的实际受光算（平面、正对镜头的东西：举在眼前的手）。
   */
  albedo(c: N3, ref: ToneRef | 'emissive' | N3): Lin3 {
    if (!this.active) return [c[0], c[1], c[2]];
    const rk = typeof ref === 'string' ? ref : ref.map((v) => Math.round(v * 100)).join(',');
    const key = `${rk}|${Math.round(c[0] * 1e5)}|${Math.round(c[1] * 1e5)}|${Math.round(c[2] * 1e5)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pre = neutralInverse(c);
    let out: Lin3;
    if (ref === 'emissive') out = pre;
    else {
      const e = ref === 'floor' ? this.eFloor : ref === 'side' ? this.eSide : irradiance(this.preset, ref);
      const k = (i: number) => Math.min(ALBEDO_MAX, (pre[i] as number) / Math.max(1e-4, e[i] as number));
      out = [k(0), k(1), k(2)];
    }
    this.cache.set(key, out);
    return out;
  }

  /** 贴图面的顶点色乘数：纹理的主色 hex 在朝向 n 的面上补偿到色板所需的倍数（逐通道）。 */
  factor(hex: number, n: N3): Lin3 {
    const c = lin(hex), a = this.albedo(c, n);
    return [a[0] / Math.max(1e-6, c[0]), a[1] / Math.max(1e-6, c[1]), a[2] / Math.max(1e-6, c[2])];
  }

  /**
   * 原地改写顶点色数组（GeoBuilder.col：线性 RGB，按 sRGB 色板写入）。
   * kind = 'floor'：全部按朝上的面；'static'：贴地（y < 0.05）朝上的面按地面，其余按竖直面；'emissive'：只逆色调映射；
   * 'exact'：按每个顶点自己的法线（每个面都正好是色板色，没有明暗，只给正对镜头的平面用）。
   */
  applyArrays(col: number[] | Float32Array, nor: ArrayLike<number>, pos: ArrayLike<number>, kind: 'floor' | 'static' | 'emissive' | 'exact'): void {
    if (!this.active) {
      // 暗场景：只给地面和 static 的暗色做部分补偿（DARK_LIFT），发光体不动
      if (this.lift === 1 || kind === 'emissive') return;
      const n = Math.floor(col.length / 3);
      for (let v = 0; v < n; v++) {
        const a = darkLift([col[v * 3] as number, col[v * 3 + 1] as number, col[v * 3 + 2] as number], this.lift);
        col[v * 3] = a[0]; col[v * 3 + 1] = a[1]; col[v * 3 + 2] = a[2];
      }
      return;
    }
    const n = Math.floor(col.length / 3);
    for (let v = 0; v < n; v++) {
      let ref: ToneRef | 'emissive' | N3 = kind === 'emissive' ? 'emissive' : 'floor';
      if (kind === 'static') ref = (nor[v * 3 + 1] as number) > 0.7 && (pos[v * 3 + 1] as number) < 0.05 ? 'floor' : 'side';
      else if (kind === 'exact') ref = [nor[v * 3] as number, nor[v * 3 + 1] as number, nor[v * 3 + 2] as number];
      const a = this.albedo([col[v * 3] as number, col[v * 3 + 1] as number, col[v * 3 + 2] as number], ref);
      col[v * 3] = a[0]; col[v * 3 + 1] = a[1]; col[v * 3 + 2] = a[2];
    }
  }
}
