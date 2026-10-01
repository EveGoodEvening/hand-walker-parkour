// tests/unit/sim/fixtures.ts —— WP1 的合成章节与测试工具（DESIGN.md §8.10 WP1；lead 补充要求 6：
// 第二到五章由 WP2 并行编写，这里用小型合成段落覆盖每一个新机制，严格按 §8.5 schema 与 §4 的描述）。
// MECH_RUN：只含跑段的「机制章」，校验器必须零 error（腿自主抬起落在横档前 0.4 s、腿偏移、回头窗口、rest / ask 窗口上的必备节拍、人群段与让一下、
//   周期 / 移动 / 到点障碍、减速、停拍与自动爬行、段中换挡、楼梯、端盘、施压、lagOverride、前方的它、画面翻转、静音段）。
// MECH_STILL：静场与站立段（hold + progress、tap、taps3、any、梦中站立、七步），只测模拟行为。
import type { GameEvent } from '../../../src/core/events';
import type { Action, InputEvent } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, RunSegmentDef, SegmentDef, StandSegmentDef, StillSegmentDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';

export function runSeg(o: Partial<RunSegmentDef> = {}): RunSegmentDef {
  return {
    id: 's1', kind: 'run', kit: 'placeholder', variant: 'default', atmosphere: 'morning', surface: 'terrazzo',
    beats: 200, stride: 1, cadence: 4.8, follower: { mode: 'behind', steady: 3 }, ...o,
  };
}
export function stillSeg(o: Partial<StillSegmentDef> = {}): StillSegmentDef {
  return { id: 'st', kind: 'still', set: 'placeholder', atmosphere: 'morning', duration: 4, follower: { mode: 'hidden' }, events: [], ...o };
}
export function standSeg(o: Partial<StandSegmentDef> = {}): StandSegmentDef {
  return { id: 'sd', kind: 'stand', kit: 'track', variant: 'default', atmosphere: 'overcast', script: 'sevenSteps', duration: 10, follower: { mode: 'absent' }, events: [], ...o };
}
export function chapter(segments: SegmentDef[], o: Partial<ChapterDef> = {}): ChapterDef {
  return {
    id: 'test', title: '测试', name: '测试', seed: 7, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
    segments, ...o,
  };
}

/** 七步（5-8 的结构）。 */
export const SEVEN: StandSegmentDef = standSeg({
  id: 'seven', duration: 11,
  input: {
    at: 0.5, hint: 'rise', mode: 'hold', holdSeconds: 3, timeout: 12,
    progress: [{ at: 1, line: 'c1.note' }, { at: 2, line: 'c1.duty' }, { at: 3, line: 'c1.holdIt' }],
    onDone: [{ at: 0.2, type: 'text', line: 'c1.footMoved', id: 'rightFootMoved' }],
  },
  events: [
    { at: 0, type: 'hint', hint: 'rise' },
    { atStep: 2, type: 'text', line: 'c1.stopped', id: 'almostFell' },
    { atStep: 3, type: 'text', line: 'c1.waiting' },
    { atStep: 7, type: 'text', line: 'c1.empty', id: 'seventhFall' },
    { atStep: 7, delay: 1.6, type: 'text', line: 'c1.iSaw', id: 'afterFall' },
  ],
});

/** 梦中站立（4-3 的结构）。 */
export const DREAM: StandSegmentDef = standSeg({
  id: 'dream', kit: 'plaza', variant: 'bright', atmosphere: 'dream', script: 'dream', duration: 8,
  events: [{ at: 0.3, type: 'text', line: 'c1.leaveClass', id: 'dreamStand' }, { at: 5.5, type: 'crowd', group: 'crawlers', op: 'crawlOvertake' }],
});

