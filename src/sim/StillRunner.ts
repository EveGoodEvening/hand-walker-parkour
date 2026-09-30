// src/sim/StillRunner.ts —— 静场与站立段的时间线（DESIGN.md §2.2 静场、§4.0、§8.5 StillInput）。CORE 编写，WP1 补全。
// 时间线按秒推进；到 input.at 时暂停，等待单一输入，超时自动完成、不罚；完成后按 onDone 的相对时刻继续。
// 等待时间不计入 duration（R13）。输入方式：
//   hold  ：连续按住 ↓ 满 holdSeconds 秒（松手清零、重新计时）；按住期间满 progress[i].at 秒时出字（每次重新按住都重新出）。
//   tap   ：按一下 ↓。
//   taps3 ：按三下 ↓（每一下发一个触地子事件：掌根、指节、指腹，§4.4 结尾「床单上响一声」）。
//   any   ：任意游玩键（←→↑↓、Q、E；Game 只把这些交给模拟）。
// 站立段（Stand.ts）把输入交给外部处理（external = true）：到 input.at 时照样暂停时间线，由 Stand 调 completeInput()。
import type { Action, HintId, InputEvent } from '../core/types';
import type { CompiledSegment, EventBody, StillInput, StillSegmentDef, StandSegmentDef, TimedEventDef } from '../levels/schema';

export interface StillFire { id?: string; body: EventBody }
interface Queued { at: number; seq: number; id?: string; body: EventBody }

export class StillRunner {
  seg: CompiledSegment | null = null;
  /** 时间线时间（不含等待）。 */
  clock = 0;
  /** 本段总流逝时间（含等待）。 */
  elapsed = 0;
  waiting = false;
  inputDone = false;
  /** 当前这一次连续按住的秒数。 */
  held = 0;
  waitT = 0;
  taps = 0;
  done = false;
  /** true：输入由外部（Stand）处理。 */
  external = false;
  /** 额外的结束条件（站立段：第七步已经摔倒）。 */
  gate: (() => boolean) | null = null;
  private queue: Queued[] = [];
  private seq = 0;
  private progressFired: number[] = [];

  get input(): StillInput | undefined {
    const d = this.seg?.def as StillSegmentDef | StandSegmentDef | undefined;
    return d?.input;
  }
  get duration(): number {
    const d = this.seg?.def as StillSegmentDef | StandSegmentDef | undefined;
    return d?.duration ?? 0;
  }
  get prompt(): HintId | null { return this.waiting ? this.input?.hint ?? null : null; }

  start(seg: CompiledSegment, opts: { external?: boolean; gate?: () => boolean } = {}): void {
    this.seg = seg;
    this.clock = 0; this.elapsed = 0; this.waiting = false; this.inputDone = false; this.held = 0; this.waitT = 0; this.taps = 0;
    this.done = false; this.progressFired = []; this.seq = 0;
    this.external = opts.external === true;
    this.gate = opts.gate ?? null;
    this.queue = seg.events.map((e) => ({ ...e, seq: this.seq++ }));
  }

  /** 在时间线上排一个事件（at = 时间线秒，可以早于现在：下个 tick 立即触发）。 */
  schedule(at: number, body: EventBody, id?: string): void {
    const q: Queued = { at, seq: this.seq++, body };
    if (id !== undefined) q.id = id;
    this.queue.push(q);
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  /** 输入完成（外部或内部）：排 onDone，继续时间线。 */
  completeInput(): void {
    const inp = this.input;
    if (!inp || this.inputDone) return;
    this.waiting = false;
    this.inputDone = true;
    for (const e of (inp.onDone ?? []) as TimedEventDef[]) {
      const { at, id, ...rest } = e as TimedEventDef & Record<string, unknown>;
      this.schedule(this.clock + at, rest as unknown as EventBody, id as string | undefined);
    }
  }

  /**
   * 推进一个 tick。fire 按时间顺序收到到期的事件；onTap(i) 在 taps3 的第 i 下（1..3）时调用。
   * 返回提示是否变化。
   */
  step(dt: number, events: readonly InputEvent[], held: ReadonlySet<Action>, fire: (f: StillFire) => void, onTap?: (i: number) => void): { promptChanged: boolean } {
    let promptChanged = false;
    if (!this.seg || this.done) return { promptChanged };
    this.elapsed += dt;
    const inp = this.input;
    if (this.waiting && inp) {
      this.waitT += dt;
      if (this.external) return { promptChanged };
      let complete = false;
      if (inp.mode === 'hold') {
        if (held.has('down')) this.held += dt;
        else if (this.held > 0) { this.held = 0; this.progressFired = []; }
        for (const p of inp.progress ?? []) {
          if (this.held >= p.at - 1e-9 && !this.progressFired.includes(p.at)) {
            this.progressFired.push(p.at);
            fire({ body: { type: 'text', line: p.line } });
          }
        }
        if (this.held >= (inp.holdSeconds ?? 0.5) - 1e-9) complete = true;
      } else {
        for (const e of events) {
          if (e.phase !== 'down') continue;
          const counts = inp.mode === 'any' ? e.action !== 'pause' : e.action === 'down' || e.action === 'confirm';
          if (!counts) continue;
          this.taps++;
          if (inp.mode === 'taps3' && this.taps <= 3) onTap?.(this.taps);
        }
        const need = inp.mode === 'taps3' ? 3 : 1;
        if (this.taps >= need) complete = true;
      }
      if (this.waitT >= inp.timeout - 1e-9) complete = true;
      if (complete) { this.completeInput(); promptChanged = true; }
      return { promptChanged };
    }
    this.clock += dt;
    // 先触发到期的事件，再判断是否进入等待
    while (this.queue.length && (this.queue[0] as Queued).at <= this.clock + 1e-9) {
      const e = this.queue.shift() as Queued;
      this.fireOne(e, fire);
    }
    if (inp && !this.inputDone && !this.waiting && this.clock >= inp.at - 1e-9) {
      this.waiting = true; this.held = 0; this.waitT = 0; this.taps = 0; this.progressFired = [];
      promptChanged = true;
      return { promptChanged };
    }
    const end = Math.max(this.duration, this.queue.length ? (this.queue[this.queue.length - 1] as Queued).at : 0);
    if (this.clock >= end - 1e-9 && this.queue.length === 0 && (!inp || this.inputDone) && (!this.gate || this.gate())) this.done = true;
    return { promptChanged };
  }

  /** 跳过：立刻触发剩余的全部事件（含 onDone），然后结束。extra 为调用方另外要补发的事件（站立段的按步事件）。 */
  skip(fire: (f: StillFire) => void, extra: StillFire[] = []): void {
    const inp = this.input;
    if (inp && !this.inputDone) {
      for (const e of this.queue.filter((q) => q.at < inp.at)) this.fireOne(e, fire);
      this.queue = this.queue.filter((q) => q.at >= inp.at);
      this.clock = Math.max(this.clock, inp.at);
      this.completeInput();
    }
    for (const e of this.queue) this.fireOne(e, fire);
    for (const f of extra) fire(f);
    this.queue = [];
    this.waiting = false; this.inputDone = true; this.done = true;
  }

  /** 队列里还没触发的事件数（测试与站立段的结束判断用）。 */
  get pending(): number { return this.queue.length; }

  private fireOne(e: Queued, fire: (f: StillFire) => void): void {
    const f: StillFire = { body: e.body };
    if (e.id !== undefined) f.id = e.id;
    fire(f);
  }
}
