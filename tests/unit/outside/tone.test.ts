// tests/unit/outside/tone.test.ts —— 受光补偿（§5.1 色板 = 画面上的颜色；§5 总则：Lambert ÷ π、NeutralToneMapping、sRGB）。
// 在 Node 里模拟「顶点色 × 半球光 + 平行光 → Neutral → sRGB」，检查户外 kit 在画面上的颜色贴近色板（验收第 2 轮：
// 阴天的跑道在截图里是 (51, 14, 5)、饱和度 0.9，草、清晨的人行道、梦里的人群同样又暗又饱和）。
import { describe, expect, it } from 'vitest';
import type { KitChunk } from '../../../src/core/contracts';
import type { AtmospherePreset } from '../../../src/core/registry';
import { getKit } from '../../../src/core/registry';
import { createRng } from '../../../src/core/rng';
import type { KitId } from '../../../src/core/types';
import { C, hsv } from '../../../src/render/kits/outside/lib/colors';
import { HALF } from '../../../src/render/kits/outside/lib/kit';
import { DARK_LIFT, Tone, darkLift, lin, neutralInverse, neutralTone, presetOf, screenColor, type Lin3 } from '../../../src/render/kits/outside/lib/tone';
import '../../../src/render/kits/outside/plaza';
import '../../../src/render/kits/outside/street';
import '../../../src/render/kits/outside/track';
import { chunkContexts, mirror, obstacle, segment } from './helpers';

const px = (c: Lin3) => c.map((v) => Math.round(v * 255));
const hexOf = (c: Lin3) => { const [r, g, b] = px(c); return ((r as number) << 16) | ((g as number) << 8) | (b as number); };
const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));
const UP = [0, 1, 0] as const;

/** §5.2 表里逐行照抄的几行（平行光方向按表；CORE 的回落表把所有平行光都放在 (0.3, −1, −0.55)）。 */
const P52: Record<string, AtmospherePreset> = {
  dream: { ...presetOf('dream'), dir: { color: 0xf0f3f4, intensity: 1.2, dir: [0.1, -0.35, -0.9] } },
  dawn: { ...presetOf('dawn'), dir: { color: 0xc9d6de, intensity: 1.0, dir: [0.1, -0.6, 0.8] } },
  overcast: { ...presetOf('overcast') },
};

function chunks(kit: KitId, variant: string, tier: 'low' | 'medium' | 'high' = 'low', extra: Parameters<typeof segment>[0] = { kit, variant }): KitChunk[] {
  const k = getKit(kit)!;
  return chunkContexts(segment({ beats: 60, ...extra }), tier).map((c) => k.build(c));
}

describe('NeutralToneMapping 的模拟与逆', () => {
  it('模拟器复现验收截图里的像素：阴天的跑道直接拿 #7A4B44 当反照率，画面上是 (51, 14, 5)', () => {
    const c = px(screenColor(lin(C.track), presetOf('overcast'), UP));
    expect(dist(c, [51, 14, 5])).toBeLessThanOrEqual(3);
    expect(hsv(hexOf(screenColor(lin(C.track), presetOf('overcast'), UP))).s).toBeGreaterThan(0.8);
  });
  it('逆映射：任何能被映射到的颜色都能精确还原（toe、线性段、肩部）', () => {
    const rng = createRng(5, 'tone');
    for (let i = 0; i < 4000; i++) {
      const c: Lin3 = [rng.next() * 3 * rng.next(), rng.next() * 3 * rng.next(), rng.next() * 3 * rng.next()];
      const t = neutralTone(c);
      if (Math.max(...t) > 0.98) continue;
      const back = neutralInverse(t);
      for (let k = 0; k < 3; k++) expect(Math.abs((back[k] as number) - (c[k] as number))).toBeLessThan(1e-6 + 1e-6 * (c[k] as number));
    }
  });
});

