// tests/unit/audio/scenarios.ts —— WP7 验收场景（DESIGN.md §8.10 WP7 验收 1–5、7）。WP7。
// 同一套场景既在 vitest 里用 Node 的最小 OfflineAudioContext（offline/mini.ts）跑，也在无头 Chromium 里用真正的
// OfflineAudioContext 跑（browser/run.mjs）。场景只负责「搭引擎、喂事件、渲染、测量」，返回数字；阈值判断在调用方。
import { Ambience, Hum, Rain, type AmbDeps } from '../../../src/audio/ambience';
import { attackTime, biquadCoefs, biquadRun, dbToGain, gainToDb, hasNonFinite, mulberry32, peakAbs, qDb, rmsOf } from '../../../src/audio/dsp';
import { LAG_BEATS } from '../../../src/core/constants';
import { AudioEngine, type EngineDeps } from '../../../src/audio/Engine';
import { NoiseBank } from '../../../src/audio/graph';
import { applauseLoop, renderOffline, renderOneShots, type ApplauseKind } from '../../../src/audio/library';
import type { OneShot } from '../../../src/audio/recipes/common';
import { allPalmKeys, palmRecipe } from '../../../src/audio/recipes/palm';
import { allOneShots, SFX, type GrainId } from '../../../src/audio/recipes/sfx';
import type { GameEvent, GameEventName, GameEvents } from '../../../src/core/events';
import type { Volumes } from '../../../src/core/contracts';
import type { AmbienceId, ContactPart, FollowerSnap, Hand, SimSnapshot, Surface } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';

