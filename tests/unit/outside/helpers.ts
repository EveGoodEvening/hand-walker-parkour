// tests/unit/outside/helpers.ts —— WP4 单元测试工具：合成的段、kit 上下文、ViewContext 桩（CORE 的 Flat* 回落实现）。
import * as THREE from 'three';
import type { KitChunkContext, Opening, QualityProfile, ViewContext } from '../../../src/core/contracts';
import { CHUNK_LEN } from '../../../src/core/constants';
import { EventBus } from '../../../src/core/bus';
import { FlatLampField, FlatMaterials, FlatTextureBank } from '../../../src/core/fallbacks';
import { resolveQuality } from '../../../src/core/quality';
import { createRng } from '../../../src/core/rng';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import type { AtmosphereId, KitId, QualityTier, SimSnapshot } from '../../../src/core/types';
import type { CompiledObstacle, CompiledSegment, CompiledSurface, EventBody, RunSegmentDef } from '../../../src/levels/schema';
import { OBSTACLES, type ObstacleKind } from '../../../src/levels/obstacles';
import { presetOf, screenColor, screenColorBasic } from '../../../src/render/kits/outside/lib/tone';

export const TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

export function obstacle(kind: ObstacleKind, s0: number): CompiledObstacle {
  const sp = OBSTACLES[kind];
  return { id: 0, kind, cls: sp.cls, archetype: sp.archetype, lanes: [-1, 0, 1], beat: 0, s0, s1: s0 + sp.depth, y0: sp.y0, y1: sp.y1, halfW: sp.halfW,
    behavior: { type: 'static' }, npc: false, params: {} };
}

export function mirror(id: string, side: 'L' | 'R', s0: number, s1: number, y: [number, number] = [0.3, 2.2], backdrop?: CompiledSurface['backdrop']): CompiledSurface {
  const s: CompiledSurface = { id, kind: 'mirror', side, from: 0, to: 0, y, s0, s1, plane: side === 'L' ? [1, 0, 0, 1.8] : [-1, 0, 0, 1.8] };
  if (backdrop) s.backdrop = backdrop;
  return s;
}

/** 各户外变体在第三到五章里用的氛围（§4.3–4.5、§5.2）。 */
export function kitAtmosphere(kit: KitId, variant: string): AtmosphereId {
  if (kit === 'track') return 'overcast';
  if (kit === 'plaza') return variant === 'gray' ? 'dreamGray' : 'dream';
  return variant === 'dawn' ? 'dawn' : 'rainNight';
}

export interface SegOpts {
  kit: KitId; variant: string; s0?: number; beats?: number; stride?: number; atmosphere?: AtmosphereId;
  obstacles?: CompiledObstacle[]; surfaces?: CompiledSurface[]; events?: Array<{ at: number; id?: string; body: EventBody }>;
}
export function segment(o: SegOpts): CompiledSegment {
  const s0 = o.s0 ?? 100, stride = o.stride ?? 1.1, beats = o.beats ?? 60;
  const atmosphere = o.atmosphere ?? kitAtmosphere(o.kit, o.variant);
  const def: RunSegmentDef = { id: `t-${o.kit}-${o.variant}`, kind: 'run', kit: o.kit, variant: o.variant, atmosphere, surface: 'asphaltWet',
    beats, stride, cadence: 5, follower: { mode: 'absent' } };
  return {
    def, index: 0, kind: 'run', s0, s1: s0 + beats * stride, stride,
    cadenceAt: () => 5, timeAt: (b) => b / 5, beatAt: (t) => t * 5, floorY: () => 0,
    obstacles: o.obstacles ?? [], surfaces: o.surfaces ?? [], windows: [], npcGroups: [], events: o.events ?? [], checkpoints: [0],
  };
}

export function openingsOf(seg: CompiledSegment, s0: number, s1: number): Opening[] {
  return seg.surfaces.filter((s) => (s.side === 'L' || s.side === 'R') && s.s0 < s1 && s.s1 > s0)
    .map((s) => ({ side: s.side as 'L' | 'R', s0: s.s0, s1: s.s1, y0: s.y?.[0] ?? 0.2, y1: s.y?.[1] ?? 1.8, surfaceId: s.id }));
}

