// src/audio/ambience.ts —— 环境底噪、雨、灯管嗡鸣（DESIGN.md §6.2「雨」「灯管嗡鸣」「环境底噪」「梦中掌声」）。WP7。
// 都是常驻的原生节点图：循环噪声 → 滤波 → 增益，外加由 advance(until) 提前排程的自动化（音节包络、共振峰随机游走、
// 泊松分布的颗粒、慢起伏）。实时运行时每帧 advance(now + 0.35)；离线测试一次 advance 到渲染结束。
// 电平：床噪按 RMS（用 JS 把噪声缓冲过一遍同样的滤波器量出来，精确补偿）；颗粒按峰值（颗粒本身已预渲染归一）。
import type { AmbienceId } from '../core/types';
import { biquadCoefs, biquadRun, dbToGain, qDb, rmsOf, type BiquadType } from './dsp';
import { filt, gain, noise, osc, type NoiseBank, type NoiseKind } from './graph';
import type { ApplauseKind } from './library';
import { rr } from './recipes/common';
import type { GrainId } from './recipes/sfx';

export interface AmbDeps {
  ctx: BaseAudioContext;
  noise: NoiseBank;
  rng: () => number;
  /** 环境总线与底噪总线（底噪在失败、安静的一秒里保留）。 */
  amb: AudioNode;
  floor: AudioNode;
  /** 播放一个预渲染的颗粒（低优先级声部）。 */
  grain(id: GrainId, at: number, gainDb: number, pan: number, dest?: AudioNode): void;
  /** 梦中掌声的循环缓冲（还没生成时返回 null）。 */
  loop(kind: ApplauseKind): AudioBuffer | null;
}

type F = [BiquadType, number, number?];
const bedGainCache = new Map<string, number>();

/** 噪声经过这些滤波器之后的 RMS 补偿：把 RMS 调到 targetDb（dBFS）。 */
function bedGain(bank: NoiseBank, kind: NoiseKind, fs: readonly F[], targetDb: number, sr: number): number {
  const key = `${kind}|${sr}|${fs.map((f) => f.join(',')).join(';')}`;
  let rms = bedGainCache.get(key);
  if (rms === undefined) {
    let x: Float32Array = bank.get(kind).getChannelData(0).subarray(0, Math.min(Math.floor(sr * 1.5), bank.get(kind).length));
    for (const [type, f, q] of fs) {
      const qq = q ?? 0.7071;
      x = biquadRun(x, biquadCoefs(type, f, type === 'lowpass' || type === 'highpass' ? qDb(qq) : qq, 0, sr));
    }
    rms = rmsOf([x], Math.floor(x.length * 0.1));
    bedGainCache.set(key, rms);
  }
  return rms > 0 ? dbToGain(targetDb) / rms : 0;
}

interface Layer { advance?(until: number): void; stop(at: number): void; param?(name: string, v: number, at: number): void }

/** 一个环境音实例；换环境音时新旧两个实例交叉淡变。 */
export class Ambience {
  readonly out: GainNode;
  readonly floorOut: GainNode;
  private layers: Layer[] = [];
  private stopped = false;
  level = 0;

  constructor(private readonly d: AmbDeps, readonly id: AmbienceId, at: number) {
    this.out = gain(d.ctx, 0);
    this.floorOut = gain(d.ctx, 0);
    this.out.connect(d.amb);
    this.floorOut.connect(d.floor);
    this.layers = buildLayers(d, id, at, this.out, this.floorOut);
  }

  /** secs 秒内淡到 level（0..1）。 */
  fadeTo(level: number, at: number, secs: number): void {
    this.level = level;
    const tau = Math.max(0.01, secs / 3);
    for (const g of [this.out, this.floorOut]) {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(level, at, tau);
    }
  }

  /** 淡出并在之后停掉所有源。 */
  stop(at: number, secs: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.fadeTo(0, at, secs);
    const end = at + Math.max(0.1, secs) * 2 + 0.1;
    for (const l of this.layers) l.stop(end);
    this.stopAt = end;
  }
  stopAt = Infinity;
  get done(): boolean { return this.stopped; }

  advance(until: number): void { if (!this.stopped) for (const l of this.layers) l.advance?.(until); }
  param(name: string, v: number, at: number): void { for (const l of this.layers) l.param?.(name, v, at); }
  disconnect(): void { try { this.out.disconnect(); this.floorOut.disconnect(); } catch { /* 已断开 */ } }
}