export type MakeCtx = (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
export interface Lib { palms: Map<string, AudioBuffer[]>; sfx: Map<string, AudioBuffer[]> }

// ——————————————————— 快照与事件 ———————————————————
export const FOLLOWER_NONE: FollowerSnap = { mode: 'hidden', voice: 'none', hud: 'none', from: 'behind', lagBeats: 0, distance: 0, leaderS: null, leaderLane: null };
export function behind(lagBeats: number): FollowerSnap {
  return { mode: 'behind', voice: 'echo', hud: 'dots', from: 'behind', lagBeats, distance: 0, leaderS: null, leaderLane: null };
}

export interface SnapOpts { t: number; steady?: number; surface?: Surface; follower?: FollowerSnap; hush?: boolean; segIndex?: number; segBeat?: number; speed?: number; chapter?: 'ch1' | 'test' }
export function snap(o: SnapOpts): SimSnapshot {
  const steady = o.steady ?? 3;
  return {
    tick: Math.round(o.t * 120), t: o.t, chapter: o.chapter ?? 'test', segment: 't-1', segIndex: o.segIndex ?? 0, segKind: 'run', segBeat: o.segBeat ?? o.t * 4.8,
    checkpoint: { segment: 't-1', beat: 0 },
    player: {
      s: o.t * 5, x: 0, y: 0, floorY: 0, lane: 0, laneTarget: 0, mode: 'crawl', modeT: 0, speed: o.speed ?? 4.8, cadence: 4.8, stride: 1,
      beat: o.t * 4.8, airT: 0, duck: 0, twitch: 0, drift: 0, steady, steadyMax: 3, graceT: 0, surface: o.surface ?? 'terrazzo',
      hitbox: { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }, lookBack: 0, carrying: 'none', stand: null,
    },
    follower: o.follower ?? FOLLOWER_NONE, still: null, hush: o.hush ?? false, flip: false, slowOption: false,
    stats: { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, beatsFired: [],
  };
}
export function ev<K extends GameEventName>(type: K, data: GameEvents[K], t: number): GameEvent {
  return { type, tick: Math.round(t * 120), data } as GameEvent;
}
/** 模拟时间对齐到 tick（事件总在它所在 tick 的末尾发出）。 */
export const tickUp = (t: number): number => Math.ceil(t * 120 - 1e-9) / 120;

// ——————————————————— 库与引擎 ———————————————————
export async function buildLibrary(make: MakeCtx, sr: number, keepData = false): Promise<Lib & { info: Awaited<ReturnType<typeof renderOneShots>>['info'] }> {
  const target = make(1, 128, sr) as unknown as BaseAudioContext;
  const palms = allPalmKeys().map((k) => palmRecipe(k)).filter((r): r is OneShot => !!r);
  const p = await renderOneShots(target, make, palms, { seed: 5, batchSec: 12, keepData });
  const s = await renderOneShots(target, make, allOneShots(), { seed: 6, batchSec: 12, keepData });
  return { palms: p.buffers, sfx: s.buffers, info: [...p.info, ...s.info] };
}

/** 测试缺省把三个音量都开到 100（最坏情况；设置里的缺省是 80 / 90 / 70）。 */
export const FULL: Volumes = { master: 100, sfx: 100, ambience: 100 };

export async function engineFor(make: MakeCtx, sr: number, dur: number, lib: Lib, extra: Partial<EngineDeps> = {}, volumes: Volumes = FULL): Promise<{ e: AudioEngine; ctx: OfflineAudioContext }> {
  let ctx: OfflineAudioContext | null = null;
  const e = new AudioEngine({
    createContext: () => { ctx = make(2, Math.ceil(dur * sr), sr); return ctx as unknown as BaseAudioContext; },
    makeOffline: make, offline: true, preload: lib, seed: 11, chapter: (id) => getChapter(id), ...extra,
  });
  e.setVolumes(volumes);
  await e.unlock();
  await e.ready;
  return { e, ctx: ctx as unknown as OfflineAudioContext };
}

function mono(b: AudioBuffer): Float32Array {
  const n = b.length, out = new Float32Array(n);
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (d[i] as number) / b.numberOfChannels; }
  return out;
}
const db = (x: number): number => gainToDb(Math.max(1e-12, x));

/** 在 mix 里 approx ± win 秒内用归一化互相关找 buf（前 30 ms）出现的位置（秒，亚样本插值）。 */
export function locate(buf: AudioBuffer, mix: Float32Array, sr: number, approx: number, win = 0.012): number {
  const x = buf.getChannelData(0);
  const n = Math.min(x.length, Math.floor(0.03 * sr));
  let ex = 0;
  for (let i = 0; i < n; i++) ex += (x[i] as number) ** 2;
  const lo = Math.max(0, Math.floor((approx - win) * sr)), hi = Math.min(mix.length - n - 1, Math.ceil((approx + win) * sr));
  const cs: number[] = [];
  let best = -Infinity, bi = lo;
  for (let L = lo; L <= hi; L++) {
    let c = 0, em = 0;
    for (let i = 0; i < n; i++) { const m = mix[L + i] as number; c += (x[i] as number) * m; em += m * m; }
    const v = em > 0 ? c / Math.sqrt(ex * em) : 0;
    cs.push(v);
    if (v > best) { best = v; bi = L; }
  }
  const k = bi - lo;
  const a = cs[k - 1], b = cs[k], c = cs[k + 1];
  let frac = 0;
  if (a !== undefined && b !== undefined && c !== undefined) { const d = a - 2 * b + c; if (d < 0) frac = (0.5 * (a - c)) / d; }
  return (bi + frac) / sr;
}

// ——————————————————— 验收 1、2：配方 ———————————————————
export interface RecipeRow { key: string; variant: number; rawPeakDb: number; peakDb: number; targetDb: number; nonFinite: boolean; attackMs: number | null; anomaly: boolean }
export function recipeReport(lib: Awaited<ReturnType<typeof buildLibrary>>, sr: number): RecipeRow[] {
  const all = new Map<string, OneShot>();
  for (const k of allPalmKeys()) { const r = palmRecipe(k); if (r) all.set(r.key, r); }
  for (const r of allOneShots()) all.set(r.key, r);
  const rows: RecipeRow[] = [];
  for (const inf of lib.info) {
    const r = all.get(inf.key) as OneShot;
    const buf = (lib.palms.get(inf.key) ?? lib.sfx.get(inf.key))?.[inf.variant] as AudioBuffer;
    const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    rows.push({
      key: inf.key, variant: inf.variant, rawPeakDb: inf.rawPeakDb, peakDb: db(peakAbs(chs)), targetDb: r.peakDb,
      nonFinite: inf.nonFinite || hasNonFinite(chs), attackMs: r.anomaly ? attackTime(chs, sr) * 1000 : null, anomaly: !!r.anomaly,
    });
  }
  return rows;
}

// ——————————————————— 验收 1：环境音、雨、嗡鸣 ———————————————————
export interface BedRow { id: string; rmsDb: number; peakDb: number; nonFinite: boolean }
export const AMBIENCES: readonly AmbienceId[] = ['room', 'reading', 'canteen', 'labWind', 'nightCorridor', 'rainStreet', 'shedRoof', 'bus', 'home',
  'dream', 'dreamApplause', 'dawnStreet', 'field', 'infirmary', 'void'];

export async function bedReport(make: MakeCtx, sr: number, lib: Lib, dur = 3): Promise<BedRow[]> {
  const rows: BedRow[] = [];
  const run = async (id: string, setup: (d: AmbDeps) => (until: number) => void) => {
    const oc = make(2, Math.ceil(dur * sr), sr);
    const bctx = oc as unknown as BaseAudioContext;
    const rng = mulberry32(3);
    const loops = new Map<ApplauseKind, AudioBuffer>();
    const d: AmbDeps = {
      ctx: bctx, noise: new NoiseBank(bctx, 9), rng, amb: bctx.destination, floor: bctx.destination,
      grain: (g: GrainId, at: number, gdb: number, pan: number, dest?: AudioNode) => {
        const bufs = lib.sfx.get(g);
        const b = bufs?.[Math.floor(rng() * bufs.length)];
        if (!b) return;
        const s = bctx.createBufferSource(); s.buffer = b;
        const gn = bctx.createGain(); gn.gain.value = dbToGain(gdb);
        const p = bctx.createStereoPanner(); p.pan.value = pan;
        s.connect(gn); gn.connect(p); p.connect(dest ?? bctx.destination); s.start(at);
      },
      loop: (k) => {
        let b = loops.get(k);
        if (!b) { const [l, r] = applauseLoop(k, sr, 4); b = bctx.createBuffer(2, l.length, sr); b.copyToChannel(l, 0); b.copyToChannel(r, 1); loops.set(k, b); }
        return b;
      },
    };
    const adv = setup(d);
    adv(dur);
    const out = await renderOffline(oc);
    const chs = Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c));
    rows.push({ id, rmsDb: db(rmsOf(chs, Math.floor(0.6 * sr))), peakDb: db(peakAbs(chs)), nonFinite: hasNonFinite(chs) });
  };
  for (const id of AMBIENCES) {
    await run(`ambience:${id}`, (d) => {
      const a = new Ambience(d, id, 0);
      a.fadeTo(1, 0, 0.01);
      a.param('rain', 0.6, 0);
      a.param('speed', 9.6, 0);
      return (u) => a.advance(u);
    });
  }
  await run('rain:1', (d) => { const r = new Rain(d, d.amb); r.set(1, 0, 0.01); return (u) => r.advance(u); });
  await run('hum:1', (d) => { const h = new Hum(d, d.amb); h.set(1, 0, 0.01); return () => undefined; });
  return rows;
}

