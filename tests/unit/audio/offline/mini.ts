// tests/unit/audio/offline/mini.ts —— Node 里用的最小 OfflineAudioContext（DESIGN.md §8.10 WP7 验收 1、3、4、5）。WP7。
// Node 没有 WebAudio；这里按 Web Audio 规范实现声音包用到的那一部分节点，做真实的逐样本 DSP，
// 让 vitest 能把配方和整个引擎离线渲染出来、测峰值 / NaN / 起音 / 时间误差 / 总线电平。
// 实现要点（与规范一致的部分）：128 帧渲染量子；AudioParam 的 set / linear / exponential / target / curve 自动化与
// cancelScheduledValues；a-rate / k-rate；节点输入的上下混（speakers）；BiquadFilter 用规范公式（src/audio/dsp.ts）；
// StereoPanner 等功率；BufferSource 亚样本起点与线性插值；Convolver 均匀分块 FFT（重叠保留，零延迟）；WaveShaper 查表插值。
// 简化：DynamicsCompressor 只有静态曲线 + 起音 / 释放，没有前瞻和补偿增益（引擎会用校准量出这里的补偿增益 = 0 dB）。
import { biquadCoefs, type BiquadType } from '../../../../src/audio/dsp';

const Q = 128;

// ——————————————————— AudioBuffer ———————————————————
export class MiniAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(o: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = o.numberOfChannels; this.length = o.length; this.sampleRate = o.sampleRate;
    this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
  }
  get duration(): number { return this.length / this.sampleRate; }
  getChannelData(c: number): Float32Array { return this.data[c] as Float32Array; }
  copyToChannel(src: Float32Array, c: number, start = 0): void {
    const d = this.data[c] as Float32Array;
    d.set(src.subarray(0, Math.max(0, d.length - start)), start);
  }
  copyFromChannel(dst: Float32Array, c: number, start = 0): void {
    const d = this.data[c] as Float32Array;
    dst.set(d.subarray(start, start + dst.length));
  }
}

// ——————————————————— AudioParam ———————————————————
interface Ev { type: 'set' | 'lin' | 'exp' | 'target' | 'curve'; time: number; value: number; tau?: number; curve?: Float32Array; dur?: number; sv?: number }

export class MiniParam {
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  automationRate: 'a-rate' | 'k-rate';
  events: Ev[] = [];
  readonly inputs: MiniNode[] = [];
  private intrinsic: number;
  private last: number;
  private buf = new Float32Array(Q);
  constructor(private readonly ctx: MiniContext, def: number, rate: 'a-rate' | 'k-rate' = 'a-rate', min = -3.4028235e38, max = 3.4028235e38) {
    this.defaultValue = def; this.intrinsic = def; this.last = def; this.automationRate = rate; this.minValue = min; this.maxValue = max;
  }
  get value(): number { return this.last; }
  set value(v: number) { this.intrinsic = v; this.last = v; this.setValueAtTime(v, this.ctx.currentTime); }

