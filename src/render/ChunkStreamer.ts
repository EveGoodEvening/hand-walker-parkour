// src/render/ChunkStreamer.ts —— 世界：chunk 预建与流式显示、静场 set、氛围、LampField 驱动、地面贴花、黑板（DESIGN.md §5.2、§5.3、§5.9、§8.3，WP3）。
// 规则（§5.9、§10.1）：读章（开场卡期间）时建好本章全部几何体；游戏过程中不创建任何几何体或纹理，只切换可见性、写 uniform。
//   · WP3 的 kit：每个 kit 变体（同步幅、同楼梯坡度）预建 4 个通用变体，几何体在多个 chunk 之间共用；
//     段首段尾、带开口（镜、窗、端墙镜）或门牌 / 黑板的 chunk 按数据单独预建。
//     chunk 长度取整拍且为偶数拍（约 12 m），这样铜条（每拍）、灯管（每 2 拍）在通用变体之间严丝合缝。
//   · 别的包的 kit（WP4 户外、CORE 占位）：沿用 12 m 一个、逐个预建（它们可能按绝对里程摆东西）。
//   · 每个 chunk 最多 3 个网格（floor / static / emissive）= ≤ 3 次 draw call；可见的是身后 1 个 + 前方 chunksAhead 个。
// 静场：隐藏全部 chunk，显示对应 set（放在 STILL_ORIGIN）。站立段：显示为该段单独预建的几个 chunk。
// 画质切换（含自动档位在游玩 3 s 后的那一次）：只按新档位重建 chunk 几何体；灯的状态（LampField 按灯迁移）、
// 氛围过渡与 fog cue（AtmosphereMixer.setFogMul）、黑板（不随档位重建）全部保留。
import * as THREE from 'three';
import type { EnvKit, KitChunk, LampSpec, Opening, TextureBank, ViewContext, ViewSystem } from '../core/contracts';
import { CHUNK_LEN, LANE_WIDTH, RENDER_ORDER, STILL_ORIGIN } from '../core/constants';
import type { GameEvent } from '../core/events';
import { FALLBACK_ATMOSPHERES } from '../core/fallbacks';
import { clamp, lerp } from '../core/math';
import { getAtmosphere, getKit, getSet } from '../core/registry';
import { createRng } from '../core/rng';
import type { AtmosphereId, KitId, SetId, SimSnapshot } from '../core/types';
import type {
  CompiledChapter, CompiledSegment, CompiledSurface, EventBody, RunSegmentDef, StandSegmentDef, StillSegmentDef, SurfaceDef,
} from '../levels/schema';
import { lineText } from '../levels/lines';
import { AtmosphereMixer } from './atmosphere';
import { Board, BOARDS, boardMaterial } from './boards';
import { Decals, type DecalKind } from './decals';
import type { Rect } from './geom';
import { floorHints, usesSchoolAtlas, type HwKitChunkContext, type HwKitExt } from './kitContext';
import { LampField, patchSteadyGlow } from './lampField';
import { ATLAS, paintSchoolAtlas } from './textures/school';
import { makeCanvas } from './textures/common';
import type { HwTextureBank } from './textureBank';

const OPENING_KINDS = new Set<SurfaceDef['kind']>(['mirror', 'window', 'endMirror', 'carMirror']);
/** 校园贴图集的最小边长（px）：数据门牌占图集宽度的一半（textures/school.ts ATLAS.plates[0]），低画质也 ≥ 256 px。 */
export const ATLAS_MIN_SIZE = 512;
const GENERIC_VARIANTS = 4;
/** 预览段放在很远的地方，与章节内容互不相干。 */
export const PREVIEW_S0 = 20000;

interface Slot {
  seg: CompiledSegment; s0: number; s1: number; group: THREE.Group; gloss: number; tris: number; lamps: LampSpec[];
  generic: number;          // −1 = 专建
}
interface GeoSet { floor: THREE.BufferGeometry; static: THREE.BufferGeometry; emissive?: THREE.BufferGeometry; lamps: LampSpec[]; gloss: number; tris: number }
interface SetEntry { set: SetId; variant: string; obj: THREE.Object3D; update?: (t: number, snap: SimSnapshot) => void }

function presetOf(id: AtmosphereId) { return getAtmosphere(id) ?? FALLBACK_ATMOSPHERES[id]; }
function triCount(g: THREE.BufferGeometry | undefined): number {
  if (!g) return 0;
  return g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
}

/** 遍历一个事件体里嵌套的全部事件（stop / slow 的时间线）。 */
function* nested(b: EventBody): Generator<EventBody> {
  yield b;
  if ((b.type === 'stop' || b.type === 'slow') && b.timeline) for (const t of b.timeline) yield* nested(t as unknown as EventBody);
}
/** 一章里全部事件体（段事件、窗口 then、静场输入 onDone，含嵌套）。 */
export function allBodies(ch: CompiledChapter): EventBody[] {
  const out: EventBody[] = [];
  for (const seg of ch.segments) {
    for (const e of seg.events) out.push(...nested(e.body));
    for (const w of seg.windows) for (const t of w.then ?? []) out.push(...nested(t as unknown as EventBody));
    const inp = (seg.def as StillSegmentDef).input;
    for (const t of inp?.onDone ?? []) out.push(...nested(t as unknown as EventBody));
  }
  return out;
}

/**
 * 重来时要重放的事件体（按发生顺序）：检查点所在段之前的全部段，加上当前跑段 at ≤ segBeat 的部分。
 * 静场 / 站立段从头重来，当前段不重放。stop / slow 的时间线随父事件；回头窗口的 then 只在 auto（必然发生）时算；
 * 静场 input.onDone 只算之前的段。
 */
