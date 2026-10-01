// tests/unit/actors/fixes.test.ts —— 修复轮 U5 的替身修复：attachBehind 的地面高度（3-10 静场 / 5-4 跑段）、
// 世界替身淡入 ≥ 0.6 s（§10.2）、渲染端求解器路线只求一次。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, createPose } from '../../../src/core/rig';
import { clipPose } from '../../../src/render/actors/clips';
import type { Plan, SolverAPI } from '../../../src/core/contracts';
import { compile } from '../../../src/levels/compile';
import ch3 from '../../../src/levels/chapters/ch3';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef, CompiledSegment } from '../../../src/levels/schema';
import { DoubleSystem, STAND_MIRROR, WORLD_FADE_IN } from '../../../src/render/actors/Doubles';
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

describe('4-3: the standing "me" is inside a standing mirror on the plaza (U5, D10)', () => {
  async function worldDouble(chDef: ChapterDef, segId: string, spec: Parameters<DoubleSystem['spawn']>[0], kind: 'stand' | 'run', spawnAt = 0, until = 1.5) {
    const ctx = fakeCtx('low');
    const f = new ActorRigFactory(ctx); (ctx as { rig: unknown }).rig = f;
    const surf = new ReflectSurfaces(); surf.init(ctx);
    const dbl = new DoubleSystem(surf); dbl.init(ctx);
    const ch = compile(chDef);
    await surf.loadChapter(ch); await dbl.loadChapter(ch);
    const seg = ch.segments.find((s) => s.def.id === segId)!;
    const at = (t: number) => { const n = snap({ s: seg.s0 + 3, t: 20 + t, segKind: kind }); n.segIndex = seg.index; return n; };
    dbl.onSegment(seg);
    let prev = at(0);
    const log: Array<{ t: number; mirror: ReturnType<DoubleSystem['mirrorState']>; d: ReturnType<DoubleSystem['active']>[number] | undefined }> = [];
    let spawned = false;
    for (let i = 0; i <= Math.round(until * 60); i++) {
      const t = i / 60, n = at(t);
      if (!spawned && t >= spawnAt - 1e-9) { dbl.spawn(spec, n); spawned = true; }
      dbl.frame(prev, n, 1, 1 / 60); prev = n;
      log.push({ t, mirror: dbl.mirrorState(), d: dbl.active().find((q) => q.id === spec.id) });
    }
    return { dbl, ctx, last: prev, log };
  }
  const SPEC = { id: 'dreamMirror', surface: 'world', source: 'script', clip: 'smile', anchor: { sAhead: 7, lane: 1, speed: 0 }, ttl: 3 } as const;

  it('a frameless mirror stands at the plaza edge for the whole segment; the double fades in inside it, facing the camera (yaw within 20°)', async () => {
    const ch4 = (await import('../../../src/levels/chapters/ch4')).default as ChapterDef;
    const { dbl, ctx, last, log } = await worldDouble(ch4, '4-3', { ...SPEC, anchor: { ...SPEC.anchor } }, 'stand', 3.2, 7.5);
    // 镜子在段一开始就有（1 s 淡入，镜头这时正升到站立视线），替身出现之前、消失之后都在
    const at = (t: number) => log.find((q) => q.t >= t - 1e-9)!;
    expect(at(0.1).mirror.visible).toBe(true);
    expect(at(0.3).mirror.opacity).toBeLessThan(0.5);                                    // 不是突然出现
    expect(at(1.2).mirror.opacity).toBe(1);
    expect(at(3.0).d).toBeUndefined();
    expect(at(7.4).mirror.visible).toBe(true); expect(at(7.4).mirror.opacity).toBe(1);   // 替身 ttl 3 s 之后镜子还在
    const d = at(4.4).d!;
    expect(d.visible).toBe(true);
    expect(d.mirror).toBe(true);
    // 在广场边上，不在你走的路上（车道 1 的中心是 x = 1.1）
    const g = ctx.scene.getObjectByName('wp5.standMirror')!;
    expect(g.position.x).toBeGreaterThan(1.1 + 0.6);
    // 替身在镜子里：换到镜子的本地坐标，头在镜面的宽、高之内，在玻璃（z = 0）和镜底（z = −back）之间
    g.updateMatrixWorld(true);
    const h = g.worldToLocal(new THREE.Vector3(...(d.head as [number, number, number])));
    expect(Math.abs(h.x)).toBeLessThan(STAND_MIRROR.w / 2 - 0.1);
    expect(h.y).toBeGreaterThan(1.2); expect(h.y).toBeLessThan(STAND_MIRROR.h);
    expect(h.z).toBeLessThan(0); expect(h.z).toBeGreaterThan(-STAND_MIRROR.back);
    // 脚站在镜中的地面（玻璃下沿到镜底的底板）上：从站立机位看，脚在镜面的下沿以内，不是吊在镜子下面（修复轮 U5 第三轮）
    const fl = g.getObjectByName('wp5.standMirror.floor') as THREE.Mesh;
    expect(fl).toBeTruthy();
    const box = ctx.scene.getObjectByName(`double${d.slot}`)!;
    box.updateMatrixWorld(true);
    let mesh: THREE.SkinnedMesh | null = null;
    box.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
    const m = mesh as unknown as THREE.SkinnedMesh;
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, sk = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 300);
    cam.position.set(last.player.x, last.player.floorY + 1.62, -last.player.s + 1.9); cam.lookAt(last.player.x, last.player.floorY + 1.5, -last.player.s - 8); cam.updateMatrixWorld(true);
    let below = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      const bi = sk.getX(i);
      if (bi !== BONE_INDEX.footL && bi !== BONE_INDEX.footR) continue;
      const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
      const lv = g.worldToLocal(v.clone());
      expect(Math.abs(lv.x)).toBeLessThan(STAND_MIRROR.w / 2); expect(lv.z).toBeLessThan(0); expect(lv.z).toBeGreaterThan(-STAND_MIRROR.back);
      // 同一个横向位置上镜面的下沿（玻璃与底板的交线）在画面上的高度：脚的每个顶点都不低于它（容差 0.5 px @ 720）
      const edge = g.localToWorld(new THREE.Vector3(lv.x, 0, 0)).project(cam).y;
      n++; if (v.project(cam).y < edge - 1 / 720) below++;
    }
    expect(n).toBeGreaterThan(0);
    expect(below).toBe(0);
    // 没有边框：镜子的每个材质都是浅色（画面亮度 ≥ 0.6），没有深色框条、支脚
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (!m || !(o as THREE.Mesh).isMesh) return;
      const hsl = { h: 0, s: 0, l: 0 }; m.color.getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.l).toBeGreaterThan(0.6);
    });
    // 朝向镜头：站立机位在玩家身后 (0, 1.62, +1.9)
    const fwd = [-Math.sin(d.yaw), -Math.cos(d.yaw)];
    const cx = last.player.x - d.head[0]!, cz = (-last.player.s + 1.9) - d.head[2]!;
    const ang = Math.acos((fwd[0]! * cx + fwd[1]! * cz) / Math.hypot(cx, cz)) * 180 / Math.PI;
    expect(ang).toBeLessThan(20);
    void dbl;
  });

  it('the 5-6 walking "me" (run segment) has no mirror', async () => {
    const { dbl, ctx } = await worldDouble(ch5 as ChapterDef, '5-6', { id: 'standMe', surface: 'world', source: 'script', clip: 'walkUpright', anchor: { sAhead: 14, speed: -1.2 }, avoidPlayerLane: true }, 'run');
    expect(dbl.active()[0]!.visible).toBe(true);
    expect(dbl.active()[0]!.mirror).toBe(false);
    expect(ctx.scene.getObjectByName('wp5.standMirror')!.visible).toBe(false);
  });

  it('smile lifts the head and lowers the hands over ~1.5 s (no face; appendix A-4)', () => {
    const b = new PoseBuilder();
    const at = (t: number) => {
      clipPose('smile', t, b, createPose(), { x: 0, y: 0, s: 0, yaw: 0 });
      const q = b.wq[BONE_INDEX.head]!.clone().premultiply(b.rootQ);
      return { look: new THREE.Vector3(0, 0, -1).applyQuaternion(q).y, hand: b.jointWorld('palmL', new THREE.Vector3()).y };
    };
    const a = at(0), z = at(2);
    expect(z.look).toBeGreaterThan(a.look + 0.12);
    expect(z.hand).toBeLessThan(a.hand - 0.02);
  });
});
