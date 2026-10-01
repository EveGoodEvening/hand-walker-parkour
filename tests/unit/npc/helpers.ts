// tests/unit/npc/helpers.ts —— WP6 单元测试工具：假的 ViewContext（CORE 回落材质）、用真 Sim 产生快照。
import * as THREE from 'three';
import type { ViewContext } from '../../../src/core/contracts';
import { FlatLampField, FlatMaterials, FlatTextureBank } from '../../../src/core/fallbacks';
import { resolveQuality } from '../../../src/core/quality';
import { createRng } from '../../../src/core/rng';
import type { KitId, QualityTier, SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, CompiledChapter, CompiledObstacle, NpcGroupDef } from '../../../src/levels/schema';
import { getChapter } from '../../../src/levels/chapters/index';
import { customStage, toStage, type Spec } from '../../../src/render/npc/stage';
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

/**
 * 实例化网格在世界坐标里的包围盒：按每个实例的变体过滤顶点（和顶点着色器的收拢规则相同：aHw.x ≥ 0 且与 iHw.x 不同的顶点不画）。
 * yMax / yMin 只统计这个高度范围内的顶点（例如玩家碰撞盒最高 0.85 m 以下的部分）。
 */
export function instancedBounds(meshes: readonly THREE.InstancedMesh[], o: { yMax?: number; yMin?: number; only?: (i: number, mesh: THREE.InstancedMesh) => boolean } = {}): THREE.Box3 {
  const box = new THREE.Box3(), v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    const pos = mesh.geometry.getAttribute('position'), hw = mesh.geometry.getAttribute('aHw'), ihw = mesh.geometry.getAttribute('iHw');
    for (let i = 0; i < mesh.count; i++) {
      if (o.only && !o.only(i, mesh)) continue;
      mesh.getMatrixAt(i, m);
      const variant = ihw.getX(i);
      for (let k = 0; k < pos.count; k++) {
        const vi = hw.getX(k);
        if (vi >= 0 && Math.abs(vi - variant) > 0.5) continue;
        v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(m);
        if (o.yMax !== undefined && v.y > o.yMax) continue;
        if (o.yMin !== undefined && v.y < o.yMin) continue;
        box.expandByPoint(v);
      }
    }
  }
  return box;
}

/**
 * 在测试章里搭一个只有给定障碍（没有路边的人）的舞台，渲染 steps 个 tick 之后的一帧。
 * 舞台固定在玩家前方 ahead 米处（follow = false），障碍按 specs 的 at 摆在舞台起点之后。
 */
export function stageView(tier: QualityTier, specs: Spec[], o: { ahead?: number; idBase?: number; steps?: number; kit?: KitId; groups?: NpcGroupDef[] } = {}): { view: ObstacleView; vd: ViewDriver; obstacles: CompiledObstacle[] } {
  const { view } = makeView(tier);
  const vd = new ViewDriver(view, getChapter('test') as ChapterDef, { segment: 't-1', beat: 1 });
  vd.d.sim.setInvincible(true);
  const snap = vd.step(1);
  const d = customStage(specs, snap.player.s + (o.ahead ?? 0), snap.player.floorY, { idBase: o.idBase ?? 900000, ...(o.kit ? { kit: o.kit } : {}), ...(o.groups ? { groups: o.groups } : {}) });
  view.setStage(toStage('forest', d, snap.t, snap.player.s, false));
  vd.step(o.steps ?? 1);
  return { view, vd, obstacles: d.obstacles };
}
