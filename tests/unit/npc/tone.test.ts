// tests/unit/npc/tone.test.ts —— NPC 衣服颜色随段的氛围补偿（U6，triage F11 的 NPC 部分）。
// 集成时只按早晨走廊（morning、灯 0.9）补偿过一次：5-7 跑道（阴天、没有灯）上同学的腿在画面上是 s 0.64、l 0.13 的深蓝，近处几根接近纯黑。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AtmosphereId, ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { ATMOSPHERES } from '../../../src/render/atmosphere';
import { C, PALETTE } from '../../../src/render/npc/colors';
import { NpcTone, TONE_FADE, npcAlbedo, paletteOf, tonedHex } from '../../../src/render/npc/tone';
import { propHex } from '../../../src/render/wallTone';
import { screenColor, type V3 } from '../render/shade';
import { ViewDriver, makeView } from './helpers';

/** 画面上的颜色：衣服朝侧面 / 朝镜头的竖直面，离地 0.6 m；室内灯 0.9（两灯之间到灯下的平均），户外没有灯。 */
function onScreen(hex: number, atmo: AtmosphereId, outdoor: boolean, n: V3): { h: number; s: number; l: number } {
  const a = npcAlbedo(hex, atmo, outdoor);
  return screenColor(a, ATMOSPHERES[atmo], n, { lamp: outdoor ? 0 : 0.9, y: 0.6 });
}
const FACES: Array<[string, V3]> = [['+x', [1, 0, 0]], ['-x', [-1, 0, 0]], ['+z（朝镜头）', [0, 0, 1]]];