// ——————————————————— 层 ———————————————————
function bed(d: AmbDeps, at: number, dest: AudioNode, kind: NoiseKind, fs: readonly F[], rmsDb: number, swell?: { db: number; period: number }): Layer {
  const { ctx } = d;
  const src = noise(ctx, d.noise, kind, at, Infinity, d.rng);
  let node: AudioNode = src;
  for (const [type, f, q] of fs) { const n = filt(ctx, type, f, q ?? 0.7071); node.connect(n); node = n; }
  const g = gain(ctx, bedGain(d.noise, kind, fs, rmsDb, ctx.sampleRate));
  node.connect(g);
  let out: AudioNode = g;
  let next = at;
  let sw: GainNode | null = null;
  if (swell) { sw = gain(ctx, 1); g.connect(sw); out = sw; }
  out.connect(dest);
  return {
    advance(until) {
      if (!sw || !swell) return;
      while (next < until) {
        sw.gain.setTargetAtTime(dbToGain(rr(d.rng, -swell.db, swell.db)), next, swell.period / 3);
        next += swell.period * rr(d.rng, 0.6, 1.4);
      }
    },
    stop(t) { src.stop(t); },
  };
}

function drone(d: AmbDeps, at: number, dest: AudioNode, type: OscillatorType, f: number, fs: readonly F[], peakDb: number): Layer {
  const { ctx } = d;
  const o = osc(ctx, type, f, at, Infinity);
  let node: AudioNode = o;
  for (const [t, fr, q] of fs) { const n = filt(ctx, t, fr, q ?? 0.7071); node.connect(n); node = n; }
  const g = gain(ctx, dbToGain(peakDb));
  node.connect(g); g.connect(dest);
  return { stop(t) { o.stop(t); } };
}

/**
 * 朗读 / 人声的膜（§6.2「早自习朗读」）：n 路噪声，各经两个共振峰带通（F1 300–800 Hz、F2 900–2400 Hz，5 Hz 随机游走），
 * 按 60–120 ms 的音节包络开关，整体低通。
 */
function murmur(d: AmbDeps, at: number, dest: AudioNode, n: number, lp: number, rmsDb: number): Layer {
  const { ctx, rng } = d;
  const sr = ctx.sampleRate;
  const sum = gain(ctx, 1);
  const lpf = filt(ctx, 'lowpass', lp, 0.7071);
  // 每路 RMS ≈ 0.5 × sqrt(2·bw/sr)（两个带通）× sqrt(占空比)；n 路不相关相加 × sqrt(n)
  const per = 0.5 * Math.sqrt((2 * ((1.57 * 550) / 4 + (1.57 * 1600) / 5)) / sr) * Math.sqrt(0.5);
  const out = gain(ctx, dbToGain(rmsDb) / (per * Math.sqrt(n)));
  sum.connect(lpf); lpf.connect(out); out.connect(dest);
  const voices = Array.from({ length: n }, () => {
    const src = noise(ctx, d.noise, 'white', at, Infinity, rng);
    const f1 = filt(ctx, 'bandpass', rr(rng, 300, 800), 4);
    const f2 = filt(ctx, 'bandpass', rr(rng, 900, 2400), 5);
    const env = gain(ctx, 0);
    src.connect(f1); src.connect(f2); f1.connect(env); f2.connect(env); env.connect(sum);
    return { src, f1, f2, env, next: at + rr(rng, 0, 0.3), on: false, nextF: at, F1: rr(rng, 300, 800), F2: rr(rng, 900, 2400) };
  });
  return {
    advance(until) {
      for (const v of voices) {
        while (v.nextF < until) {
          v.F1 = Math.min(800, Math.max(300, v.F1 + rr(rng, -90, 90)));
          v.F2 = Math.min(2400, Math.max(900, v.F2 + rr(rng, -220, 220)));
          v.f1.frequency.setTargetAtTime(v.F1, v.nextF, 0.04);
          v.f2.frequency.setTargetAtTime(v.F2, v.nextF, 0.04);
          v.nextF += 0.2;
        }
        while (v.next < until) {
          if (v.on) {
            v.env.gain.setTargetAtTime(0, v.next, 0.012);
            v.next += rng() < 0.12 ? rr(rng, 0.3, 0.8) : rr(rng, 0.04, 0.12);
          } else {
            v.env.gain.setTargetAtTime(rr(rng, 0.7, 1.2), v.next, 0.012);
            v.next += rr(rng, 0.06, 0.12);
          }
          v.on = !v.on;
        }
      }
    },
    stop(t) { for (const v of voices) v.src.stop(t); },
  };
}

