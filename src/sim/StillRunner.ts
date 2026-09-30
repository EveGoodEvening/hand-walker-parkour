// src/sim/StillRunner.ts —— 静场时间线（DESIGN.md §2.2 静场、§4.0、§8.5 StillInput）。CORE 编写，归 WP1。
// 时间线按秒推进；到 input.at 时暂停，等待单一输入（hold：连续按住 ↓ holdSeconds 秒；tap / any：按一下；
// taps3：按三下），超时自动完成、不罚。完成后按 onDone 的相对时刻继续。等待时间不计入 duration（R13）。
// progress（按住满 N 秒出字）由 WP1 补全；CORE 版本在按住达到 at 秒时触发一次。
import type { Action, HintId, InputEvent } from '../core/types';
import type { CompiledSegment, EventBody, StillInput, StillSegmentDef, StandSegmentDef } from '../levels/schema';

export interface StillFire { id?: string; body: EventBody }

export class StillRunner {
  seg: CompiledSegment | null = null;
  /** 时间线时间（不含等待）。 */
  clock = 0;
  /** 本段总流逝时间（含等待）。 */
  elapsed = 0;
  waiting = false;
  inputDone = false;
  held = 0;
  waitT = 0;
  taps = 0;
  done = false;
  private queue: Array<{ at: number; id?: string; body: EventBody }> = [];
  private progressFired = new Set<number>();

  get input(): StillInput | undefined {
    const d = this.seg?.def as StillSegmentDef | StandSegmentDef | undefined;
    return d?.input;
  }
  get duration(): number {
    const d = this.seg?.def as StillSegmentDef | StandSegmentDef | undefined;
    return d?.duration ?? 0;
  }
  get prompt(): HintId | null { return this.waiting ? this.input?.hint ?? null : null; }

  start(seg: CompiledSegment): void {
    this.seg = seg;
    this.clock = 0; this.elapsed = 0; this.waiting = false; this.inputDone = false; this.held = 0; this.waitT = 0; this.taps = 0;
    this.done = false; this.progressFired.clear();
    this.queue = seg.events.map((e) => ({ ...e }));
  }

  /**
   * 推进一个 tick。返回本 tick 要触发的事件（按时间顺序），以及提示是否变化。
   */
  step(dt: number, events: readonly InputEvent[], held: ReadonlySet<Action>, fire: (f: StillFire) => void): { promptChanged: boolean } {
    let promptChanged = false;
    if (!this.seg || this.done) return { promptChanged };
    this.elapsed += dt;
    const inp = this.input;
    if (this.waiting && inp) {
      this.waitT += dt;
      let complete = false;
      if (inp.mode === 'hold') {
        if (held.has('down')) this.held += dt; else this.held = 0;
        for (const p of inp.progress ?? []) {
          if (this.held >= p.at && !this.progressFired.has(p.at)) { this.progressFired.add(p.at); fire({ body: { type: 'text', line: p.line } }); }
        }
        if (this.held >= (inp.holdSeconds ?? 0.5)) complete = true;
      } else {
        for (const e of events) {
          if (e.phase !== 'down') continue;
          if (inp.mode === 'any' || e.action === 'down' || e.action === 'confirm') this.taps++;
        }
        const need = inp.mode === 'taps3' ? 3 : 1;
        if (this.taps >= need) complete = true;
      }
      if (this.waitT >= inp.timeout) complete = true;
      if (complete) {
        this.waiting = false;
        this.inputDone = true;
        promptChanged = true;
        for (const e of inp.onDone ?? []) {
          const { at, id, ...rest } = e as typeof e & Record<string, unknown>;
          const item: { at: number; id?: string; body: EventBody } = { at: this.clock + at, body: rest as unknown as EventBody };
          if (id !== undefined) item.id = id;
          this.queue.push(item);
        }
        this.queue.sort((a, b) => a.at - b.at);
      }
      return { promptChanged };
    }
    this.clock += dt;
    // 先触发到期的事件，再判断是否进入等待
    while (this.queue.length && (this.queue[0] as { at: number }).at <= this.clock + 1e-9) {
      const e = this.queue.shift() as { at: number; id?: string; body: EventBody };
      const f: StillFire = { body: e.body };
      if (e.id !== undefined) f.id = e.id;
      fire(f);
    }
    if (inp && !this.inputDone && !this.waiting && this.clock >= inp.at - 1e-9) {
      this.waiting = true; this.held = 0; this.waitT = 0; this.taps = 0;
      promptChanged = true;
      return { promptChanged };
    }
    const end = Math.max(this.duration, this.queue.length ? (this.queue[this.queue.length - 1] as { at: number }).at : 0);
    if (this.clock >= end - 1e-9 && this.queue.length === 0 && (!inp || this.inputDone)) this.done = true;
    return { promptChanged };
  }

  /** 跳过：立刻触发剩余的全部事件（含 onDone），然后结束。 */
  skip(fire: (f: StillFire) => void): void {
    const inp = this.input;
    if (inp && !this.inputDone) {
      for (const e of this.queue.filter((q) => q.at < inp.at)) this.fireOne(e, fire);
      this.queue = this.queue.filter((q) => q.at >= inp.at);
      for (const e of inp.onDone ?? []) {
        const { at, id, ...rest } = e as typeof e & Record<string, unknown>;
        const item: { at: number; id?: string; body: EventBody } = { at: inp.at + at, body: rest as unknown as EventBody };
        if (id !== undefined) item.id = id;
        this.queue.push(item);
      }
      this.queue.sort((a, b) => a.at - b.at);
    }
    for (const e of this.queue) this.fireOne(e, fire);
    this.queue = [];
    this.waiting = false; this.inputDone = true; this.done = true;
  }

  private fireOne(e: { at: number; id?: string; body: EventBody }, fire: (f: StillFire) => void): void {
    const f: StillFire = { body: e.body };
    if (e.id !== undefined) f.id = e.id;
    fire(f);
  }
}