describe('NPC 衣服颜色随氛围补偿（U6）', () => {
  it('overcast、dawn 下 trousers 与 uniform 在画面上 s ≤ 0.45、l ≥ 0.2（户外没有灯 / 室内有灯，侧面和朝镜头的面）', () => {
    const rows: string[] = [];
    for (const atmo of ['overcast', 'dawn'] as const) {
      for (const outdoor of [true, false]) {
        for (const [name, hex] of [['trousers', C.trousers], ['uniform', C.uniform]] as const) {
          for (const [fn, n] of FACES) {
            const c = onScreen(hex, atmo, outdoor, n);
            rows.push(`${atmo} ${outdoor ? '户外' : '室内'} ${name} ${fn}: s ${c.s.toFixed(2)} l ${c.l.toFixed(3)}`);
            expect(c.s, rows[rows.length - 1]).toBeLessThanOrEqual(0.45);
            expect(c.l, rows[rows.length - 1]).toBeGreaterThanOrEqual(0.2);
          }
        }
      }
    }
    // 对照：沿用早晨的补偿时，阴天户外的裤子又饱和又暗（triage 的取样 s 0.64、l 0.13）
    const tc = new THREE.Color().setHex(C.trousers);
    const old = screenColor([tc.r, tc.g, tc.b], ATMOSPHERES.overcast, [0, 0, 1], { lamp: 0, y: 0.6 });
    expect(old.s).toBeGreaterThan(0.45);
    expect(old.l).toBeLessThan(0.2);
  });

  it('morning（以及没有列入的氛围）与改动前完全一样（差 ≤ 0.02）', () => {
    const hexes = [C.trousers, C.uniform, C.hair, C.shoe, C.bag, tonedHex(0x26344a), tonedHex(0x3a464d), 0xd9dee3, 0x7e878b];
    const toSrgb = (c: THREE.Color) => c.clone().convertLinearToSRGB();
    for (const atmo of ['morning', 'noon', 'labNorth', 'nightIndoor', 'rainNight', 'fluorescent', 'voidDark'] as const) {
      for (const hex of hexes) {
        for (const outdoor of [true, false]) {
          const a = npcAlbedo(hex, atmo, outdoor);
          const now = toSrgb(new THREE.Color().setRGB(a[0], a[1], a[2], THREE.LinearSRGBColorSpace));
          const before = toSrgb(new THREE.Color().setHex(hex));
          expect(Math.max(Math.abs(now.r - before.r), Math.abs(now.g - before.g), Math.abs(now.b - before.b)), `${atmo} ${hex.toString(16)}`).toBeLessThanOrEqual(0.02);
        }
      }
    }
    // Look 里的颜色仍是 propHex（早晨走廊的补偿）；色板原值记在 tone.ts
    expect(C.trousers).toBe(propHex(PALETTE.trousers));
    expect(paletteOf(C.trousers)).toBe(PALETTE.trousers);
  });

  it('氛围切换时 1.5 s 渐变，不在段界上跳色；读章 / 重来立即到位', () => {
    const t = new NpcTone();
    t.snap('nightIndoor');
    const out = new THREE.Color();
    const m = npcAlbedo(C.trousers, 'morning', true), o = npcAlbedo(C.trousers, 'overcast', true);
    t.update('overcast', 10);
    t.color(C.trousers, true, out);
    expect(out.r).toBeCloseTo(m[0], 6);
    t.update('overcast', 10 + TONE_FADE / 2);
    t.color(C.trousers, true, out);
    expect(out.r).toBeCloseTo((m[0] + o[0]) / 2, 6);
    t.update('overcast', 10 + TONE_FADE + 0.01);
    t.color(C.trousers, true, out);
    expect(out.r).toBeCloseTo(o[0], 6);
    t.snap('dawn');
    t.color(C.trousers, true, out);
    expect(out.r).toBeCloseTo(npcAlbedo(C.trousers, 'dawn', true)[0], 6);
  });

  it('重来：与 World 谁先 onReset 无关，第一帧直接按那时的氛围着色（不从旧氛围渐变 1.5 s）', () => {
    const { view, ctx } = makeView('high');
    // World 的氛围插值器：onReset 时还是旧的（假设 World 排在后面才重放检查点的 atmosphere）
    const atmo = { id: 'nightIndoor' as AtmosphereId };
    (ctx as { atmosphere?: unknown }).atmosphere = atmo;
    const vd = new ViewDriver(view, getChapter('ch5') as ChapterDef, { segment: '5-7', beat: 8 });
    vd.d.sim.setInvincible(true);
    vd.step(2);
    view.onReset(vd.d.snap);
    expect(view.forest.tone.mode).toBe('morning');          // nightIndoor 按早晨补偿
    atmo.id = 'overcast';                                   // World 这时才重放到 overcast
    vd.step(1);
    expect(view.forest.tone.mode).toBe('overcast');
    expect(view.forest.tone.k).toBe(1);
  });

  it('ObstacleView：5-7 跑道（户外）与 5-6 走廊（室内、有灯）按 overcast 着色；第一章按 morning（不变）', () => {
    const cases: Array<[ChapterId, string, AtmosphereId, boolean]> = [['ch5', '5-7', 'overcast', true], ['ch5', '5-6', 'overcast', false], ['ch1', '1-1', 'morning', false]];
    for (const [ch, seg, atmo, outdoor] of cases) {
      const { view } = makeView('high');
      const vd = new ViewDriver(view, getChapter(ch) as ChapterDef, { segment: seg, beat: 8 });
      vd.d.sim.setInvincible(true);
      vd.step(20);
      // 裤腿（thigh）的实例色都应是某个衣服颜色在这个氛围下的反照率
      const pool = view.forest.pool('thigh');
      const col = pool.mesh.instanceColor as THREE.InstancedBufferAttribute;
      expect(pool.n, seg).toBeGreaterThan(0);
      const want = new Set<string>();
      const key = (r: number, g: number, b: number) => `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
      const pants = [0x2a3a52, 0x26344a, 0x2f3f58, 0x1e2226, 0x2f4a6d, 0x3f4448, 0x5b6468, 0x2a3136, 0x7e878b, 0x8a9396, 0x737c80, 0x9aa3a6, 0x3a464d, 0x1c2227, 0x33404a];
      for (const h of [...pants.map(tonedHex), C.trousers, C.maPants, 0x2a3136]) { const a = npcAlbedo(h, atmo, outdoor); want.add(key(a[0], a[1], a[2])); }
      for (let i = 0; i < pool.n; i++) expect(want.has(key(col.getX(i), col.getY(i), col.getZ(i))), `${seg} #${i}`).toBe(true);
    }
  });
});

describe('npcAlbedo 的缓存（§9.4 热路径不分配：数字键，不拼字符串）', () => {
  it('同一组参数返回同一个数组；户外 / 室内、不同模式各自缓存，互不串号', () => {
    const hex = C.trousers;
    const a = npcAlbedo(hex, 'overcast', true);
    expect(npcAlbedo(hex, 'overcast', true)).toBe(a);
    expect(npcAlbedo(hex, 'dawn', true)).toBe(npcAlbedo(hex, 'dawn', true));
    const indoor = npcAlbedo(hex, 'overcast', false);
    expect(indoor).not.toBe(a);
    expect(indoor).not.toEqual(a);                                  // 室内算灯 0.9，户外不算
    // 非户外氛围一律按早晨补偿：rainNight 与 morning 是同一个缓存项
    expect(npcAlbedo(hex, 'rainNight', true)).toBe(npcAlbedo(hex, 'morning', true));
    // 户外位不会和某个更大的 hex 撞键
    const m1 = npcAlbedo(0x000001, 'morning', true), m2 = npcAlbedo(0x000001, 'morning', false);
    expect(m1).toEqual(m2);
    expect(npcAlbedo(0x1000001 & 0xffffff, 'morning', false)).toBe(m2);
  });
});
