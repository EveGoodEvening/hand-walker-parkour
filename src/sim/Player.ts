// src/sim/Player.ts —— 玩家控制器：换道、撑跃、伏低、空中速降、输入缓冲、受击后的速度恢复（DESIGN.md §2.2、§2.4、§2.5）。
// CORE 编写，归 WP1。里程 s 由 Pace 推进（Sim 持有），这里只管横向、竖直与动作状态。
// WP1：腿自主抬起（Twitch.ts）与腿偏移（Drift.ts）的状态也放在这里，而且全部是**平铺的数值字段**：
// 求解器用 Object.assign 复制 PlayerState，嵌套对象会被共享，所以这里不放任何对象。
import { LANE_WIDTH } from '../core/constants';
import { clamp, easeOutCubic } from '../core/math';
import type { Lane, PlayerMode } from '../core/types';
import { TUNING } from './tuning';

const T = TUNING;

export function laneX(l: Lane): number { return l * LANE_WIDTH; }
export function clampLane(n: number): Lane | null { return n < -1 || n > 1 ? null : (n as Lane); }
/** 撑跃滞空时间：3 拍，限制在 [0.48, 0.72] s（§2.4）。 */
export function jumpDuration(cadence: number): number {
  return clamp(T.jump.beats / Math.max(0.1, cadence), T.jump.minSec, T.jump.maxSec);
}
/** 撑跃高度曲线：顶点 0.60 m 的抛物线。 */
export function jumpHeight(airT: number, airDur: number): number {
  const u = clamp(airT / airDur, 0, 1);
  return 4 * T.jump.peak * u * (1 - u);
}
/** 换道的横向位置：easeOutCubic。 */
export function laneLerp(fromX: number, toX: number, t: number, dur: number): number {
  return fromX + (toX - fromX) * easeOutCubic(dur <= 0 ? 1 : t / dur);
}

export class PlayerState {
  x = 0;
  y = 0;
  lane: Lane = 0;
  laneTarget: Lane = 0;
  laneFromX = 0;
  laneT = 0;
  laneDur = 0;
  laneQueue: Lane | null = null;
  /** 上一次稳定所在的车道（侧碰弹回用）。 */
  laneSettled: Lane = 0;

  air = false;
  airT = 0;
  airDur = 0;
  /** 速降：从 fastFallY 在 fastFall 秒内落地。 */
  fastFall = false;
  fastFallT = 0;
  fastFallY = 0;
  duckAfterLandBeats = 0;

  ducking = false;
  duck = 0;                    // 0..1 混合
  duckStartBeat = 0;
  duckHeld = false;
  duckMinBeats: number = T.duck.minBeats;

  jumpBuffer = 0;              // 剩余缓冲时间（秒）
  duckBuffer = 0;

  hitMul = 1;
  stumbleT = 0;                // 绊的恢复计时
  crashT = -1;                 // 撞的计时（< 0 表示没有）
  graceT = 0;
  mode: PlayerMode = 'crawl';
  modeT = 0;
  onSoft = false;
  surfaceSoftKind: 'water' | 'leavesWet' | null = null;
  /** 腿抬起（碰撞用，0 或 1）：只有 rise 阶段为 1（碰撞盒高 0.85 m，§2.5）。 */
  twitch = 0;
  /** 鞋尖偏转（画面用，−1..1）。 */
  drift = 0;
  /** 腿自主抬起：0 idle · 1 warn（预警 0.6 s）· 2 rise（1.2 s）。见 Twitch.ts。 */
  twPhase: 0 | 1 | 2 = 0;
  twT = 0;
  /** 压住需要连续按住 ↓ 的秒数（缺省 0.25，第五章 0.5）。 */
  twNeed = 0.25;
  /** 已连续按住 ↓ 的秒数。 */
  twHeld = 0;
  /** 腿偏移：0 idle · 1 warn（0.6 s）。见 Drift.ts。 */
  drPhase: 0 | 1 = 0;
  drT = 0;
  drDir: -1 | 1 = 1;

