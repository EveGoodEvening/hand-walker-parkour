// tests/unit/audio/scenarios.ts —— WP7 验收场景（DESIGN.md §8.10 WP7 验收 1–5、7）。WP7。
// 同一套场景既在 vitest 里用 Node 的最小 OfflineAudioContext（offline/mini.ts）跑，也在无头 Chromium 里用真正的
// OfflineAudioContext 跑（browser/run.mjs）。场景只负责「搭引擎、喂事件、渲染、测量」，返回数字；阈值判断在调用方。
import { Ambience, Hum, Rain, type AmbDeps } from '../../../src/audio/ambience';
import { attackTime, biquadCoefs, biquadRun, dbToGain, gainToDb, hasNonFinite, mulberry32, peakAbs, qDb, rmsOf } from '../../../src/audio/dsp';
import { LAG_BEATS } from '../../../src/core/constants';
import { AudioEngine, type EngineDeps } from '../../../src/audio/Engine';
import { NoiseBank } from '../../../src/audio/graph';
import { Mixer } from '../../../src/audio/mixer';
import { applauseLoop, renderOffline, renderOneShots, type ApplauseKind } from '../../../src/audio/library';
import type { OneShot } from '../../../src/audio/recipes/common';
import { allPalmKeys, palmRecipe } from '../../../src/audio/recipes/palm';
import { allOneShots, SFX, type GrainId } from '../../../src/audio/recipes/sfx';
import type { GameEvent, GameEventName, GameEvents } from '../../../src/core/events';
import type { Volumes } from '../../../src/core/contracts';
import type { AmbienceId, ContactPart, FollowerSnap, Hand, SimSnapshot, Surface } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';

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

// ——————————————————— 链路延迟 ———————————————————
/**
 * 整条输出链路的固定延迟（秒）：在一个只有 Mixer 的离线 context 里，往 sfx 总线送一个单样本脉冲，看它什么时候出来。
 * Chromium 的 DynamicsCompressor 有 6 ms 前瞻（两级 = 12 ms）；Node 的最小实现为 0。所有声音的延迟都一样，测时间窗时要扣掉。
 */
export async function chainLatency(make: MakeCtx, sr: number): Promise<number> {
  const oc = make(2, Math.ceil(0.1 * sr), sr);
  const ctx = oc as unknown as BaseAudioContext;
  const m = new Mixer(ctx, ctx.destination, 3);
  const b = ctx.createBuffer(1, 1, sr);
  b.copyToChannel(new Float32Array([0.1]), 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(m.dry('sfx'));
  src.start(0.02);
  const out = await renderOffline(oc);
  const x = out.getChannelData(0);
  let pk = 0, ip = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i] as number); if (v > pk) { pk = v; ip = i; } }
  return ip / sr - 0.02;
}

// ——————————————————— 验收 3：时间误差 ———————————————————
export interface TimingRow {
  key: string; kind: 'self' | 'follower'; part: ContactPart; triple: number; crisp: boolean;
  /** 模拟时刻换算到音频时钟（不含随机化）。 */
  nominal: number;
  /** 引擎实际排程的时刻（含随机化 ±4 ms）。 */
  logged: number;
  /** 渲染结果里用互相关定位到的时刻（已扣掉链路延迟）。 */
  measured: number;
}
export interface TimingReport { rows: TimingRow[]; latency: number; lagSec: number; offsets: number[] }

/**
 * 四掌三段声（两掌干脆、两掌不干脆），追随者在身后半拍（lagBeats 0.5）。自己和追随者分两次渲染（同一套模拟时间、同一个时钟偏移），
 * 免得追随者被自己的混响尾巴盖住、互相关找错位置。追随者的时间只取决于事件时间戳，与混音无关，所以这里用稳度 0 的混音
 * （低通 8 kHz、混响 0.2）让波形清楚可测——稳度 3 的 2 kHz 低通加 0.6 混响会把指节、指腹埋进掌根的尾巴里；参考波形同样过 8 kHz 低通。
 */