/** 泊松分布的颗粒（rate 次/秒），电平在 [lo, hi] dB 之间（相对颗粒的归一峰值）。 */
function grains(d: AmbDeps, at: number, id: GrainId, rate: number, lo: number, hi: number, pan = 0.7, dest?: AudioNode): Layer {
  let k = 1;
  let next = at + -Math.log(1 - d.rng()) / Math.max(1e-3, rate);
  let stopT = Infinity;
  return {
    advance(until) {
      const r = rate * k;
      if (r <= 1e-3) { next = until; return; }
      while (next < until && next < stopT) {
        d.grain(id, next, rr(d.rng, lo, hi), rr(d.rng, -pan, pan), dest);
        next += -Math.log(1 - d.rng()) / r;
      }
    },
    param(name, v) { if (name === 'rain') k = Math.max(0, v / 0.6); },
    stop(t) { stopT = t; },
  };
}

/** 固定周期的颗粒（公交雨刷每 1.4 s）。 */
function periodic(d: AmbDeps, at: number, id: GrainId, period: number, db: number): Layer {
  let next = at + 0.3;
  let stopT = Infinity;
  return {
    advance(until) { while (next < until && next < stopT) { d.grain(id, next, db, 0, undefined); next += period; } },
    stop(t) { stopT = t; },
  };
}

/** 窗缝风声：带通 600 Hz（Q 3），中心频率在 400–900 Hz 之间慢扫（§6.2「北向实验楼」）。 */
function sweepWind(d: AmbDeps, at: number, dest: AudioNode, rmsDb: number): Layer {
  const { ctx, rng } = d;
  const src = noise(ctx, d.noise, 'pink', at, Infinity, rng);
  const bp = filt(ctx, 'bandpass', 600, 3);
  const g = gain(ctx, bedGain(d.noise, 'pink', [['bandpass', 600, 3]], rmsDb, ctx.sampleRate));
  src.connect(bp); bp.connect(g); g.connect(dest);
  let next = at;
  return {
    advance(until) {
      while (next < until) { bp.frequency.setTargetAtTime(rr(rng, 400, 900), next, 1.0); next += rr(rng, 2, 4); }
    },
    stop(t) { src.stop(t); },
  };
}

/** 梦里的风声随速度变化（「像有人把一张薄纸从中间撕开」）：带通中心和电平跟速度走，外加快速的颤动。 */
function speedWind(d: AmbDeps, at: number, dest: AudioNode): Layer {
  const { ctx, rng } = d;
  const src = noise(ctx, d.noise, 'white', at, Infinity, rng);
  const bp = filt(ctx, 'bandpass', 1400, 2);
  const flutter = gain(ctx, 1);
  const lvl = gain(ctx, 0);
  const base = bedGain(d.noise, 'white', [['bandpass', 1400, 2]], 0, ctx.sampleRate);
  src.connect(bp); bp.connect(flutter); flutter.connect(lvl); lvl.connect(dest);
  let next = at;
  return {
    advance(until) {
      while (next < until) { flutter.gain.setTargetAtTime(rr(rng, 0.45, 1), next, 0.012); next += rr(rng, 0.04, 0.09); }
    },
    param(name, v, t) {
      if (name !== 'speed') return;
      const k = Math.max(0, Math.min(1, (v - 5) / 4.6));            // 5 → 9.6 m/s
      lvl.gain.setTargetAtTime(base * dbToGain(-48 + 14 * k), t, 0.3);
      bp.frequency.setTargetAtTime(1000 + 1800 * k, t, 0.3);
    },
    stop(t) { src.stop(t); },
  };
}

/** 梦中掌声：三个循环（稀疏 / 稠密 / 对齐）按 density、align 交叉淡变。 */
function applause(d: AmbDeps, at: number, dest: AudioNode): Layer {
  const { ctx } = d;
  const kinds: ApplauseKind[] = ['sparse', 'dense', 'aligned'];
  const gs = kinds.map(() => gain(ctx, 0));
  const srcs: AudioBufferSourceNode[] = [];
  kinds.forEach((k, i) => {
    const b = d.loop(k);
    if (!b) return;
    const s = ctx.createBufferSource();
    s.buffer = b; s.loop = true;
    s.start(at, d.rng() * b.duration);
    s.connect(gs[i] as GainNode);
    (gs[i] as GainNode).connect(dest);
    srcs.push(s);
  });
  let density = 0.5, align = 0;
  const apply = (t: number) => {
    const w = [(1 - align) * (1 - density), (1 - align) * density, align];
    gs.forEach((g, i) => g.gain.setTargetAtTime(Math.sqrt(w[i] as number), t, 0.6));
  };
  apply(at);
  return {
    param(name, v, t) {
      if (name === 'density') density = Math.max(0, Math.min(1, v));
      else if (name === 'align') align = Math.max(0, Math.min(1, v));
      else return;
      apply(t);
    },
    stop(t) { for (const s of srcs) s.stop(t); },
  };
}

