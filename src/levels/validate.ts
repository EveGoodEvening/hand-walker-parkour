// src/levels/validate.ts —— 关卡校验器（DESIGN.md §2.8 可读性铁律）。CORE 写初版（R1–R8、R10、R13 与静态检查），归 WP1。
// R9、R11、R12、R14 以及 R6 的几何部分由 WP1 / WP2 补全。
//
// 做法：R2、R3、R5、R6（休息窗）、R7（接触后 1.2 s）、R8、R10 统一转成一次带约束的求解——
// 「存在一条 0 受击的路线，它的所有输入彼此相隔 ≥ 本章最小间隔，并且都不落在任何休息窗里」。
// 这正是这些规则想保证的：休息窗里不需要任何必需动作。解不出来时再逐项放宽约束，报告是哪一条规则挡住了。
//
// 对 DESIGN.md 的解释（写在这里，lead 会回写文档）：
//   · R6「任意 20 s 内最多一个主异常」：`double`（替身出现）只是反光面开始工作，不单独计数；同一替身之后的
//     `doubleMod` 才是那一次异常。否则 §8.6 的第一章数据本身就违反（1-3 的 @6 与 @38、1-6 的 @2 与停拍）。
//   · 回头窗口 then 里的异常按「窗口开始」计时（玩家最早能触发的时刻，也是提示出现的时刻）；
//     如果按「窗口结束自动回头」计算会违反 20 s，则只给警告（第一章 1-5 → 1-6 就是这种情况，约 18.9 s）。
//   · R7「该行只有它，另两条车道空着」：理解为该行只有这一类别（同类别占多条车道允许，例如 @68 的 HHH 长桌），
//     并且只对需要操作的类别（low / bar / block）检查；soft 与 pickup 不需要操作，不适用。
//     「新种类首次出现时该行只有它」受 KIT_SYMBOLS 随机轮换影响，只给警告。
//   · R4 的「雾的清晰距离」取 near + 0.35 × (far × 低档 fogMul − near)。CORE 的 LampField 桩是统一亮度，亮度一项恒通过。
import { LIMITS, MIN_ACTION_GAP, TEXT, TICK_DT } from '../core/constants';
import type { SolveFrom, SolverAPI } from '../core/contracts';
import { QUALITY } from '../core/quality';
import type { AtmosphereId, HintId, Lane, ObstacleClass } from '../core/types';
import { advancePace, createPaceState, paceEvents } from '../sim/Pace';
import { obstacleState } from '../sim/Track';
import { TUNING } from '../sim/tuning';
import { compile } from './compile';
import { lineText } from './lines';
import type {
  ChapterDef, CompiledChapter, CompiledSegment, EventBody, RunSegmentDef, StillSegmentDef, StandSegmentDef, TimedEventDef,
} from './schema';

export interface Issue { level: 'error' | 'warn'; rule: string; chapter: string; segment?: string; msg: string }
export interface ValidateReport {
  chapter: string; ok: boolean; issues: Issue[];
  stats: { runSec: number; nonRunSec: number; totalSec: number; nonRunRatio: number; segments: Array<{ id: string; kind: string; sec: number }> };
}

/** 各氛围的雾（§5.2），R4 用。 */
const FOG: Record<AtmosphereId, [number, number]> = {
  morning: [10, 48], noon: [12, 50], labNorth: [8, 38], nightIndoor: [6, 30], rainNight: [4, 26], busNight: [3, 14], homeDark: [3, 14],
  dream: [20, 120], dreamGray: [20, 60], dawn: [8, 45], overcast: [15, 70], fluorescent: [6, 25], voidDark: [4, 18],
};
export function readDistance(atm: AtmosphereId): number {
  const [near, far] = FOG[atm];
  const f = far * QUALITY.low.fogMul;
  return near + 0.35 * Math.max(0, f - near);
}

const HINT_FOR: Partial<Record<ObstacleClass, HintId>> = { low: 'jump', bar: 'duck', block: 'lane' };
const REQUIRED: ReadonlySet<ObstacleClass> = new Set(['low', 'bar', 'block']);
const MAIN_ANOMALY = new Set<EventBody['type']>(['double', 'doubleMod', 'shadow', 'memory', 'board']);

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

interface Win { a: number; b: number; rule: string; why: string }