/** 按 World 的切法把一段切成 12 m 的 chunk，逐个交给 fn。 */
export function chunkContexts(seg: CompiledSegment, tier: QualityTier): KitChunkContext[] {
  const out: KitChunkContext[] = [];
  const q: QualityProfile = resolveQuality(tier, 1);
  const n = Math.ceil((seg.s1 - seg.s0) / CHUNK_LEN - 1e-6);
  for (let i = 0; i < n; i++) {
    const a = seg.s0 + i * CHUNK_LEN, b = Math.min(seg.s1, a + CHUNK_LEN);
    out.push({ seg, variant: (seg.def as RunSegmentDef).variant, s0: a, s1: b, stride: seg.stride, floorY: () => 0,
      openings: openingsOf(seg, a, b), quality: q, rng: createRng(7, `chunk:${seg.def.id}:${i}`), mat: new FlatMaterials(), tex: new FlatTextureBank(q.texSize) });
  }
  return out;
}

export function viewContext(tier: QualityTier = 'low', stencil = true): ViewContext {
  const quality = resolveQuality(tier, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e1419, 4, 26);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 240);
  const ctx = {
    renderer: null as unknown as THREE.WebGLRenderer, scene, camera, overlayRoot: null as unknown as HTMLElement,
    bus: new EventBus(), settings: { ...DEFAULT_SETTINGS }, quality, rngFx: createRng(1, 'fx'), stencil,
    mat: new FlatMaterials(), lamps: new FlatLampField(), tex: new FlatTextureBank(quality.texSize),
    rig: null as never, surfaces: { list: () => [], get: () => undefined, openingsIn: () => [] }, solver: { solve: () => null },
  } satisfies ViewContext;
  return ctx;
}

/** 最小的快照（只填 WP4 用到的字段）。 */
export function snapshot(o: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 0, t: 0, chapter: 'ch3', segment: 's', segIndex: 0, segKind: 'run', segBeat: 0, checkpoint: { segment: 's', beat: 0 },
    player: { s: 0, x: 0, y: 0, floorY: 0, lane: 0, laneTarget: 0, mode: 'crawl', modeT: 0, speed: 5, cadence: 5, stride: 1.1, beat: 0, airT: 0, duck: 0,
      twitch: 0, drift: 0, steady: 3, steadyMax: 3, graceT: 0, surface: 'asphaltWet', hitbox: { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }, lookBack: 0,
      carrying: 'none', stand: null },
    follower: { mode: 'behind', voice: 'echo', hud: 'dots', from: 'behind', lagBeats: 0.5, distance: 0, leaderS: null, leaderLane: null },
    still: null, hush: false, flip: false, slowOption: false, stats: { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, beatsFired: [],
    ...o,
  };
}

/** 线性 → sRGB 十六进制（顶点色存的是线性值）。 */
export function linToHex(r: number, g: number, b: number): number {
  const f = (v: number) => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** 几何体里全部顶点色（sRGB 十六进制，去重）。 */
export function vertexColors(g: THREE.BufferGeometry | undefined): number[] {
  if (!g) return [];
  const c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!c) return [];
  const set = new Set<number>();
  for (let i = 0; i < c.count; i++) set.add(linToHex(c.getX(i), c.getY(i), c.getZ(i)));
  return [...set];
}

/**
 * 几何体在画面上的颜色（sRGB 十六进制，去重）：Lambert = 顶点色 × 氛围的半球光 + 平行光（按顶点法线）→ Neutral → sRGB；
 * basic = 顶点色 → Neutral → sRGB。雾与 LampField 不计（§5.1 的色板就是这个口径）。
 */
export function screenColors(g: THREE.BufferGeometry | undefined, atmo: AtmosphereId, kind: 'lambert' | 'basic'): number[] {
  if (!g) return [];
  const c = g.getAttribute('color') as THREE.BufferAttribute | undefined, n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!c) return [];
  const p = presetOf(atmo);
  const set = new Set<number>();
  const enc = (v: readonly number[]) => {
    const f = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
    return (f(v[0] as number) << 16) | (f(v[1] as number) << 8) | f(v[2] as number);
  };
  for (let i = 0; i < c.count; i++) {
    const a = [c.getX(i), c.getY(i), c.getZ(i)] as const;
    set.add(enc(kind === 'basic' || !n ? screenColorBasic(a) : screenColor(a, p, [n.getX(i), n.getY(i), n.getZ(i)])));
  }
  return [...set];
}
