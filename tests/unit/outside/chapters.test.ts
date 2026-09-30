// tests/unit/outside/chapters.test.ts —— 用真实的 compile() 跑一遍按 §4.3–4.5 写的合成章节（第三到五章的数据由 WP2 并行开发），
// 检查：每个跑段的全部 chunk 能建、≤ 3 次 draw call；按数据摆放的陈设找得到锚点；雨在 3-3 @52 开始并且重来时复原；
// 天空只在户外段；栏杆红光只在第三章 compound。
import { describe, expect, it } from 'vitest';
import { CHUNK_LEN } from '../../../src/core/constants';
import { resolveQuality } from '../../../src/core/quality';
import { createRng } from '../../../src/core/rng';
import { FlatMaterials, FlatTextureBank } from '../../../src/core/fallbacks';
import { getKit } from '../../../src/core/registry';
import { ChapterSurfaces } from '../../../src/core/surfaces';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, RunSegmentDef } from '../../../src/levels/schema';
import { isWarm, hsv, C } from '../../../src/render/kits/outside/lib/colors';
import '../../../src/render/kits/outside/plaza';
import '../../../src/render/kits/outside/track';
import { gateSpan, shedSpan, graffitiCenter, barrierS } from '../../../src/render/kits/outside/street';
import { rainAt } from '../../../src/render/weather/rain';
import { Outdoor, sweepAnchors } from '../../../src/render/weather/outdoor';
import { snapshot, vertexColors, viewContext } from './helpers';

const base = { follower: { mode: 'behind' as const }, surface: 'asphaltWet' as const };

const CH3: ChapterDef = {
  id: 'ch3', title: '第三章', name: '雨夜', seed: 1703, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
  segments: [
    { id: '3-3', kind: 'run', kit: 'street', variant: 'schoolGate', atmosphere: 'rainNight', beats: 64, stride: 1.0, cadence: 5.0, ...base,
      rows: [[14, '.B.'], [36, 'HHH'], [42, 'HHH']],
      events: [{ at: 52, type: 'rain', intensity: 0.6, seconds: 4, id: 'rainStarts' }, { at: 56, type: 'text', line: 'c1.card' }] },
    { id: '3-4', kind: 'run', kit: 'street', variant: 'alley', atmosphere: 'rainNight', beats: 200, stride: 1.1, cadence: [5.0, 5.4], checkpoints: [104], ...base,
      rows: [[20, 'L..'], [30, '.W.'], [50, '..H'], [60, 'B..'], [119, '.L.'], [123, 'H..'], [127, '..L']],
      surfaces: [{ id: 'bigPuddle', kind: 'puddle', side: 'floor', from: 112, to: 114, lane: 0 }],
      events: [{ at: 40, type: 'ambience', amb: 'shedRoof', level: 1, seconds: 1 }, { at: 80, type: 'ambience', amb: 'rainStreet', level: 1, seconds: 1 }] },
    { id: '3-5', kind: 'still', set: 'bus', atmosphere: 'busNight', duration: 12, follower: { mode: 'absent' }, events: [] },
    { id: '3-6', kind: 'run', kit: 'street', variant: 'shopStreet', atmosphere: 'rainNight', beats: 150, stride: 1.1, cadence: [5.4, 5.8], ...base,
      follower: { mode: 'pressure' }, rows: [[20, '.H.'], [30, 'B..'], [40, '..W']],
      events: [{ at: 64, type: 'text', line: 'c1.card', id: 'graffitiHand' }] },
    { id: '3-7', kind: 'run', kit: 'street', variant: 'compound', atmosphere: 'rainNight', beats: 36, stride: 1.0, cadence: 5.0, ...base, rows: [[18, 'HHH']] },
  ],
};
const CH4: ChapterDef = {
  id: 'ch4', title: '第四章', name: '广场', seed: 1704, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
  segments: [
    { id: '4-1', kind: 'run', kit: 'plaza', variant: 'bright', atmosphere: 'dream', beats: 190, stride: 1.5, cadence: [6.2, 6.4], surface: 'plaza', follower: { mode: 'absent' },
      rows: [[120, '.L.']] },
    { id: '4-5', kind: 'run', kit: 'plaza', variant: 'gray', atmosphere: 'dreamGray', beats: 280, stride: 1.3, cadence: [5.4, 6.0], surface: 'plaza', follower: { mode: 'synced' },
      rows: [[40, '.L.'], [120, 'H..']],
      surfaces: [{ id: 'bigMirror', kind: 'mirror', side: 'R', from: 196, to: 206, y: [0.1, 2.6] }] },
    { id: '4-6', kind: 'still', set: 'water', atmosphere: 'dreamGray', duration: 8, follower: { mode: 'absent' }, events: [] },
  ],
};
const CH5: ChapterDef = {
  id: 'ch5', title: '第五章', name: '七步', seed: 1705, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
  segments: [
    { id: '5-3', kind: 'run', kit: 'street', variant: 'dawn', atmosphere: 'dawn', beats: 220, stride: 1.1, cadence: 5.0, surface: 'concrete', follower: { mode: 'absent' },
      rows: [[10, 'HHH'], [60, '..B', 4], [70, 'W..']] },
    { id: '5-7', kind: 'run', kit: 'track', variant: 'default', atmosphere: 'overcast', beats: 64, stride: 1.0, cadence: 4.6, surface: 'rubber', follower: { mode: 'absent' },
      rows: [[20, '.L.'], [40, 'H..']] },
  ],
};

