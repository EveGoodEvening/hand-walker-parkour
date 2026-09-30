// src/render/weather/preview.ts —— WP4 的截图画廊（调试扩展 __game.ext.wp4，只在 ?test=1 / ?debug= 下可用）。
// tests/visual/WP4.json 用它逐个拍全部 kit 变体与 set：不依赖第三到五章的关卡数据（WP2 并行开发），也不依赖 WP3 的正式 World。
//   __game.ext.wp4('kit', kit, variant, opts?)  在玩家旁边 400 m 处按一段合成的关卡数据建 chunk，用追尾机位（或站立机位）看。
//   __game.ext.wp4('set', set, variant, opts?)  建一个 set，用 CORE 机位表里的静场机位看；opts.t 是静场时间（动画）。
//   __game.ext.wp4('scene', ch, seg, beat, ticks, fallback?)  先试真实章节（集成后可用）；章节还没实现时回落到画廊。
//   __game.ext.wp4('off')                         撤掉预览。
// 预览系统 order 95（在镜头 60 之后）：覆盖镜头、雾、背景、光与 LampField 的增益 / 颜色；wp4.outdoor 负责雨、天、栏杆红光。
// 预览时新建几何体（调试用），正式游戏过程中不会调用。
import * as THREE from 'three';
import type { KitChunkContext, Opening, ViewContext, ViewSystem } from '../../core/contracts';
import { CHUNK_LEN, RENDER_ORDER } from '../../core/constants';
import { FALLBACK_ATMOSPHERES } from '../../core/fallbacks';
import { getAtmosphere, getKit, getSet, registerDebug, registerViewSystem, type AtmospherePreset } from '../../core/registry';
import { createRng } from '../../core/rng';
import type { AtmosphereId, KitId, Lane, SetId, SimSnapshot } from '../../core/types';
import type { CompiledObstacle, CompiledSegment, CompiledSurface, EventBody, RunSegmentDef } from '../../levels/schema';
import { OBSTACLES, type ObstacleKind } from '../../levels/obstacles';
import { C } from '../kits/outside/lib/colors';
import { OGeo, triCount } from '../kits/outside/lib/geo';
import { LIVE_SETS } from '../sets/outside/lib/live';
import { crawlerFigure } from '../sets/outside/lib/setkit';
import { outdoor, skyKindFor } from './outdoor';

export const PREVIEW_X = 400;

interface KitPreset { stride: number; atmo: AtmosphereId; rain: number; beats: number; beat: number; data: (s0: number, stride: number) => Partial<Pick<CompiledSegment, 'obstacles' | 'events' | 'surfaces'>> }

const ob = (kind: ObstacleKind, s0: number, lanes: Lane[] = [-1, 0, 1]): CompiledObstacle => {
  const sp = OBSTACLES[kind];
  return { id: 0, kind, cls: sp.cls, archetype: sp.archetype, lanes, beat: 0, s0, s1: s0 + sp.depth, y0: sp.y0, y1: sp.y1, halfW: sp.halfW,
    behavior: { type: 'static' }, npc: false, params: {} };
};
const ev = (at: number, body: EventBody, id?: string) => (id ? { at, id, body } : { at, body });

