// src/audio/recipes/sfx.ts —— 一次性音效、铃、脚步与环境颗粒（DESIGN.md §6.2）。WP7。
// 全部在解锁音频时预渲染，峰值归一到表里的 dBFS。异常类声音（嘘、玻璃触碰、风、心跳，外加低语）起音 ≥ 150 ms，
// 且只做减法：没有 stinger，没有「咚」（附录 A-1、A-2）。
import type { BellKind, SfxId } from '../../core/types';
import { ahr, chain, filt, gain, noise, osc, perc } from '../graph';
import { jit, nb, rr, type BusId, type OneShot, type RecipeCtx } from './common';

/** 除 SfxId 之外 WP7 自己用的一次性声音。 */
export type ExtraSfx = 'scrape' | 'crashThud' | 'click' | 'whisper' | 'stepPair' | 'stepSelf' | 'uiMove'
  | 'bellMorning' | 'bellLunch' | 'bellClass';
/** 环境颗粒（经声部池以低优先级播放）。 */
export type GrainId = 'rainDrop' | 'tinImpact' | 'acDing' | 'clink' | 'trayScrape' | 'rosterPaper' | 'wiper';
export type OneShotId = SfxId | ExtraSfx | GrainId;

const S = (key: string, dur: number, peakDb: number, bus: BusId, build: (r: RecipeCtx) => void,
  o: Partial<Pick<OneShot, 'send' | 'tau' | 'variants' | 'anomaly' | 'channels'>> = {}): OneShot => ({
  key, dur, peakDb, bus, build, channels: o.channels ?? 1, send: o.send ?? 0, tau: o.tau ?? dur / 4, variants: o.variants ?? 1,
  ...(o.anomaly ? { anomaly: true } : {}),
});

/** 一条噪声支路：noise → 滤波… → 包络增益 → out；返回包络增益。 */
function nz(r: RecipeCtx, t: number, dur: number, filters: AudioNode[], out: AudioNode, kind: 'white' | 'pink' | 'brown' = 'white'): GainNode {
  const g = gain(r.ctx, 0);
  chain(noise(r.ctx, r.noise, kind, t, dur, r.rng), ...filters, g, out);
  return g;
}
/** 一条正弦（或别的波形）支路。 */
function tone(r: RecipeCtx, type: OscillatorType, f: number, t: number, dur: number, out: AudioNode): { o: OscillatorNode; g: GainNode } {
  const o = osc(r.ctx, type, f, t, t + dur);
  const g = gain(r.ctx, 0);
  chain(o, g, out);
  return { o, g };
}
/** 把 n 个点的曲线写进参数（值 = 曲线 × k）。 */
function curve(p: AudioParam, t: number, dur: number, pts: number[], k = 1): void {
  p.setValueAtTime(0, t);
  p.setValueCurveAtTime(Float32Array.from(pts, (v) => v * k), t, dur);
}
function bumps(n: number, count: number, rng: () => number, floor = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const b = Math.pow(Math.sin(x * Math.PI * count), 2) * (0.7 + 0.3 * rng());
    out.push(Math.max(floor, b * Math.sin(x * Math.PI)));
  }
  out[0] = 0; out[n - 1] = 0;
  return out;
}

// ——————————————————— 脚步「先轻后重」———————————————————
/** 正常人的一步：轻（带通 900 Hz，τ 8 ms，−28 dBFS）→ +gap 重（低通 300 Hz，τ 55 ms，加 72 Hz 正弦，−16 dBFS）。 */
function stepPair(r: RecipeCtx, t: number, out: AudioNode, amp: number, gap: number, heavyDb: number): void {
  const sr = r.ctx.sampleRate;
  const light = nz(r, t, 0.06, [filt(r.ctx, 'bandpass', 900 * jit(r.rng, 0.06), 1.2)], out);
  perc(light.gain, t, amp * Math.pow(10, (-28 - heavyDb) / 20) * nb((1.57 * 900) / 1.2, sr), 0.001, 0.008);
  const th = t + gap;
  const heavy = nz(r, th, 0.35, [filt(r.ctx, 'lowpass', 300 * jit(r.rng, 0.06), 0.7071)], out);
  perc(heavy.gain, th, amp * nb(330, sr), 0.003, 0.055);
  const s = tone(r, 'sine', 72 * jit(r.rng, 0.04), th, 0.4, out);
  perc(s.g.gain, th, amp * 0.6, 0.003, 0.06);
}

