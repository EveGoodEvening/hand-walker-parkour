// tests/unit/render/atmosphere.test.ts —— 13 个氛围预设（DESIGN.md §5.2）与插值。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERES, ATMO_EXTRA, AtmosphereMixer, DREAM_GRAY_END, MIN_FAR_OVER_NEAR, RAIN_LAMP, presetToState, newState } from '../../../src/render/atmosphere';
import type { AtmosphereId } from '../../../src/core/types';

// §5.2 表：[雾色, near, far, 半球强度, lampGain, chalkMin, dark, planarDir]。rainNight 的半球光、灯的增益按 U6 修订（0.25 → 0.45，1.2 → 2.3，建议 §10.3）。
const TABLE: Record<AtmosphereId, [number, number, number, number, number, number, boolean, [number, number, number]]> = {
  morning: [0xaab4b8, 10, 48, 1.2, 0.6, 0, false, [0.3, -1, -0.55]],
  noon: [0xb5bcbc, 12, 50, 1.3, 0.4, 0, false, [0.15, -1, -0.3]],
  labNorth: [0x8e9ca3, 8, 38, 1.0, 0.8, 0, false, [0.3, -1, -0.55]],
  nightIndoor: [0x0f151a, 6, 30, 0.35, 1.4, 0.35, true, [0.3, -1, -0.55]],
  rainNight: [0x0e1419, 4, 26, 0.45, 2.3, 0.35, true, [0.2, -1, -0.4]],
  busNight: [0x0b1014, 3, 14, 0.2, 0.8, 0, false, [0.3, -1, -0.55]],
  homeDark: [0x0b1014, 3, 14, 0.15, 0.5, 0, false, [0.3, -1, -0.55]],
  dream: [0xd9dee0, 20, 120, 1.8, 0, 0, false, [0.1, -0.35, -0.9]],
  dreamGray: [0xd9dee0, 20, 60, 1.6, 0, 0.2, false, [0.1, -0.35, -0.9]],
  dawn: [0x7f909a, 8, 45, 0.8, 0.3, 0, false, [0.1, -0.6, 0.8]],
  overcast: [0xc3c8cb, 15, 70, 1.5, 0.4, 0, false, [0.3, -1, -0.55]],
  fluorescent: [0xdde4e6, 6, 25, 1.4, 0.6, 0, false, [0.3, -1, -0.55]],
  voidDark: [0x07090b, 4, 18, 0.05, 1.6, 0.4, true, [0.3, -1, -0.55]],
};

