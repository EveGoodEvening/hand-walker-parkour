// tests/unit/npc/boundary.test.ts —— 段界上画面连续、失败后段内时间停住、陈默让开时不钻进 1-2 的储物柜（审查 r2）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../src/core/events';
import type { QualityTier } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, NpcGroupDef } from '../../../src/levels/schema';
import { MAX_EXPAND } from '../../../src/render/npc/archetype';
import { STAND_HIP } from '../../../src/render/npc/LegForest';
import { CHEN_STEP, chenStepAside } from '../../../src/render/npc/ObstacleView';
import { obstacleState } from '../../../src/render/npc/simBridge';
import { HIPS } from '../../../src/render/npc/specials';
import { chapter, runSeg } from '../core/helpers';
import { ViewDriver, faceBack, instancedBounds, makeView } from './helpers';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

/** 可见实例的世界位置（x, y, z）。 */
function positions(meshes: readonly THREE.InstancedMesh[], keep: (v: THREE.Vector3) => boolean = () => true): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, _m);
      _v.setFromMatrixPosition(_m);
      if (keep(_v)) out.push(_v.clone());
    }
  }
  return out;
}

/** a 中每个点到 b 中最近点的距离，取最大值（b 为空时为 ∞）。 */
function maxJump(a: readonly THREE.Vector3[], b: readonly THREE.Vector3[]): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) best = Math.min(best, p.distanceTo(q));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('段界上画面连续（已经过去的段照常计时，不跳回出生点）', () => {
  it('爬行的人、路边走路的人、行人障碍、已经让开的陈默：跨过段界的那一帧位置连续', () => {
    const npcs: NpcGroupDef[] = [
      { id: 'stream', kind: 'crawlerStream', from: 0, to: 40, side: 'both', density: 1 },
      { id: 'walk', kind: 'walkers', from: 0, to: 40, side: 'both', density: 1 },
    ];
    const def = chapter([
      runSeg({
        id: 'A', beats: 40, stride: 1.4, cadence: 6, kit: 'plaza', follower: { mode: 'hidden', steady: 3 }, npcs,
        items: [
          { at: 34, lane: -1, kind: 'legs', behavior: { type: 'walk', speed: 1 } },
          { at: 37, lane: 0, kind: 'chenMo', id: 'chenmo', behavior: { type: 'yield', atBeat: 36 } },
          { at: 38, lane: 0, kind: 'footOut', id: 'chenmoFoot' },
        ],
      }),
      runSeg({ id: 'B', beats: 40, stride: 1.4, cadence: 6, kit: 'plaza', follower: { mode: 'hidden', steady: 3 } }),
    ]);
    const { view, ctx } = makeView('high');
    // 跨过段界时陈默和行人障碍已经在身后：镜头转向身后（回头）时它们照常画，这里看的就是这个画面（U6：平时越过的障碍会缩小消失）
    faceBack(ctx);
    const vd = new ViewDriver(view, def as ChapterDef);
    vd.d.sim.setInvincible(true);
    let snap = vd.step(1);
    let checked = false;
    for (let i = 0; i < 120 * 14 && !checked; i++) {
      const seg0 = snap.segIndex;
      const s0 = snap.player.s;
      // 窗口边上的人可能这一帧刚好进出视野，只比较离窗口边 2 m 以内的
      const inner = (v: THREE.Vector3) => -v.z > s0 - 3 && -v.z < s0 + 30;
      const crawl0 = positions(view.crawlers.meshes.slice(0, 1), inner);
      const hips0 = positions([view.forest.pool('hips').mesh], inner);
      snap = vd.step(1);
      if (snap.segIndex === seg0) continue;
      checked = true;
      const crawl1 = positions(view.crawlers.meshes.slice(0, 1));
      const hips1 = positions([view.forest.pool('hips').mesh]);
      expect(crawl0.length).toBeGreaterThan(5);
      expect(hips0.length).toBeGreaterThan(5);
      // 一个 tick（1/120 s）里玩家走 7 cm，路边的人、爬行的人更慢：任何人都不应该跳 25 cm 以上
      expect(maxJump(crawl0, crawl1)).toBeLessThan(0.25);
      expect(maxJump(hips0, hips1)).toBeLessThan(0.25);
      // 已经让开的陈默在上一段里，仍然站着（不会重新蹲回过道里）
      const hips = view.forest.pool('hips');
      let chenY = -Infinity;
      for (let k = 0; k < hips.n; k++) if (hips.variantAt(k) === HIPS.fullUpper) chenY = hips.matrixAt(k, _m).elements[13] as number;
      expect(chenY - snap.player.floorY).toBeGreaterThan(STAND_HIP - 0.05);
    }
    expect(checked).toBe(true);
  });

  it('失败（fall）以后障碍的段内时间停住（模拟也不再推进 tSeg），retry 后重新同步', () => {
    const def = chapter([runSeg({
      id: 'f', beats: 80, follower: { mode: 'hidden', steady: 3 },
      // 放在采样期间玩家走不到的地方（越过的障碍会缩小消失，U6）
      items: [{ at: 40, lane: 1, kind: 'footOut', behavior: { type: 'stretch', period: 1.3, phase: 0, outFrac: 0.5 } }],
    })]);
    const { view } = makeView('high');
    const vd = new ViewDriver(view, def as ChapterDef);
    vd.d.sim.setInvincible(true);
    const snap = vd.step(30);
    const sample = () => {
      const out: string[] = [];
      for (let k = 0; k < 10; k++) {
        vd.step(13);
        const p = view.pools.get('footOut');
        const arr: number[] = [];
        if (p) for (let i = 0; i < p.pool.n; i++) arr.push(...p.pool.matrixAt(i, _m).elements.map((x) => Math.round(x * 1e5)));
        out.push(arr.join(','));
      }
      return out;
    };
    const live = sample();
    expect(new Set(live).size).toBeGreaterThan(1);
    view.onEvent({ type: 'fall', tick: snap.tick, data: { cause: 'legs', surface: 'terrazzo' } } as GameEvent, vd.d.snap);
    const frozen = sample();
    expect(new Set(frozen).size).toBe(1);
    view.onEvent({ type: 'retry', tick: snap.tick, data: { segment: 'f', beat: 0 } } as GameEvent, vd.d.snap);
    view.onReset(vd.d.snap);
    expect(new Set(sample()).size).toBeGreaterThan(1);
  });
});

