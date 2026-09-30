// tests/unit/npc/helpers.ts —— WP6 单元测试工具：假的 ViewContext（CORE 回落材质）、用真 Sim 产生快照。
import * as THREE from 'three';
import type { ViewContext } from '../../../src/core/contracts';
import { FlatLampField, FlatMaterials, FlatTextureBank } from '../../../src/core/fallbacks';
import { resolveQuality } from '../../../src/core/quality';
import { createRng } from '../../../src/core/rng';
import type { QualityTier, SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, CompiledChapter } from '../../../src/levels/schema';
import { ObstacleView } from '../../../src/render/npc/ObstacleView';
import { ARCHETYPE_DEFS } from '../../../src/render/npc/defs';
import { Driver } from '../core/helpers';

export function fakeCtx(tier: QualityTier = 'low'): ViewContext {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xaab4b8, 10, 48);
  return {
    renderer: null as never, scene, camera: new THREE.PerspectiveCamera(), overlayRoot: null as never, bus: null as never,
    settings: {} as never, quality: resolveQuality(tier, 1), rngFx: createRng(1), stencil: false,
    mat: new FlatMaterials(), lamps: new FlatLampField(), tex: new FlatTextureBank(), rig: null as never, surfaces: null as never, solver: null as never,
  };
}

export function makeView(tier: QualityTier = 'low'): { view: ObstacleView; ctx: ViewContext } {
  const ctx = fakeCtx(tier);
  const view = new ObstacleView(ARCHETYPE_DEFS);
  view.init(ctx);
  return { view, ctx };
}

/** 读章 + 用真 Sim 跑，把事件和快照喂给画面系统（和 Game 的分发顺序一致：先事件、后 frame）。 */
export class ViewDriver {
  readonly d: Driver;
  readonly ch: CompiledChapter;
  prev: SimSnapshot;
  constructor(readonly view: ObstacleView, def: ChapterDef, at?: { segment: string; beat: number }, seed?: number) {
    this.ch = compile(def, seed);
    this.d = new Driver(def, at, seed);
    void view.loadChapter(this.ch);
    const snap = this.d.snap;
    for (const e of this.d.events) view.onEvent(e, snap);
    view.onReset(snap);
    this.prev = snap;
  }
  /** 推进 n tick（每 tick 分发事件），然后渲染一帧。 */
  step(n: number, render = true): SimSnapshot {
    for (let i = 0; i < n; i++) {
      const evs = this.d.stepOne();
      const snap = this.d.snap;
      for (const e of evs) this.view.onEvent(e, snap);
      if (i < n - 1) this.prev = snap;
    }
    const next = this.d.snap;
    if (render) this.view.frame(this.prev, next, 1, n / 120);
    this.prev = next;
    return next;
  }
}