  /** 复制全部字段（求解器每个节点都要复制一份；比 Object.assign 快得多）。新增字段时这里也要加，单元测试会核对。 */
  copyFrom(o: PlayerState): this {
    this.x = o.x;
    this.y = o.y;
    this.lane = o.lane;
    this.laneTarget = o.laneTarget;
    this.laneFromX = o.laneFromX;
    this.laneT = o.laneT;
    this.laneDur = o.laneDur;
    this.laneQueue = o.laneQueue;
    this.laneSettled = o.laneSettled;
    this.air = o.air;
    this.airT = o.airT;
    this.airDur = o.airDur;
    this.fastFall = o.fastFall;
    this.fastFallT = o.fastFallT;
    this.fastFallY = o.fastFallY;
    this.duckAfterLandBeats = o.duckAfterLandBeats;
    this.ducking = o.ducking;
    this.duck = o.duck;
    this.duckStartBeat = o.duckStartBeat;
    this.duckHeld = o.duckHeld;
    this.duckMinBeats = o.duckMinBeats;
    this.jumpBuffer = o.jumpBuffer;
    this.duckBuffer = o.duckBuffer;
    this.hitMul = o.hitMul;
    this.stumbleT = o.stumbleT;
    this.crashT = o.crashT;
    this.graceT = o.graceT;
    this.mode = o.mode;
    this.modeT = o.modeT;
    this.onSoft = o.onSoft;
    this.surfaceSoftKind = o.surfaceSoftKind;
    this.twitch = o.twitch;
    this.drift = o.drift;
    this.twPhase = o.twPhase;
    this.twT = o.twT;
    this.twNeed = o.twNeed;
    this.twHeld = o.twHeld;
    this.drPhase = o.drPhase;
    this.drT = o.drT;
    this.drDir = o.drDir;
    return this;
  }

  reset(lane: Lane = 0): void {
    this.x = laneX(lane); this.y = 0; this.lane = lane; this.laneTarget = lane; this.laneFromX = this.x; this.laneT = 0; this.laneDur = 0;
    this.laneQueue = null; this.laneSettled = lane;
    this.air = false; this.airT = 0; this.airDur = 0; this.fastFall = false; this.fastFallT = 0; this.fastFallY = 0; this.duckAfterLandBeats = 0;
    this.ducking = false; this.duck = 0; this.duckStartBeat = 0; this.duckHeld = false; this.duckMinBeats = T.duck.minBeats;
    this.jumpBuffer = 0; this.duckBuffer = 0;
    this.hitMul = 1; this.stumbleT = 0; this.crashT = -1; this.graceT = 0;
    this.mode = 'crawl'; this.modeT = 0; this.onSoft = false; this.surfaceSoftKind = null; this.twitch = 0; this.drift = 0;
    this.twPhase = 0; this.twT = 0; this.twNeed = T.twitch.holdDefault; this.twHeld = 0;
    this.drPhase = 0; this.drT = 0; this.drDir = 1;
  }

  get moving(): boolean { return this.laneT < this.laneDur; }

  /** 开始换道。dir = −1 左、+1 右。返回是否接受（越界忽略；进行中则排队 1 次）。 */
  laneInput(dir: -1 | 1, wet: boolean): boolean {
    if (this.moving) {
      const base = this.laneQueue ?? this.laneTarget;
      const q = clampLane(base + dir);
      if (q === null || this.laneQueue !== null) return false;
      this.laneQueue = q;
      return true;
    }
    const target = clampLane(this.laneTarget + dir);
    if (target === null) return false;
    this.startLane(target, wet);
    return true;
  }

  startLane(target: Lane, wet: boolean, dur?: number): void {
    this.laneFromX = this.x;
    this.laneTarget = target;
    this.laneT = 0;
    this.laneDur = dur ?? (wet ? T.laneChange.wet : T.laneChange.dry);
  }