export function replayBodies(ch: CompiledChapter, segIndex: number, segBeat: number): Array<{ seg: CompiledSegment; body: EventBody }> {
  const out: Array<{ seg: CompiledSegment; body: EventBody; key: number; n: number }> = [];
  let n = 0;
  const push = (seg: CompiledSegment, key: number, b: EventBody) => { for (const x of nested(b)) out.push({ seg, body: x, key, n: n++ }); };
  for (const sg of ch.segments) {
    if (sg.index > segIndex) break;
    const current = sg.index === segIndex;
    if (current && sg.kind !== 'run') continue;
    for (const ev of sg.events) {
      if (current && ev.at > segBeat + 1e-6) continue;
      push(sg, ev.at, ev.body);
    }
    for (const w of sg.windows) {
      if (w.type !== 'lookBack' || !w.auto || (current && w.to > segBeat + 1e-6)) continue;
      for (const t of w.then ?? []) push(sg, w.to, t as unknown as EventBody);
    }
    if (!current) for (const t of (sg.def as StillSegmentDef).input?.onDone ?? []) push(sg, Number.MAX_SAFE_INTEGER, t as unknown as EventBody);
  }
  out.sort((a, b) => a.seg.index - b.seg.index || a.key - b.key || a.n - b.n);
  return out.map(({ seg, body }) => ({ seg, body }));
}

export function openingsOf(surfaces: readonly CompiledSurface[], s0: number, s1: number): Opening[] {
  const out: Opening[] = [];
  for (const su of surfaces) {
    if (!OPENING_KINDS.has(su.kind) || su.side === 'floor') continue;
    const o: Opening = { side: su.side, s0: su.s0, s1: su.side === 'end' ? su.s0 : su.s1, y0: su.y?.[0] ?? 0.2, y1: su.y?.[1] ?? 1.8, surfaceId: su.id };
    const hit = o.side === 'end' ? o.s0 >= s0 && o.s0 <= s1 : o.s0 < s1 && o.s1 > s0;
    if (hit) out.push(o);
  }
  return out;
}

/**
 * 给别的包的扩展入口（契约申请见 docs/contract-requests/WP3.md，lead 合并进 ViewContext 之前先挂在同一个对象上）：
 *   (ctx as ViewContext & HwViewExt).decals.source(fn)   每帧往地面贴花里加实例（仍是 1 次 draw call）；返回取消函数
 *   (ctx as ViewContext & HwViewExt).atmosphere          当前插值后的氛围（id、dark、平面影子方向等，只读）
 */
export interface DecalSink {
  /** 地面 (x, y, −s) 处一个贴花：宽 w（x 向）、长 l（s 向）；color 为 sRGB 十六进制；blob 是压暗的圆斑，其余是加亮。 */
  add(kind: DecalKind, x: number, y: number, s: number, w: number, l: number, color: number, intensity: number, rot?: number): boolean;
}
export interface HwViewExt {
  decals?: { source(fn: (sink: DecalSink) => void): () => void };
  atmosphere?: {
    readonly id: AtmosphereId; readonly dark: boolean; readonly planarDir: THREE.Vector3;
    readonly fogNear: number; readonly fogFar: number; readonly fogColor: THREE.Color; readonly lampGain: number; readonly chalkMin: number;
  };
}

export interface PreviewOpts {
  kit?: KitId; variant?: string; atmosphere?: AtmosphereId; beats?: number; stride?: number;
  stairs?: { dir: 'down' | 'up'; risePerBeat: number }; surfaces?: SurfaceDef[]; beat?: number; x?: number;
  set?: SetId; lights?: { op: 'flicker' | 'out' | 'on' | 'sound'; from: number; to: number; every?: number };
  /** set 预览：固定的静场时间（秒），用来看某一时刻的动画（老师走到桌边、阿姨的手……）。 */
  t?: number;
  /** 预览段里的掌光环：[拍, x, 强度]。 */
  rings?: Array<[number, number, number]>;
  /** 预览段里在这一拍拍一下地（声控灯）。 */
  soundAt?: number;
}

