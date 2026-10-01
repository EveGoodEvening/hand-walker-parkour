// tests/unit/render/streamer.test.ts —— ChunkStreamer（DESIGN.md §5.9、§10.1；WP3 验收 1–3）：
// 读章时建好全部几何体（WP3 的 kit 用 4 个通用变体的几何体池），游戏过程中不再新建；可见 chunk = 身后 1 + 前方 N；
// 静场隐藏 chunk、显示 set；重来时重放灯光操作；画质切换重建。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveQuality } from '../../../src/core/quality';
import { compile } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import type { ChapterDef, CompiledChapter } from '../../../src/levels/schema';
import '../../../src/render/kits/placeholder';
import '../../../src/render/sets/placeholder';
import '../../../src/render/kits/school/classroom';
import '../../../src/render/kits/school/corridor';
import '../../../src/render/kits/school/washroom';
import '../../../src/render/kits/school/stairs';
import '../../../src/render/kits/school/canteen';
import '../../../src/render/kits/school/labRoom';
import '../../../src/render/sets/school/deskFeet';
import { registerAtmospheres } from '../../../src/render/atmosphere';
import { World } from '../../../src/render/ChunkStreamer';
import { fakeCtx, snap } from './helpers';

registerAtmospheres();

function geoms(scene: THREE.Scene): Set<THREE.BufferGeometry> {
  const out = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) out.add(m.geometry); });
  return out;
}
function segAt(ch: CompiledChapter, s: number): number {
  let idx = 0;
  for (const sg of ch.segments) if (sg.kind === 'run' && s >= sg.s0 - 1e-6) idx = sg.index;
  return idx;
}

async function setup(tier: 'low' | 'medium' | 'high' = 'low') {
  const ctx = fakeCtx(tier);
  const ch = compile(ch1 as ChapterDef);
  (ctx.surfaces as unknown as { load(c: CompiledChapter): void }).load(ch);
  const w = new World();
  w.init(ctx);
  await w.loadChapter(ch);
  return { ctx, ch, w };
}

