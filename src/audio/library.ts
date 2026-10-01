// src/audio/library.ts —— 预渲染声音库（DESIGN.md §6.1「预渲染」）。WP7。
// 解锁音频时，用 OfflineAudioContext 把一次性配方（手掌三段声、音效、铃、颗粒）排在一条时间线上分批渲染，
// 再切片、去掉静音尾巴、把峰值归一到配方表的 dBFS，得到 AudioBuffer 库；运行时只播放 AudioBufferSourceNode。
import { biquadCoefs, biquadRun, dbToGain, gainToDb, hasNonFinite, lastAbove, makeLoopable, mulberry32, peakAbs, whiteNoise, type F32 } from './dsp';
import { NoiseBank } from './graph';
import type { OneShot } from './recipes/common';

export type MakeOffline = (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** 渲染一个离线 context（兼容老 Safari 的 oncomplete 写法）。 */
export function renderOffline(oc: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let done = false;
    const finish = (b: AudioBuffer) => { if (!done) { done = true; resolve(b); } };
    oc.oncomplete = (e: OfflineAudioCompletionEvent) => finish(e.renderedBuffer);
    try {
      const p = oc.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(finish, reject);
    } catch (err) { reject(err); }
  });
}

/** 一个配方渲染出来的原始数据与归一信息（测试用）。 */
export interface RenderInfo { key: string; variant: number; rawPeakDb: number; nonFinite: boolean; length: number; data: Float32Array[] }
export interface Library { buffers: Map<string, AudioBuffer[]>; info: RenderInfo[] }

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 预渲染一组一次性配方。target：最终播放用的 context（AudioBuffer 由它创建）。
 * 按声道数分组，每批最多 batchSec 秒，排在同一条时间线上渲染一次。
 */
export async function renderOneShots(target: BaseAudioContext, makeOffline: MakeOffline, list: readonly OneShot[],
  opts: { seed?: number; batchSec?: number; keepData?: boolean } = {}): Promise<Library> {
  const sr = target.sampleRate;
  const seed = opts.seed ?? 1;
  const batchSec = opts.batchSec ?? 10;
  const lib: Library = { buffers: new Map(), info: [] };
  interface Slot { r: OneShot; v: number; start: number; len: number }
  for (const channels of [1, 2] as const) {
    const items = list.filter((r) => r.channels === channels);
    let batch: Slot[] = [];
    let cursor = 0;
    const flush = async () => {
      if (!batch.length) return;
      const oc = makeOffline(channels, cursor, sr);
      const bank = new NoiseBank(oc, seed + 11);
      for (const s of batch) {
        const rng = mulberry32((hashKey(s.r.key) ^ (seed * 7919)) + s.v * 104729);
        s.r.build({ ctx: oc, out: oc.destination, t0: s.start / sr, rng, noise: bank });
      }
      const rendered = await renderOffline(oc);
      const chs: Float32Array[] = [];
      for (let c = 0; c < rendered.numberOfChannels; c++) chs.push(rendered.getChannelData(c));
      for (const s of batch) {
        const slice = chs.map((x) => x.subarray(s.start, s.start + s.len));
        const buf = finishSlot(target, slice, s.r, lib, s.v, opts.keepData ?? false);
        const arr = lib.buffers.get(s.r.key) ?? [];
        arr[s.v] = buf;
        lib.buffers.set(s.r.key, arr);
      }
      batch = [];
      cursor = 0;
    };
    for (const r of items) {
      const len = Math.ceil((r.dur + 0.03) * sr);
      for (let v = 0; v < r.variants; v++) {
        if (cursor > 0 && cursor + len > batchSec * sr) await flush();
        batch.push({ r, v, start: cursor, len });
        cursor += len;
      }
    }
    await flush();
  }
  return lib;
}

