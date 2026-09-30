// src/audio/graph.ts —— 搭建 WebAudio 节点的小工具（DESIGN.md §6）。WP7。
// 只用原生节点（BufferSource、Oscillator、BiquadFilter、Gain、StereoPanner、Convolver、DynamicsCompressor），
// 不用 ScriptProcessor / AudioWorklet（§8.10 WP7 验收 7）。所有配方既能在实时 AudioContext 上搭，也能在 OfflineAudioContext 上搭。
import { brownNoise, makeLoopable, mulberry32, pinkNoise, qDb, whiteNoise, type BiquadType } from './dsp';

export type NoiseKind = 'white' | 'pink' | 'brown';

/** 每个 context 一份噪声缓冲（循环播放，随机起点，所以每次听起来都不一样）。 */
export class NoiseBank {
  private cache = new Map<NoiseKind, AudioBuffer>();
  constructor(private readonly ctx: BaseAudioContext, private readonly seed = 7) {}
  get(kind: NoiseKind): AudioBuffer {
    const hit = this.cache.get(kind);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const secs = kind === 'white' ? 2 : 4;
    const rng = mulberry32(this.seed + (kind === 'white' ? 1 : kind === 'pink' ? 2 : 3));
    const raw = kind === 'white' ? whiteNoise(Math.floor(secs * sr) + 256, rng)
      : kind === 'pink' ? pinkNoise(Math.floor(secs * sr) + 256, rng) : brownNoise(Math.floor(secs * sr) + 256, rng);
    const data = makeLoopable(raw, 256);
    const buf = this.ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    this.cache.set(kind, buf);
    return buf;
  }
}

/** 一个随机起点的循环噪声源，t0 开始，dur 秒后停（dur = Infinity 表示不停）。 */
export function noise(ctx: BaseAudioContext, bank: NoiseBank, kind: NoiseKind, t0: number, dur: number, rng: () => number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  const b = bank.get(kind);
  s.buffer = b;
  s.loop = true;
  s.start(t0, rng() * b.duration * 0.9);
  if (Number.isFinite(dur)) s.stop(t0 + dur);
  return s;
}

/** 双二阶滤波器。q 对 lowpass / highpass 是线性 Q（内部换成 dB），其余类型原样。 */
export function filt(ctx: BaseAudioContext, type: BiquadType, freq: number, q = 0.7071, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = type === 'lowpass' || type === 'highpass' ? qDb(q) : q;
  f.gain.value = gainDb;
  return f;
}

export function gain(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t0: number, t1: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(t0);
  if (Number.isFinite(t1)) o.stop(t1);
  return o;
}

/** 依次连接，返回最后一个节点。 */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i + 1 < nodes.length; i++) (nodes[i] as AudioNode).connect(nodes[i + 1] as AudioNode);
  return nodes[nodes.length - 1] as AudioNode;
}

/** 打击包络：t0 起线性起音 attack 秒到 peak，然后按时间常数 tau 指数衰减。 */
export function perc(p: AudioParam, t0: number, peak: number, attack: number, tau: number): void {
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + Math.max(attack, 1e-4));
  p.setTargetAtTime(0, t0 + Math.max(attack, 1e-4), tau);
}

/** 起音 / 保持 / 释放：线性起音到 peak，保持 hold 秒，线性释放。 */
export function ahr(p: AudioParam, t0: number, peak: number, attack: number, hold: number, release: number): void {
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.setValueAtTime(peak, t0 + attack + hold);
  p.linearRampToValueAtTime(0, t0 + attack + hold + release);
}

/** 等功率的正弦 / 余弦淡变曲线（混响交叉淡变用）。 */
export function fadeCurve(up: boolean, n = 32): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    c[i] = up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
  }
  return c;
}

/** 参数平滑地走向 v（用 setTargetAtTime：不管之前停在哪里都是连续的）。 */
export function glide(p: AudioParam, v: number, at: number, tau: number): void {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(v, at, Math.max(1e-4, tau));
}
