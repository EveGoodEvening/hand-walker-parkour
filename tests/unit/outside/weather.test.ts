// tests/unit/outside/weather.test.ts —— 雨、天空、栏杆红光与 `rain` cue（DESIGN.md §5.9、§8.7、§8.10 WP4 验收 2）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY, resolveQuality } from '../../../src/core/quality';
import { getCueHandler } from '../../../src/core/registry';
import type { CompiledChapter, CompiledSegment, RunSegmentDef } from '../../../src/levels/schema';
import { hsv, isWarm } from '../../../src/render/kits/outside/lib/colors';
import { RAIN_COLOR, RAIN_MAX_LINES, RainField, RainLevel, createRainGeometry, rainAt } from '../../../src/render/weather/rain';
import { Outdoor, atmosphereAt, createSkyGeometry, isOutdoorSegment, skyKindFor, sweepAnchors } from '../../../src/render/weather/outdoor';
import { TIERS, obstacle, segment, snapshot, viewContext } from './helpers';

function chapterOf(segs: CompiledSegment[]): CompiledChapter {
  segs.forEach((s, i) => { s.index = i; });
  return { def: { id: 'ch3', title: '第三章', name: '雨夜', seed: 1, card: [], outro: { lines: [] }, notes: [], requiredBeats: [], segments: segs.map((s) => s.def) },
    segments: segs, length: segs.at(-1)?.s1 ?? 0, seed: 1 };
}

describe('雨：1 次 draw call，线段数 250 / 600 / 1200 按档位（§8.10 WP4 验收 2）', () => {
  it('每档的 drawRange = 2 × 线段数；几何体一次分配 1200 条', () => {
    expect(RAIN_MAX_LINES).toBe(1200);
    const want = { low: 250, medium: 600, high: 1200 } as const;
    for (const tier of TIERS) {
      expect(QUALITY[tier].rainLines).toBe(want[tier]);
      const r = new RainField(resolveQuality(tier, 1).rainLines);
      expect(r.lineCount).toBe(want[tier]);
      expect(r.geometry.drawRange.count).toBe(want[tier] * 2);
      expect(r.geometry.getAttribute('position').count).toBe(RAIN_MAX_LINES * 2);
    }
  });
  it('是单个 LineSegments（一个材质，一次 draw call）；换档不建新几何体', () => {
    const r = new RainField(250);
    expect((r.object as THREE.LineSegments).isLineSegments).toBe(true);
    expect(Array.isArray(r.object.material)).toBe(false);
    let n = 0;
    r.object.traverse((o) => { if ((o as THREE.Line).isLine || (o as THREE.Mesh).isMesh) n++; });
    expect(n).toBe(1);
    const g = r.geometry;
    r.setLines(1200); r.setLines(600);
    expect(r.geometry).toBe(g);
    expect(g.drawRange.count).toBe(1200);
  });
  it('强度 < 1 时可见线的比例 ≈ 强度（任何档位的前缀都成立）', () => {
    const g = createRainGeometry();
    const rnd = g.getAttribute('aRand');
    for (const lines of [250, 600, 1200]) for (const level of [0.3, 0.6, 1]) {
      let vis = 0;
      for (let i = 0; i < lines; i++) if (rnd.getX(i * 2) < level) vis++;
      expect(Math.abs(vis / lines - level)).toBeLessThan(0.03);
    }
  });
  it('雨是冷色（第三章只许三种暖色，雨不在其中）', () => {
    expect(isWarm(RAIN_COLOR)).toBe(false);
    expect(hsv(RAIN_COLOR).h).toBeGreaterThan(180);
  });
  it('强度为 0 时不画（0 次 draw call）', () => {
    const r = new RainField(600);
    const cam = new THREE.PerspectiveCamera();
    r.update(0, 1, cam, null);
    expect(r.object.visible).toBe(false);
    r.update(0.6, 1, cam, null);
    expect(r.object.visible).toBe(true);
  });
});

