// src/audio/Engine.ts —— WebAudio 实现的 AudioAPI（DESIGN.md §6、§8.7「事件与 cue 的唯一处理者」中 WP7 的部分）。WP7。
//
// 只依赖事件和快照（§8.10 WP7）：
//   contact → 自己的三段声（预渲染库，按模拟时间戳前瞻 50 ms 调度）；followerContact → 追随者（混音按稳度与模式，§2.6）；
//   hit → 擦地 / 闷响，人群段「安静的一秒」；fall → 膝盖闷响、节拍合一、环境掐断、其余淡出；lookBack → 追随者静音 1.2 s；
//   twitch / drift → 肌肉声；stand → 自己的「先轻后重」（§8.7；5-8 第七步的膝盖闷响由关卡的 sfx cue 负责）；ask → 低语与短笑；
//   快照 hush → 静音段；segment → 混响、环境音、人群的脚步（crowd.ts：walkers / queue 组和 walk 的腿，npc 总线）；
//   crowd 的 applaud / crawlOvertake / normal → 梦中掌声对齐与否（锁存，dreamApplause 新建时立即应用）。
//   bell / sfx / ambience / silence 四种 cue 由 index.ts 注册的处理器转到这里。
// AudioContext 在第一次 pointerdown / keydown（Game 调 unlock）时才创建；之前只维护「期望状态」并记录 cue。
// 解锁不只试一次（U3）：context 没在运行（第一次 resume 被拒、iOS 来电打断、系统意外挂起）时，引擎自己在 window 上挂
// pointerup / touchend / click / keydown，每次手势里同步地播一段静音 buffer 并 resume()，确认 running 之后才摘掉。
// 屏幕：结尾卡、演职卡淡出所有声音（第四章结尾卡的床单声例外，走界面总线）；回到标题时换成标题的底噪（U3）。
// 挂起（§6.1「暂停和失焦时 ctx.suspend()」）有两个来源，任何一个成立就挂起，两个都清掉才恢复：
//   Game 的暂停（suspend()；离开暂停 / 设置屏幕时也视为结束——Game 从暂停菜单「重来」「回到标题」时不调 suspend(false)）；
//   窗口失焦或标签页隐藏（background()，index.ts 监听 blur / focus / visibilitychange，任何屏幕都生效）。
import type { AudioAPI, LampFieldAPI, Volumes } from '../core/contracts';
import { FlatLampField } from '../core/fallbacks';
import type { GameEvent, GameEvents } from '../core/events';
import type { AmbienceId, BellKind, ChapterId, ContactPart, Hand, ReverbId, SfxId, SimSnapshot, Surface } from '../core/types';
import type { ChapterDef, EventBody } from '../levels/schema';
import { Ambience, Hum, Rain, type AmbDeps } from './ambience';
import { SimClock } from './clock';
import { CrowdSteps } from './crowd';
import { CueLog, cueNames } from './cueLog';
import { dbToGain, mulberry32 } from './dsp';
import { followerMix, mixKey, SILENT_MIX } from './follower';
import { NoiseBank } from './graph';
import { applauseLoop, renderOneShots, type ApplauseKind, type MakeOffline } from './library';
import { LightModel } from './lights';
import { ALL_GATE_BUSES, Mixer, type FollowerMix, type GateBus } from './mixer';
import type { AudioImpl } from './NullAudio';
import { APPLAUSE_DEFAULT, applauseAfter, placeOf, soundStateAt, type AmbState, type ApplauseState, type KitLookup, type Place } from './places';
import { rr, type BusId, type OneShot } from './recipes/common';
import { allPalmKeys, palmKeyString, palmRecipe, partsOf, type PalmKey } from './recipes/palm';
import { BELL_SFX, SFX, allOneShots, type GrainId, type OneShotId } from './recipes/sfx';
import { VoicePool } from './voices';

export interface EngineDeps {
  /** 创建实时 AudioContext（在 unlock 里、用户手势之内调用）。 */
  createContext(): BaseAudioContext;
  makeOffline: MakeOffline;
  /** true：context 是 OfflineAudioContext（测试）——不 resume，「现在」由模拟时间换算。 */
  offline?: boolean;
  seed?: number;
  /** WP3 的 LampField（经 index.ts 注册的探针 ViewSystem 拿到）。 */
  lamps?: () => LampFieldAPI | null;
  chapter?: (id: ChapterId) => ChapterDef | null;
  kitLookup?: KitLookup;
  perfNow?: () => number;
  /** 已经渲染好的库（同一采样率）：跳过预渲染。测试里多个引擎共用一份；将来重建 AudioContext 时也可复用。 */
  preload?: { palms: Map<string, AudioBuffer[]>; sfx: Map<string, AudioBuffer[]> };
  /** 解锁手势的监听目标（index.ts 传 window）。没有就只靠 Game 的那一次 unlock。 */
  gestures?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * 静音段（§3「除了你自己的掌声，所有声音（包括雨和追随者）0.3 s 内降到 0」）：音效总线连同它的混响发送也门掉。
 * 不门 floorSfx——在静音段里摔倒，膝盖闷响照样听得见（§2.7）。「嘘」本身走自己的总线（见 onSfx）。
 */
const HUSH_BUSES: readonly GateBus[] = ['follower', 'npc', 'ambience', 'floor', 'sfx', 'revB'];
/** 静默 cue（5-5「全部声音静音 1 s」与椅子刮擦同一刻）：不门音效总线，刮擦声要响完。 */
const SILENCE_BUSES: readonly GateBus[] = ['ambience', 'floor', 'npc', 'follower', 'revB'];
const FAIL_BUSES: readonly GateBus[] = ['self', 'follower', 'npc', 'sfx', 'ui', 'revA', 'revB'];
const GLASS_BUSES: readonly GateBus[] = ['self', 'follower', 'npc', 'ambience', 'floor', 'floorSfx', 'ui', 'revB'];
const SCREEN_BUSES: readonly GateBus[] = ['self', 'follower', 'npc', 'sfx', 'ambience', 'floor', 'floorSfx', 'revA', 'revB'];
/** 不受静音段门影响的音效：「嘘」是静音段的开头（1-6 里和 hush 同一刻），走自己的总线。 */
const HUSH_EXEMPT_SFX = new Set<SfxId>(['shush']);
/**
 * 结尾卡、演职卡上照样要听得见的音效：第四章结尾卡每按一下 ↓ 在床单上响的一声（Game.outroInput 发 sfx cloth，
 * §4.4、§10.2）。cloth 平时走 npc 总线，屏幕门会把它压到 −70 dB 以下；这时改走界面总线（不在 SCREEN_BUSES 里，音量同样跟「音效」）。
 */
const SCREEN_EXEMPT_SFX = new Set<SfxId>(['cloth']);
/**
 * 标题屏的「地点」（§7.2：背景是早晨的走廊）：房间底噪、走廊混响、没有灯管嗡鸣、没有雨。
 * key 不同于任何真实地点，所以之后的第一个 segment 一定按章节数据重建。
 */
const TITLE_PLACE: Place = { key: 'title', reverb: 'corridor', ambience: 'room', ambLevel: 1, hum: false, rain: 'indoor' };
/** 回到标题时，之前那一章的环境音、雨、底噪淡出用的时间（秒；τ = 1/3 这个值，1 s 时约 −35 dB，2 s 时约 −70 dB）。 */
const TITLE_FADE = 0.75;
/** 解锁手势（§6.1）：iOS 只在 touchend / click 这类手势里允许 resume，pointerdown 不一定算。capture，别人 stopPropagation 也收得到。 */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;
/** 同一声膝盖闷响的去重窗口（秒）：GameEvent fall 与 sfx cue 两条路径共用。 */
const KNEE_DEDUPE = 0.1;
/** 梦中掌声「先散后齐」：一片掌声刚起来时先是散的，这么久之后才开始对齐（τ 0.6 s）。 */
const APPLAUSE_GATHER = 0.5;
/** 空闲任务：一件重活至少要这么多空闲时间（Convolver 的 FFT 6–18 ms）；等太久（ms）就照做。 */
const WARM_MIN_IDLE_MS = 10;
const WARM_MAX_WAIT_MS = 1500;
const MENU_SCREENS = new Set(['title', 'chapters', 'settings', 'notes', 'pause', 'outro', 'credits', 'fail']);
/** 静音段的门：时间常数 35 ms，0.3 s 时已低于 −70 dB（验收 4 要求 ≤ −60 dB）。 */
const HUSH_TAU = 0.035;
/** 一次性的门（重来、换章时清掉）。 */
const TRANSIENT_GATES = ['silence', 'quiet', 'glass'] as const;

interface PlayOpts { key: string; bus: BusId; at: number; gainDb: number; peakDb: number; pan?: number; send?: number; tau: number; prio: number; rate?: number; dest?: AudioNode }

export class AudioEngine implements AudioImpl, AudioAPI {
  readonly enabled = true;
  ctx: BaseAudioContext | null = null;
  mixer: Mixer | null = null;
  readonly clock = new SimClock();
  readonly voices = new VoicePool();
  /** 预渲染库与压缩器校准完成。 */
  ready: Promise<void> = Promise.resolve();
  libraryReady = false;
  /** 最近排程的一次性声音（测试与调试用，环形 512）。 */
  readonly scheduled: Array<{ key: string; at: number; bus: BusId; gainDb: number; pan: number; buf: AudioBuffer | null }> = [];
  screen = 'boot';
  /** 在结尾卡上收到的床单声（sfx cloth）个数，只增不减。界面音用它判断一次 ↓ 是不是已经被结尾卡用掉（见 ui.ts）。 */
  outroTaps = 0;