export async function timingScenario(make: MakeCtx, sr: number, lib: Lib): Promise<TimingReport> {
  const dur = 2.6;
  const cad = 4.8, lag = 0.5;
  const lagSec = lag / cad;
  const fol = behind(lag);
  const folSteady = 0;
  const latency = await chainLatency(make, sr);
  const palms: Array<{ t: number; hand: Hand; crisp: boolean }> = [
    { t: 0.4, hand: 'L', crisp: true }, { t: 0.83, hand: 'R', crisp: false }, { t: 1.26, hand: 'L', crisp: true }, { t: 1.69, hand: 'R', crisp: false },
  ];
  const rows: TimingRow[] = [];
  const offsets: number[] = [];
  for (const kind of ['self', 'follower'] as const) {
    const { e, ctx } = await engineFor(make, sr, dur, lib);
    interface Item { t: number; e: GameEvent; part: ContactPart; triple: number; crisp: boolean }
    const items: Item[] = [];
    palms.forEach((tr, triple) => {
      for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
        const t = tr.t + off;
        if (kind === 'self') items.push({ t, part, triple, crisp: tr.crisp, e: ev('contact', { hand: tr.hand, part, t, s: 0, x: 0, surface: 'terrazzo', crisp: tr.crisp && part === 'heel', heavy: false }, t) });
        else items.push({ t: t + lagSec, part, triple, crisp: true, e: ev('followerContact', { hand: tr.hand, part, t: t + lagSec, lagBeats: lag, steady: folSteady, from: 'behind' }, t + lagSec) });
      }
    });
    const S = (t: number) => snap({ t, follower: fol, steady: kind === 'follower' ? folSteady : 3 });
    e.frame(S(0), 0);
    let frameT = 0;
    for (const it of items) {
      while (frameT + 1 / 60 < it.t) { frameT += 1 / 60; e.frame(S(frameT), 1 / 60); }
      e.onEvent(it.e, S(tickUp(it.t)));
    }
    const off = e.clock.offset as number;
    offsets.push(off);
    const log = e.scheduled.filter((x) => x.key.startsWith(`${kind}:`));
    const out = await renderOffline(ctx);
    const mix = mono(out);
    const lp = kind === 'follower' ? biquadCoefs('lowpass', 8000, qDb(Math.SQRT1_2), 0, sr) : null;
    log.forEach((x, i) => {
      const it = items[i] as Item;
      let ref = x.buf as AudioBuffer;
      if (lp) { const y = biquadRun(ref.getChannelData(0), lp); const rb = { getChannelData: () => y } as unknown as AudioBuffer; ref = rb; }
      const measured = locate(ref, mix, sr, x.at + latency, 0.004) - latency;
      rows.push({ key: x.key, kind, part: it.part, triple: it.triple, crisp: it.crisp, nominal: it.t + off, logged: x.at, measured });
    });
  }
  return { rows, latency, lagSec, offsets };
}

// ——————————————————— 验收 4：静音段、安静的一秒 ———————————————————
export interface HushReport {
  /** 静音段开始（模拟时刻 1.6 s 换算到音频时钟）。 */
  hushAt: number;
  /** 开始前 0.65 s 的输出 RMS（dBFS）。 */
  preDb: number;
  /** 开始 0.3 s 之后到结束的输出 RMS（dBFS）。时间窗都扣掉链路的固定延迟。 */
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
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const at = (x: number) => Math.floor((x + lat) * sr);
  return {
    hushAt,
    preDb: db(rmsOf(chs, at(hushAt - 0.7), at(hushAt - 0.05))),
    postDb: db(rmsOf(chs, at(hushAt + 0.3), at(dur - 0.08))),
    gatesDb,
  };
}