  private insert(e: Ev): this {
    if (!Number.isFinite(e.time) || e.time < 0) throw new RangeError('bad automation time');
    const c = this.events.find((x) => x.type === 'curve' && e.time > x.time && e.time < x.time + (x.dur as number));
    if (c) throw new Error('NotSupportedError: automation event overlaps a value curve');
    let i = this.events.length;
    while (i > 0 && (this.events[i - 1] as Ev).time > e.time) i--;
    this.events.splice(i, 0, e);
    for (const x of this.events) x.sv = undefined;
    return this;
  }
  setValueAtTime(v: number, t: number): this { return this.insert({ type: 'set', time: t, value: v }); }
  linearRampToValueAtTime(v: number, t: number): this { return this.insert({ type: 'lin', time: t, value: v }); }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (v === 0) throw new RangeError('exponential ramp to 0');
    return this.insert({ type: 'exp', time: t, value: v });
  }
  setTargetAtTime(v: number, t: number, tau: number): this { return this.insert({ type: 'target', time: t, value: v, tau: Math.max(1e-9, tau) }); }
  setValueCurveAtTime(curve: ArrayLike<number>, t: number, dur: number): this {
    const c = Float32Array.from(curve as ArrayLike<number>);
    const end = t + dur;
    if (this.events.some((x) => x.time > t && x.time < end)) throw new Error('NotSupportedError: curve overlaps events');
    return this.insert({ type: 'curve', time: t, value: c[c.length - 1] as number, curve: c, dur });
  }
  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e.time < t);
    for (const x of this.events) x.sv = undefined;
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    const v = this.valueAt(t);
    this.cancelScheduledValues(t);
    return this.setValueAtTime(v, t);
  }

  /** 事件 i 开始时的值（target 的起点）。 */
  private startValue(i: number): number {
    const e = this.events[i] as Ev;
    if (e.sv === undefined) e.sv = this.evalWith(e.time, i);
    return e.sv;
  }
  /** 只用前 n 个事件求 t 时刻的值。 */
  private evalWith(t: number, n: number): number {
    let i = -1;
    for (let j = 0; j < n; j++) { if ((this.events[j] as Ev).time <= t) i = j; else break; }
    return this.valueGiven(i, t, n);
  }
  private endValue(i: number): number {
    const e = this.events[i] as Ev;
    if (e.type === 'target') return this.valueGiven(i, e.time, this.events.length);
    if (e.type === 'curve') return (e.curve as Float32Array)[0] as number;
    return e.value;
  }
  private valueGiven(i: number, t: number, n: number): number {
    const next = i + 1 < n ? (this.events[i + 1] as Ev) : null;
    if (next && (next.type === 'lin' || next.type === 'exp')) {
      const t0 = i >= 0 ? (this.events[i] as Ev).time : 0;
      const v0 = i >= 0 ? this.endValueAtStart(i) : this.intrinsic;
      const t1 = next.time, v1 = next.value;
      if (t1 <= t0) return v1;
      const x = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      if (next.type === 'lin') return v0 + (v1 - v0) * x;
      if (v0 === 0 || v0 * v1 < 0) return v0;
      return v0 * Math.pow(v1 / v0, x);
    }
    if (i < 0) return this.intrinsic;
    const e = this.events[i] as Ev;
    switch (e.type) {
      case 'target': { const sv = this.startValue(i); return e.value + (sv - e.value) * Math.exp(-(t - e.time) / (e.tau as number)); }
      case 'curve': {
        const c = e.curve as Float32Array, d = e.dur as number;
        if (t >= e.time + d) return c[c.length - 1] as number;
        const k = ((c.length - 1) * (t - e.time)) / d;
        const k0 = Math.floor(k), f = k - k0;
        return (c[k0] as number) + (((c[Math.min(c.length - 1, k0 + 1)] as number) - (c[k0] as number)) * f);
      }
      default: return e.value;
    }
  }
  /** 作为斜坡起点时事件 i 的值（target 取它在 next 之前延续到的值，简化为 i 的时刻）。 */
  private endValueAtStart(i: number): number { return this.endValue(i); }

  valueAt(t: number): number {
    let i = -1;
    for (let j = 0; j < this.events.length; j++) { if ((this.events[j] as Ev).time <= t) i = j; else break; }
    return this.valueGiven(i, t, this.events.length);
  }

  /** 这一块的参数值（a-rate：逐样本；k-rate：块首一个值）。返回 { buf, constant }。 */
  compute(q: number): { buf: Float32Array; constant: boolean } {
    const sr = this.ctx.sampleRate;
    const t0 = (q * Q) / sr;
    const b = this.buf;
    const n = this.events.length;
    let constant = true;
    if (n === 0) b.fill(this.intrinsic);
    else {
      // 修剪：早已过去的事件（保留生效事件的前一个）
      let i = -1;
      for (let j = 0; j < n; j++) { if ((this.events[j] as Ev).time <= t0) i = j; else break; }
      if (i > 4) {
        for (let j = Math.max(0, i - 1); j <= i; j++) if ((this.events[j] as Ev).type === 'target') this.startValue(j);
        this.events.splice(0, i - 1);
        i = 1;
      }
      const m = this.events.length;
      const rate = this.automationRate === 'k-rate';
      const tEnd = t0 + (Q - 1) / sr;
      const e = i >= 0 ? (this.events[i] as Ev) : null;
      const next = i + 1 < m ? (this.events[i + 1] as Ev) : null;
      const settled = !next || next.time > tEnd;
      const isFlat = settled && (!e || e.type === 'set' || e.type === 'lin' || e.type === 'exp' || (e.type === 'curve' && t0 >= e.time + (e.dur as number)));
      if (rate || isFlat) b.fill(this.valueGiven(i, t0, m));
      else {
        constant = false;
        let k = i;
        for (let s = 0; s < Q; s++) {
          const t = t0 + s / sr;
          while (k + 1 < m && (this.events[k + 1] as Ev).time <= t) k++;
          b[s] = this.valueGiven(k, t, m);
        }
      }
    }
    if (this.inputs.length) {
      for (const inp of this.inputs) {
        const o = inp.pull(q);
        if (!o) continue;
        constant = false;
        const ch = o.length;
        for (let s = 0; s < Q; s++) {
          let v = 0;
          for (let c = 0; c < ch; c++) v += (o[c] as Float32Array)[s] as number;
          b[s] = (b[s] as number) + v / ch;
        }
      }
    }
    this.last = b[Q - 1] as number;
    return { buf: b, constant };
  }
}

