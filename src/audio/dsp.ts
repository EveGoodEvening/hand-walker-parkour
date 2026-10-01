// src/audio/dsp.ts —— 纯函数 DSP 工具（DESIGN.md §6）。WP7。
// 不依赖 WebAudio：噪声生成、双二阶滤波系数（与 Web Audio 规范的公式逐项一致）、脉冲响应生成、峰值 / RMS / 起音分析。
// 运行时用它生成噪声缓冲与混响脉冲响应；单元测试里的离线渲染器（tests/unit/audio/offline）也复用这里的滤波系数。

/** 以 ArrayBuffer 为底的 Float32Array（AudioBuffer.copyToChannel 要求的类型）。 */
export type F32 = Float32Array<ArrayBuffer>;

/** dB → 线性增益。 */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
/** 线性增益 → dB（0 → −Infinity）。 */
export const gainToDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/**
 * Web Audio 的 lowpass / highpass 把 Q 当作 dB 解释（规范 BiquadFilterNode 一节的 alpha_QdB），
 * 而配方表里写的 Q 是线性值（「低通 520 Hz（Q 0.7）」）。用这个函数换算后再赋给 lowpass / highpass 的 Q。
 * bandpass / peaking / notch 的 Q 是线性的，不需要换算。
 */
export const qDb = (qLinear: number): number => 20 * Math.log10(qLinear);

/** mulberry32：给声音用的小型确定性随机数（与模拟的 rng 无关，不影响确定性）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把缓冲的 RMS 调到 rms（原地）。 */
export function normalizeRms(x: F32, rms: number): F32 {
  let s = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i] as number; s += v * v; }
  const cur = Math.sqrt(s / Math.max(1, x.length));
  if (cur > 0) { const k = rms / cur; for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) * k; }
  return x;
}

/** 首尾交叉淡变，使缓冲可以无缝循环（原地；fade 为样本数）。 */
export function makeLoopable(x: F32, fade: number): F32 {
  const n = x.length;
  const f = Math.min(fade, Math.floor(n / 4));
  for (let i = 0; i < f; i++) {
    const w = i / f;
    const tail = x[n - f + i] as number;
    x[i] = (x[i] as number) * w + tail * (1 - w);
  }
  return x.subarray(0, n - f).slice();
}

/** 白噪声，RMS 0.5（均匀分布）。 */
export function whiteNoise(n: number, rng: () => number): F32 {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1;
  return normalizeRms(x, 0.5);
}

/** 粉噪（Paul Kellet 的精简滤波），RMS 0.5。 */
export function pinkNoise(n: number, rng: () => number): F32 {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return normalizeRms(removeDc(x), 0.5);
}

/** 棕噪（泄漏积分），RMS 0.5。 */
export function brownNoise(n: number, rng: () => number): F32 {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.997 * y + (rng() * 2 - 1) * 0.06;
    x[i] = y;
  }
  return normalizeRms(removeDc(x), 0.5);
}

function removeDc(x: F32): F32 {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i] as number;
  m /= Math.max(1, x.length);
  for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) - m;
  return x;
}