// ——————————————————— 验收 3：时间误差 ———————————————————
export interface TimingRow {
  key: string; kind: 'self' | 'follower'; part: ContactPart; triple: number; crisp: boolean;
  /** 模拟时刻换算到音频时钟（不含随机化）。 */
  nominal: number;
  /** 引擎实际排程的时刻（含随机化 ±4 ms）。 */
  logged: number;
  /** 渲染结果里用互相关定位到的时刻。 */
  measured: number;
}
export interface TimingReport { rows: TimingRow[]; latency: number; lagSec: number }

/**
 * 四掌三段声（两掌干脆、两掌不干脆）加追随者（身后，稳度 3 = 半拍），离线渲染后逐个定位。
 * latency：整条链路的固定延迟（Chromium 的压缩器有前瞻预延迟），以第一个掌根为准，所有声音都一样。
 */
export async function timingScenario(make: MakeCtx, sr: number, lib: Lib): Promise<TimingReport> {
  const dur = 2.6;
  const { e, ctx } = await engineFor(make, sr, dur, lib);
  const cad = 4.8, lag = 0.5;
  const lagSec = lag / cad;
  const fol = behind(lag);
  const palms: Array<{ t: number; hand: Hand; crisp: boolean }> = [
    { t: 0.4, hand: 'L', crisp: true }, { t: 0.83, hand: 'R', crisp: false }, { t: 1.26, hand: 'L', crisp: true }, { t: 1.69, hand: 'R', crisp: false },
  ];
  interface Item { t: number; e: GameEvent; kind: 'self' | 'follower'; part: ContactPart; triple: number; crisp: boolean }
  const items: Item[] = [];
  palms.forEach((tr, triple) => {
    for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
      const t = tr.t + off;
      items.push({ t, kind: 'self', part, triple, crisp: tr.crisp, e: ev('contact', { hand: tr.hand, part, t, s: 0, x: 0, surface: 'terrazzo', crisp: tr.crisp && part === 'heel', heavy: false }, t) });
      const tf = t + lagSec;
      items.push({ t: tf, kind: 'follower', part, triple, crisp: true, e: ev('followerContact', { hand: tr.hand, part, t: tf, lagBeats: lag, steady: 3, from: 'behind' }, tf) });
    }
  });
  items.sort((a, b) => a.t - b.t);
  e.frame(snap({ t: 0, follower: fol }), 0);
  let frameT = 0;
  for (const it of items) {
    while (frameT + 1 / 60 < it.t) { frameT += 1 / 60; e.frame(snap({ t: frameT, follower: fol }), 1 / 60); }
    e.onEvent(it.e, snap({ t: tickUp(it.t), follower: fol }));
  }
  const off = e.clock.offset as number;
  const log = e.scheduled.filter((x) => x.key.startsWith('self:') || x.key.startsWith('follower:'));
  const out = await renderOffline(ctx);
  const mix = mono(out);
  const rows: TimingRow[] = [];
  const selfItems = items.filter((i) => i.kind === 'self'), folItems = items.filter((i) => i.kind === 'follower');
  let si = 0, fi = 0;
  // 先粗定位第一个掌根，得到链路延迟；之后每个声音都在「排程时刻 + 延迟」附近找
  const first = log[0] as (typeof log)[number];
  const latency = locate(first.buf as AudioBuffer, mix, sr, first.at + 0.006, 0.02) - first.at;
  for (const x of log) {
    const it = (x.key.startsWith('self:') ? selfItems[si++] : folItems[fi++]) as Item;
    const measured = locate(x.buf as AudioBuffer, mix, sr, x.at + latency, 0.004) - latency;
    rows.push({ key: x.key, kind: it.kind, part: it.part, triple: it.triple, crisp: it.crisp, nominal: it.t + off, logged: x.at, measured });
  }
  return { rows, latency, lagSec };
}