/** 高跟鞋的一步：带通 2.8 kHz（Q 6）τ 12 ms + 1.9 kHz 正弦 τ 25 ms；+8 ms 一记 150 Hz 闷响（低 3 dB）。 */
function heelStep(r: RecipeCtx, t: number, out: AudioNode, amp: number): void {
  const sr = r.ctx.sampleRate;
  const c = nz(r, t, 0.08, [filt(r.ctx, 'bandpass', 2800, 6)], out);
  perc(c.gain, t, amp * nb((1.57 * 2800) / 6, sr), 0.0005, 0.012);
  const s = tone(r, 'sine', 1900, t, 0.2, out);
  perc(s.g.gain, t, amp * 0.5, 0.0005, 0.025);
  const th = t + 0.008;
  const th1 = tone(r, 'sine', 150, th, 0.25, out);
  perc(th1.g.gain, th, amp * 0.7, 0.002, 0.03);
  const tn = nz(r, th, 0.15, [filt(r.ctx, 'lowpass', 300, 0.7071)], out);
  perc(tn.gain, th, amp * 0.5 * nb(330, sr), 0.002, 0.025);
}

// ——————————————————— 铃 ———————————————————
/** 早自习铃（「尖锐，像某种警告」）：方波 1040 + 1560 Hz，24 Hz 方波调幅，带通 1.8 kHz，低通 2.5 kHz，3.5 s。 */
function bellMorning(r: RecipeCtx, out: AudioNode, lp = 2500): void {
  const { ctx, t0 } = r;
  const dur = 3.5;
  const am = gain(ctx, 0.5);
  const lfo = osc(ctx, 'square', 24, t0, t0 + dur + 0.3);
  const depth = gain(ctx, 0.5);
  chain(lfo, depth);
  depth.connect(am.gain);
  for (const [f, a] of [[1040, 1], [1560, 0.7]] as const) {
    const o = osc(ctx, 'square', f, t0, t0 + dur + 0.3);
    const g = gain(ctx, a);
    chain(o, g, am);
  }
  const env = gain(ctx, 0);
  chain(am, filt(ctx, 'bandpass', 1800, 1.2), filt(ctx, 'lowpass', lp, 0.7071), env, out);
  ahr(env.gain, t0, 1, 0.08, dur - 0.08, 0.15);
}

/** 午饭铃（「像一把钝锯」）：锯齿 700 + 1050 Hz，16 Hz 调幅，音高漂移 ±8 音分，5 s。 */
function bellLunch(r: RecipeCtx, out: AudioNode): void {
  const { ctx, t0, rng } = r;
  const dur = 5;
  const am = gain(ctx, 0.6);
  const lfo = osc(ctx, 'sine', 16, t0, t0 + dur + 0.3);
  const depth = gain(ctx, 0.4);
  chain(lfo, depth);
  depth.connect(am.gain);
  const drift = Float32Array.from({ length: 24 }, () => (rng() * 2 - 1) * 8);
  for (const [f, a] of [[700, 1], [1050, 0.6]] as const) {
    const o = osc(ctx, 'sawtooth', f, t0, t0 + dur + 0.3);
    o.detune.setValueCurveAtTime(drift, t0, dur);
    const g = gain(ctx, a);
    chain(o, g, am);
  }
  const env = gain(ctx, 0);
  chain(am, filt(ctx, 'bandpass', 1500, 0.9), filt(ctx, 'lowpass', 3000, 0.7071), env, out);
  ahr(env.gain, t0, 1, 0.12, dur - 0.12, 0.15);
}