describe('雨强时间线（§4.3 3-3 @52：4 s 内 0 → 0.6）', () => {
  it('线性渐变、中途再 cue 从当前值出发、snap 立即生效', () => {
    const l = new RainLevel();
    l.cue(0.6, 4, 10);
    expect(l.at(10)).toBe(0);
    expect(l.at(12)).toBeCloseTo(0.3);
    expect(l.at(14)).toBeCloseTo(0.6);
    expect(l.at(99)).toBeCloseTo(0.6);
    l.cue(0.2, 2, 14);
    expect(l.at(15)).toBeCloseTo(0.4);
    l.snap(0.9);
    expect(l.at(0)).toBeCloseTo(0.9);
    l.cue(1.5, 0, 3);
    expect(l.at(3)).toBe(1);
  });
  it('rainAt：重来 / goto 时按关卡数据复原（跳过的 cue 不会再发）', () => {
    const a = segment({ kit: 'corridor', variant: 'night' });
    const b = segment({ kit: 'street', variant: 'schoolGate', events: [{ at: 52, body: { type: 'rain', intensity: 0.6, seconds: 4 } }] });
    const c = segment({ kit: 'street', variant: 'alley', events: [{ at: 112, body: { type: 'stop', seconds: 6, timeline: [{ at: 1, type: 'rain', intensity: 0.8, seconds: 1 }] } }] });
    const ch = chapterOf([a, b, c]);
    expect(rainAt(ch, 0, 10)).toBe(0);
    expect(rainAt(ch, 1, 51)).toBe(0);
    expect(rainAt(ch, 1, 52)).toBeCloseTo(0.6);
    expect(rainAt(ch, 2, 0)).toBeCloseTo(0.6);
    expect(rainAt(ch, 2, 120)).toBeCloseTo(0.8);
    expect(rainAt(null, 3, 0)).toBe(0);
  });
});

describe('`rain` cue 与户外系统（§8.7）', () => {
  it('rain cue 的处理者是 WP4', () => {
    expect(getCueHandler('rain')?.owner).toBe('WP4');
  });
  it('只在户外段画雨和天；室内、静场都不画；换档只改 drawRange', async () => {
    const ctx = viewContext('low');
    const o = new Outdoor();
    o.init(ctx);
    const inside = segment({ kit: 'corridor', variant: 'night' });
    const gate = segment({ kit: 'street', variant: 'schoolGate', events: [{ at: 52, body: { type: 'rain', intensity: 0.6, seconds: 4 } }] });
    const ch = chapterOf([inside, gate]);
    await o.loadChapter(ch);
    o.onSegment(inside);
    o.onRainCue(0.6, 0, 0);
    o.frame(snapshot(), snapshot({ t: 1, segIndex: 0 }), 1, 0);
    expect(o.rain.object.visible).toBe(false);
    expect(o.sky.visible).toBe(false);
    o.onSegment(gate);
    o.frame(snapshot(), snapshot({ t: 1, segIndex: 1 }), 1, 0);
    expect(o.rain.object.visible).toBe(true);
    expect(o.sky.visible).toBe(true);
    o.frame(snapshot(), snapshot({ t: 1, segIndex: 1, segKind: 'still' }), 1, 0);
    expect(o.rain.object.visible).toBe(false);
    // 重来到 3-3 @20：雨还没开始
    o.onReset(snapshot({ segIndex: 1, segBeat: 20 }));
    o.frame(snapshot(), snapshot({ t: 5, segIndex: 1 }), 1, 0);
    expect(o.rain.object.visible).toBe(false);
    o.onReset(snapshot({ segIndex: 1, segBeat: 60 }));
    expect(o.level.at(0)).toBeCloseTo(0.6);
    o.setQuality(resolveQuality('high', 1));
    expect(o.rain.geometry.drawRange.count).toBe(2400);
  });
  it('段中途的 atmosphere cue 换天空（纹理读章时已建好，换的时候不建）；重来 / goto 按关卡数据复原', async () => {
    const ctx = viewContext('low');
    const kinds: string[] = [];
    const get = ctx.tex.get.bind(ctx.tex);
    ctx.tex.get = (id, p) => { if (id === 'skyGradient') kinds.push(String(p?.kind)); return get(id, p); };
    const o = new Outdoor();
    o.init(ctx);
    const dream = segment({ kit: 'plaza', variant: 'bright', events: [{ at: 20, body: { type: 'atmosphere', id: 'dreamGray', seconds: 3 } }] });
    (dream.def as RunSegmentDef).atmosphere = 'dream';
    const ch = chapterOf([dream]);
    await o.loadChapter(ch);
    expect(kinds).toContain('dusk');
    const before = kinds.length;
    o.onSegment(dream);
    expect(o.skyKind).toBe(null);
    o.onEvent({ type: 'cue', tick: 0, data: { body: { type: 'atmosphere', id: 'dreamGray', seconds: 3 }, segment: dream.def.id } }, snapshot());
    expect(o.skyKind).toBe('dusk');
    o.frame(snapshot(), snapshot({ t: 5, segIndex: 0 }), 1, 0);
    expect(o.sky.visible).toBe(true);
    expect(kinds.length).toBe(before);
    expect(atmosphereAt(ch, 0, 10)).toBe('dream');
    expect(atmosphereAt(ch, 0, 25)).toBe('dreamGray');
    o.onReset(snapshot({ segIndex: 0, segBeat: 10 }));
    expect(o.skyKind).toBe(null);
    o.onReset(snapshot({ segIndex: 0, segBeat: 30 }));
    expect(o.skyKind).toBe('dusk');
  });
  it('逐帧推进不建任何几何体或纹理（5 分钟内存不增长的前提）', async () => {
    const ctx = viewContext('medium');
    let texGets = 0;
    const get = ctx.tex.get.bind(ctx.tex);
    ctx.tex.get = (id, p) => { texGets++; return get(id, p); };
    const o = new Outdoor();
    o.init(ctx);
    const gate = segment({ kit: 'street', variant: 'compound', obstacles: [obstacle('barrierArm', 118)] });
    await o.loadChapter(chapterOf([gate]));
    o.onSegment(gate);
    o.onRainCue(0.6, 4, 0);
    const children = ctx.scene.children.length, geo = o.rain.geometry, sky = o.sky.geometry, tex0 = texGets;
    let sweepSeen = false;
    for (let i = 0; i < 36000; i++) {        // 5 分钟 × 120 Hz
      const t = i / 120;
      o.frame(snapshot(), snapshot({ t, player: { ...snapshot().player, s: 100 + (i % 3000) / 30 } }), 1, 1 / 120);
      if (o.sweep.visible) sweepSeen = true;
    }
    expect(ctx.scene.children.length).toBe(children);
    expect(o.rain.geometry).toBe(geo);
    expect(o.sky.geometry).toBe(sky);
    expect(texGets).toBe(tex0);
    expect(sweepSeen).toBe(true);
  });
});