/** 只含跑段的机制章：校验器零 error。 */
export const MECH_RUN: ChapterDef = chapter([
  // m-1：教撑跃、伏低、换道；第二章式的腿自主抬起（抬起落在横档前 0.4 s）；回头窗口
  runSeg({
    id: 'm-1', beats: 96, cadence: 4.8, follower: { mode: 'behind', steady: 3 },
    rows: [[12, '.L.'], [30, 'HHH'], [44, '..B'], [52, 'L..'], [84, '.B.']],
    notes: [{ at: 18, lane: 0, note: 'nx' }],
    windows: [{ id: 'lookT', from: 60, to: 70, type: 'lookBack', auto: true, gain: 1, then: [{ at: 0, type: 'text', line: 'c1.empty' }, { at: 0.9, type: 'shadow', mode: 'jellyfish', seconds: 2 }] }],
    events: [
      { at: 4, type: 'hint', hint: 'jump' },
      { at: 18, type: 'hint', hint: 'duck' },
      { at: 25, type: 'twitch', hold: 0.25, say: 'c1.holdIt', id: 'legHold' },
      { at: 36, type: 'hint', hint: 'lane' },
      { at: 58, type: 'hint', hint: 'look' },
    ],
  }),
  // m-2：人群段：可请求的人挡住中道和右道，左道是长桌（不开口也能伏低钻过去）
  runSeg({
    id: 'm-2', beats: 60, cadence: 4.6, crowd: true, follower: { mode: 'behind' },
    items: [
      { at: 34, lane: 0, kind: 'legs', behavior: { type: 'askable', ignore: false } },
      { at: 34, lane: 1, kind: 'legs', behavior: { type: 'askable', ignore: 'seeded' } },
      { at: 34, lane: -1, kind: 'longTable' },
    ],
    windows: [{ id: 'askWin', from: 22, to: 34, type: 'ask' }],
    npcs: [{ id: 'wall', kind: 'standingCluster', from: 10, to: 50, side: 'both', density: 0.8, gaze: 'turnShoes' }],
  }),
  // m-3：周期与移动障碍、到点障碍；段中换挡；楼梯
  runSeg({
    id: 'm-3', beats: 110, cadence: [4.6, 5.0], follower: { mode: 'behind' }, checkpoints: [56],
    stairs: { dir: 'down', risePerBeat: 0.15 },
    rows: [[14, 'B.B']],
    items: [
      { at: 14, lane: 0, kind: 'stallDoor', behavior: { type: 'swing', period: 1.8, phase: 0.2 } },
      { at: 34, lane: 1, kind: 'legs', behavior: { type: 'walk', speed: 1.2 } },
      { at: 70, lane: 0, kind: 'footOut', behavior: { type: 'stretch', period: 2.0, phase: 0.0, outFrac: 0.5 } },
      { at: 86, lane: -1, kind: 'bin', behavior: { type: 'fallInto', atBeat: 78 } },
      { at: 86, lane: 1, kind: 'bin', behavior: { type: 'shift', atBeat: 76, toLane: 0 } },
    ],
    events: [{ at: 92, type: 'cadence', to: 5.4, beats: 8 }],
  }),
  // m-4：端盘（不能撑跃）
  runSeg({
    id: 'm-4', beats: 50, cadence: 4.4, controls: { jump: false }, follower: { mode: 'behind' },
    rows: [[16, '.H.'], [30, 'B..'], [38, '..B']],
    events: [{ at: 2, type: 'hint', hint: 'tray' }],
  }),
  // m-5：施压（上限 2，回稳 24 拍）与 3-2 式的 lagOverride；减速与停拍（自动爬行）
  runSeg({
    id: 'm-5', beats: 80, cadence: 5.0, follower: { mode: 'pressure', steady: 2, lagOverride: 1 },
    rows: [[20, 'L..'], [60, '..H']],
    // rest 窗口：打开时触发窗口 id 并播放 then（附录 C 允许把必备节拍挂在窗口上）
    windows: [{ id: 'restT', from: 46, to: 56, type: 'rest', then: [{ at: 0.3, type: 'sfx', sfx: 'shush', id: 'restThenT' }] }],
    events: [
      { at: 28, type: 'slow', speed: 1.5, seconds: 2, ramp: 0.4, timeline: [{ at: 0.5, type: 'text', line: 'c1.hey' }] },
      { at: 40, type: 'stop', seconds: 4, timeline: [{ at: 0.5, type: 'text', line: 'c1.noLag' }, { at: 1.5, type: 'autoCrawl', speed: 2, seconds: 1.5 }] },
      { at: 70, type: 'hush', beats: 8 },
    ],
  }),
  // m-6：第五章式的腿偏移与前方的它（ahead）、画面翻转
  runSeg({
    id: 'm-6', beats: 120, stride: 1.1, cadence: [5.0, 5.4], atmosphere: 'voidDark', follower: { mode: 'ahead', steady: 3 },
    rows: [[20, '.B.'], [40, 'L..'], [66, '..H'], [100, 'B..']],
    events: [
      { at: 4, type: 'leader', op: 'appear', id: 'leaderOn' },
      { at: 26, type: 'hint', hint: 'straighten' },
      { at: 30, type: 'drift', dir: -1, say: 'c1.holdIt', id: 'driftT' },
      { at: 50, type: 'drift', dir: 1 },
      { at: 80, type: 'flip', on: true },
      { at: 106, type: 'leader', op: 'recede' },
    ],
  }),
], { id: 'test', seed: 99, notes: [{ id: 'nx', face: 'blank', front: null, back: null, folded: false, pickup: true }], requiredBeats: ['legHold', 'lookT', 'askWin', 'restT', 'restThenT', 'leaderOn', 'driftT'] });