// ——————————————————— 验收 4：静音段、安静的一秒 ———————————————————
export interface HushReport {
  /** 静音段开始（模拟时刻 1.6 s 换算到音频时钟）。 */
  hushAt: number;
  /** 开始前 0.65 s 的输出 RMS（dBFS）。 */
  preDb: number;
  /** 开始 0.3 s 之后到结束的输出 RMS（dBFS）。 */
  postDb: number;
  /** 0.3 s 时各总线门的增益（dB）；只有 Node 的最小实现能读 AudioParam 的任意时刻，浏览器里为 null。 */
  gatesDb: Record<string, number> | null;
}

/**
 * 环境（朗读 + 房间底噪）、追随者（稳度 0，最响）、NPC（高跟鞋）同时在响；模拟时刻 1.6 s 进入静音段。
 * withSelf：只放自己的掌声（同样的静音段），用来确认「只保留自己的掌声」。
 */
export async function hushScenario(make: MakeCtx, sr: number, lib: Lib, withSelf = false): Promise<HushReport> {
  const dur = 3.2;
  const { e, ctx } = await engineFor(make, sr, dur, lib);
  const fol = withSelf ? FOLLOWER_NONE : behind(0);
  const H = 1.6;
  const S = (t: number) => snap({ t, follower: fol, steady: 0, hush: t >= H });
  e.frame(S(0), 0);
  if (!withSelf) e.onAmbience('reading', 1, 0.05, S(0));
  const evs: Array<{ t: number; f: () => void }> = [];
  for (let t = 0.1; t < dur - 0.3; t += 0.21) {
    for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
      const tt = t + off;
      if (withSelf) evs.push({ t: tt, f: () => e.onEvent(ev('contact', { hand: 'R', part, t: tt, s: 0, x: 0, surface: 'terrazzo', crisp: true, heavy: false }, tt), S(tickUp(tt))) });
      else evs.push({ t: tt, f: () => e.onEvent(ev('followerContact', { hand: 'L', part, t: tt, lagBeats: 0, steady: 0, from: 'behind' }, tt), S(tickUp(tt))) });
    }
  }
  if (!withSelf) for (const t of [0.3, 1.0, 1.9]) evs.push({ t, f: () => e.onSfx('heels', undefined, undefined, S(t)) });
  evs.sort((a, b) => a.t - b.t);
  let ft = 0;
  for (const x of evs) {
    while (ft + 1 / 60 < x.t) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
    x.f();
  }
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const hushAt = H + (e.clock.offset as number);
  let gatesDb: Record<string, number> | null = null;
  const mixer = e.mixer as NonNullable<typeof e.mixer>;
  const probe = mixer.gate('ambience').param as unknown as { valueAt?: (t: number) => number };
  if (typeof probe.valueAt === 'function') {
    gatesDb = {};
    for (const b of ['follower', 'npc', 'ambience', 'floor', 'revB', 'self', 'revA'] as const) {
      gatesDb[b] = db((mixer.gate(b).param as unknown as { valueAt: (t: number) => number }).valueAt(hushAt + 0.3));
    }
  }
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  return {
    hushAt,
    preDb: db(rmsOf(chs, Math.floor((hushAt - 0.7) * sr), Math.floor((hushAt - 0.05) * sr))),
    postDb: db(rmsOf(chs, Math.floor((hushAt + 0.3) * sr), Math.floor((dur - 0.05) * sr))),
    gatesDb,
  };
}