function buildChapter(def: ChapterDef) {
  const ch = compile(def);
  const surfaces = new ChapterSurfaces(ch);
  const q = resolveQuality('low', 1);
  const out: Array<{ seg: string; s0: number; calls: number; colors: number[] }> = [];
  for (const seg of ch.segments) {
    if (seg.kind !== 'run') continue;
    const d = seg.def as RunSegmentDef;
    const kit = getKit(d.kit)!;
    expect(kit.id).toBe(d.kit);
    const n = Math.ceil((seg.s1 - seg.s0) / CHUNK_LEN - 1e-6);
    for (let i = 0; i < n; i++) {
      const s0 = seg.s0 + i * CHUNK_LEN, s1 = Math.min(seg.s1, s0 + CHUNK_LEN);
      const c = kit.build({ seg, variant: d.variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0),
        openings: surfaces.openingsIn(s0, s1), quality: q, rng: createRng(ch.seed, `chunk:${d.id}:${i}`), mat: new FlatMaterials(), tex: new FlatTextureBank(256) });
      const geos = [c.floor, c.static, c.emissive].filter(Boolean);
      out.push({ seg: d.id, s0, calls: geos.length, colors: geos.flatMap((g) => vertexColors(g)) });
    }
  }
  return { ch, out };
}

describe('用 compile() 的产物建第三到五章的户外段（合成数据，按 §4 的拍号）', () => {
  it('第三章：全部 chunk ≤ 3 次 draw call；校门、车棚、涂鸦、栏杆的锚点来自数据；暖色只有路灯金和栏杆红', () => {
    const { ch, out } = buildChapter(CH3);
    expect(out.length).toBeGreaterThan(35);
    for (const c of out) expect(c.calls).toBeLessThanOrEqual(3);
    const seg = (id: string) => ch.segments.find((s) => s.def.id === id)!;
    expect(gateSpan(seg('3-3'))).toEqual([seg('3-3').s0 + 36, seg('3-3').s0 + 42]);
    expect(shedSpan(seg('3-4'))[0]).toBeCloseTo(seg('3-4').s0 + 40 * 1.1);
    expect(graffitiCenter(seg('3-6'))).toBeCloseTo(seg('3-6').s0 + 66 * 1.1);
    expect(barrierS(seg('3-7'), 0)).toBeCloseTo(seg('3-7').s0 + 18);
    const gold = hsv(C.lampGold).h, red = hsv(C.barrierRed).h;
    for (const c of out) for (const col of c.colors) if (isWarm(col)) {
      const h = hsv(col).h;
      const ok = Math.abs(h - gold) < 14 || Math.min(Math.abs(h - red), 360 - Math.abs(h - red)) < 14;
      expect(ok, `${c.seg} ${col.toString(16)}`).toBe(true);
      if (Math.min(Math.abs(h - red), 360 - Math.abs(h - red)) < 14) expect(c.seg).toBe('3-7');
    }
    expect(sweepAnchors(ch)).toEqual([{ seg: 4, s: seg('3-7').s0 + 18 + 0.04 }]);
  });
  it('第三章的雨：3-3 @52 开始；重来到 3-3 @20 没有雨，到 3-4 起一直下；静场里不画', async () => {
    const ch = compile(CH3);
    expect(rainAt(ch, 0, 20)).toBe(0);
    expect(rainAt(ch, 0, 53)).toBeCloseTo(0.6);
    expect(rainAt(ch, 1, 104)).toBeCloseTo(0.6);
    expect(rainAt(ch, 3, 0)).toBeCloseTo(0.6);
    const ctx = viewContext('low');
    const o = new Outdoor();
    o.init(ctx);
    await o.loadChapter(ch);
    o.onReset(snapshot({ segIndex: 1, segBeat: 104 }));
    o.frame(snapshot(), snapshot({ t: 30, segIndex: 1 }), 1, 0);
    expect(o.rain.object.visible).toBe(true);
    expect(o.sky.visible).toBe(true);
    o.onSegment(ch.segments[2]!);
    o.frame(snapshot(), snapshot({ t: 31, segIndex: 2, segKind: 'still' }), 1, 0);
    expect(o.rain.object.visible).toBe(false);
    expect(o.sky.visible).toBe(false);
  });
  it('第四章：梦里没有灯、没有雨、几乎没有颜色；4-5 的镜子在 x = +1.8 留洞；gray 的段尾是水', () => {
    const { ch, out } = buildChapter(CH4);
    for (const c of out) {
      expect(c.calls).toBeLessThanOrEqual(3);
      for (const col of c.colors) { const { h, s } = hsv(col); expect(s < 0.12 || (s < 0.22 && h > 180 && h < 240), `${c.seg} ${col.toString(16)}`).toBe(true); }
    }
    expect(rainAt(ch, 1, 100)).toBe(0);
    const openings = new ChapterSurfaces(ch).openingsIn(0, ch.length);
    expect(openings).toHaveLength(1);
    expect(openings[0]!.side).toBe('R');
  });
  it('第五章：清晨与操场没有暖色（跑道本身除外）；dawn 的栏杆不扫红光', () => {
    const { ch, out } = buildChapter(CH5);
    for (const c of out) {
      expect(c.calls).toBeLessThanOrEqual(3);
      for (const col of c.colors) if (isWarm(col)) {
        expect(c.seg, col.toString(16)).toBe('5-7');
        expect(Math.abs(hsv(col).h - hsv(C.track).h)).toBeLessThan(10);
      }
    }
    expect(sweepAnchors(ch)).toEqual([]);
  });
});