describe('ChunkStreamer', () => {
  it('读章：通用变体几何体池；每个 chunk ≤ 3 个网格；开口 / 段首段尾单独预建', async () => {
    const { w, ctx } = await setup();
    expect(w.stats.slots).toBeGreaterThan(30);
    expect(w.stats.generic).toBeGreaterThan(w.stats.special);
    expect(w.stats.maxSlotCalls).toBeLessThanOrEqual(3);
    expect(w.stats.maxSlotTris).toBeLessThanOrEqual(6000);
    // 共享：场景里的几何体数远少于 chunk 数 × 3
    expect(geoms(ctx.scene).size).toBeLessThan(w.stats.slots * 3);
  });

  it('跑完整章：可见 chunk ≤ 身后 1 + 前方 N，几何体集合与场景节点数不变（游戏过程中不创建几何体）', async () => {
    const { w, ctx, ch } = await setup();
    const g0 = geoms(ctx.scene);
    let nodes0 = 0; ctx.scene.traverse(() => { nodes0++; });
    let prev = snap({ s: 0, t: 0, segIndex: 0 });
    w.onReset(prev);
    let t = 0, maxVisible = 0;
    for (let s = 0; s < ch.length; s += 0.37) {
      t += 0.37 / 5;
      const next = snap({ s, t, segIndex: segAt(ch, s) });
      w.frame(prev, next, 1, 1 / 60);
      let vis = 0;
      w.root.children.forEach((c) => { if (c.name.startsWith('chunk:') && c.visible) { vis++; expect(c.children.length).toBeLessThanOrEqual(3); } });
      maxVisible = Math.max(maxVisible, vis);
      prev = next;
    }
    expect(maxVisible).toBeLessThanOrEqual(ctx.quality.chunksAhead + 1);
    expect(maxVisible).toBeGreaterThanOrEqual(2);
    const g1 = geoms(ctx.scene);
    expect(g1.size).toBe(g0.size);
    for (const g of g1) expect(g0.has(g)).toBe(true);
    let nodes1 = 0; ctx.scene.traverse(() => { nodes1++; });
    expect(nodes1).toBe(nodes0);
  });

  it('静场：隐藏全部 chunk，显示对应 set', async () => {
    const { w, ch } = await setup();
    const still = ch.segments.find((s) => s.kind === 'still');
    expect(still).toBeTruthy();
    const sn = snap({ s: still?.s0 ?? 0, t: 50, segIndex: still?.index ?? 0, segKind: 'still', still: { t: 1, variant: 'teacher' } });
    w.frame(sn, sn, 1, 1 / 60);
    const chunksVisible = w.root.children.filter((c) => c.name.startsWith('chunk:') && c.visible).length;
    const setVisible = w.root.children.filter((c) => c.name.startsWith('set:') && c.visible).map((c) => c.name);
    expect(chunksVisible).toBe(0);
    expect(setVisible).toEqual(['set:deskFeet:teacher']);
  });

  it('lights cue 与重来：检查点之前的灯光操作在重来时重放', async () => {
    const { w, ch, ctx } = await setup();
    const seg = ch.segments.find((s) => s.def.id === '1-3');
    expect(seg).toBeTruthy();
    if (!seg) return;
    w.lightsOp('out', seg, 10, 30, undefined, undefined, 5);
    w.lamps.now = 6;
    expect(w.lamps.brightnessAt(seg.s0 + 20)).toBeLessThan(0.05);
    // 从 1-3 的第 40 拍重来：第 56 拍的闪烁还没发生，@10–30 的熄灭是 cue（不在数据里）→ 全亮
    w.onReset({ ...snap({ s: seg.s0 + 40, t: 60, segIndex: seg.index }), segBeat: 40 });
    expect(w.lamps.brightnessAt(seg.s0 + 20)).toBeGreaterThan(0.8);
    // 从第 58 拍重来：数据里第 56 拍的 flicker（56–60）要重放
    w.onReset({ ...snap({ s: seg.s0 + 58, t: 70, segIndex: seg.index }), segBeat: 58 });
    const [a, b] = w.lamps.range(seg.s0 + 56, seg.s0 + 60);
    expect(b).toBeGreaterThan(a);
    let dips = 0;
    for (let i = a; i < b; i++) for (let t = 70; t < 80; t += 0.01) if (w.lamps.level(i, t) < 0.9) dips++;
    expect(dips).toBeGreaterThan(0);
    void ctx;
  });

  it('氛围：段切换 1.5 s 过渡；静场前后直接切', async () => {
    const { w, ch } = await setup();
    w.onReset(snap({ s: 0, t: 0, segIndex: 0 }));
    const s12 = ch.segments[1];
    if (!s12) return;
    w.onEvent({ type: 'segment', tick: 0, data: { id: '1-2', index: 1, kind: 'run' } }, snap({ s: s12.s0, t: 10, segIndex: 1 }));
    expect(w.atmo.transitioning).toBe(true);
    const still = ch.segments.find((s) => s.kind === 'still');
    if (!still) return;
    w.onEvent({ type: 'segment', tick: 0, data: { id: still.def.id, index: still.index, kind: 'still' } }, snap({ s: still.s0, t: 20, segIndex: still.index, segKind: 'still' }));
    expect(w.atmo.transitioning).toBe(false);
  });

  it('画质切换：按新档位重建（高画质三角形上限 12k），几何体池照样共享', async () => {
    const { w, ctx } = await setup('low');
    const before = geoms(ctx.scene);
    Object.assign(ctx.quality, resolveQuality('high'));
    w.setQuality(ctx.quality);
    const after = geoms(ctx.scene);
    expect(w.stats.maxSlotTris).toBeLessThanOrEqual(12000);
    expect(w.stats.slots).toBeGreaterThan(30);
    let shared = 0; for (const g of after) if (before.has(g)) shared++;
    expect(shared).toBeLessThan(after.size);    // chunk 几何体换成了新的
  });
});

