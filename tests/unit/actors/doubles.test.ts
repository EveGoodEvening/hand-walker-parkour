// tests/unit/actors/doubles.test.ts —— §5.8 替身的放置：侧墙镜从三条车道都在镜头前方、端墙镜迎面、记忆闪回、
// 世界替身 avoidPlayerLane / stopAtDistance、attachBehind、doubleEnd 淡出、换段清理。
import { describe, expect, it } from 'vitest';
import type { ViewContext } from '../../../src/core/contracts';
import type { SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import testChapter from '../../../src/levels/chapters/test';
import type { ChapterDef, CompiledChapter } from '../../../src/levels/schema';
import { DoubleSystem, MEMORY_FADE_IN, MEMORY_FADE_OUT } from '../../../src/render/actors/Doubles';
import { LEADER_CENTER_OFFSET, LeaderSystem } from '../../../src/render/actors/Leader';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { ActorRigFactory } from '../../../src/render/actors/rigBuild';
import { DEBUG_PUDDLE_ID, endRoomFloor, ReflectSurfaces } from '../../../src/render/actors/surfaces';
import { WP5 } from '../../../src/render/actors/shared';
import { crawlInput, fakeCtx, snap } from './helpers';

interface World { ctx: ViewContext; f: ActorRigFactory; surf: ReflectSurfaces; dbl: DoubleSystem; ch: CompiledChapter }

async function world(def: ChapterDef = ch1 as ChapterDef): Promise<World> {
  const ctx = fakeCtx('low');
  const f = new ActorRigFactory(ctx);
  (ctx as { rig: unknown }).rig = f;
  const surf = new ReflectSurfaces();
  surf.init(ctx);
  const dbl = new DoubleSystem(surf);
  dbl.init(ctx);
  const ch = compile(def);
  await surf.loadChapter(ch);
  await dbl.loadChapter(ch);
  return { ctx, f, surf, dbl, ch };
}

/** 把玩家从 s0 推进到 s1（写历史、逐帧调用两个系统），返回最后一份快照。 */
function run(w: World, from: SimSnapshot, s1: number, lane: -1 | 0 | 1, segIndex: number, frames = 60): SimSnapshot {
  const b = new PoseBuilder();
  let prev = from;
  const s0 = from.player.s, t0 = from.t;
  for (let i = 1; i <= frames; i++) {
    const s = s0 + ((s1 - s0) * i) / frames;
    const t = t0 + ((s1 - s0) / 5) * (i / frames);
    const n = snap({ s, lane, beat: s, t });
    n.segIndex = segIndex;
    const p = crawlPose(crawlInput({ s, x: lane * 1.1, beat: s, laneTarget: lane }), b);
    w.f.history.push(t, p);
    WP5.playerPose.q.set(p.q); WP5.playerPose.root.set(p.root);
    w.surf.frame(prev, n, 1, 1 / 60);
    w.dbl.frame(prev, n, 1, 1 / 60);
    prev = n;
  }
  return prev;
}

describe('doubles placement (§5.8)', () => {
  it('1-3 wall mirror: the delayed double stands behind the glass, ahead of the player, from every lane', async () => {
    for (const lane of [-1, 0, 1] as const) {
      const w = await world();
      const seg = w.ch.segments.find((s) => s.def.id === '1-3')!;
      let sn = snap({ s: seg.s0 + 6, lane, t: 10 }); sn.segIndex = seg.index;
      w.dbl.spawn({ id: 'wc', surface: 'wcMirror', source: 'history', delay: 0.35 }, sn);
      sn = run(w, sn, seg.s0 + 14, lane, seg.index);
      const d = w.dbl.active()[0]!;
      expect(d.kind).toBe('side');
      expect(d.visible).toBe(true);
      const [hx, , hz] = d.head as [number, number, number];
      expect(hx).toBeLessThan(-1.8);               // 在左墙的镜中房间里
      expect(hx).toBeGreaterThan(-1.8 - 3.75);
      const ahead = -hz - sn.player.s;
      expect(ahead).toBeGreaterThan(0.8);           // 在玩家前方（追尾镜头看得见）
      expect(ahead).toBeLessThan(12);
      // 镜头前方的角度（横屏 16:9，水平半视角约 40°）
      const camX = 0.7 * sn.player.x, camS = sn.player.s - 2.35;
      const ang = Math.atan2(Math.abs(hx - camX), -hz - camS) * 180 / Math.PI;
      expect(ang).toBeLessThan(32);
    }
  });

  it('1-3 doubleMod headDownHold / headLag keeps the head down for the hold, then lifts late', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-3')!;
    let sn = snap({ s: seg.s0 + 30, t: 20 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'wc', surface: 'wcMirror', source: 'history', delay: 0.35 }, sn);
    sn = run(w, sn, seg.s0 + 37, 0, seg.index);
    const up = w.dbl.active()[0]!.head[1] as number;
    w.dbl.modify('wc', { headLag: 0.6, headDownHold: 1.0 }, sn.t);
    sn = run(w, sn, sn.player.s + 2.5, 0, seg.index, 30);        // 0.5 s 后：低着头
    const down = w.dbl.active()[0]!.head[1] as number;
    expect(down).toBeLessThan(up - 0.03);
    sn = run(w, sn, sn.player.s + 10, 0, seg.index, 60);          // 2 s 后：抬起来了
    const again = w.dbl.active()[0]!.head[1] as number;
    expect(again).toBeGreaterThan(down + 0.03);
  });

  it('1-6 end mirror: the double crawls toward you inside the mirror room', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-6')!;
    const se = seg.s0 + 30;
    let sn = snap({ s: seg.s0 + 2, t: 30 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'endMirror', surface: 'endMirror', source: 'history', delay: 0 }, sn);
    sn = run(w, sn, seg.s0 + 20, 1, seg.index);
    const d = w.dbl.active()[0]!;
    expect(d.kind).toBe('end');
    const [hx, , hz] = d.head as [number, number, number];
    expect(-hz).toBeGreaterThan(se);                  // 在镜面后面
    expect(-hz).toBeLessThan(se + 3.75);
    expect(Math.abs(hx)).toBeLessThan(0.95);          // 在端墙开口宽度之内
    expect(WP5.focus?.kind).toBe('end');              // 停拍时镜头会看向它
    // doubleMod thirdHand shush：不抛错，替身照常显示
    w.dbl.modify('endMirror', { thirdHand: { gesture: 'shush', at: 0, hold: 3 } }, sn.t);
    run(w, sn, sn.player.s + 0.01, 1, seg.index, 30);
    expect(w.dbl.active()[0]!.visible).toBe(true);
  });

  it('1-2 memory: the inverted figure hangs behind the window glass for `seconds`, then vanishes', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-2')!;
    let sn = snap({ s: seg.s0 + 48, t: 50 }); sn.segIndex = seg.index;
    w.dbl.memory('win3f', 1.2, sn);
    sn = run(w, sn, seg.s0 + 50, 0, seg.index, 30);
    const d = w.dbl.active()[0]!;
    expect(d.kind).toBe('memory');
    expect(d.visible).toBe(true);
    expect(d.head[0]!).toBeLessThan(-1.8);
    expect(d.head[1]!).toBeGreaterThan(0.7);          // 以手腕为轴悬在窗台附近，头朝下
    run(w, sn, sn.player.s + 5, 0, seg.index, 30);    // 1 s 之后
    expect(w.dbl.active().length).toBe(0);
  });

  it('world double: avoidPlayerLane never shares your lane; stopAtDistance stops it in the world; ends at segment change', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-5')!;
    let sn = snap({ s: seg.s0 + 10, lane: 0, t: 60 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'me', surface: 'world', source: 'script', clip: 'walkUpright', anchor: { sAhead: 20, speed: -2 }, avoidPlayerLane: true }, sn);
    for (const lane of [0, -1, 1, 0] as const) {
      sn = run(w, sn, sn.player.s + 3, lane, seg.index, 40);
      const [hx] = w.dbl.active()[0]!.head as [number, number, number];
      expect(Math.abs(hx - lane * 1.1)).toBeGreaterThan(0.6);
    }
    w.dbl.modify('me', { stopAtDistance: 5 }, sn.t);
    sn = run(w, sn, sn.player.s + 30, 0, seg.index, 400);          // 相对速度 −2 m/s：6 s 后早已走到 5 m 处
    expect(-w.dbl.active()[0]!.head[2]! - sn.player.s).toBeLessThan(5.2);
    const z1 = w.dbl.active()[0]!.head[2]!;
    sn = run(w, sn, sn.player.s + 1, 0, seg.index, 30);
    const z2 = w.dbl.active()[0]!.head[2]!;
    expect(Math.abs(z2 - z1)).toBeLessThan(0.05);    // 停在世界里，不再跟着走
    w.dbl.onSegment(w.ch.segments[seg.index + 1]!);
    expect(w.dbl.active().length).toBe(0);
  });

  it('attachBehind: the standing figure stands behind the crawler in the same mirror; doubleEnd fades out', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-3')!;
    let sn = snap({ s: seg.s0 + 10, t: 70 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'crawler', surface: 'wcMirror', source: 'history', delay: 0 }, sn);
    w.dbl.spawn({ id: 'stander', surface: 'wcMirror', source: 'script', clip: 'standBehindShoulder', attachBehind: 'crawler', thirdHand: { gesture: 'shoulder', at: 0, hold: 5 } }, sn);
    sn = run(w, sn, seg.s0 + 16, 0, seg.index, 60);
    const act = w.dbl.active();
    const c = act.find((d) => d.id === 'crawler')!, s = act.find((d) => d.id === 'stander')!;
    expect(s.visible).toBe(true);
    expect(s.head[1]!).toBeGreaterThan(c.head[1]! + 0.6);   // 站着
    expect(s.head[2]!).toBeGreaterThan(c.head[2]!);          // 在它身后（s 更小）
    expect(s.head[0]!).toBeLessThan(-1.8);                   // 同一面镜子里
    w.dbl.end('stander', 0.3, sn.t);
    run(w, sn, sn.player.s + 2, 0, seg.index, 30);
    expect(w.dbl.active().find((d) => d.id === 'stander')).toBeUndefined();
  });
});

