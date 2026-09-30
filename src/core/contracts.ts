// src/core/contracts.ts —— 服务接口（DESIGN.md §8.4）。CORE 冻结：各包只实现，不修改。
// 与 §8.4 原文的差异（均为向后兼容的可选项，已在注释里写明理由）：
//   · Plan.steps 的元素多一个可选的 s（动作开始时的里程），自动驾驶按位置执行，比按时间执行更稳。
//   · SolverAPI.solve 的 opts 多了 from / forbid / margin，供自动驾驶从检查点中途求解、供校验器检查 R3/R5/R6/R8/R10。
//   · ViewAPI 由 registry.registerView() 注册（§8.4 的注册表里漏了这一项，Game 需要它）。
import type * as THREE from 'three';
import type { Bus, GameEvent } from './events';
import type { Pose } from './rig';
import type { Settings } from './settings';
import type { SaveAPI } from './save';
import type {
  Action, ChapterId, Device, HitSeverity, InputEvent, KitId, Lane, QualityTier, Rng, ScreenName, SetId, SimSnapshot, WpId,
  AmbienceId, ReverbId,
} from './types';
import type {
  CompiledChapter, CompiledObstacle, CompiledSegment, CompiledSurface,
} from '../levels/schema';
import type { GameEvents } from './events';

export type { SaveAPI, Settings };

/* ——— 模拟（WP1）：纯 TS，不得 import three（§8.3）——— */
export interface SimAPI {
  /** 读章；at 缺省 = 第一段第 0 拍；seed 缺省 = 章节种子。 */
  load(ch: CompiledChapter, at?: { segment: string; beat: number }, seed?: number): void;
  /** 推进 1 tick = 1/120 s。events 的 t 已由 Game 换算为模拟时钟毫秒（见 types.ts InputEvent）。 */
  step(events: readonly InputEvent[], held: ReadonlySet<Action>): void;
  snapshot(): Readonly<SimSnapshot>;
  /** 取走自上次 drain 以来产生的事件。 */
  drain(): GameEvent[];
  /** 从最近的检查点重来：稳度回满，纸条保留，摔倒次数照常累计（§2.7）。 */
  retry(): void;
  goto(segment: string, beat?: number): void;
  setAutopilot(mode: 'off' | 'perfect' | 'human'): void;
  setInvincible(on: boolean): void;
  setSlowOption(on: boolean): void;
  /** 模拟状态哈希：FNV-1a，数值先四舍五入到 1e-4（§8.3）。 */
  hash(): string;
  /** 前方 meters 米内的障碍（给 __game.obstaclesAhead 用）。 */
  obstaclesAhead?(meters: number): Array<{ id: number; kind: string; cls: string; lanes: Lane[]; ds: number; beat: number }>;
}
/** 求解结果（§2.8 R2）。s 为可选扩展：动作开始时玩家的里程（CORE 求解器总会填写）。 */
export interface PlanStep { t: number; s?: number; action: 'left' | 'right' | 'jump' | 'duck' | 'duckRelease' | 'hold' | 'straighten' }
export interface Plan { steps: ReadonlyArray<PlanStep>; laneAt(s: number): Lane; actionAt(s: number): 'none' | 'jump' | 'duck' }
export interface SolveFrom { s: number; lane: Lane; tSeg: number }
export interface SolverAPI {
  solve(seg: CompiledSegment, opts?: {
    noAsk?: boolean; minGap?: number; cadenceMul?: number;
    /** 扩展：从段内某一状态开始求解（缺省 = 段首、中道、tSeg 0）。 */
    from?: SolveFrom;
    /** 扩展：禁止开始新输入的段内时间窗（秒），校验器用来检查休息窗。 */
    forbid?: ReadonlyArray<readonly [number, number]>;
    /** 扩展：碰撞盒安全余量（米），缺省 0.05。 */
    margin?: number;
  }): Plan | null;
}