/** 每个变体的合成数据：让按数据摆放的陈设（校门、车棚、涂鸦、门卫室、镜子、水）出现在镜头前方。 */
export const KIT_PRESETS: Record<string, KitPreset> = {
  'street.schoolGate': { stride: 1.0, atmo: 'rainNight', rain: 0.3, beats: 60, beat: 12, data: (s0, st) => ({ obstacles: [ob('gateBar', s0 + 22 * st), ob('gateBar', s0 + 28 * st)] }) },
  'street.alley': { stride: 1.1, atmo: 'rainNight', rain: 0.6, beats: 70, beat: 6, data: () => ({ events: [ev(14, { type: 'ambience', amb: 'shedRoof', level: 1, seconds: 1 }), ev(44, { type: 'ambience', amb: 'rainStreet', level: 1, seconds: 1 })] }) },
  'street.shopStreet': { stride: 1.1, atmo: 'rainNight', rain: 0.6, beats: 70, beat: 6, data: () => ({ events: [ev(14, { type: 'text', line: 'c1.card' }, 'graffitiHand')] }) },
  'street.compound': { stride: 1.0, atmo: 'rainNight', rain: 0.6, beats: 36, beat: 4, data: (s0, st) => ({ obstacles: [ob('barrierArm', s0 + 14 * st)] }) },
  'street.dawn': { stride: 1.1, atmo: 'dawn', rain: 0, beats: 60, beat: 4, data: (s0, st) => ({ obstacles: [ob('barrierArm', s0 + 10 * st)] }) },
  'plaza.bright': { stride: 1.5, atmo: 'dream', rain: 0, beats: 50, beat: 4, data: () => ({}) },
  'plaza.gray': { stride: 1.3, atmo: 'dreamGray', rain: 0, beats: 40, beat: 8, data: (s0, st) => ({ surfaces: [mirrorSurface('bigMirror', 'R', s0 + 16 * st, s0 + 24 * st)] }) },
  'track.default': { stride: 1.0, atmo: 'overcast', rain: 0, beats: 60, beat: 4, data: () => ({}) },
};

function mirrorSurface(id: string, side: 'L' | 'R', s0: number, s1: number): CompiledSurface {
  return { id, kind: 'mirror', side, from: 0, to: 0, y: [0.1, 2.6], s0, s1, plane: side === 'L' ? [1, 0, 0, 1.8] : [-1, 0, 0, 1.8] };
}

interface SetShot { pos: [number, number, number]; look: [number, number, number]; fov: number }
/** 与 CORE 的 render/camera/shots.ts（2026-09-30，WP5 之后会细化）一致的静场机位；这里复制一份，不 import 别的包。 */
export const SET_SHOTS: Record<string, SetShot> = {
  busWindow: { pos: [0.3, 1.1, 0.6], look: [-1.5, 1.1, -0.5], fov: 58 },
  homeCrawl: { pos: [0, 0.5, 1.8], look: [0, 0.3, -2], fov: 62 },
  bathroomMirror: { pos: [0, 1.2, 1.3], look: [0, 1.3, -1.5], fov: 55 },
  palmEye: { pos: [0, 0.8, 0.5], look: [0, 0.8, -0.5], fov: 45 },
  waterDown: { pos: [0, 1.2, 0.6], look: [0, 0, -0.4], fov: 55 },
  ceilingCrack: { pos: [0, 0.6, 0], look: [0, 3, -0.3], fov: 60 },
  bedFeet: { pos: [0, 0.9, 1.2], look: [0, 0.4, -1], fov: 58 },
  infirmaryBed: { pos: [0.6, 1.0, 1.0], look: [-0.5, 0.7, -1], fov: 58 },
};
export const SET_PRESETS: Record<string, { shot: string; atmo: AtmosphereId }> = {
  'bus.default': { shot: 'busWindow', atmo: 'busNight' }, 'home.default': { shot: 'homeCrawl', atmo: 'homeDark' },
  'bathroom.default': { shot: 'bathroomMirror', atmo: 'homeDark' }, 'palmEye.default': { shot: 'palmEye', atmo: 'dream' },
  'water.default': { shot: 'waterDown', atmo: 'dreamGray' }, 'bedroom.feet': { shot: 'bedFeet', atmo: 'homeDark' },
  'bedroom.ceiling': { shot: 'ceilingCrack', atmo: 'homeDark' }, 'infirmary.bed': { shot: 'infirmaryBed', atmo: 'fluorescent' },
  'infirmary.ceiling': { shot: 'ceilingCrack', atmo: 'fluorescent' },
};

