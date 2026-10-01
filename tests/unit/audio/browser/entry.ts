// tests/unit/audio/browser/entry.ts —— 在无头 Chromium 里用真正的 OfflineAudioContext 跑 WP7 的验收场景。WP7。
// run.mjs 用 esbuild 把它打成一个 IIFE 注入空白页，调用 window.__wp7.all()，返回纯数字的报告（阈值判断在 run.mjs）。
// 同时把 Node 里用的最小实现（offline/mini.ts）也打进来，同一个库用两种实现各渲染一次逐键对比，确认 vitest 的数字可信。
import { biquadCoefs, biquadMagnitude, qDb, rmsOf, type BiquadType } from '../../../../src/audio/dsp';
import { makeMiniOffline } from '../offline/mini';
import * as S from '../scenarios';

const real: S.MakeCtx = (c, l, sr) => new OfflineAudioContext(c, l, sr);

/** BiquadFilterNode.getFrequencyResponse 与 dsp.biquadMagnitude（规范公式）的最大偏差（dB）。 */
function biquadCheck(sr: number): Array<{ type: BiquadType; f: number; q: number; maxErrDb: number }> {
  const oc = new OfflineAudioContext(1, 128, sr);
  const cases: Array<[BiquadType, number, number, number]> = [
    ['lowpass', 520, 0.7, 0], ['highpass', 900, 0.7071, 0], ['bandpass', 2200, 3, 0], ['bandpass', 1600, 10, 0],
    ['highshelf', 2500, 0.7071, 2], ['lowpass', 4500, 0.7071, 0], ['bandpass', 4500, 1.2, 0],
  ];
  const freqs = new Float32Array([60, 120, 250, 500, 1000, 2000, 3000, 4500, 7000, 10000, 15000]);
  const mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
  return cases.map(([type, f, q, g]) => {
    const n = oc.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.gain.value = g;
    const Q = type === 'lowpass' || type === 'highpass' ? qDb(q) : q;
    n.Q.value = Q;
    n.getFrequencyResponse(freqs, mag, ph);
    const c = biquadCoefs(type, f, Q, g, sr);
    let maxErrDb = 0;
    freqs.forEach((fr, i) => {
      const a = 20 * Math.log10(Math.max(1e-9, mag[i] as number)), b = 20 * Math.log10(Math.max(1e-9, biquadMagnitude(c, fr, sr)));
      if (Math.max(a, b) > -60) maxErrDb = Math.max(maxErrDb, Math.abs(a - b));
    });
    return { type, f, q, maxErrDb };
  });
}

async function all(sr: number): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  const lib = await S.buildLibrary(real, sr, true);
  const tLib = performance.now() - t0;
  const recipes = S.recipeReport(lib, sr).map((r) => ({ key: r.key, variant: r.variant, rawPeakDb: r.rawPeakDb, peakDb: r.peakDb, targetDb: r.targetDb, nonFinite: r.nonFinite, attackMs: r.attackMs, anomaly: r.anomaly }));
  // 同一个库用 Node 的最小实现再渲染一次（同样的随机数），逐键比较归一之前的 RMS（峰值对单次噪声实现太敏感）。
  const mini = await S.buildLibrary(makeMiniOffline, sr, true);
  const rmsDb = (d: Float32Array[]) => 20 * Math.log10(Math.max(1e-12, rmsOf(d)));
  const raw = new Map(lib.info.map((i) => [`${i.key}#${i.variant}`, rmsDb(i.data)]));
  const fidelity: Array<{ key: string; chrome: number; mini: number }> = [];
  const worst = { palm: { db: 0, key: '' }, other: { db: 0, key: '' } };
  for (const i of mini.info) {
    const k = `${i.key}#${i.variant}`;
    const c = raw.get(k) as number, m = rmsDb(i.data);
    fidelity.push({ key: k, chrome: c, mini: m });
    const w = i.key.startsWith('self:') || i.key.startsWith('follower:') ? worst.palm : worst.other;
    if (Math.abs(c - m) > w.db) { w.db = Math.abs(c - m); w.key = k; }
  }
  const out: Record<string, unknown> = { sampleRate: sr, libraryMs: tLib, recipes, fidelity, fidelityWorst: worst };
  out.beds = await S.bedReport(real, sr, lib);
  out.timing = await S.timingScenario(real, sr, lib);
  out.hush = await S.hushScenario(real, sr, lib);
  out.hushSelf = await S.hushScenario(real, sr, lib, true);
  out.quiet = await S.quietScenario(real, sr, lib);
  out.voices = await S.voicesScenario(real, sr, lib);
  out.perf = await S.perfScenario(real, sr, lib, 20);
  out.follower = await S.followerScenario(real, sr, lib);
  out.peak = await S.peakScenario(real, sr, lib);
  out.palm = await S.palmScenario(real, sr, lib);
  out.crowd = await S.crowdScenario(real, sr, lib);
  out.biquad = biquadCheck(sr);
  return out;
}

