// tests/unit/render/wallTone.test.ts —— 墙面受光补偿（§5.1 色板 = 画面上看到的颜色）。
// 用独立实现的「Lambert ÷ π + LampField + NeutralToneMapping + sRGB」模拟早晨走廊左、右两面墙上的像素，
// 断言墙裙落在色板 #5F7F7A 的 HSL ±0.05 饱和度 / ±0.1 亮度以内，墙面在 #C9CFCF 的 ±0.1 亮度以内。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERES } from '../../../src/render/atmosphere';
import { NIGHT_LIFT, wallShade } from '../../../src/render/kits/school/shell';
import { ATLAS_MEAN, kitPropTone, propAlbedo, propTone, toneInverse, wallAlbedo } from '../../../src/render/wallTone';
import { KitGeo } from '../../../src/render/geom';
import { PAL } from '../../../src/render/palette';

const lin = (h: number) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** three r186 的 NeutralToneMapping（曝光 1）。 */
function neutral(c: number[]): number[] {
  const x = Math.min(...c);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let o = c.map((v) => v - off);
  const peak = Math.max(...o);
  if (peak < 0.76) return o;
  const d = 0.24, np = 1 - (d * d) / (peak + d - 0.76);
  o = o.map((v) => (v * np) / peak);
  const g = 1 - 1 / (0.15 * (peak - np) + 1);
  return o.map((v) => v + (np - v) * g);
}