export interface KitOpts {
  beat?: number; lane?: Lane; atmo?: AtmosphereId; rain?: number; stand?: boolean; lookBack?: boolean; t?: number; figure?: boolean; lit?: number;
  /** 像 World 一样只显示身后 1 个、前方 chunksAhead 个 chunk（缺省 true），整帧 draw call 与游戏里一致。 */
  stream?: boolean;
  /** 预览时间跟着模拟时间走（动画、雨；内存检查用）。 */
  live?: boolean;
}
export interface SetOpts { t?: number; shot?: string; atmo?: AtmosphereId; prompt?: string | null; held?: number; breakAt?: number; look?: [number, number, number]; pos?: [number, number, number]; live?: boolean }

interface Active {
  group: THREE.Group; geos: THREE.BufferGeometry[]; atmo: AtmosphereId; cam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number | null };
  t: number; setId: SetId | null; variant: string; setOpts: SetOpts | null; stats: Record<string, unknown>;
  /** 检查用的补光倍数（夜景在 CORE 桩下几乎全黑；1 = 如实）。 */
  lit: number;
  /** live：预览时间 = t0 + (模拟时间 − 开始时的模拟时间)。 */
  live: { simT0: number; t0: number } | null;
  /** 预览的雨强（游戏里的 goto / retry 会按关卡数据复原雨强，预览每帧再设回来）。 */
  rain: number;
}

function presetOf(id: AtmosphereId): AtmospherePreset { return getAtmosphere(id) ?? FALLBACK_ATMOSPHERES[id]; }

export class Preview implements ViewSystem {
  readonly id = 'wp4.preview';
  readonly owner = 'WP4' as const;
  readonly order = 95;
  ctx!: ViewContext;
  active: Active | null = null;
  private last: SimSnapshot | null = null;

  init(ctx: ViewContext): void { this.ctx = ctx; }