/* ——— 画面 ——— */
export interface QualityProfile {
  tier: QualityTier; pixelRatio: number; antialias: boolean; fogMul: number; chunksAhead: number;
  npcMax: number; crawlersMax: number; rainLines: number; mirrorsActive: number; puddlesActive: number;
  mirrorChunkCopy: boolean; planarShadow: 'events' | 'always' | 'alwaysPlusNpcBlobs'; texSize: 256 | 512 | 1024;
  capsuleSegments: number; icoDetail: 0 | 1; grain: boolean; lightShafts: boolean; dust: boolean;
}
export interface PerfStats { fps: number; drawCalls: number; triangles: number; geometries: number; textures: number; simMs: number; frameMs: number }
export interface LampFieldUniforms { uLampField: { value: THREE.DataTexture }; uLampBase: { value: number }; uLampScale: { value: number }; uLampGain: { value: number }; uLampColor: { value: THREE.Color }; uChalk: { value: number }; uChalkColor: { value: THREE.Color } }
/** 材质工厂（WP3，§5.3）。CORE 桩见 core/fallbacks.ts。 */
export interface MaterialsAPI {
  lambert(o?: { vertexColors?: boolean; map?: THREE.Texture; transparent?: boolean; opacity?: number; flat?: boolean }): THREE.MeshLambertMaterial;
  basic(o?: { color?: number; map?: THREE.Texture; transparent?: boolean; opacity?: number; additive?: boolean; lampLit?: boolean }): THREE.MeshBasicMaterial;
  ensureChalkAttr(g: THREE.BufferGeometry): void;
}
export interface LampSpec { s: number; x: number; y: number; kind: 'tube' | 'street' | 'bulb' | 'window'; flickerable: boolean }
/** 沿 s 的灯光亮度场（WP3，§5.3）。CORE 桩：统一亮度。 */
export interface LampFieldAPI {
  addLamps(owner: string, lamps: readonly LampSpec[]): void;
  removeLamps(owner: string): void;
  op(op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings', s0: number, s1: number, o?: { every?: number; delay?: number }): void;
  soundTrigger(s: number): void;                                             // 撑跃落地 / ↓ 拍地
  ring(s: number, x: number, strength: number, radius: number): void;       // 掌光环（同时写地面贴花）
  brightnessAt(s: number): number;
  readonly uniforms: LampFieldUniforms;
}
/** 程序纹理库（WP3 实现；WP4 注册户外生成器，§5.9）。 */
export interface TextureBank {
  get(id: string, p?: Readonly<Record<string, string | number>>): THREE.Texture;
  register(id: string, gen: (size: number, p: Readonly<Record<string, string | number>>) => HTMLCanvasElement): void;
}
/** 墙上的开口（墙镜、窗、端墙镜，§5.8）。 */
export interface Opening { side: 'L' | 'R' | 'end'; s0: number; s1: number; y0: number; y1: number; surfaceId: string }
export interface SurfaceIndex { list(): readonly CompiledSurface[]; get(id: string): CompiledSurface | undefined; openingsIn(s0: number, s1: number): readonly Opening[] }
/** 画面系统共享的上下文（§8.4）。 */
export interface ViewContext {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; overlayRoot: HTMLElement;
  bus: Bus; settings: Readonly<Settings>; quality: QualityProfile; rngFx: Rng; stencil: boolean;
  mat: MaterialsAPI; lamps: LampFieldAPI; tex: TextureBank; rig: RigFactory; surfaces: SurfaceIndex; solver: SolverAPI;
}
/** 画面子系统；View 按 order 升序调用（§8.4）。 */
export interface ViewSystem {
  id: string; owner: WpId; order: number;           // 10 world · 20 npc · 30 actors · 40 surfaces · 50 weather · 60 camera
  init(ctx: ViewContext): void | Promise<void>;
  loadChapter?(ch: CompiledChapter): Promise<void>; // 开场卡期间预建；之后不得创建几何体
  onSegment?(seg: CompiledSegment): void;
  onEvent?(e: GameEvent, snap: SimSnapshot): void;
  onReset?(snap: SimSnapshot): void;
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void;
  setQuality?(q: QualityProfile): void;
}
export interface ViewAPI {                                                  // CORE → WP3（View.ts 汇总所有 ViewSystem）
  init(canvas: HTMLCanvasElement, bus: Bus, settings: Settings): Promise<void>;
  loadChapter(ch: CompiledChapter): Promise<void>;
  onEvent(e: GameEvent, snap: SimSnapshot): void;
  onReset(snap: SimSnapshot): void;
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void;
  render(): void;
  setQuality(t: QualityTier): void;
  perf(): PerfStats;
}
export interface KitChunkContext {
  seg: CompiledSegment; variant: string; s0: number; s1: number; stride: number;
  floorY(s: number): number; openings: readonly Opening[];   // 必须按 openings 在墙上留口
  quality: QualityProfile; rng: Rng; mat: MaterialsAPI; tex: TextureBank;
}
/** 一个 chunk 最多 3 个合并几何体 = ≤ 3 次 draw call（§5.9）。坐标：x 横向，y 向上，z = −s。 */
export interface KitChunk { floor: THREE.BufferGeometry; static: THREE.BufferGeometry; emissive?: THREE.BufferGeometry; lamps: LampSpec[] }
export interface EnvKit { id: KitId; owner: WpId; variants: readonly string[]; build(ctx: KitChunkContext): KitChunk; ambience(variant: string): AmbienceId; reverb(variant: string): ReverbId }
export interface StillSet {
  id: SetId; owner: WpId; variants: readonly string[];
  build(ctx: ViewContext, variant: string): THREE.Object3D;          // 开场卡期间预建
  playerAnchor(variant: string): THREE.Matrix4;                      // 主角在这个场景里的位置
  surfaces?(variant: string): Array<{ id: string; plane: THREE.Plane; rect: [number, number, number, number] }>;
  update?(t: number, snap: SimSnapshot): void;
}
export type ArchetypeId = 'footOut' | 'lowBox' | 'bucket' | 'curb' | 'bikeDown' | 'kneeler' | 'tableBar' | 'chairBar' | 'armBar'
  | 'shutter' | 'legs' | 'cart' | 'column' | 'vehicle' | 'stallDoor' | 'crawler' | 'floorDecal' | 'note';
export interface ArchetypeFactory {                                         // WP6
  id: ArchetypeId;
  create(ctx: ViewContext, capacity: number): ArchetypePool;         // 每个原型 1 个 InstancedMesh（legs 由 LegForest 负责）
}
export interface ArchetypePool { readonly object: THREE.Object3D; place(slot: number, o: CompiledObstacle, t: number): void; hit(slot: number, sev: HitSeverity): void; hide(slot: number): void }

/* ——— 角色（WP5）——— */
export interface RigHandle {
  readonly root: THREE.Object3D; readonly mesh: THREE.SkinnedMesh; readonly skeleton: THREE.Skeleton;
  apply(p: Pose): void;
  setThirdHand(extend: number): void;                                // 0..1
  setProps(p: { head?: 'none' | 'tray' | 'bag'; back?: 'none' | 'bag' }): void;
}
export interface PoseHistoryAPI { push(t: number, p: Pose): void; sample(t: number, out: Pose): boolean }
export interface RigFactory { create(role: 'player' | 'double' | 'shadow' | 'leader'): RigHandle; readonly history: PoseHistoryAPI }

/* ——— 声音（WP7）——— */
export interface Volumes { master: number; sfx: number; ambience: number }
export interface AudioAPI {
  readonly enabled: boolean;
  unlock(): Promise<void>;
  onEvent(e: GameEvent, snap: SimSnapshot): void;
  frame(snap: SimSnapshot, dt: number): void;                        // 追随者总线参数、嗡鸣、雨
  setVolumes(v: Volumes): void;
  suspend(on: boolean): void;
  cues(n: number): string[];                                         // 最近的 cue 名，静音时也记录
}

/* ——— 界面与输入（WP8）——— */
export interface GameCommands {
  start(ch: ChapterId, at?: { segment: string; beat: number }): Promise<void>;
  continueGame(): Promise<void>; retry(): void; pause(on: boolean): void; toTitle(): void; nextChapter(): void;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void; resetProgress(): void; skipStill(): void; setSlowOption(on: boolean): void;
}
/**
 * 界面。show(s, data) 的 data 约定（CORE 写入，WP8 可以读更多字段）：
 *   intro → { chapter: ChapterId }；fail → { line: string }；outro → { chapter: ChapterId; stats: RunStats; next: ChapterId | null }；
 *   其余为 undefined。
 */
export interface UIAPI { mount(root: HTMLElement, cmd: GameCommands, save: SaveAPI): void; show(s: ScreenName, data?: unknown): void; onEvent(e: GameEvent, snap: SimSnapshot): void; frame(snap: SimSnapshot, dt: number): void }
export interface InputAPI {
  attach(el: HTMLElement): void;
  drain(): InputEvent[];
  held(): ReadonlySet<Action>;
  device(): Device;
  setContext(c: { kind: 'run' | 'still' | 'stand' | 'menu'; look: boolean; ask: boolean; standHalves: boolean }): void;
  setFlip(on: boolean): void;
  inject(a: Action, phase: 'down' | 'up'): void;                     // 测试钩子用
}

/** 便于各包声明「某事件的数据类型」。 */
export type EventData<K extends keyof GameEvents> = GameEvents[K];
