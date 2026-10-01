// tests/unit/actors/fixes.test.ts —— 修复轮 U5 的替身修复：attachBehind 的地面高度（3-10 静场 / 5-4 跑段）、
// 世界替身淡入 ≥ 0.6 s（§10.2）、渲染端求解器路线只求一次。
import { describe, expect, it } from 'vitest';
import type { Plan, SolverAPI } from '../../../src/core/contracts';
import { compile } from '../../../src/levels/compile';
import ch3 from '../../../src/levels/chapters/ch3';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef, CompiledSegment } from '../../../src/levels/schema';
import { DoubleSystem, WORLD_FADE_IN } from '../../../src/render/actors/Doubles';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { LeaderSystem } from '../../../src/render/actors/Leader';
import { needsPlan, planFor } from '../../../src/render/actors/planCache';
import { ActorRigFactory } from '../../../src/render/actors/rigBuild';
import { WP5 } from '../../../src/render/actors/shared';
import { ReflectSurfaces } from '../../../src/render/actors/surfaces';
import { crawlInput, fakeCtx, snap } from './helpers';
import { doubleVerts, playStill, scene } from './scene';

const feetY = (w: Parameters<typeof doubleVerts>[0], id: string) => { let y = Infinity; doubleVerts(w, id, (v) => { y = Math.min(y, v.y); }); return y; };

describe("attachBehind stands on the host's floor (U5)", () => {
  it("3-10 (still): the figure behind the reflection has its feet within 5 cm of the host's feet (it used to float ~2.3 m up)", async () => {
    const w = await scene(ch3 as ChapterDef);
    playStill(w, '3-10', 11.3);
    const host = w.dbl.active().find((d) => d.id === 'bath2')!, behind = w.dbl.active().find((d) => d.id === 'bathBehind')!;
    expect(host.visible && behind.visible).toBe(true);
    const hy = feetY(w, 'bath2'), by = feetY(w, 'bathBehind');
    expect(Math.abs(by - hy)).toBeLessThanOrEqual(0.05);
    // 镜中的「我」与主角一样高（以前倒影的根高度被归零，比主角矮约 0.5 m）
    const anchorY = w.actor.rig.root.matrix.elements[13]!;
    expect(Math.abs(hy - anchorY)).toBeLessThan(0.05);
    expect(behind.head[1]! - anchorY).toBeGreaterThan(1.4);
    expect(behind.head[1]! - anchorY).toBeLessThan(1.8);
  });

  it('5-4 (run): the figure behind the crawler in the wall mirror stands on the same floor', async () => {
    const ctx = fakeCtx('low');
    const f = new ActorRigFactory(ctx); (ctx as { rig: unknown }).rig = f;
    const surf = new ReflectSurfaces(); surf.init(ctx);
    const dbl = new DoubleSystem(surf); dbl.init(ctx);
    const ch = compile(ch5 as ChapterDef);
    await surf.loadChapter(ch); await dbl.loadChapter(ch);
    const seg = ch.segments.find((s) => s.def.id === '5-4')!;
    const b = new PoseBuilder();
    let prev = snap({ s: seg.s0 + 40, t: 40 }); prev.segIndex = seg.index;
    dbl.spawn({ id: 'wcMe', surface: 'wcMirror5', source: 'history', delay: 0 }, prev);
    dbl.spawn({ id: 'wcStand', surface: 'wcMirror5', source: 'script', clip: 'standBehindShoulder', attachBehind: 'wcMe', thirdHand: { gesture: 'shoulder', at: 0.4, hold: 2.6 } }, prev);
    for (let i = 1; i <= 90; i++) {
      const s = seg.s0 + 40 + i * 0.08;
      const n = snap({ s, beat: s, t: 40 + i / 60 }); n.segIndex = seg.index;
      n.player.floorY = seg.floorY(s); prev.player.floorY = seg.floorY(s);
      const p = crawlPose(crawlInput({ s, beat: s, floorY: seg.floorY(s) }), b);
      f.history.push(n.t, p); WP5.playerPose.q.set(p.q); WP5.playerPose.root.set(p.root);
      surf.frame(prev, n, 1, 1 / 60); dbl.frame(prev, n, 1, 1 / 60);
      prev = n;
    }
    const w = { ctx, dbl } as unknown as Parameters<typeof doubleVerts>[0];
    const hy = feetY(w, 'wcMe'), by = feetY(w, 'wcStand');
    expect(Math.abs(by - hy)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(hy - seg.floorY(prev.player.s))).toBeLessThan(0.05);
  });
});

