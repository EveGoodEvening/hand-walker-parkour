// tests/unit/actors/helpers.ts —— WP5 单元测试工具：最小 ViewContext、合成快照。
import * as THREE from 'three';
import type { ViewContext } from '../../../src/core/contracts';
import { FlatLampField, FlatMaterials, FlatTextureBank } from '../../../src/core/fallbacks';
import { resolveQuality } from '../../../src/core/quality';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import type { QualityTier, SimSnapshot } from '../../../src/core/types';
import type { CrawlInput } from '../../../src/render/actors/handCycle';

export function fakeCtx(tier: QualityTier = 'low', stencil = true): ViewContext {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 240);
  const ctx = {
    renderer: null as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), camera, overlayRoot: null as unknown as HTMLElement,
    bus: { on: () => () => undefined, emit: () => undefined }, settings: { ...DEFAULT_SETTINGS }, quality: resolveQuality(tier, 1),
    rngFx: null as never, stencil, mat: new FlatMaterials(), lamps: new FlatLampField(), tex: new FlatTextureBank(64),
    rig: null as never, surfaces: { list: () => [], get: () => undefined, openingsIn: () => [] }, solver: { solve: () => null },
  };
  return ctx as unknown as ViewContext;
}

export function crawlInput(o: Partial<CrawlInput> = {}): CrawlInput {
  return { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 5, speed: 5, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0, ...o };
}

/** 合成一份跑段快照。 */
export function snap(o: { s?: number; x?: number; lane?: -1 | 0 | 1; beat?: number; t?: number; y?: number; duck?: number; lookBack?: number; mode?: SimSnapshot['player']['mode']; speed?: number; segKind?: 'run' | 'still' | 'stand' } = {}): SimSnapshot {
  const lane = o.lane ?? 0;
  return {
    tick: Math.round((o.t ?? 0) * 120), t: o.t ?? 0, chapter: 'test', segment: 't-1', segIndex: 0, segKind: o.segKind ?? 'run', segBeat: o.beat ?? 0,
    checkpoint: { segment: 't-1', beat: 0 },
    player: {
      s: o.s ?? 0, x: o.x ?? lane * 1.1, y: o.y ?? 0, floorY: 0, lane, laneTarget: lane, mode: o.mode ?? 'crawl', modeT: 0,
      speed: o.speed ?? 5, cadence: 5, stride: 1, beat: o.beat ?? 0, airT: 0, duck: o.duck ?? 0, twitch: 0, drift: 0, steady: 3, steadyMax: 3,
      graceT: 0, surface: 'terrazzo', hitbox: { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }, lookBack: o.lookBack ?? 0, carrying: 'none', stand: null,
    },
    follower: { mode: 'behind', voice: 'echo', hud: 'dots', from: 'behind', lagBeats: 0.5, distance: 0, leaderS: null, leaderLane: null },
    still: null, hush: false, flip: false, slowOption: false,
    stats: { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, beatsFired: [],
  };
}