export interface QuietReport { hitAt: number; preDb: number; edgeDb: number; cutDb: number; recoverDb: number; gateAt60Db: number | null }
/**
 * 人群段绊倒：「安静的一秒」。只开环境音量（sfx 音量 0，擦地声不进输出），环境是操场的远处人声（没有底噪层）。
 * edgeDb：受击后 60–70 ms 的输出；cutDb：0.1–1.0 s；recoverDb：恢复 0.6 s 之后。时间窗都扣掉链路的固定延迟。
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
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const at = (x: number) => Math.floor((x + lat) * sr);
  return {
    hitAt,
    preDb: db(rmsOf(chs, at(0.4), at(hitAt - 0.02))),
    edgeDb: db(rmsOf(chs, at(hitAt + 0.06), at(hitAt + 0.07))),
    cutDb: db(rmsOf(chs, at(hitAt + 0.1), at(hitAt + 1.0))),
    recoverDb: db(rmsOf(chs, at(hitAt + 1.06 + 0.6), at(hitAt + 1.06 + 1.6))),
    gateAt60Db,
  };
}

// ——————————————————— §6.2「正常人脚步「先轻后重」」：人群的脚步 ———————————————————
/** 一段 40 拍的跑段：左侧一群走动的人（walkers，0–18 拍，一个人），右道一双迎面走来的腿（34 拍，−1 m/s），另有一组排队的人（在远处）。 */
export const CROWD_CHAPTER: ChapterDef = {
  id: 'test', title: '测试', name: '人群', seed: 1, card: ['c1.card'], outro: { lines: [{ line: 'c1.out3' }] }, notes: [], requiredBeats: [],
  segments: [{
    id: 'c-1', kind: 'run', kit: 'placeholder', variant: 'default', atmosphere: 'morning', surface: 'terrazzo',
    beats: 40, stride: 1.0, cadence: 4.8, crowd: true, follower: { mode: 'hidden' },
    npcs: [
      { id: 'passing', kind: 'walkers', from: 0, to: 18, side: 'L', density: 0.2 },
      { id: 'seated', kind: 'seatedRow', from: 0, to: 40, side: 'R', density: 0.9 },   // 坐着的人不走路
      { id: 'line', kind: 'queue', from: 120, to: 140, side: 'both', density: 0.8 },    // 远处，听不见
    ],
    items: [{ at: 34, lane: 1, kind: 'legs', id: 'oncoming', behavior: { type: 'walk', speed: -1 } }],
    events: [],
  }],
};
/**
 * 和 WP2 第四章 4-3 / 4-4 同样排法的两段：站立段 1.8 s 同时有 crowd applaud 和 ambience dreamApplause（crowd 在前），
 * 4.4 s 换回 dream、crowd crawlOvertake（也是同一刻，环境音在前）；静场 5.4 s「掌声涌上来」。
 */
export const DREAM_CHAPTER: ChapterDef = {
  id: 'test', title: '测试', name: '梦', seed: 1, card: ['c1.card'], outro: { lines: [{ line: 'c1.out3' }] }, notes: [], requiredBeats: [],
  segments: [
    {
      id: 'd-3', kind: 'stand', kit: 'placeholder', variant: 'default', script: 'dream', atmosphere: 'morning', duration: 12, follower: { mode: 'absent' },
      events: [
        { at: 1.8, type: 'crowd', group: 'ring2', op: 'applaud' },
        { at: 1.8, type: 'ambience', amb: 'dreamApplause', level: 1, seconds: 1.0 },
        { at: 4.4, type: 'ambience', amb: 'dream', level: 1, seconds: 0.4 },
        { at: 4.4, type: 'crowd', group: 'imitators', op: 'crawlOvertake' },
      ],
    },
    {
      id: 'd-4', kind: 'still', set: 'placeholder', variant: 'default', atmosphere: 'morning', duration: 10, follower: { mode: 'behind' },
      events: [
        { at: 5.4, type: 'ambience', amb: 'dreamApplause', level: 1, seconds: 0.5 },
        { at: 6.4, type: 'ambience', amb: 'dream', level: 0.6, seconds: 0.4 },
      ],
    },
  ],
};