/** 段内所有「时刻」事件（秒）：按拍的事件、slow/stop 的 timeline、回头窗口 then（按窗口开始）。 */
function timedEvents(seg: CompiledSegment, tl: Timeline): Array<{ t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number }> {
  const out: Array<{ t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number }> = [];
  const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
  const fromBeat = (tl.s0 - seg.s0) / seg.stride;
  for (const e of seg.events) {
    if (e.at < fromBeat - 1e-9) continue;   // 检查点之前的事件不会再发生
    const te = tAtBeat(e.at);
    const item: { t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number } = { t: te, body: e.body, inWindow: false, tLate: te };
    if (e.id !== undefined) item.id = e.id;
    out.push(item);
    if (e.body.type === 'slow' || e.body.type === 'stop') {
      for (const x of (e.body.timeline ?? []) as TimedEventDef[]) {
        const { at, id, ...rest } = x as TimedEventDef & Record<string, unknown>;
        const it: { t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number } = { t: te + at, body: rest as unknown as EventBody, inWindow: false, tLate: te + at };
        if (id !== undefined) it.id = id;
        out.push(it);
      }
    }
  }
  for (const w of seg.windows) {
    if (w.to < fromBeat) continue;
    const a = tAtBeat(w.from), b = tAtBeat(w.to);
    for (const x of w.then ?? []) {
      const { at, id, ...rest } = x as TimedEventDef & Record<string, unknown>;
      const it: { t: number; body: EventBody; id?: string; inWindow: boolean; tLate: number } = { t: a + at, body: rest as unknown as EventBody, inWindow: true, tLate: b + at };
      if (id !== undefined) it.id = id;
      out.push(it);
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

function isMainAnomaly(body: EventBody, prevFollowerMode: { v: string }): boolean {
  if (body.type === 'follower' && body.def.mode) {
    const debut = (prevFollowerMode.v === 'hidden' || prevFollowerMode.v === 'absent') && body.def.mode !== 'hidden' && body.def.mode !== 'absent';
    prevFollowerMode.v = body.def.mode;
    return debut;
  }
  if (body.type === 'shadow') return body.mode !== 'normal' && body.mode !== 'blob';
  return MAIN_ANOMALY.has(body.type);
}

function textDuration(body: EventBody): number {
  if (body.type !== 'text') return 0;
  const ids = Array.isArray(body.line) ? body.line : [body.line];
  const chars = ids.map((i) => lineText(i as string).length).reduce((a, b) => a + b, 0);
  return (chars * TEXT.msPerChar + TEXT.baseMs) / 1000;
}

/** 段内休息窗（以 tSeg 秒计），用于约束求解。 */
function restWindows(seg: CompiledSegment, tl: Timeline, firstClassRows: Map<ObstacleClass, number>, chapterMode: { v: string }): Win[] {
  const W: Win[] = [];
  const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
  for (const e of timedEvents(seg, tl)) {
    if (e.body.type === 'text' && e.body.style !== 'board') W.push({ a: e.t - 0.4, b: e.t + 0.8, rule: 'R5', why: `text ${String(e.body.line)}` });
    if (isMainAnomaly(e.body, chapterMode) && e.body.type !== 'double') W.push({ a: e.t - 1.0, b: e.t + 2.0, rule: 'R6', why: `anomaly ${e.body.type}` });
    if (e.body.type === 'double') W.push({ a: e.t - 1.0, b: e.t + 2.0, rule: 'R6', why: 'anomaly double' });
  }
  const fromBeat = (tl.s0 - seg.s0) / seg.stride;
  for (const cp of seg.checkpoints) { if (cp < fromBeat - 1e-9) continue; const t = tAtBeat(cp); W.push({ a: t, b: t + 1.6, rule: 'R8', why: `checkpoint @${cp}` }); }
  W.push({ a: tl.tEnd - 0.8, b: tl.tEnd + 1, rule: 'R8', why: 'segment end' });
  for (const w of seg.windows) {
    if (w.type !== 'lookBack' || w.to < fromBeat) continue;
    const a = tAtBeat(w.from), b = tAtBeat(w.to);
    let thenDur = 0;
    for (const x of w.then ?? []) if (x.type === 'text') thenDur = Math.max(thenDur, x.at + 0.8);
    W.push({ a, b: b + thenDur + 0.8, rule: 'R10', why: `lookBack window ${w.id ?? ''}` });
  }
  for (const [cls, oid] of firstClassRows) {
    const o = seg.obstacles.find((q) => q.id === oid);
    if (!o) continue;
    const tc = timeAtS(tl, o.s0 - TUNING.hitbox.sFront);
    W.push({ a: tc + 0.02, b: tc + 1.2, rule: 'R7', why: `after first ${cls}` });
  }
  return W;
}

/** 校验一章。solver 由调用方传入（registry 或 CORE 的 Solver）。 */
export function validateChapter(def: ChapterDef, solver: SolverAPI, opts: { seed?: number } = {}): ValidateReport {
  const issues: Issue[] = [];
  const ch: CompiledChapter = compile(def, opts.seed);
  const chId = def.id;
  const err = (rule: string, msg: string, segment?: string) => issues.push({ level: 'error', rule, chapter: chId, msg, ...(segment ? { segment } : {}) });
  const warn = (rule: string, msg: string, segment?: string) => issues.push({ level: 'warn', rule, chapter: chId, msg, ...(segment ? { segment } : {}) });
  const minGap = MIN_ACTION_GAP[chId];

  // —— 静态检查 ——
  const ids = new Set<string>();
  const segIds = new Set<string>();
  const collectIds = (evs: ReadonlyArray<{ id?: string; type?: string } & Record<string, unknown>>) => {
    for (const e of evs) {
      if (e.id) ids.add(e.id);
      const tl = (e as { timeline?: Array<{ id?: string }> }).timeline;
      if (tl) collectIds(tl as never);
    }
  };
  for (const sd of def.segments) {
    if (segIds.has(sd.id)) err('static', `duplicate segment id ${sd.id}`, sd.id);
    segIds.add(sd.id);
    collectIds((sd.events ?? []) as never);
    if (sd.kind === 'run') for (const w of sd.windows ?? []) { if (w.id) ids.add(w.id); collectIds((w.then ?? []) as never); }
    if (sd.kind !== 'run' && sd.input) { collectIds((sd.input.onDone ?? []) as never); }
  }
  for (const l of def.outro.lines) if ('input' in l && l.id) ids.add(l.id);
  for (const rb of def.requiredBeats) if (!ids.has(rb)) err('static', `requiredBeat "${rb}" is not attached to any event/window/input id`);
  for (const lid of def.card) if (!lineText(lid)) err('static', `card line ${lid} missing`);

  // —— 逐段 ——
  const segStats: Array<{ id: string; kind: string; sec: number }> = [];
  let runSec = 0, nonRunSec = 0;
  const seenClass = new Set<ObstacleClass>();
  const seenKind = new Set<string>();
  const hintsSeen = new Set<HintId>();
  const anomalies: Array<{ a: number; b: number; what: string; seg: string }> = [];
  const followerMode = { v: 'hidden' };
  let chapterT = 0;

  for (const seg of ch.segments) {
    const sid = seg.def.id;
    if (seg.kind !== 'run') {
      const d = seg.def as StillSegmentDef | StandSegmentDef;
      if (d.duration > LIMITS.stillMaxSec) err('R13', `${seg.kind} ${sid} lasts ${d.duration}s > ${LIMITS.stillMaxSec}s`, sid);
      const wait = d.input ? Math.min(d.input.timeout, d.input.holdSeconds ?? 0.3) : 0;
      nonRunSec += d.duration + wait;
      segStats.push({ id: sid, kind: seg.kind, sec: d.duration + wait });
      for (const e of seg.events) {
        if (e.body.type === 'follower') followerMode.v = e.body.def.mode ?? followerMode.v;
        if (e.body.type === 'hint') hintsSeen.add(e.body.hint);
      }
      if (seg.def.follower.mode) followerMode.v = seg.def.follower.mode;
      chapterT += d.duration + wait;
      continue;
    }
    const def2 = seg.def as RunSegmentDef;
    if (def2.follower.mode) {
      const prev = followerMode.v;
      followerMode.v = def2.follower.mode;
      void prev;
    }
    const tl = nominalTimeline(seg);
    const sec = tl.tEnd;
    runSec += sec - tl.stopSec;
    nonRunSec += tl.stopSec;
    segStats.push({ id: sid, kind: 'run', sec });
    const tAtBeat = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);

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
        const tc = timeAtS(tl, o.s0 - TUNING.hitbox.sFront);
        const ok = (hintTimes.get(hint) ?? []).some((th) => th <= tc - 1.2) || hintsSeen.has(hint);
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
          const x = lane * 1.1;
          const blocked = blocks.some((o) => {
            obstacleState(o, t, beat, st);
            return st.active && o.s0 + st.ds <= s + 0.1 && o.s1 + st.ds >= s && st.x0 < x + 0.22 && st.x1 > x - 0.22;
          });
          if (!blocked) free++;
        }
        if (free === 0) { err('R1', `no passable lane at s=${(s - seg.s0).toFixed(1)} m (beat ${beat.toFixed(1)})`, sid); break; }
      }
    }

    // R4：可读距离
    const rd = readDistance(seg.def.atmosphere);
    for (const o of seg.obstacles) {
      if (!REQUIRED.has(o.cls)) continue;
      const tc = timeAtS(tl, o.s0 - TUNING.hitbox.sFront);
      const tr = timeAtS(tl, o.s0 - rd);
      if (tc - tr < 1.2 - 1e-6 && o.s0 - rd > seg.s0) err('R4', `${o.kind} @${o.beat} readable only ${(tc - tr).toFixed(2)} s before contact`, sid);
    }

    // R10：回头窗口长度
    for (const w of seg.windows) {
      if (w.type === 'lookBack' && tAtBeat(w.to) - tAtBeat(w.from) < 1.2 - 1e-6) err('R10', `lookBack window ${w.id ?? ''} shorter than 1.2 s`, sid);
    }

    // R6：主异常时刻（章内累计，用于 20 s 规则）
    const modeTmp = { v: followerMode.v };
    for (const e of timedEvents(seg, tl)) {
      if (isMainAnomaly(e.body, modeTmp) && e.body.type !== 'double') anomalies.push({ a: chapterT + e.t, b: chapterT + e.tLate, what: `${e.body.type}${e.id ? `(${e.id})` : ''}`, seg: sid });
    }

    // R2 / R3 / R5 / R6 / R7 / R8 / R10：带约束求解，从段首与每个检查点出发
    const starts = seg.checkpoints;
    for (const cp of starts) {
      const tlc = cp === 0 ? tl : nominalTimeline(seg, cp);
      const from: SolveFrom = { s: seg.s0 + cp * seg.stride, lane: 0, tSeg: tlc.t0 };
      const wins = restWindows(seg, tlc, cp === 0 ? firstClassRows : new Map(), { v: followerMode.v });
      const forbid = wins.map((w) => [w.a, w.b] as const);
      const noAsk = def2.crowd === true;
      const base = solver.solve(seg, { from, noAsk });
      if (!base) { err('R2', `no zero-hit route from @${cp}`, sid); continue; }
      const full = solver.solve(seg, { from, noAsk, minGap, forbid });
      if (full) continue;
      if (!solver.solve(seg, { from, noAsk, minGap })) { err('R3', `no route with inputs ≥ ${minGap}s apart from @${cp}`, sid); continue; }
      const rules = Array.from(new Set(wins.map((w) => w.rule)));
      let blamed = false;
      for (const r of rules) {
        const only = wins.filter((w) => w.rule === r).map((w) => [w.a, w.b] as const);
        if (!solver.solve(seg, { from, noAsk, minGap, forbid: only })) {
          blamed = true;
          // 细化到具体窗口
          const culprits = wins.filter((w) => w.rule === r).filter((w) => !solver.solve(seg, { from, noAsk, minGap, forbid: [[w.a, w.b]] }));
          err(r, `required action inside rest window from @${cp}: ${(culprits.length ? culprits : wins.filter((w) => w.rule === r)).map((w) => `${w.why} [${w.a.toFixed(2)}, ${w.b.toFixed(2)}]s`).join('; ')}`, sid);
        }
      }
      if (!blamed) err('R5-R10', `rest windows together leave no route from @${cp}`, sid);
    }
    // 追随者模式随段内事件推进
    for (const e of seg.events) if (e.body.type === 'follower' && e.body.def.mode) followerMode.v = e.body.def.mode;
    chapterT += sec;
  }

  // R6：任意 20 s 内最多一个主异常
  anomalies.sort((x, y) => x.a - y.a);
  for (let i = 1; i < anomalies.length; i++) {
    const p = anomalies[i - 1] as { a: number; b: number; what: string; seg: string };
    const q = anomalies[i] as { a: number; b: number; what: string; seg: string };
    const gapEarly = q.a - p.a;
    const gapLate = q.a - p.b;
    if (gapEarly < 20 - 1e-6) err('R6', `main anomalies ${p.what} (${p.seg}) and ${q.what} (${q.seg}) only ${gapEarly.toFixed(1)} s apart`);
    else if (gapLate < 20 - 1e-6) warn('R6', `main anomalies ${p.what} (${p.seg}) and ${q.what} (${q.seg}) are ${gapLate.toFixed(1)} s apart if the look-back fires at the end of its window`);
  }

  // R13：非跑动占比
  const total = runSec + nonRunSec;
  const ratio = total > 0 ? nonRunSec / total : 0;
  if (ratio > LIMITS.nonRunMaxRatio + 1e-9) err('R13', `non-run time ${(ratio * 100).toFixed(1)}% > 25%`);

  return {
    chapter: chId, ok: !issues.some((i) => i.level === 'error'), issues,
    stats: { runSec, nonRunSec, totalSec: total, nonRunRatio: ratio, segments: segStats },
  };
}
