// src/audio/mixer.ts —— 总线、门、混响交叉淡变与主输出链（DESIGN.md §6.1）。WP7。
//
//   self / npc / sfx / ui ──(各自音量 → 门)──────────────────────────┐
//   follower ── 音量 → 低通 → 回头静音 → 电平 → 门 ─────────────────────┤
//                              └→ 混响量 → 混响 B                       ├→ master → 压缩(−14 dB, 4:1, 3 ms, 250 ms)
//   ambience / floor ──(环境音量 → 门)──────────────────────────────────┤        → 限幅(−9 dB, 20:1, 1 ms)
//                                                                             → 软削波保险（WaveShaper，≤ −8.1 dBFS）→ destination
//   混响 A（self / sfx / ui 的发送）、混响 B（follower / npc 的发送）──门──┘
//
// 门（Gate）：每条总线一个 GainNode，按「若干个带起止时间的门」的乘积排程（静音段、安静的一秒、失败、回头、玻璃触碰、界面）。
// 只用 setTargetAtTime 排程，取消之后重排也是连续的（不会咔哒）。
// 混响分两组：静音段要连同追随者和 NPC 的混响尾巴一起掐掉（§8.10 WP7 验收 4），自己的掌声和音效的混响不受影响。
// DynamicsCompressorNode 按规范会自动加「补偿增益」（makeup gain，Chromium 里约 +5–6 dB），会把峰值推过 −8 dBFS；
// 所以解锁时用一次极短的离线渲染量出补偿增益，再在压缩器后面乘它的倒数。
import type { ReverbId } from '../core/types';
import type { Volumes } from '../core/contracts';
import { impulseResponse } from './dsp';
import { gain } from './graph';
import { renderOffline, type MakeOffline } from './library';
import { REVERB_RT60 } from './places';
import type { BusId } from './recipes/common';

export type GateBus = BusId | 'revA' | 'revB';
export const ALL_GATE_BUSES: readonly GateBus[] = ['self', 'follower', 'npc', 'sfx', 'ambience', 'floor', 'ui', 'revA', 'revB'];

interface GateItem { gain: number; from: number; until: number; att: number; rel: number }

/** 一个增益参数上的若干个门；目标值 = 当前生效的门的增益之积。 */
export class Gate {
  private items = new Map<string, GateItem>();
  constructor(readonly param: AudioParam) {}

  /** 从 from 起把增益压到 gain（时间常数 att），直到 until（之后以时间常数 rel 恢复）。 */
  set(id: string, g: number, from: number, until: number, att: number, rel: number, now: number): void {
    this.items.set(id, { gain: g, from, until, att, rel });
    this.reschedule(now);
  }
  /** 在 at 时刻结束这个门（以时间常数 rel 恢复）。 */
  clear(id: string, at: number, rel: number, now: number): void {
    const it = this.items.get(id);
    if (!it) return;
    it.until = Math.min(it.until, Math.max(at, it.from));
    it.rel = rel;
    this.reschedule(now);
  }
  has(id: string): boolean { return this.items.has(id); }
  /** t 时刻的目标增益（门的乘积）。 */
  target(t: number): number {
    let g = 1;
    for (const it of this.items.values()) if (t >= it.from && t < it.until) g *= it.gain;
    return g;
  }

  private sched: Array<{ t: number; v: number }> = [];

  private reschedule(now: number): void {
    for (const [id, it] of this.items) if (it.until < now - 5) this.items.delete(id);
    // 此刻真正生效的目标：上一次排程里 t ≤ now 的最后一个点
    let cur = 1;
    for (const s of this.sched) if (s.t <= now) cur = s.v;
    const pts = new Set<number>([now]);
    for (const it of this.items.values()) {
      if (it.from > now) pts.add(it.from);
      if (Number.isFinite(it.until) && it.until > now) pts.add(it.until);
    }
    const times = Array.from(pts).sort((a, b) => a - b);
    const p = this.param;
    p.cancelScheduledValues(now);
    this.sched = this.sched.filter((s) => s.t < now);
    let prev = cur;
    for (const t of times) {
      const v = this.target(t);
      if (Math.abs(v - prev) < 1e-9) continue;           // 不变：保留正在进行的自动化（连同它的时间常数）
      let tau: number;
      if (v < prev) {
        tau = Infinity;
        for (const it of this.items.values()) if (t >= it.from && t < it.until && it.gain < 1) tau = Math.min(tau, it.att);
        if (!Number.isFinite(tau)) tau = 0.05;
      } else {
        tau = 0;
        for (const it of this.items.values()) if (it.until <= t + 1e-9 && it.until >= t - 0.5) tau = Math.max(tau, it.rel);
        if (tau <= 0) tau = 0.05;
      }
      p.setTargetAtTime(v, t, Math.max(1e-4, tau));
      this.sched.push({ t, v });
      prev = v;
    }
  }
}