/** 各环境音的组成（§6.2「环境底噪」一行；kit / set 的缺省见 places.ts）。 */
function buildLayers(d: AmbDeps, id: AmbienceId, at: number, amb: AudioNode, floor: AudioNode): Layer[] {
  const room = (db = -42, lp = 180): Layer => bed(d, at, floor, 'brown', [['lowpass', lp]], db);
  switch (id) {
    case 'room': return [room()];
    case 'reading': return [room(-46), murmur(d, at, amb, 5, 2500, -34)];
    case 'canteen': return [room(-46), murmur(d, at, amb, 10, 2500, -30), grains(d, at, 'clink', 1.5, -8, 0), grains(d, at, 'trayScrape', 0.3, -6, 0)];
    case 'labWind': return [room(-46), sweepWind(d, at, amb, -38), grains(d, at, 'rosterPaper', 0.25, -4, 0, 0.5)];
    case 'nightCorridor': return [room(-46, 150), bed(d, at, amb, 'white', [['highpass', 5000], ['lowpass', 9000]], -62)];
    case 'rainStreet': return [bed(d, at, amb, 'brown', [['lowpass', 120]], -40, { db: 3, period: 6 })];
    case 'shedRoof': return [bed(d, at, amb, 'brown', [['lowpass', 120]], -42, { db: 3, period: 6 }),
      grains(d, at, 'tinImpact', 25, -9, 0, 0.8), grains(d, at, 'acDing', 0.3, -3, 0, 0.6)];
    case 'bus': return [drone(d, at, amb, 'sawtooth', 42, [['lowpass', 120]], -32), periodic(d, at, 'wiper', 1.4, 0), room(-44, 200)];
    case 'home': return [room(-46, 150), drone(d, at, amb, 'sine', 100, [], -60)];
    case 'dream': return [bed(d, at, amb, 'white', [['highpass', 3000]], -44), drone(d, at, amb, 'sine', 41, [], -40), speedWind(d, at, amb)];
    case 'dreamApplause': return [applause(d, at, amb)];
    case 'dawnStreet': return [bed(d, at, amb, 'brown', [['lowpass', 120]], -42, { db: 3, period: 7 }),
      bed(d, at, amb, 'pink', [['bandpass', 800, 0.7]], -50, { db: 4, period: 5 })];
    case 'field': return [murmur(d, at, amb, 6, 1200, -36), bed(d, at, amb, 'pink', [['bandpass', 700, 0.7]], -50, { db: 4, period: 5 })];
    case 'infirmary': return [room(-48, 160)];
    case 'void': return [room(-52, 90)];
    case 'none': return [];
  }
}

// ——————————————————— 雨 ———————————————————
/**
 * 雨（§6.2）：底层粉噪 → 高通 400 → 低通 5 kHz，−24 dBFS × 强度，0.1 Hz 随机起伏 ±2 dB；
 * 雨滴泊松分布 40 次/s × 强度，每滴 2–5 kHz 下滑，−40 至 −30 dBFS，声像随机。
 * 都接进 Mixer.rainIn（露天 / 车里 / 室内三种听感由 Mixer.setRainExposure 决定）。
 */