interface Demo { wavB64: string; png: string; zoom: string; marks: Array<[number, string]>; peakDb: number }
declare global { interface Window { __wp7: { all(sr: number): Promise<Record<string, unknown>>; demo(sr: number): Promise<Demo> } } }

/** 16 位 PCM 立体声 WAV（base64）。 */
function wavB64(L: Float32Array, R: Float32Array, sr: number): string {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round((L[i] as number) * 32767))), true);
    v.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round((R[i] as number) * 32767))), true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 近似 magma 的色带（黑 → 紫 → 橙 → 浅黄）。 */
function magma(d: number): [number, number, number] {
  const stops: Array<[number, number, number, number]> = [[0, 0, 0, 4], [0.25, 60, 15, 110], [0.5, 150, 40, 120], [0.75, 245, 110, 60], [1, 252, 245, 190]];
  for (let i = 1; i < stops.length; i++) {
    const [x1, r1, g1, b1] = stops[i] as [number, number, number, number], [x0, r0, g0, b0] = stops[i - 1] as [number, number, number, number];
    if (d <= x1) { const u = (d - x0) / (x1 - x0); return [r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u]; }
  }
  return [252, 245, 190];
}

/**
 * 对数频率轴的声谱图（50 Hz – 16 kHz，−96 到 −24 dBFS），画在 canvas 上返回 PNG dataURL；竖线标出各段的起点。
 * [t0, t1] 选时间段；N / hop 是 FFT 长度和步长（放大看三段声时用小的步长）。
 */
function spectrogram(x: Float32Array, sr: number, marks: Array<[number, string]>, t0 = 0, t1 = x.length / sr, N = 2048, hop = 256, W = 1400, H = 420): string {
  const i0 = Math.floor(t0 * sr), cols = Math.max(1, Math.floor((Math.min(x.length, Math.floor(t1 * sr)) - i0 - N) / hop));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(W, H);
  const re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N);
  let wsum = 0;
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); wsum += win[i] as number; }
  const f0 = 50, f1 = 16000;
  for (let px = 0; px < W; px++) {
    const c = Math.floor((px / W) * cols);
    for (let i = 0; i < N; i++) { re[i] = (x[i0 + c * hop + i] ?? 0) * (win[i] as number); im[i] = 0; }
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i] as number; re[i] = re[j] as number; re[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const ang = (-2 * Math.PI) / size;
      for (let s0 = 0; s0 < N; s0 += size) for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = s0 + k, b = a + size / 2;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi, xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr; im[b] = (im[a] as number) - xi; re[a] = (re[a] as number) + xr; im[a] = (im[a] as number) + xi;
      }
    }
    for (let py = 0; py < H; py++) {
      const f = f0 * Math.pow(f1 / f0, 1 - py / (H - 1));
      const k = Math.max(1, Math.min(N / 2 - 1, Math.round((f * N) / sr)));
      const amp = Math.sqrt((re[k] as number) ** 2 + (im[k] as number) ** 2) / (wsum / 2);
      const d = Math.max(0, Math.min(1, (20 * Math.log10(amp + 1e-12) + 96) / 72));
      const [r, gg, bb] = magma(d);
      const o = (py * W + px) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.fillStyle = '#fff'; g.font = '13px sans-serif';
  for (const [t, label] of marks) {
    if (t < t0 || t > t1) continue;
    const px = ((t - t0) / (t1 - t0)) * W;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.fillText(label, px + 4, 16);
  }
  for (const f of [100, 500, 1000, 2000, 5000, 10000]) { const py = (1 - Math.log(f / f0) / Math.log(f1 / f0)) * (H - 1); g.fillText(`${f >= 1000 ? f / 1000 + 'k' : f}`, 2, py); }
  return cv.toDataURL('image/png');
}