/** 静场与站立段。 */
export const MECH_STILL: ChapterDef = chapter([
  stillSeg({
    id: 'q-hold', duration: 4, events: [{ at: 0.2, type: 'text', line: 'c1.note', id: 'qa' }],
    input: { at: 1, hint: 'hold', mode: 'hold', holdSeconds: 2.5, timeout: 5, progress: [{ at: 1, line: 'c1.duty' }, { at: 2, line: 'c1.footMoved' }], onDone: [{ at: 0.3, type: 'text', line: 'c1.stopped', id: 'qb' }] },
  }),
  stillSeg({ id: 'q-tap', duration: 2, input: { at: 0.5, hint: 'kneel', mode: 'tap', timeout: 4 } }),
  stillSeg({ id: 'q-taps3', set: 'bedroom', duration: 2, input: { at: 0.5, hint: 'taps3', mode: 'taps3', timeout: 6 } }),
  stillSeg({ id: 'q-any', duration: 2, input: { at: 0.5, hint: 'anyKey', mode: 'any', timeout: 6.5 } }),
  DREAM,
  SEVEN,
  runSeg({ id: 'q-end', beats: 30 }),
], { seed: 5 });

/** 结尾卡输入上的节拍 id（在界面里触发，模拟里没有）。 */
export function outroIds(def: ChapterDef): string[] {
  return def.outro.lines.flatMap((l) => ('input' in l && l.id ? [l.id] : []));
}

/** perfect 自动驾驶跑完一章：返回摔倒数、受击、缺失的必备节拍（结尾卡输入除外）。 */
export function perfectRun(def: ChapterDef, seed: number): { ended: boolean; falls: number; hits: string[]; missing: string[] } {
  const d = new Driver(def, undefined, seed);
  d.sim.setAutopilot('perfect');
  d.until(() => d.sim.isEnded, 120 * 900);
  const need = def.requiredBeats.filter((b) => !outroIds(def).includes(b));
  return {
    ended: d.of('chapter:end').length === 1, falls: d.snap.stats.falls,
    hits: d.of('hit').map((h) => `${h.data.kind}#${h.data.obstacleId}`), missing: need.filter((b) => !d.snap.beatsFired.includes(b)),
  };
}

/** 驱动一个 Sim：按 tick 注入动作，记录全部事件。 */
export class Driver {
  readonly sim = new Sim(solver);
  readonly events: GameEvent[] = [];
  private held = new Set<Action>();
  private pending: InputEvent[] = [];
  device: 'keyboard' | 'touch' = 'keyboard';
  constructor(def: ChapterDef, at?: { segment: string; beat: number }, seed?: number) {
    this.sim.load(compile(def, seed), at, seed);
    this.events.push(...this.sim.drain());
  }
  get snap() { return this.sim.snapshot(); }
  /** 按下；tOffsetMs 为意图时刻相对当前模拟时钟的偏移（毫秒，干脆判定用）。 */
  press(a: Action, tOffsetMs = 0): this { this.pending.push({ action: a, phase: 'down', t: this.snap.t * 1000 + tOffsetMs, device: this.device }); this.held.add(a); return this; }
  release(a: Action): this { this.pending.push({ action: a, phase: 'up', t: this.snap.t * 1000, device: this.device }); this.held.delete(a); return this; }
  tap(a: Action, tOffsetMs = 0): this { this.press(a, tOffsetMs); this.stepOne(); this.release(a); return this; }
  isHeld(a: Action): boolean { return this.held.has(a); }
  stepOne(): GameEvent[] {
    const evs = this.pending; this.pending = [];
    this.sim.step(evs, this.held);
    const out = this.sim.drain();
    this.events.push(...out);
    return out;
  }
  step(n: number): this { for (let i = 0; i < n; i++) this.stepOne(); return this; }
  /** 推进直到条件成立（最多 max tick），返回用掉的 tick 数；不成立返回 -1。 */
  until(pred: () => boolean, max = 120 * 120): number {
    for (let i = 0; i < max; i++) { if (pred()) return i; this.stepOne(); }
    return pred() ? max : -1;
  }
  of<T extends GameEvent['type']>(type: T): Array<Extract<GameEvent, { type: T }>> {
    return this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
  }
  clear(): this { this.events.length = 0; return this; }
}