export interface CrowdReport {
  /** 引擎排程的每一步（音频时刻）。 */
  steps: Array<{ at: number; gainDb: number; pan: number; bus: string }>;
  offset: number;
  /** 人群段绊倒的音频时刻（模拟 2.0 s）。 */
  hitAt: number;
  /** 绊倒前 0.3–1.9 s 的输出 RMS（只开音效音量：输出里只有脚步和它们的混响）。 */
  stepsDb: number;
  /** 一步「先轻后重」：渲染出来的轻、重两声的峰值（dBFS）和间隔（ms），取第一步。 */
  lightDb: number; heavyDb: number; gapMs: number;
  /** 绊倒 60 ms 后 npc 总线的门（dB）；浏览器里为 null。 */
  npcGateDb: number | null;
}
/** 玩家以 4.8 拍/s 前进 6 s，模拟 2.0 s 时在人群里绊倒。环境音量 0（只听 npc 总线）。 */
export async function crowdScenario(make: MakeCtx, sr: number, lib: Lib): Promise<CrowdReport> {
  const dur = 6;
  const { e, ctx } = await engineFor(make, sr, dur, lib, { chapter: (id) => (id === 'test' ? CROWD_CHAPTER : getChapter(id)) },
    { master: 100, sfx: 100, ambience: 0 });
  const S = (t: number) => snap({ t, segBeat: t * 4.8 });
  e.frame(S(0), 0);
  e.onEvent(ev('segment', { id: 'c-1', index: 0, kind: 'run' }, 0), S(0));
  let ft = 0, hitAt = 0;
  while (ft + 1 / 60 < dur - 0.3) {
    ft += 1 / 60;
    e.frame(S(ft), 1 / 60);
    if (!hitAt && ft >= 2.0) {
      e.onEvent(ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 1, lane: 0, steady: 2, crowd: true, firstLegHit: false }, ft), S(ft));
      hitAt = ft + (e.clock.offset as number);
    }
  }
  const offset = e.clock.offset as number;
  const steps = e.scheduled.filter((x) => x.key === 'stepPair').map((x) => ({ at: x.at, gainDb: x.gainDb, pan: x.pan, bus: x.bus }));
  let npcGateDb: number | null = null;
  const p = (e.mixer as NonNullable<typeof e.mixer>).gate('npc').param as unknown as { valueAt?: (t: number) => number };
  if (typeof p.valueAt === 'function') npcGateDb = db(p.valueAt(hitAt + 0.06));
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const at = (x: number) => Math.floor((x + lat) * sr);
  const first = steps[0] as { at: number };
  const m = mono(out);
  const pk = (a: number, b: number) => { let v = 0, i0 = at(a); for (let i = i0; i < at(b); i++) { const x = Math.abs(m[i] as number); if (x > v) { v = x; i0 = i; } } return { v, t: i0 / sr - lat }; };
  const light = pk(first.at - 0.002, first.at + 0.03), heavy = pk(first.at + 0.06, first.at + 0.11);
  return {
    steps, offset, hitAt, stepsDb: db(rmsOf(chs, at(0.3 + offset), at(1.9 + offset))),
    lightDb: db(light.v), heavyDb: db(heavy.v), gapMs: (heavy.t - light.t) * 1000, npcGateDb,
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
 * 湿声（整个引擎，走廊混响 1.2 s）：三段在混音里的起点（互相关定位）、尾巴（掌后 150–700 ms）相对直达（0–80 ms）的能量比、
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
  const lat = await chainLatency(make, sr);
  const log = e.scheduled.filter((x) => x.key.startsWith('self:'));
  const out = await renderOffline(ctx);
  const m = mono(out);
  const pk = peakAbs([m]);
  const base = at0 + lat;
  // 三段的起点：在混音里用互相关定位各自的缓冲，相对掌根
  const pos = log.map((x) => locate(x.buf as AudioBuffer, m, sr, x.at + lat, 0.004));
  const onsetsMs = pos.map((p) => (p - (pos[0] as number)) * 1000);
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

// ——————————————————— 第 2 轮验收的修复：梦中掌声对齐、膝盖闷响只响一次、静音段 ———————————————————
export type ApplauseOrder = 'crowdFirst' | 'ambienceFirst' | 'none';
export interface ApplauseReport {
  /** 掌声起来 2.3–3.7 s 的输出：10 ms RMS 包络的最大值相对中位数（dB）。整齐的一片是一阵一阵的拍击，散的掌声是平的。 */
  pulseDb: number;
  /** 包络在 0.44 s（整齐掌声的周期）处的归一化自相关。 */
  periodicity: number;
  rmsDb: number;
  /** 引擎锁存的掌声状态。 */
  applause: { density: number; align: number };
}
/**
 * 4-3：同一 tick 内 crowd applaud 与 ambience dreamApplause（两种顺序；Game 先调 cue 处理器、再调 onEvent），
 * 对照没有 crowd cue 的缺省掌声（稀疏 / 稠密各半）。只开环境音量。
 */
export async function applauseScenario(make: MakeCtx, sr: number, lib: Lib, order: ApplauseOrder): Promise<ApplauseReport> {
  const dur = 4.4, T = 0.5;
  const { e, ctx } = await engineFor(make, sr, dur, lib, {}, { master: 100, sfx: 0, ambience: 100 });
  const S = (t: number) => snap({ t });
  e.frame(S(0), 0);
  let ft = 0;
  while (ft + 1 / 60 < T) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const crowd = () => e.onEvent(ev('cue', { body: { type: 'crowd', group: 'ring2', op: 'applaud' }, segment: 't-1' }, T), S(T));
  const amb = () => {
    e.onAmbience('dreamApplause', 1, 1.0, S(T));
    e.onEvent(ev('cue', { body: { type: 'ambience', amb: 'dreamApplause', level: 1, seconds: 1 }, segment: 't-1' }, T), S(T));
  };
  if (order === 'crowdFirst') { crowd(); amb(); } else if (order === 'ambienceFirst') { amb(); crowd(); } else amb();
  const at0 = T + (e.clock.offset as number);
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const applause = (e.stats() as { applause: { density: number; align: number } }).applause;
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const m = mono(out);
  const a = Math.floor((at0 + 2.3 + lat) * sr), b = Math.floor((at0 + 3.7 + lat) * sr), hop = Math.floor(0.01 * sr);
  const env: number[] = [];
  for (let i = a; i + hop <= b; i += hop) env.push(rmsOf([m], i, i + hop));
  const sorted = [...env].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)] as number, mx = sorted[sorted.length - 1] as number;
  const mean = env.reduce((s, x) => s + x, 0) / env.length;
  const d = env.map((x) => x - mean);
  const lag = Math.round(0.44 / 0.01);
  let c0 = 0, c1 = 0;
  for (let i = 0; i < d.length; i++) c0 += (d[i] as number) ** 2;
  for (let i = 0; i + lag < d.length; i++) c1 += (d[i] as number) * (d[i + lag] as number);
  return { pulseDb: db(mx) - db(med), periodicity: c0 > 0 ? (c1 / (d.length - lag)) / (c0 / d.length) : 0, rmsDb: db(rmsOf([m], a, b)), applause };
}