describe('reflective surfaces: activation and placement limits', () => {
  const activeIds = (w: World) => Array.from(w.surf.views.values()).filter((v) => v.active).map((v) => v.id);

  it('the debug puddle is off at every chapter start (no surface, no puddle budget) until wp5Puddle places it', async () => {
    for (const def of [testChapter as ChapterDef, ch1 as ChapterDef]) {
      const w = await world(def);
      const seg = w.ch.segments[0]!;
      let sn = snap({ s: seg.s0, t: 1 }); sn.segIndex = seg.index;
      sn = run(w, sn, seg.s0 + 1.5, 0, seg.index, 10);
      expect(activeIds(w)).toEqual([]);
      expect(w.surf.debugPuddle?.group.visible).toBe(false);
      // 放下之后才参加候选
      w.surf.placeDebugPuddle(1.1, sn.player.s + 4, 0);
      run(w, sn, sn.player.s + 0.2, 0, seg.index, 2);
      expect(activeIds(w)).toEqual([DEBUG_PUDDLE_ID]);
      expect(w.surf.debugPuddle?.group.visible).toBe(true);
      // 换章：调试水洼回到关闭状态，旧的那组从场景里移除（不管放没放下过）
      const before = w.surf.debugPuddle!.group;
      await w.surf.loadChapter(w.ch);
      expect(before.parent).toBeNull();
      run(w, sn, sn.player.s + 0.2, 0, seg.index, 2);
      expect(activeIds(w)).toEqual([]);
      const unused = w.surf.debugPuddle!.group;
      await w.surf.loadChapter(w.ch);
      expect(unused.parent).toBeNull();
    }
  });

  it('1-6 end mirror: the double stands on the mirror-room floor, level with the opening (y0), not under it', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-6')!;
    const v = w.surf.views.get('endMirror')!;
    expect(endRoomFloor(v)).toBeCloseTo(0.15, 3);
    let sn = snap({ s: seg.s0 + 2, t: 30 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'endMirror', surface: 'endMirror', source: 'history', delay: 0 }, sn);
    sn = run(w, sn, seg.s0 + 20, 0, seg.index);
    const b = new PoseBuilder();
    crawlPose(crawlInput({ s: sn.player.s, beat: sn.player.s }), b);
    const playerHead = b.jointWorld('head', new (await import('three')).Vector3()).y + 0.1;
    const dHead = w.dbl.active()[0]!.head[1]!;
    expect(dHead - playerHead).toBeGreaterThan(0.12);
    expect(dHead - playerHead).toBeLessThan(0.18);
  });

  it('1-3 wall mirror: near the far end of the mirror the double stays inside the glass instead of sliding behind the wall', async () => {
    const w = await world();
    const seg = w.ch.segments.find((s) => s.def.id === '1-3')!;
    const v = w.surf.views.get('wcMirror')!;
    let sn = snap({ s: v.s1 - 6, t: 40 }); sn.segIndex = seg.index;
    w.dbl.spawn({ id: 'wc', surface: 'wcMirror', source: 'history', delay: 0.35 }, sn);
    sn = run(w, sn, v.s1 - 1.5, 0, seg.index, 60);
    const d = w.dbl.active()[0]!;
    expect(d.visible).toBe(true);
    const sHead = -d.head[2]!;
    expect(sHead).toBeLessThan(v.s1);
    expect(sHead).toBeGreaterThan(v.s0);
  });
});