// ——————————————————— 节点基类 ———————————————————
export abstract class MiniNode {
  readonly inputs: MiniNode[] = [];
  readonly outputs: Array<MiniNode | MiniParam> = [];
  channelCount = 2;
  channelCountMode: 'max' | 'clamped-max' | 'explicit' = 'max';
  channelInterpretation: 'speakers' | 'discrete' = 'speakers';
  readonly numberOfInputs: number = 1;
  readonly numberOfOutputs: number = 1;
  private cq = -1;
  private cache: Float32Array[] | null = null;
  private mix: Float32Array[] = [];
  protected outBufs: Float32Array[] = [];
  constructor(readonly context: MiniContext) {}

  connect<T extends MiniNode | MiniParam>(dest: T): T {
    if (dest instanceof MiniParam) dest.inputs.push(this); else (dest as MiniNode).inputs.push(this);
    this.outputs.push(dest);
    return dest;
  }
  disconnect(dest?: MiniNode | MiniParam): void {
    const targets = dest ? this.outputs.filter((o) => o === dest) : [...this.outputs];
    if (dest && !targets.length) throw new Error('InvalidAccessError: not connected');
    for (const t of targets) {
      const arr = t.inputs as MiniNode[];
      const i = arr.indexOf(this);
      if (i >= 0) arr.splice(i, 1);
      const j = this.outputs.indexOf(t);
      if (j >= 0) this.outputs.splice(j, 1);
    }
  }

  pull(q: number): Float32Array[] | null {
    if (this.cq === q) return this.cache;
    this.cq = q;
    this.cache = this.process(q);
    return this.cache;
  }
  protected abstract process(q: number): Float32Array[] | null;

  protected out(ch: number): Float32Array[] {
    while (this.outBufs.length < ch) this.outBufs.push(new Float32Array(Q));
    return this.outBufs.slice(0, ch);
  }

  /** 输入求和（按 channelCountMode 上下混）；全部静音时返回 null。 */
  protected mixInputs(q: number): Float32Array[] | null {
    const ins: Float32Array[][] = [];
    let maxCh = 0;
    for (const n of this.inputs) {
      const o = n.pull(q);
      if (o) { ins.push(o); maxCh = Math.max(maxCh, o.length); }
    }
    if (!ins.length) return null;
    let ch = maxCh;
    if (this.channelCountMode === 'explicit') ch = this.channelCount;
    else if (this.channelCountMode === 'clamped-max') ch = Math.min(maxCh, this.channelCount);
    while (this.mix.length < ch) this.mix.push(new Float32Array(Q));
    const out = this.mix.slice(0, ch);
    for (const b of out) b.fill(0);
    for (const o of ins) {
      if (o.length === ch) for (let c = 0; c < ch; c++) addTo(out[c] as Float32Array, o[c] as Float32Array, 1);
      else if (o.length === 1 && ch === 2) { addTo(out[0] as Float32Array, o[0] as Float32Array, 1); addTo(out[1] as Float32Array, o[0] as Float32Array, 1); }
      else if (o.length === 2 && ch === 1) { addTo(out[0] as Float32Array, o[0] as Float32Array, 0.5); addTo(out[0] as Float32Array, o[1] as Float32Array, 0.5); }
      else for (let c = 0; c < Math.min(ch, o.length); c++) addTo(out[c] as Float32Array, o[c] as Float32Array, 1);
    }
    return out;
  }
}

function addTo(dst: Float32Array, src: Float32Array, k: number): void {
  for (let i = 0; i < Q; i++) dst[i] = (dst[i] as number) + (src[i] as number) * k;
}