/**
 * 试听用的一段（约 14 s）：走廊里爬行 5 掌/s，追随者从稳度 3 一档档逼近到 0（每档 2.5 s），最后进入「嘘」。
 * 不是测试，只是给人听：run.mjs --demo 写成 WAV。
 */
async function demo(sr: number): Promise<Demo> {
  const lib = await S.buildLibrary(real, sr);
  const dur = 14;
  const { e, ctx } = await S.engineFor(real, sr, dur, lib, {}, { master: 80, sfx: 90, ambience: 70 });
  const marks: Array<[number, string]> = [];
  const steadyAt = (t: number) => (t < 3.5 ? 3 : t < 6 ? 2 : t < 8.5 ? 1 : 0);
  const lagOf = [0, 0.17, 0.33, 0.5];
  const H = 11.5;
  const S0 = (t: number) => { const s = steadyAt(t); return S.snap({ t, steady: s, follower: S.behind(lagOf[s] as number), hush: t >= H }); };
  e.frame(S0(0), 0);
  e.onEvent(S.ev('chapter:start', { id: 'test' }, 0), S0(0));
  e.onEvent(S.ev('segment', { id: 't-1', index: 0, kind: 'run' }, 0), S0(0));
  e.onAmbience('reading', 1, 0.5, S0(0));
  const cad = 5;
  const evs: Array<{ t: number; f: () => void }> = [];
  let i = 0;
  for (let t0 = 1.0; t0 < dur - 0.6; t0 += 1 / cad, i++) {
    const hand = i % 2 ? 'R' : 'L';
    const crisp = i % 4 === 0;
    for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
      const t = t0 + off;
      evs.push({ t, f: () => e.onEvent(S.ev('contact', { hand, part, t, s: 0, x: 0, surface: 'terrazzo', crisp: crisp && part === 'heel', heavy: false }, t), S0(S.tickUp(t))) });
      if (t0 >= 1.0) {
        const s = steadyAt(t0);
        const tf = t + (lagOf[s] as number) / cad;
        evs.push({ t: tf, f: () => e.onEvent(S.ev('followerContact', { hand, part, t: tf, lagBeats: lagOf[s] as number, steady: s, from: 'behind' }, tf), S0(S.tickUp(tf))) });
      }
    }
  }
  evs.push({ t: H - 0.05, f: () => e.onSfx('shush', -0.3, undefined, S0(H - 0.05)) });
  evs.sort((a, b) => a.t - b.t);
  let ft = 0;
  for (const x of evs) {
    while (ft + 1 / 60 < x.t) { ft += 1 / 60; e.frame(S0(ft), 1 / 60); }
    x.f();
  }
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S0(ft), 1 / 60); }
  const off = e.clock.offset as number;
  marks.push([1 + off, 'steady 3'], [3.5 + off, 'steady 2'], [6 + off, 'steady 1'], [8.5 + off, 'steady 0'], [H + off, 'hush']);
  const b = await ctx.startRendering();
  const L = b.getChannelData(0), R = b.getChannelData(1);
  const M = new Float32Array(L.length);
  let pk = 0;
  for (let i = 0; i < L.length; i++) { M[i] = ((L[i] as number) + (R[i] as number)) / 2; pk = Math.max(pk, Math.abs(L[i] as number), Math.abs(R[i] as number)); }
  // 放大：稳度 3 的两掌（三段 + 半拍后的回声），以及稳度 0 的两掌（合成一个声音）
  const zoomMarks: Array<[number, string]> = [];
  const z0 = 2.0 + off, z1 = z0 + 0.42, z2 = 9.6 + off, z3 = z2 + 0.42;
  const Z = new Float32Array(Math.ceil(0.84 * sr) + 1);
  Z.set(M.subarray(Math.floor(z0 * sr), Math.floor(z1 * sr)), 0);
  Z.set(M.subarray(Math.floor(z2 * sr), Math.floor(z3 * sr)), Math.floor(0.42 * sr));
  zoomMarks.push([0, 'steady 3'], [0.42, 'steady 0']);
  return { wavB64: wavB64(L, R, sr), png: spectrogram(M, sr, marks), zoom: spectrogram(Z, sr, zoomMarks, 0, 0.84, 512, 16), marks, peakDb: 20 * Math.log10(pk) };
}

window.__wp7 = { all, demo };