describe('§5.1 的色板就是画面上的颜色（户外、梦、清晨）', () => {
  const floors: Array<[string, number, string]> = [
    ['track', C.track, 'overcast'], ['grass', C.grass, 'overcast'], ['trackLine', C.trackLine, 'overcast'],
    ['dawnPaver', C.dawnPaver, 'dawn'], ['plaza', C.plaza, 'dream'], ['plazaGray', C.plazaSeam, 'dreamGray'],
  ];
  for (const [name, hex, atmo] of floors) {
    it(`地面 ${name}（${atmo}）：补偿后的反照率在画面上 = 色板（±2/255），CORE 回落表与 §5.2 原表都成立`, () => {
      for (const p of [presetOf(atmo as never), P52[atmo]].filter(Boolean) as AtmospherePreset[]) {
        const a = new Tone(p).albedo(lin(hex), 'floor');
        expect(dist(px(screenColor(a, p, UP)), rgb(hex))).toBeLessThanOrEqual(2);
      }
    });
  }
  it('竖直面的色板是「背光面」的颜色：背光的墙 = 色板；被平行光照到的面更亮，但不会更饱和', () => {
    for (const [hex, atmo] of [[C.dawnWall2, 'dawn'], [C.crowd, 'dream'], [C.bleacher, 'overcast']] as const) {
      for (const p of [presetOf(atmo), P52[atmo]!]) {
        const t = new Tone(p), a = t.albedo(lin(hex), 'side');
        const sides = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
        const shots = sides.map((n) => screenColor(a, p, n));
        const darkest = shots.reduce((m, c) => (c[1] < m[1] ? c : m));
        expect(dist(px(darkest), rgb(hex))).toBeLessThanOrEqual(2);
        for (const c of shots) {
          expect(c[1] * 255).toBeGreaterThanOrEqual((rgb(hex)[1] as number) - 2);
          expect(hsv(hexOf(c)).s).toBeLessThanOrEqual(hsv(hex).s + 0.02);
        }
      }
    }
  });
  it('暗场景（第三章 rainNight）不做完整补偿，只把暗色乘 DARK_LIFT（色相不变，亮色不动）；albedo() 原样返回', () => {
    expect(Tone.of('rainNight').active).toBe(false);
    expect(DARK_LIFT.rainNight).toBe(3.4);
    // 主角、NPC 走 albedo()：暗场景照旧原样返回
    expect(Tone.of('rainNight').albedo(lin(C.asphalt), 'floor')).toEqual(lin(C.asphalt));
    // 亮色（粉笔白）不动；暗色三个通道乘同一个倍数
    expect(darkLift(lin(C.chalk), 3.4)).toEqual(lin(C.chalk));
    const w = darkLift(lin(C.wallNight), 3.4), w0 = lin(C.wallNight);
    expect(w[0] / w0[0]).toBeCloseTo(w[2] / w0[2], 9);
    const night = chunks('street', 'alley');
    const want = darkLift(lin(C.asphalt), 3.4);
    expect(want[0] / lin(C.asphalt)[0]).toBeCloseTo(3.4, 9);
    let found = false;
    for (const ch of night) {
      const c = ch.floor.getAttribute('color');
      for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - want[0]) < 1e-6 && Math.abs(c.getY(i) - want[1]) < 1e-6 && Math.abs(c.getZ(i) - want[2]) < 1e-6) found = true;
    }
    expect(found).toBe(true);
  });
});