describe('天空与栏杆红光', () => {
  it('氛围 → 天空种类；户外段判定', () => {
    expect(skyKindFor('rainNight')).toBe('night');
    expect(skyKindFor('dawn')).toBe('dawn');
    expect(skyKindFor('dreamGray')).toBe('dusk');
    expect(skyKindFor('dream')).toBeNull();
    expect(skyKindFor('overcast')).toBeNull();
    expect(isOutdoorSegment(segment({ kit: 'plaza', variant: 'bright' }))).toBe(true);
    expect(isOutdoorSegment(segment({ kit: 'stairs', variant: 'nightDown' }))).toBe(false);
  });
  it('天穹的三角形全部朝里', () => {
    const g = createSkyGeometry();
    const p = g.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (n.lengthSq() < 1e-8) continue;
      m.copy(a).add(b).add(c).divideScalar(3);
      expect(n.dot(m)).toBeLessThan(0);
    }
  });
  it('红光只给第三章的 compound（dawn 是第五章，不许红色）', () => {
    const c = segment({ kit: 'street', variant: 'compound', stride: 1, obstacles: [obstacle('barrierArm', 118)] });
    const d = segment({ kit: 'street', variant: 'dawn', obstacles: [obstacle('barrierArm', 111)] });
    const noData = segment({ kit: 'street', variant: 'compound', stride: 1 });
    expect(sweepAnchors(chapterOf([c]))).toEqual([{ seg: 0, s: 118.04 }]);
    expect(sweepAnchors(chapterOf([d]))).toEqual([]);
    expect(sweepAnchors(chapterOf([noData]))[0]?.s).toBe(118);
  });
});