export interface QuietReport { hitAt: number; preDb: number; edgeDb: number; cutDb: number; recoverDb: number; gateAt60Db: number | null }
/**
 * 人群段绊倒：「安静的一秒」。只开环境音量（sfx 音量 0，擦地声不进输出），环境是操场的远处人声（没有底噪层）。
 * edgeDb：受击后 60–70 ms 的输出；cutDb：0.1–1.0 s；recoverDb：恢复 0.6 s 之后。
 */
export async function quietScenario(make: MakeCtx, sr: number, lib: Lib): Promise<QuietReport> {
  const dur = 3.6;
  const { e, ctx } = await engineFor(make, sr, dur, lib, {}, { master: 100, sfx: 0, ambience: 100 });
  const S = (t: number) => snap({ t });
  e.frame(S(0), 0);
  e.onAmbience('field', 1, 0.05, S(0));
  let ft = 0, hitAt = 0;
  while (ft + 1 / 60 < dur) {
    ft += 1 / 60;
    e.frame(S(ft), 1 / 60);
    if (!hitAt && ft >= 1.0) {
      e.onEvent(ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 1, lane: 0, steady: 2, crowd: true, firstLegHit: false }, ft), S(ft));
      hitAt = ft + (e.clock.offset as number);
    }
  }
  let gateAt60Db: number | null = null;
  const p = (e.mixer as NonNullable<typeof e.mixer>).gate('ambience').param as unknown as { valueAt?: (t: number) => number };
  if (typeof p.valueAt === 'function') gateAt60Db = db(p.valueAt(hitAt + 0.06));
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const at = (x: number) => Math.floor(x * sr);
  return {
    hitAt,
    preDb: db(rmsOf(chs, at(0.4), at(hitAt - 0.02))),
    edgeDb: db(rmsOf(chs, at(hitAt + 0.06), at(hitAt + 0.07))),
    cutDb: db(rmsOf(chs, at(hitAt + 0.1), at(hitAt + 1.0))),
    recoverDb: db(rmsOf(chs, at(hitAt + 1.06 + 0.6), at(hitAt + 1.06 + 1.6))),
    gateAt60Db,
  };
}

// ——————————————————— 验收 5：声部上限 ———————————————————
export interface VoicesReport { requested: number; maxSeen: number; stolen: number; dropped: number; renderedMax: number | null }
/** 0.3 s 内塞进 90 个自己的触地、60 个音效和一场大雨。 */
export async function voicesScenario(make: MakeCtx, sr: number, lib: Lib): Promise<VoicesReport> {
  const dur = 1.2;
  const { e, ctx } = await engineFor(make, sr, dur, lib);
  const S = (t: number) => snap({ t });
  e.frame(S(0), 0);
  e.onEvent(ev('cue', { body: { type: 'rain', intensity: 1, seconds: 0.05 }, segment: 't-1' }, 0), S(0));
  let n = 0;
  for (let i = 0; i < 90; i++) {
    const t = 0.1 + i * 0.0033;
    e.onEvent(ev('contact', { hand: i % 2 ? 'L' : 'R', part: (['heel', 'knuckle', 'pad'] as const)[i % 3] as 'heel', t, s: 0, x: 0, surface: 'tile', crisp: false, heavy: false }, t), S(tickUp(t)));
    n++;
    if (i % 3 === 0) { e.onSfx((['paper', 'cloth', 'splash', 'drip'] as const)[(i / 3) % 4] as 'paper', 0, 1, S(tickUp(t))); n++; }
    if (i % 5 === 0) e.frame(S(tickUp(t)), 1 / 60);
  }
  for (let t = 0.4; t < dur; t += 1 / 60) e.frame(S(t), 1 / 60);
  const out = await renderOffline(ctx);
  void out;
  const rm = (ctx as unknown as { maxOneShots?: number }).maxOneShots;
  return { requested: n, maxSeen: e.voices.maxSeen, stolen: e.voices.stolen, dropped: e.voices.dropped, renderedMax: typeof rm === 'number' ? rm : null };
}