/** 走廊一侧墙（side −1 左、+1 右）离地 y 米处的像素（sRGB 0..1）。 */
function pixel(albedo: readonly number[], side: -1 | 1, y: number, atmo: keyof typeof ATMOSPHERES = 'morning'): number[] {
  const p = ATMOSPHERES[atmo];
  const sky = lin(p.hemi.sky), gr = lin(p.hemi.ground), lc = lin(p.lampColor);
  const d = p.dir?.dir ?? [0, -1, 0], dl = Math.hypot(...d), ndl = Math.max(0, (side * d[0]) / dl);
  const dc = lin(p.dir?.color ?? 0xffffff);
  const hwH = 0.55 + 0.45 * smooth(0, 3, y);
  const pre = albedo.map((a, i) => {
    const e = ((0.5 * (sky[i] as number) + 0.5 * (gr[i] as number)) * p.hemi.intensity) / Math.PI
      + ((dc[i] as number) * (p.dir?.intensity ?? 0) * ndl) / Math.PI + (lc[i] as number) * 0.9 * hwH * p.lampGain;
    return a * ATLAS_MEAN * wallShade(y, 3.1) * e;
  });
  return neutral(pre).map((v) => Math.min(1, Math.max(0, toSrgb(v))));
}
function hsl(rgb: number[]): { s: number; l: number } {
  const mx = Math.max(...rgb), mn = Math.min(...rgb), l = (mx + mn) / 2;
  return { s: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)), l };
}
const target = (h: number) => hsl([(h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);

describe('墙面受光补偿（wallTone.ts）', () => {
  it('toneInverse 是 NeutralToneMapping 的逆（暗部、亮部都对）', () => {
    for (const c of [[0.115, 0.212, 0.195], [0.02, 0.03, 0.05], [0.5, 0.55, 0.6]]) {
      const back = neutral(toneInverse(c));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(c[i] as number, 4);
    }
  });

  it('早晨走廊：左右两面墙的墙裙都在 #5F7F7A 的 ±0.05 饱和度 / ±0.1 亮度以内；墙面在 #C9CFCF 的 ±0.1 亮度以内', () => {
    const wains = target(PAL.wainscot), wall = target(PAL.wall);
    for (const side of [-1, 1] as const) {
      const yW = 0.6, a = wallAlbedo(PAL.wainscot, yW, { shade: wallShade(yW, 3.1) });
      const hw = hsl(pixel(a, side, 0.5));
      expect(Math.abs(hw.s - wains.s)).toBeLessThan(0.05);
      expect(Math.abs(hw.l - wains.l)).toBeLessThan(0.1);
      const yU = 2.1, b = wallAlbedo(PAL.wall, yU, { shade: wallShade(yU, 3.1) });
      const hu = hsl(pixel(b, side, 1.9));
      expect(Math.abs(hu.l - wall.l)).toBeLessThan(0.1);
      expect(hu.s).toBeLessThan(wall.s + 0.05);
      // 不补偿时就是验收员看到的又暗又饱和的深青绿
      const raw = hsl(pixel(lin(PAL.wainscot), side, 0.5));
      expect(raw.s).toBeGreaterThan(0.3);
      expect(raw.l).toBeLessThan(0.25);
    }
  });

  it('夜景（lift 0.3 + 去饱和）：墙不发白，墙裙也不再是饱和的深青绿', () => {
    const y = 0.6;
    const night = wallAlbedo(PAL.wainscot, y, { lift: NIGHT_LIFT, shade: wallShade(y, 3.1), desat: (1 - NIGHT_LIFT) * 0.5 });
    const full = wallAlbedo(PAL.wainscot, y, { shade: wallShade(y, 3.1) });
    expect(night[1]).toBeLessThan(full[1]);
    const h = hsl(pixel(night, -1, 0.5, 'nightIndoor'));
    expect(h.s).toBeLessThan(0.25);
    const wallN = wallAlbedo(PAL.wall, 2.1, { lift: NIGHT_LIFT, shade: wallShade(2.1, 3.1), desat: (1 - NIGHT_LIFT) * 0.5 });
    expect(hsl(pixel(wallN, -1, 1.9, 'nightIndoor')).l).toBeLessThan(0.9);
    // lift 0 = 原色板
    expect(wallAlbedo(PAL.wainscot, y, { lift: 0 })).toEqual(lin(PAL.wainscot));
  });

  /** 道具的一个面（法线 n）在 y 高处的像素（没有贴图、没有假 AO，静场整张亮度场 lamp）。 */
  function propPixel(albedo: readonly number[], n: [number, number, number], y: number, atmo: keyof typeof ATMOSPHERES, lamp: number): number[] {
    const p = ATMOSPHERES[atmo];
    const sky = lin(p.hemi.sky), gr = lin(p.hemi.ground), lc = lin(p.lampColor), dc = lin(p.dir?.color ?? 0xffffff);
    const d = p.dir?.dir ?? [0, -1, 0], dl = Math.hypot(...d), ndl = Math.max(0, -(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / dl);
    const w = 0.5 * n[1] + 0.5, hwH = 0.55 + 0.45 * smooth(0, 3, y);
    const pre = albedo.map((a, i) => a * (((gr[i] as number) + ((sky[i] as number) - (gr[i] as number)) * w) * p.hemi.intensity / Math.PI
      + (dc[i] as number) * (p.dir?.intensity ?? 0) * ndl / Math.PI + (lc[i] as number) * lamp * hwH * p.lampGain));
    return neutral(pre).map((v) => Math.min(1, Math.max(0, toSrgb(v))));
  }

  it('道具的暗色补偿：裤子 / 鞋 / 实验台 / 裙子的侧面落在色板值附近，不再是饱和的深蓝；亮色不动', () => {
    const cases: Array<[number, keyof typeof ATMOSPHERES]> = [[PAL.trousers, 'morning'], [PAL.trousers, 'overcast'], [PAL.trousers, 'noon'],
      [PAL.shoeTop, 'morning'], [0x2a3136, 'labNorth'], [0x3f4448, 'morning'], [PAL.blackboard, 'morning']];
    for (const [hex, atmo] of cases) {
      const t = target(hex);
      const a = propAlbedo(hex, { atmo, lamp: 1 });
      for (const n of [[-1, 0, 0], [1, 0, 0], [0, 0, 1]] as Array<[number, number, number]>) {
        const h = hsl(propPixel(a, n, 0.5, atmo, 1));
        expect(Math.abs(h.s - t.s)).toBeLessThan(0.15);
        expect(Math.abs(h.l - t.l)).toBeLessThan(0.08);
      }
      // 不补偿时就是验收员看到的饱和深色（饱和度 > 0.5）
      expect(hsl(propPixel(lin(hex), [-1, 0, 0], 0.5, atmo, 1)).s).toBeGreaterThan(hex === PAL.trousers || hex === PAL.shoeTop || hex === 0x2a3136 ? 0.5 : 0.3);
    }
    // 亮色（L ≥ 0.6）原样；虚空走廊 lift 0 不补偿
    for (const hex of [PAL.wall, PAL.deskTop, PAL.ceiling, PAL.steel]) expect(propAlbedo(hex)).toEqual(lin(hex));
    expect(propTone({ lift: 0 })).toBeNull();
    expect(kitPropTone(0)).toBeNull();
    // 夜景：补得少、去饱和多，裤子不再是饱和的深蓝，也不发白
    const night = kitPropTone(0.3) as (h: number) => readonly number[];
    const hn = hsl(propPixel(night(PAL.trousers), [-1, 0, 0], 0.5, 'nightIndoor', 0.9));
    expect(hn.s).toBeLessThan(0.45); expect(hn.l).toBeLessThan(0.3);
  });

  it('KitGeo.tone 只作用于十六进制颜色；线性 RGB（墙面补偿）原样写入；withTone(null) 临时关掉', () => {
    const g = new KitGeo();
    g.tone = (h) => (h === 0x123456 ? [0.5, 0.25, 0.125] : h);
    g.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], 0x123456);
    expect(g.col.slice(0, 3)).toEqual([0.5, 0.25, 0.125]);
    g.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.9, 0.8, 0.7]);
    expect(g.col.slice(9, 12)).toEqual([0.9, 0.8, 0.7]);
    g.withTone(null, () => g.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], 0x123456));
    expect(g.col[g.col.length - 3]).toBeCloseTo(lin(0x123456)[0] as number, 6);
    expect(g.tone).not.toBeNull();
  });
});