  private noise: NoiseBank | null = null;
  private ambDeps: AmbDeps | null = null;
  private palms: Map<string, AudioBuffer[]> | null = null;
  private sfxLib: Map<string, AudioBuffer[]> | null = null;
  private loops = new Map<ApplauseKind, AudioBuffer>();
  private rain: Rain | null = null;
  private hum: Hum | null = null;
  private amb: Ambience | null = null;
  private fading: Ambience[] = [];
  private readonly log = new CueLog();
  private readonly rng: () => number;
  private readonly seed: number;
  private readonly lights = new LightModel();
  private volumes: Volumes = { master: 80, sfx: 90, ambience: 70 };
  /** 实际是否挂起（= Game 的暂停 || 失焦 / 隐藏）。 */
  private suspended = false;
  private gamePaused = false;
  private away = false;
  private readonly crowd: CrowdSteps;
  /** 本段段首对应的模拟时刻（walk 障碍按段内时间移动）。 */
  private segT0 = 0;
  private chapterId: ChapterId | null = null;
  /** 解锁后在空闲时分批做的重活（脉冲响应、梦中掌声缓冲），不放进某一帧里。 */
  private warm: Array<{ fn: () => void; urgent: boolean; since: number }> = [];
  private warmTimer: unknown = null;
  private errors = 0;
  /** 解锁手势监听是否挂着（context 确认 running 之前一直挂着）。 */
  private armed = false;
  private readonly onGesture = (): void => { this.guard(() => { void this.wake(); }); };

  // 期望状态（没有 context 时也维护，建图时一次性应用）
  private place: Place | null = null;
  private wantAmb: AmbState = { amb: 'none', level: 1 };
  private wantRain = 0;
  private pendingAmb: { st: AmbState; tick: number } | null = null;
  private segIndex = -1;
  private jump = true;
  private hush = false;
  private failing = false;
  private screenQuiet = false;
  private folMix: FollowerMix = SILENT_MIX;
  private folKey = '';
  private width = { from: 0, to: 0, t0: 0 };
  private skipKnuckleUntil = -1;
  private crispUntil: Record<Hand, number> = { L: -1, R: -1 };
  private palmJitter: Record<Hand, number> = { L: 0, R: 0 };
  /** 离线模式的「现在」（单调不减）。 */
  private vnow = 0;
  private lastVariant = new Map<string, number>();
  private lastSnap: SimSnapshot | null = null;
  private lastTick = 0;
  private brightPrev = 1;
  private lastClick = -10;
  private lastSpeed = -1;
  private recipeCache = new Map<string, OneShot | null>();
  /** 梦中掌声（锁存：crowd cue 不管当前是哪种环境音都更新；换章重置，跳段时按章节数据重建）。 */
  private applause: ApplauseState = { ...APPLAUSE_DEFAULT };
  /** 当前 dreamApplause 实例开始的音频时刻。 */
  private applauseFrom = -Infinity;
  /** 上一声膝盖闷响的音频时刻（去重）。 */
  private kneeAt = -Infinity;
  // 主线程开销
  private cost = 0;
  private frames = 0;
  private costTotal = 0;
  costMax = 0;
  /** 最贵的那一帧里最贵的一项（事件类型或 'frame'），调试主线程尖峰用。 */
  costMaxWhat = '';
  private frameWorst = { what: '', ms: 0 };

  constructor(private readonly deps: EngineDeps) {
    this.seed = deps.seed ?? 20260930;
    this.rng = mulberry32(this.seed ^ 0x5eed);
    this.crowd = new CrowdSteps(this.rng);
    if (deps.offline) this.clock.maxLead = Infinity;
  }

