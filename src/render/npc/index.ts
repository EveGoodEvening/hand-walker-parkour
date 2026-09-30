// src/render/npc/index.ts —— WP6「NPC、障碍与道具」的入口（DESIGN.md §8.2 规则 3 / 4、§8.7、§8.10 WP6）。
// · 18 个障碍原型：archetypes/*.ts 用 import.meta.glob 自动收集并 registerArchetype（新增原型不改任何共享索引）。
// · 画面系统 ObstacleView（id 'npc'，order 20）覆盖 CORE 的盒子占位（同 id 后注册者覆盖先注册者）。
// · crowd cue 的唯一处理者（CUE_OWNER.crowd = WP6）。
// · 调试扩展（__game.ext.*，只在 ?test=1 或 ?debug=… 下可用）：npcStage、npcHitbox、npcStats、npcCrowd、npcAsk、npcHit。
import * as THREE from 'three';
import type { ArchetypeFactory, ArchetypePool, ViewContext } from '../../core/contracts';
import type { GameEvent } from '../../core/events';
import { registerArchetype, registerCueHandler, registerDebug, registerViewSystem } from '../../core/registry';
import type { CrowdOp, HitSeverity } from '../../core/types';
import { urlParams } from '../../core/urlParams';
import type { CompiledObstacle } from '../../levels/schema';
import { factoryOf, type ArchetypeDef } from './archetype';
import { ARCHETYPE_DEFS } from './defs';
import { Crawlers } from './Crawlers';
import { LegForest, newPerson } from './LegForest';
import { ObstacleView } from './ObstacleView';
import { obstacleState } from './simBridge';
import { lookFor } from './specials';
import { STAGE_NAMES, makeStage, toStage, type StageName } from './stage';

export const npcView = new ObstacleView(ARCHETYPE_DEFS);
registerViewSystem(npcView);

/** legs / crawler 的契约工厂：独立使用时各自建一片小森林（ObstacleView 内部不走这里）。 */
function delegateFactory(def: ArchetypeDef): ArchetypeFactory {
  return {
    id: def.id,
    create(ctx: ViewContext): ArchetypePool {
      const slots: CompiledObstacle[] = [];
      const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
      if (def.delegate === 'crawlers') {
        const cr = new Crawlers(); cr.init(ctx, 32);
        const color = new THREE.Color(0x9aa3a6);
        const redraw = (t: number) => {
          cr.begin();
          for (const o of slots) {
            if (!o) continue;
            obstacleState(o, t, Number.POSITIVE_INFINITY, st);
            cr.add({ x: (st.x0 + st.x1) / 2, y: 0, z: -((o.s0 + o.s1) / 2 + st.ds), yaw: 0, dist: t * 3, color, phase: 0 }, true);
          }
          cr.end();
        };
        return { object: cr.group, place(slot, o, t) { slots[slot] = o; redraw(t); }, hit(_s: number, _v: HitSeverity) { /* 人不会被碰倒 */ }, hide(slot) { slots.length = Math.min(slots.length, slot); redraw(0); } };
      }
      const f = new LegForest(); f.init(ctx, 32);
      const p = newPerson(lookFor('student', 1, 'delegate'));
      const redraw = (t: number) => {
        f.begin();
        for (const o of slots) {
          if (!o) continue;
          obstacleState(o, t, Number.POSITIVE_INFINITY, st);
          p.x = (st.x0 + st.x1) / 2; p.z = -((o.s0 + o.s1) / 2 + st.ds);
          f.add(p);
        }
        f.end();
      };
      return { object: f.group, place(slot, o, t) { slots[slot] = o; redraw(t); }, hit() { /* 人不会被碰倒 */ }, hide(slot) { slots.length = Math.min(slots.length, slot); redraw(0); } };
    },
  };
}

for (const d of ARCHETYPE_DEFS) registerArchetype(d.delegate ? delegateFactory(d) : factoryOf(d));

registerCueHandler('crowd', 'WP6', (b, c) => npcView.crowdOp(b.group, b.op, c.snap));

// ——— 调试扩展 ———
const guard = () => { if (!urlParams().debugEnabled) throw new Error('debug disabled'); };
const snapOrThrow = () => { const s = npcView.lastSnap; if (!s) throw new Error('npc: no frame rendered yet'); return s; };

registerDebug('npcStage', (name?: unknown, opts?: unknown) => {
  guard();
  if (!name || name === 'off') { npcView.setStage(null); return { stage: null }; }
  if (!(STAGE_NAMES as readonly string[]).includes(String(name))) throw new Error(`npcStage: unknown stage ${String(name)} (${STAGE_NAMES.join(', ')})`);
  const snap = snapOrThrow();
  const o = (opts ?? {}) as { follow?: boolean; ahead?: number };
  const s0 = snap.player.s + (o.ahead ?? 0);
  const d = makeStage(name as StageName, s0, snap.player.floorY);
  npcView.setStage(toStage(name as StageName, d, snap.t, snap.player.s, o.follow));
  return { stage: name, obstacles: d.obstacles.length, decor: d.decor.length, follow: o.follow ?? d.follow };
});
registerDebug('npcHitbox', (on?: unknown) => { guard(); npcView.enableHitbox(on !== false); return !!npcView.hitbox; });
registerDebug('npcStats', () => ({
  ...npcView.stats,
  visibleMeshes: npcView.visibleMeshes(),
  forestMeshes: npcView.forest.meshes.filter((m) => m.visible).length,
  crawlerMeshes: npcView.crawlers.meshes.filter((m) => m.visible).length,
  archetypeMeshes: Array.from(npcView.pools.values()).filter((p) => p.pool.mesh.visible).length,
  pools: Object.fromEntries(Array.from(npcView.pools, ([k, p]) => [k, p.pool.n])),
  forest: npcView.forest.counts(),
  stage: npcView.stage?.name ?? null,
}));
registerDebug('npcCrowd', (group?: unknown, op?: unknown) => { guard(); npcView.crowdOp(String(group ?? '*'), (op ?? 'turnShoes') as CrowdOp, snapOrThrow()); return true; });
/** 模拟一次「让一下」：targetId 缺省 = 前方最近的人腿障碍。 */
registerDebug('npcAsk', (result?: unknown, targetId?: unknown) => {
  guard();
  const snap = snapOrThrow();
  let id = typeof targetId === 'number' ? targetId : -1;
  if (id < 0) {
    // 前方 1.5–12 m 内最近的人腿障碍，可请求的（askable）优先
    const cands = (npcView.stage?.obstacles ?? npcView.chapter?.segments.flatMap((s) => s.obstacles) ?? [])
      .filter((o) => o.archetype === 'legs' && o.s0 > snap.player.s + 1.5 && o.s0 < snap.player.s + 12)
      .sort((a, b) => (a.behavior.type === 'askable' ? 0 : 1) - (b.behavior.type === 'askable' ? 0 : 1) || a.s0 - b.s0);
    id = cands[0]?.id ?? -1;
  }
  const e = { type: 'ask', tick: snap.tick, data: { targetId: id, result: result === 'ignore' ? 'ignore' : 'part' } } as GameEvent;
  npcView.onEvent(e, snap);
  return id;
});
/** 模拟一次人群段里的绊倒（安静的一秒 + 鞋尖转向）。 */
registerDebug('npcHit', () => {
  guard();
  const snap = snapOrThrow();
  const e = { type: 'hit', tick: snap.tick, data: { severity: 'stumble', kind: 'legs', obstacleId: -1, lane: snap.player.lane, steady: snap.player.steady, crowd: true, firstLegHit: false } } as GameEvent;
  npcView.onEvent(e, snap);
  return true;
});
