// tests/unit/render/rainNight.test.ts —— 第三章雨夜的光照（U6）：人和物体受冷色的灯光，路灯的碎金只留在地面光池上。
// 以前 rainNight 的 LampField 灯色就是路灯色 #C8A15A，主角、障碍整体被染成赭黄（画面上躯干色相 46–49°）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LampSpec } from '../../../src/core/contracts';
import { RIG_COLORS } from '../../../src/render/actors/rigBuild';
import { ATMOSPHERES, ATMO_EXTRA, STREET_GOLD, newState, presetToState, registerAtmospheres } from '../../../src/render/atmosphere';
import { LAMP_TEXEL_M, LampField } from '../../../src/render/lampField';
import { propHex } from '../../../src/render/wallTone';
import { World } from '../../../src/render/ChunkStreamer';
import '../../../src/render/kits/outside/index';
import { fakeCtx, snap } from './helpers';
import { hexHsl, hsl, lin, screenColor, type V3 } from './shade';

registerAtmospheres();

const RAIN = ATMOSPHERES.rainNight;
/** 主角校服的反照率（WP5 rigBuild 写进顶点色的值：按 §5.1「画面上的颜色」反推，propHex）。 */
const UNIFORM = lin(propHex(RIG_COLORS.uniform));
/** 爬行时躯干前倾约 70°：镜头看到的背面法线朝上偏后。 */
const BACK: V3 = [0, Math.sin(70 * Math.PI / 180), Math.cos(70 * Math.PI / 180)];
const TORSO_Y = 0.43;

/**
 * 第三章街道上的 LampField：路灯每 every 米一盏（WP4 street kit：校门内 grid(12)；3-4 小路每 15 m 一盏、坏了一半 = 30 m），
 * 底亮度取 rainNight 的 lampFloor。取中间两个整周期的平均、最小、最大。
 */
function streetField(every = 12): { mean: number; min: number; max: number } {
  const lf = new LampField();
  const lamps: LampSpec[] = [];
  for (let s = 0; s <= 12 * every; s += every) lamps.push({ s, x: 2.35, y: 3.6, kind: 'street', flickerable: false });
  lf.addLamps('street', lamps);
  lf.floor = ATMO_EXTRA.rainNight.lampFloor;
  lf.update(0, 5 * every, 0);
  const a = 4 * every, b = 6 * every;
  const base = lf.textureBase;
  let sum = 0, n = 0, min = Infinity, max = 0;
  for (let i = 0; i < lf.field.length; i++) {
    const s = base + (i + 0.5) * LAMP_TEXEL_M;
    if (s < a || s >= b) continue;
    const v = lf.field[i] as number;
    sum += v; n++; min = Math.min(min, v); max = Math.max(max, v);
  }
  return { mean: sum / n, min, max };
}