describe('world doubles fade in over ≥ 0.6 s (§10.2), also with reduced flicker', () => {
  for (const reducedFlicker of [false, true]) {
    it(`alpha ≤ 0.5 at 0.3 s and 1 at 0.8 s (reducedFlicker ${reducedFlicker})`, async () => {
      expect(WORLD_FADE_IN).toBeGreaterThanOrEqual(0.6);
      const ctx = fakeCtx('low');
      (ctx.settings as { reducedFlicker: boolean }).reducedFlicker = reducedFlicker;
      const f = new ActorRigFactory(ctx); (ctx as { rig: unknown }).rig = f;
      const surf = new ReflectSurfaces(); surf.init(ctx);
      const dbl = new DoubleSystem(surf); dbl.init(ctx);
      const ch = compile(ch5 as ChapterDef);
      await surf.loadChapter(ch); await dbl.loadChapter(ch);
      const seg = ch.segments.find((s) => s.def.id === '5-6')!;
      const at = (t: number) => { const n = snap({ s: seg.s0 + 30, t: 10 + t }); n.segIndex = seg.index; return n; };
      dbl.spawn({ id: 'standMe', surface: 'world', source: 'script', clip: 'walkUpright', anchor: { sAhead: 14, speed: -1.2 }, avoidPlayerLane: true }, at(0));
      const alphaAt = (t: number) => { dbl.frame(at(t), at(t), 1, 1 / 60); return dbl.active()[0]!.alpha; };
      alphaAt(0.1);
      expect(alphaAt(0.3)).toBeLessThanOrEqual(0.5);
      expect(alphaAt(0.8)).toBe(1);
    });
  }
});

describe('render-side solver plans are solved once per segment (U5)', () => {
  it('planFor memoizes per (solver, segment); the leader and oracle doubles share it; loadChapter prewarms the ahead segments', async () => {
    let calls = 0;
    const solver: SolverAPI = { solve: () => { calls++; return { steps: [], laneAt: () => 0, actionAt: () => 'none' } as unknown as Plan; } };
    const ch = compile(ch5 as ChapterDef);
    const run = ch.segments.find((s) => s.kind === 'run') as CompiledSegment;
    const p1 = planFor(solver, run), p2 = planFor(solver, run);
    expect(p1).toBe(p2);
    expect(calls).toBe(1);
    // 读章预热：5-11（追随者 ahead）在读章时求解，第一帧可见时不再求解
    const ctx = fakeCtx('low');
    (ctx as { solver: SolverAPI }).solver = solver;
    const fac = new ActorRigFactory(ctx); (ctx as { rig: unknown }).rig = fac;
    const L = new LeaderSystem(); L.init(ctx);
    calls = 0;
    await L.loadChapter(ch);
    const ahead = ch.segments.filter(needsPlan);
    expect(ahead.map((s) => s.def.id)).toContain('5-11');
    expect(calls).toBe(ahead.length);
    const seg = ch.segments.find((s) => s.def.id === '5-11')!;
    let prev = snap({ s: seg.s0 + 5, t: 1 }); prev.segIndex = seg.index;
    for (let i = 1; i <= 30; i++) {
      const n = snap({ s: seg.s0 + 5 + i * 0.05, t: 1 + i / 60 }); n.segIndex = seg.index; n.follower.mode = 'ahead';
      L.frame(prev, n, 1, 1 / 60); prev = n;
    }
    expect(L.state.visible).toBe(true);
    expect(calls).toBe(ahead.length);
  });
});