// ——————————————————— 验收 7：主线程开销 ———————————————————
export interface PerfReport { frames: number; avgFrameMs: number; maxFrameMs: number; events: number }
/** 20 s 的第三章式负载：5.4 掌/s 的三段声 + 追随者 + 食堂环境音 + 雨 + 嗡鸣，60 fps 调 frame()。只排程，不渲染。 */
export async function perfScenario(make: MakeCtx, sr: number, lib: Lib, secs = 20): Promise<PerfReport> {
  const { e } = await engineFor(make, sr, secs + 1, lib);
  const fol = behind(0.33);
  const S = (t: number) => snap({ t, follower: fol, steady: 2, surface: 'asphaltWet' });
  e.frame(S(0), 0);
  e.onAmbience('canteen', 1, 0.5, S(0));
  e.onEvent(ev('cue', { body: { type: 'rain', intensity: 0.6, seconds: 1 }, segment: 't-1' }, 0), S(0));
  const cad = 5.4;
  let events = 0;
  let nextBeat = 0.2, beatI = 0;
  const pend: Array<{ t: number; f: (s: SimSnapshot) => void }> = [];
  for (let t = 0; t < secs; t += 1 / 60) {
    while (nextBeat <= t) {
      const hand: Hand = beatI++ % 2 ? 'R' : 'L';
      for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
        const tt = nextBeat + off;
        pend.push({ t: tt, f: (s) => e.onEvent(ev('contact', { hand, part, t: tt, s: 0, x: 0, surface: 'asphaltWet', crisp: false, heavy: false }, tt), s) });
        const tf = tt + 0.33 / cad;
        pend.push({ t: tf, f: (s) => e.onEvent(ev('followerContact', { hand, part, t: tf, lagBeats: 0.33, steady: 2, from: 'behind' }, tf), s) });
      }
      nextBeat += 1 / cad;
    }
    pend.sort((a, b) => a.t - b.t);
    while (pend.length && (pend[0] as { t: number }).t <= t) { (pend.shift() as { f: (s: SimSnapshot) => void }).f(S(t)); events++; }
    e.frame(S(t), 1 / 60);
  }
  const st = e.stats();
  return { frames: st.frames as number, avgFrameMs: st.avgFrameMs as number, maxFrameMs: st.maxFrameMs as number, events };
}

// ——————————————————— lead 补充 1：追随者的逼近听得出来 ———————————————————
export interface FollowerRow { steady: number; lagBeats: number; rmsDb: number; brightDb: number; widthDb: number; tailDb: number }

/** 能量比（dB）。 */
const ratioDb = (a: number, b: number): number => 10 * Math.log10(Math.max(1e-20, a) / Math.max(1e-20, b));
function energy(x: Float32Array, from: number, to: number): number {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) { const v = x[i] as number; e += v * v; }
  return e;
}

/**
 * 稳度 3 → 0，只放追随者（身后）的三段声，逐掌测：电平、亮度（3 kHz 以上能量占比）、声像宽度（侧 / 中能量比）、
 * 混响量（掌后 150–420 ms 的尾巴 / 直达 0–70 ms）。四个声音通道应当随稳度下降单调地「更响、更亮、更窄、更干」。
 */
export async function followerScenario(make: MakeCtx, sr: number, lib: Lib): Promise<FollowerRow[]> {
  const rows: FollowerRow[] = [];
  for (const steady of [3, 2, 1, 0]) {
    const dur = 2.6;
    const { e, ctx } = await engineFor(make, sr, dur, lib);
    const lag = LAG_BEATS.behind[steady] as number;
    const fol = behind(lag);
    const S = (t: number) => snap({ t, follower: fol, steady });
    const times = [0.3, 0.75, 1.2, 1.65, 2.1];
    e.frame(S(0), 0);
    let ft = 0;
    const evs: Array<{ t: number; f: () => void }> = [];
    times.forEach((t0, i) => {
      for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
        const t = t0 + off;
        evs.push({ t, f: () => e.onEvent(ev('followerContact', { hand: i % 2 ? 'R' : 'L', part, t, lagBeats: lag, steady, from: 'behind' }, t), S(tickUp(t))) });
      }
    });
    for (const x of evs) {
      while (ft + 1 / 60 < x.t) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
      x.f();
    }
    while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
    const off = e.clock.offset as number;
    const out = await renderOffline(ctx);
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const M = new Float32Array(L.length), Sd = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) { M[i] = ((L[i] as number) + (R[i] as number)) / 2; Sd[i] = ((L[i] as number) - (R[i] as number)) / 2; }
    const hp = biquadRun(M, biquadCoefs('highpass', 3000, qDb(0.7071), 0, sr));
    let eD = 0, eS = 0, eHp = 0, eTail = 0, n = 0;
    for (const t0 of times) {
      const a0 = Math.floor((t0 + off) * sr), a1 = Math.floor((t0 + off + 0.07) * sr);
      eD += energy(M, a0, a1); eS += energy(Sd, a0, a1); eHp += energy(hp, a0, a1); n += a1 - a0;
      eTail += energy(M, Math.floor((t0 + off + 0.15) * sr), Math.floor((t0 + off + 0.42) * sr));
    }
    rows.push({ steady, lagBeats: lag, rmsDb: ratioDb(eD / n, 1), brightDb: ratioDb(eHp, eD), widthDb: ratioDb(eS, eD), tailDb: ratioDb(eTail, eD) });
  }
  return rows;
}