  off(): void {
    if (!this.active) return;
    this.ctx.scene.remove(this.active.group);
    for (const g of this.active.geos) g.dispose();
    // set 预览：set.build 建的几何体也一并释放（只有预览会这样反复建）
    if (this.active.setId) this.active.group.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose(); });
    this.ctx.lamps.removeLamps('wp4.preview');
    this.active = null;
    outdoor.preview = null;
    for (const l of LIVE_SETS.values()) l.prune();
  }

  /** 按一段合成的关卡数据建某个 kit 变体的 chunk。 */
  kit(kitId: KitId, variant: string, o: KitOpts = {}): Record<string, unknown> {
    this.off();
    const key = `${kitId}.${variant}`;
    const pr = KIT_PRESETS[key];
    if (!pr) throw new Error(`wp4 preview: unknown kit variant ${key}`);
    const kit = getKit(kitId);
    if (!kit) throw new Error(`wp4 preview: kit ${kitId} not registered`);
    const ps = this.last?.player.s ?? 0;
    const s0 = Math.floor(ps) - 14, stride = pr.stride, s1 = s0 + pr.beats * stride;
    const data = pr.data(s0, stride);
    const def: RunSegmentDef = { id: `wp4preview-${key}`, kind: 'run', kit: kitId, variant, atmosphere: o.atmo ?? pr.atmo, surface: 'asphaltWet',
      beats: pr.beats, stride, cadence: 5, follower: { mode: 'absent' } };
    const seg: CompiledSegment = {
      def, index: 0, kind: 'run', s0, s1, stride,
      cadenceAt: () => 5, timeAt: (b) => b / 5, beatAt: (t) => t * 5, floorY: () => 0,
      obstacles: data.obstacles ?? [], surfaces: data.surfaces ?? [], windows: [], npcGroups: [],
      events: data.events ?? [], checkpoints: [0],
    };
    const openings: Opening[] = seg.surfaces.filter((s) => s.side === 'L' || s.side === 'R')
      .map((s) => ({ side: s.side as 'L' | 'R', s0: s.s0, s1: s.s1, y0: s.y?.[0] ?? 0.2, y1: s.y?.[1] ?? 1.8, surfaceId: s.id }));
    const group = new THREE.Group();
    group.name = 'wp4.preview';
    const geos: THREE.BufferGeometry[] = [];
    const matFloor = this.ctx.mat.lambert({ vertexColors: true, flat: true });
    matFloor.depthWrite = false;
    const matStatic = this.ctx.mat.lambert({ vertexColors: true, flat: true });
    const matEmi = this.ctx.mat.basic({ color: 0xffffff });
    matEmi.vertexColors = true;
    const perChunk: Array<{ s0: number; calls: number; tris: number }> = [];
    const lamps = [];
    const n = Math.ceil((s1 - s0) / CHUNK_LEN - 1e-6);
    for (let i = 0; i < n; i++) {
      const a = s0 + i * CHUNK_LEN, b = Math.min(s1, a + CHUNK_LEN);
      const kc: KitChunkContext = { seg, variant, s0: a, s1: b, stride, floorY: () => 0,
        openings: openings.filter((q) => q.s0 < b && q.s1 > a), quality: this.ctx.quality, rng: createRng(7, `wp4preview:${key}:${i}`), mat: this.ctx.mat, tex: this.ctx.tex };
      const chunk = kit.build(kc);
      const cg = new THREE.Group();
      cg.position.set(PREVIEW_X, 0, -a);
      const fm = new THREE.Mesh(chunk.floor, matFloor);
      fm.renderOrder = RENDER_ORDER.floor;
      cg.add(fm, new THREE.Mesh(chunk.static, matStatic));
      geos.push(chunk.floor, chunk.static);
      if (chunk.emissive) { cg.add(new THREE.Mesh(chunk.emissive, matEmi)); geos.push(chunk.emissive); }
      group.add(cg);
      perChunk.push({ s0: a, calls: cg.children.length, tris: triCount(chunk.floor) + triCount(chunk.static) + triCount(chunk.emissive) });
      cg.userData.s0 = a; cg.userData.s1 = b;
      for (const l of chunk.lamps) lamps.push({ ...l, x: l.x + PREVIEW_X });
    }
    this.ctx.lamps.addLamps('wp4.preview', lamps);
    // 比例参照：一个趴着的人（没有五官）
    const lane = o.lane ?? 0;
    const beat = o.beat ?? pr.beat;
    const sv = s0 + beat * stride;
    if (o.figure !== false && !o.stand) {
      const fg = new OGeo();
      crawlerFigure(fg, PREVIEW_X + lane * 1.1, -sv, 0, C.uniform, C.skin, 0.9);
      const geo = fg.build();
      geos.push(geo);
      group.add(new THREE.Mesh(geo, matStatic));
    }
    // 流式显示：身后 1 个 chunk、前方 chunksAhead 个（与 World 相同）
    if (o.stream !== false) {
      const ahead = this.ctx.quality.chunksAhead * CHUNK_LEN;
      for (const c of group.children) {
        const u = c.userData as { s0?: number; s1?: number };
        if (u.s0 !== undefined && u.s1 !== undefined) c.visible = u.s1 > sv - CHUNK_LEN && u.s0 < sv + ahead;
      }
    }
    this.ctx.scene.add(group);
    const x = PREVIEW_X + lane * 1.1;
    const cam = o.stand
      ? { pos: new THREE.Vector3(x, 1.62, -sv + 1.9), look: new THREE.Vector3(x, 1.5, -sv - 8), fov: 55 }
      : { pos: new THREE.Vector3(PREVIEW_X + 0.7 * lane * 1.1, 0.92, -sv + 2.35), look: new THREE.Vector3(PREVIEW_X + 0.42 * lane * 1.1, 0.45, -sv - 7), fov: null };
    if (o.lookBack) {
      const px = x, pz = -sv, rot = (160 * Math.PI) / 180;
      for (const v of [cam.pos, cam.look]) { const dx = v.x - px, dz = v.z - pz; v.x = px + dx * Math.cos(rot) + dz * Math.sin(rot); v.z = pz - dx * Math.sin(rot) + dz * Math.cos(rot); }
    }
    const atmo = o.atmo ?? pr.atmo;
    const t = o.t ?? 2.5;
    outdoor.level.snap(o.rain ?? pr.rain);
    const sweepS = key === 'street.compound' ? (data.obstacles?.[0]?.s0 ?? null) : null;
    outdoor.preview = { sky: skyKindFor(atmo), sweepS, offsetX: PREVIEW_X, t };
    const stats = { kind: 'kit', key, chunks: perChunk.length, maxCallsPerChunk: Math.max(...perChunk.map((c) => c.calls)),
      maxTrisPerChunk: Math.max(...perChunk.map((c) => c.tris)), lamps: lamps.length, tier: this.ctx.quality.tier, rainLines: outdoor.rain.lineCount };
    this.active = { group, geos, atmo, cam, t, setId: null, variant, setOpts: null, stats, lit: o.lit ?? 1, live: o.live ? { simT0: this.last?.t ?? 0, t0: t } : null, rain: o.rain ?? pr.rain };
    return stats;
  }

  /** 建一个 set，用静场机位看。 */
  set(setId: SetId, variant: string, o: SetOpts = {}): Record<string, unknown> {
    this.off();
    const key = `${setId}.${variant}`;
    const pr = SET_PRESETS[key];
    if (!pr) throw new Error(`wp4 preview: unknown set variant ${key}`);
    const set = getSet(setId);
    if (!set || set.id !== setId) throw new Error(`wp4 preview: set ${setId} not registered`);
    const root = set.build(this.ctx, variant);
    const group = new THREE.Group();
    group.name = 'wp4.preview';
    const oz = -(this.last?.player.s ?? 0);
    group.position.set(PREVIEW_X, 0, oz);
    group.add(root);
    this.ctx.scene.add(group);
    const sh = SET_SHOTS[o.shot ?? pr.shot] as SetShot;
    const pos = o.pos ?? sh.pos, look = o.look ?? sh.look;
    const cam = { pos: new THREE.Vector3(PREVIEW_X + pos[0], pos[1], oz + pos[2]), look: new THREE.Vector3(PREVIEW_X + look[0], look[1], oz + look[2]), fov: sh.fov };
    let calls = 0;
    root.traverseVisible((c) => { if ((c as THREE.Mesh).isMesh) calls++; });
    outdoor.level.snap(0);
    outdoor.preview = { sky: null, sweepS: null, offsetX: PREVIEW_X, t: o.t ?? 0 };
    const stats = { kind: 'set', key, drawCalls: calls, surfaces: set.surfaces?.(variant).map((s) => s.id) ?? [], stencil: this.ctx.stencil };
    this.active = { group, geos: [], atmo: o.atmo ?? pr.atmo, cam, t: o.t ?? 0, setId, variant, setOpts: o, stats, lit: 1,
      live: o.live ? { simT0: this.last?.t ?? 0, t0: o.t ?? 0 } : null, rain: 0 };
    if (o.breakAt !== undefined) this.ctx.bus.emit('cue', { id: 'waterBreaks', body: { type: 'beat' }, segment: 'wp4preview' });
    return stats;
  }

  frame(_prev: SimSnapshot, next: SimSnapshot): void {
    this.last = next;
    const a = this.active;
    if (!a) return;
    const ctx = this.ctx;
    if (a.live) { a.t = a.live.t0 + Math.max(0, next.t - a.live.simT0); if (outdoor.preview) outdoor.preview.t = a.t; }
    if (Math.abs(outdoor.level.target - a.rain) > 1e-6) outdoor.level.snap(a.rain);
    // 镜头
    const cam = ctx.camera;
    cam.position.copy(a.cam.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(a.cam.look);
    const aspect = cam.aspect || 16 / 9;
    const fov = a.cam.fov ?? Math.max(50, Math.min(62, (2 * Math.atan(Math.tan((76 * Math.PI) / 360) / aspect) * 180) / Math.PI));
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // 氛围
    const p = presetOf(a.atmo);
    const fog = ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog : null;
    if (fog) { fog.color.setHex(p.fog.color); fog.near = p.fog.near; fog.far = Math.max(p.fog.near + 1, p.fog.far * ctx.quality.fogMul); }
    if (ctx.scene.background instanceof THREE.Color) ctx.scene.background.setHex(p.background);
    else ctx.scene.background = new THREE.Color(p.background);
    for (const o of ctx.scene.children) {
      if (o instanceof THREE.HemisphereLight) {
        // 检查用补光：夜景在 CORE 桩下没有 LampField，Lambert 几乎全黑；lit > 1 时把半球光换成中性灰再放大
        if (a.lit > 1) { o.color.setHex(0xb8c4cc); o.groundColor.setHex(0x5a646a); o.intensity = 0.3 * a.lit; }
        else { o.color.setHex(p.hemi.sky); o.groundColor.setHex(p.hemi.ground); o.intensity = p.hemi.intensity; }
      }
      else if (o instanceof THREE.DirectionalLight) {
        o.color.setHex(p.dir?.color ?? 0xffffff); o.intensity = (p.dir?.intensity ?? 0) * a.lit + (a.lit > 1 ? 0.3 * a.lit : 0);
        const d = p.dir?.dir ?? [0.3, -1, -0.55];
        o.position.set(-d[0], -d[1], -d[2]).normalize().multiplyScalar(10);   // 目标留在原点（与 World 的做法一致）
      }
    }
    const u = ctx.lamps.uniforms;
    u.uLampGain.value = p.lampGain; u.uLampColor.value.setHex(p.lampColor); u.uChalk.value = p.chalkMin;
    // set 动画
    if (a.setId) {
      const so = a.setOpts ?? {};
      const still = { set: a.setId, variant: a.variant, t: a.t, duration: 12, prompt: (so.prompt ?? null) as never, held: so.held ?? 0 };
      let simT = next.t;
      if (so.breakAt !== undefined) simT = next.tick / 120 + (a.t - so.breakAt);
      LIVE_SETS.get(a.setId)?.update(a.t, { ...next, t: simT, still } as SimSnapshot, a.variant);
    }
  }
}

