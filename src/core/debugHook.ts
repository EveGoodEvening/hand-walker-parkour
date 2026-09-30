// src/core/debugHook.ts —— 测试钩子 window.__game（DESIGN.md §8.8）。CORE 冻结。
// window.__game 始终存在。只读方法随时可用；会改变状态的方法只在 ?test=1 或 ?debug=… 时可用，否则抛 Error('debug disabled')。
// 依赖后续包的方法（例如 poseTest）在对应包注册扩展之前返回文档规定的默认值（undefined），不抛错。
import type { PerfStats, Plan } from './contracts';
import type { Game } from './Game';
import type { GameEventName } from './events';
import { getDebugExt } from './registry';
import type { Settings } from './settings';
import type { Action, ChapterId, FollowerSnap, HintId, Lane, ObstacleClass, PlayerMode, QualityTier, ScreenName } from './types';
import type { ObstacleKind } from '../levels/obstacles';
import { availableChapters } from '../levels/chapters/index';

declare const __APP_VERSION__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export interface GameDebugAPI {
  readonly version: string;                                 // package 版本 + 构建时间
  readonly ready: Promise<void>;                            // 纹理、首章 chunk、首帧都已就绪
  getState(): DebugState;
  screen(): ScreenName;
  setSeed(seed: number): void;
  start(ch: ChapterId, o?: { segment?: string; beat?: number; skipCards?: boolean }): Promise<void>;
  goto(segment: string, beat?: number): void;
  pause(): void; resume(): void;
  step(ticks?: number, o?: { render?: boolean }): DebugState;   // 同步推进 N 个 tick（1/120 s），默认 1
  advance(ms: number, o?: { render?: boolean }): DebugState;    // = step(Math.round(ms × 0.12))
  render(): void;                                               // test 模式下手动渲染一帧
  input(a: Action, phase?: 'tap' | 'down' | 'up'): void;        // tap = 按下，下一 tick 松开
  setAutopilot(mode: 'off' | 'perfect' | 'human'): void;
  setInvincible(on: boolean): void;
  setQuality(t: QualityTier): void;
  setTimeScale(k: number): void;
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;
  unlockAll(): void;
  skipStill(): void;
  perf(): PerfStats;                                            // renderer.info（autoReset = false，每帧手动 reset）
  obstaclesAhead(meters: number): Array<{ id: number; kind: ObstacleKind; cls: ObstacleClass; lanes: Lane[]; ds: number; beat: number }>;
  events(n?: number): Array<{ tick: number; type: GameEventName; data: unknown }>;   // 环形日志，容量 4096
  cues(n?: number): string[];                                   // 最近的音频 cue（静音时也记录）
  beats(): string[];                                            // 本章已触发的必备节拍 id
  hash(): string;                                               // 模拟状态哈希
  plan(segment?: string): Plan | null;                          // 求解器结果
  poseTest(name: 'crawl' | 'jump' | 'duck' | 'twitch' | 'stand' | 'thirdHand' | 'shadowThreeHands'): void;
  ext: Record<string, (...a: unknown[]) => unknown>;            // registerDebug 注册的扩展
}
export interface DebugState {
  screen: ScreenName; chapter: ChapterId | null; segment: string | null; segKind: 'run' | 'still' | 'stand' | null;
  checkpoint: { segment: string; beat: number } | null; tick: number; t: number;
  s: number; beat: number; lane: Lane; x: number; y: number; mode: PlayerMode; speed: number;
  steady: number; steadyMax: number; follower: FollowerSnap;
  falls: number; stumbles: number; crashes: number; lookBacks: number; notes: string[];
  hush: boolean; flip: boolean; paused: boolean; quality: QualityTier; seed: number;
  text: string[]; hint: HintId | null;
}

function version(): string {
  const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const b = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';
  return `${v}+${b}`;
}