// ——————————————————— 节点 ———————————————————
export class MiniGain extends MiniNode {
  readonly gain: MiniParam;
  constructor(ctx: MiniContext) { super(ctx); this.gain = new MiniParam(ctx, 1); }
  protected process(q: number): Float32Array[] | null {
    const g = this.gain.compute(q);
    const inp = this.mixInputs(q);
    if (!inp) return null;
    if (g.constant && g.buf[0] === 0) return null;
    const out = this.out(inp.length);
    for (let c = 0; c < inp.length; c++) {
      const x = inp[c] as Float32Array, y = out[c] as Float32Array, gb = g.buf;
      for (let i = 0; i < Q; i++) y[i] = (x[i] as number) * (gb[i] as number);
    }
    return out;
  }
}

export class MiniBiquad extends MiniNode {
  type: BiquadType = 'lowpass';
  readonly frequency: MiniParam;
  readonly Q: MiniParam;
  readonly gain: MiniParam;
  readonly detune: MiniParam;
  private z: Float64Array[] = [];
  constructor(ctx: MiniContext) {
    super(ctx);
    this.frequency = new MiniParam(ctx, 350); this.Q = new MiniParam(ctx, 1); this.gain = new MiniParam(ctx, 0); this.detune = new MiniParam(ctx, 0);
  }
  protected process(q: number): Float32Array[] | null {
    const f = this.frequency.compute(q), qq = this.Q.compute(q), g = this.gain.compute(q), d = this.detune.compute(q);
    const inp = this.mixInputs(q);
    if (!inp) {
      let live = false;
      for (const z of this.z) if (Math.abs(z[0] as number) > 1e-10 || Math.abs(z[1] as number) > 1e-10) live = true;
      if (!live) { for (const z of this.z) z.fill(0); return null; }
    }
    const ch = inp ? inp.length : this.z.length;
    while (this.z.length < ch) this.z.push(new Float64Array(2));
    const out = this.out(ch);
    const sr = this.context.sampleRate;
    const constant = f.constant && qq.constant && g.constant && d.constant;
    let co = biquadCoefs(this.type, (f.buf[0] as number) * Math.pow(2, (d.buf[0] as number) / 1200), qq.buf[0] as number, g.buf[0] as number, sr);
    for (let c = 0; c < ch; c++) {
      const x = inp ? (inp[c] as Float32Array) : null;
      const y = out[c] as Float32Array;
      const z = this.z[c] as Float64Array;
      let z1 = z[0] as number, z2 = z[1] as number;
      for (let i = 0; i < Q; i++) {
        if (!constant && (i & 3) === 0) co = biquadCoefs(this.type, (f.buf[i] as number) * Math.pow(2, (d.buf[i] as number) / 1200), qq.buf[i] as number, g.buf[i] as number, sr);
        const v = x ? (x[i] as number) : 0;
        const o = co.b0 * v + z1;
        z1 = co.b1 * v - co.a1 * o + z2;
        z2 = co.b2 * v - co.a2 * o;
        y[i] = o;
      }
      z[0] = Math.abs(z1) < 1e-30 ? 0 : z1; z[1] = Math.abs(z2) < 1e-30 ? 0 : z2;
    }
    return out;
  }
}

abstract class MiniSource extends MiniNode {
  override readonly numberOfInputs: number = 0;
  startTime = Infinity;
  stopTime = Infinity;
  onended: (() => void) | null = null;
  ended = false;
  private started = false;
  constructor(ctx: MiniContext) { super(ctx); ctx.sources.push(this); }
  start(when = 0, ..._rest: number[]): void {
    if (this.started) throw new Error('InvalidStateError: start called twice');
    this.started = true;
    this.startTime = Math.max(0, when);
  }
  stop(when = 0): void {
    if (!this.started) throw new Error('InvalidStateError: stop before start');
    this.stopTime = Math.max(0, when);
  }
  protected active(q: number): boolean {
    const sr = this.context.sampleRate;
    const t0 = (q * Q) / sr, t1 = ((q + 1) * Q) / sr;
    return !this.ended && this.startTime < t1 && this.stopTime > t0 && this.stopTime > this.startTime;
  }
  get oneShot(): boolean { return false; }
}