  /** 横向推进一个 tick。 */
  updateLane(dt: number, wet: boolean): void {
    if (this.laneT < this.laneDur) {
      this.laneT = Math.min(this.laneDur, this.laneT + dt);
      this.x = laneLerp(this.laneFromX, laneX(this.laneTarget), this.laneT, this.laneDur);
      if (this.laneT >= this.laneDur) {
        this.x = laneX(this.laneTarget);
        this.laneSettled = this.laneTarget;
        if (this.laneQueue !== null) { const q = this.laneQueue; this.laneQueue = null; this.startLane(q, wet); }
      }
    }
    this.lane = clamp(Math.round(this.x / LANE_WIDTH), -1, 1) as Lane;
  }

  startJump(cadence: number): void {
    this.air = true; this.airT = 0; this.airDur = jumpDuration(cadence);
    this.fastFall = false; this.ducking = false; this.duckHeld = false;
    this.jumpBuffer = 0;
  }

  startDuck(beat: number, minBeats: number = T.duck.minBeats): void {
    this.ducking = true; this.duckStartBeat = beat; this.duckHeld = true; this.duckMinBeats = minBeats;
    this.duckBuffer = 0;
  }

  startFastFall(): void {
    if (!this.air || this.fastFall) return;
    this.fastFall = true; this.fastFallT = 0; this.fastFallY = this.y;
    this.duckAfterLandBeats = T.jump.fastFallDuckBeats;
  }

  /** 竖直推进；返回是否在本 tick 落地。 */
  updateAir(dt: number): boolean {
    if (!this.air) { this.y = 0; return false; }
    if (this.fastFall) {
      this.fastFallT += dt;
      const k = clamp(this.fastFallT / T.jump.fastFall, 0, 1);
      this.y = this.fastFallY * (1 - k);
      if (k >= 1) { this.air = false; this.y = 0; return true; }
      return false;
    }
    this.airT += dt;
    if (this.airT >= this.airDur) { this.air = false; this.y = 0; return true; }
    this.y = jumpHeight(this.airT, this.airDur);
    return false;
  }

  /** 伏低推进：beat 为当前段内拍号。 */
  updateDuck(dt: number, beat: number): void {
    if (this.ducking) {
      const elapsed = beat - this.duckStartBeat;
      const minDone = elapsed >= this.duckMinBeats;
      if ((minDone && !this.duckHeld) || elapsed >= T.duck.maxBeats) this.ducking = false;
    }
    const target = this.ducking ? 1 : 0;
    const rate = 1 / T.duck.blend;
    this.duck = target > this.duck ? Math.min(target, this.duck + rate * dt) : Math.max(target, this.duck - rate * dt);
  }

  /** 受击后的速度倍率恢复（绊 ×0.7 → 1 用 0.8 s；撞停 0.3 s 再用 0.8 s 恢复）。 */
  updateHit(dt: number): void {
    if (this.graceT > 0) this.graceT = Math.max(0, this.graceT - dt);
    if (this.crashT >= 0) {
      this.crashT += dt;
      const { crashStop, crashRecover } = T.hit;
      if (this.crashT < crashStop) this.hitMul = 0;
      else if (this.crashT < crashStop + crashRecover) this.hitMul = (this.crashT - crashStop) / crashRecover;
      else { this.hitMul = 1; this.crashT = -1; }
    } else if (this.stumbleT > 0) {
      this.stumbleT = Math.max(0, this.stumbleT - dt);
      const k = 1 - this.stumbleT / T.hit.stumbleRecover;
      this.hitMul = T.hit.stumbleSpeedMul + (1 - T.hit.stumbleSpeedMul) * k;
    } else {
      this.hitMul = 1;
    }
  }

  stumble(): void { this.stumbleT = T.hit.stumbleRecover; this.crashT = -1; this.hitMul = T.hit.stumbleSpeedMul; this.graceT = T.hit.grace; }
  crash(): void { this.crashT = 0; this.stumbleT = 0; this.hitMul = 0; this.graceT = T.hit.grace; }
  get crashStopped(): boolean { return this.crashT >= 0 && this.crashT < T.hit.crashStop; }
}
