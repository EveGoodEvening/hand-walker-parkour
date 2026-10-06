// src/levels/schema.ts —— 关卡数据格式（DESIGN.md §8.5）。CORE 冻结。
// 只允许经契约申请（docs/contract-requests/WPx.md）追加可选字段或新的联合成员。
// 记法（§4.0）：跑段的 at 是拍（可以是小数）；静场、站立段与各种 timeline 的 at 是秒。
import type { LineId } from './lines';
import type { ObstacleKind } from './obstacles';
import type { ArchetypeId } from '../core/contracts';
import type {
  AmbienceId, AtmosphereId, BellKind, ChapterId, CrowdOp, FollowerMode, HintId, KitId, Lane, NpcGroupKind, ObstacleClass,
  PoseClipId, SetId, ShadowMode, ShotId, SfxId, Speaker, Surface, TextStyle, ThirdHandGesture,
} from '../core/types';

export type { ObstacleKind, LineId };

export interface ChapterDef {
  id: ChapterId; title: string; name: string;      // '第一章' / '早自习'
  seed: number;
  card: LineId[];                                  // 开场卡原文，1–2 行
  outro: OutroDef;
  notes: NoteDef[];
  requiredBeats: string[];                         // 附录 C：validate 静态检查，e2e 断言已触发
  segments: SegmentDef[];
}
export interface OutroDef { set?: SetId; variant?: string; lines: Array<{ line: LineId } | { input: StillInput; id?: string }> }
export interface NoteDef {
  id: string;
  face: 'blank' | 'doodle';
  front: LineId | null;                            // doodle 旁边写的字（只有 n1-a：「进化失败」）
  back: LineId | null;                             // 只有两张有字：「你后面。」「现在，你后面没有我了。」
  folded: boolean;                                 // true = 到 openedIn 那一段之前打不开（n1-desk）
  pickup: boolean;                                 // false = 剧情自动获得
}

export type SegmentDef = RunSegmentDef | StillSegmentDef | StandSegmentDef;
interface SegmentBase { id: string; atmosphere: AtmosphereId; follower: FollowerDef; }
export interface FollowerDef {
  mode: FollowerMode;
  steady?: number;                                 // 段首稳度；缺省时沿用当前值并截到上限
  steadyMax?: number;                              // 缺省 3；pressure 缺省 2
  lagOverride?: number | null;                     // 拍；3-2 楼梯 = 1
  voice?: 'echo' | 'none';                         // 缺省：behind/pressure/synced/ahead = echo，其余 none
  hud?: 'dots' | 'shadow' | 'none';
  from?: 'behind' | 'front';                       // 2-10 结尾「走廊尽头传来脚步声」= front
}
export interface RunSegmentDef extends SegmentBase {
  kind: 'run';
  kit: KitId; variant: string; surface: Surface;
  beats: number; stride: number; cadence: number | [number, number];
  checkpoints?: number[];                          // 额外检查点（拍）；第 0 拍恒为检查点
  controls?: { jump?: false };                     // 端盘段
  stairs?: { dir: 'down' | 'up'; risePerBeat: number };
  crowd?: boolean;                                 // 人群段：绊倒触发「安静的一秒」；校验「不开口也可解」
  rows?: RowDef[];
  items?: ItemDef[];
  patterns?: PatternUse[];
  npcs?: NpcGroupDef[];
  surfaces?: SurfaceDef[];
  windows?: WindowDef[];
  notes?: NotePlacement[];
  events?: RunEventDef[];                          // at = 拍（可以是小数）
}
export interface StillSegmentDef extends SegmentBase {
  kind: 'still'; set: SetId; variant?: string;
  duration: number;                                // 秒，≤ 15（不含等待输入）
  input?: StillInput;
  events: TimedEventDef[];                         // at = 秒
}
export interface StandSegmentDef extends SegmentBase {
  kind: 'stand'; kit: KitId; variant: string; script: 'dream' | 'sevenSteps';
  duration: number;                                // 秒，≤ 15（不含起身前的等待）
  input?: StillInput;                              // sevenSteps：起身
  events: Array<TimedEventDef | StepEventDef>;
}
export interface StillInput {
  at: number; hint: HintId; mode: 'tap' | 'hold' | 'taps3' | 'any';
  holdSeconds?: number; timeout: number;           // 超时自动完成，不罚
  progress?: Array<{ at: number; line: LineId }>;  // 按住满 at 秒时出字（5-8：一秒、两秒、三秒）
  onDone?: TimedEventDef[];                        // 相对完成时刻
}