export class MiniBufferSource extends MiniSource {
  buffer: MiniAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: MiniParam;
  readonly detune: MiniParam;
  private offset = 0;
  private duration = Infinity;
  private pos = -1;
  constructor(ctx: MiniContext) {
    super(ctx);
    this.playbackRate = new MiniParam(ctx, 1, 'k-rate'); this.detune = new MiniParam(ctx, 0, 'k-rate');
  }
  override start(when = 0, offset = 0, duration = Infinity): void {
    super.start(when);
    this.offset = offset;
    this.duration = duration;
    if (Number.isFinite(duration)) this.stopTime = Math.min(this.stopTime, this.startTime + duration);
  }
  override get oneShot(): boolean { return !this.loop; }
  protected process(q: number): Float32Array[] | null {
    const b = this.buffer;
    if (!b || !this.active(q)) return null;
    const sr = this.context.sampleRate;
    const rate = (this.playbackRate.compute(q).buf[0] as number) * Math.pow(2, (this.detune.compute(q).buf[0] as number) / 1200);
    const step = (rate * b.sampleRate) / sr;
    const out = this.out(b.numberOfChannels);
    for (const o of out) o.fill(0);
    const len = b.length;
    const ls = this.loop ? Math.max(0, Math.floor(this.loopStart * b.sampleRate)) : 0;
    const le = this.loop ? (this.loopEnd > 0 ? Math.min(len, Math.floor(this.loopEnd * b.sampleRate)) : len) : len;
    let any = false;
    for (let i = 0; i < Q; i++) {
      const f = q * Q + i;
      const t = f / sr;
      if (t < this.startTime || t >= this.stopTime) continue;
      if (this.pos < 0) this.pos = this.offset * b.sampleRate + (t - this.startTime) * sr * step;
      let p = this.pos;
      if (this.loop && le > ls) { while (p >= le) p -= le - ls; }
      else if (p >= len) { this.ended = true; break; }
      const i0 = Math.floor(p), fr = p - i0;
      let i1 = i0 + 1;
      if (this.loop && i1 >= le) i1 = ls;
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        const v0 = d[i0] ?? 0, v1 = i1 < len ? (d[i1] ?? 0) : 0;
        (out[c] as Float32Array)[i] = v0 + (v1 - v0) * fr;
      }
      any = true;
      this.pos = p + step;
    }
    if (any) this.context.markActive(q, this);
    return any ? out : null;
  }
}

export class MiniOscillator extends MiniSource {
  type: OscillatorType = 'sine';
  readonly frequency: MiniParam;
  readonly detune: MiniParam;
  private phase = -1;
  constructor(ctx: MiniContext) { super(ctx); this.frequency = new MiniParam(ctx, 440); this.detune = new MiniParam(ctx, 0); }
  protected process(q: number): Float32Array[] | null {
    if (!this.active(q)) return null;
    const sr = this.context.sampleRate;
    const f = this.frequency.compute(q), d = this.detune.compute(q);
    const out = this.out(1);
    const y = out[0] as Float32Array;
    y.fill(0);
    for (let i = 0; i < Q; i++) {
      const t = (q * Q + i) / sr;
      if (t < this.startTime || t >= this.stopTime) continue;
      const hz = (f.buf[i] as number) * Math.pow(2, (d.buf[i] as number) / 1200);
      const dt = hz / sr;
      if (this.phase < 0) this.phase = ((t - this.startTime) * hz) % 1;
      const p = this.phase;
      let v: number;
      switch (this.type) {
        case 'square': v = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt); break;
        case 'sawtooth': { const s = (p + 0.5) % 1; v = 2 * s - 1 - blep(s, dt); break; }
        case 'triangle': v = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; break;
        default: v = Math.sin(2 * Math.PI * p);
      }
      y[i] = v;
      this.phase = (p + dt) % 1;
      if (this.phase < 0) this.phase += 1;
    }
    return out;
  }
}
function blep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

export class MiniConstantSource extends MiniSource {
  readonly offset: MiniParam;
  constructor(ctx: MiniContext) { super(ctx); this.offset = new MiniParam(ctx, 1); }
  protected process(q: number): Float32Array[] | null {
    if (!this.active(q)) return null;
    const o = this.offset.compute(q);
    const out = this.out(1);
    const y = out[0] as Float32Array;
    const sr = this.context.sampleRate;
    for (let i = 0; i < Q; i++) { const t = (q * Q + i) / sr; y[i] = t >= this.startTime && t < this.stopTime ? (o.buf[i] as number) : 0; }
    return out;
  }
}

