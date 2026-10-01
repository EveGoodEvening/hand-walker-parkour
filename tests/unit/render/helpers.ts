// tests/unit/render/helpers.ts —— WP3 单元测试工具：在 Node 里造一个够用的 ViewContext（没有 WebGL，纹理是 1×1 白）。
import * as THREE from 'three';
import type { QualityProfile, ViewContext } from '../../../src/core/contracts';
import { EventBus } from '../../../src/core/bus';
import { resolveQuality } from '../../../src/core/quality';
import { createRng } from '../../../src/core/rng';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import { ChapterSurfaces } from '../../../src/core/surfaces';
import type { QualityTier, SimSnapshot } from '../../../src/core/types';
import { LampField } from '../../../src/render/lampField';
import { HwMaterials } from '../../../src/render/materials';
import { HwTextureBank } from '../../../src/render/textureBank';

export function fakeCtx(tier: QualityTier = 'low'): ViewContext & { lampField: LampField } {
  const lamps = new LampField();
  const quality: QualityProfile = resolveQuality(tier);
  const ctx = {
    renderer: null as never, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 240),
    overlayRoot: null as never, bus: new EventBus(), settings: { ...DEFAULT_SETTINGS }, quality, rngFx: createRng(1, 'fx'), stencil: true,
    mat: new HwMaterials(lamps), lamps, tex: new HwTextureBank(quality.texSize), rig: null as never, surfaces: new ChapterSurfaces(), solver: null as never,
    lampField: lamps,
  };
  return ctx as unknown as ViewContext & { lampField: LampField };
}

/** 画面系统只读到的快照字段。 */
export function snap(o: { s: number; t: number; segIndex: number; segKind?: 'run' | 'still' | 'stand'; floorY?: number; still?: { t: number; variant: string; set?: string; held?: number } | null }): SimSnapshot {
  return {
    tick: Math.round(o.t * 120), t: o.t, chapter: 'ch1', segment: '', segIndex: o.segIndex, segKind: o.segKind ?? 'run', segBeat: 0,
    checkpoint: { segment: '', beat: 0 },
    player: { s: o.s, x: 0, y: 0, floorY: o.floorY ?? 0, lane: 0, laneTarget: 0, mode: 'crawl', modeT: 0, speed: 5, cadence: 5, stride: 1, beat: 0,
      airT: 0, duck: 0, twitch: 0, drift: 0, steady: 3, steadyMax: 3, graceT: 0, surface: 'terrazzo',
      hitbox: { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }, lookBack: 0, carrying: 'none', stand: null },
    follower: { mode: 'hidden', voice: 'none', hud: 'none', from: 'behind', lagBeats: 0, distance: 0, leaderS: null, leaderLane: null },
    still: o.still ? { set: (o.still.set ?? 'deskFeet') as never, variant: o.still.variant, t: o.still.t, duration: 10, prompt: null, held: o.still.held ?? 0 } : null,
    hush: false, flip: false, slowOption: false, stats: { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, beatsFired: [],
  } as SimSnapshot;
}

export function triCount(g: THREE.BufferGeometry | undefined): number {
  if (!g) return 0;
  return (g.getAttribute('position')?.count ?? 0) / 3;
}

/** 数一个 Object3D 里会产生 draw call 的网格。 */
export function meshCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
}