// ——————————————————— 音效表 ———————————————————
export const SFX: Readonly<Record<OneShotId, OneShot>> = {
  // 1-4：高跟鞋走近后停住（「要把地板钉穿」）
  heels: S('heels', 2.3, -14, 'npc', (r) => {
    const times = [0, 0.43, 0.85, 1.26, 1.66];
    const gains = [-14, -10, -6, -3, 0];
    const lps = [2600, 3600, 5000, 7000, 9500];
    times.forEach((t, i) => {
      const lp = filt(r.ctx, 'lowpass', lps[i] as number, 0.7071);
      lp.connect(r.out);
      heelStep(r, r.t0 + t + (i ? rr(r.rng, -0.01, 0.01) : 0), lp, Math.pow(10, (gains[i] as number) / 20));   // 自动化时间不能早于 t0（负时间会抛 RangeError）
    });
  }, { send: 0.6, tau: 0.4 }),
  // 3-1：班长的脚步声「先轻后重」，渐远
  monitorSteps: S('monitorSteps', 3.6, -16, 'npc', (r) => {
    const gains = [0, -2.5, -5, -8, -11, -14];
    const lps = [6000, 4500, 3500, 2600, 2000, 1500];
    let t = r.t0;
    gains.forEach((db, i) => {
      const lp = filt(r.ctx, 'lowpass', lps[i] as number, 0.7071);
      lp.connect(r.out);
      stepPair(r, t, lp, Math.pow(10, db / 20), 0.08 * jit(r.rng, 0.1), -16);
      t += (1 / 1.9) * jit(r.rng, 0.05);
    });
  }, { send: 0.4, tau: 0.6 }),
  // 嘘：带通 4.5 kHz（Q 1.2），起音 ≥ 150 ms，保持 400 ms，释放 300 ms，−30 dBFS
  shush: S('shush', 1.0, -30, 'sfx', (r) => {
    const g = nz(r, r.t0, 1.0, [filt(r.ctx, 'bandpass', 4500, 1.2)], r.out);
    ahr(g.gain, r.t0, 1, 0.2, 0.4, 0.3);
  }, { anomaly: true, tau: 0.3 }),
  // 笃：带通 1.6 kHz（Q 10），2 ms / 40 ms，叠加 1850 Hz 正弦 35 ms，低通 3 kHz（隔着玻璃）
  tap: S('tap', 0.16, -22, 'sfx', (r) => {
    const lp = filt(r.ctx, 'lowpass', 3000, 0.7071);
    lp.connect(r.out);
    const g = nz(r, r.t0, 0.1, [filt(r.ctx, 'bandpass', 1600, 10)], lp);
    perc(g.gain, r.t0, nb((1.57 * 1600) / 10, r.ctx.sampleRate), 0.002, 0.013);
    const s = tone(r, 'sine', 1850, r.t0, 0.04, lp);
    perc(s.g.gain, r.t0, 0.5, 0.001, 0.011);
  }, { tau: 0.02 }),
  // 玻璃触碰（2-10）：正弦 1.8 kHz，起音 300 ms，释放 1.2 s
  glassTouch: S('glassTouch', 1.6, -28, 'sfx', (r) => {
    const a = tone(r, 'sine', 1800, r.t0, 1.6, r.out);
    ahr(a.g.gain, r.t0, 1, 0.3, 0, 1.2);
    const b = tone(r, 'sine', 2703, r.t0, 1.6, r.out);
    ahr(b.g.gain, r.t0, 0.08, 0.35, 0, 0.9);
  }, { anomaly: true, send: 0.8, tau: 0.6 }),
  // 肌肉声：正弦 40 → 55 Hz，0.6 s 渐强，加布料摩擦
  muscle: S('muscle', 0.85, -30, 'sfx', (r) => {
    const s = tone(r, 'sine', 40, r.t0, 0.85, r.out);
    s.o.frequency.setValueAtTime(40, r.t0);
    s.o.frequency.linearRampToValueAtTime(55, r.t0 + 0.6);
    ahr(s.g.gain, r.t0, 1, 0.6, 0.02, 0.18);
    const c = nz(r, r.t0, 0.85, [filt(r.ctx, 'bandpass', 1200, 1)], r.out);
    curve(c.gain, r.t0, 0.8, bumps(24, 3, r.rng), 0.25 * nb(1900, r.ctx.sampleRate));
  }, { tau: 0.2 }),
  // 椅子刮擦（5-5）：带通从 400 扫到 1200 Hz（Q 8），250 ms
  chairScrape: S('chairScrape', 0.32, -18, 'sfx', (r) => {
    const bp = filt(r.ctx, 'bandpass', 400, 8);
    bp.frequency.setValueAtTime(400, r.t0);
    bp.frequency.exponentialRampToValueAtTime(1200, r.t0 + 0.25);
    const g = nz(r, r.t0, 0.32, [bp], r.out);
    const rough = Array.from({ length: 40 }, (_, i) => (i === 0 || i === 39 ? 0 : 0.55 + 0.45 * r.rng()));
    curve(g.gain, r.t0, 0.25, rough, nb((1.57 * 800) / 8, r.ctx.sampleRate));
  }, { tau: 0.08 }),
  // 膝盖闷响：正弦 60 Hz τ 120 ms，加低通 400 Hz 噪声 τ 150 ms，−14 dBFS
  kneeThud: S('kneeThud', 0.9, -14, 'floor', (r) => {
    const s = tone(r, 'sine', 60, r.t0, 0.9, r.out);
    perc(s.g.gain, r.t0, 1, 0.003, 0.12);
    const n = nz(r, r.t0, 0.9, [filt(r.ctx, 'lowpass', 400, 0.7071)], r.out);
    perc(n.gain, r.t0, 0.8 * nb(440, r.ctx.sampleRate), 0.002, 0.15);
  }, { tau: 0.13 }),
  // 声控灯的继电器「咔」：1 ms 噪声加 3 kHz 正弦 4 ms
  relay: S('relay', 0.03, -30, 'sfx', (r) => {
    const n = nz(r, r.t0, 0.01, [], r.out);
    ahr(n.gain, r.t0, 1, 0.0002, 0.0008, 0.0002);
    const s = tone(r, 'sine', 3000, r.t0, 0.006, r.out);
    perc(s.g.gain, r.t0, 0.6, 0.0003, 0.0015);
  }, { tau: 0.003 }),
  // 纸条：带通 4.5 kHz（Q 1），180 ms 内 3 次调幅起伏
  paper: S('paper', 0.22, -32, 'sfx', (r) => {
    const g = nz(r, r.t0, 0.22, [filt(r.ctx, 'bandpass', 4500, 1)], r.out);
    curve(g.gain, r.t0, 0.18, bumps(30, 3, r.rng), nb(7000, r.ctx.sampleRate));
  }, { tau: 0.05, variants: 3 }),
  // 粉笔：带通 2–5 kHz，按笔画节奏加包络
  chalk: S('chalk', 1.9, -30, 'sfx', (r) => {
    const g = nz(r, r.t0, 1.9, [filt(r.ctx, 'highpass', 2000, 0.7071), filt(r.ctx, 'lowpass', 5000, 0.7071)], r.out);
    let t = r.t0 + 0.01;
    g.gain.setValueAtTime(0, r.t0);
    for (let i = 0; i < 7 && t < r.t0 + 1.7; i++) {
      const len = rr(r.rng, 0.06, 0.22), a = rr(r.rng, 0.6, 1) * nb(3000, r.ctx.sampleRate);
      g.gain.setTargetAtTime(a, t, 0.008);
      g.gain.setTargetAtTime(0, t + len, 0.012);
      t += len + rr(r.rng, 0.04, 0.12);
    }
  }, { tau: 0.3 }),
  // 水面碎开：低通 1.5 kHz 噪声，5 ms / 400 ms，加 6 个气泡（正弦 400 → 900 Hz，30 ms）
  waterBreak: S('waterBreak', 0.8, -20, 'sfx', (r) => {
    const n = nz(r, r.t0, 0.8, [filt(r.ctx, 'lowpass', 1500, 0.7071)], r.out);
    perc(n.gain, r.t0, nb(1650, r.ctx.sampleRate), 0.005, 0.1);
    for (let i = 0; i < 6; i++) {
      const t = r.t0 + 0.02 + i * 0.05 + rr(r.rng, 0, 0.03);
      const b = tone(r, 'sine', 400, t, 0.05, r.out);
      b.o.frequency.setValueAtTime(400, t);
      b.o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
      perc(b.g.gain, t, 0.35, 0.002, 0.01);
    }
  }, { tau: 0.12 }),
  // 溅水（湿地上换道）：低通扫频的「啪嗒」加 2 个水滴
  splash: S('splash', 0.25, -24, 'sfx', (r) => {
    const lp = filt(r.ctx, 'lowpass', 3000, 1.2);
    lp.frequency.setValueAtTime(3000, r.t0);
    lp.frequency.exponentialRampToValueAtTime(600, r.t0 + 0.09);
    const g = nz(r, r.t0, 0.25, [lp], r.out);
    perc(g.gain, r.t0, nb(1500, r.ctx.sampleRate), 0.001, 0.03);
    for (let i = 0; i < 2; i++) {
      const t = r.t0 + rr(r.rng, 0.015, 0.06);
      const f = rr(r.rng, 1800, 2400);
      const d = tone(r, 'sine', f, t, 0.05, r.out);
      d.o.frequency.setValueAtTime(f, t);
      d.o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.025);
      perc(d.g.gain, t, 0.3, 0.0008, 0.007);
    }
  }, { tau: 0.04, variants: 3 }),
  // 短笑（2-2）：150 ms 的气声噪声，8 Hz 调幅，−38 dBFS。「那种笑很短，像有人从门缝里塞进来一张没写字的纸条」
  laughShort: S('laughShort', 0.2, -38, 'npc', (r) => {
    const g = nz(r, r.t0, 0.2, [filt(r.ctx, 'bandpass', 1100, 0.8), filt(r.ctx, 'highpass', 400, 0.7071)], r.out);
    const pts = Array.from({ length: 24 }, (_, i) => { const x = i / 23; return Math.pow(Math.sin(Math.PI * 8 * 0.15 * x), 2) * Math.sin(Math.PI * x); });
    curve(g.gain, r.t0, 0.15, pts, nb(2100, r.ctx.sampleRate));
  }, { tau: 0.05 }),
  // 哨声（马老师）：正弦 2.8 kHz，30 Hz 调频 ±60 Hz，0.6 s
  whistle: S('whistle', 0.7, -22, 'sfx', (r) => {
    const c = tone(r, 'sine', 2800, r.t0, 0.7, r.out);
    const m = osc(r.ctx, 'sine', 30, r.t0, r.t0 + 0.7);
    const d = gain(r.ctx, 60);
    chain(m, d);
    d.connect(c.o.frequency);
    ahr(c.g.gain, r.t0, 1, 0.02, 0.53, 0.05);
  }, { tau: 0.2 }),
  // 心跳「咚咚」：两个 52 Hz 正弦脉冲，相隔 180 ms，各 90 ms，周期 0.62 s。异常：四个周期里逐渐变响（起音 ≥ 150 ms）
  heartbeat: S('heartbeat', 2.7, -20, 'sfx', (r) => {
    const s = tone(r, 'sine', 52, r.t0, 2.7, r.out);
    const pulse = Array.from({ length: 16 }, (_, i) => Math.sin((Math.PI * i) / 15));
    s.g.gain.setValueAtTime(0, r.t0);
    [0.3, 0.55, 0.8, 1].forEach((a, i) => {
      const t = r.t0 + i * 0.62;
      s.g.gain.setValueCurveAtTime(Float32Array.from(pulse, (v) => v * a), t, 0.09);
      s.g.gain.setValueCurveAtTime(Float32Array.from(pulse, (v) => v * a * 0.8), t + 0.18, 0.09);
    });
  }, { anomaly: true, tau: 0.5 }),
  // 水滴（5-4）：正弦 1.4 kHz 下滑 30%，40 ms，混响 0.9（「很响的一声」，相对很响，仍 ≤ −8 dBFS）
  drip: S('drip', 0.1, -18, 'sfx', (r) => {
    const d = tone(r, 'sine', 1400, r.t0, 0.06, r.out);
    d.o.frequency.setValueAtTime(1400, r.t0);
    d.o.frequency.exponentialRampToValueAtTime(980, r.t0 + 0.04);
    perc(d.g.gain, r.t0, 1, 0.001, 0.012);
  }, { send: 0.9, tau: 0.015 }),
  // 风（5-6 擦过耳廓）：带通 1.2 kHz 慢扫，1.2 s，声像从 +0.8 扫到 −0.8
  wind: S('wind', 1.3, -26, 'sfx', (r) => {
    const bp = filt(r.ctx, 'bandpass', 900, 1.5);
    bp.frequency.setValueAtTime(900, r.t0);
    bp.frequency.linearRampToValueAtTime(1500, r.t0 + 0.6);
    bp.frequency.linearRampToValueAtTime(1000, r.t0 + 1.2);
    const pan = r.ctx.createStereoPanner();
    pan.pan.setValueAtTime(0.8, r.t0);
    pan.pan.linearRampToValueAtTime(-0.8, r.t0 + 1.2);
    pan.connect(r.out);
    const g = nz(r, r.t0, 1.3, [bp], pan);
    ahr(g.gain, r.t0, nb((1.57 * 1200) / 1.5, r.ctx.sampleRate), 0.45, 0.25, 0.5);
  }, { anomaly: true, channels: 2, tau: 0.4 }),
  // 关门（3-10）
  doorClose: S('doorClose', 0.6, -20, 'sfx', (r) => {
    const n = nz(r, r.t0, 0.6, [filt(r.ctx, 'lowpass', 200, 0.7071)], r.out);
    perc(n.gain, r.t0, nb(220, r.ctx.sampleRate), 0.004, 0.08);
    const s = tone(r, 'sine', 70, r.t0, 0.6, r.out);
    perc(s.g.gain, r.t0, 0.6, 0.004, 0.09);
    const l = nz(r, r.t0 + 0.04, 0.02, [filt(r.ctx, 'highpass', 2000, 0.7071)], r.out);
    perc(l.gain, r.t0 + 0.04, 0.3, 0.0005, 0.002);
  }, { tau: 0.1 }),
  // 汤汁滴到领口（2-4）
  soupSpill: S('soupSpill', 0.2, -30, 'sfx', (r) => {
    for (const dt of [0, 0.07]) {
      const t = r.t0 + dt;
      const d = tone(r, 'sine', 900, t, 0.04, r.out);
      d.o.frequency.setValueAtTime(900, t);
      d.o.frequency.exponentialRampToValueAtTime(630, t + 0.025);
      perc(d.g.gain, t, 1, 0.001, 0.008);
    }
    const n = nz(r, r.t0, 0.12, [filt(r.ctx, 'lowpass', 1200, 0.7071)], r.out);
    perc(n.gain, r.t0, 0.3 * nb(1300, r.ctx.sampleRate), 0.001, 0.02);
  }, { tau: 0.02 }),
  // 碰倒拖把桶：塑料桶的几个模态
  bucketKnock: S('bucketKnock', 0.4, -18, 'sfx', (r) => {
    const c = nz(r, r.t0, 0.01, [filt(r.ctx, 'highpass', 800, 0.7071)], r.out);
    perc(c.gain, r.t0, 0.4, 0.0005, 0.002);
    for (const [f, a, tau] of [[240, 1, 0.07], [610, 0.6, 0.045], [1350, 0.35, 0.025]] as const) {
      const m = tone(r, 'sine', f * jit(r.rng, 0.03), r.t0, 0.4, r.out);
      perc(m.g.gain, r.t0, a, 0.001, tau);
    }
  }, { tau: 0.05, variants: 2 }),
  // 衣料摩擦（擦肩而过）
  cloth: S('cloth', 0.3, -32, 'npc', (r) => {
    const g = nz(r, r.t0, 0.3, [filt(r.ctx, 'bandpass', 1200, 1)], r.out);
    curve(g.gain, r.t0, 0.26, bumps(24, 2, r.rng), nb(1900, r.ctx.sampleRate));
  }, { tau: 0.08, variants: 3 }),

  // ——— WP7 自用 ———
  // 绊：150 ms 擦地声（噪声 → 带通从 1.5 kHz 扫到 400 Hz）
  scrape: S('scrape', 0.2, -22, 'self', (r) => {
    const bp = filt(r.ctx, 'bandpass', 1500, 1.5);
    bp.frequency.setValueAtTime(1500, r.t0);
    bp.frequency.exponentialRampToValueAtTime(400, r.t0 + 0.15);
    const g = nz(r, r.t0, 0.2, [bp], r.out);
    const rough = Array.from({ length: 24 }, (_, i) => (i === 0 || i === 23 ? 0 : (0.6 + 0.4 * r.rng()) * (1 - i / 30)));
    curve(g.gain, r.t0, 0.15, rough, nb((1.57 * 900) / 1.5, r.ctx.sampleRate));
  }, { tau: 0.05, variants: 3 }),
  // 撞：身体顿住的一记闷响
  crashThud: S('crashThud', 0.4, -16, 'self', (r) => {
    const n = nz(r, r.t0, 0.4, [filt(r.ctx, 'lowpass', 300, 0.7071)], r.out);
    perc(n.gain, r.t0, nb(330, r.ctx.sampleRate), 0.002, 0.06);
    const s = tone(r, 'sine', 80, r.t0, 0.4, r.out);
    perc(s.g.gain, r.t0, 0.7, 0.002, 0.07);
    const c = nz(r, r.t0 + 0.01, 0.2, [filt(r.ctx, 'bandpass', 1200, 1)], r.out);
    perc(c.gain, r.t0 + 0.01, 0.15 * nb(1900, r.ctx.sampleRate), 0.005, 0.05);
  }, { tau: 0.06, variants: 2 }),
  // 灯管亮灭的「咔」（1 ms，−32 dBFS）
  click: S('click', 0.02, -32, 'sfx', (r) => {
    const g = nz(r, r.t0, 0.01, [filt(r.ctx, 'highpass', 1000, 0.7071)], r.out);
    ahr(g.gain, r.t0, 1, 0.0002, 0.0006, 0.0002);
  }, { tau: 0.002, variants: 2 }),
  // 低语：400 ms 的共振峰噪声（带通 600 / 1800 Hz），−40 dBFS；不合成人声。起音 220 ms（「声音不大」，从安静里浮出来）
  whisper: S('whisper', 0.5, -40, 'npc', (r) => {
    const env = gain(r.ctx, 0);
    env.connect(r.out);
    const g1 = nz(r, r.t0, 0.5, [filt(r.ctx, 'bandpass', 600, 4)], env);
    const g2 = nz(r, r.t0, 0.5, [filt(r.ctx, 'bandpass', 1800, 5)], env);
    g1.gain.value = nb((1.57 * 600) / 4, r.ctx.sampleRate);
    g2.gain.value = 0.7 * nb((1.57 * 1800) / 5, r.ctx.sampleRate);
    ahr(env.gain, r.t0, 1, 0.22, 0.06, 0.12);
  }, { anomaly: true, tau: 0.1, variants: 2 }),
  // 正常人的一步（NPC）
  stepPair: S('stepPair', 0.45, -16, 'npc', (r) => stepPair(r, r.t0, r.out, 1, 0.08 * jit(r.rng, 0.1), -16), { send: 0.3, tau: 0.06, variants: 4 }),
  // 主角自己站起来走（4-3、5-8）：同一配方，时间抖动 ±25%，第二声 +3 dB
  stepSelf: S('stepSelf', 0.45, -13, 'self', (r) => stepPair(r, r.t0, r.out, 1, 0.08 * jit(r.rng, 0.25), -13), { send: 0.3, tau: 0.06, variants: 4 }),
  // UI 移动：极轻的纸张声（−40 dBFS）
  uiMove: S('uiMove', 0.06, -40, 'ui', (r) => {
    const g = nz(r, r.t0, 0.06, [filt(r.ctx, 'bandpass', 5000, 1.2)], r.out);
    ahr(g.gain, r.t0, nb(6500, r.ctx.sampleRate), 0.004, 0.01, 0.03);
  }, { tau: 0.015, variants: 2 }),
  bellMorning: S('bellMorning', 3.8, -18, 'sfx', (r) => bellMorning(r, r.out), { send: 0.6, tau: 1.5 }),
  bellLunch: S('bellLunch', 5.3, -18, 'sfx', (r) => bellLunch(r, r.out), { send: 0.6, tau: 2 }),
  // 上课铃（远）：早自习铃加低通 1.5 kHz，−26 dBFS
  bellClass: S('bellClass', 3.8, -26, 'sfx', (r) => bellMorning(r, r.out, 1500), { send: 0.8, tau: 1.5 }),

  // ——— 环境颗粒 ———
  // 雨滴：2–5 kHz 的正弦下滑 30%，5 ms（运行时 −40 至 −30 dBFS，声像随机）
  rainDrop: S('rainDrop', 0.012, -30, 'ambience', (r) => {
    const f = rr(r.rng, 2000, 5000);
    const d = tone(r, 'sine', f, r.t0, 0.008, r.out);
    d.o.frequency.setValueAtTime(f, r.t0);
    d.o.frequency.exponentialRampToValueAtTime(f * 0.7, r.t0 + 0.005);
    perc(d.g.gain, r.t0, 1, 0.0003, 0.0015);
  }, { tau: 0.002, variants: 8 }),
  // 铁皮车棚：冲击 → 820 / 1370 / 2110 Hz 三路带通（Q 18），衰减 80 ms
  tinImpact: S('tinImpact', 0.3, -26, 'ambience', (r) => {
    const k = jit(r.rng, 0.05);
    for (const [f, a] of [[820, 1], [1370, 0.8], [2110, 0.6]] as const) {
      const g = nz(r, r.t0, 0.3, [filt(r.ctx, 'bandpass', f * k, 18)], r.out);
      perc(g.gain, r.t0, a * nb((1.57 * f) / 18, r.ctx.sampleRate), 0.0005, 0.027);
    }
  }, { tau: 0.03, variants: 6 }),
  // 空调外机：3 个不协和正弦 1318 / 2093 / 3371 Hz，衰减 200 ms
  acDing: S('acDing', 0.6, -34, 'ambience', (r) => {
    for (const [f, a] of [[1318, 1], [2093, 0.7], [3371, 0.5]] as const) {
      const m = tone(r, 'sine', f * jit(r.rng, 0.01), r.t0, 0.6, r.out);
      perc(m.g.gain, r.t0, a, 0.001, 0.07);
    }
  }, { tau: 0.07, variants: 3 }),
  // 食堂的金属碰撞：2350 / 3710 / 5120 Hz，衰减 90 / 60 / 40 ms
  clink: S('clink', 0.3, -30, 'ambience', (r) => {
    for (const [f, a, d] of [[2350, 1, 0.09], [3710, 0.7, 0.06], [5120, 0.5, 0.04]] as const) {
      const m = tone(r, 'sine', f * jit(r.rng, 0.03), r.t0, 0.3, r.out);
      perc(m.g.gain, r.t0, a, 0.0005, d / 2);
    }
  }, { tau: 0.03, variants: 4 }),
  // 托盘刮擦
  trayScrape: S('trayScrape', 0.35, -36, 'ambience', (r) => {
    const bp = filt(r.ctx, 'bandpass', 700, 4);
    bp.frequency.setValueAtTime(700, r.t0);
    bp.frequency.linearRampToValueAtTime(1100, r.t0 + 0.3);
    const g = nz(r, r.t0, 0.35, [bp], r.out);
    ahr(g.gain, r.t0, nb((1.57 * 900) / 4, r.ctx.sampleRate), 0.03, 0.2, 0.07);
  }, { tau: 0.1, variants: 2 }),
  // 值日表的纸声
  rosterPaper: S('rosterPaper', 0.45, -42, 'ambience', (r) => {
    const g = nz(r, r.t0, 0.45, [filt(r.ctx, 'bandpass', 3500, 1)], r.out);
    curve(g.gain, r.t0, 0.4, bumps(30, 4, r.rng), nb(5500, r.ctx.sampleRate));
  }, { tau: 0.1, variants: 2 }),
  // 公交雨刷：带通从 800 扫到 2000 Hz，250 ms
  wiper: S('wiper', 0.3, -32, 'ambience', (r) => {
    const bp = filt(r.ctx, 'bandpass', 800, 2);
    bp.frequency.setValueAtTime(800, r.t0);
    bp.frequency.exponentialRampToValueAtTime(2000, r.t0 + 0.25);
    const g = nz(r, r.t0, 0.3, [bp], r.out);
    ahr(g.gain, r.t0, nb((1.57 * 1300) / 2, r.ctx.sampleRate), 0.03, 0.17, 0.05);
  }, { tau: 0.08, variants: 2 }),
};

export const BELL_SFX: Readonly<Record<BellKind, OneShotId>> = { morning: 'bellMorning', lunch: 'bellLunch', class: 'bellClass' };

/** 列出全部一次性声音（测试和预渲染用）。 */
export function allOneShots(): OneShot[] { return Object.values(SFX); }