export const preview = new Preview();
registerViewSystem(preview);

type GameHook = { start(ch: string, o: { segment?: string; beat?: number; skipCards?: boolean }): Promise<void>; step(n: number): unknown };

registerDebug('wp4', async (...args: unknown[]) => {
  const [cmd, a, b, c, d, e] = args as [string, unknown, unknown, unknown, unknown, unknown];
  if (cmd === 'off') { preview.off(); return { ok: true }; }
  if (cmd === 'kit') return preview.kit(a as KitId, b as string, (c ?? {}) as KitOpts);
  if (cmd === 'set') return preview.set(a as SetId, b as string, (c ?? {}) as SetOpts);
  if (cmd === 'scene') {
    // 集成后：真实章节；章节还没实现（或段 id 不存在）时回落到画廊
    const g = (globalThis as { __game?: GameHook }).__game;
    try {
      if (!g) throw new Error('no __game');
      preview.off();
      await g.start(a as string, { segment: b as string, beat: c as number, skipCards: true });
      if (typeof d === 'number' && d > 0) g.step(d);
      return { mode: 'game' };
    } catch (err) {
      const fb = (e ?? null) as null | { kit?: [KitId, string, KitOpts?]; set?: [SetId, string, SetOpts?] };
      if (fb?.kit) return { mode: 'gallery', reason: String(err), ...preview.kit(fb.kit[0], fb.kit[1], fb.kit[2] ?? {}) };
      if (fb?.set) return { mode: 'gallery', reason: String(err), ...preview.set(fb.set[0], fb.set[1], fb.set[2] ?? {}) };
      return { mode: 'error', reason: String(err) };
    }
  }
  if (cmd === 'stats') return preview.active?.stats ?? null;
  throw new Error(`wp4: unknown command ${cmd}`);
});