export function createDebugAPI(game: Game): GameDebugAPI {
  const guard = () => { if (!game.params.debugEnabled) throw new Error('debug disabled'); };
  const state = (): DebugState => {
    const n = game.next;
    const booted = !!n;
    const p = n?.player;
    return {
      screen: game.screenName, chapter: game.chapterId, segment: n?.segment ?? null, segKind: n?.segKind ?? null,
      checkpoint: n ? { ...n.checkpoint } : null, tick: n?.tick ?? 0, t: n?.t ?? 0,
      s: p?.s ?? 0, beat: p?.beat ?? 0, lane: p?.lane ?? 0, x: p?.x ?? 0, y: p?.y ?? 0, mode: p?.mode ?? 'crawl', speed: p?.speed ?? 0,
      steady: p?.steady ?? 0, steadyMax: p?.steadyMax ?? 0,
      follower: n?.follower ?? { mode: 'hidden', voice: 'none', hud: 'none', from: 'behind', lagBeats: 0, distance: 0, leaderS: null, leaderLane: null },
      falls: n?.stats.falls ?? 0, stumbles: n?.stats.stumbles ?? 0, crashes: n?.stats.crashes ?? 0, lookBacks: n?.stats.lookBacks ?? 0,
      notes: n ? [...n.stats.notes] : [],
      hush: n?.hush ?? false, flip: n?.flip ?? false, paused: game.paused, quality: game.quality,
      seed: game.seed ?? game.compiled?.seed ?? 0,
      text: booted ? game.currentText() : [], hint: booted ? game.currentHint() : null,
    };
  };
  const api: GameDebugAPI = {
    version: version(),
    ready: game.ready,
    getState: state,
    screen: () => game.screenName,
    setSeed(seed) { guard(); game.seed = seed >>> 0; },
    async start(ch, o = {}) { guard(); await game.startWith(ch, { ...o, skipCards: o.skipCards ?? false }); },
    goto(segment, beat = 0) {
      guard();
      game.sim.goto(segment, beat);
      game.afterJump();
      if (game.screenName !== 'play') game.setScreen('play');
    },
    pause() { guard(); game.pause(true); },
    resume() { guard(); game.pause(false); },
    step(ticks = 1, o = {}) { guard(); game.stepTicks(Math.max(0, Math.floor(ticks)), o.render === true); return state(); },
    advance(ms, o = {}) { guard(); game.stepTicks(Math.max(0, Math.round(ms * 0.12)), o.render === true); return state(); },
    render() { guard(); game.renderFrame(1, 0); },
    input(a, phase = 'tap') {
      guard();
      if (phase === 'tap') game.tapAction(a);
      else game.input.inject(a, phase);
    },
    setAutopilot(mode) { guard(); game.autopilot = mode; game.sim.setAutopilot(mode); },
    setInvincible(on) { guard(); game.sim.setInvincible(on); },
    setQuality(t) { guard(); game.setQuality(t); },
    setTimeScale(k) { guard(); game.loop.timeScale = Math.max(0, k); },
    setSetting(k, v) { guard(); game.setSetting(k, v); },
    unlockAll() { guard(); game.save.patch({ unlocked: availableChapters() }); },
    skipStill() { guard(); game.skipStill(); },
    perf: () => game.view?.perf() ?? { fps: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, simMs: 0, frameMs: 0 },
    obstaclesAhead: (m) => (game.sim?.obstaclesAhead?.(m) ?? []) as Array<{ id: number; kind: ObstacleKind; cls: ObstacleClass; lanes: Lane[]; ds: number; beat: number }>,
    events: (n = 4096) => game.log.slice(-Math.max(0, n)),
    cues: (n = 50) => game.audio?.cues(n) ?? [],
    beats: () => (game.next ? [...game.next.beatsFired] : []),
    hash: () => game.sim?.hash() ?? '',
    plan(segment?: string) {
      const ch = game.compiled;
      if (!ch) return null;
      const target = ch.segments.find((s) => s.def.id === (segment ?? game.next?.segment));
      if (target && target.kind !== 'run') return null; // 静场、站立段没有求解计划
      if (!segment || segment === game.next?.segment) {
        const cur = game.sim.currentPlan?.();
        if (cur) return cur;
      }
      const seg = ch.segments.find((s) => s.def.id === (segment ?? game.next?.segment));
      return seg ? game.solver.solve(seg) : null;
    },
    poseTest(name) {
      guard();
      const f = getDebugExt().poseTest;
      if (f) f(name);
    },
    get ext() {
      // CORE 内置扩展 + 各包 registerDebug 注册的扩展
      return {
        requiredBeats: () => game.compiled?.def.requiredBeats ?? [],
        unhandledCues: (n?: unknown) => game.cues.unhandled(typeof n === 'number' ? n : 50),
        failCount: () => game.failCountAtCheckpoint(),
        ...getDebugExt(),
      };
    },
  };
  return api;
}

export function installDebugHook(game: Game): GameDebugAPI {
  const api = createDebugAPI(game);
  (globalThis as { __game?: GameDebugAPI }).__game = api;
  return api;
}
