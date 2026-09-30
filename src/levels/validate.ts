// src/levels/validate.ts —— 关卡校验器（DESIGN.md §2.8 可读性铁律 R1–R13、§8.5、§10.1）。CORE 写初版，WP1 补全。
// R14（文字）归 WP2 的 lint.ts。
//
// 做法：R2、R3、R5、R6（休息窗）、R7（接触后 1.2 s）、R8、R10 统一转成一次带约束的求解——
// 「存在一条 0 受击的路线，它的所有输入彼此相隔 ≥ 本章最小间隔，并且都不落在任何休息窗里」。
// 这正是这些规则想保证的：休息窗里不需要任何必需动作。解不出来时再逐项放宽约束，报告是哪一条规则挡住了。
// 其余规则直接按数据和名义时间轴（不做动作、不受击时的 s(t)）检查。
//
// 对 DESIGN.md 的解释（§10.1 已回写的照 §10.1）：
//   · R6「任意 20 s 内最多一个主异常」：`double`（替身出现）只是反光面开始工作，不单独计数（仍然有前 1 s 后 2 s 的休息窗）。
//     回头窗口 then 里的异常可能发生在窗口里的任何时刻：玩家最早在窗口开始时回头，最晚「不按 Q、等到窗口结束自动回头」。
//     两个主异常的间隔按**最坏时序**算（区间之间的最小距离），< 20 s 报 error（§10.1）。只统计跑段（静场是固定机位的独白，
//     §4 的数据本身就在静场里连续安排异常，例如 2-9）。
//     R6 的几何部分：挂在反光面上的异常（double / doubleMod / memory / board）在事件时刻必须从**三条车道**的追尾镜头都看得见
//     （反光面有一部分落在水平视角 ±38° 内、雾的远距离以内）；世界替身（surface 'world'）必须在前方 ≥ 6 m、±20° 以内。
//   · R7「该行只有它，另两条车道空着」：按「该行只有这一类别」（同类别占多条车道允许，1-2 @68 的 HHH），只对 low / bar / block；
//     「新种类首次出现时该行只有它」只报 warning（§10.1）。「首次」按整部作品算：第二章起三个类别都已学过，只查新种类。
//   · R6 的「跟随者登场」= 从 hidden 变成有声音 / HUD 的模式（第一章 1-5）；absent 之后回来不算登场。
//   · R4 的「雾的清晰距离」取 near + 0.35 × (far × 低档 fogMul − near)。亮度一项：暗色氛围带粉笔描边（R12）即视为可读；
//     非暗色氛围按灯亮计（LampField 由 WP3 实现，校验器在 Node 里拿不到亮度场）。
//   · R9：腿自主抬起的「落在横档前 0.4 s」按「抬起时刻（预警开始 + 0.6 s）到横档接触时刻 = 0.4 ± 0.15 s」；「空地」= 预警开始到
//     抬起结束（+1.8 s）之间，三条车道都没有必需障碍的接触。第一章不查（第二章起）。腿偏移：从任意车道被迫换进的那条道，
//     在偏移发生后 1.2 s 内没有 block。
//   · R12：暗色氛围（§5.2 标 dark 的 nightIndoor / rainNight / voidDark）的粉笔描边最低亮度 chalkMin ≥ 0.15，底亮度 ≥ 0.15
//     只有 voidDark 由氛围保证，其余靠灯；另外，非暗色氛围里用 lights out 关掉灯的区间里如果有必需障碍，报 warning（没有描边兜底）。
//   · R13：站立段的实际时长 = max(duration, 第七步摔倒 + 最后一个按步事件)，不含起身前的等待。
import { LANE_WIDTH, LIMITS, MIN_ACTION_GAP, TEXT, TICK_DT } from '../core/constants';
import type { SolveFrom, SolverAPI } from '../core/contracts';
import { QUALITY } from '../core/quality';
import type { AtmosphereId, HintId, Lane, ObstacleClass } from '../core/types';
import { advancePace, createPaceState, paceEvents } from '../sim/Pace';
import { FALL_STEP, PLANT_SEC } from '../sim/Stand';
import { obstacleState } from '../sim/Track';
import { TUNING } from '../sim/tuning';
import { CHAPTER_ORDER, getChapter } from './chapters/index';
import { compile } from './compile';
import { KIT_SYMBOLS, KIT_VARIANTS, symbolsFor } from './kitSymbols';
import { lineText } from './lines';
import { OBSTACLES } from './obstacles';
import type {
  ChapterDef, CompiledChapter, CompiledSegment, CompiledSurface, DoubleSpec, EventBody, RunSegmentDef, StillSegmentDef, StandSegmentDef,
  TimedEventDef,
} from './schema';
import { expandPattern } from './patterns';
import { isSym, parseLanes } from './shorthand';

export interface Issue { level: 'error' | 'warn'; rule: string; chapter: string; segment?: string; msg: string }
export interface ValidateReport {
  chapter: string; ok: boolean; issues: Issue[];
  stats: { runSec: number; nonRunSec: number; totalSec: number; nonRunRatio: number; segments: Array<{ id: string; kind: string; sec: number }> };
}