export type Cell = '.' | 'L' | 'H' | 'B' | 'W' | ObstacleKind;
/** 行：[拍, 车道 −1/0/1 的三个符号, 深度（拍，可选）]。字符串写法 'B.L' 从左到右（§4.0）。 */
export type RowDef = [beat: number, lanes: string | readonly [Cell, Cell, Cell], lenBeats?: number];
/** 单个障碍；len 的单位是拍。 */
export interface ItemDef { at: number; lane: Lane | readonly Lane[] | 'all'; kind: ObstacleKind; len?: number; id?: string; behavior?: Behavior }
export type Behavior =
  | { type: 'static' }
  | { type: 'stretch'; period: number; phase: number; outFrac: number }   // NPC 自己的节律：伸腿占周期的 outFrac，与玩家无关
  | { type: 'walk'; speed: number }                                       // m/s；正 = 同向，负 = 迎面
  | { type: 'swing'; period: number; phase: number }                      // 坏锁的隔间门
  | { type: 'shift'; atBeat: number; toLane: Lane }                       // 人墙的缝按自己的时间表移动（1.2 s 前鞋尖先转）
  | { type: 'yield'; atBeat: number }                                     // 陈默：到点起身让开（只留下同行 item 里的脚）
  | { type: 'fallInto'; atBeat: number }                                  // 梦中男生摔进车道（≥ 1.2 s 前可见）
  | { type: 'askable'; ignore: boolean | 'seeded' };
export type PatternId = 'tripleVault' | 'zigzag' | 'lowBar' | 'forestGate' | 'wetWeave';
export interface PatternUse { at: number; pattern: PatternId; lane?: Lane; gap?: number; mirror?: boolean }
export interface NpcGroupDef { id?: string; kind: NpcGroupKind; from: number; to: number; side: 'L' | 'R' | 'both'; density: number; gaze?: 'turnShoes' | 'center' | 'none' }
export interface SurfaceDef {
  id: string;
  kind: 'mirror' | 'window' | 'endMirror' | 'puddle' | 'board' | 'carMirror' | 'doorPlate';
  side: 'L' | 'R' | 'end' | 'floor';
  from: number; to: number;                        // 拍
  lane?: Lane; y?: [number, number]; chipped?: boolean;
  backdrop?: 'darkRoom' | 'mirrorChunk' | 'playground' | 'nightStreet' | 'evening';
  text?: string;                                   // doorPlate 专用：「高二（7）班」
}
export interface WindowDef { id?: string; from: number; to: number; type: 'rest' | 'lookBack' | 'ask'; auto?: boolean; gain?: 0 | 1; then?: TimedEventDef[] }
export interface NotePlacement { at: number; lane: Lane; note: string }

export type RunEventDef = { at: number; id?: string } & EventBody;
export type TimedEventDef = { at: number; id?: string } & EventBody;
export type StepEventDef = { atStep: number; delay?: number; id?: string } & EventBody;

