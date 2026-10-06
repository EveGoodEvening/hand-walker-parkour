// src/sim/Pace.ts —— 段内的速度控制：名义步频、减速（slow）、停拍（stop）、停拍里的自动爬行（autoCrawl）、
// 段中换挡（cadence）（DESIGN.md §2.3、§4.0、§8.5 EventBody）。CORE 编写，WP1 补全（检查点之后补上段中换挡）。
// Sim 和 Solver 共用同一份代码推进里程，保证求解器预演的 s(t) 与实际模拟逐 tick 完全一致（自动驾驶按位置执行）。
import type { CompiledSegment, EventBody, TimedEventDef } from '../levels/schema';

type SlowBody = Extract<EventBody, { type: 'slow' }>;
type StopBody = Extract<EventBody, { type: 'stop' }>;
type CadenceBody = Extract<EventBody, { type: 'cadence' }>;

export interface PaceEvent { at: number; id?: string; body: SlowBody | StopBody | CadenceBody }

/** 可被 Sim 和 Solver 复制的速度状态。 */
export interface PaceState {
  s: number;
  tSeg: number;
  /** 上一 tick 的基础速度（不含受击倍率与全局倍率）。 */
  base: number;
  /** 下一个待触发的 pace 事件下标。 */
  cursor: number;
  slow: { t0: number; speed: number; seconds: number; ramp: number; from: number } | null;
  stop: { t0: number; seconds: number; crawls: Array<{ t0: number; speed: number; seconds: number }>; endAt: number | null } | null;
  cad: { beat0: number; from: number; to: number; beats: number } | null;
  /** 停拍 timeline 里的 end 已到：本段结束。 */
  ended: boolean;
}

export function paceEvents(seg: CompiledSegment): PaceEvent[] {
  if (seg.kind !== 'run') return [];
  return seg.events.filter((e): e is PaceEvent => e.body.type === 'slow' || e.body.type === 'stop' || e.body.type === 'cadence');
}

export function createPaceState(seg: CompiledSegment, s: number, tSeg: number): PaceState {
  const beat = (s - seg.s0) / seg.stride;
  const evs = paceEvents(seg);
  let cursor = 0;
  // 检查点之前的 pace 事件视为已过去：减速、停拍是临时的，不补放；段中换挡（cadence）是持续的，按它的终态补上（WP1）
  const p: PaceState = { s, tSeg, base: 0, cursor: 0, slow: null, stop: null, cad: null, ended: false };
  while (cursor < evs.length && (evs[cursor] as PaceEvent).at < beat - 1e-9) {
    const e = evs[cursor] as PaceEvent;
    if (e.body.type === 'cadence') p.cad = { beat0: e.at, from: nominalCadence(seg, p, e.at), to: e.body.to, beats: e.body.beats };
    cursor++;
  }
  p.cursor = cursor;
  return p;
}

export function clonePace(p: PaceState): PaceState {
  return {
    ...p,
    slow: p.slow ? { ...p.slow } : null,
    stop: p.stop ? { ...p.stop, crawls: p.stop.crawls.map((c) => ({ ...c })) } : null,
    cad: p.cad ? { ...p.cad } : null,
  };
}

/** 名义步频（含段中换挡）。 */
export function nominalCadence(seg: CompiledSegment, p: PaceState, beat: number): number {
  if (p.cad) {
    const k = Math.min(1, Math.max(0, (beat - p.cad.beat0) / Math.max(1e-6, p.cad.beats)));
    return p.cad.from + (p.cad.to - p.cad.from) * k;
  }
  return seg.cadenceAt(beat);
}

/** 当前 tick 的基础速度（m/s），不含受击与全局倍率。 */
export function baseSpeed(seg: CompiledSegment, p: PaceState): number {
  const beat = (p.s - seg.s0) / seg.stride;
  const nominal = nominalCadence(seg, p, beat) * seg.stride;
  const t = p.tSeg;
  if (p.stop) {
    const st = p.stop;
    if (t < st.t0 + st.seconds) {
      for (const c of st.crawls) if (t >= c.t0 && t < c.t0 + c.seconds) return c.speed;
      return 0;
    }
  }
  if (p.slow) {
    const sl = p.slow;
    const dt = t - sl.t0;
    const total = sl.ramp * 2 + sl.seconds;
    if (dt < 0) return nominal;
    if (dt < sl.ramp) return sl.from + (sl.speed - sl.from) * (dt / sl.ramp);
    if (dt < sl.ramp + sl.seconds) return sl.speed;
    if (dt < total) return sl.speed + (nominal - sl.speed) * ((dt - sl.ramp - sl.seconds) / sl.ramp);
  }
  return nominal;
}

/** 是否处于停拍（速度为 0 或自动爬行）。 */
export function inStop(p: PaceState): boolean {
  return !!p.stop && p.tSeg < p.stop.t0 + p.stop.seconds;
}
/** 是否处于自动爬行。 */
export function inAutoCrawl(p: PaceState): boolean {
  if (!p.stop || !inStop(p)) return false;
  return p.stop.crawls.some((c) => p.tSeg >= c.t0 && p.tSeg < c.t0 + c.seconds);
}

/**
 * 推进一个 tick：先按当前状态取速度并前进，再触发越过的 pace 事件。
 * 返回本 tick 新触发的 pace 事件（Sim 用来安排 timeline 与发 beat）。
 */
export function advancePace(seg: CompiledSegment, p: PaceState, evs: readonly PaceEvent[], mul: number, dt: number): PaceEvent[] {
  const base = baseSpeed(seg, p);
  p.base = base;
  p.s += base * mul * dt;
  p.tSeg += dt;
  const fired: PaceEvent[] = [];
  const beat = (p.s - seg.s0) / seg.stride;
  while (p.cursor < evs.length && (evs[p.cursor] as PaceEvent).at <= beat + 1e-9) {
    const e = evs[p.cursor++] as PaceEvent;
    fired.push(e);
    startPaceEvent(seg, p, e, beat);
  }
  if (p.stop && p.stop.endAt !== null && p.tSeg >= p.stop.endAt - 1e-9) p.ended = true;
  return fired;
}

/** 手动推进（受击倍率不同时 Sim 自己算位移后调用）：只处理时间与事件触发。 */
export function startPaceEvent(seg: CompiledSegment, p: PaceState, e: PaceEvent, beat: number): void {
  const b = e.body;
  if (b.type === 'slow') {
    p.slow = { t0: p.tSeg, speed: b.speed, seconds: b.seconds, ramp: b.ramp ?? 0.5, from: nominalCadence(seg, p, beat) * seg.stride };
  } else if (b.type === 'stop') {
    const crawls: Array<{ t0: number; speed: number; seconds: number }> = [];
    let endAt: number | null = null;
    for (const te of b.timeline as TimedEventDef[]) {
      if (te.type === 'autoCrawl') crawls.push({ t0: p.tSeg + te.at, speed: te.speed, seconds: te.seconds });
      if (te.type === 'end') endAt = p.tSeg + te.at;
    }
    p.stop = { t0: p.tSeg, seconds: b.seconds, crawls, endAt };
  } else if (b.type === 'cadence') {
    p.cad = { beat0: beat, from: nominalCadence(seg, p, beat), to: b.to, beats: b.beats };
  }
}