export class MiniPanner extends MiniNode {
  readonly pan: MiniParam;
  constructor(ctx: MiniContext) { super(ctx); this.pan = new MiniParam(ctx, 0); this.channelCountMode = 'clamped-max'; }
  protected process(q: number): Float32Array[] | null {
    const p = this.pan.compute(q);
    const inp = this.mixInputs(q);
    if (!inp) return null;
    const out = this.out(2);
    const L = out[0] as Float32Array, R = out[1] as Float32Array;
    for (let i = 0; i < Q; i++) {
      const pan = Math.max(-1, Math.min(1, p.buf[i] as number));
      if (inp.length === 1) {
        const x = (pan + 1) / 2, v = (inp[0] as Float32Array)[i] as number;
        L[i] = v * Math.cos((x * Math.PI) / 2); R[i] = v * Math.sin((x * Math.PI) / 2);
      } else {
        const l = (inp[0] as Float32Array)[i] as number, r = (inp[1] as Float32Array)[i] as number;
        if (pan <= 0) { const x = pan + 1; L[i] = l + r * Math.cos((x * Math.PI) / 2); R[i] = r * Math.sin((x * Math.PI) / 2); }
        else { const x = pan; L[i] = l * Math.cos((x * Math.PI) / 2); R[i] = r + l * Math.sin((x * Math.PI) / 2); }
      }
    }
    return out;
  }
}

// ——— FFT（基 2，N = 256）———
const N = 256;
const REV = new Uint16Array(N);
const COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b); REV[i] = r; }
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = -Math.sin((2 * Math.PI * i) / N); }
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  for (let i = 0; i < N; i++) { const j = REV[i] as number; if (j > i) { const tr = re[i] as number; re[i] = re[j] as number; re[j] = tr; const ti = im[i] as number; im[i] = im[j] as number; im[j] = ti; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step] as number, wi = (inverse ? -1 : 1) * (SIN[k * step] as number);
        const a = s + k, b = a + half;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi, xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr; im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr; im[a] = (im[a] as number) + xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < N; i++) { re[i] = (re[i] as number) / N; im[i] = (im[i] as number) / N; }
}

export class MiniConvolver extends MiniNode {
  normalize = true;
  private ir: MiniAudioBuffer | null = null;
  private H: Array<Array<{ re: Float64Array; im: Float64Array }>> = [];   // [irCh][partition]
  private X: Array<Array<{ re: Float64Array; im: Float64Array }>> = [];   // [outCh][ring]
  private prev: Float64Array[] = [];
  private ringPos = 0;
  private quietBlocks = 1e9;
  private lastOutCh = 1;
  constructor(ctx: MiniContext) { super(ctx); this.channelCountMode = 'clamped-max'; }
  get buffer(): MiniAudioBuffer | null { return this.ir; }
  set buffer(b: MiniAudioBuffer | null) {
    this.ir = b;
    this.H = [];
    if (!b) return;
    let scale = 1;
    if (this.normalize) {
      let e = 0;
      for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) e += v * v;
      scale = e > 0 ? 1 / Math.sqrt(e / b.numberOfChannels) : 1;
    }
    const P = Math.ceil(b.length / Q);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      const parts: Array<{ re: Float64Array; im: Float64Array }> = [];
      for (let p = 0; p < P; p++) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < Q; i++) re[i] = (d[p * Q + i] ?? 0) * scale;
        fft(re, im, false);
        parts.push({ re, im });
      }
      this.H.push(parts);
    }
    this.X = []; this.prev = []; this.ringPos = 0; this.quietBlocks = 1e9;
  }
  protected process(q: number): Float32Array[] | null {
    const inp = this.mixInputs(q);
    if (!this.ir || !this.H.length) return null;
    const P = (this.H[0] as unknown[]).length;
    if (!inp) { this.quietBlocks++; if (this.quietBlocks > P + 1) return null; } else this.quietBlocks = 0;
    const irCh = this.H.length;
    const outCh = inp ? (irCh === 2 || inp.length === 2 ? 2 : 1) : this.lastOutCh;
    this.lastOutCh = outCh;
    while (this.X.length < outCh) this.X.push(Array.from({ length: P }, () => ({ re: new Float64Array(N), im: new Float64Array(N) })));
    while (this.prev.length < outCh) this.prev.push(new Float64Array(Q));
    const out = this.out(outCh);
    this.ringPos = (this.ringPos + 1) % P;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let c = 0; c < outCh; c++) {
      const x = inp ? (inp[Math.min(c, inp.length - 1)] as Float32Array) : null;
      const prev = this.prev[c] as Float64Array;
      const slot = (this.X[c] as Array<{ re: Float64Array; im: Float64Array }>)[this.ringPos] as { re: Float64Array; im: Float64Array };
      for (let i = 0; i < Q; i++) { slot.re[i] = prev[i] as number; slot.re[Q + i] = x ? (x[i] as number) : 0; }
      slot.im.fill(0);
      fft(slot.re, slot.im, false);
      for (let i = 0; i < Q; i++) prev[i] = x ? (x[i] as number) : 0;
      re.fill(0); im.fill(0);
      const H = this.H[Math.min(c, irCh - 1)] as Array<{ re: Float64Array; im: Float64Array }>;
      const ring = this.X[c] as Array<{ re: Float64Array; im: Float64Array }>;
      for (let p = 0; p < P; p++) {
        const Xp = ring[(this.ringPos - p + P) % P] as { re: Float64Array; im: Float64Array };
        const Hp = H[p] as { re: Float64Array; im: Float64Array };
        for (let k = 0; k < N; k++) {
          const ar = Xp.re[k] as number, ai = Xp.im[k] as number, br = Hp.re[k] as number, bi = Hp.im[k] as number;
          re[k] = (re[k] as number) + ar * br - ai * bi;
          im[k] = (im[k] as number) + ar * bi + ai * br;
        }
      }
      fft(re, im, true);
      const y = out[c] as Float32Array;
      for (let i = 0; i < Q; i++) y[i] = re[Q + i] as number;
    }
    return out;
  }
}