export type EventBody =
  /* —— 模拟类：Sim 处理，确定性 —— */
  | { type: 'follower'; def: Partial<FollowerDef> }
  | { type: 'twitch'; hold: number; say?: LineId }                          // hold：需按住 ↓ 的秒数；say：第一次压住时的字幕
  | { type: 'drift'; dir: -1 | 1; say?: LineId }
  | { type: 'slow'; speed: number; seconds: number; ramp?: number; timeline?: TimedEventDef[] }
  | { type: 'stop'; seconds: number; timeline: TimedEventDef[] }
  | { type: 'autoCrawl'; speed: number; seconds: number }                   // 停拍 / 静场里的自动爬行（照常发出触地事件）
  | { type: 'cadence'; to: number; beats: number }
  | { type: 'noteGet'; note: string }
  | { type: 'leader'; op: 'appear' | 'recede' }
  | { type: 'hush'; beats?: number; seconds?: number }                      // Sim 置 hush 标志；声音由 WP7 处理
  | { type: 'flip'; on: boolean }                                           // Sim 置 flip 标志；画面与输入各自响应
  | { type: 'end' }
  /* —— 表现类：按 CUE_OWNER 分发 —— */
  | { type: 'text'; line: LineId | readonly LineId[]; style?: TextStyle; speaker?: Speaker; pan?: number }
  | { type: 'hint'; hint: HintId }
  | { type: 'double'; spec: DoubleSpec }
  | { type: 'doubleMod'; target: string; mod: DoubleMod }
  | { type: 'doubleEnd'; target: string; fade?: number }
  | { type: 'shadow'; mode: ShadowMode; seconds?: number }
  | { type: 'memory'; what: 'handstandWindow'; surface: string; seconds: number }
  | { type: 'actor'; clip: PoseClipId; seconds?: number }                   // 主角在静场 / 停拍中的脚本姿势
  | { type: 'board'; surface: string; op: 'write' | 'wipe'; line?: LineId; tremble?: boolean; byPlayer?: boolean }
  | { type: 'lights'; op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings'; from?: number; to?: number; every?: number; delay?: number }
  | { type: 'atmosphere'; id: AtmosphereId; seconds: number }
  | { type: 'fog'; near: number; far: number; seconds: number }
  | { type: 'rain'; intensity: number; seconds: number }
  | { type: 'bell'; kind: BellKind }
  | { type: 'sfx'; sfx: SfxId; pan?: number; gain?: number }
  | { type: 'ambience'; amb: AmbienceId; level: number; seconds: number }
  | { type: 'silence'; seconds: number }
  | { type: 'crowd'; group: string; op: CrowdOp }
  | { type: 'camera'; shot: ShotId; seconds: number }
  | { type: 'overlay'; op: 'palmHeat' | 'palmNumb' | 'coldFade' | 'desaturate' | 'eyesClosed' | 'black' | 'clear'; seconds: number }
  | { type: 'count'; from: number; to: number; ghostLag?: number }          // 之后每次落掌计一个数
  | { type: 'noteOpen'; note: string }
  | { type: 'hud'; op: 'followerFadeOutBehind' | 'followerFadeInAhead' | 'show' | 'hide' }
  | { type: 'beat' };                                                       // 纯标记：配合 id 表示必备节拍

export interface DoubleSpec {
  id: string;
  surface: string | 'world';                       // SurfaceDef.id / StillSet 的 surface id / 'world'
  source: 'history' | 'oracle' | 'script';
  delay?: number;                                  // 秒（history）；缺省 0.35
  lead?: number;                                   // 秒（oracle）
  clip?: PoseClipId;                               // script
  headLag?: number; headDownHold?: number;         // 秒
  thirdHand?: { gesture: ThirdHandGesture; at: number; hold: number };
  anchor?: { sAhead?: number; lane?: Lane; speed?: number };   // world：相对玩家的位置与速度（负 = 迎面）
  avoidPlayerLane?: boolean;                       // 5-6 站着的「我」：永远走相邻车道，不碰撞
  attachBehind?: string;                           // 5-4：站在另一个替身身后
  ttl?: number;
}
export type DoubleMod = Partial<Pick<DoubleSpec, 'delay' | 'headLag' | 'headDownHold' | 'thirdHand' | 'clip'>> & { speedFactor?: number; stopAtDistance?: number };

/* —— 编译产物（compile.ts 生成；纯数据，Node 可测）—— */
export interface CompiledChapter { def: ChapterDef; segments: CompiledSegment[]; length: number; seed: number }
export interface CompiledSegment {
  def: SegmentDef; index: number; kind: 'run' | 'still' | 'stand';
  s0: number; s1: number; stride: number;
  /** 名义步频（不含减速、停拍、受击）。 */
  cadenceAt(beat: number): number; timeAt(beat: number): number; beatAt(t: number): number; floorY(s: number): number;
  obstacles: CompiledObstacle[]; surfaces: CompiledSurface[]; windows: CompiledWindow[]; npcGroups: NpcGroupDef[];
  events: Array<{ at: number; id?: string; body: EventBody }>;   // 已按 at 排序
  checkpoints: number[];                                           // 拍
}
export interface CompiledObstacle {
  id: number; kind: ObstacleKind; cls: ObstacleClass; archetype: ArchetypeId;
  lanes: Lane[]; beat: number; s0: number; s1: number; y0: number; y1: number; halfW: number;
  behavior: Behavior; npc: boolean; params: Readonly<Record<string, number | string>>;
}
export interface CompiledSurface extends SurfaceDef { s0: number; s1: number; plane: [number, number, number, number] }
export interface CompiledWindow extends WindowDef { s0: number; s1: number }