/** 切片 → 去尾 → 淡出 → 峰值归一 → 目标 context 的 AudioBuffer。 */
function finishSlot(target: BaseAudioContext, slice: Float32Array[], r: OneShot, lib: Library, v: number, keep: boolean): AudioBuffer {
  const sr = target.sampleRate;
  const peak = peakAbs(slice);
  const nonFinite = hasNonFinite(slice);
  const minLen = Math.ceil(0.004 * sr);
  const last = peak > 0 ? lastAbove(slice, peak * dbToGain(-70)) : minLen;
  const fadeN = Math.ceil(0.002 * sr);
  const len = Math.max(minLen, Math.min(slice[0]?.length ?? minLen, last + 1 + fadeN));
  const k = peak > 0 && !nonFinite ? dbToGain(r.peakDb) / peak : 0;
  const buf = target.createBuffer(slice.length, len, sr);
  const kept: Float32Array[] = [];
  slice.forEach((x, c) => {
    const y = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const fade = i >= len - fadeN ? (len - i) / fadeN : 1;
      y[i] = (x[i] ?? 0) * k * fade;
    }
    buf.copyToChannel(y, c);
    if (keep) kept.push(x.slice());
  });
  lib.info.push({ key: r.key, variant: v, rawPeakDb: gainToDb(peak), nonFinite, length: len, data: kept });
  return buf;
}

// ——————————————————— 梦中掌声（颗粒循环）———————————————————
export type ApplauseKind = 'sparse' | 'dense' | 'aligned';

/**
 * 梦中掌声（§6.2）：用手掌三段声做颗粒——掌根（低通）加指腹（带通），每秒 40（sparse）/ 200（dense）个；
 * aligned = 颗粒聚到一个整齐的节拍上（「像雷声，像掌声」）。整体低通 1.5 kHz，峰值 −14 dBFS，立体声，可无缝循环。
 * 颗粒数量太多（上千个），在 JS 里直接合成比搭上千个节点便宜；这里只生成缓冲，播放仍是原生节点。
 */
export function applauseLoop(kind: ApplauseKind, sampleRate: number, seed: number, secs = 6): [F32, F32] {
  const rng = mulberry32(seed + (kind === 'sparse' ? 1 : kind === 'dense' ? 2 : 3));
  const n = Math.floor((secs + 0.4) * sampleRate);
  const L = new Float32Array(n), R = new Float32Array(n);
  // 16 个颗粒波形
  const bank: Float32Array[] = [];
  const glen = Math.floor(0.09 * sampleRate);
  for (let g = 0; g < 16; g++) {
    const w = whiteNoise(glen, rng);
    const heel = biquadRun(w, biquadCoefs('lowpass', 500 + rng() * 300, -3, 0, sampleRate));
    const pad = biquadRun(whiteNoise(glen, rng), biquadCoefs('bandpass', 1300 + rng() * 1200, 1.2, 0, sampleRate));
    const off = Math.floor((0.02 + rng() * 0.03) * sampleRate);
    const y = new Float32Array(glen);
    for (let i = 0; i < glen; i++) {
      const t = i / sampleRate;
      const a = 4 * Math.exp(-t / 0.018) * (heel[i] as number);
      const j = i - off;
      const b = j >= 0 ? 2.5 * Math.exp(-(j / sampleRate) / 0.012) * (pad[j] ?? 0) : 0;
      y[i] = a + b;
    }
    bank.push(y);
  }
  const place = (t: number, amp: number) => {
    const i0 = Math.floor(t * sampleRate);
    const src = bank[Math.floor(rng() * bank.length)] as Float32Array;
    const pan = rng() * 1.8 - 0.9;
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4), gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < src.length && i0 + i < n; i++) {
      if (i0 + i < 0) continue;
      L[i0 + i] = (L[i0 + i] as number) + (src[i] as number) * gl;
      R[i0 + i] = (R[i0 + i] as number) + (src[i] as number) * gr;
    }
  };
  if (kind === 'aligned') {
    const period = 0.44;
    for (let t = 0.02; t < secs + 0.3; t += period) {
      for (let k = 0; k < 90; k++) {
        const u = (rng() + rng() + rng() - 1.5) * 0.018;         // 近似高斯的时间散布
        place(t + u, 0.4 + 0.6 * rng());
      }
    }
  } else {
    const rate = kind === 'sparse' ? 40 : 200;
    for (let t = -Math.log(1 - rng()) / rate; t < secs + 0.3; t += -Math.log(1 - rng()) / rate) place(t, 0.4 + 0.6 * rng());
  }
  const lp = biquadCoefs('lowpass', 1500, -3, 0, sampleRate);
  const outL = makeLoopable(biquadRun(L, lp), Math.floor(0.4 * sampleRate));
  const outR = makeLoopable(biquadRun(R, lp), Math.floor(0.4 * sampleRate));
  const pk = peakAbs([outL, outR]);
  const k = pk > 0 ? dbToGain(-14) / pk : 0;
  for (const x of [outL, outR]) for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) * k;
  return [outL, outR];
}