describe('陈默让开（§4.1 1-2「他让开了，一只脚还留在过道里」）', () => {
  it('第一章 1-2：起身、让开、脚留在过道里的整个过程，身体不进两侧储物柜（碰撞盒和模型外沿）', () => {
    for (const tier of ['high', 'low'] as QualityTier[]) {
      const { view } = makeView(tier);
      const vd = new ViewDriver(view, getChapter('ch1') as ChapterDef, { segment: '1-2', beat: 104 });
      vd.d.sim.setAutopilot('perfect');
      const seg = vd.ch.segments.find((x) => x.def.id === '1-2');
      const chen = seg?.obstacles.find((o) => o.kind === 'chenMo');
      const lockers = seg?.obstacles.filter((o) => o.kind === 'locker') ?? [];
      expect(chen).toBeDefined();
      expect(lockers.length).toBe(2);
      if (!chen) continue;
      const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
      const boxes = lockers.map((L) => { obstacleState(L, 0, Number.POSITIVE_INFINITY, st); return { x0: st.x0 - MAX_EXPAND, x1: st.x1 + MAX_EXPAND, s0: L.s0, s1: L.s1 }; });
      const sC = (chen.s0 + chen.s1) / 2;
      const near = (i: number, mesh: THREE.InstancedMesh) => {
        mesh.getMatrixAt(i, _m); _v.setFromMatrixPosition(_m);
        return Math.abs(_v.x) < 1.0 && -_v.z > sC - 1.5 && -_v.z < sC + 4;
      };
      const bad: string[] = [];
      let frames = 0, maxX = 0;
      for (let k = 0; k < 80; k++) {
        const snap = vd.step(10);
        if (snap.segIndex !== seg?.index || snap.player.s > sC + 4) break;
        const b = instancedBounds(view.forest.meshes, { only: near });
        if (b.isEmpty()) continue;
        frames++;
        maxX = Math.max(maxX, b.max.x);
        for (const L of boxes) {
          const sOverlap = -b.min.z > L.s0 && -b.max.z < L.s1;
          if (sOverlap && b.max.x > L.x0 && b.min.x < L.x1) bad.push(`${tier} beat ${snap.segBeat.toFixed(1)} x ${b.min.x.toFixed(3)}..${b.max.x.toFixed(3)} vs ${L.x0.toFixed(2)}..${L.x1.toFixed(2)}`);
        }
      }
      expect(frames, tier).toBeGreaterThan(10);
      expect(bad).toEqual([]);
      // 确实让开了：身体右沿离开了中道中间（不是原地不动）
      expect(maxX, tier).toBeGreaterThan(0.45);
    }
  });

  it('两侧都空着时照常让开 0.56 m；一侧有障碍时让到另一侧', () => {
    const ob = (id: number, kind: 'chenMo' | 'footOut' | 'locker', lane: -1 | 0 | 1, s0: number, len = 0.5) => ({
      id, kind, cls: kind === 'footOut' ? 'low' : 'block', archetype: kind === 'locker' ? 'column' : kind === 'footOut' ? 'footOut' : 'legs', lanes: [lane], beat: s0, s0, s1: s0 + len,
      y0: 0, y1: 1, halfW: kind === 'locker' ? 0.4 : 0.3, behavior: kind === 'chenMo' ? { type: 'yield', atBeat: 1 } : { type: 'static' }, npc: kind !== 'locker', params: {},
    }) as never;
    const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
    const chen = ob(1, 'chenMo', 0, 10), foot = ob(2, 'footOut', 0, 12, 0.3);
    expect(chenStepAside(chen, foot, [chen, foot], st).x).toBeCloseTo(CHEN_STEP.aside, 6);
    const right = ob(3, 'locker', 1, 8, 8);
    const d = chenStepAside(chen, foot, [chen, foot, right], st);
    expect(d.side).toBe(-1);
    expect(d.x).toBeCloseTo(-CHEN_STEP.aside, 6);
  });
});