/** 各氛围的雾（§5.2），R4 / R6 用。 */
const FOG: Record<AtmosphereId, [number, number]> = {
  morning: [10, 48], noon: [12, 50], labNorth: [8, 38], nightIndoor: [6, 30], rainNight: [4, 26], busNight: [3, 14], homeDark: [3, 14],
  dream: [20, 120], dreamGray: [20, 60], dawn: [8, 45], overcast: [15, 70], fluorescent: [6, 25], voidDark: [4, 18],
};
/** §5.2 标 dark 的氛围与各氛围的粉笔描边最低亮度 chalkMin、底亮度。 */
export const DARK_ATMOSPHERES: ReadonlySet<AtmosphereId> = new Set(['nightIndoor', 'rainNight', 'voidDark']);
export const CHALK_MIN: Record<AtmosphereId, number> = {
  morning: 0, noon: 0, labNorth: 0, nightIndoor: 0.35, rainNight: 0.35, busNight: 0, homeDark: 0,
  dream: 0, dreamGray: 0.2, dawn: 0, overcast: 0, fluorescent: 0, voidDark: 0.4,
};
export function readDistance(atm: AtmosphereId): number {
  const [near, far] = FOG[atm];
  const f = far * QUALITY.low.fogMul;
  return near + 0.35 * Math.max(0, f - near);
}

const HINT_FOR: Partial<Record<ObstacleClass, HintId>> = { low: 'jump', bar: 'duck', block: 'lane' };
const REQUIRED: ReadonlySet<ObstacleClass> = new Set(['low', 'bar', 'block']);
const MAIN_ANOMALY = new Set<EventBody['type']>(['double', 'doubleMod', 'shadow', 'memory', 'board']);
/** 追尾镜头（§5.4）：相对玩家 (0.7·x, 0.92, +2.35)，水平视角 76°。 */
const CAM_BACK = 2.35;
const CAM_X = 0.7;
const HFOV_HALF = (76 / 2) * (Math.PI / 180);
const WORLD_DOUBLE_MIN = 6;
const WORLD_DOUBLE_ANGLE = 20 * (Math.PI / 180);
const HALF_WALL = 1.8;
/** R9：抬起落在横档前 0.4 s 的容差。 */
const R9_TOL = 0.15;
/** 20 s 规则（附录 A-11）。 */
const ANOMALY_GAP = 20;

/**
 * 已知、已由 lead 指派给别的包修复的数据问题：只把这一条**精确**的报错降级为 warning（带说明），数据一改就自动失效。
 * 这样 WP1 的严格规则可以先合并，而不必等别的包（lead 集成时删除）。
 */
export const WAIVERS: ReadonlyArray<{ chapter: string; rule: string; msg: string; note: string }> = [
  {
    chapter: 'ch1', rule: 'R6',
    msg: 'main anomalies shadow (1-5 look-back window emptyHall) and doubleMod (1-6) are only 18.9 s apart in the worst case (auto look-back at window end)',
    note: 'DESIGN §10.1: WP2 must retime ch1 so the gap is ≥ 20 s; this waiver expires as soon as the data changes',
  },
];

/** 段内名义时间轴（不做任何动作、不受击）：从某一拍开始逐 tick 推进。 */
export interface Timeline { t: Float64Array; s: Float64Array; n: number; tEnd: number; stopSec: number; t0: number; s0: number }
export function nominalTimeline(seg: CompiledSegment, fromBeat = 0): Timeline {
  const def = seg.def as RunSegmentDef;
  const s0 = seg.s0 + fromBeat * seg.stride;
  const t0 = fromBeat === 0 ? 0 : seg.timeAt(fromBeat);
  const pace = createPaceState(seg, s0, t0);
  const evs = paceEvents(seg);
  const cap = 120 * 600;
  const t = new Float64Array(cap), s = new Float64Array(cap);
  let n = 0;
  t[n] = pace.tSeg; s[n] = pace.s; n++;
  let stopSec = 0;
  while (n < cap) {
    advancePace(seg, pace, evs, 1, TICK_DT);
    if (pace.base === 0) stopSec += TICK_DT;
    t[n] = pace.tSeg; s[n] = pace.s; n++;
    if (pace.ended || (pace.s - seg.s0) / seg.stride >= def.beats) break;
  }
  return { t, s, n, tEnd: t[n - 1] as number, stopSec, t0, s0 };
}
/** 里程 → 时间（线性插值；超出范围时夹到两端）。 */
export function timeAtS(tl: Timeline, s: number): number {
  if (s <= (tl.s[0] as number)) return tl.t[0] as number;
  let lo = 0, hi = tl.n - 1;
  if (s >= (tl.s[hi] as number)) return tl.t[hi] as number;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((tl.s[m] as number) < s) lo = m; else hi = m; }
  const sa = tl.s[lo] as number, sb = tl.s[hi] as number, ta = tl.t[lo] as number, tb = tl.t[hi] as number;
  return sb === sa ? ta : ta + ((s - sa) / (sb - sa)) * (tb - ta);
}
/** 时间 → 里程。 */
export function sAtTime(tl: Timeline, t: number): number {
  if (t <= (tl.t[0] as number)) return tl.s[0] as number;
  let lo = 0, hi = tl.n - 1;
  if (t >= (tl.t[hi] as number)) return tl.s[hi] as number;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((tl.t[m] as number) < t) lo = m; else hi = m; }
  const ta = tl.t[lo] as number, tb = tl.t[hi] as number, sa = tl.s[lo] as number, sb = tl.s[hi] as number;
  return tb === ta ? sa : sa + ((t - ta) / (tb - ta)) * (sb - sa);
}

interface Win { a: number; b: number; rule: string; why: string }
interface TEv { t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number; win?: string }