  // ——————————————————— AudioAPI ———————————————————
  async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        this.ctx = this.deps.createContext();
        this.build();
        this.watchState();
      }
      if (this.deps.offline) return;
      await this.wake();
    } catch (err) { this.error(err); }
  }

  /**
   * 在手势里同步地播一段 1 样本的静音 buffer 再 resume()（iOS 只认手势里的这两步，§6.1）。Game 暂停或失焦时不恢复。
   * context 确认 running 之前一直挂着手势监听：第一次 resume 被拒（或一直没有结果），下一次手势再试。
   */
  private wake(): Promise<void> {
    const ctx = this.ctx as AudioContext | null;
    if (!ctx || this.deps.offline) return Promise.resolve();
    const st = ctx.state as string;
    if (st === 'running' || st === 'closed') { this.disarm(); return Promise.resolve(); }
    this.arm();
    if (this.suspended) return Promise.resolve();
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    return this.resumeCtx(ctx);
  }

  /** resume()，失败不抛；确认 running 之后摘掉手势监听。 */
  private resumeCtx(ctx: AudioContext): Promise<void> {
    let p: Promise<void>;
    try { p = ctx.resume(); } catch (err) { this.error(err); return Promise.resolve(); }
    return Promise.resolve(p).then(() => { if ((ctx.state as string) === 'running') this.disarm(); }, () => undefined);
  }

  /**
   * context 的状态变化：running → 摘掉手势监听；iOS 的 interrupted（来电、别的 App 占用音频）或不是我们要的 suspended
   * （系统挂起；我们自己暂停 / 失焦时的 suspended 不算）→ 重新挂上，等下一次手势恢复。
   */
  private watchState(): void {
    if (this.deps.offline || !this.ctx) return;
    this.ctx.onstatechange = () => this.guard(() => this.onCtxState());
  }

  private onCtxState(): void {
    const st = (this.ctx?.state ?? 'closed') as string;
    if (st === 'running' || st === 'closed') this.disarm();
    else if (st === 'interrupted' || (st === 'suspended' && !this.suspended)) this.arm();
  }

  private arm(): void {
    const t = this.deps.gestures;
    if (this.armed || !t) return;
    this.armed = true;
    for (const k of GESTURES) t.addEventListener(k, this.onGesture, { capture: true, passive: true });
  }

  private disarm(): void {
    const t = this.deps.gestures;
    if (!this.armed || !t) return;
    this.armed = false;
    for (const k of GESTURES) t.removeEventListener(k, this.onGesture, { capture: true });
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    const t0 = this.perf();
    try {
      this.lastSnap = snap;
      this.lastTick = e.tick;
      for (const n of cueNames(e)) this.log.record(n);
      if (this.pendingAmb && e.tick > this.pendingAmb.tick) this.flushPendingAmb(snap);
      this.handle(e, snap);
      this.observe(snap);
    } catch (err) { this.error(err); }
    const dt = this.perf() - t0;
    this.cost += dt;
    if (dt > this.frameWorst.ms) this.frameWorst = { what: e.type === 'cue' ? `cue:${e.data.body.type}` : e.type, ms: dt };
  }

  frame(snap: SimSnapshot, _dt: number): void {
    const t0 = this.perf();
    try {
      this.lastSnap = snap;
      // 离线（测试）：「现在」由模拟时间反推，第一帧就对齐时钟——否则没有触地声的场景（只有环境音）永远停在 0
      if (this.deps.offline && this.ctx && this.clock.offset === null) this.clock.toAudio(snap.t, this.vnow);
      this.observe(snap);
      if (this.ctx && this.mixer) {
        if (this.pendingAmb) this.flushPendingAmb(snap);
        const now = this.now();
        if (!this.deps.offline) this.clock.track(snap.t, now);
        const until = now + 0.35;
        this.amb?.advance(until);
        this.rain?.advance(until);
        const mute = this.failing || this.hush || this.screenQuiet || snap.segKind !== 'run';
        this.crowd.advance(now, until, { beat: snap.segBeat, cadence: snap.player.cadence, tSeg: snap.t - this.segT0 }, mute,
          (at, g, p) => this.step(at, g, p));
        this.updateHum(snap, now);
        if (this.amb?.id === 'dream' && Math.abs(snap.player.speed - this.lastSpeed) > 0.2) {
          this.lastSpeed = snap.player.speed;
          this.amb.param('speed', snap.player.speed, now);
        }
        this.voices.prune(now);
        this.mixer.tidy(now);
        for (let i = this.fading.length - 1; i >= 0; i--) {
          const a = this.fading[i] as Ambience;
          if (now > a.stopAt + 0.2) { a.disconnect(); this.fading.splice(i, 1); }
        }
      }
    } catch (err) { this.error(err); }
    const own = this.perf() - t0;
    const c = this.cost + own;
    this.cost = 0;
    this.frames++;
    this.costTotal += c;
    if (c > this.costMax) { this.costMax = c; this.costMaxWhat = own >= this.frameWorst.ms ? 'frame' : this.frameWorst.what; }
    this.frameWorst = { what: '', ms: 0 };
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    if (this.mixer) this.mixer.setVolumes(v, this.now());
  }

  /** Game 的暂停（暂停菜单）。 */
  suspend(on: boolean): void {
    this.gamePaused = on;
    this.applySuspend();
  }

  /** 窗口失焦或标签页隐藏（index.ts 监听；任何屏幕都生效）。 */
  background(on: boolean): void {
    this.away = on;
    this.applySuspend();
  }

  private applySuspend(): void {
    const on = this.gamePaused || this.away;
    if (on === this.suspended) return;
    this.suspended = on;
    if (!this.ctx || this.deps.offline) return;
    const ctx = this.ctx as AudioContext;
    try {
      if (on) void ctx.suspend().catch(() => undefined);
      else {
        this.clock.reset(); this.crowd.restart();
        // 恢复不一定成功（失焦期间被系统打断时要等手势）：确认 running 之前挂着手势监听
        if ((ctx.state as string) !== 'running') this.arm();
        void this.resumeCtx(ctx);
      }
    } catch (err) { this.error(err); }
  }

  /** 设置「减少闪烁」：没有 WP3 的 LampField 时，回退的灯光模型不再按拍闪（嗡鸣和「咔」跟着不闪）。 */
  setReducedFlicker(on: boolean): void { this.lights.reducedFlicker = on; }

  cues(n: number): string[] { return this.log.recent(n); }

  // ——————————————————— WP7 的 cue ———————————————————
  onBell(kind: BellKind, snap: SimSnapshot): void {
    this.log.record(`bell:${kind}`);
    this.guard(() => this.sfx(BELL_SFX[kind], this.atSnap(snap), {}));
  }

  onSfx(id: SfxId, pan: number | undefined, g: number | undefined, snap: SimSnapshot): void {
    this.log.record(`sfx:${id}`);
    if (id === 'cloth' && this.screen === 'outro') this.outroTaps++;
    this.guard(() => {
      if (g !== undefined && !(g > 0)) return;                      // gain 0（或负数、NaN）：不出声
      const at = this.atSnap(snap);
      const gainDb = g !== undefined ? Math.min(0, 20 * Math.log10(g)) : 0;
      // 缺省居中：1-6 的端墙镜在正前方、3-4 的水洼在中道；侧面的镜子由 cue 自己带 pan（§6.2「声像在镜子那一侧」）
      const p = pan ?? 0;
      if (id === 'kneeThud') { this.kneeThud(at, gainDb, p); return; }
      const bus: BusId | null = HUSH_EXEMPT_SFX.has(id) ? 'self' : this.screenQuiet && SCREEN_EXEMPT_SFX.has(id) ? 'ui' : null;
      this.sfx(id, at, bus ? { pan: p, gainDb, bus } : { pan: p, gainDb });
      if (id === 'glassTouch' && this.mixer) {
        const now = this.now();
        for (const b of GLASS_BUSES) this.mixer.gate(b).set('glass', dbToGain(-9), at + 0.3, at + 2.3, 0.1, 0.25, now);
      }
    });
  }

  onAmbience(amb: AmbienceId, level: number, seconds: number, snap: SimSnapshot): void {
    this.log.record(`ambience:${amb}`);
    this.pendingAmb = null;
    this.guard(() => this.setAmbience(amb, level, seconds, this.peekSnap(snap)));
  }

  onSilence(seconds: number, snap: SimSnapshot): void {
    this.log.record(`silence:${seconds}`);
    this.guard(() => {
      if (!this.mixer) return;
      const at = this.atSnap(snap), now = this.now();
      for (const b of SILENCE_BUSES) this.mixer.gate(b).set('silence', 0, at, at + 0.06 + seconds, 0.008, 0.12, now);
    });
  }

  /** UI：移动（极轻的纸张声 −40 dBFS）/ 确认（一次指腹触地声 −30 dBFS）。 */
  ui(kind: 'move' | 'confirm'): void {
    this.log.record(`ui:${kind}`);
    this.guard(() => {
      // 挂起时（暂停菜单、失焦）不排：否则会在恢复的那一刻一齐响出来
      if (!this.ctx || this.suspended) return;
      const at = this.now() + 0.01;
      if (kind === 'move') this.sfx('uiMove', at, {});
      else this.palm({ voice: 'self', surface: 'terrazzo', part: 'pad', heavy: false }, at, { bus: 'ui', gainDb: -13, pan: 0, send: 0 });
    });
  }

  get menuScreen(): boolean { return MENU_SCREENS.has(this.screen); }

  stats(): Record<string, unknown> {
    const ctx = this.ctx as (AudioContext & { state?: string }) | null;
    return {
      enabled: true, context: !!ctx, state: ctx?.state ?? null, sampleRate: ctx?.sampleRate ?? null,
      libraryReady: this.libraryReady, voices: this.voices.list.length, maxVoices: this.voices.maxSeen,
      stolen: this.voices.stolen, dropped: this.voices.dropped, reanchors: this.clock.reanchors,
      frames: this.frames, avgFrameMs: this.frames ? this.costTotal / this.frames : 0, maxFrameMs: this.costMax, maxFrameWhat: this.costMaxWhat,
      ambience: this.amb?.id ?? null, reverb: this.mixer?.reverb ?? null, place: this.place?.key ?? null,
      hush: this.hush, failing: this.failing, rain: this.wantRain, follower: this.folMix, makeup: this.mixer?.makeupDb ?? null,
      suspended: this.suspended, gestures: this.armed, crowd: this.crowd.count, applause: { ...this.applause }, errors: this.errors,
    };
  }

  // ——————————————————— 建图 ———————————————————
  private build(): void {
    const ctx = this.ctx as BaseAudioContext;
    this.noise = new NoiseBank(ctx, this.seed);
    this.mixer = new Mixer(ctx, ctx.destination, this.seed);
    const now = this.now();
    this.mixer.setVolumes(this.volumes, now);
    this.ambDeps = {
      ctx, noise: this.noise, rng: this.rng, amb: this.mixer.dry('ambience'), floor: this.mixer.dry('floor'),
      grain: (id, at, db, pan, dest) => this.grain(id, at, db, pan, dest),
      loop: (k) => this.loopBuffer(k),
    };
    this.rain = new Rain(this.ambDeps, this.mixer.rainIn);
    this.hum = new Hum(this.ambDeps, this.mixer.dry('ambience'));
    this.mixer.setReverb(this.place?.reverb ?? 'corridor', now, 0);
    if (this.place) this.mixer.setRainExposure(this.place.rain, now);
    this.mixer.setFollower(this.folMix, now, 0);
    if (this.hush) for (const b of HUSH_BUSES) this.mixer.gate(b).set('hush', 0, now, Infinity, HUSH_TAU, 0.3, now);
    if (this.failing) this.applyFail(true, now);
    this.setAmbience(this.wantAmb.amb, this.wantAmb.level, 1.2, now);
    if (this.wantRain > 0) this.setRain(this.wantRain, 1.2, now);
    this.ready = this.loadLibrary();
    for (const k of ['white', 'pink', 'brown'] as const) this.later(() => this.noise?.get(k));
    if (this.chapterId) this.prewarmChapter(this.chapterId);
  }

  /**
   * 本章用到的混响：空闲时把脉冲响应算好、两组混响的 Convolver 装好（每件一个任务），换地点时只是接线。
   * 别的章的 Convolver 丢掉（它们各自持有 FFT 之后的脉冲响应）。
   */
  private prewarmChapter(id: ChapterId): void {
    const def = this.chapterDef(id);
    const m = this.mixer;
    if (!def || !m) return;
    const ids = new Set<ReverbId>(def.segments.map((sg) => placeOf(sg, this.deps.kitLookup).reverb));
    m.keepReverbs(ids);
    for (const r of ids) {
      this.later(() => this.mixer?.irFor(r));
      this.later(() => this.mixer?.prepareReverb(r, 'A'));
      this.later(() => this.mixer?.prepareReverb(r, 'B'));
    }
  }

  /**
   * 排一件空闲时做的重活（每件一个任务，不连成一个长任务）。离线（测试）模式不做。urgent：排到最前面，有空闲期就做。
   * 有 requestIdleCallback 时放在帧与帧之间的空闲期里，空闲时间不够一件（< 10 ms）就等下一个；等了 1.5 s 还没轮上就照做。
   */
  private later(fn: () => void, urgent = false): void {
    if (this.deps.offline || typeof setTimeout === 'undefined') return;
    const job = { fn, urgent, since: this.perf() };
    if (urgent) this.warm.unshift(job); else this.warm.push(job);
    this.kickWarm();
  }

  private kickWarm(): void {
    if (this.warmTimer !== null || !this.warm.length) return;
    type Deadline = { timeRemaining(): number; didTimeout: boolean };
    const ric = (globalThis as { requestIdleCallback?: (cb: (d: Deadline) => void, o?: { timeout: number }) => unknown }).requestIdleCallback;
    const run = (d?: Deadline) => {
      this.warmTimer = null;
      const job = this.warm[0];
      if (!job) return;
      if (d && !d.didTimeout && !job.urgent && d.timeRemaining() < WARM_MIN_IDLE_MS && this.perf() - job.since < WARM_MAX_WAIT_MS) {
        this.kickWarm();
        return;
      }
      this.warm.shift();
      try { job.fn(); } catch (err) { this.error(err); }
      this.kickWarm();
    };
    this.warmTimer = typeof ric === 'function' ? ric.call(globalThis, run, { timeout: WARM_MAX_WAIT_MS }) : setTimeout(run, 0);
  }

  private async loadLibrary(): Promise<void> {
    const ctx = this.ctx as BaseAudioContext;
    const mk = this.deps.makeOffline;
    try { await (this.mixer as Mixer).calibrate(mk); } catch (err) { this.error(err); }
    if (this.deps.preload) {
      this.palms = this.deps.preload.palms;
      this.sfxLib = this.deps.preload.sfx;
      this.libraryReady = true;
      return;
    }
    try {
      const palms = allPalmKeys().map((k) => this.recipe(palmKeyString(k), () => palmRecipe(k))).filter((r): r is OneShot => !!r);
      this.palms = (await renderOneShots(ctx, mk, palms, { seed: this.seed, batchSec: 12 })).buffers;
      this.sfxLib = (await renderOneShots(ctx, mk, allOneShots(), { seed: this.seed + 1, batchSec: 12 })).buffers;
      this.libraryReady = true;
    } catch (err) { this.error(err); }
  }

  private loopBuffer(k: ApplauseKind): AudioBuffer | null {
    const hit = this.loops.get(k);
    if (hit || !this.ctx) return hit ?? null;
    const [l, r] = applauseLoop(k, this.ctx.sampleRate, this.seed);
    const b = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    b.copyToChannel(l, 0); b.copyToChannel(r, 1);
    this.loops.set(k, b);
    return b;
  }

  // ——————————————————— 时间 ———————————————————
  private perf(): number { return this.deps.perfNow ? this.deps.perfNow() : (typeof performance !== 'undefined' ? performance.now() : 0); }
  /** 音频时钟的「现在」。离线模式由最新模拟时刻反推。 */
  now(): number {
    if (!this.ctx) return 0;
    if (!this.deps.offline) return this.ctx.currentTime;
    // 离线：时钟重置（换章）之后、重新对齐之前，「现在」停在上一次的值，不能倒回 0
    if (this.clock.offset !== null) this.vnow = Math.max(this.vnow, this.clock.virtualNow(this.lastSnap?.t ?? 0));
    return this.vnow;
  }
  /** 模拟时刻 → 音频时刻（前瞻调度）。 */
  private at(simT: number): number { return this.clock.toAudio(simT, this.now()); }
  private atSnap(snap: SimSnapshot): number { return this.at(snap.t); }
  /** 非节拍关键的自动化用：不重新对齐时钟。 */
  private peekSnap(snap: SimSnapshot): number { return this.clock.peek(snap.t, this.now()); }

  // ——————————————————— 事件 ———————————————————
  private handle(e: GameEvent, snap: SimSnapshot): void {
    switch (e.type) {
      case 'chapter:start':
        this.jump = true; this.segIndex = -1; this.skipKnuckleUntil = -1; this.crispUntil = { L: -1, R: -1 };
        // 模拟时间从 0 重新开始：实时模式下重新对齐（离线模式的「现在」由模拟时间定义，倒回时 toAudio 自己会重新对齐）
        if (!this.deps.offline) this.clock.reset();
        this.setFail(false, snap);
        this.clearTransient();
        this.crowd.restart();
        this.applause = { ...APPLAUSE_DEFAULT };
        this.chapterId = e.data.id;
        if (this.ctx) this.prewarmChapter(e.data.id);
        // 梦中掌声的三个循环缓冲（每个约 25 ms 的 JS）：分三次空闲时生成
        if (e.data.id === 'ch4' && this.ctx) for (const k of ['sparse', 'dense', 'aligned'] as const) this.later(() => this.loopBuffer(k));
        return;
      case 'segment': this.onSegment(e.data, snap); return;
      case 'retry': this.setFail(false, snap); this.clearTransient(); this.skipKnuckleUntil = -1; this.crowd.restart(); return;
      case 'screen': this.onScreen(e.data.name); return;
      default: break;
    }
    if (!this.ctx || !this.mixer) return;
    switch (e.type) {
      case 'contact': this.onContact(e.data); break;
      case 'followerContact': this.onFollowerContact(e.data, snap); break;
      case 'hit': this.onHit(e.data, snap); break;
      case 'fall': this.onFall(snap); break;
      case 'lookBack':
        if (e.data.phase === 'start') {
          const at = this.atSnap(snap);
          this.mixer.followerMute.set('look', 0, at, at + 1.2, 0.015, 0.1, this.now());
        }
        break;
      case 'twitch': if (e.data.phase === 'warn') this.sfx('muscle', this.atSnap(snap), {}); break;
      case 'drift': if (e.data.phase === 'warn') this.sfx('muscle', this.atSnap(snap), { gainDb: -4, pan: e.data.dir * 0.3 }); break;
      case 'stand': this.onStand(e.data, snap); break;
      case 'nearMiss': this.sfx('cloth', this.atSnap(snap), { gainDb: -2, pan: e.data.side * 0.5 }); break;
      case 'ask': {
        const at = this.atSnap(snap);
        this.sfx('whisper', at + 0.8, { pan: 0.5 });
        this.sfx('laughShort', at + 1.25, { pan: 0.5 });
        break;
      }
      case 'note': this.sfx('paper', this.atSnap(snap), { gainDb: -2 }); break;
      case 'action':
        if (e.data.kind === 'duck') this.soundLight(snap);
        if (e.data.kind === 'lane' && (snap.player.surface === 'water' || snap.player.surface === 'asphaltWet' || snap.player.surface === 'leavesWet')) {
          this.sfx('splash', this.atSnap(snap), { gainDb: -6, pan: (e.data.dir ?? 0) * 0.3 });
        }
        break;
      case 'land': this.soundLight(snap); break;
      case 'cue': this.onOtherCue(e.data.body, snap); break;
      default: break;
    }
  }

  /** 快照里的持续状态：静音段、追随者混音。 */
  private observe(snap: SimSnapshot): void {
    if (snap.hush !== this.hush) {
      this.hush = snap.hush;
      if (snap.hush) this.log.record('hush');
      if (this.mixer) {
        const now = this.now(), at = this.clock.peek(snap.t, now);
        for (const b of HUSH_BUSES) {
          if (snap.hush) this.mixer.gate(b).set('hush', 0, at, Infinity, HUSH_TAU, 0.3, now);
          else this.mixer.gate(b).clear('hush', at, 0.3, now);
        }
      }
    }
    const m = followerMix(snap.follower, snap.player.steady);
    const k = mixKey(m);
    if (k !== this.folKey) {
      this.width = { from: this.widthAt(snap.t), to: m.panWidth, t0: snap.t };
      this.folKey = k;
      this.folMix = m;
      if (this.mixer) this.mixer.setFollower(m, this.clock.peek(snap.t, this.now()), 0.3);
    }
  }

  private widthAt(t: number): number {
    const w = this.width;
    const x = Math.min(1, Math.max(0, (t - w.t0) / 0.3));
    return w.from + (w.to - w.from) * x;
  }

  /** 重来 / 换章：清掉还没结束的一次性门（静默、安静的一秒、玻璃触碰）和回头静音。 */
  private clearTransient(): void {
    if (!this.mixer) return;
    const now = this.now();
    for (const b of ALL_GATE_BUSES) {
      for (const id of TRANSIENT_GATES) if (this.mixer.gate(b).has(id)) this.mixer.gate(b).clear(id, now, 0.1, now);
    }
    if (this.mixer.followerMute.has('look')) this.mixer.followerMute.clear('look', now, 0.1, now);
  }

  /**
   * 屏幕切换。Game 只把 'screen' 发到 EventBus，不经过 AudioAPI.onEvent，所以 index.ts 订阅总线后调用这里。
   * 结尾卡和演职卡：所有声音约 1.5 s 淡出（底噪也停；床单声例外，见 SCREEN_EXEMPT_SFX）；菜单类屏幕：允许界面音。
   * 标题：换成标题的底噪（enterTitle）。
   */
  onScreen(name: string): void {
    this.screen = name;
    // 离开暂停菜单（以及从暂停菜单打开的设置）就结束 Game 的暂停：「重来」「回到标题」不会调 suspend(false)
    if (this.gamePaused && name !== 'pause' && name !== 'settings') { this.gamePaused = false; this.applySuspend(); }
    const quiet = name === 'outro' || name === 'credits';
    // 之前那一章的声音此刻已经听不见（被屏幕门或失败门压着）：回到标题时直接换掉，不必淡出
    const muted = this.screenQuiet || this.failing;
    if (quiet !== this.screenQuiet) {
      this.screenQuiet = quiet;
      if (this.mixer) {
        const now = this.now();
        for (const b of SCREEN_BUSES) {
          if (quiet) this.mixer.gate(b).set('screen', 0, now, Infinity, 0.25, 0.3, now);   // 约 1.5 s 内淡到听不见
          else this.mixer.gate(b).clear('screen', now, 0.3, now);
        }
      }
    }
    if (name === 'title') this.enterTitle(muted);
  }

  /**
   * 回到标题（暂停菜单、失败卡、结尾卡、演职卡之后，以及启动后第一次进标题）：之前那一章的环境音、雨、房间底噪
   * 约 1 s 内淡出，换成标题的底噪（早晨走廊的房间声）；地点、混响、人群、失败和一次性的门一并清掉。
   * 之后的 chapter:start / segment（开始、继续、选章；U4 回标题时把模拟复位到 1-1 也会发）照常按章节数据恢复——
   * 下一个 segment 一定按「跳段」处理（soundStateAt 重建地点、环境音、雨）。
   */
  private enterTitle(muted: boolean): void {
    this.jump = true; this.segIndex = -1; this.pendingAmb = null;
    this.crowd.setSegment(null);
    this.lights.reset();
    const now = this.now();
    if (this.failing) { this.failing = false; if (this.mixer) this.applyFail(false, now); }
    this.clearTransient();
    const fade = muted ? 0.05 : TITLE_FADE;
    this.setPlaceAt(TITLE_PLACE, now, 0.8);
    this.setRain(0, fade, now);
    this.setAmbience(TITLE_PLACE.ambience, TITLE_PLACE.ambLevel, fade, now);
  }

  // ——————————————————— 地点、环境音、雨 ———————————————————
  private chapterDef(id: ChapterId): ChapterDef | null { return this.deps.chapter?.(id) ?? null; }

  private onSegment(d: GameEvents['segment'], snap: SimSnapshot): void {
    const jump = this.jump || d.index !== this.segIndex + 1 || snap.segBeat > 0.5;
    this.segIndex = d.index;
    this.lights.reset();
    const def = this.chapterDef(snap.chapter);
    const seg = def?.segments[d.index];
    // 段内时间：正常进入时就是现在；跳到段中（检查点、读档）时按拍号和步频倒推
    this.segT0 = snap.t - (snap.segBeat > 0.5 ? snap.segBeat / Math.max(0.5, snap.player.cadence) : 0);
    this.crowd.setSegment(seg ?? null);
    if (!def || !seg) { this.jump = false; return; }
    const place = placeOf(seg, this.deps.kitLookup);
    const changed = !this.place || this.place.key !== place.key;
    this.setPlace(place, snap, jump ? 0.3 : 0.8);
    if (jump) {
      this.jump = false;
      this.pendingAmb = null;
      const st = soundStateAt(def, d.index, snap.segBeat, this.deps.kitLookup);
      if (st) {
        const at = this.peekSnap(snap);
        this.setApplause(st.applause, at);                           // 先于环境音：落在掌声中间时，新建的 dreamApplause 直接用它
        this.setAmbience(st.ambience.amb, st.ambience.level, 0.6, at);
        this.setRain(st.rain, 0.6, at);
      }
    } else if (changed) {
      // 同一 tick 里如果还有 ambience cue，它会覆盖这里（onAmbience 清掉 pending）
      this.pendingAmb = { st: { amb: place.ambience, level: place.ambLevel }, tick: this.lastTick };
    }
  }

  private flushPendingAmb(snap: SimSnapshot): void {
    const p = this.pendingAmb;
    this.pendingAmb = null;
    if (p) this.setAmbience(p.st.amb, p.st.level, 1.2, this.peekSnap(snap));
  }

  private setPlace(place: Place, snap: SimSnapshot, fade: number): void {
    this.setPlaceAt(place, this.mixer ? this.clock.peek(snap.t, this.now()) : 0, fade);
  }

  private setPlaceAt(place: Place, at: number, fade: number): void {
    this.place = place;
    if (!this.mixer) return;
    this.mixer.setRainExposure(place.rain, at);
    // Convolver 还没装好：不在这一帧里做 FFT，排到空闲任务的最前面（交叉淡变本来就有 0.8 s，晚几毫秒听不出来）
    if (this.deps.offline || this.mixer.reverbReady(place.reverb)) { this.mixer.setReverb(place.reverb, at, fade); return; }
    // 依次插到最前面：装 A、装 B、切换
    const id = place.reverb;
    this.later(() => { if (this.mixer && this.place?.reverb === id) this.mixer.setReverb(id, this.now(), fade); }, true);
    this.later(() => this.mixer?.prepareReverb(id, 'B'), true);
    this.later(() => this.mixer?.prepareReverb(id, 'A'), true);
  }

  private setAmbience(amb: AmbienceId, level: number, secs: number, at: number): void {
    this.wantAmb = { amb, level };
    if (!this.ctx || !this.ambDeps) return;
    const now = this.now();
    const s = Math.max(0.05, secs);
    if (amb === 'none' || level <= 0) {
      if (this.amb) { this.amb.stop(at, s); this.fading.push(this.amb); this.amb = null; }
      return;
    }
    if (this.amb && this.amb.id === amb) { this.amb.fadeTo(level, at, s); return; }
    if (this.amb) { this.amb.stop(at, s); this.fading.push(this.amb); }
    this.amb = new Ambience(this.ambDeps, amb, at);
    this.amb.fadeTo(level, at, s);
    this.amb.param('rain', this.wantRain, at);
    if (amb === 'dreamApplause') { this.applauseFrom = at; this.applyApplause(this.amb, at); }
    this.amb.advance(now + 0.35);
  }

  /** 锁存梦中掌声的状态；正在放 dreamApplause 就立即应用。 */
  private setApplause(st: ApplauseState, at: number): void {
    this.applause = { ...st };
    if (this.amb?.id === 'dreamApplause') this.applyApplause(this.amb, at);
  }

  /**
   * 把锁存的状态应用到一个 dreamApplause 实例：密度立即滑变；对齐「先散后齐」——掌声刚起来的 0.5 s 里还是散的，
   * 之后才逐渐对齐成整齐的一片（τ 0.6 s，§6.2「逐渐对齐」）。crowd cue 与 ambience cue 谁先到都一样。
   */
  private applyApplause(a: Ambience, at: number): void {
    a.param('density', this.applause.density, at);
    a.param('align', this.applause.align, Math.max(at, this.applauseFrom + APPLAUSE_GATHER));
  }

  private setRain(intensity: number, secs: number, at: number): void {
    this.wantRain = intensity;
    if (!this.rain) return;
    this.rain.set(intensity, at, Math.max(0.05, secs));
    this.amb?.param('rain', intensity, at);
  }

  private onOtherCue(b: EventBody, snap: SimSnapshot): void {
    switch (b.type) {
      case 'text': if (b.style === 'whisper') this.sfx('whisper', this.atSnap(snap), { pan: b.pan ?? -0.5 }); break;
      case 'rain': this.setRain(b.intensity, b.seconds, this.peekSnap(snap)); break;
      case 'lights': this.lights.onCue(b, snap); break;
      case 'crowd':
        if (b.op === 'silent') {
          // 「所有人静止 1 s」：这群人的脚步停 1 s
          const at = this.clock.peek(snap.t, this.now());
          this.crowd.silence(b.group || null, at, at + 1);
        }
        // 梦中掌声：不管当前是哪种环境音都锁存（4-3 里 crowd applaud 与 ambience dreamApplause 同一 tick，crowd 在前）
        if (b.op === 'applaud' || b.op === 'crawlOvertake' || b.op === 'normal') {
          this.setApplause(applauseAfter(this.applause, b.op), this.clock.peek(snap.t, this.now()));
        }
        break;
      case 'board': this.sfx(b.op === 'write' ? 'chalk' : 'cloth', this.atSnap(snap), { gainDb: b.op === 'write' ? 0 : -3 }); break;
      case 'noteOpen': this.sfx('paper', this.atSnap(snap), {}); break;
      default: break;
    }
  }

  // ——————————————————— 灯管嗡鸣与声控灯 ———————————————————
  private updateHum(snap: SimSnapshot, now: number): void {
    if (!this.hum) return;
    const lamps = this.deps.lamps?.() ?? null;
    const real = !!lamps && !(lamps instanceof FlatLampField) && snap.segKind !== 'still';
    const b = real ? Math.max(0, Math.min(1, (lamps as LampFieldAPI).brightnessAt(snap.player.s))) : this.lights.brightness(snap);
    const active = this.place?.hum ?? false;
    const at = this.clock.peek(snap.t, now);
    if (active && (this.brightPrev >= 0.5) !== (b >= 0.5) && snap.t - this.lastClick >= 0.3) {
      this.lastClick = snap.t;
      this.sfx('click', at, {});                  // 每次亮灭加一个 1 ms 的「咔」（−32 dBFS）
    }
    this.brightPrev = b;
    this.hum.set(active ? b : 0, at, b > this.hum.current ? 0.07 : 0.05);
  }

  /** 撑跃落地或 ↓ 拍地：声控灯（继电器「咔」，随后嗡鸣 200 ms 渐入）。 */
  private soundLight(snap: SimSnapshot): void {
    if (this.lights.trigger(snap)) this.sfx('relay', this.atSnap(snap) + this.lights.soundDelay, {});
  }

  // ——————————————————— 手掌 ———————————————————
  private recipe(key: string, make: () => OneShot | null): OneShot | null {
    if (!this.recipeCache.has(key)) this.recipeCache.set(key, make());
    return this.recipeCache.get(key) ?? null;
  }

  private pick(key: string, bufs: readonly AudioBuffer[]): AudioBuffer | null {
    if (!bufs.length) return null;
    const last = this.lastVariant.get(key) ?? -1;
    let i = Math.floor(this.rng() * bufs.length);
    if (i === last && bufs.length > 1) i = (i + 1) % bufs.length;
    this.lastVariant.set(key, i);
    return bufs[i] ?? null;
  }

  /** 播放库里的一段手掌声；库还没就绪时现场合成（同一配方）。 */
  private palm(k: PalmKey, at: number, o: { bus: BusId; gainDb: number; pan: number; send: number; prio?: number; dest?: AudioNode }): void {
    const key = palmKeyString(k);
    const r = this.recipe(key, () => palmRecipe(k));
    if (!r) return;
    const bufs = this.palms?.get(key);
    const opts: PlayOpts = { key, bus: o.bus, at, gainDb: o.gainDb, peakDb: r.peakDb, pan: o.pan, send: o.send, tau: r.tau, prio: o.prio ?? 2 };
    if (o.dest) opts.dest = o.dest;
    if (bufs) { const b = this.pick(key, bufs); if (b) this.play(b, opts); }
    else this.live(r, opts);
  }

  private onContact(c: GameEvents['contact']): void {
    const part = c.part;
    if (part === 'heel') {
      // 一掌的随机化在掌根时抽一次，同一掌的指节、指腹沿用：时间 ±4 ms 整体平移，三段之间的 26 / 52 ms 间隔保持精确
      // （「掌根，指节，指腹——依次」是这个声音的骨架）。干脆时严格对齐。
      this.crispUntil[c.hand] = c.crisp ? c.t + 0.1 : -1;
      this.palmJitter[c.hand] = c.crisp ? 0 : rr(this.rng, -0.004, 0.004);
    }
    if (part === 'knuckle' && this.skipKnuckleUntil >= 0 && c.t <= this.skipKnuckleUntil) { this.skipKnuckleUntil = -1; return; }   // 绊：缺指节
    if (!partsOf(c.surface).includes(part)) return;
    const crisp = c.t <= this.crispUntil[c.hand];
    const heavy = c.heavy;
    const k: PalmKey = { voice: 'self', surface: c.surface, part, heavy: heavy && part === 'heel' };
    const r = this.recipe(palmKeyString(k), () => palmRecipe(k));
    if (!r) return;
    let gainDb = crisp ? 0 : rr(this.rng, -1.5, 1.5);           // 随机化：增益 ±1.5 dB；干脆时严格
    if (crisp && part === 'pad') gainDb += 2;                    // 干脆：指腹 +2 dB
    if (heavy) gainDb += 3;                                      // 撑跃落地：整体 +3 dB
    gainDb = Math.min(gainDb, -9 - r.peakDb);                    // 单个声部永远不超过 −9 dBFS
    const dt = crisp ? 0 : this.palmJitter[c.hand];
    const pan = (c.hand === 'L' ? -0.2 : 0.2) + rr(this.rng, -0.03, 0.03);
    this.palm(k, this.at(c.t) + dt, { bus: 'self', gainDb, pan, send: r.send });
  }

  private onFollowerContact(c: GameEvents['followerContact'], snap: SimSnapshot): void {
    if (!this.folMix.audible) return;
    const surface: Surface = snap.player.surface;
    if (!partsOf(surface).includes(c.part)) return;
    const w = this.widthAt(snap.t);
    this.palm({ voice: 'follower', surface, part: c.part, heavy: false }, this.at(c.t),
      { bus: 'follower', gainDb: rr(this.rng, -1, 1), pan: (c.hand === 'L' ? -1 : 1) * w, send: 0, prio: 1 });
  }

  private onHit(h: GameEvents['hit'], snap: SimSnapshot): void {
    const at = this.atSnap(snap);
    if (h.severity === 'stumble') {
      this.skipKnuckleUntil = snap.t + 0.3;
      this.sfx('scrape', at, {});
    } else this.sfx('crashThud', at, {});
    if (h.kind === 'mopBucket' || h.kind === 'cone' || h.kind === 'bin') this.sfx('bucketKnock', at + 0.01, { gainDb: -3 });
    if (h.crowd && this.mixer) {
      // 安静的一秒：环境总线 60 ms 内掐断，保持 1.0 s，再用 600 ms 恢复。人群同时「静止 1 s」（§5.7 silent）：
      // 不排新的脚步，已经排了的随 npc 总线一起掐掉
      const now = this.now();
      for (const b of ['ambience', 'npc'] as const) this.mixer.gate(b).set('quiet', 0, at, at + 0.06 + 1.0, 0.008, 0.12, now);
      this.crowd.silence(null, at, at + 0.06 + 1.0);
    }
  }

  private onFall(snap: SimSnapshot): void {
    const at = this.atSnap(snap);
    this.kneeThud(at);
    if (this.folMix.audible && !this.hush) {
      // 两串节拍合成一个声音，持续 0.6 s（静音段里追随者本来就听不见，不合）
      const surface = snap.player.surface;
      for (const dt of [0.05, 0.36]) {
        for (const part of partsOf(surface)) {
          const off = part === 'heel' ? 0 : part === 'knuckle' ? 0.026 : 0.052;
          for (const voice of ['self', 'follower'] as const) {
            this.palm({ voice, surface, part, heavy: false }, at + dt + off, { bus: 'floor', gainDb: dt > 0.1 ? -8 : -3, pan: 0, send: 0 });
          }
        }
      }
    }
    this.setFail(true, snap);
  }

  private setFail(on: boolean, snap: SimSnapshot): void {
    if (on === this.failing) return;
    this.failing = on;
    if (!this.mixer) return;
    const now = this.now();
    this.applyFail(on, on ? this.clock.peek(snap.t, now) : now);
  }

  private applyFail(on: boolean, at: number): void {
    const m = this.mixer as Mixer;
    const now = this.now();
    if (on) {
      m.gate('ambience').set('fail', 0, at, Infinity, 0.008, 0.1, now);          // 环境 60 ms 内掐断
      for (const b of FAIL_BUSES) m.gate(b).set('fail', 0, at + 0.01, Infinity, 0.04, 0.1, now);   // 其余 0.3 s 内淡出
    } else {
      for (const b of ['ambience', ...FAIL_BUSES] as const) m.gate(b).clear('fail', now, 0.1, now);
    }
  }

  /**
   * 膝盖闷响（floorSfx：失败时不淡出，静音段里也听得见）。GameEvent fall 与 sfx cue 共用；0.1 s 内已经排过一次就跳过——
   * 同一个 buffer 相隔 1 tick（8.3 ms）正好是 60 Hz 主体的半个周期，两遍会互相抵消（40–90 Hz 低约 11 dB）。
   */
  private kneeThud(at: number, gainDb = 0, pan = 0): void {
    if (Math.abs(at - this.kneeAt) < KNEE_DEDUPE) return;
    this.kneeAt = at;
    this.sfx('kneeThud', at, { bus: 'floor', gainDb, pan });
  }

  private onStand(s: GameEvents['stand'], snap: SimSnapshot): void {
    const at = this.atSnap(snap);
    switch (s.phase) {
      case 'step': this.sfx('stepSelf', at, { pan: ((s.step ?? 0) % 2 ? 0.12 : -0.12), rate: 1 + rr(this.rng, -0.05, 0.05) }); break;
      case 'rise': this.sfx('cloth', at, { gainDb: -4, bus: 'self' }); break;
      case 'plant':
        for (const [hand, off] of [['L', 0], ['R', 0.012]] as const) {
          for (const part of ['heel', 'knuckle', 'pad'] as ContactPart[]) {
            this.onContact({ hand, part, t: snap.t + off + (part === 'heel' ? 0 : part === 'knuckle' ? 0.026 : 0.052), s: snap.player.s, x: 0,
              surface: snap.player.surface, crisp: false, heavy: true });
          }
        }
        break;
      // 'fall'：第七步的膝盖闷响由关卡的 sfx cue 负责（§8.7 分给 WP7 的 stand 只有「先轻后重」）
      default: break;
    }
  }

  // ——————————————————— 播放 ———————————————————
  /** 播放一个预渲染的一次性声音。 */
  private sfx(id: OneShotId, at: number, o: { pan?: number; gainDb?: number; bus?: BusId; rate?: number }): void {
    const r = SFX[id];
    if (!r || !this.ctx) return;
    const opts: PlayOpts = { key: id, bus: o.bus ?? r.bus, at, gainDb: o.gainDb ?? 0, peakDb: r.peakDb, pan: o.pan ?? 0, send: r.send, tau: r.tau, prio: 1 };
    if (o.rate) opts.rate = o.rate;
    const bufs = this.sfxLib?.get(id);
    if (bufs) { const b = this.pick(id, bufs); if (b) this.play(b, opts); }
    else this.live(r, opts);
  }

  /** 环境颗粒（低优先级：声部满时直接放弃）。 */
  private grain(id: GrainId, at: number, gainDb: number, pan: number, dest?: AudioNode): void {
    const r = SFX[id];
    const bufs = this.sfxLib?.get(id);
    if (!r || !bufs) return;
    const b = this.pick(id, bufs);
    if (!b) return;
    const opts: PlayOpts = { key: id, bus: r.bus, at, gainDb, peakDb: r.peakDb, pan, send: 0, tau: r.tau, prio: 0 };
    if (dest) opts.dest = dest;
    this.play(b, opts);
  }

  /** 人群的一步「先轻后重」（低优先级：声部满时直接放弃；npc 总线，带混响发送）。 */
  private step(at: number, gainDb: number, pan: number): void {
    const r = SFX.stepPair;
    const bufs = this.sfxLib?.get('stepPair');
    if (!bufs) return;
    const b = this.pick('stepPair', bufs);
    if (b) this.play(b, { key: 'stepPair', bus: 'npc', at, gainDb, peakDb: r.peakDb, pan, send: r.send, tau: r.tau, prio: 0 });
  }

  private play(buf: AudioBuffer, o: PlayOpts): boolean {
    const ctx = this.ctx as BaseAudioContext, mixer = this.mixer as Mixer;
    const now = this.now();
    const at = Math.max(o.at, now);
    if (!this.voices.admit(now, at, o.prio)) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = o.rate ?? 1;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = dbToGain(o.gainDb);
    src.connect(g);
    const dest = o.dest ?? mixer.dryFor(o.bus);
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p); p.connect(dest);
    } else g.connect(dest);
    const send = o.dest ? null : mixer.send(o.bus);
    if (send && o.send && o.send > 0) {
      const sg = ctx.createGain();
      sg.gain.value = o.send;
      g.connect(sg); sg.connect(send);
    }
    src.start(at);
    this.voices.add({ src, g, start: at, end: at + buf.duration / rate, peak: dbToGain(o.peakDb + o.gainDb), tau: o.tau, prio: o.prio });
    this.logScheduled(o, at, buf);
    return true;
  }

  /** 库还没渲染好时的回落：在实时 context 上现场搭同一个配方（电平保守地低 6 dB）。 */
  private live(r: OneShot, o: PlayOpts): void {
    const ctx = this.ctx as BaseAudioContext, mixer = this.mixer as Mixer;
    const now = this.now();
    const at = Math.max(o.at, now);
    if (!this.voices.admit(now, at, o.prio)) return;
    const g = ctx.createGain();
    g.gain.value = dbToGain(o.gainDb - 6 - (r.key.startsWith('self:') || r.key.startsWith('follower:') ? 6 : 0));
    const dest = o.dest ?? mixer.dryFor(o.bus);
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); p.connect(dest); } else g.connect(dest);
    r.build({ ctx, out: g, t0: at, rng: this.rng, noise: this.noise as NoiseBank });
    this.voices.add({ src: null, g, start: at, end: at + r.dur, peak: dbToGain(o.peakDb + o.gainDb - 6), tau: o.tau, prio: o.prio });
    this.logScheduled(o, at, null);
  }

  private logScheduled(o: PlayOpts, at: number, buf: AudioBuffer | null): void {
    this.scheduled.push({ key: o.key, at, bus: o.bus, gainDb: o.gainDb, pan: o.pan ?? 0, buf });
    if (this.scheduled.length > 512) this.scheduled.splice(0, this.scheduled.length - 512);
  }

  private guard(fn: () => void): void { try { fn(); } catch (err) { this.error(err); } }
  private error(err: unknown): void {
    this.errors++;
    if (this.errors <= 3) console.warn('[audio]', err);
  }
}