export type KneeMode = 'cue' | 'standFallThenCue' | 'fallThenCue';
export interface KneeReport { count: number; buses: string[]; lowDb: number; rmsDb: number }
/**
 * 5-8 第七步：Sim 在第 n tick 发 stand fall，第 n+1 tick 发关卡的 sfx kneeThud。膝盖闷响只能排一次——
 * 同一个缓冲相隔 8.3 ms 正好是 60 Hz 的半个周期，两遍会把主体抵消掉。lowDb：40–90 Hz 频段的 RMS（掌后 0.7 s）。
 */
export async function kneeScenario(make: MakeCtx, sr: number, lib: Lib, mode: KneeMode): Promise<KneeReport> {
  const dur = 1.6, t = 0.5, t2 = t + 1 / 120;
  const { e, ctx } = await engineFor(make, sr, dur, lib, {}, { master: 80, sfx: 90, ambience: 0 });
  e.frame(snap({ t: 0 }), 0);
  if (mode === 'standFallThenCue') e.onEvent(ev('stand', { phase: 'fall', step: 7, theta: 0 }, t), snap({ t }));
  if (mode === 'fallThenCue') e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, t), snap({ t }));
  e.onSfx('kneeThud', undefined, undefined, snap({ t: t2 }));
  const at0 = t + (e.clock.offset as number);
  const knees = e.scheduled.filter((x) => x.key === 'kneeThud');
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const m = mono(out);
  const low = biquadRun(biquadRun(m, biquadCoefs('lowpass', 90, qDb(Math.SQRT1_2), 0, sr)), biquadCoefs('highpass', 40, qDb(Math.SQRT1_2), 0, sr));
  const a = Math.floor((at0 + lat) * sr), b = Math.floor((at0 + lat + 0.7) * sr);
  return { count: knees.length, buses: knees.map((x) => x.bus), lowDb: db(rmsOf([low], a, b)), rmsDb: db(rmsOf([m], a, b)) };
}

