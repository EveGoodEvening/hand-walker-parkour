// src/render/wallTone.ts —— 墙面的受光补偿（DESIGN.md §5.1 色板、§5 总则的 NeutralToneMapping，WP3）。
// §5.1 的色板是「画面上看到的颜色」，不是反照率。侧墙只吃到半球光的一半（three r186 的 Lambert 还要再除以 π）
// 和低处较弱的灯光（LampField 的高度因子在墙裙高度约 0.6），早晨墙裙处的有效受光只有 0.5 左右；
// 之后 NeutralToneMapping 的 toe 先从各通道减去约 0.04，暗部饱和度被抬高。直接把色板值当反照率，
// 墙裙就成了又暗又饱和的深青绿（#183E3C，HSL 饱和度 0.4），上半截墙也只有 #95A0A5。
// 这里按「早晨走廊两侧墙在 y 高处的平均受光」反推反照率（线性，可以 > 1）：
//   A = toneInverse(lin(色板)) / (贴图集平均 × E(y) × 假 AO)
// 于是早晨 640×360 低画质截图里墙裙 ≈ #5F7F7A、墙 ≈ #C9CFCF。其他氛围按各自的光照自然变亮或变暗。
// lift 在 0（原色板当反照率）与 1（完全补偿）之间按对数插值：夜里灯管增益 1.4，完全补偿会让墙发白，夜景的墙用 0.3，
// 补偿不足的那部分饱和度用 desat（朝亮度去饱和）补上，夜里的墙裙不至于又成深青绿。
import * as THREE from 'three';
import { ATMOSPHERES } from './atmosphere';
import type { AtmosphereId } from '../core/types';

/** 线性 RGB（可以 > 1，写进顶点色）。 */
export type Lin = readonly [number, number, number];

/** 校园贴图集墙面区（灰泥、墙裙、瓷砖）的平均亮度（线性）。 */
export const ATLAS_MEAN = 0.9;
/** 参考机位下灯的平均电平（两灯之间 0.82 到灯下 0.98）。 */
const LAMP_MEAN = 0.9;

const _c = new THREE.Color();
function lin(hex: number): [number, number, number] { _c.setHex(hex); return [_c.r, _c.g, _c.b]; }
function smoothstep(a: number, b: number, x: number): number { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * 参考受光（线性，逐通道）：某个氛围（缺省早晨 §5.2 morning）下走廊左右两侧墙在离地 y 米处的平均。
 * 与 lampField.ts 的补丁同一套公式。
 */
export function wallIrradiance(y: number, lampMean = LAMP_MEAN, atmo: AtmosphereId = 'morning'): [number, number, number] {
  const p = ATMOSPHERES[atmo];
  const sky = lin(p.hemi.sky), gr = lin(p.hemi.ground), lc = lin(p.lampColor);
  const dc = lin(p.dir?.color ?? 0xffffff), d = p.dir?.dir ?? [0, -1, 0], dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const hwH = 0.55 + 0.45 * smoothstep(0, 3, y);
  const out: [number, number, number] = [0, 0, 0];
  for (const side of [-1, 1]) {
    const ndl = Math.max(0, (side * d[0]) / dl);              // 左墙法线 +x、右墙 −x；光线朝 d 行进
    for (let i = 0; i < 3; i++) {
      const hemi = (0.5 * (sky[i] as number) + 0.5 * (gr[i] as number)) * p.hemi.intensity / Math.PI;
      const dir = (dc[i] as number) * (p.dir?.intensity ?? 0) * ndl / Math.PI;
      const lamp = (lc[i] as number) * lampMean * hwH * p.lampGain;
      out[i] = (out[i] as number) + 0.5 * (hemi + dir + lamp);
    }
  }
  return out;
}

/** NeutralToneMapping 在 peak < 0.76 时的逆：toe 从各通道减去 offset（min < 0.08 时为 x − 6.25x²，否则 0.04）。 */
export function toneInverse(t: readonly number[]): [number, number, number] {
  const mn = Math.min(t[0] as number, t[1] as number, t[2] as number);
  const x = mn < 0.04 ? Math.sqrt(Math.max(0, mn) / 6.25) : mn + 0.04;
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  return [(t[0] as number) + off, (t[1] as number) + off, (t[2] as number) + off];
}

export interface WallToneOpts {
  /** 0 = 原色板，1 = 完全补偿（缺省）。 */
  lift?: number;
  /** 该高度上几何体自己乘的假 AO（wallShade），一并除掉。 */
  shade?: number;
  /** 贴图的平均亮度（chunk 的墙贴校园贴图集 = ATLAS_MEAN；set 的墙没有贴图 = 1）。 */
  tex?: number;
  /** 灯的平均电平（跑段 0.9；静场整张亮度场取 1）。 */
  lamp?: number;
  /** 最后朝亮度去饱和的比例（0..1）。 */
  desat?: number;
  /** 参考氛围（缺省 morning；只在固定氛围的静场里换，例如实验室黑板 labNorth）。 */
  atmo?: AtmosphereId;
}

const cache = new Map<string, Lin>();
/** 墙面颜色 hex（色板值）在离地 y 米处的补偿反照率（线性）。 */
export function wallAlbedo(hex: number, y: number, o: WallToneOpts = {}): Lin {
  const lift = o.lift ?? 1, shade = o.shade ?? 1, tex = o.tex ?? ATLAS_MEAN, lamp = o.lamp ?? LAMP_MEAN, desat = o.desat ?? 0, atmo = o.atmo ?? 'morning';
  const key = `${hex}|${y.toFixed(2)}|${lift.toFixed(2)}|${shade.toFixed(3)}|${tex}|${lamp}|${desat.toFixed(2)}|${atmo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = lin(hex);
  let out: [number, number, number] = [...base];
  if (lift > 0) {
    const p = toneInverse(base), e = wallIrradiance(y, lamp, atmo);
    const full = p.map((v, i) => v / (tex * (e[i] as number) * Math.max(0.05, shade)));
    out = base.map((v, i) => (v > 1e-6 ? v * Math.pow((full[i] as number) / v, lift) : (full[i] as number) * lift)) as [number, number, number];
  }
  if (desat > 0) {
    const Y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    out = out.map((v) => v + (Y - v) * desat) as [number, number, number];
  }
  cache.set(key, out);
  return out;
}
