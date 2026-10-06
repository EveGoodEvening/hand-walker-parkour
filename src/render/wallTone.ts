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

// ——————————————————— 道具与人物的暗色补偿 ———————————————————
// 同一个问题也出在家具、门、人物身上：§5.1 的裤子 #2A3A52（饱和度 0.32）早晨在画面上是 #04213D（0.88），
// 实验台 #2A3136 成了 #041620。暗色越暗，toe 减掉的比例越大，剩下的就只有蓝通道。
// 道具（无贴图、各个朝向都有）按「离地 0.6 m 的侧面」做参考受光，只补偿暗色：
// 显示亮度（HSL 的 L）≤ 0.3 完全补偿，≥ 0.6 不动（亮色以前按眼睛调好了，受光不足只是略暗，不变色），中间平滑过渡；
// 补偿的那部分再朝亮度去饱和一点，背光面受光更少、toe 又会把饱和度抬回去。

/** 显示亮度在 [DARK_LO, DARK_HI] 之间从完全补偿过渡到不补偿。 */
export const DARK_LO = 0.3, DARK_HI = 0.6;

export interface PropToneOpts {
  /** 0 = 不补偿，1 = 完全补偿（缺省）。夜景的 kit 与墙一样用 NIGHT_LIFT。 */
  lift?: number;
  /** 暗色（k = 1）去饱和的比例；按暗色程度 k 缩放。缺省 0.15。 */
  desat?: number;
  /** 参考氛围（缺省 morning；静场用自己的氛围）。 */
  atmo?: AtmosphereId;
  /** 灯的平均电平（跑段 0.9，静场 1）。 */
  lamp?: number;
  /** 参考高度（缺省 0.6 m）。 */
  y?: number;
}

/** sRGB 十六进制的 HSL 亮度（0..1）。 */
export function hexLightness(hex: number): number {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** 道具颜色 hex（色板值）的补偿反照率（线性）。亮色原样返回（与 THREE.Color.setHex 相同）。 */
export function propAlbedo(hex: number, o: PropToneOpts = {}): Lin {
  const k = 1 - smoothstep(DARK_LO, DARK_HI, hexLightness(hex));
  const lift = (o.lift ?? 1) * k;
  if (lift <= 1e-4) return wallAlbedo(hex, 0, { lift: 0 });
  return wallAlbedo(hex, o.y ?? 0.6, { lift, shade: 1, tex: 1, lamp: o.lamp ?? LAMP_MEAN, desat: (o.desat ?? 0.15) * k, atmo: o.atmo ?? 'morning' });
}

/**
 * 给只能写 sRGB 十六进制的包（WP5 的主角、WP6 的人，经 core/geo.ts 的 setHex）：补偿后的反照率换回十六进制，
 * setHex 之后正好是 propAlbedo（各通道截到 1）。lead 集成：深色校服、裤子在画面上不再是饱和的宝蓝（附录 A-9）。
 */
export function propHex(hex: number, o: PropToneOpts = {}): number {
  const a = propAlbedo(hex, o);
  return _c.setRGB(Math.min(1, a[0]), Math.min(1, a[1]), Math.min(1, a[2]), THREE.LinearSRGBColorSpace).getHex();
}

/** KitGeo.tone 用的函数：hex → 补偿后的线性颜色。lift ≤ 0 时返回 null（不补偿，例如虚空走廊的近黑）。 */
export function propTone(o: PropToneOpts = {}): ((hex: number) => Lin) | null {
  if ((o.lift ?? 1) <= 0) return null;
  return (hex) => propAlbedo(hex, o);
}

/** kit 的道具补偿：白天完全补偿；夜景（lift < 1）补得少、去饱和多（与墙的 NIGHT_LIFT 一致，夜里灯管增益大）。 */
export function kitPropTone(lift = 1): ((hex: number) => Lin) | null {
  return propTone({ lift, desat: lift >= 1 ? 0.15 : 0.15 + (1 - lift) * 0.9 });
}

/**
 * 发光体（Basic，不受光）的暗色：画面上 = NeutralToneMapping(顶点色)，toe 同样把暗色压成饱和色
 * （夜里的窗 #1A2A33 成了 #0B2028，饱和度 0.57）。暗色按 toe 的逆写入，画面上就是色板值；亮色（窗光、灯管）不动。
 */
export function emissiveAlbedo(hex: number): Lin {
  const k = 1 - smoothstep(DARK_LO, DARK_HI, hexLightness(hex));
  const key = `emi|${hex}|${k.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = lin(hex);
  let out: [number, number, number] = [...base];
  if (k > 1e-4) {
    const inv = toneInverse(base);
    out = base.map((v, i) => (v > 1e-6 ? v * Math.pow((inv[i] as number) / v, k) : (inv[i] as number) * k)) as [number, number, number];
  }
  cache.set(key, out);
  return out;
}
