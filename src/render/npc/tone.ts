// src/render/npc/tone.ts —— NPC 衣服颜色的受光补偿随氛围变（U6，DESIGN.md §5.1「色板是画面上的颜色」、§10.2 propHex）。
// 集成时（lead）NPC 的深色衣物按早晨走廊（morning、灯 0.9）的受光反推了一次反照率（WP3 的 propHex）。
// 户外段的光完全不一样：5-7 跑道是阴天、没有灯，裤子在画面上是饱和度 0.6 以上、亮度 0.1 的深蓝甚至近黑。
// 这里在段的氛围变化时换一套反照率：户外氛围（overcast、dawn、dream、dreamGray）按那个氛围反推（WP3 的 propAlbedo），
// 户外 kit（street、plaza、track）没有灯，参考受光不算灯；室内（5-6 走廊也是 overcast）照常算灯 0.9。
// 其余氛围维持集成时的早晨补偿（夜里完全补偿会让衣服发白；第三章的暗场景交给 LampField）。
// 氛围切换时在 1.5 s 内渐变（与 AtmosphereMixer 的缺省过渡一样长），不在段界上跳色。
import * as THREE from 'three';
import type { AtmosphereId, KitId } from '../../core/types';
import { propAlbedo, propHex, type Lin } from '../wallTone';

/** 按自己的光照反推反照率的氛围（户外段）。 */
export const TONED_ATMOS: ReadonlySet<AtmosphereId> = new Set<AtmosphereId>(['overcast', 'dawn', 'dream', 'dreamGray']);
/** 户外 kit：参考受光里没有灯。 */
export const OUTDOOR_KITS: ReadonlySet<KitId> = new Set<KitId>(['street', 'plaza', 'track']);
/** 氛围切换时的渐变（秒）。 */
export const TONE_FADE = 1.5;

/** propHex 的结果 → 色板原值（tonedHex 登记）。 */
const ORIG = new Map<number, number>();

/** 与 propHex 相同（早晨走廊的补偿），同时记下色板原值，换氛围时据此重新反推。 */
export function tonedHex(hex: number): number {
  const t = propHex(hex);
  if (t !== hex) ORIG.set(t, hex);
  return t;
}

/** 写进 Look 的颜色 → 色板原值（没有登记的就是它自己）。 */
export function paletteOf(hex: number): number { return ORIG.get(hex) ?? hex; }

/** 氛围 → 补偿模式：户外氛围用自己；其余一律按集成时的早晨补偿。 */
export function toneMode(id: AtmosphereId): AtmosphereId { return TONED_ATMOS.has(id) ? id : 'morning'; }

const _c = new THREE.Color();
/** 补偿模式 → (hex | 户外位) → 反照率。键都是数字或已有的字符串，取色时不分配（§9.4 热路径不分配内存）。 */
const cache = new Map<AtmosphereId, Map<number, Lin>>();
const OUTDOOR_BIT = 1 << 24;
/**
 * 衣服颜色（写进 Look 的十六进制）在某个补偿模式下的反照率（线性，可以 > 1）。
 * morning：与以前完全一样（setHex）。户外氛围：propAlbedo(色板原值, { atmo, lamp: 户外 0 / 室内缺省 0.9 })。
 */
export function npcAlbedo(hex: number, mode: AtmosphereId, outdoor: boolean): Lin {
  const m = toneMode(mode);
  let byHex = cache.get(m);
  if (!byHex) { byHex = new Map(); cache.set(m, byHex); }
  const key = (hex & 0xffffff) + (outdoor ? OUTDOOR_BIT : 0);
  const hit = byHex.get(key);
  if (hit) return hit;
  let out: Lin;
  if (m === 'morning') { _c.setHex(hex); out = [_c.r, _c.g, _c.b]; }
  else out = propAlbedo(paletteOf(hex), outdoor ? { atmo: m, lamp: 0 } : { atmo: m });
  byHex.set(key, out);
  return out;
}

/** 当前的补偿模式与渐变（每帧由 ObstacleView 按 ctx.atmosphere 更新；LegForest 取色）。运行时不分配。 */
export class NpcTone {
  private cur: AtmosphereId = 'morning';
  private prev: AtmosphereId = 'morning';
  private t0 = -1e9;
  /** 渐变进度 0..1（1 = 完全是 cur）。 */
  k = 1;

  get mode(): AtmosphereId { return this.cur; }

  /** 立即切到某个氛围（读章、重来）。 */
  snap(id: AtmosphereId): void { this.cur = this.prev = toneMode(id); this.k = 1; this.t0 = -1e9; }

  /** 每帧：氛围变了就开始 TONE_FADE 秒的渐变（从当前混合出来的那一端开始）。 */
  update(id: AtmosphereId, t: number): void {
    const m = toneMode(id);
    if (m !== this.cur) { this.prev = this.k >= 0.5 ? this.cur : this.prev; this.cur = m; this.t0 = t; }
    this.k = t < this.t0 ? 1 : Math.min(1, (t - this.t0) / TONE_FADE);
    if (this.k >= 1) this.prev = this.cur;
  }

  /** 衣服颜色 hex 此刻的反照率，写进 out（线性）。 */
  color(hex: number, outdoor: boolean, out: THREE.Color): THREE.Color {
    const b = npcAlbedo(hex, this.cur, outdoor);
    if (this.k >= 1 || this.prev === this.cur) return out.setRGB(b[0], b[1], b[2], THREE.LinearSRGBColorSpace);
    const a = npcAlbedo(hex, this.prev, outdoor), k = this.k;
    return out.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, THREE.LinearSRGBColorSpace);
  }
}