describe('leader and memory timing (minor fixes)', () => {
  it('the leader steps off the middle-lane centre line so the player\'s head does not hide it; side lanes stay centred', async () => {
    const ctx = fakeCtx('low');
    const f = new ActorRigFactory(ctx);
    (ctx as { rig: unknown }).rig = f;
    const L = new LeaderSystem();
    L.init(ctx);
    const ch = compile(testChapter as ChapterDef);
    await L.loadChapter(ch);
    L.forced = true;
    for (const lane of [0, -1, 1] as const) {
      let prev = snap({ s: 5, t: 1 });
      for (let i = 1; i <= 120; i++) {
        const n = snap({ s: 5 + i * 0.04, t: 1 + i / 60 });
        n.follower.leaderLane = lane;
        L.frame(prev, n, 1, 1 / 60);
        prev = n;
      }
      expect(L.state.visible).toBe(true);
      expect(L.state.x).toBeCloseTo(lane * 1.1 + (lane === 0 ? LEADER_CENTER_OFFSET : 0), 2);
    }
  });

  it('the memory flash fades in and out briefly instead of a hard cut (appendix A-1)', async () => {
    expect(MEMORY_FADE_IN + MEMORY_FADE_OUT).toBeLessThan(0.5);   // 1.2 s 的闪现大部分时间完全可见
    const w = await world();
    const seg = w.ch.segments.find((q) => q.def.id === '1-2')!;
    const at = (t: number) => { const n = snap({ s: seg.s0 + 48 + t, t: 50 + t }); n.segIndex = seg.index; return n; };
    w.surf.frame(at(0), at(0), 1, 0);
    w.dbl.memory('win3f', 1.2, at(0));
    const alphaAt = (t: number) => { w.surf.frame(at(t), at(t), 1, 1 / 60); w.dbl.frame(at(t), at(t), 1, 1 / 60); return w.dbl.active()[0]?.alpha ?? 0; };
    const a1 = alphaAt(MEMORY_FADE_IN * 0.5);
    expect(a1).toBeGreaterThan(0.2); expect(a1).toBeLessThan(0.8);          // 淡入中
    expect(alphaAt(0.6)).toBe(1);
    const a2 = alphaAt(1.2 + MEMORY_FADE_OUT * 0.5);
    expect(a2).toBeGreaterThan(0.2); expect(a2).toBeLessThan(0.8);          // 淡出中
    alphaAt(1.2 + MEMORY_FADE_OUT + 0.05);
    expect(w.dbl.active().length).toBe(0);
  });
});
