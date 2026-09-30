// tests/unit/render/atmosphere.test.ts —— 13 个氛围预设（DESIGN.md §5.2）与插值。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERES, ATMO_EXTRA, AtmosphereMixer, MIN_FAR_OVER_NEAR, presetToState, newState } from '../../../src/render/atmosphere';
import type { AtmosphereId } from '../../../src/core/types';

// §5.2 表：[雾色, near, far, 半球强度, lampGain, chalkMin, dark, planarDir]
const TABLE: Record<AtmosphereId, [number, number, number, number, number, number, boolean, [number, number, number]]> = {
  morning: [0xaab4b8, 10, 48, 1.2, 0.6, 0, false, [0.3, -1, -0.55]],
  noon: [0xb5bcbc, 12, 50, 1.3, 0.4, 0, false, [0.15, -1, -0.3]],
  labNorth: [0x8e9ca3, 8, 38, 1.0, 0.8, 0, false, [0.3, -1, -0.55]],
  nightIndoor: [0x0f151a, 6, 30, 0.35, 1.4, 0.35, true, [0.3, -1, -0.55]],
  rainNight: [0x0e1419, 4, 26, 0.25, 1.2, 0.35, true, [0.2, -1, -0.4]],
  busNight: [0x0b1014, 3, 14, 0.2, 0.8, 0, true, [0.3, -1, -0.55]],
  homeDark: [0x0b1014, 3, 14, 0.15, 0.5, 0, true, [0.3, -1, -0.55]],
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
    expect(ATMOSPHERES.rainNight.lampColor).toBe(0xc8a15a);          // 路灯色
    expect(ATMOSPHERES.dawn.dir?.dir[2]).toBeGreaterThan(0);          // 从前方照来，影子向后
    for (const id of ['rainNight', 'busNight', 'homeDark', 'overcast', 'fluorescent', 'voidDark'] as const) expect(ATMOSPHERES[id].dir).toBeNull();
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
});
