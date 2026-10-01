// tests/unit/actors/tone.test.ts —— 修复轮 U5（triage F11 的主角部分）：户外阴天、黎明、梦里，主角的校服和裤子在画面上
// 不再是饱和的深蓝、近黑。仿照 tests/unit/outside/tone.test.ts 的 Node 颜色模拟（Lambert ÷ π、NeutralToneMapping、sRGB），
// 参考朝向是追尾镜头主要看到的背与背顶；早晨（以及其余室内氛围）与改动前相同。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propHex } from '../../../src/render/wallTone';
import { presetOf, screenColor } from '../../../src/render/kits/outside/lib/tone';
import '../../../src/render/atmosphere';
import { ActorRigFactory, clothAlbedo, FIGURE_TONE_NORMAL, RIG_COLORS, rigColor } from '../../../src/render/actors/rigBuild';
import { fakeCtx } from './helpers';

const hsl = (c: readonly number[]) => {
  const mx = Math.max(...c), mn = Math.min(...c), l = (mx + mn) / 2;
  return { s: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)), l };
};
const lin = (hex: number) => { const c = new THREE.Color().setHex(hex); return [c.r, c.g, c.b] as [number, number, number]; };

describe('protagonist clothing under outdoor light (U5, F11)', () => {
  for (const atmo of ['overcast', 'dawn'] as const) {
    for (const key of ['uniform', 'pants'] as const) {
      it(`${atmo}: ${key} on screen has s ≤ 0.45 and l ≥ 0.2 (it was s ≈ 0.6, l ≈ 0.14)`, () => {
        const c = hsl(screenColor(clothAlbedo(key, atmo), presetOf(atmo), FIGURE_TONE_NORMAL));
        expect(c.s).toBeLessThanOrEqual(0.45);
        expect(c.l).toBeGreaterThanOrEqual(0.2);
        // 以前（只按早晨补偿）在同一朝向上更暗或更饱和
        const old = hsl(screenColor(lin(propHex(RIG_COLORS[key])), presetOf(atmo), FIGURE_TONE_NORMAL));
        expect(old.s > 0.45 || old.l < 0.2).toBe(true);
      });
    }
  }

  it('morning and the indoor atmospheres keep the morning compensation exactly (Δ ≤ 0.02)', () => {
    for (const atmo of ['morning', 'noon', 'labNorth', 'rainNight', 'fluorescent'] as const) {
      for (const key of ['uniform', 'pants'] as const) {
        const a = clothAlbedo(key, atmo), b = lin(rigColor(key));
        for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('the shared rig geometry is retoned on atmosphere change and restored for morning', () => {
    const ctx = fakeCtx('low');
    const f = new ActorRigFactory(ctx);
    const g = f.geometry();
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const before = Float32Array.from(col.array as Float32Array);
    const u = lin(rigColor('uniform'));
    const idx = Array.from({ length: col.count }, (_, i) => i).find((i) => Math.abs(col.getX(i) - u[0]) < 1e-5 && Math.abs(col.getZ(i) - u[2]) < 1e-5)!;
    f.setAtmosphere('overcast');
    const o = clothAlbedo('uniform', 'overcast');
    expect(col.getX(idx)).toBeCloseTo(o[0], 5); expect(col.getZ(idx)).toBeCloseTo(o[2], 5);
    f.setAtmosphere('morning');
    expect(Array.from(col.array as Float32Array)).toEqual(Array.from(before));
  });
});