export class MiniCompressor extends MiniNode {
  readonly threshold: MiniParam;
  readonly knee: MiniParam;
  readonly ratio: MiniParam;
  readonly attack: MiniParam;
  readonly release: MiniParam;
  reduction = 0;
  private g = 0;   // 当前增益（dB，≤ 0）
  constructor(ctx: MiniContext) {
    super(ctx);
    this.threshold = new MiniParam(ctx, -24, 'k-rate'); this.knee = new MiniParam(ctx, 30, 'k-rate'); this.ratio = new MiniParam(ctx, 12, 'k-rate');
    this.attack = new MiniParam(ctx, 0.003, 'k-rate'); this.release = new MiniParam(ctx, 0.25, 'k-rate');
    this.channelCountMode = 'clamped-max';
  }
  protected process(q: number): Float32Array[] | null {
    const T = this.threshold.compute(q).buf[0] as number, W = this.knee.compute(q).buf[0] as number, R = this.ratio.compute(q).buf[0] as number;
    const A = this.attack.compute(q).buf[0] as number, Rl = this.release.compute(q).buf[0] as number;
    const inp = this.mixInputs(q);
    if (!inp && this.g > -0.01) { this.g = 0; this.reduction = 0; return null; }
    const ch = inp ? inp.length : 1;
    const out = this.out(ch);
    const sr = this.context.sampleRate;
    const ka = 1 - Math.exp(-1 / (Math.max(1e-4, A) * sr)), kr = 1 - Math.exp(-1 / (Math.max(1e-4, Rl) * sr));
    let minG = 0;
    for (let i = 0; i < Q; i++) {
      let lv = 0;
      if (inp) for (let c = 0; c < ch; c++) lv = Math.max(lv, Math.abs((inp[c] as Float32Array)[i] as number));
      const x = lv > 1e-9 ? 20 * Math.log10(lv) : -180;
      let y: number;
      if (2 * (x - T) < -W) y = x;
      else if (W > 0 && Math.abs(2 * (x - T)) <= W) y = x + ((1 / R - 1) * Math.pow(x - T + W / 2, 2)) / (2 * W);
      else y = T + (x - T) / R;
      const target = Math.min(0, y - x);
      this.g += (target - this.g) * (target < this.g ? ka : kr);
      const gl = Math.pow(10, this.g / 20);
      for (let c = 0; c < ch; c++) (out[c] as Float32Array)[i] = inp ? ((inp[c] as Float32Array)[i] as number) * gl : 0;
      if (this.g < minG) minG = this.g;
    }
    this.reduction = minG;
    return out;
  }
}

/** WaveShaper（oversample 'none'）：规范的曲线查表——输入截在 [−1, 1]，v = (N − 1)(x + 1) / 2，相邻两点线性插值。 */
export class MiniWaveShaper extends MiniNode {
  curve: Float32Array | null = null;
  oversample: 'none' | '2x' | '4x' = 'none';
  protected process(q: number): Float32Array[] | null {
    const inp = this.mixInputs(q);
    if (!inp) return null;
    const c = this.curve;
    const out = this.out(inp.length);
    for (let ch = 0; ch < inp.length; ch++) {
      const x = inp[ch] as Float32Array, y = out[ch] as Float32Array;
      if (!c || c.length < 2) { y.set(x); continue; }
      const N = c.length;
      for (let i = 0; i < Q; i++) {
        const xi = Math.max(-1, Math.min(1, x[i] as number));
        const v = ((N - 1) * (xi + 1)) / 2;
        const k = Math.min(N - 2, Math.floor(v)), f = v - k;
        y[i] = (1 - f) * (c[k] as number) + f * (c[k + 1] as number);
      }
    }
    return out;
  }
}