// ——————————————————— 双二阶滤波（Web Audio 规范公式）———————————————————
export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass';
export interface BiquadCoefs { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * 与 Web Audio 规范「BiquadFilterNode · Filters characteristics」一致的系数（已按 a0 归一）。
 * lowpass / highpass 的 Q 以 dB 计；其余类型的 Q 是线性值；shelf 不用 Q。
 */
export function biquadCoefs(type: BiquadType, freq: number, Q: number, gainDb: number, sampleRate: number): BiquadCoefs {
  const nyq = sampleRate / 2;
  const f0 = Math.min(Math.max(freq, 0), nyq);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alphaQ = sw / (2 * Math.max(Q, 1e-4));
  const alphaQdB = sw / (2 * Math.pow(10, Q / 20));
  const alphaS = (sw / 2) * Math.sqrt(2);          // S = 1
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alphaQdB; a1 = -2 * cw; a2 = 1 - alphaQdB; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alphaQdB; a1 = -2 * cw; a2 = 1 - alphaQdB; break;
    case 'bandpass': b0 = alphaQ; b1 = 0; b2 = -alphaQ; a0 = 1 + alphaQ; a1 = -2 * cw; a2 = 1 - alphaQ; break;
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alphaQ; a1 = -2 * cw; a2 = 1 - alphaQ; break;
    case 'allpass': b0 = 1 - alphaQ; b1 = -2 * cw; b2 = 1 + alphaQ; a0 = 1 + alphaQ; a1 = -2 * cw; a2 = 1 - alphaQ; break;
    case 'peaking': b0 = 1 + alphaQ * A; b1 = -2 * cw; b2 = 1 - alphaQ * A; a0 = 1 + alphaQ / A; a1 = -2 * cw; a2 = 1 - alphaQ / A; break;
    case 'lowshelf': {
      const sA = 2 * Math.sqrt(A) * alphaS;
      b0 = A * ((A + 1) - (A - 1) * cw + sA); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sA);
      a0 = (A + 1) + (A - 1) * cw + sA; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sA;
      break;
    }
    case 'highshelf': {
      const sA = 2 * Math.sqrt(A) * alphaS;
      b0 = A * ((A + 1) + (A - 1) * cw + sA); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sA);
      a0 = (A + 1) - (A - 1) * cw + sA; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sA;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 频率 f 处的幅度响应（线性）。 */
export function biquadMagnitude(c: BiquadCoefs, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cr + c.b2 * c2r, ni = c.b1 * ci + c.b2 * c2i;
  const dr = 1 + c.a1 * cr + c.a2 * c2r, di = c.a1 * ci + c.a2 * c2i;
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** 把一段信号过一个双二阶（直接 II 型转置），返回新数组。 */
export function biquadRun(x: Float32Array, c: BiquadCoefs): F32 {
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number;
    const o = c.b0 * v + z1;
    z1 = c.b1 * v - c.a1 * o + z2;
    z2 = c.b2 * v - c.a2 * o;
    y[i] = o;
  }
  return y;
}

// ——————————————————— 混响脉冲响应 ———————————————————
/**
 * 程序生成的立体声脉冲响应（§6.1「脉冲响应程序生成」）：去相关的噪声 × 指数衰减（RT60），
 * 高频比低频衰减得快（一阶低通的截止频率随时间下降），前面加一小段预延迟。能量归一为 1。
 */
export function impulseResponse(rt60: number, sampleRate: number, seed: number): [F32, F32] {
  const rng = mulberry32(seed);
  const len = Math.max(64, Math.floor(Math.min(4.6, rt60 * 1.15 + 0.03) * sampleRate));
  const pre = Math.floor(Math.min(0.02, 0.004 + rt60 * 0.006) * sampleRate);
  const out: [F32, F32] = [new Float32Array(len), new Float32Array(len)];
  const k = 6.907755 / rt60;                        // ln(1000)：RT60 处 −60 dB
  for (let ch = 0; ch < 2; ch++) {
    const x = out[ch] as F32;
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const fc = 9000 * Math.exp(-t * 1.6 / rt60) + 1800;   // 越往后越暗
      const a = Math.exp((-2 * Math.PI * fc) / sampleRate);
      const n = rng() * 2 - 1;
      lp = (1 - a) * n + a * lp;
      // 早期几毫秒稀疏一些（像离散反射），之后是稠密的尾巴
      const sparse = t < 0.012 ? (rng() < 0.12 ? 3 : 0.2) : 1;
      x[i] = lp * Math.exp(-k * t) * sparse;
    }
  }
  let e = 0;
  for (const x of out) for (let i = 0; i < x.length; i++) { const v = x[i] as number; e += v * v; }
  const g = e > 0 ? 1 / Math.sqrt(e / 2) : 0;
  for (const x of out) for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) * g;
  return out;
}