describe('ChunkStreamer：画质切换保留运行状态', () => {
  it('lights out、flicker 与 fog cue 之后切画质：亮度、闪烁、雾距不变（雾远距离只按新档位的倍率换算）', async () => {
    const { w, ch, ctx } = await setup('medium');
    const seg = ch.segments.find((s) => s.def.id === '1-2');
    expect(seg).toBeTruthy();
    if (!seg) return;
    w.onReset({ ...snap({ s: seg.s0 + 10, t: 10, segIndex: seg.index }), segBeat: 10 });
    w.lightsOp('out', seg, 20, 60, undefined, undefined, 10);
    w.lightsOp('flicker', seg, 70, 90, undefined, undefined, 10);
    w.fogOverride(5, 15, 0, 10);
    w.lamps.now = 11;
    w.atmo.update(11);
    const b40 = w.lamps.brightnessAt(seg.s0 + 40);
    expect(b40).toBeLessThan(0.2);
    const [fa, fb] = w.lamps.range(seg.s0 + 70, seg.s0 + 90);
    const flick = (a: number, b: number) => Array.from({ length: 300 }, (_, k) => w.lamps.level(a + (k % (b - a)), 11 + k * 0.011));
    const f0 = flick(fa, fb);
    expect(f0.some((v) => v < 0.9)).toBe(true);
    const g0 = geoms(ctx.scene);
    // medium → high（雾倍率同为 1）：全部不变
    Object.assign(ctx.quality, resolveQuality('high'));
    w.setQuality(ctx.quality);
    w.atmo.update(11.5);
    expect(geoms(ctx.scene)).not.toEqual(g0);                        // chunk 确实重建了
    expect(w.lamps.brightnessAt(seg.s0 + 40)).toBeCloseTo(b40, 6);
    const [ga, gb] = w.lamps.range(seg.s0 + 70, seg.s0 + 90);
    expect(flick(ga, gb)).toEqual(f0);
    expect([w.atmo.fog.near, w.atmo.fog.far]).toEqual([5, 15]);
    // high → low（自动档位降档）：灯照旧；雾仍是 fog cue 的值，远距离 ×0.8
    Object.assign(ctx.quality, resolveQuality('low'));
    w.setQuality(ctx.quality);
    w.atmo.update(12);
    expect(w.lamps.brightnessAt(seg.s0 + 40)).toBeCloseTo(b40, 6);
    expect(w.atmo.fog.near).toBe(5);
    expect(w.atmo.fog.far).toBeCloseTo(12, 6);
  });

  it('进行中的氛围过渡在切画质之后继续', async () => {
    const { w, ctx } = await setup('medium');
    w.onReset(snap({ s: 0, t: 0, segIndex: 0 }));
    w.transitionTo('nightIndoor', 4, 20);
    w.atmo.update(21);
    const hemi = w.atmo.hemi.intensity;
    Object.assign(ctx.quality, resolveQuality('low'));
    w.setQuality(ctx.quality);
    expect(w.atmo.transitioning).toBe(true);
    expect(w.atmo.hemi.intensity).toBeCloseTo(hemi, 6);
    w.atmo.update(24.01);
    expect(w.atmo.fog.near).toBe(6);
    expect(w.atmo.fog.far).toBeCloseTo(24, 6);
    expect(w.atmo.cur.dark).toBe(true);
  });
});

describe('ChunkStreamer：重来时重放', () => {
  const def = {
    id: 'test', title: '测试', name: '测试', seed: 5, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
    segments: [
      {
        id: 'r1', kind: 'run', kit: 'corridor', variant: 'morning', atmosphere: 'morning', surface: 'terrazzo', beats: 80, stride: 1, cadence: 4.8, follower: { mode: 'behind' },
        surfaces: [{ id: 'runBoard', kind: 'board', side: 'R', from: 30, to: 32, y: [0.9, 2.1] }],
        events: [
          { at: 6, type: 'stop', seconds: 2, timeline: [{ at: 0.5, type: 'lights', op: 'out', from: 0, to: 12 }] },
          { at: 28, type: 'board', surface: 'runBoard', op: 'write', line: 'c1.card' },
        ],
        windows: [
          { from: 14, to: 18, type: 'lookBack', auto: true, then: [{ at: 0.2, type: 'lights', op: 'out', from: 40, to: 50 }] },
          { from: 20, to: 24, type: 'lookBack', then: [{ at: 0.2, type: 'lights', op: 'out', from: 60, to: 70 }] },
        ],
      },
    ],
  } as unknown as ChapterDef;

  it('stop 时间线里的 lights、自动回头窗口的 then、跑段黑板字都在重来时恢复；画质切换不丢黑板', async () => {
    const { BOARDS } = await import('../../../src/render/boards');
    const ctx = fakeCtx('medium');
    const ch = compile(def);
    (ctx.surfaces as unknown as { load(c: CompiledChapter): void }).load(ch);
    const w = new World();
    w.init(ctx);
    await w.loadChapter(ch);
    const seg = ch.segments[0];
    if (!seg) return;
    const at = (b: number) => seg.s0 + b * seg.stride;
    w.onReset({ ...snap({ s: at(40), t: 40, segIndex: 0 }), segBeat: 40 });
    w.lamps.now = 40.5;
    expect(w.lamps.brightnessAt(at(6))).toBeLessThan(0.2);             // stop 时间线里的 out
    expect(w.lamps.brightnessAt(at(45))).toBeLessThan(0.2);            // auto 回头窗口的 then
    expect(w.lamps.brightnessAt(at(65))).toBeGreaterThan(0.8);         // 非 auto 的窗口不一定回过头：不重放
    const board = BOARDS.get('runBoard');
    expect(board).toBeTruthy();
    if (!board) return;
    expect(board.uniforms.uReveal.value).toBeGreaterThan(1);            // 整段字直接显示
    expect(board.uniforms.uText.value).toBe((w as unknown as { boardTex: Map<string, unknown> }).boardTex.get('c1.card|0'));
    // 检查点在黑板字之前：黑板是空的
    w.onReset({ ...snap({ s: at(20), t: 20, segIndex: 0 }), segBeat: 20 });
    expect(board.uniforms.uText.value).toBe(board.blank);
    expect(board.uniforms.uReveal.value).toBe(0);
    // 写字过程中切画质：同一块黑板、同样的进度
    w.boardOp({ type: 'board', surface: 'runBoard', op: 'write', line: 'c1.card' } as never, 30);
    board.update(30.5);
    const reveal = board.uniforms.uReveal.value;
    Object.assign(ctx.quality, resolveQuality('low'));
    w.setQuality(ctx.quality);
    expect(BOARDS.get('runBoard')).toBe(board);
    expect(board.uniforms.uReveal.value).toBe(reveal);
    expect(w.root.children.includes(board.mesh)).toBe(true);
  });
});