/** 全作峰值上限（附录 A-2、LIMITS.peakDbfs = −8）留 0.1 dB 余量。 */
export const CEIL_DB = -8.1;
/** 软削波的拐点：这以下完全线性。 */
export const KNEE_DB = -9.5;

/**
 * 最后一道保险：WaveShaperNode（原生节点）的静态曲线。|x| ≤ 拐点时 y = x（分段线性插值对直线是精确的，不染色）；
 * 以上用 tanh 软拐点逼近上限，输入再大（WaveShaper 把输入截在 ±1）输出也不会超过 CEIL_DB。
 * 限幅器是 1 ms 起音的压缩器：Chromium 有 6 ms 前瞻，大多数瞬态它自己就接住了；没有前瞻的实现（或者极端叠加）
 * 会漏过第一毫秒，这道曲线保证「全作任何声音的峰值 ≤ −8 dBFS」不依赖压缩器的实现细节。
 */
export function safetyCurve(n = 8193, kneeDb = KNEE_DB, ceilDb = CEIL_DB): Float32Array<ArrayBuffer> {
  const T = Math.pow(10, kneeDb / 20), C = Math.pow(10, ceilDb / 20), w = C - T;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= T ? a : T + w * Math.tanh((a - T) / w));
  }
  return c;
}

/** 音量设置（0–100）→ 线性增益：(v/100)^1.5（50 ≈ −9 dB）。 */
export function volumeGain(v: number): number {
  const x = Math.max(0, Math.min(100, v)) / 100;
  return Math.pow(x, 1.5);
}

interface Bus { in: GainNode; sendIn: GainNode | null; gate: Gate; out: AudioNode }

/** 追随者的混音参数（§2.6 表的四个声音通道）。 */
export interface FollowerMix { audible: boolean; gainDb: number; lowpass: number; panWidth: number; reverb: number }

class ReverbGroup {
  readonly in: GainNode;
  readonly out: GainNode;
  private slots: Array<{ conv: ConvolverNode; g: GainNode; id: ReverbId; since: number }> = [];
  constructor(private readonly ctx: BaseAudioContext) {
    this.in = gain(ctx, 1);
    this.out = gain(ctx, 1);
  }
  get current(): ReverbId | null { return this.slots[this.slots.length - 1]?.id ?? null; }
  /**
   * 交叉淡变到新的脉冲响应（两个 Convolver，§6.1 的 0.8 s）。用 setTargetAtTime（τ = fade / 4）而不是曲线：
   * 淡变途中再次切换也不会和已排的曲线冲突（setValueCurveAtTime 与其它事件重叠会抛 NotSupportedError）。
   */
  set(id: ReverbId, ir: AudioBuffer, at: number, fade: number): void {
    if (this.current === id) return;
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const g = ctx.createGain();
    this.in.connect(conv);
    conv.connect(g);
    g.connect(this.out);
    if (this.slots.length === 0 || fade <= 0) {
      g.gain.value = 1;
      for (const s of this.slots) this.drop(s);
      this.slots = [{ conv, g, id, since: at }];
      return;
    }
    while (this.slots.length > 1) this.drop(this.slots.shift() as { conv: ConvolverNode; g: GainNode });
    const old = this.slots[0] as { g: GainNode };
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, at, fade / 4);
    old.g.gain.cancelScheduledValues(at);
    old.g.gain.setTargetAtTime(0, at, fade / 4);
    this.slots.push({ conv, g, id, since: at });
  }
  /** 淡变结束（再加上尾巴）之后断开旧的 Convolver。 */
  tidy(now: number): void {
    while (this.slots.length > 1) {
      const next = this.slots[1] as { since: number };
      if (now < next.since + 2.5) break;
      this.drop(this.slots.shift() as { conv: ConvolverNode; g: GainNode });
    }
  }
  private drop(s: { conv: ConvolverNode; g: GainNode }): void {
    try { this.in.disconnect(s.conv); } catch { /* 已断开 */ }
    try { s.g.disconnect(); } catch { /* 已断开 */ }
  }
}