describe('建好的 chunk 在画面上（验收第 2 轮的四处取色）', () => {
  /** 某个几何体里满足 pick 的顶点在画面上的颜色。 */
  function sample(ch: KitChunk[], which: 'floor' | 'static', atmo: string, pick: (x: number, y: number, z: number, nx: number, ny: number) => boolean): number[][] {
    const p = presetOf(atmo as never), out: number[][] = [];
    for (const k of ch) {
      const g = which === 'floor' ? k.floor : k.static;
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
      for (let i = 0; i < pos.count; i++) {
        if (!pick(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i))) continue;
        out.push(px(screenColor([col.getX(i), col.getY(i), col.getZ(i)], p, [nor.getX(i), nor.getY(i), nor.getZ(i)])));
      }
    }
    return out;
  }
  it('阴天的跑道：饱和度 ≤ 0.5、亮度在色板 ±8% 以内；草也贴近 #5E6B5A', () => {
    const ch = chunks('track', 'default', 'medium');
    const track = sample(ch, 'floor', 'overcast', (x, y) => x > 0.6 && x < 1.6 && y === 0);
    expect(track.length).toBeGreaterThan(20);
    for (const c of track) {
      const { s, v } = hsv(((c[0] as number) << 16) | ((c[1] as number) << 8) | (c[2] as number));
      expect(s).toBeLessThanOrEqual(0.5);
      expect(Math.abs(v - hsv(C.track).v)).toBeLessThan(0.08 * 1.2);
    }
    const grass = sample(ch, 'floor', 'overcast', (x, y) => x < -10 && y === 0);
    for (const c of grass) expect(Math.min(dist(c, rgb(C.grass)), dist(c, rgb(C.grassDark)))).toBeLessThanOrEqual(3);
  });
  it('清晨的人行道与左侧店面的墙（背光面）= 色板', () => {
    const ch = chunks('street', 'dawn', 'low', { kit: 'street', variant: 'dawn', beats: 60, obstacles: [obstacle('barrierArm', 100 + 10 * 1.1)] });
    const paver = sample(ch, 'floor', 'dawn', (x, y) => x > -1.5 && x < 1.5 && y === 0);
    expect(paver.length).toBeGreaterThan(20);
    for (const c of paver) expect(dist(c, rgb(C.dawnPaver))).toBeLessThanOrEqual(Math.ceil(0.15 * 255));    // 地砖逐块 ±12% 抖动
    // 墙裙以下那一段墙（0–2.7 m，色板 dawnWall2）的底边顶点
    const wall = sample(ch, 'static', 'dawn', (x, y, _z, nx) => Math.abs(x + HALF) < 1e-3 && nx > 0.9 && y < 0.01);
    expect(wall.length).toBeGreaterThan(10);
    expect(wall.filter((c) => dist(c, rgb(C.dawnWall2)) <= 3).length).toBeGreaterThan(wall.length * 0.5);
    for (const c of wall) expect(hsv(((c[0] as number) << 16) | ((c[1] as number) << 8) | (c[2] as number)).s).toBeLessThan(0.25);
  });
  it('梦里的人群：画面上饱和度 < 0.12，整体不比色板 #7E878B 暗（腿、背光面可以略暗）', () => {
    const crowd = sample(chunks('plaza', 'bright', 'medium'), 'static', 'dream', (x, y) => Math.abs(x) > 4 && y > 0.3);
    expect(crowd.length).toBeGreaterThan(100);
    for (const c of crowd) {
      expect(hsv(((c[0] as number) << 16) | ((c[1] as number) << 8) | (c[2] as number)).s).toBeLessThan(0.12);
      expect(c[1] as number).toBeGreaterThanOrEqual(Math.round((rgb(C.crowdDark)[1] as number) * 0.85));
    }
    const g = crowd.map((c) => c[1] as number).sort((a, b) => a - b);
    expect(g[g.length >> 1] as number).toBeGreaterThanOrEqual(rgb(C.crowd)[1] as number);
  });
});

describe('发光体的 aSteady（WP3 的 kit 约定：窗不跟灯走，灯头跟灯走）', () => {
  it('compound：aSteady = 0 的发光面都挨着本 chunk 登记的灯；亮窗、门卫室的窗 = 1', () => {
    const seg = segment({ kit: 'street', variant: 'compound', beats: 60, obstacles: [obstacle('barrierArm', 100 + 18 * 1.1)] });
    let zero = 0, one = 0;
    for (const ctx of chunkContexts(seg, 'medium')) {
      const k = getKit('street')!.build(ctx), e = k.emissive;
      if (!e) continue;
      const st = e.getAttribute('aSteady'), pos = e.getAttribute('position');
      expect(st, 'compound 的发光体有窗，必须带 aSteady').toBeTruthy();
      expect(st.count).toBe(pos.count);
      const s0 = ctx.s0;
      for (let i = 0; i < st.count; i++) {
        if (st.getX(i) === 1) { one++; continue; }
        zero++;
        const s = s0 - pos.getZ(i), x = pos.getX(i);
        expect(k.lamps.some((l) => Math.abs(l.s - s) < 4.5 && Math.abs(l.x - x) < 1.6), `s ${s.toFixed(2)} x ${x.toFixed(2)}`).toBe(true);
      }
    }
    expect(zero).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(0);
  });
  it('梦里的镜中广场（雾色的背墙）不跟灯走：没有灯，也不能被 LampField 压暗', () => {
    const ch = chunks('plaza', 'gray', 'low', { kit: 'plaza', variant: 'gray', beats: 60, surfaces: [mirror('bigMirror', 'R', 130, 138, [0.1, 2.6])] });
    let n = 0;
    for (const k of ch) {
      if (!k.emissive) continue;
      const st = k.emissive.getAttribute('aSteady');
      expect(st).toBeTruthy();
      for (let i = 0; i < st.count; i++) { expect(st.getX(i)).toBe(1); n++; }
    }
    expect(n).toBeGreaterThan(0);
  });
});