describe('ChunkStreamer：静场黑板与站立段', () => {
  const def = {
    id: 'test', title: '测试', name: '测试', seed: 9, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
    segments: [
      { id: 'r1', kind: 'run', kit: 'corridor', variant: 'labNorth', atmosphere: 'labNorth', surface: 'terrazzo', beats: 40, stride: 1, cadence: 4.8, follower: { mode: 'behind' } },
      { id: 's1', kind: 'still', set: 'labBoard', atmosphere: 'labNorth', duration: 10, follower: { mode: 'hidden' },
        events: [{ at: 2, type: 'board', surface: 'labBoard', op: 'write', line: 'c1.card', tremble: true }],
        input: { at: 4, hint: 'wipe', mode: 'hold', holdSeconds: 1.2, timeout: 5, onDone: [{ at: 0.5, type: 'board', surface: 'labBoard', op: 'write', line: 'c1.out3', byPlayer: true }] } },
      { id: 't1', kind: 'stand', kit: 'corridor', variant: 'morning', script: 'dream', atmosphere: 'dream', duration: 10, follower: { mode: 'absent' }, events: [] },
    ],
  } as unknown as ChapterDef;

  it('读章时按全部 board cue 预先生成字的纹理；board cue 只切换纹理、推进显隐', async () => {
    await import('../../../src/render/sets/school/labBoard');
    const { BOARDS } = await import('../../../src/render/boards');
    const ctx = fakeCtx('low');
    const ch = compile(def);
    (ctx.surfaces as unknown as { load(c: CompiledChapter): void }).load(ch);
    const w = new World();
    w.init(ctx);
    await w.loadChapter(ch);
    const bank = ctx.tex as unknown as { generated: number; all(): THREE.Texture[] };
    const before = bank.all().length;
    const board = BOARDS.get('labBoard');
    expect(board).toBeTruthy();
    if (!board) return;
    // 两段字（段事件里的 write 与静场输入 onDone 里的 write）都在读章时生成好了
    expect((w as unknown as { boardTex: Map<string, unknown> }).boardTex.size).toBe(2);
    w.boardOp({ type: 'board', surface: 'labBoard', op: 'write', line: 'c1.card', tremble: true } as never, 100);
    w.boardOp({ type: 'board', surface: 'labBoard', op: 'write', line: 'c1.out3', byPlayer: true } as never, 101);
    expect(bank.all().length).toBe(before);         // 没有新建纹理
    expect((w as unknown as { boardTex: Map<string, unknown> }).boardTex.size).toBe(2);
    board.update(101.2);
    expect(board.uniforms.uReveal.value).toBeGreaterThan(0);
    w.boardOp({ type: 'board', surface: 'labBoard', op: 'wipe' } as never, 102);
    board.update(102.6);
    expect(board.uniforms.uWipe.value).toBeGreaterThan(0.4);
  });

  it('站立段：显示为它单独预建的几个 chunk，跑段 chunk 隐藏', async () => {
    const ctx = fakeCtx('low');
    const ch = compile(def);
    (ctx.surfaces as unknown as { load(c: CompiledChapter): void }).load(ch);
    const w = new World();
    w.init(ctx);
    await w.loadChapter(ch);
    const stand = ch.segments[2];
    if (!stand) return;
    const sn = snap({ s: stand.s0, t: 30, segIndex: 2, segKind: 'stand' });
    w.frame(sn, sn, 1, 1 / 60);
    const vis = w.root.children.filter((c) => c.name.startsWith('chunk:') && c.visible).map((c) => c.name);
    expect(vis.length).toBeGreaterThan(0);
    expect(vis.every((n) => n.startsWith('chunk:t1'))).toBe(true);
  });
});