export class Rain {
  intensity = 0;
  private bedGain: GainNode | null = null;
  private swell: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private nextDrop = 0;
  private nextSwell = 0;
  private readonly unit: number;
  constructor(private readonly d: AmbDeps, private readonly dest: AudioNode) {
    this.unit = bedGain(d.noise, 'pink', [['highpass', 400], ['lowpass', 5000]], -24, d.ctx.sampleRate);
  }
  set(intensity: number, at: number, secs: number): void {
    const I = Math.max(0, Math.min(1, intensity));
    if (I > 0 && !this.bedGain) {
      const { ctx } = this.d;
      this.src = noise(ctx, this.d.noise, 'pink', at, Infinity, this.d.rng);
      const hp = filt(ctx, 'highpass', 400), lp = filt(ctx, 'lowpass', 5000);
      this.bedGain = gain(ctx, 0);
      this.swell = gain(ctx, 1);
      this.src.connect(hp); hp.connect(lp); lp.connect(this.bedGain); this.bedGain.connect(this.swell); this.swell.connect(this.dest);
      this.nextDrop = at; this.nextSwell = at;
    }
    this.intensity = I;
    if (this.bedGain) {
      this.bedGain.gain.cancelScheduledValues(at);
      this.bedGain.gain.setTargetAtTime(this.unit * I, at, Math.max(0.02, secs / 3));
    }
  }
  advance(until: number): void {
    if (!this.bedGain || this.intensity <= 0) { this.nextDrop = Math.max(this.nextDrop, until); this.nextSwell = Math.max(this.nextSwell, until); return; }
    const rate = 40 * this.intensity;
    while (this.nextDrop < until) {
      this.d.grain('rainDrop', this.nextDrop, rr(this.d.rng, -10, 0), rr(this.d.rng, -0.9, 0.9), this.dest);
      this.nextDrop += -Math.log(1 - this.d.rng()) / rate;
    }
    while (this.nextSwell < until) {
      this.swell?.gain.setTargetAtTime(dbToGain(rr(this.d.rng, -2, 2)), this.nextSwell, 2.5);
      this.nextSwell += rr(this.d.rng, 6, 14);
    }
  }
}

// ——————————————————— 灯管嗡鸣 ———————————————————
/**
 * 灯管嗡鸣（§6.2）：正弦 100 Hz −36 dBFS，加锯齿 100 Hz → 低通 600 Hz −40 dBFS，加噪声 → 带通 7 kHz（Q 10）−52 dBFS。
 * 增益跟随 LampField 在玩家处的亮度；灯灭时 0.4 s 内音高从 100 滑到 85 Hz 并淡出（「像电流在叹气」）。
 */
export class Hum {
  private out: GainNode | null = null;
  private sine: OscillatorNode | null = null;
  private saw: OscillatorNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private level = -1;
  private low = false;
  constructor(private readonly d: AmbDeps, private readonly dest: AudioNode) {}
  private ensure(at: number): GainNode {
    if (this.out) return this.out;
    const { ctx } = this.d;
    this.out = gain(ctx, 0);
    this.sine = osc(ctx, 'sine', 100, at, Infinity);
    this.saw = osc(ctx, 'sawtooth', 100, at, Infinity);
    const gs = gain(ctx, dbToGain(-36)), gw = gain(ctx, dbToGain(-40) * 1.25), lp = filt(ctx, 'lowpass', 600);
    this.sine.connect(gs); gs.connect(this.out);
    this.saw.connect(lp); lp.connect(gw); gw.connect(this.out);
    this.src = noise(ctx, this.d.noise, 'white', at, Infinity, this.d.rng);
    const bp = filt(ctx, 'bandpass', 7000, 10);
    const gn = gain(ctx, bedGain(this.d.noise, 'white', [['bandpass', 7000, 10]], -52, ctx.sampleRate));
    this.src.connect(bp); bp.connect(gn); gn.connect(this.out);
    this.out.connect(this.dest);
    return this.out;
  }
  /** 目标电平（0..1 = 亮度 × 地点是否有灯管）。 */
  set(v: number, at: number, tau = 0.05): void {
    if (v <= 0 && !this.out) return;
    const out = this.ensure(at);
    const x = Math.max(0, Math.min(1, v));
    if (Math.abs(x - this.level) < 0.01) return;
    // 亮 → 灭：「像电流在叹气」；灭 → 亮：音高回到 100 Hz
    if (x < 0.2 && this.level >= 0.5) this.pitch(85, at, 0.4 / 3);
    else if (x >= 0.5 && this.low) this.pitch(100, at, 0.01);
    this.low = x < 0.2;
    out.gain.cancelScheduledValues(at);
    out.gain.setTargetAtTime(x, at, x < this.level && x < 0.2 ? 0.4 / 3 : tau);
    this.level = x;
  }
  private pitch(f: number, at: number, tau: number): void {
    for (const o of [this.sine, this.saw]) { o?.frequency.cancelScheduledValues(at); o?.frequency.setTargetAtTime(f, at, tau); }
  }
  get current(): number { return Math.max(0, this.level); }
}
