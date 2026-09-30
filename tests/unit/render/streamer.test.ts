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

async function setup(tier: 'low' | 'high' = 'low') {
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