export class World implements ViewSystem {
  readonly id = 'world';
  readonly owner = 'WP3' as const;
  readonly order = 10;
  ctx!: ViewContext;
  lamps!: LampField;
  atmo!: AtmosphereMixer;
  decals!: Decals;
  readonly root = new THREE.Group();
  private slots: Slot[] = [];
  private standSlots = new Map<number, Slot[]>();
  private previewSlots: Slot[] = [];
  private geoms = new Set<THREE.BufferGeometry>();
  private previewGeoms = new Set<THREE.BufferGeometry>();
  private boardGeoms = new Set<THREE.BufferGeometry>();
  private floorMats = new Map<string, THREE.MeshLambertMaterial>();
  private staticAtlasMat!: THREE.MeshLambertMaterial;
  private staticPlainMat!: THREE.MeshLambertMaterial;
  private staticWhiteMat!: THREE.MeshLambertMaterial;
  private emissiveMat!: THREE.MeshBasicMaterial;
  private emissiveWhiteMat!: THREE.MeshBasicMaterial;
  private atlasCanvas: HTMLCanvasElement | null = null;
  atlasTex!: THREE.Texture;
  private plateSlots = new Map<string, Rect>();
  private sets = new Map<string, SetEntry>();
  private setBySeg = new Map<number, SetEntry>();
  private boardTex = new Map<string, THREE.Texture>();
  private runBoards: Array<{ board: Board; seg: number }> = [];
  private chapter: CompiledChapter | null = null;
  private runSegs: CompiledSegment[] = [];
  private segIndex = 0;
  private lastKind: 'run' | 'still' | 'stand' = 'run';
  private builtTier: string | null = null;
  private last: SimSnapshot | null = null;
  private preview: { s: number; x: number; seg: CompiledSegment; set: SetEntry | null; t: number | null } | null = null;
  // 每帧用到的缓存（运行时不分配）
  private standFlat: Slot[] = [];
  private setList: SetEntry[] = [];
  private readonly rangeTmp: [number, number] = [0, 0];
  private boardNow = 0;
  private decalSources: Array<(sink: DecalSink) => void> = [];
  /** 调试：强制粉笔描边的亮度（null = 按氛围与设置）。描边亮度的对照测量用。 */
  chalkOverride: number | null = null;
  private readonly decalSink: DecalSink = {
    add: (kind, x, y, s, w, l, color, intensity, rot = 0) => this.decals.add(kind, x, y, s, w, l, color, intensity, null, rot),
  };
  private readonly boardTick = (b: Board): void => { b.update(this.boardNow); };
  /** 统计（测试、调试用）。 */
  readonly stats = { slots: 0, generic: 0, special: 0, pools: 0, maxSlotTris: 0, maxSlotCalls: 0 };

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    this.lamps = ctx.lamps instanceof LampField ? ctx.lamps : new LampField();
    this.atmo = new AtmosphereMixer(presetOf);
    this.atmo.fogMul = ctx.quality.fogMul;
    this.atmo.attach(ctx.scene);
    this.atmo.snap('morning');
    this.root.name = 'hw:world';
    ctx.scene.add(this.root);
    this.decals = new Decals(this.lamps.uniforms);
    ctx.scene.add(this.decals.mesh);
    // 扩展入口（见 HwViewExt）
    const ext = ctx as ViewContext & HwViewExt;
    ext.decals = {
      source: (fn) => {
        this.decalSources.push(fn);
        return () => { this.decalSources = this.decalSources.filter((f) => f !== fn); };
      },
    };
    const atmo = (): AtmosphereMixer => this.atmo;
    ext.atmosphere = {
      get id() { return atmo().id; }, get dark() { return atmo().cur.dark; }, get planarDir() { return atmo().cur.planarVec; },
      get fogNear() { return atmo().cur.near; }, get fogFar() { return atmo().cur.far; }, get fogColor() { return atmo().cur.fog; },
      get lampGain() { return atmo().cur.lampGain; }, get chalkMin() { return atmo().cur.chalkMin; },
    };
    // 材质：地面按贴图缓存；static 分「有 uv（校园贴图集）」与「纯顶点色」；发光体跟灯走
    // 校园贴图集不按低画质减半（U6）：数据门牌在图集里要 ≥ 256 px 宽，5-11 翻转后的反字在低画质下也读得出（多 0.75 MB 显存）
    const size = Math.max(ATLAS_MIN_SIZE, ctx.quality.texSize);
    if (typeof document !== 'undefined') {
      this.atlasCanvas = makeCanvas(size, size);
      paintSchoolAtlas(this.atlasCanvas, {});
      this.atlasTex = new THREE.CanvasTexture(this.atlasCanvas);
      this.atlasTex.name = 'hw:schoolAtlas';
    } else {
      this.atlasTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      this.atlasTex.needsUpdate = true;
    }
    // 门牌、值日表这些字常被斜着看：贴图集至少 4 倍各向异性过滤（three 按设备上限截断；U6）
    this.atlasTex.anisotropy = Math.max(4, (ctx.tex as HwTextureBank).anisotropy ?? 1);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.staticAtlasMat = ctx.mat.lambert({ vertexColors: true, map: this.atlasTex, flat: true });
    // 数据里的门牌（shell.ts DATA_PLATE，aSteady = 1）自发光：在 voidDark 里也读得出（U6）
    patchSteadyGlow(this.staticAtlasMat, 1);
    this.staticPlainMat = ctx.mat.lambert({ vertexColors: true, flat: true });
    this.staticWhiteMat = ctx.mat.lambert({ flat: true });
    this.emissiveMat = ctx.mat.basic({ color: 0xffffff, lampLit: true });
    this.emissiveMat.vertexColors = true;
    this.emissiveWhiteMat = ctx.mat.basic({ color: 0xffffff, lampLit: true });
  }

  // ——————————————————— 读章 ———————————————————
  async loadChapter(ch: CompiledChapter): Promise<void> {
    this.chapter = ch;
    this.runSegs = ch.segments.filter((s) => s.kind === 'run');
    this.clearWorld();
    this.lamps.clear();
    // 门牌文字 → 贴图集里的两个位置
    const plates = Array.from(new Set(ch.segments.flatMap((s) => s.surfaces).filter((su) => su.kind === 'doorPlate' && su.text).map((su) => su.text as string))).slice(0, 2);
    this.plateSlots.clear();
    plates.forEach((t, i) => this.plateSlots.set(t, ATLAS.plates[i] as Rect));
    if (this.atlasCanvas) { paintSchoolAtlas(this.atlasCanvas, { plates: plates.join('|') }); this.atlasTex.needsUpdate = true; }
    // 黑板字：按全部 board cue 预先生成
    for (const b of allBodies(ch)) if (b.type === 'board' && b.op === 'write' && b.line) this.boardTexture(b.line, !!b.tremble);
    this.buildGeometry(ch);
    // 跑段上的 board 表面（与画质无关，只在读章时建）
    for (const seg of this.runSegs) for (const su of seg.surfaces) if (su.kind === 'board' && (su.side === 'L' || su.side === 'R')) this.addRunBoard(seg, su);
    // 静场 set
    for (const seg of ch.segments) {
      if (seg.kind !== 'still') continue;
      const d = seg.def as StillSegmentDef;
      const e = this.ensureSet(d.set, d.variant);
      if (e) this.setBySeg.set(seg.index, e);
    }
    const first = ch.segments[0];
    if (first) this.atmo.snap(first.def.atmosphere);
  }

  /** 按当前画质建全部 chunk（读章与画质切换时调用）。 */
  private buildGeometry(ch: CompiledChapter): void {
    this.disposeSlots();
    this.builtTier = this.ctx.quality.tier;
    const pools = new Map<string, GeoSet[]>();
    const segs = ch.segments;
    const neighbor = (i: number, dir: -1 | 1): { kit: KitId; variant: string } | null => {
      for (let j = i + dir; j >= 0 && j < segs.length; j += dir) {
        const s = segs[j] as CompiledSegment;
        if (s.kind === 'still') continue;
        const d = s.def as RunSegmentDef | StandSegmentDef;
        return { kit: d.kit, variant: d.variant };
      }
      return null;
    };
    for (const seg of segs) {
      if (seg.kind === 'run') {
        const def = seg.def as RunSegmentDef;
        this.slots.push(...this.buildRunSegment(ch.seed, seg, def.kit, def.variant, neighbor(seg.index, -1), neighbor(seg.index, 1), pools, (a, b) => this.ctx.surfaces.openingsIn(a, b)));
      } else if (seg.kind === 'stand') {
        const def = seg.def as StandSegmentDef;
        this.standSlots.set(seg.index, this.buildStandSegment(ch.seed, seg, def.kit, def.variant));
      }
    }
    this.slots.sort((a, b) => a.s0 - b.s0);
    this.standFlat = Array.from(this.standSlots.values()).flat();
    this.stats.pools = pools.size;
    for (const l of this.slots) this.lamps.addLamps(`slot:${l.s0.toFixed(3)}`, l.lamps);
  }

  private chunkLenFor(kit: EnvKit, stride: number): number {
    if (kit.owner !== 'WP3') return CHUNK_LEN;
    const beats = 2 * Math.max(1, Math.round(CHUNK_LEN / (2 * stride)));
    return beats * stride;
  }

  /** kit.build 出错时不让读章失败：记日志，改用 CORE 占位 kit（游戏照常能跑）。 */
  private safeBuild(kit: EnvKit, ctx: HwKitChunkContext): KitChunk {
    try { return kit.build(ctx); } catch (err) {
      console.error(`[world] kit ${kit.id}.${ctx.variant} failed at s=${ctx.s0.toFixed(1)}`, err);
      const ph = getKit('placeholder');
      if (ph && ph !== kit) return ph.build(ctx);
      throw err;
    }
  }

  private kitCtx(seed: number, seg: CompiledSegment, variant: string, s0: number, s1: number, openings: readonly Opening[], hw: HwKitExt, salt: string): HwKitChunkContext {
    return {
      seg, variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0),
      openings, quality: this.ctx.quality, rng: createRng(seed, salt), mat: this.ctx.mat, tex: this.ctx.tex, hw,
    };
  }

  private hwExt(generic: boolean, prev: HwKitExt['prev'], next: HwKitExt['next'], chunkLen: number): HwKitExt {
    return { generic, prev, next, chunkLen, plateRect: (t) => this.plateSlots.get(t) ?? null };
  }

  private buildRunSegment(seed: number, seg: CompiledSegment, kitId: KitId, variant: string, prev: HwKitExt['prev'], next: HwKitExt['next'],
    pools: Map<string, GeoSet[]>, openingsIn: (a: number, b: number) => readonly Opening[], into: Set<THREE.BufferGeometry> = this.geoms): Slot[] {
    const kit = getKit(kitId);
    if (!kit) return [];
    const out: Slot[] = [];
    const len = this.chunkLenFor(kit, seg.stride);
    const n = Math.max(1, Math.ceil((seg.s1 - seg.s0) / len - 1e-6));
    const pooled = kit.owner === 'WP3';
    const stairs = (seg.def as RunSegmentDef).stairs;
    const key = `${kit.id}.${variant}|${seg.stride}|${stairs ? `${stairs.dir}${stairs.risePerBeat}` : 'flat'}`;
    let prevGeneric = -1;
    for (let i = 0; i < n; i++) {
      const s0 = seg.s0 + i * len;
      const s1 = Math.min(seg.s1, s0 + len);
      if (s1 - s0 < 0.05) continue;
      const openings = openingsIn(s0, s1);
      const special = !pooled || i === 0 || i === n - 1 || s1 - s0 < len - 1e-6 || openings.length > 0
        || s0 < seg.s0 + 4 || s1 > seg.s1 - 4
        || seg.surfaces.some((su) => (su.kind === 'doorPlate' || su.kind === 'board') && su.s0 < s1 + 1 && su.s1 > s0 - 1);
      if (special) {
        const ctx = this.kitCtx(seed, seg, variant, s0, s1, openings, this.hwExt(false, prev, next, len), `chunk:${seg.def.id}:${i}`);
        const gs = this.geoSet(this.safeBuild(kit, ctx), 0, into);
        out.push(this.makeSlot(seg, s0, s1, gs, -1));
        this.stats.special++;
      } else {
        let pool = pools.get(key);
        if (!pool) { pool = []; pools.set(key, pool); }
        let k = createRng(seed, `pick:${seg.def.id}:${i}`).int(GENERIC_VARIANTS);
        if (k === prevGeneric) k = (k + 1) % GENERIC_VARIANTS;
        prevGeneric = k;
        while (pool.length <= k) {
          const t0 = seg.s0 + len;          // 模板位置：第 2 个 chunk（整拍对齐）
          const j = pool.length;
          const ctx = this.kitCtx(seed, seg, variant, t0, t0 + len, [], this.hwExt(true, prev, next, len), `generic:${key}:${j}`);
          pool.push(this.geoSet(this.safeBuild(kit, ctx), t0, into));
        }
        const gs = pool[k] as GeoSet;
        out.push(this.makeSlot(seg, s0, s1, gs, k));
        this.stats.generic++;
      }
    }
    return out;
  }

  private buildStandSegment(seed: number, seg: CompiledSegment, kitId: KitId, variant: string): Slot[] {
    const kit = getKit(kitId);
    if (!kit) return [];
    const out: Slot[] = [];
    const len = this.chunkLenFor(kit, 1);
    for (let i = -1; i < 4; i++) {
      const s0 = seg.s0 + i * len, s1 = s0 + len;
      const ctx = this.kitCtx(seed, seg, variant, s0, s1, [], this.hwExt(false, null, null, len), `stand:${seg.def.id}:${i}`);
      const gs = this.geoSet(this.safeBuild(kit, ctx), 0);
      const slot = this.makeSlot(seg, s0, s1, gs, -1);
      out.push(slot);
      this.lamps.addLamps(`stand:${seg.index}:${i}`, slot.lamps);
    }
    return out;
  }

  /** 把 kit 的产物登记为可复用的几何体组；templateS0 ≠ 0 时灯的 s 存成相对值。 */
  private geoSet(kc: KitChunk, templateS0: number, into: Set<THREE.BufferGeometry> = this.geoms): GeoSet {
    for (const g of [kc.floor, kc.static, kc.emissive]) if (g) { this.ctx.mat.ensureChalkAttr(g); into.add(g); }
    const h = floorHints(kc.floor.userData as Record<string, unknown>);
    return {
      floor: kc.floor, static: kc.static, emissive: kc.emissive,
      lamps: kc.lamps.map((l) => ({ ...l, s: l.s - templateS0 })), gloss: h.gloss,
      tris: triCount(kc.floor) + triCount(kc.static) + triCount(kc.emissive),
    };
  }

  private floorMat(g: THREE.BufferGeometry): THREE.MeshLambertMaterial {
    const h = floorHints(g.userData as Record<string, unknown>);
    const useMap = !!h.map && !!g.getAttribute('uv');
    const vc = !!g.getAttribute('color');
    const key = `${useMap ? `${h.map?.id}:${JSON.stringify(h.map?.params ?? {})}` : 'plain'}|${h.depthWrite ? 'dw' : 'nodw'}|${vc ? 'vc' : 'white'}`;
    let m = this.floorMats.get(key);
    if (!m) {
      const map = useMap && h.map ? this.ctx.tex.get(h.map.id, { ...(h.map.params ?? {}), repeat: 1 }) : undefined;
      m = this.ctx.mat.lambert(map ? { vertexColors: vc, map, flat: true } : { vertexColors: vc, flat: true });
      m.depthWrite = h.depthWrite;               // §5.8：地面不写深度（水洼模板门户）；楼梯段写
      m.name = `hw:floor:${key}`;
      this.floorMats.set(key, m);
    }
    return m;
  }

  private makeSlot(seg: CompiledSegment, s0: number, s1: number, gs: GeoSet, generic: number): Slot {
    const group = new THREE.Group();
    group.name = `chunk:${seg.def.id}:${s0.toFixed(1)}`;
    group.position.set(0, seg.floorY(s0), -s0);
    const floor = new THREE.Mesh(gs.floor, this.floorMat(gs.floor));
    floor.renderOrder = RENDER_ORDER.floor;
    floor.name = 'floor';
    // 材质按显式标志选（kitContext.ts）：校园贴图集只给标了 hwAtlas 的 static；没有顶点色的几何体用白色材质
    const hasCol = (g: THREE.BufferGeometry) => !!g.getAttribute('color');
    const statMat = usesSchoolAtlas(gs.static.userData as Record<string, unknown>) && gs.static.getAttribute('uv') ? this.staticAtlasMat
      : hasCol(gs.static) ? this.staticPlainMat : this.staticWhiteMat;
    const stat = new THREE.Mesh(gs.static, statMat);
    stat.name = 'static';
    group.add(floor, stat);
    if (gs.emissive) { const e = new THREE.Mesh(gs.emissive, hasCol(gs.emissive) ? this.emissiveMat : this.emissiveWhiteMat); e.name = 'emissive'; group.add(e); }
    group.updateMatrix(); group.matrixAutoUpdate = false;
    for (const c of group.children) { c.updateMatrix(); c.matrixAutoUpdate = false; }
    group.updateMatrixWorld(true);
    group.visible = false;
    this.root.add(group);
    const lamps = gs.lamps.map((l) => ({ ...l, s: l.s + (generic >= 0 ? s0 : 0) }));
    this.stats.slots++;
    this.stats.maxSlotTris = Math.max(this.stats.maxSlotTris, gs.tris);
    this.stats.maxSlotCalls = Math.max(this.stats.maxSlotCalls, group.children.length);
    return { seg, s0, s1, group, gloss: gs.gloss, tris: gs.tris, lamps, generic };
  }

  /** 章节 chunk（不含预览段、黑板）：读章与画质切换时重建。 */
  private disposeSlots(): void {
    for (const sl of [...this.slots, ...Array.from(this.standSlots.values()).flat()]) this.root.remove(sl.group);
    for (const g of this.geoms) g.dispose();
    this.geoms.clear();
    this.slots = []; this.standSlots.clear(); this.standFlat = [];
    Object.assign(this.stats, { slots: 0, generic: 0, special: 0, pools: 0, maxSlotTris: 0, maxSlotCalls: 0 });
  }

  private disposePreview(): void {
    for (const sl of this.previewSlots) { this.root.remove(sl.group); this.lamps.removeLamps(`preview:${sl.s0.toFixed(2)}`); }
    for (const g of this.previewGeoms) g.dispose();
    this.previewGeoms.clear();
    this.previewSlots = [];
  }

  private disposeBoards(): void {
    for (const rb of this.runBoards) { this.root.remove(rb.board.mesh); BOARDS.forEach((b, k) => { if (b === rb.board) BOARDS.delete(k); }); }
    for (const g of this.boardGeoms) g.dispose();
    this.boardGeoms.clear();
    this.runBoards = [];
  }

  private clearWorld(): void {
    this.disposeSlots();
    this.disposePreview();
    this.disposeBoards();
    this.setBySeg.clear();
    for (const e of this.sets.values()) e.obj.visible = false;
    this.preview = null;
  }

  private ensureSet(id: SetId, variant: string | undefined): SetEntry | null {
    const set = getSet(id);
    if (!set) return null;
    const v = variant ?? set.variants[0] ?? 'default';
    const key = `${set.id}:${v}`;
    let e = this.sets.get(key);
    if (!e) {
      const obj = set.build(this.ctx, v);
      obj.position.set(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
      obj.visible = false;
      obj.name = `set:${key}`;
      this.root.add(obj);
      e = { set: set.id, variant: v, obj };
      if (set.update) e.update = set.update.bind(set);
      this.sets.set(key, e);
      this.setList = Array.from(this.sets.values());
    }
    return e;
  }

  private boardTexture(line: string, tremble: boolean): THREE.Texture {
    const key = `${line}|${tremble ? 1 : 0}`;
    let t = this.boardTex.get(key);
    if (!t) { t = this.ctx.tex.get('chalkText', { text: lineText(line), tremble: tremble ? 1 : 0 }); this.boardTex.set(key, t); }
    return t;
  }

  private addRunBoard(seg: CompiledSegment, su: CompiledSurface): void {
    const side = su.side === 'L' ? -1 : 1;
    const y0 = su.y?.[0] ?? 0.9, y1 = su.y?.[1] ?? 2.1;
    const w = Math.max(0.6, su.s1 - su.s0);
    const geo = new THREE.PlaneGeometry(w, y1 - y0);
    this.boardGeoms.add(geo);
    const blank = this.ctx.tex.get('chalkboard', { text: '' });
    const board = new Board(new THREE.Mesh(geo), blank);
    board.mesh.material = boardMaterial(blank, this.lamps.uniforms, board.uniforms);
    board.mesh.position.set(side * (1.8 - 0.012), seg.floorY(su.s0) + (y0 + y1) / 2, -(su.s0 + w / 2));
    board.mesh.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    board.mesh.name = `board:${su.id}`;
    board.mesh.visible = false;
    this.root.add(board.mesh);
    BOARDS.set(su.id, board);
    this.runBoards.push({ board, seg: seg.index });
  }

  // ——————————————————— 事件与 cue ———————————————————
  onEvent(e: GameEvent, snap: SimSnapshot): void {
    this.last = snap;
    this.lamps.now = snap.t;
    switch (e.type) {
      case 'segment': {
        const seg = this.chapter?.segments[e.data.index];
        if (!seg) break;
        const cut = seg.kind === 'still' || this.lastKind === 'still';
        if (cut) this.atmo.snap(seg.def.atmosphere); else this.atmo.transition(seg.def.atmosphere, 1.5, snap.t);
        this.segIndex = seg.index; this.lastKind = seg.kind;
        break;
      }
      case 'land': this.lamps.soundTrigger(snap.player.s); break;
      case 'action': if (e.data.kind === 'duck') this.lamps.soundTrigger(snap.player.s); break;
      case 'contact':
        if (e.data.part === 'heel' && this.lamps.palmAt(e.data.s)) this.lamps.ring(e.data.s, e.data.x, 0.9, 1.1);
        break;
      case 'followerContact': {
        const f = snap.follower;
        if (e.data.part === 'heel' && e.data.from === 'front' && f.leaderS !== null && this.lamps.palmAt(f.leaderS)) {
          this.lamps.ring(f.leaderS, (f.leaderLane ?? 0) * LANE_WIDTH, 0.9, 1.1);
        }
        break;
      }
      default: break;
    }
  }

  onReset(snap: SimSnapshot): void {
    this.last = snap;
    const ch = this.chapter;
    const seg = ch?.segments[snap.segIndex];
    this.segIndex = snap.segIndex;
    this.lastKind = seg?.kind ?? 'run';
    this.lamps.now = snap.t;
    this.lamps.resetStates();
    for (const b of BOARDS.values()) b.clear();
    if (!ch || !seg) return;
    this.atmo.snap(seg.def.atmosphere);
    // 重放检查点之前已经发生的表现（瞬时完成）：之前各段与当前段已过部分的 lights、黑板字；当前段的 atmosphere / fog。
    // 包括 stop / slow 的时间线、自动回头窗口的 then、静场按完之后的 onDone。
    const past = snap.t - 100;
    for (const r of replayBodies(ch, seg.index, snap.segBeat)) {
      const b = r.body, sg = r.seg;
      if (b.type === 'lights') this.lightsOp(b.op, sg, b.from, b.to, b.every, b.delay, past);
      else if (b.type === 'board') this.boardRestore(b);
      else if (sg.index === seg.index && b.type === 'atmosphere') this.atmo.snap(b.id);
      else if (sg.index === seg.index && b.type === 'fog') this.atmo.fogTo(b.near, b.far, 0, snap.t);
    }
    this.lamps.now = snap.t;
  }

  /** 重来时把黑板恢复到检查点之前的样子（写完的字整段显示；擦过的只剩粉笔雾）。 */
  private boardRestore(body: Extract<EventBody, { type: 'board' }>): void {
    const b = BOARDS.get(body.surface);
    if (!b) return;
    if (body.op === 'write') b.show(body.line ? this.boardTexture(body.line, !!body.tremble) : b.blank);
    else b.restoreWiped();
  }

  /** atmosphere cue。 */
  transitionTo(id: AtmosphereId, seconds: number, now: number): void { this.atmo.transition(id, seconds, now); }
  /** fog cue。 */
  fogOverride(near: number, far: number, seconds: number, now: number): void { this.atmo.fogTo(near, far, seconds, now); }
  /** lights cue：from / to 是段内拍号（缺省为整段）；delay 为秒。 */
  lightsOp(op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings', seg: CompiledSegment, from: number | undefined, to: number | undefined,
    every: number | undefined, delay: number | undefined, now: number): void {
    const s0 = seg.s0 + (from ?? 0) * seg.stride;
    const s1 = seg.s0 + (to ?? (seg.s1 - seg.s0) / Math.max(1e-6, seg.stride)) * seg.stride;
    const o: { every?: number; delay?: number } = {};
    if (every !== undefined) o.every = every;
    if (delay !== undefined) o.delay = delay;
    const keep = this.lamps.now;
    this.lamps.now = now;
    this.lamps.op(op, s0, s1, o);
    this.lamps.now = Math.max(keep, now);
  }
  /** board cue。 */
  boardOp(body: Extract<EventBody, { type: 'board' }>, now: number): void {
    const b = BOARDS.get(body.surface);
    if (!b) return;
    if (body.op === 'write') {
      const text = body.line ? lineText(body.line) : '';
      const tex = body.line ? this.boardTexture(body.line, !!body.tremble) : b.blank;
      b.write(tex, now, Array.from(text).length);
    } else {
      b.wipeProgress = () => this.stillHoldFrac();
      b.wipe(now, 1.2);
    }
  }

  /** 调试：直接往黑板上写一段字（不经 lines.ts；只在预览里用，会新建纹理）。 */
  boardText(surface: string, text: string, tremble: boolean, now: number): boolean {
    const b = BOARDS.get(surface);
    if (!b) return false;
    b.show(this.ctx.tex.get('chalkText', { text, tremble: tremble ? 1 : 0 }));
    void now;
    return true;
  }

  /** 静场「按住」的进度（黑板擦除跟着手走）。 */
  private stillHoldFrac(): number | null {
    const snap = this.last;
    const seg = this.chapter?.segments[this.segIndex];
    if (!snap?.still || !seg || seg.kind !== 'still') return null;
    const inp = (seg.def as StillSegmentDef).input;
    if (!inp || inp.mode !== 'hold' || !inp.holdSeconds || snap.still.held <= 0) return null;
    return snap.still.held / inp.holdSeconds;
  }

  /** 把当前氛围写进灯光、雾和 LampField 的 uniform（每帧调用；调试切氛围时也立即调用，不必等下一帧）。 */
  private applyAtmosphere(stillMode: boolean): void {
    this.atmo.apply();
    const cur = this.atmo.cur;
    const st = this.ctx.settings;
    const U = this.lamps.uniforms;
    this.lamps.floor = cur.lampFloor;
    this.lamps.reducedFlicker = st.reducedFlicker;
    U.uLampGain.value = cur.lampGain;
    U.uLampColor.value.copy(cur.lampColor);
    U.uChalk.value = this.chalkOverride ?? (st.outlines || st.assist ? Math.max(0.5, cur.chalkMin) : cur.chalkMin);
    this.lamps.uniformLevel = stillMode ? 1 : null;
  }

  /** 调试：立即切到某个氛围（灯光、雾、LampField 参数和亮度场当场生效）。id 为 null 时只把当前氛围重新写一遍。 */
  snapAtmosphere(id: AtmosphereId | null): void {
    if (id) this.atmo.snap(id);
    const still = this.preview ? !!this.preview.set : this.last?.segKind === 'still';
    this.applyAtmosphere(still);
    if (!still) this.lamps.update(this.lamps.now, this.preview && !this.preview.set ? this.preview.s : this.last?.player.s ?? 0, this.last?.player.floorY ?? 0);
  }

  // ——————————————————— 每帧 ———————————————————
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, _dt: number): void {
    this.last = next;
    const same = prev.segIndex === next.segIndex;
    const a = same ? alpha : 1;
    const t = lerp(prev.t, next.t, a);
    let s = lerp(prev.player.s, next.player.s, a);
    let fy = lerp(prev.player.floorY, next.player.floorY, a);
    const pv = this.preview;
    const stillMode = pv ? !!pv.set : next.segKind === 'still';
    const standMode = !pv && next.segKind === 'stand';
    if (pv && !pv.set) { s = pv.s; fy = pv.seg.floorY(pv.s); }
    // 氛围与 LampField
    this.atmo.update(t);
    this.applyAtmosphere(stillMode);
    this.lamps.update(t, s, stillMode ? STILL_ORIGIN.y : fy);
    this.atmo.follow(0, fy, -s);
    // 可见性
    const list = pv && !pv.set ? this.previewSlots : standMode ? (this.standSlots.get(next.segIndex) ?? []) : this.slots;
    for (const sl of this.slots) sl.group.visible = false;
    for (const sl of this.previewSlots) sl.group.visible = false;
    for (const sl of this.standFlat) sl.group.visible = false;
    let visibleFrom = 0, visibleTo = -1;
    if (!stillMode && list.length) {
      const c = this.slotAt(list, s);
      visibleFrom = Math.max(0, c - 1);
      visibleTo = Math.min(list.length - 1, c + this.ctx.quality.chunksAhead - 1);
      for (let i = visibleFrom; i <= visibleTo; i++) (list[i] as Slot).group.visible = true;
    }
    for (const rb of this.runBoards) rb.board.mesh.visible = !stillMode && !pv && Math.abs(rb.seg - next.segIndex) <= 1;
    // set
    const setE = pv ? pv.set : stillMode ? this.setBySeg.get(next.segIndex) ?? null : null;
    for (const e of this.setList) e.obj.visible = e === setE;
    if (setE?.update) setE.update(pv?.t ?? next.still?.t ?? t, next);
    this.boardNow = t;
    BOARDS.forEach(this.boardTick);
    // 地面贴花
    this.decals.begin();
    if (!stillMode) this.fillDecals(list, visibleFrom, visibleTo, s);
    for (const fn of this.decalSources) {
      try { fn(this.decalSink); } catch (err) { console.error('[world] decal source failed', err); }
    }
    this.decals.end();
  }

  private slotAt(list: readonly Slot[], s: number): number {
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if ((list[m] as Slot).s0 <= s) lo = m; else hi = m - 1; }
    return lo;
  }

  private fillDecals(list: readonly Slot[], from: number, to: number, s: number): void {
    const cam = this.ctx.camera.position;
    for (let i = from; i <= to; i++) {
      const sl = list[i] as Slot;
      const [la, lb] = this.lamps.range(sl.s0, sl.s1, this.rangeTmp);
      for (let k = la; k < lb; k++) {
        const ls = this.lamps.lampS(k);
        if (ls < s - 3) continue;
        const kind = this.lamps.lampKind(k);
        const floorY = sl.seg.floorY(clamp(ls, sl.seg.s0, sl.seg.s1));
        if ((kind === 'tube' || kind === 'window') && sl.gloss > 0) {
          // 光滑地面上的倒影：把灯 / 窗的位置朝镜头方向压（介于真实反射点与灯下之间，否则全被主角挡住），拉成一道竖条
          const camS = -cam.z;
          const d = ls - camS;
          if (d < 0.5) continue;
          const rs = camS + d * 0.45;
          if (kind === 'tube') {
            const rx = cam.x + (this.lamps.lampX(k) - cam.x) * 0.45;
            const inten = sl.gloss * 0.42 * clamp(0.4 + d / 25, 0.4, 1);
            // 越湿越宽（早晨 0.14 m，湿地 0.39 m）；湿地再在下面铺一层宽而淡的光（「水银河」是一条河，不是地上画的中线）
            this.decals.add('streak', rx, floorY + 0.01, rs, 0.12 + 0.42 * sl.gloss * sl.gloss, 1.0 + 2.8 * sl.gloss, 0xdfe9f2, inten, ls);
            if (sl.gloss > 0.5) this.decals.add('pool', rx, floorY + 0.011, rs, 0.5 + 1.1 * sl.gloss, 1.6 + 2.4 * sl.gloss, 0xc9d8e2, inten * 0.16, ls);
          } else {
            // 窗在光滑地面上的倒影：沿墙根一块拉长的柔光（不是形状，是一片亮）
            const rx = this.lamps.lampX(k) * 0.8;
            this.decals.add('pool', rx, floorY + 0.01, rs, 0.7 + 0.3 * sl.gloss, 2.2 + 2.6 * sl.gloss, 0xdce6ec, sl.gloss * 0.16, null);
          }
        } else if (kind === 'street' || kind === 'bulb') {
          const r = kind === 'street' ? 5.5 : 2.6;
          // 路灯的光池用当前氛围的 poolColor（rainNight 是碎金 #C8A15A，照到人和物体的灯色是冷色；
          // 别的氛围里 = 灯色，冷白，不会把暖色带出第三章，附录 A-9）
          this.decals.add('pool', this.lamps.lampX(k), floorY + 0.01, ls, r, r, kind === 'street' ? this.atmo.cur.poolColor.getHex() : 0xcfd8de, kind === 'street' ? 0.35 : 0.22, ls);
        }
      }
    }
    for (let i = 0; i < this.lamps.ringCapacity; i++) {
      const rg = this.lamps.ringAt(i);
      if (!rg) continue;
      const r = rg.radius * 2 * (0.3 + 0.7 * rg.age);
      const y = this.floorAt(rg.s) + 0.012;
      this.decals.add('ring', rg.x, y, rg.s, r, r, 0xdfe6ea, rg.strength * (1 - rg.age) * 0.85);
      this.decals.add('pool', rg.x, y, rg.s, rg.radius * 1.4, rg.radius * 1.4, 0x9fc3d6, rg.strength * (1 - rg.age) * 0.3);
    }
  }

  private floorAt(s: number): number {
    const pv = this.preview;
    if (pv && !pv.set) return pv.seg.floorY(s);
    for (const sg of this.runSegs) if (s >= sg.s0 - 1e-6 && s <= sg.s1 + 1e-6) return sg.floorY(s);
    return this.last?.player.floorY ?? 0;
  }

  /**
   * 画质切换：雾距按新倍率重算（不打断过渡、不丢 fog cue），chunk 按新档位重建（灯状态由 LampField 按灯迁移）。
   * 黑板、set、贴花、预览段都不重建。
   */
  setQuality(q: import('../core/contracts').QualityProfile): void {
    this.atmo.setFogMul(q.fogMul);
    if (this.chapter && this.builtTier !== q.tier) this.buildGeometry(this.chapter);
  }

  // ——————————————————— 预览（调试扩展，只在 ?test / ?debug 下可用） ———————————————————
  /** 在远处按参数单独建一段 kit，或显示一个 set；View 同时切换到预览镜头。 */
  startPreview(o: PreviewOpts): { s: number; floorY: number; x: number; setShot: boolean } {
    this.disposePreview();
    if (o.set) {
      const e = this.ensureSet(o.set, o.variant);
      const seg = this.fakeSegment(o);
      this.preview = { s: 0, x: 0, seg, set: e, t: o.t ?? null };
      if (o.atmosphere) this.atmo.snap(o.atmosphere);
      return { s: 0, floorY: STILL_ORIGIN.y, x: 0, setShot: true };
    }
    const seg = this.fakeSegment(o);
    const kit = o.kit ?? 'corridor';
    const variant = o.variant ?? (getKit(kit)?.variants[0] ?? 'default');
    const pools = new Map<string, GeoSet[]>();
    this.previewSlots = this.buildRunSegment(7, seg, kit, variant, { kit: 'corridor', variant: 'morning' }, null, pools, (a, b) => openingsOf(seg.surfaces, a, b), this.previewGeoms);
    for (const sl of this.previewSlots) this.lamps.addLamps(`preview:${sl.s0.toFixed(2)}`, sl.lamps);
    const s = seg.s0 + (o.beat ?? 6) * seg.stride;
    this.preview = { s, x: o.x ?? 0, seg, set: null, t: null };
    this.atmo.snap(o.atmosphere ?? seg.def.atmosphere);
    this.lamps.resetStates();
    if (o.lights) this.lightsOp(o.lights.op, seg, o.lights.from, o.lights.to, o.lights.every, 0, this.lamps.now - 100);
    if (o.soundAt !== undefined) { const keep = this.lamps.now; this.lamps.now = keep - 1; this.lamps.soundTrigger(seg.s0 + o.soundAt * seg.stride); this.lamps.now = keep; }
    for (const [b, x, k] of o.rings ?? []) this.lamps.ring(seg.s0 + b * seg.stride, x, k, 1.1);
    return { s, floorY: seg.floorY(s), x: o.x ?? 0, setShot: false };
  }

  stopPreview(): void {
    this.disposePreview();
    for (const e of this.sets.values()) e.obj.visible = false;
    this.preview = null;
  }

  get previewing(): boolean { return this.preview !== null; }
  get previewSegment(): CompiledSegment | null { return this.preview?.seg ?? null; }
  get currentSegment(): CompiledSegment | null { return this.chapter?.segments[this.segIndex] ?? null; }

  private fakeSegment(o: PreviewOpts): CompiledSegment {
    const stride = o.stride ?? (o.stairs ? 0.6 : 1);
    const beats = o.beats ?? 96;
    const s0 = PREVIEW_S0, s1 = s0 + beats * stride;
    const st = o.stairs;
    const floorY = (s: number) => (st ? (st.dir === 'up' ? 1 : -1) * st.risePerBeat * clamp((s - s0) / stride, 0, beats) : 0);
    const def = {
      id: 'preview', kind: 'run', kit: o.kit ?? 'corridor', variant: o.variant ?? 'morning', atmosphere: o.atmosphere ?? 'morning', surface: 'terrazzo',
      beats, stride, cadence: 4.6, follower: { mode: 'hidden' }, ...(st ? { stairs: st } : {}), surfaces: o.surfaces ?? [],
    } as unknown as RunSegmentDef;
    const surfaces: CompiledSurface[] = (o.surfaces ?? []).map((su) => {
      const a = s0 + su.from * stride, b = Math.max(a + 0.01, s0 + su.to * stride);
      const plane: [number, number, number, number] = su.side === 'L' ? [1, 0, 0, 1.8] : su.side === 'R' ? [-1, 0, 0, 1.8] : su.side === 'end' ? [0, 0, 1, a] : [0, 1, 0, 0];
      return { ...su, s0: a, s1: b, plane };
    });
    return {
      def, index: -1, kind: 'run', s0, s1, stride, cadenceAt: () => 4.6, timeAt: (b) => b / 4.6, beatAt: (t) => t * 4.6, floorY,
      obstacles: [], surfaces, windows: [], npcGroups: [], events: [], checkpoints: [0],
    };
  }

  // ——————————————————— 调试 / 测试 ———————————————————
  /** 世界自己持有的纹理（预上传用）。 */
  ownTextures(): THREE.Texture[] { return [this.atlasTex, this.decals.texture, this.lamps.texture, ...this.boardTex.values()]; }
  get textureBank(): TextureBank { return this.ctx.tex; }
  slotCount(): number { return this.slots.length; }
}

/** 世界系统单例（render/index.ts 注册，cue 处理器也通过它工作）。 */
export const world = new World();