export interface HushFallReport {
  /** 静音段之前、之中（0.4 s 之后）房间底噪的输出（dBFS）。 */
  roomPreDb: number; roomHushDb: number;
  /** 摔倒后 0.5 s 的输出（dBFS）：膝盖闷响。 */
  kneeDb: number;
  /** 排在 floor 上的追随者三段声（「两串节拍合一」）的个数。 */
  mergedFollower: number;
  /** 摔倒 0.1 s 后 floor / floorSfx 两个门（dB）；浏览器里为 null。 */
  floorGateDb: number | null; floorSfxGateDb: number | null;
}
/** 静音段里摔倒（3-4 的静音段里有 3 个必需动作）：房间底噪门掉了，膝盖闷响仍然听得见；追随者本来就听不见，所以不「合一」。 */
export async function hushFallScenario(make: MakeCtx, sr: number, lib: Lib): Promise<HushFallReport> {
  const dur = 2.2, H = 0.5, F = 1.3;
  const { e, ctx } = await engineFor(make, sr, dur, lib, {}, FULL);
  const fol = behind(0);
  const S = (t: number) => snap({ t, follower: fol, steady: t >= F ? 0 : 1, hush: t >= H });
  e.frame(S(0), 0);
  e.onAmbience('room', 1, 0.05, S(0));
  let ft = 0;
  while (ft + 1 / 60 < F) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, F), S(F));
  while (ft + 1 / 60 < dur) { ft += 1 / 60; e.frame(S(ft), 1 / 60); }
  const off = e.clock.offset as number, fallAt = F + off;
  const mixer = e.mixer as NonNullable<typeof e.mixer>;
  const va = (b: 'floor' | 'floorSfx') => (mixer.gate(b).param as unknown as { valueAt?: (t: number) => number }).valueAt;
  const gate = (b: 'floor' | 'floorSfx') => { const f = va(b); return typeof f === 'function' ? db(f.call(mixer.gate(b).param, fallAt + 0.1)) : null; };
  const lat = await chainLatency(make, sr);
  const out = await renderOffline(ctx);
  const chs = [out.getChannelData(0), out.getChannelData(1)];
  const at = (x: number) => Math.floor((x + lat) * sr);
  return {
    roomPreDb: db(rmsOf(chs, at(off + 0.1), at(off + H - 0.05))),
    roomHushDb: db(rmsOf(chs, at(off + H + 0.4), at(fallAt - 0.05))),
    kneeDb: db(rmsOf(chs, at(fallAt), at(fallAt + 0.5))),
    mergedFollower: e.scheduled.filter((x) => x.key.startsWith('follower:') && x.bus === 'floor').length,
    floorGateDb: gate('floor'), floorSfxGateDb: gate('floorSfx'),
  };
}