describe('rainNight：冷色受光（U6）', () => {
  it('LampField 照到人和物体的灯色是冷色；路灯光池贴花仍是碎金；底亮度 ≥ 0.15（R12），半球光 0.45 + 0.2 的冷色逆光', () => {
    expect(hexHsl(RAIN.lampColor).h).toBeGreaterThan(190);
    expect(hexHsl(RAIN.lampColor).h).toBeLessThan(235);
    expect(RAIN.hemi.intensity).toBeCloseTo(0.45, 6);
    expect(RAIN.dir?.intensity).toBeCloseTo(0.2, 6);
    expect(hexHsl(RAIN.dir?.color ?? 0).h).toBeGreaterThan(190);
    expect(ATMO_EXTRA.rainNight.lampFloor).toBeGreaterThanOrEqual(0.25);
    expect(ATMO_EXTRA.rainNight.poolColor).toBe(STREET_GOLD);
    const st = presetToState('rainNight', RAIN, 1, newState());
    // 平面影子的方向仍是预设的 planarDir（逆光是另一个方向）
    expect(st.planarVec.toArray().map((v) => +v.toFixed(4))).toEqual(new THREE.Vector3(...RAIN.planarDir).normalize().toArray().map((v) => +v.toFixed(4)));
    expect(st.dirVec.z).toBeGreaterThan(0);
    const pool = hexHsl(st.poolColor.getHex());
    expect(pool.h).toBeGreaterThanOrEqual(30); expect(pool.h).toBeLessThanOrEqual(55);
    // 其他氛围的光池 = 灯色（暖色不出第三章，附录 A-9）
    for (const id of ['morning', 'nightIndoor', 'dawn', 'voidDark'] as const) {
      const s2 = presetToState(id, ATMOSPHERES[id], 1, newState());
      expect(s2.poolColor.getHex()).toBe(s2.lampColor.getHex());
    }
  });

  it('主角校服在街上（路灯每 12 m 一盏）的画面色：色相 190–235°，平均灯光下 l ≥ 0.12；两灯之间也不发黄、不全黑', () => {
    const f = streetField(12), alley = streetField(30);
    expect(f.min).toBeCloseTo(ATMO_EXTRA.rainNight.lampFloor, 2);
    expect(f.max).toBeGreaterThan(0.9);
    const rows: string[] = [];
    for (const [name, lamp, lMin] of [['平均', f.mean, 0.12], ['两灯之间', f.min, 0.09], ['灯下', f.max, 0.15], ['3-4 小路平均', alley.mean, 0.1]] as const) {
      const c = screenColor(UNIFORM, RAIN, BACK, { lamp, y: TORSO_Y });
      rows.push(`${name} lamp=${lamp.toFixed(2)} h=${c.h.toFixed(0)} l=${c.l.toFixed(3)}`);
      expect(c.h, name).toBeGreaterThanOrEqual(190);
      expect(c.h, name).toBeLessThanOrEqual(235);
      expect(c.l, name).toBeGreaterThanOrEqual(lMin);
    }
    // 对照：灯色还是路灯碎金时，同样的灯光下躯干是赭黄（修改前的样子）
    const old = screenColor(UNIFORM, RAIN, BACK, { lamp: f.mean, y: TORSO_Y, lampColor: STREET_GOLD });
    expect(old.h).toBeGreaterThan(30); expect(old.h).toBeLessThan(60);
    // 实测（lampFloor 0.35）：平均 0.59 → h 209° l 0.130；两灯之间 0.35 → l 0.096；灯下 1.0 → l 0.182；
    // 3-4 小路（30 m 一盏）平均 0.43 → l 0.107；旧灯色同样灯光下 h 51°
    expect(rows.length).toBe(4);
  });

  it('World：rainNight 下 uLampColor 是冷色；street 灯的地面光池贴花是碎金（色相 30–55°）', async () => {
    const ctx = fakeCtx('low');
    const w = new World();
    w.init(ctx);
    const r = w.startPreview({ kit: 'street', variant: 'alley', atmosphere: 'rainNight', beats: 60, beat: 12, stride: 1.1 });
    const sn = snap({ s: r.s, t: 1, segIndex: 0 });
    w.frame(sn, sn, 1, 1 / 60);
    const u = w.lamps.uniforms.uLampColor.value as THREE.Color;
    expect(hsl([u.r, u.g, u.b]).h).toBeGreaterThan(190);
    // 地面贴花：pool（aDecal.x = 1）里来自路灯的那几个
    const mesh = w.decals.mesh;
    const kind = mesh.geometry.getAttribute('aDecal');
    const col = mesh.instanceColor as THREE.InstancedBufferAttribute;
    const hues: number[] = [];
    for (let i = 0; i < w.decals.count; i++) {
      if (kind.getX(i) !== 1) continue;
      const h = hsl([col.getX(i), col.getY(i), col.getZ(i)]);
      if (h.s > 0.3) hues.push(h.h);
    }
    expect(hues.length).toBeGreaterThan(0);
    for (const h of hues) { expect(h).toBeGreaterThanOrEqual(30); expect(h).toBeLessThanOrEqual(55); }
    w.stopPreview();
  });
});