// ——————————————————— lead 补充 2：全作峰值 ≤ −8 dBFS ———————————————————
export interface PeakReport { peakDb: number; rmsDb: number; nonFinite: boolean; voices: number }
/**
 * 最坏情况：三个音量都是 100；同一时刻所有总线都在响——食堂环境音、大雨、灯管嗡鸣、稳度 0 的追随者（和自己同拍）、
 * 每 0.25 s 一次双手撑跃落地（干脆，最响的掌根）、十种音效同时触发、2.6 s 摔倒（膝盖闷响 + 两串节拍合一）。
 * 测整个输出（经过压缩器和限幅器）的峰值。
 */
export async function peakScenario(make: MakeCtx, sr: number, lib: Lib): Promise<PeakReport> {
  const dur = 4;
  const { e, ctx } = await engineFor(make, sr, dur, lib);
  const fol = behind(0);
  const S = (t: number) => snap({ t, follower: fol, steady: 0, surface: 'terrazzo' });
  e.frame(S(0), 0);
  e.onEvent(ev('chapter:start', { id: 'test' }, 0), S(0));
  e.onEvent(ev('segment', { id: 't-1', index: 0, kind: 'run' }, 0), S(0));
  e.onAmbience('canteen', 1, 0.05, S(0));
  e.onEvent(ev('cue', { body: { type: 'rain', intensity: 1, seconds: 0.05 }, segment: 't-1' }, 0), S(0));
  const evs: Array<{ t: number; f: () => void }> = [];
  for (let t0 = 0.2; t0 < 2.5; t0 += 0.25) {
    for (const [hand, d] of [['L', 0], ['R', 0.012]] as const) {
      for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
        const t = t0 + d + off;
        evs.push({ t, f: () => e.onEvent(ev('contact', { hand, part, t, s: 0, x: 0, surface: 'terrazzo', crisp: part === 'heel', heavy: true }, t), S(tickUp(t))) });
        evs.push({ t, f: () => e.onEvent(ev('followerContact', { hand, part, t, lagBeats: 0, steady: 0, from: 'behind' }, t), S(tickUp(t))) });
      }
    }
  }
  const sfx = ['heels', 'kneeThud', 'waterBreak', 'doorClose', 'bucketKnock', 'tap', 'drip', 'whistle', 'chairScrape', 'monitorSteps'] as const;
  for (const id of sfx) evs.push({ t: 0.7, f: () => e.onSfx(id, undefined, undefined, S(0.7)) });
  evs.push({ t: 0.7, f: () => e.onBell('morning', S(0.7)) });
  evs.push({ t: 1.4, f: () => e.onEvent(ev('hit', { severity: 'crash', kind: 'bin', obstacleId: 2, lane: 0, steady: 1, crowd: false, firstLegHit: false }, 1.4), S(1.4)) });
  evs.push({ t: 2.6, f: () => e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 2.6), S(2.6)) });
  evs.sort((a, b) => a.t - b.t);
  let ft = 0;
  for (const x of evs) {
    while (ft + 1 / 60 < x.t) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
    x.f();
  }
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  return { peakDb: db(peakAbs(chs)), rmsDb: db(rmsOf(chs)), nonFinite: hasNonFinite(chs), voices: e.voices.maxSeen };
}

// ——————————————————— lead 补充 1：三段落地声的音色（「像有人在空房间里鼓掌」）———————————————————
export interface PalmPartRow { key: string; part: ContactPart; centroidHz: number; lowShare: number; t40Ms: number }
export interface PalmReport { parts: PalmPartRow[]; onsetsMs: number[]; tailDb: number; t60Ms: number }

