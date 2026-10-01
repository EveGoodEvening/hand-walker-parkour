// tests/unit/render/shade.ts —— Node 里的受光模拟（与 three r186 的 Lambert + WP3 LampField 补丁 + NeutralToneMapping 同一套公式）。
// 用来检查「画面上看到的颜色」：反照率 × (半球光 + 平行光) ÷ π + 反照率 × 灯色 × LampField × 高度因子 × 增益，
// 再经 NeutralToneMapping（曝光 1.0）和 sRGB 编码。雾不计（近处）。
import * as THREE from 'three';
import type { AtmospherePreset } from '../../../src/core/registry';
import { neutralTone, lin2srgb } from '../../../src/render/kits/outside/lib/tone';

export type V3 = readonly [number, number, number];

const _c = new THREE.Color();
/** sRGB 十六进制 → 线性 RGB。 */
export function lin(hex: number): [number, number, number] { _c.setHex(hex); return [_c.r, _c.g, _c.b]; }

/** sRGB（0..1）→ HSL（h 为度）。 */
export function hsl(s: readonly number[]): { h: number; s: number; l: number } {
  const r = s[0] as number, g = s[1] as number, b = s[2] as number;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx - mn < 1e-9) return { h: 0, s: 0, l };
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s: sat, l };
}

/** sRGB 十六进制的 HSL。 */
export function hexHsl(hex: number): { h: number; s: number; l: number } {
  return hsl([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
}

export interface ShadeOpts {
  /** LampField 在这里的亮度（R 通道 × LAMP_RANGE，已含 lampFloor）。 */
  lamp: number;
  /** 离地高度（米，LampField 的高度因子 hwH 用）。 */
  y: number;
  /** 灯色（线性；缺省取预设的 lampColor）。 */
  lampColor?: number;
}

/** 某个朝向 n 的面在预设 p 下画面上的颜色（sRGB 0..1）与 HSL。 */
export function screenColor(albedo: V3, p: AtmospherePreset, n: V3, o: ShadeOpts): { rgb: [number, number, number]; h: number; s: number; l: number } {
  const sky = lin(p.hemi.sky), gr = lin(p.hemi.ground), lc = lin(o.lampColor ?? p.lampColor);
  const dc = lin(p.dir?.color ?? 0xffffff), d = p.dir?.dir ?? [0, -1, 0], dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const ndl = Math.max(0, -(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / (dl * nl));
  const w = 0.5 * (n[1] / nl) + 0.5;
  const t = Math.min(1, Math.max(0, o.y / 3));
  const hwH = 0.55 + 0.45 * t * t * (3 - 2 * t);
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const hemi = ((gr[i] as number) + ((sky[i] as number) - (gr[i] as number)) * w) * p.hemi.intensity / Math.PI;
    const dir = (dc[i] as number) * (p.dir?.intensity ?? 0) * ndl / Math.PI;
    const lamp = (lc[i] as number) * o.lamp * hwH * p.lampGain;
    out[i] = (albedo[i] as number) * (hemi + dir + lamp);
  }
  const rgb = neutralTone(out).map(lin2srgb) as [number, number, number];
  return { rgb, ...hsl(rgb) };
}