export class Mixer {
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
  readonly compFix: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly limFix: GainNode;
  /** 软削波保险（见 safetyCurve）。 */
  readonly clip: WaveShaperNode;
  readonly revA: ReverbGroup;
  readonly revB: ReverbGroup;
  readonly rainIn: GainNode;
  readonly rainLp: BiquadFilterNode;
  readonly rainLevel: GainNode;
  private readonly buses = new Map<GateBus, Bus>();
  private folLp!: BiquadFilterNode;
  private folLevel!: GainNode;
  private folSend!: GainNode;
  private folMute!: Gate;
  private irCache = new Map<ReverbId, AudioBuffer>();
  /** 实测的补偿增益（dB）；未校准前用估计值。 */
  makeupDb = { comp: 6.3, limiter: 5.1, calibrated: false };

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, private readonly seed = 3) {
    this.master = gain(ctx, 1);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.knee.value = 6;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
    this.compFix = gain(ctx, Math.pow(10, -this.makeupDb.comp / 20));
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9; this.limiter.ratio.value = 20; this.limiter.knee.value = 0;
    this.limiter.attack.value = 0.001; this.limiter.release.value = 0.25;
    this.limFix = gain(ctx, Math.pow(10, -this.makeupDb.limiter / 20));
    this.clip = ctx.createWaveShaper();
    this.clip.curve = safetyCurve();
    this.clip.oversample = 'none';
    this.master.connect(this.comp); this.comp.connect(this.compFix); this.compFix.connect(this.limiter);
    this.limiter.connect(this.limFix); this.limFix.connect(this.clip); this.clip.connect(dest);

    this.revA = new ReverbGroup(ctx);
    this.revB = new ReverbGroup(ctx);
    for (const b of ALL_GATE_BUSES) {
      const g = gain(ctx, 1);
      const gate = new Gate(g.gain);
      g.connect(this.master);
      if (b === 'revA' || b === 'revB') {
        const grp = b === 'revA' ? this.revA : this.revB;
        grp.out.connect(g);
        this.buses.set(b, { in: grp.in, sendIn: null, gate, out: g });
        continue;
      }
      const input = gain(ctx, 1);
      if (b === 'follower') {
        this.folLp = ctx.createBiquadFilter();
        this.folLp.type = 'lowpass'; this.folLp.frequency.value = 2000; this.folLp.Q.value = -3.01;
        const mute = gain(ctx, 1);
        this.folMute = new Gate(mute.gain);
        this.folLevel = gain(ctx, 0);
        this.folSend = gain(ctx, 0);
        input.connect(this.folLp); this.folLp.connect(mute); mute.connect(this.folLevel); this.folLevel.connect(g);
        mute.connect(this.folSend); this.folSend.connect(this.revB.in);
        this.buses.set(b, { in: input, sendIn: null, gate, out: g });
        continue;
      }
      input.connect(g);
      let sendIn: GainNode | null = null;
      if (b === 'self' || b === 'sfx' || b === 'ui' || b === 'npc') {
        sendIn = gain(ctx, 1);
        sendIn.connect(b === 'npc' ? this.revB.in : this.revA.in);
      }
      this.buses.set(b, { in: input, sendIn, gate, out: g });
    }
    // 雨：自己的一条小链（露天 / 车里 / 室内），接进环境总线
    this.rainIn = gain(ctx, 1);
    this.rainLp = ctx.createBiquadFilter();
    this.rainLp.type = 'lowpass'; this.rainLp.frequency.value = 16000; this.rainLp.Q.value = -3.01;
    this.rainLevel = gain(ctx, 1);
    this.rainIn.connect(this.rainLp); this.rainLp.connect(this.rainLevel); this.rainLevel.connect(this.dry('ambience'));
  }

  dry(b: BusId): AudioNode { return (this.buses.get(b) as Bus).in; }
  send(b: BusId): AudioNode | null { return (this.buses.get(b) as Bus).sendIn; }
  gate(b: GateBus): Gate { return (this.buses.get(b) as Bus).gate; }
  get followerMute(): Gate { return this.folMute; }

  setVolumes(v: Volumes, at: number): void {
    const m = volumeGain(v.master), s = volumeGain(v.sfx), a = volumeGain(v.ambience);
    this.master.gain.setTargetAtTime(m, at, 0.03);
    for (const [b, bus] of this.buses) {
      if (b === 'revA' || b === 'revB') continue;
      const g = b === 'ambience' || b === 'floor' ? a : s;
      bus.in.gain.setTargetAtTime(g, at, 0.03);
      bus.sendIn?.gain.setTargetAtTime(g, at, 0.03);
    }
  }

  /** 追随者的四个声音通道：增益、低通、混响（声像由每个声部自己设），档位之间 300 ms 滑变（§2.6）。 */
  setFollower(m: FollowerMix, at: number, slide = 0.3): void {
    const tau = slide / 3;
    const g = m.audible ? Math.pow(10, m.gainDb / 20) : 0;
    this.folLevel.gain.cancelScheduledValues(at);
    this.folLevel.gain.setTargetAtTime(g, at, tau);
    this.folLp.frequency.cancelScheduledValues(at);
    this.folLp.frequency.setTargetAtTime(m.lowpass, at, tau);
    this.folSend.gain.cancelScheduledValues(at);
    this.folSend.gain.setTargetAtTime(m.audible ? m.reverb : 0, at, tau);
  }

  /** 雨声的听感位置。 */
  setRainExposure(kind: 'open' | 'bus' | 'indoor', at: number): void {
    const [f, l] = kind === 'open' ? [16000, 1] : kind === 'bus' ? [900, 0.8] : [500, 0.35];
    this.rainLp.frequency.cancelScheduledValues(at);
    this.rainLp.frequency.setTargetAtTime(f, at, 0.3);
    this.rainLevel.gain.cancelScheduledValues(at);
    this.rainLevel.gain.setTargetAtTime(l, at, 0.3);
  }

  irFor(id: ReverbId): AudioBuffer {
    const hit = this.irCache.get(id);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    const [l, r] = impulseResponse(REVERB_RT60[id], sr, this.seed + id.length * 31);
    const b = this.ctx.createBuffer(2, l.length, sr);
    b.copyToChannel(l, 0);
    b.copyToChannel(r, 1);
    this.irCache.set(id, b);
    return b;
  }

  /** 切换混响预设：两个 Convolver 交叉淡变 0.8 s（§6.1）。 */
  setReverb(id: ReverbId, at: number, fade = 0.8): void {
    const ir = this.irFor(id);
    this.revA.set(id, ir, at, fade);
    this.revB.set(id, ir, at, fade);
  }
  get reverb(): ReverbId | null { return this.revA.current; }
  tidy(now: number): void { this.revA.tidy(now); this.revB.tidy(now); }

  /** 量出两个压缩器的补偿增益，在它们后面乘倒数（见文件头注释）。 */
  async calibrate(makeOffline: MakeOffline): Promise<void> {
    const measure = async (setup: (c: DynamicsCompressorNode) => void): Promise<number> => {
      const sr = this.ctx.sampleRate;
      const n = Math.ceil(0.12 * sr);
      const oc = makeOffline(1, n, sr);
      const buf = oc.createBuffer(1, n, sr);
      const x = new Float32Array(n).fill(0.001);
      buf.copyToChannel(x, 0);
      const src = oc.createBufferSource();
      src.buffer = buf;
      const c = oc.createDynamicsCompressor();
      setup(c);
      src.connect(c); c.connect(oc.destination);
      src.start(0);
      const out = await renderOffline(oc);
      const y = out.getChannelData(0);
      let s = 0, k = 0;
      for (let i = Math.floor(n * 0.6); i < n; i++) { s += Math.abs(y[i] as number); k++; }
      const g = k ? s / k / 0.001 : 1;
      return Number.isFinite(g) && g > 0.1 && g < 10 ? 20 * Math.log10(g) : 0;
    };
    const comp = await measure((c) => { c.threshold.value = -14; c.ratio.value = 4; c.knee.value = 6; c.attack.value = 0.003; c.release.value = 0.25; });
    const lim = await measure((c) => { c.threshold.value = -9; c.ratio.value = 20; c.knee.value = 0; c.attack.value = 0.001; c.release.value = 0.25; });
    this.makeupDb = { comp, limiter: lim, calibrated: true };
    const at = this.ctx.currentTime;
    this.compFix.gain.setTargetAtTime(Math.pow(10, -comp / 20), at, 0.02);
    this.limFix.gain.setTargetAtTime(Math.pow(10, -lim / 20), at, 0.02);
  }
}