export class MiniDestination extends MiniNode {
  readonly maxChannelCount: number;
  constructor(ctx: MiniContext, ch: number) { super(ctx); this.channelCount = ch; this.channelCountMode = 'explicit'; this.maxChannelCount = ch; }
  protected process(q: number): Float32Array[] | null { return this.mixInputs(q); }
}

// ——————————————————— Context ———————————————————
export class MiniContext {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly destination: MiniDestination;
  readonly sources: MiniSource[] = [];
  oncomplete: ((e: { renderedBuffer: MiniAudioBuffer }) => void) | null = null;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  /** 每个渲染量子里正在出声的一次性 BufferSource 数的最大值（声部上限测试用）。 */
  maxOneShots = 0;
  private frame = 0;
  private activeQ = -1;
  private activeN = 0;
  private rendered = false;
  /** 仅统计：创建过的节点数。 */
  nodesCreated = 0;

  constructor(a: number | { numberOfChannels?: number; length: number; sampleRate: number }, b?: number, c?: number) {
    if (typeof a === 'number') { this.numberOfChannels = a; this.length = b as number; this.sampleRate = c as number; }
    else { this.numberOfChannels = a.numberOfChannels ?? 1; this.length = a.length; this.sampleRate = a.sampleRate; }
    this.destination = new MiniDestination(this, this.numberOfChannels);
  }
  get currentTime(): number { return this.frame / this.sampleRate; }

  markActive(q: number, s: MiniSource): void {
    if (!s.oneShot) return;
    if (q !== this.activeQ) { this.activeQ = q; this.activeN = 0; }
    this.activeN++;
    if (this.activeN > this.maxOneShots) this.maxOneShots = this.activeN;
  }

  private n<T>(x: T): T { this.nodesCreated++; return x; }
  createGain(): MiniGain { return this.n(new MiniGain(this)); }
  createBiquadFilter(): MiniBiquad { return this.n(new MiniBiquad(this)); }
  createOscillator(): MiniOscillator { return this.n(new MiniOscillator(this)); }
  createBufferSource(): MiniBufferSource { return this.n(new MiniBufferSource(this)); }
  createConstantSource(): MiniConstantSource { return this.n(new MiniConstantSource(this)); }
  createStereoPanner(): MiniPanner { return this.n(new MiniPanner(this)); }
  createConvolver(): MiniConvolver { return this.n(new MiniConvolver(this)); }
  createDynamicsCompressor(): MiniCompressor { return this.n(new MiniCompressor(this)); }
  createWaveShaper(): MiniWaveShaper { return this.n(new MiniWaveShaper(this)); }
  createBuffer(ch: number, len: number, sr: number): MiniAudioBuffer { return new MiniAudioBuffer({ numberOfChannels: ch, length: len, sampleRate: sr }); }
  resume(): Promise<void> { return Promise.resolve(); }
  suspend(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }

  startRendering(): Promise<MiniAudioBuffer> {
    if (this.rendered) return Promise.reject(new Error('InvalidStateError: already rendered'));
    this.rendered = true;
    this.state = 'running';
    const out = new MiniAudioBuffer({ numberOfChannels: this.numberOfChannels, length: this.length, sampleRate: this.sampleRate });
    const blocks = Math.ceil(this.length / Q);
    for (let q = 0; q < blocks; q++) {
      this.frame = q * Q;
      const o = this.destination.pull(q);
      if (!o) continue;
      const n = Math.min(Q, this.length - q * Q);
      for (let c = 0; c < this.numberOfChannels; c++) out.getChannelData(c).set((o[c] as Float32Array).subarray(0, n), q * Q);
    }
    this.frame = this.length;
    this.state = 'closed';
    for (const s of this.sources) if (s.onended && s.startTime < Infinity) s.onended();
    this.oncomplete?.({ renderedBuffer: out });
    return Promise.resolve(out);
  }
}

/** 给 src/audio 用的工厂（类型转换成 DOM 类型）。 */
export function makeMiniOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  return new MiniContext(channels, length, sampleRate) as unknown as OfflineAudioContext;
}