/** 段内所有「时刻」事件（秒）：按拍的事件、slow/stop 的 timeline、回头窗口 then（早：窗口开始；晚：窗口结束）。 */
function timedEvents(seg: CompiledSegment, tl: Timeline): TEv[] {
  const out: TEv[] = [];
  const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
  const fromBeat = (tl.s0 - seg.s0) / seg.stride;
  for (const e of seg.events) {
    if (e.at < fromBeat - 1e-9) continue;   // 检查点之前的事件不会再发生
    const te = tAtBeat(e.at);
    const item: TEv = { t: te, body: e.body, inWindow: false, tLate: te };
    if (e.id !== undefined) item.id = e.id;
    out.push(item);
    if (e.body.type === 'slow' || e.body.type === 'stop') {
      for (const x of (e.body.timeline ?? []) as TimedEventDef[]) {
        const { at, id, ...rest } = x as TimedEventDef & Record<string, unknown>;
        const it: TEv = { t: te + at, body: rest as unknown as EventBody, inWindow: false, tLate: te + at };
        if (id !== undefined) it.id = id as string;
        out.push(it);
      }
    }
  }
  for (const w of seg.windows) {
    if (w.to < fromBeat) continue;
    const a = tAtBeat(w.from), b = tAtBeat(w.to);
    for (const x of w.then ?? []) {
      const { at, id, ...rest } = x as TimedEventDef & Record<string, unknown>;
      const it: TEv = { t: a + at, body: rest as unknown as EventBody, inWindow: true, tLate: b + at, win: w.id ?? `@${w.from}` };
      if (id !== undefined) it.id = id as string;
      out.push(it);
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

function isMainAnomaly(body: EventBody, prevFollowerMode: { v: string }): boolean {
  if (body.type === 'follower' && body.def.mode) {
    // 「跟随者登场」= 从 hidden（第一章教学期，还没登场过）变成有声音 / HUD 的模式；absent 之后回来（2-7「回声回来了」）不算登场
    const debut = prevFollowerMode.v === 'hidden' && body.def.mode !== 'hidden' && body.def.mode !== 'absent';
    prevFollowerMode.v = body.def.mode;
    return debut;
  }
  if (body.type === 'shadow') return body.mode !== 'normal' && body.mode !== 'blob';
  return MAIN_ANOMALY.has(body.type);
}

function textDurationOf(ids: readonly string[]): number {
  const chars = ids.map((i) => Array.from(lineText(i)).length).reduce((a, b) => a + b, 0);
  return (chars * TEXT.msPerChar + TEXT.baseMs) / 1000;
}

/** 段内休息窗（以 tSeg 秒计），用于约束求解。 */
function restWindows(seg: CompiledSegment, tl: Timeline, firstClassRows: Map<ObstacleClass, number>, chapterMode: { v: string }): Win[] {
  const W: Win[] = [];
  const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
  for (const e of timedEvents(seg, tl)) {
    if (e.body.type === 'text' && e.body.style !== 'board') W.push({ a: e.t - 0.4, b: e.tLate + 0.8, rule: 'R5', why: `text ${String(e.body.line)}` });
    if (isMainAnomaly(e.body, chapterMode)) W.push({ a: e.t - 1.0, b: e.tLate + 2.0, rule: 'R6', why: `anomaly ${e.body.type}${e.id ? `(${e.id})` : ''}` });
  }
  const fromBeat = (tl.s0 - seg.s0) / seg.stride;
  for (const cp of seg.checkpoints) { if (cp < fromBeat - 1e-9) continue; const t = tAtBeat(cp); W.push({ a: t, b: t + 1.6, rule: 'R8', why: `checkpoint @${cp}` }); }
  W.push({ a: tl.tEnd - 0.8, b: tl.tEnd + 1, rule: 'R8', why: 'segment end' });
  for (const w of seg.windows) {
    if (w.to < fromBeat) continue;
    const a = tAtBeat(w.from), b = tAtBeat(w.to);
    if (w.type === 'lookBack') {
      let thenDur = 0;
      for (const x of w.then ?? []) if (x.type === 'text') thenDur = Math.max(thenDur, x.at + 0.8);
      W.push({ a, b: b + thenDur + 0.8, rule: 'R10', why: `lookBack window ${w.id ?? ''}` });
    } else if (w.type === 'rest') W.push({ a, b, rule: 'R5', why: `rest window ${w.id ?? ''}` });
  }
  for (const [cls, oid] of firstClassRows) {
    const o = seg.obstacles.find((q) => q.id === oid);
    if (!o) continue;
    const tc = timeAtS(tl, o.s0 - TUNING.hitbox.sFront);
    W.push({ a: tc + 0.02, b: tc + 1.2, rule: 'R7', why: `after first ${cls}` });
  }
  return W;
}

/** 反光面在某一时刻、从某条车道的追尾镜头看是否可见（R6 几何）。 */
export function surfaceVisible(sf: CompiledSurface, sPlayer: number, lane: Lane, fogFar: number): boolean {
  const sc = sPlayer - CAM_BACK;
  const xc = CAM_X * lane * LANE_WIDTH;
  const ahead0 = sf.s0 - sc, ahead1 = (sf.side === 'end' ? sf.s0 : sf.s1) - sc;
  if (ahead1 <= 0.3 || ahead0 > fogFar) return false;
  let xw: number;
  if (sf.side === 'L') xw = -HALF_WALL;
  else if (sf.side === 'R') xw = HALF_WALL;
  else if (sf.side === 'end') return Math.atan2(Math.abs(xc), ahead0) <= HFOV_HALF;
  else xw = (sf.lane ?? 0) * LANE_WIDTH;
  const need = Math.abs(xw - xc) / Math.tan(HFOV_HALF);   // 离镜头至少这么远才进入视角
  return Math.min(ahead1, fogFar) >= need;
}

function collectIds(evs: ReadonlyArray<Record<string, unknown>>, ids: Set<string>): void {
  for (const e of evs) {
    if (typeof e.id === 'string') ids.add(e.id);
    const tl = (e as { timeline?: Array<Record<string, unknown>> }).timeline;
    if (tl) collectIds(tl, ids);
  }
}

/** 事件体里引用的全部台词 id（含 slow / stop 的 timeline）。 */
function linesOf(b: EventBody, out: string[]): void {
  if (b.type === 'text') out.push(...((Array.isArray(b.line) ? b.line : [b.line]) as string[]));
  if (b.type === 'twitch' || b.type === 'drift') { if (b.say) out.push(b.say); }
  if (b.type === 'board' && b.line) out.push(b.line);
  if (b.type === 'slow' || b.type === 'stop') for (const x of (b.timeline ?? []) as TimedEventDef[]) linesOf(x as unknown as EventBody, out);
}

/** 校验一章。solver 由调用方传入（registry 或 WP1 的 Solver）。 */
export function validateChapter(def: ChapterDef, solver: SolverAPI, opts: { seed?: number } = {}): ValidateReport {
  const issues: Issue[] = [];
  const chId = def.id;
  const err = (rule: string, msg: string, segment?: string) => issues.push({ level: 'error', rule, chapter: chId, msg, ...(segment ? { segment } : {}) });
  const warn = (rule: string, msg: string, segment?: string) => issues.push({ level: 'warn', rule, chapter: chId, msg, ...(segment ? { segment } : {}) });
  staticChecks(def, err, warn);
  let ch: CompiledChapter;
  try { ch = compile(def, opts.seed); } catch (e) {
    err('static', `compile failed: ${(e as Error).message}`);
    return { chapter: chId, ok: false, issues, stats: { runSec: 0, nonRunSec: 0, totalSec: 0, nonRunRatio: 0, segments: [] } };
  }
  const minGap = MIN_ACTION_GAP[chId];

  // —— 逐段 ——
  const segStats: Array<{ id: string; kind: string; sec: number }> = [];
  let runSec = 0, nonRunSec = 0;
  const seenClass = new Set<ObstacleClass>();
  const seenKind = new Set<string>();
  const hintsSeen = new Set<HintId>();
  // R7 的「首次出现」按整部作品算：第一章教会了 low / bar / block 与 jump / lane / duck 的提示（§4.1），
  // 之后各章只查「新种类」（warning），种类取已实现的前面各章里出现过的。test 章独立校验（合成测试用）。
  const order = CHAPTER_ORDER.indexOf(chId);
  if (order > 0) {
    for (const c of ['low', 'bar', 'block'] as const) seenClass.add(c);
    for (const h of ['jump', 'lane', 'duck'] as const) hintsSeen.add(h);
    for (const prev of CHAPTER_ORDER.slice(0, order)) {
      const pd = getChapter(prev);
      if (!pd) continue;
      try {
        for (const sg of compile(pd).segments) for (const o of sg.obstacles) if (REQUIRED.has(o.cls)) seenKind.add(o.kind);
        for (const sd of pd.segments) for (const e of (sd.events ?? []) as Array<{ type: string; hint?: HintId }>) if (e.type === 'hint' && e.hint) hintsSeen.add(e.hint);
      } catch { /* 前面的章自己编译不过，会在它自己的校验里报 */ }
    }
  }
  const anomalies: Array<{ a: number; b: number; what: string; seg: string; window: string | null }> = [];
  const followerMode = { v: 'hidden' };
  const doubles = new Map<string, DoubleSpec>();
  let chapterT = 0;

  for (const seg of ch.segments) {
    const sid = seg.def.id;
    if (seg.kind !== 'run') {
      const d = seg.def as StillSegmentDef | StandSegmentDef;
      let real = d.duration;
      if (seg.kind === 'stand' && (d as StandSegmentDef).script === 'sevenSteps') {
        const sd = d as StandSegmentDef;
        const rise = sd.input?.at ?? 0;
        const fallAt = rise + FALL_STEP * TUNING.stand.stepPeriod + PLANT_SEC;
        let last = fallAt;
        for (const e of sd.events as Array<Record<string, unknown>>) if (typeof e.atStep === 'number') last = Math.max(last, rise + (e.atStep as number) * TUNING.stand.stepPeriod + PLANT_SEC + ((e.delay as number | undefined) ?? 0));
        real = Math.max(real, last);
        if (!sd.input) err('static', `sevenSteps stand ${sid} has no rise input`, sid);
      }
      if (real > LIMITS.stillMaxSec + 1e-9) err('R13', `${seg.kind} ${sid} lasts ${real.toFixed(1)} s > ${LIMITS.stillMaxSec} s (not counting the wait for input)`, sid);
      const wait = d.input ? Math.min(d.input.timeout, d.input.holdSeconds ?? (seg.kind === 'stand' ? TUNING.stand.riseHold : 0.3)) : 0;
      nonRunSec += real + wait;
      segStats.push({ id: sid, kind: seg.kind, sec: real + wait });
      if (seg.def.follower.mode) followerMode.v = seg.def.follower.mode;
      for (const e of seg.events) {
        if (e.body.type === 'follower') followerMode.v = e.body.def.mode ?? followerMode.v;
        if (e.body.type === 'hint') hintsSeen.add(e.body.hint);
        if (e.body.type === 'double') doubles.set(e.body.spec.id, e.body.spec);
      }
      chapterT += real + wait;
      continue;
    }
    const def2 = seg.def as RunSegmentDef;
    if (def2.follower.mode) followerMode.v = def2.follower.mode;
    const tl = nominalTimeline(seg);
    const sec = tl.tEnd;
    runSec += sec - tl.stopSec;
    nonRunSec += tl.stopSec;
    segStats.push({ id: sid, kind: 'run', sec });
    const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
    const contactT = (s0: number) => timeAtS(tl, s0 - TUNING.hitbox.sFront);
    const required = seg.obstacles.filter((o) => REQUIRED.has(o.cls));

    // R7：新类别首次出现
    const firstClassRows = new Map<ObstacleClass, number>();
    const hintTimes = new Map<HintId, number[]>();
    for (const e of seg.events) if (e.body.type === 'hint') { const arr = hintTimes.get(e.body.hint) ?? []; arr.push(tAtBeat(e.at)); hintTimes.set(e.body.hint, arr); }
    const byBeat = new Map<number, typeof seg.obstacles>();
    for (const o of seg.obstacles) { const arr = byBeat.get(o.beat) ?? []; arr.push(o); byBeat.set(o.beat, arr); }
    for (const o of seg.obstacles) {
      const row = byBeat.get(o.beat) ?? [];
      if (REQUIRED.has(o.cls) && !seenClass.has(o.cls)) {
        seenClass.add(o.cls);
        firstClassRows.set(o.cls, o.id);
        if (row.some((q) => q.cls !== o.cls && q.cls !== 'soft' && q.cls !== 'pickup')) err('R7', `first ${o.cls} @${o.beat} shares its row with other classes`, sid);
        const hint = HINT_FOR[o.cls] as HintId;
        const tc = contactT(o.s0);
        const ok = (hintTimes.get(hint) ?? []).some((th) => th <= tc - 1.2 + 1e-9) || hintsSeen.has(hint);
        if (!ok) err('R7', `first ${o.cls} @${o.beat}: no "${hint}" hint ≥ 1.2 s before contact`, sid);
      }
      if (REQUIRED.has(o.cls) && !seenKind.has(o.kind)) {
        seenKind.add(o.kind);
        if (row.some((q) => q.kind !== o.kind && REQUIRED.has(q.cls))) warn('R7', `first ${o.kind} @${o.beat} shares its row with other kinds`, sid);
      }
    }
    for (const [h] of hintTimes) hintsSeen.add(h);

    // R1：任意 0.1 m 切片至少一条车道可以通过（按名义通过时间计算移动与周期障碍）
    const blocks = seg.obstacles.filter((o) => o.cls === 'block');
    if (blocks.length) {
      const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
      for (let s = seg.s0; s < seg.s1; s += 0.1) {
        const t = timeAtS(tl, s);
        const beat = (s - seg.s0) / seg.stride;
        let free = 0;
        for (const lane of [-1, 0, 1] as Lane[]) {
          const x = lane * LANE_WIDTH;
          const blocked = blocks.some((o) => {
            if (o.behavior.type === 'askable') return false;   // 开口也会让开；但 R2 的 noAsk 求解会兜住
            obstacleState(o, t, beat, st);
            return st.active && o.s0 + st.ds <= s + 0.1 && o.s1 + st.ds >= s && st.x0 < x + 0.22 && st.x1 > x - 0.22;
          });
          if (!blocked) free++;
        }
        if (free === 0) { err('R1', `no passable lane at s=${(s - seg.s0).toFixed(1)} m (beat ${beat.toFixed(1)})`, sid); break; }
      }
    }

    // R4：可读距离（暗色氛围靠粉笔描边，非暗色按灯亮）
    const rd = readDistance(seg.def.atmosphere);
    for (const o of required) {
      let tc: number, tr: number;
      if (o.behavior.type === 'walk') {
        // 移动的人：按名义时间轴扫描，障碍前沿 s0 + v·t 与玩家的距离
        const v = o.behavior.speed;
        tc = Infinity; tr = Infinity;
        for (let i = 0; i < tl.n; i += 6) {
          const t = tl.t[i] as number, sp = tl.s[i] as number;
          const gap = o.s0 + v * t - sp;
          if (tr === Infinity && gap <= rd) tr = t;
          if (gap <= TUNING.hitbox.sFront) { tc = t; break; }
        }
        if (tc === Infinity) continue;                 // 名义路线上追不上它（同向更快）
        if (tr <= (tl.t[0] as number) + 1e-9) continue;  // 段首就已经看得见
      } else {
        tc = contactT(o.s0);
        tr = o.s0 - rd > seg.s0 ? timeAtS(tl, o.s0 - rd) : -Infinity;
        // 到点才出现的（梦里摔进车道的男生）：从出现的那一刻才算可读（§8.5 fallInto「≥ 1.2 s 前可见」）
        if (o.behavior.type === 'fallInto') tr = Math.max(tr, tAtBeat(o.behavior.atBeat));
      }
      if (tc - tr < 1.2 - 1e-6) err('R4', `${o.kind} @${o.beat} readable only ${(tc - tr).toFixed(2)} s before contact${o.behavior.type === 'fallInto' ? ' (appears at its fallInto beat)' : ` (fog clear distance ${rd.toFixed(1)} m)`}`, sid);
    }

    // R9：腿自主抬起与腿偏移
    for (const e of seg.events) {
      if (e.body.type === 'twitch' && chId !== 'ch1') {
        const tw = tAtBeat(e.at), tr = tw + TUNING.twitch.warn;
        const bars = required.filter((o) => o.cls === 'bar').map((o) => contactT(o.s0));
        const onBar = bars.some((tc) => Math.abs(tc - tr - 0.4) <= R9_TOL);
        const empty = !required.some((o) => { const tc = contactT(o.s0); return tc >= tw - 0.05 && tc <= tr + TUNING.twitch.rise; });
        if (!onBar && !empty) err('R9', `twitch @${e.at}: rise at ${tr.toFixed(2)} s is neither 0.4 s before a bar nor on empty ground`, sid);
        if (e.body.hold <= 0) err('R9', `twitch @${e.at}: hold must be > 0`, sid);
      }
      if (e.body.type === 'drift') {
        const dir = e.body.dir;
        const tm = tAtBeat(e.at) + TUNING.drift.warn;
        const st = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
        for (const from of [-1, 0, 1] as Lane[]) {
          const to = from + dir;
          if (to < -1 || to > 1) continue;
          const x = to * LANE_WIDTH;
          const bad = blocks.find((o) => {
            const ta = contactT(o.s0), tb = timeAtS(tl, o.s1 + TUNING.hitbox.sBack);
            if (tb < tm || ta > tm + 1.2) return false;
            obstacleState(o, Math.max(ta, tm), o.beat, st);
            return st.active && st.x0 < x + 0.22 && st.x1 > x - 0.22;
          });
          if (bad) { err('R9', `drift @${e.at} (dir ${dir}) forces lane ${to} into ${bad.kind} @${bad.beat} within 1.2 s`, sid); break; }
        }
      }
    }

    // R10：回头窗口长度
    for (const w of seg.windows) {
      if (w.type === 'lookBack' && tAtBeat(w.to) - tAtBeat(w.from) < 1.2 - 1e-6) err('R10', `lookBack window ${w.id ?? ''} shorter than 1.2 s`, sid);
    }

    // R11：端盘段没有 low
    if (def2.controls?.jump === false) for (const o of seg.obstacles) if (o.cls === 'low') err('R11', `tray segment has low obstacle ${o.kind} @${o.beat}`, sid);

    // R12：暗色氛围的描边；非暗色里关灯的区间
    const atm = seg.def.atmosphere;
    if (DARK_ATMOSPHERES.has(atm) && CHALK_MIN[atm] < 0.15) err('R12', `dark atmosphere ${atm} has chalk outline minimum ${CHALK_MIN[atm]} < 0.15`, sid);
    if (!DARK_ATMOSPHERES.has(atm) && CHALK_MIN[atm] < 0.15) {
      for (const e of seg.events) {
        if (e.body.type !== 'lights' || e.body.op !== 'out') continue;
        const a = e.body.from ?? e.at, b = e.body.to ?? def2.beats;
        const inDark = required.find((o) => o.beat >= a && o.beat <= b);
        if (inDark) warn('R12', `lights out @${a}–${b} in non-dark atmosphere ${atm}: ${inDark.kind} @${inDark.beat} has no chalk outline to fall back on`, sid);
      }
    }

    // R6：主异常（章内累计，用于 20 s 规则）与几何
    const modeTmp = { v: followerMode.v };
    const fogFar = FOG[atm][1] * QUALITY.low.fogMul;
    for (const e of timedEvents(seg, tl)) {
      if (e.body.type === 'double') doubles.set(e.body.spec.id, e.body.spec);
      if (!isMainAnomaly(e.body, modeTmp)) continue;
      if (e.body.type !== 'double') anomalies.push({ a: chapterT + e.t, b: chapterT + e.tLate, what: `${e.body.type}${e.id ? `(${e.id})` : ''}`, seg: sid, window: e.win ?? null });
      // 几何：挂在反光面上的异常三条车道都要看得见
      let surfaceId: string | null = null;
      let worldSpec: DoubleSpec | null = null;
      if (e.body.type === 'double') { if (e.body.spec.surface === 'world') worldSpec = e.body.spec; else surfaceId = e.body.spec.surface; }
      if (e.body.type === 'doubleMod') { const d = doubles.get(e.body.target); if (d) { if (d.surface === 'world') worldSpec = d; else surfaceId = d.surface; } }
      if (e.body.type === 'memory' || e.body.type === 'board') surfaceId = e.body.surface;
      if (worldSpec) {
        const ahead = worldSpec.anchor?.sAhead;
        if (ahead !== undefined && !worldSpec.avoidPlayerLane) {
          if (ahead < WORLD_DOUBLE_MIN) err('R6', `world double ${worldSpec.id} only ${ahead} m ahead (< 6 m)`, sid);
          for (const lane of [-1, 0, 1] as Lane[]) {
            const dx = Math.abs(((worldSpec.anchor?.lane ?? 0) - lane) * LANE_WIDTH - CAM_X * lane * LANE_WIDTH);
            if (Math.atan2(dx, ahead + CAM_BACK) > WORLD_DOUBLE_ANGLE) { err('R6', `world double ${worldSpec.id} is more than 20° off-axis from lane ${lane}`, sid); break; }
          }
        }
      }
      if (surfaceId) {
        const sf = seg.surfaces.find((x) => x.id === surfaceId);
        if (!sf) { if (e.body.type !== 'board') err('static', `${e.body.type} refers to unknown surface "${surfaceId}"`, sid); continue; }
        for (const tt of e.inWindow ? [e.t, e.tLate] : [e.t]) {
          const sp = sAtTime(tl, tt);
          const blind = ([-1, 0, 1] as Lane[]).filter((lane) => !surfaceVisible(sf, sp, lane, fogFar));
          if (blind.length) { err('R6', `${e.body.type}${e.id ? `(${e.id})` : ''} on ${sf.kind} "${sf.id}" is not visible from lane(s) ${blind.join(', ')}`, sid); break; }
        }
      }
    }

    // R2 / R3 / R5 / R6 / R7 / R8 / R10：带约束求解，从段首与每个检查点出发
    for (const cp of seg.checkpoints) {
      const tlc = cp === 0 ? tl : nominalTimeline(seg, cp);
      const from: SolveFrom = { s: seg.s0 + cp * seg.stride, lane: 0, tSeg: tlc.t0 };
      const wins = restWindows(seg, tlc, cp === 0 ? firstClassRows : new Map(), { v: followerMode.v });
      const forbid = wins.map((w) => [w.a, w.b] as const);
      const noAsk = def2.crowd === true;
      const base = solver.solve(seg, { from, noAsk });
      if (!base) { err('R2', `no zero-hit route from @${cp}${noAsk ? ' without asking (noAsk)' : ''}`, sid); continue; }
      const full = solver.solve(seg, { from, noAsk, minGap, forbid });
      if (full) continue;
      if (!solver.solve(seg, { from, noAsk, minGap })) { err('R3', `no route with required actions ≥ ${minGap} s apart from @${cp}`, sid); continue; }
      const rules = Array.from(new Set(wins.map((w) => w.rule)));
      let blamed = false;
      for (const r of rules) {
        const only = wins.filter((w) => w.rule === r).map((w) => [w.a, w.b] as const);
        if (!solver.solve(seg, { from, noAsk, minGap, forbid: only })) {
          blamed = true;
          const culprits = wins.filter((w) => w.rule === r).filter((w) => !solver.solve(seg, { from, noAsk, minGap, forbid: [[w.a, w.b]] }));
          err(r, `required action inside rest window from @${cp}: ${(culprits.length ? culprits : wins.filter((w) => w.rule === r)).map((w) => `${w.why} [${w.a.toFixed(2)}, ${w.b.toFixed(2)}]s`).join('; ')}`, sid);
        }
      }
      if (!blamed) err('R5-R10', `rest windows together leave no route from @${cp}`, sid);
    }
    for (const e of seg.events) if (e.body.type === 'follower' && e.body.def.mode) followerMode.v = e.body.def.mode;
    chapterT += sec;
  }

  // R6：任意 20 s 内最多一个主异常（最坏时序：区间之间的最小距离）
  anomalies.sort((x, y) => x.a - y.a);
  for (let i = 0; i < anomalies.length; i++) {
    for (let j = i + 1; j < anomalies.length; j++) {
      const p = anomalies[i] as (typeof anomalies)[number];
      const q = anomalies[j] as (typeof anomalies)[number];
      if (q.a - p.b >= ANOMALY_GAP + 1 && q.a - p.a >= ANOMALY_GAP + 1) break;
      const gap = Math.max(0, Math.max(q.a - p.b, p.a - q.b));
      if (gap < ANOMALY_GAP - 1e-6) {
        const late = p.window ?? q.window;
        const pw = p.window ? ` look-back window ${p.window}` : '';
        const qw = q.window ? ` look-back window ${q.window}` : '';
        err('R6', `main anomalies ${p.what} (${p.seg}${pw}) and ${q.what} (${q.seg}${qw}) are only ${gap.toFixed(1)} s apart${late ? ' in the worst case (auto look-back at window end)' : ''}`);
      }
    }
  }

  // R13：非跑动占比
  const total = runSec + nonRunSec;
  const ratio = total > 0 ? nonRunSec / total : 0;
  if (ratio > LIMITS.nonRunMaxRatio + 1e-9) err('R13', `non-run time ${(ratio * 100).toFixed(1)}% > 25%`);

  // 已知数据问题的豁免（精确匹配，数据一改自动失效）
  for (const is of issues) {
    const w = WAIVERS.find((x) => x.chapter === is.chapter && x.rule === is.rule && x.msg === is.msg);
    if (w && is.level === 'error') { is.level = 'warn'; is.msg = `[waived: ${w.note}] ${is.msg}`; }
  }

  return {
    chapter: chId, ok: !issues.some((i) => i.level === 'error'), issues,
    stats: { runSec, nonRunSec, totalSec: total, nonRunRatio: ratio, segments: segStats },
  };
}

/** 静态检查：id、台词、纸条、变体、符号、时刻范围、必备节拍。 */
function staticChecks(def: ChapterDef, err: (r: string, m: string, s?: string) => void, warn: (r: string, m: string, s?: string) => void): void {
  const ids = new Set<string>();
  const segIds = new Set<string>();
  const noteIds = new Set(def.notes.map((n) => n.id));
  const lineRefs: Array<{ id: string; seg?: string }> = [];
  const checkLine = (id: string, seg?: string) => lineRefs.push(seg !== undefined ? { id, seg } : { id });
  if (def.notes.length > LIMITS.notesPerChapter) err('static', `${def.notes.length} notes > ${LIMITS.notesPerChapter}`);
  for (const n of def.notes) { if (n.front) checkLine(n.front); if (n.back) checkLine(n.back); }
  for (const lid of def.card) checkLine(lid);
  for (const l of def.outro.lines) {
    if ('line' in l) checkLine(l.line);
    else { if (l.id) ids.add(l.id); for (const x of l.input.onDone ?? []) linesOfTimed(x, (id) => checkLine(id)); }
  }
  for (const sd of def.segments) {
    const sid = sd.id;
    if (segIds.has(sid)) err('static', `duplicate segment id ${sid}`, sid);
    segIds.add(sid);
    collectIds((sd.events ?? []) as unknown as Array<Record<string, unknown>>, ids);
    const evs = (sd.events ?? []) as Array<Record<string, unknown>>;
    for (const e of evs) {
      const out: string[] = [];
      linesOf(e as unknown as EventBody, out);
      for (const id of out) checkLine(id, sid);
      if (e.type === 'noteGet' && !noteIds.has(e.note as string)) err('static', `noteGet refers to note "${String(e.note)}" not defined in this chapter`, sid);
    }
    if (sd.kind === 'run') {
      if (!(KIT_VARIANTS[sd.kit] ?? []).includes(sd.variant)) err('static', `unknown variant ${sd.kit}.${sd.variant}`, sid);
      for (const w of sd.windows ?? []) {
        if (w.id) ids.add(w.id);
        collectIds((w.then ?? []) as unknown as Array<Record<string, unknown>>, ids);
        for (const x of w.then ?? []) linesOfTimed(x, (id) => checkLine(id, sid));
        if (!(w.from < w.to) || w.from < 0 || w.to > sd.beats) err('static', `window ${w.id ?? ''} [${w.from}, ${w.to}] outside the segment or empty`, sid);
      }
      for (const cp of sd.checkpoints ?? []) if (cp <= 0 || cp >= sd.beats) err('static', `checkpoint @${cp} outside (0, ${sd.beats})`, sid);
      for (const e of sd.events ?? []) if (e.at < 0 || e.at > sd.beats) err('static', `event ${e.type} @${e.at} outside [0, ${sd.beats}]`, sid);
      for (const n of sd.notes ?? []) if (!noteIds.has(n.note)) err('static', `note placement refers to note "${n.note}" not defined in this chapter`, sid);
      const syms = symbolsFor(sd.kit, sd.variant);
      const known = KIT_SYMBOLS[`${sd.kit}.${sd.variant}`] ?? KIT_SYMBOLS[`${sd.kit}.*`];
      if (!known && sd.kit !== 'placeholder') warn('static', `no KIT_SYMBOLS entry for ${sd.kit}.${sd.variant} (falls back to placeholder)`, sid);
      const rows = [...(sd.rows ?? [])];
      for (const p of sd.patterns ?? []) rows.push(...expandPattern(p));
      for (const r of rows) {
        let cells: string[];
        try { cells = parseLanes(r[1]) as string[]; } catch (e) { err('static', (e as Error).message, sid); continue; }
        for (const c of cells) if (isSym(c) && !(syms[c] ?? []).length) err('static', `row @${r[0]}: symbol ${c} has no kinds for ${sd.kit}.${sd.variant}`, sid);
        if (r[0] < 0 || r[0] > sd.beats) err('static', `row @${r[0]} outside [0, ${sd.beats}]`, sid);
      }
      for (const it of sd.items ?? []) if (!OBSTACLES[it.kind]) err('static', `unknown obstacle kind ${String(it.kind)}`, sid);
      if (sd.stairs && (sd.surfaces ?? []).some((s) => s.kind === 'puddle')) err('static', 'puddles are not allowed on stairs (§5.8)', sid);
      if (sd.follower.mode !== 'ahead' && (sd.events ?? []).some((e) => e.type === 'leader') && !(sd.events ?? []).some((e) => e.type === 'follower' && e.def.mode === 'ahead')) {
        warn('static', 'leader events in a segment that is not in ahead mode', sid);
      }
    } else {
      const inp = sd.input;
      if (inp) {
        collectIds((inp.onDone ?? []) as unknown as Array<Record<string, unknown>>, ids);
        for (const x of inp.onDone ?? []) linesOfTimed(x, (id) => checkLine(id, sid));
        for (const p of inp.progress ?? []) checkLine(p.line, sid);
        if (inp.timeout <= 0) err('static', 'input timeout must be > 0', sid);
      }
      if (sd.kind === 'stand' && !(KIT_VARIANTS[sd.kit] ?? []).includes(sd.variant)) err('static', `unknown variant ${sd.kit}.${sd.variant}`, sid);
    }
  }
  for (const r of lineRefs) if (!lineText(r.id)) err('static', `line "${r.id}" is not in lines.ts`, r.seg);
  for (const rb of def.requiredBeats) if (!ids.has(rb)) err('static', `requiredBeat "${rb}" is not attached to any event/window/input id`);
}

function linesOfTimed(x: TimedEventDef, cb: (id: string) => void): void {
  const out: string[] = [];
  linesOf(x as unknown as EventBody, out);
  for (const id of out) cb(id);
}

/** 章内各段时长的简表（给报告用）。 */
export function textDuration(ids: readonly string[]): number { return textDurationOf(ids); }
