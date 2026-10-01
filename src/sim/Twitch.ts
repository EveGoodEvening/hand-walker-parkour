// src/sim/Twitch.ts —— 腿自主抬起与「按住它」（DESIGN.md §3「按住它」、§2.4 twitch、§2.8 R9）。WP1。
// 状态机只有三格：idle → warn（预警 0.6 s：鞋底翻起、肌肉声）→ rise（腿抬成站姿的半成品 1.2 s：碰撞高 0.85 m，速度 ×0.85）→ idle。
// 压住：从预警开始，连续按住 ↓ 满 need 秒（缺省 0.25 s，第五章 0.5 s）就压住。
//   · 在预警里压住：腿根本不会抬起来（数据保证第二章起它落在横档前 0.4 s，一次 ↓ 同时完成按住和伏低）。
//   · 在抬起过程中压住：腿被按回去，抬起提前结束（「我伸手按住它。」「它不动了。」）。
// 与玩家的位置、车道无关，只取决于时间和 ↓ 是否按住，所以 Sim 与 Solver 用同一份函数逐 tick 推进（状态平铺在 PlayerState 上）。
import { TUNING } from './tuning';

const TW = TUNING.twitch;

export const TW_IDLE = 0;
export const TW_WARN = 1;
export const TW_RISE = 2;

/** Twitch 用到的 PlayerState 字段（平铺，便于求解器浅拷贝）。 */
export interface TwitchBody { twPhase: 0 | 1 | 2; twT: number; twNeed: number; twHeld: number; twitch: number }
export type TwitchOutcome = 'rise' | 'suppressed' | 'end' | null;

/** 开始一次腿自主抬起（段内 twitch 事件）。hold 缺省 0.25 s。 */
export function twitchStart(b: TwitchBody, hold?: number): void {
  b.twPhase = TW_WARN;
  b.twT = 0;
  b.twNeed = hold !== undefined && hold > 0 ? hold : TW.holdDefault;
  b.twHeld = 0;
  b.twitch = 0;
}

/** 推进一个 tick。downHeld = ↓ 此刻是否按住。返回本 tick 发生的相位变化。 */
export function twitchUpdate(b: TwitchBody, dt: number, downHeld: boolean): TwitchOutcome {
  if (b.twPhase === TW_IDLE) return null;
  b.twT += dt;
  b.twHeld = downHeld ? b.twHeld + dt : 0;
  if (b.twHeld >= b.twNeed - 1e-9) {
    b.twPhase = TW_IDLE; b.twT = 0; b.twHeld = 0; b.twitch = 0;
    return 'suppressed';
  }
  if (b.twPhase === TW_WARN && b.twT >= TW.warn - 1e-9) {
    b.twPhase = TW_RISE; b.twT = 0; b.twitch = 1;
    return 'rise';
  }
  if (b.twPhase === TW_RISE && b.twT >= TW.rise - 1e-9) {
    b.twPhase = TW_IDLE; b.twT = 0; b.twHeld = 0; b.twitch = 0;
    return 'end';
  }
  return null;
}

/** 抬起期间的速度倍率（×0.85）。 */
export function twitchSpeedMul(b: TwitchBody): number { return b.twPhase === TW_RISE ? TW.speedMul : 1; }

/** 画面用的抬起程度 0..1：预警时鞋底翻起（到 0.2），抬起时 0.15 s 内升到 1。 */
export function twitchVisual(b: TwitchBody): number {
  if (b.twPhase === TW_WARN) return 0.2 * Math.min(1, b.twT / TW.warn);
  if (b.twPhase === TW_RISE) return Math.min(1, 0.2 + (0.8 * b.twT) / 0.15);
  return 0;
}

/** 压住需要的时刻（相对预警开始，秒）：按下时刻 + need；晚于 warn 就意味着腿会先抬起来。 */
export function twitchSuppressDeadline(): number { return TW.warn; }