/** 实数信号的功率谱质心（Hz），零填充到 2 的幂做 FFT。 */
export function centroid(x: Float32Array, sr: number): number {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] as number;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i] as number; re[i] = re[j] as number; re[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    for (let s0 = 0; s0 < n; s0 += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = s0 + k, b = a + size / 2;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi, xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr; im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr; im[a] = (im[a] as number) + xi;
      }
    }
  }
  let num = 0, den = 0;
  for (let k = 1; k < n / 2; k++) { const p = (re[k] as number) ** 2 + (im[k] as number) ** 2; num += p * (k * sr) / n; den += p; }
  return den > 0 ? num / den : 0;
}

/**
 * 干声（库里的缓冲）：每段的谱质心、600 Hz 以下的能量占比、从峰值衰减到 −40 dB 的时间。
 * 湿声（整个引擎，走廊混响 1.2 s）：三段的起点（包络峰）、尾巴（掌后 150–700 ms）相对直达（0–80 ms）的能量比、
 * 输出从峰值落到 −60 dB 的时间。
 */
export async function palmScenario(make: MakeCtx, sr: number, lib: Lib): Promise<PalmReport> {
  const parts: PalmPartRow[] = [];
  for (const part of ['heel', 'knuckle', 'pad'] as const) {
    const key = `self:terrazzo:${part}`;
    const b = (lib.palms.get(key) as AudioBuffer[])[0] as AudioBuffer;
    const x = b.getChannelData(0);
    const lp = biquadRun(x, biquadCoefs('lowpass', 600, qDb(0.7071), 0, b.sampleRate));
    const pk = peakAbs([x]);
    const last = lastAboveIdx(x, pk * dbToGain(-40));
    let ip = 0;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i] as number) === pk) { ip = i; break; }
    parts.push({ key, part, centroidHz: centroid(x, b.sampleRate), lowShare: energy(lp, 0, lp.length) / Math.max(1e-20, energy(x, 0, x.length)), t40Ms: ((last - ip) / b.sampleRate) * 1000 });
  }
  const dur = 2.0;
  const { e, ctx } = await engineFor(make, sr, dur, lib);
  const S = (t: number) => snap({ t });
  e.frame(S(0), 0);
  e.onEvent(ev('chapter:start', { id: 'test' }, 0), S(0));
  e.onEvent(ev('segment', { id: 't-1', index: 0, kind: 'run' }, 0), S(0));   // 占位 kit → 走廊混响（1.2 s）
  const t0 = 0.5;
  let ft = 0;
  for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
    const t = t0 + off;
    while (ft + 1 / 60 < t) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
    e.onEvent(ev('contact', { hand: 'L', part, t, s: 0, x: 0, surface: 'terrazzo', crisp: part === 'heel', heavy: false }, t), S(tickUp(t)));
  }
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const at0 = t0 + (e.clock.offset as number);
  const out = await renderOffline(ctx);
  const m = mono(out);
  // 粗略的链路延迟：输出第一次越过峰值 −30 dB 的位置
  const pk = peakAbs([m]);
  let first = 0;
  for (let i = 0; i < m.length; i++) if (Math.abs(m[i] as number) >= pk * dbToGain(-30)) { first = i; break; }
  const lat = Math.max(0, first / sr - at0);
  const base = at0 + lat;
  // 三段的起点：分别在 0 / 26 / 52 ms 附近 ±8 ms 找 1 ms RMS 包络的最大上升沿
  const env = (i0: number) => energy(m, i0, i0 + Math.round(0.001 * sr));
  const onsetsMs: number[] = [];
  for (const nom of [0, 0.026, 0.052]) {
    let best = -Infinity, bi = 0;
    for (let d = -0.008; d <= 0.008; d += 1 / sr) {
      const i = Math.floor((base + nom + d) * sr);
      const rise = env(i) - env(i - Math.round(0.002 * sr));
      if (rise > best) { best = rise; bi = i; }
    }
    onsetsMs.push((bi / sr - base) * 1000);
  }
  const direct = energy(m, Math.floor(base * sr), Math.floor((base + 0.08) * sr));
  const tail = energy(m, Math.floor((base + 0.15) * sr), Math.floor((base + 0.7) * sr));
  const last = lastAboveIdx(m, pk * dbToGain(-60));
  return { parts, onsetsMs, tailDb: ratioDb(tail, direct), t60Ms: (last / sr - base) * 1000 };
}

function lastAboveIdx(x: Float32Array, thr: number): number {
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i] as number) >= thr) return i;
  return -1;
}

/** 各配方的峰值目标一览（报告里用）。 */
export function sfxTargets(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, r] of Object.entries(SFX)) o[k] = r.peakDb;
  return o;
}