// ——————————————————— 分析 ———————————————————
/** 多声道的绝对峰值。 */
export function peakAbs(chs: readonly Float32Array[], from = 0, to = Infinity): number {
  let p = 0;
  for (const x of chs) {
    const e = Math.min(x.length, to);
    for (let i = Math.max(0, from); i < e; i++) { const v = Math.abs(x[i] as number); if (v > p) p = v; }
  }
  return p;
}

/** 区间 RMS（多声道取均值）。 */
export function rmsOf(chs: readonly Float32Array[], from = 0, to = Infinity): number {
  let s = 0, n = 0;
  for (const x of chs) {
    const e = Math.min(x.length, to);
    for (let i = Math.max(0, from); i < e; i++) { const v = x[i] as number; s += v * v; n++; }
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** 是否含有 NaN / Infinity。 */
export function hasNonFinite(chs: readonly Float32Array[]): boolean {
  for (const x of chs) for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i] as number)) return true;
  return false;
}

/** 最后一个绝对值 ≥ thr 的样本下标（没有则 −1）。 */
export function lastAbove(chs: readonly Float32Array[], thr: number, from = 0, to = Infinity): number {
  let last = -1;
  for (const x of chs) {
    const e = Math.min(x.length, to);
    for (let i = e - 1; i >= from; i--) if (Math.abs(x[i] as number) >= thr) { if (i > last) last = i; break; }
  }
  return last;
}

/** 第一个绝对值 ≥ thr 的样本下标（没有则 −1）。 */
export function firstAbove(chs: readonly Float32Array[], thr: number, from = 0, to = Infinity): number {
  let first = -1;
  for (const x of chs) {
    const e = Math.min(x.length, to);
    for (let i = Math.max(0, from); i < e; i++) if (Math.abs(x[i] as number) >= thr) { if (first < 0 || i < first) first = i; break; }
  }
  return first;
}

/** 滑动 RMS 包络（窗长 win 秒，步长 hop 秒）；返回 { env, hop }。 */
export function rmsEnvelope(chs: readonly Float32Array[], sampleRate: number, win = 0.01, hop = 0.002): { env: Float32Array; hop: number } {
  const n = chs[0]?.length ?? 0;
  const w = Math.max(1, Math.round(win * sampleRate));
  const h = Math.max(1, Math.round(hop * sampleRate));
  const frames = Math.max(0, Math.floor((n - w) / h) + 1);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = rmsOf(chs, f * h, f * h + w);
  return { env, hop: h / sampleRate };
}

/**
 * 起音时间（秒）：RMS 包络（缺省 20 ms 窗）从峰值的 1% 升到 90% 所用的时间。
 * 异常类声音要求 ≥ 150 ms（§6.1、§8.10 WP7 验收 2）。窄带噪声（低语的共振峰带通 Q 4–5）在 10 ms 窗里起伏很大，
 * 包络的最大值会落在一次随机起伏上，所以窗取 20 ms；对瞬态声音（咔、笃）量出来仍只有十几毫秒。
 */
export function attackTime(chs: readonly Float32Array[], sampleRate: number, win = 0.02): number {
  const { env, hop } = rmsEnvelope(chs, sampleRate, win, 0.001);
  let max = 0;
  for (let i = 0; i < env.length; i++) if ((env[i] as number) > max) max = env[i] as number;
  if (max <= 0) return 0;
  let i0 = -1, i1 = -1;
  for (let i = 0; i < env.length; i++) {
    const v = env[i] as number;
    if (i0 < 0 && v >= max * 0.01) i0 = i;
    if (v >= max * 0.9) { i1 = i; break; }
  }
  return i0 < 0 || i1 < 0 ? 0 : (i1 - i0) * hop;
}