describe('氛围预设（§5.2）', () => {
  it('13 个预设逐项与表一致', () => {
    expect(Object.keys(ATMOSPHERES).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [id, [fog, near, far, hemi, gain, chalk, dark, planar]] of Object.entries(TABLE) as Array<[AtmosphereId, (typeof TABLE)[AtmosphereId]]>) {
      const p = ATMOSPHERES[id];
      expect(p.fog).toEqual({ color: fog, near, far });
      expect(p.hemi.intensity).toBe(hemi);
      expect(p.lampGain).toBe(gain);
      expect(p.chalkMin).toBe(chalk);
      expect(p.dark).toBe(dark);
      expect(p.planarDir).toEqual(planar);
      expect(p.background).toBe(fog);
    }
    // U6：雨夜照到人和物体的灯色是冷色；路灯碎金只用于地面光池（ATMO_EXTRA.poolColor，见 rainNight.test.ts）
    expect(ATMOSPHERES.rainNight.lampColor).toBe(RAIN_LAMP);
    expect(ATMO_EXTRA.rainNight.poolColor).toBe(0xc8a15a);
    expect(ATMOSPHERES.dawn.dir?.dir[2]).toBeGreaterThan(0);          // 从前方照来，影子向后
    expect(ATMOSPHERES.rainNight.dir?.dir[2]).toBeGreaterThan(0);     // 雨夜的冷色逆光也从前方照来
    for (const id of ['busNight', 'homeDark', 'overcast', 'fluorescent', 'voidDark'] as const) expect(ATMOSPHERES[id].dir).toBeNull();
    // 表里没写平行光颜色的几行沿用 #E9EEF0
    for (const id of ['noon', 'labNorth', 'nightIndoor'] as const) expect(ATMOSPHERES[id].dir?.color).toBe(0xe9eef0);
  });

  it('暗色预设的 LampField 最低亮度 ≥ 0.15（R12）；voidDark 底亮度 0.15', () => {
    for (const id of Object.keys(ATMOSPHERES) as AtmosphereId[]) {
      if (ATMOSPHERES[id].dark) expect(ATMO_EXTRA[id].lampFloor).toBeGreaterThanOrEqual(0.15);
    }
    expect(ATMO_EXTRA.voidDark.lampFloor).toBe(0.15);
  });

  it('低画质雾远距离 ×0.8，但不小于 near + 9 m（R4）', () => {
    const st = newState();
    presetToState('morning', ATMOSPHERES.morning, 0.8, st);
    expect(st.far).toBeCloseTo(38.4, 5);
    presetToState('busNight', ATMOSPHERES.busNight, 0.8, st);
    expect(st.far).toBeGreaterThanOrEqual(3 + MIN_FAR_OVER_NEAR);
  });

  it('插值器：按秒过渡颜色、强度、雾距；fog cue 只改雾距', () => {
    const m = new AtmosphereMixer((id) => ATMOSPHERES[id]);
    m.snap('morning');
    m.update(0);
    expect(m.fog.near).toBe(10);
    m.transition('nightIndoor', 2, 0);
    m.update(1);
    expect(m.fog.near).toBeGreaterThan(6); expect(m.fog.near).toBeLessThan(10);
    expect(m.hemi.intensity).toBeGreaterThan(0.35); expect(m.hemi.intensity).toBeLessThan(1.2);
    m.update(2.01);
    expect(m.fog.near).toBe(6);
    expect(m.fog.color.getHex()).toBe(new THREE.Color(0x0f151a).getHex());
    expect(m.cur.chalkMin).toBe(0.35);
    m.fogTo(5, 20, 1, 3);
    m.update(4.1);
    expect(m.fog.near).toBe(5); expect(m.fog.far).toBe(20);
    expect(m.id).toBe('nightIndoor');
    // 光源数量不变（平行光没有时强度为 0，不切 visible，材质不重编译）
    m.snap('overcast'); m.update(5);
    expect(m.dirLight.visible).toBe(true);
    expect(m.dirLight.intensity).toBe(0);
  });

  it('dreamGray 渐变（§5.2）：fog cue 把 far 从 60 收到 28 时，雾色 #D9DEE0 → #5D6468、背景同步、半球光 1.6 → 0.9', () => {
    const hex = (c: THREE.Color) => c.getHex();
    for (const mul of [1, 0.8]) {
      const m = new AtmosphereMixer((id) => ATMOSPHERES[id]);
      m.fogMul = mul;
      m.snap('dreamGray');
      m.update(0);
      expect(hex(m.fog.color)).toBe(0xd9dee0);
      expect(m.hemi.intensity).toBeCloseTo(1.6, 6);
      m.fogTo(20, 44, 0, 0);                          // 走到一半
      m.update(0);
      expect(m.hemi.intensity).toBeCloseTo(1.25, 6);
      const mid = m.fog.color.clone();
      expect(mid.r).toBeGreaterThan(new THREE.Color(0x5d6468).r);
      expect(mid.r).toBeLessThan(new THREE.Color(0xd9dee0).r);
      m.fogTo(20, DREAM_GRAY_END.far, 4, 1);           // 4 s 内收到 28 m
      m.update(3);
      expect(m.hemi.intensity).toBeGreaterThan(0.9); expect(m.hemi.intensity).toBeLessThan(1.25);
      m.update(5.01);
      expect(hex(m.fog.color)).toBe(0x5d6468);
      expect(hex(m.cur.bg)).toBe(0x5d6468);
      expect(m.hemi.intensity).toBeCloseTo(0.9, 6);
      expect(m.fog.far).toBeCloseTo(Math.max(20 + MIN_FAR_OVER_NEAR * 0.5, 28 * mul), 6);
    }
    // 别的预设的 fog cue 不改颜色
    const m = new AtmosphereMixer((id) => ATMOSPHERES[id]);
    m.snap('dream'); m.fogTo(20, 28, 0, 0); m.update(0);
    expect(m.fog.color.getHex()).toBe(0xd9dee0);
    expect(m.hemi.intensity).toBeCloseTo(1.8, 6);
  });

  it('切画质（setFogMul）：只重算 far，进行中的过渡与 fog cue 的覆盖都保留', () => {
    const m = new AtmosphereMixer((id) => ATMOSPHERES[id]);
    m.snap('morning'); m.update(0);
    m.fogTo(5, 15, 0, 1); m.update(1);
    expect([m.fog.near, m.fog.far]).toEqual([5, 15]);
    m.setFogMul(0.8);
    expect(m.fog.near).toBe(5); expect(m.fog.far).toBeCloseTo(12, 6);
    m.setFogMul(1);
    expect(m.fog.far).toBeCloseTo(15, 6);
    // 过渡进行到一半时切画质：过渡继续，终点按新倍率
    m.transition('nightIndoor', 2, 10);
    m.update(11);
    m.setFogMul(0.8);
    expect(m.transitioning).toBe(true);
    expect(m.id).toBe('nightIndoor');
    m.update(12.01);
    expect(m.fog.near).toBe(6);
    expect(m.fog.far).toBeCloseTo(24, 6);
    expect(m.cur.chalkMin).toBe(0.35);
    // fog cue 不打断进行中的预设过渡
    m.transition('labNorth', 3, 20);
    m.update(21);
    m.fogTo(7, 20, 0, 21);
    expect(m.transitioning).toBe(true);
    m.update(23.01);
    expect(m.hemi.intensity).toBeCloseTo(1.0, 6);
    expect(m.cur.lampGain).toBeCloseTo(0.8, 6);
    expect([m.fog.near, m.fog.far]).toEqual([7, 16]);
  });
});