export interface HushSfxReport {
  /** 铃（音效总线，混响发送 0.6）：静音段之前；静音段开始 0.3 s 之后；同一时间窗不进静音段的对照；静音段 1 s 之后（dBFS）。 */
  bellPreDb: number; bellPostDb: number; bellRefPostDb: number; bellLateDb: number;
  /** 静音段开始 0.3 s 后音效总线的门（dB）；浏览器里为 null。 */
  sfxGateDb: number | null;
  /** 「嘘」与静音段同一刻（1-6）：嘘本身 0.1–0.7 s 的输出（dBFS）和它走的总线。 */
  shushDb: number; shushBus: string;
}
/**
 * 静音段也门掉音效总线和它的混响发送（§3「除了你自己的掌声，所有声音……降到 0」）：干声 0.3 s 内降到 0，不再往混响里送；
 * 静音段之前已经送进房间混响的那一点尾巴按房间的衰减时间自然消失（和自己掌声的尾巴一样）。
 * 「嘘」是静音段的开头，不被掐掉。三次渲染（铃、不进静音段的铃、嘘）。
 */
export async function hushSfxScenario(make: MakeCtx, sr: number, lib: Lib): Promise<HushSfxReport> {
  const dur = 2.6, H = 1.0;
  const run = async (hush: boolean, f: (e: AudioEngine, S: (t: number) => SimSnapshot) => void, fAt: number) => {
    const S = (t: number) => snap({ t, hush: hush && t >= H });
    const { e, ctx } = await engineFor(make, sr, dur, lib, {}, FULL);
    e.frame(S(0), 0);
    let ft = 0, done = false;
    while (ft + 1 / 60 < dur) {
      if (!done && ft + 1 / 60 >= fAt) { f(e, S); done = true; }
      ft += 1 / 60;
      e.frame(S(ft), 1 / 60);
    }
    const off = e.clock.offset as number;
    const va = (e.mixer as NonNullable<typeof e.mixer>).gate('sfx').param as unknown as { valueAt?: (t: number) => number };
    const gate = typeof va.valueAt === 'function' ? db(va.valueAt(H + off + 0.3)) : null;
    const lat = await chainLatency(make, sr);
    const out = await renderOffline(ctx);
    const chs = [out.getChannelData(0), out.getChannelData(1)];
    const r = (a: number, b: number) => db(rmsOf(chs, Math.floor((a + off + lat) * sr), Math.floor((b + off + lat) * sr)));
    return { e, gate, r };
  };
  const bell = (e: AudioEngine, S: (t: number) => SimSnapshot) => e.onBell('morning', S(0.2));
  const hushed = await run(true, bell, 0.2);
  const ref = await run(false, bell, 0.2);
  const shush = await run(true, (e, S) => e.onSfx('shush', undefined, undefined, S(H)), H);
  return {
    bellPreDb: hushed.r(H - 0.5, H - 0.05), bellPostDb: hushed.r(H + 0.3, dur - 0.2), bellRefPostDb: ref.r(H + 0.3, dur - 0.2),
    bellLateDb: hushed.r(H + 1.0, dur - 0.2), sfxGateDb: hushed.gate,
    shushDb: shush.r(H + 0.1, H + 0.7), shushBus: shush.e.scheduled.find((x) => x.key === 'shush')?.bus ?? 'none',
  };
}
