// src/core/events.ts —— 模拟事件表（DESIGN.md §8.4、§8.7）。CORE 冻结。
// GameEvents 是 interface：各包只能在自己的 src/<pkg>/events.d.ts 里用 declaration merging 追加**新事件名**，
// 不得修改已有字段（§8.11）。
import type { EventBody, ObstacleKind } from '../levels/schema';
import type { Settings } from './settings';
import type {
  ChapterId, ContactPart, FollowerSnap, Hand, HintId, HitSeverity, Lane, QualityTier, RunStats, ScreenName, Surface,
} from './types';

export interface GameEvents {
  /** 三段触地的一个子事件；t 为模拟时钟秒（§2.3）。 */
  'contact':         { hand: Hand; part: ContactPart; t: number; s: number; x: number; surface: Surface; crisp: boolean; heavy: boolean };
  /** 追随者的触地（自己的触地延迟重放，§2.6）。t 为模拟时钟秒。 */
  'followerContact': { hand: Hand; part: ContactPart; t: number; lagBeats: number; steady: number; from: 'behind' | 'front' };
  'action':          { kind: 'lane' | 'jump' | 'duck' | 'fastFall' | 'hold' | 'look' | 'ask' | 'straighten'; crisp: boolean; dir?: -1 | 1 };
  'land':            { surface: Surface; heavy: boolean };
  'hit':             { severity: HitSeverity; kind: ObstacleKind; obstacleId: number; lane: Lane; steady: number; crowd: boolean; firstLegHit: boolean };
  'nearMiss':        { kind: ObstacleKind; side: -1 | 1 };
  'steady':          { value: number; max: number };
  'fall':            { cause: ObstacleKind; surface: Surface };
  'retry':           { segment: string; beat: number };
  'checkpoint':      { segment: string; beat: number };
  'segment':         { id: string; index: number; kind: 'run' | 'still' | 'stand' };
  'chapter:start':   { id: ChapterId };
  'chapter:end':     { id: ChapterId; stats: RunStats };
  /** 拾取或剧情获得纸条（§3「纸条」）。 */
  'note':            { id: string; auto: boolean };
  'twitch':          { phase: 'warn' | 'rise' | 'suppressed' | 'end' };
  'drift':           { phase: 'warn' | 'moved' | 'countered'; dir: -1 | 1 };
  'stand':           { phase: 'rise' | 'risen' | 'step' | 'plant' | 'fall'; step?: number; theta?: number };
  'lookBack':        { phase: 'start' | 'end'; gain: 0 | 1; auto: boolean };
  'ask':             { targetId: number; result: 'part' | 'ignore' };
  /** 情境与提示变化：hint 为当前应显示的操作提示；context 为情境按钮可用性（§2.2）。 */
  'prompt':          { hint: HintId | null; context: { look: boolean; ask: boolean } };
  'follower':        FollowerSnap;
  /** 表现类事件，按 CUE_OWNER 分发（§8.7）。 */
  'cue':             { id?: string; body: EventBody; segment: string };
  /** 必备节拍已触发（附录 C）。 */
  'beat':            { id: string };
  'screen':          { name: ScreenName };
  'pause':           { on: boolean };
  'settings':        Settings;
  'quality':         { tier: QualityTier };
}
export type GameEventName = keyof GameEvents;
export type GameEvent = { [K in GameEventName]: { type: K; tick: number; data: GameEvents[K] } }[GameEventName];
/** 事件总线（core/bus.ts 实现）。on() 返回取消订阅函数。 */
export interface Bus {
  on<K extends GameEventName>(k: K, fn: (d: GameEvents[K], tick: number) => void): () => void;
  emit<K extends GameEventName>(k: K, d: GameEvents[K]): void;
}
