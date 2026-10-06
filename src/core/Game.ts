// src/core/Game.ts —— 状态机、120 Hz 固定步长主循环、各服务编排（DESIGN.md §7.1、§8.3、§8.9-2）。CORE 冻结。
// 流程：Boot → Title ─┬→ Intro → Play ⇄ Pause；Play → Fail → Play（检查点）；Play → Outro → 下一章 | Title；第五章之后 → Credits。
// 模拟事件的分发顺序：bus → cue 分发器（仅 cue）→ Audio → UI → View → Game 自己的处理（失败、结尾、存档、输入情境）。
// `?test=1`：rAF 只渲染（且只在状态变化后渲染），模拟只由 __game.step / advance 推进（§8.8）。
import type { AudioAPI, GameCommands, InputAPI, SimAPI, SolverAPI, UIAPI, ViewAPI } from './contracts';
import { CueDispatcher } from './cues';
import { EventBus } from './bus';
import { TICK_DT, TEXT } from './constants';
import type { GameEvent, GameEventName, GameEvents } from './events';
import { FixedLoop } from './loop';
import { AutoQuality } from './quality';
import {
  getAudioFactory, getInputFactory, getSimFactory, getSolver, getUIFactory, getViewFactory, type CueContext,
} from './registry';
import { createSave, loadSettings, storeSettings, type SaveAPI } from './save';
import type { Settings } from './settings';
import type { Action, ChapterId, HintId, InputEvent, QualityTier, ScreenName, SimSnapshot, Surface } from './types';
import { urlParams, type UrlParams } from './urlParams';
import { compile } from '../levels/compile';
import { availableChapters, getChapter, nextChapterOf } from '../levels/chapters/index';
import { lineText, type LineId } from '../levels/lines';
import type { CompiledChapter, EventBody, RunSegmentDef, StandSegmentDef } from '../levels/schema';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const GAMEPLAY: ReadonlySet<Action> = new Set(['left', 'right', 'up', 'down', 'look', 'ask']);
/** 开场卡：小字 → 0.6 s 章名 → 0.6 s 开场句 → 停留 2.2 s（§7.2）。 */
const INTRO_SEC = 3.4;
const FAIL_CARD_SEC = 1.0;
const FAIL_INPUT_SEC = 1.2;
const FAIL_SLOW_SEC = 0.3;
const FAIL_SLOW_MUL = 0.3;
/** 不透明的界面：背后不画 3D（实时循环下；test 模式照常画，截图脚本不受影响）。 */
const OPAQUE_SCREENS: ReadonlySet<ScreenName> = new Set(['boot', 'intro', 'outro', 'credits']);
const coarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** UI 的可选扩展（WP8，U4）：Game 只经这几个方法通知界面，不改冻结的 UIAPI。 */
type UIExt = UIAPI & { setDevice?: (d: string) => void; setQualityTier?: (t: QualityTier) => void; noteSkip?: () => void };

export interface StartOptions { segment?: string; beat?: number; skipCards?: boolean }

export class Game implements GameCommands {
  readonly bus = new EventBus();
  readonly params: UrlParams = urlParams();
  readonly settings: Settings = loadSettings();
  readonly save: SaveAPI = createSave();
  readonly cues = new CueDispatcher();
  readonly loop: FixedLoop;
  sim!: SimAPI;
  solver!: SolverAPI;
  view!: ViewAPI;
  audio!: AudioAPI;
  ui!: UIAPI;
  input!: InputAPI;
  screenName: ScreenName = 'boot';
  compiled: CompiledChapter | null = null;
  chapterId: ChapterId | null = null;
  prev!: SimSnapshot;
  next!: SimSnapshot;
  failing: { t: number; line: string; shown: boolean } | null = null;
  autopilot: 'off' | 'perfect' | 'human' = 'off';
  seed: number | null = null;
  quality: QualityTier = 'medium';
  paused = false;
  readonly log: Array<{ tick: number; type: GameEventName; data: unknown }> = [];
  private introT = -1;
  private dirty = true;
  private autoQ: AutoQuality | null = null;
  /** 自动画质已经决定、还没切换的档位：切换会同步重建 chunk（150–270 ms），只在不跑的时刻做（下一个静场 / 站立段开始、重来、读章）。 */
  private pendingQ: QualityTier | null = null;
  /** 窗口失焦或页面隐藏中（blur / visibilitychange 置位；focus、重新可见且有焦点、任何按键或点按清掉）。进入游玩的入口据此立即暂停。 */
  private away = false;
  /** 正在把标题背景复位到首章开头（enterTitle）。复位期间模拟不推进、3D 不重画；startWith 先等它完成。 */
  private titleReset: Promise<void> | null = null;
  private pendingUp: Action[] = [];
  private texts: Array<{ text: string; until: number }> = [];
  private hint: { id: HintId; until: number } | null = null;
  private failsAt = new Map<string, number>();
  private readonly seenStills = new Set<string>();
  private readyResolve!: () => void;
  readonly ready: Promise<void>;
  private booted = false;

  constructor() {
    this.loop = new FixedLoop({ tick: () => this.tick(), frame: (a, dt) => this.onFrame(a, dt) });
    this.ready = new Promise((r) => { this.readyResolve = r; });
    const p = this.params;
    if (p.rf) this.settings.reducedFlicker = true;
    if (p.rm) this.settings.reducedMotion = true;
    if (p.assist) this.settings.assist = true;
    if (p.seed !== null) this.seed = p.seed;
    if (p.autopilot) this.autopilot = p.autopilot;
    if (p.unlock) this.save.patch({ unlocked: availableChapters() });
  }

  // ——————————————————— 启动 ———————————————————
  async boot(canvas: HTMLCanvasElement, uiRoot: HTMLElement, appRoot: HTMLElement): Promise<void> {
    const solver = getSolver();
    const sf = getSimFactory();
    const vf = getViewFactory();
    const af = getAudioFactory();
    const inf = getInputFactory();
    const uf = getUIFactory();
    if (!solver || !sf || !vf || !af || !inf || !uf) throw new Error('Game.boot: a required package did not register (sim/solver/view/audio/input/ui)');
    this.solver = solver;
    this.sim = sf(solver);
    this.sim.setAssist?.(this.settings.assist);
    this.quality = this.params.q ?? (this.settings.quality === 'auto' ? 'medium' : this.settings.quality);
    this.view = vf();
    await this.view.init(canvas, this.bus, this.settings);
    this.audio = af(this.bus, this.settings, this.params.mute);
    this.audio.setVolumes({ master: this.settings.master, sfx: this.settings.sfx, ambience: this.settings.ambience });
    this.input = inf();
    this.input.attach(appRoot);
    this.ui = uf();
    this.ui.mount(uiRoot, this, this.save);
    const settingsEv = { type: 'settings', tick: 0, data: { ...this.settings } } as GameEvent;
    (this.ui as UIExt).setQualityTier?.(this.quality);
    if (this.settings.quality === 'auto' && !this.params.q && !this.params.test) this.autoQ = new AutoQuality(!coarsePointer());
    if (typeof window !== 'undefined' && !this.params.test) {
      // U4：失焦不只在那一刻判断。开场卡、读章、失败卡（自动重来）期间切走窗口，回到游玩时也要停住（enterPlay）。
      const leave = () => { this.away = true; if (this.screenName === 'play') this.pause(true); };
      const back = () => { this.away = false; };
      window.addEventListener('blur', leave);
      window.addEventListener('focus', back);
      window.addEventListener('pointerdown', back, { capture: true });
      window.addEventListener('keydown', back, { capture: true });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) leave();
        else if (typeof document.hasFocus !== 'function' || document.hasFocus()) back();
      });
    }
    if (typeof window !== 'undefined') {
      const unlock = () => { void this.audio.unlock(); };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
    this.loop.manual = this.params.test;
    // 标题背景：先读第一章（或 URL 指定的章）
    const first = this.params.ch ?? availableChapters()[0] ?? 'ch1';
    await this.loadChapter(first, this.params.seg ? { segment: this.params.seg, beat: this.params.beat ?? 0 } : undefined);
    this.ui.onEvent(settingsEv, this.next);
    this.booted = true;
    if (this.params.ch) {
      const o: StartOptions = { skipCards: this.params.nocards || this.params.test };
      if (this.params.seg) o.segment = this.params.seg;
      if (this.params.beat !== null) o.beat = this.params.beat;
      await this.startWith(this.params.ch, o, true);
    } else this.setScreen('title');
    this.renderFrame(1, 0);
    this.loop.start();
    this.readyResolve();
  }

  private async loadChapter(ch: ChapterId, at?: { segment: string; beat: number }): Promise<void> {
    this.applyPendingQuality();
    const def = getChapter(ch);
    if (!def) throw new Error(`chapter ${ch} is not implemented`);
    const seed = this.seed ?? def.seed;
    const same = this.compiled && this.compiled.def.id === ch && this.compiled.seed === seed;
    const compiled = same ? (this.compiled as CompiledChapter) : compile(def, seed);
    this.compiled = compiled;
    this.chapterId = ch;
    this.sim.load(compiled, at, seed);
    this.sim.setAutopilot(this.autopilot);
    if (!same) await this.view.loadChapter(compiled);
    this.next = this.sim.snapshot();
    this.prev = this.next;
    this.dispatchAll();
    this.prev = this.next;
    this.view.onReset(this.next);
    this.failing = null; this.loop.slowMul = 1;
    this.texts = []; this.hint = null;
    this.outroBeats.length = 0;
    this.dirty = true;
  }

  // ——————————————————— GameCommands ———————————————————
  async start(ch: ChapterId, at?: { segment: string; beat: number }): Promise<void> {
    const o: StartOptions = { skipCards: this.params.nocards };
    if (at) { o.segment = at.segment; o.beat = at.beat; }
    await this.startWith(ch, o, false);
  }

  async startWith(ch: ChapterId, o: StartOptions = {}, reuse = false): Promise<void> {
    if (this.titleReset) await this.titleReset;
    const at = o.segment ? { segment: o.segment, beat: o.beat ?? 0 } : undefined;
    if (!reuse || !this.compiled || this.compiled.def.id !== ch) await this.loadChapter(ch, at);
    else if (at) { this.sim.goto(at.segment, at.beat); this.afterJump(); }
    this.outroBeats.length = 0;
    this.paused = false;
    this.failing = null; this.loop.slowMul = 1;
    const def = getChapter(ch);
    if (o.skipCards || !def) { this.enterPlay(); }
    else {
      this.introT = 0;
      this.setScreen('intro', { chapter: ch, title: def.title, name: def.name, lines: def.card.map((l) => lineText(l)) });
    }
    this.save.patch({ last: { chapter: ch, segment: this.next.checkpoint.segment, beat: this.next.checkpoint.beat } });
    this.loop.resetClock();
  }

  async continueGame(): Promise<void> {
    const last = this.save.load().last;
    if (!last || !getChapter(last.chapter)) { await this.start(availableChapters()[0] ?? 'ch1'); return; }
    await this.start(last.chapter, { segment: last.segment, beat: last.beat });
  }

  retry(): void {
    if (!this.compiled) return;
    this.applyPendingQuality();
    this.sim.retry();
    this.afterJump();
    this.failing = null; this.loop.slowMul = 1;
    // lead 集成（WP7 契约申请）：从暂停菜单重来时结束暂停并恢复声音
    if (this.paused) { this.paused = false; this.audio.suspend(false); }
    this.loop.resetClock();
    this.enterPlay();
  }

  /** 进入游玩（开场卡结束、跳过开场卡、重来）。窗口不在前台时立即暂停（test 模式下 away 永远为假）。 */
  private enterPlay(): void {
    this.setScreen('play');
    if (this.away) this.pause(true);
  }

  /** goto / retry 之后：同步快照、画面复位。 */
  afterJump(): void {
    this.next = this.sim.snapshot();
    this.dispatchAll();
    this.prev = this.next;
    this.view.onReset(this.next);
    this.texts = []; this.hint = null;
    this.dirty = true;
  }

  pause(on: boolean): void {
    if (on && this.screenName === 'play' && !this.failing) {
      this.paused = true;
      // 定格在最后一次模拟状态，不能继续在最后两个 tick 之间往返插值；恢复首帧也不能回跳。
      this.prev = this.next;
      // 同一个检查点连续失败 3 次后，暂停菜单里安静地多出「放慢一点」（§2.7）
      this.setScreen('pause', { slowAvailable: this.failCountAtCheckpoint() >= 3, slowOn: this.next.slowOption });
      this.audio.suspend(true);
    }
    else if (!on && (this.screenName === 'pause' || this.screenName === 'settings') && this.paused) {
      this.paused = false; this.setScreen('play'); this.audio.suspend(false); this.loop.resetClock();
    }
  }

  toTitle(): void { void this.enterTitle(); }

  /**
   * 回到标题（暂停菜单、失败卡「返回」、结尾卡、演职卡结束都走这里；U4）。标题背景复位到首章开头：
   * 当前不是首章就读首章，是首章就跳回第一段开头；失败、慢放、暂停一并清掉，镜头随 view.onReset 回到追尾机位。
   * 复位完成后才切到标题：复位期间屏幕还是原来的（失败卡 / 暂停 / 结尾卡），读章发出的 checkpoint 不会写进「继续」，
   * 而声音包先收到 chapter:start / segment，再收到标题屏（U3 在标题屏上淡出环境声）。
   */
  enterTitle(): Promise<void> {
    if (this.titleReset) return this.titleReset;
    if (this.paused) this.audio.suspend(false);    // lead 集成（WP7 契约申请）：暂停菜单「回到标题」恢复声音
    this.paused = false; this.failing = null; this.loop.slowMul = 1;
    let finish!: () => void;
    const run = new Promise<void>((r) => { finish = r; });
    this.titleReset = run;              // 先挂上：同一章时下面是同步跑完的
    void (async () => {
      try {
        const first = availableChapters()[0] ?? 'ch1';
        const seg0 = this.compiled?.segments[0]?.def.id;
        if (this.compiled && this.chapterId === first && seg0) {
          this.applyPendingQuality();
          this.sim.goto(seg0, 0);
          this.afterJump();
          this.outroBeats.length = 0;
        } else await this.loadChapter(first);
      } catch (err) {
        console.error('[title] scene reset failed', err);
      } finally {
        this.failing = null; this.loop.slowMul = 1;
        this.titleReset = null;
        this.setScreen('title');
        finish();
      }
    })();
    return run;
  }

  /**
   * 结尾卡输入（OutroDef.lines 的 { input, id }，第四章 fingerPractice；lead 集成，WP1 / WP2 / WP8 契约申请）。
   * 界面每输入一次调用一次（n = 第几下）；n = 0 表示超时自动完成。每一下在床单上响一声；
   * 有 id 时第一次调用就记进本章已触发的节拍（__game.beats()），并写一条 beat 事件进日志。
   */
  outroInput(id: string | undefined, n: number): void {
    if (this.screenName !== 'outro') return;
    if (n > 0 && this.compiled && this.view.context) this.onCue({ body: { type: 'sfx', sfx: 'cloth', gain: -4 }, segment: this.next.segment }, this.next);
    if (id && !this.outroBeats.includes(id)) {
      this.outroBeats.push(id);
      this.log.push({ tick: this.next.tick, type: 'beat', data: { id } });
      this.bus.emit('beat', { id });
    }
  }
  /** 结尾卡上触发的必备节拍（模拟已经结束，不在 beatsFired 里）。 */
  readonly outroBeats: string[] = [];

  nextChapter(): void {
    const n = this.chapterId ? nextChapterOf(this.chapterId) : null;
    if (n) void this.start(n); else this.setScreen('credits');
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.settings[k] = v;
    storeSettings(this.settings);
    if (k === 'quality') {
      // U4：选「自动」重新开始统计（以前会把 autoQ 置空，钉在中档）；手选的档位立即生效（在菜单里，卡一下没关系）
      const t = v as Settings['quality'];
      const tier: QualityTier = t === 'auto' ? 'medium' : t;
      this.pendingQ = null;
      if (tier !== this.quality) this.setQuality(tier);
      this.autoQ = t === 'auto' && !this.params.q && !this.params.test ? new AutoQuality(!coarsePointer()) : null;
    }
    if (k === 'master' || k === 'sfx' || k === 'ambience') this.audio.setVolumes({ master: this.settings.master, sfx: this.settings.sfx, ambience: this.settings.ambience });
    if (k === 'assist') this.sim.setAssist?.(v as boolean);
    if (k === 'swipe') (this.input as InputAPI & { setSwipeThreshold?: (l: Settings['swipe']) => void }).setSwipeThreshold?.(v as Settings['swipe']);
    const ev = { type: 'settings', tick: this.next?.tick ?? 0, data: { ...this.settings } } as GameEvent;
    this.bus.emit('settings', { ...this.settings });
    this.ui.onEvent(ev, this.next);
    this.dirty = true;
  }

  resetProgress(): void { this.save.reset(); }

  skipStill(): void {
    if (!this.compiled || this.next.segKind === 'run') return;
    (this.ui as UIExt).noteSkip?.();               // U4：界面在跳过之后的 segment 事件里清掉上一段的字幕、纸条翻看和提示
    this.sim.skipStill?.();
    this.next = this.sim.snapshot();
    this.dispatchAll();
    this.dirty = true;
  }

  setSlowOption(on: boolean): void {
    this.sim.setSlowOption(on);
    this.next = { ...this.next, slowOption: on };
    this.dirty = true;
  }

  setQuality(t: QualityTier): void {
    this.quality = t;
    this.view.setQuality(t);
    this.bus.emit('quality', { tier: t });
    (this.ui as UIExt | undefined)?.setQualityTier?.(t);   // 颗粒层按实际档位开关（§9.4 low 不要颗粒）
    this.dirty = true;
  }

  private isDreamStand(index: number): boolean {
    const seg = this.compiled?.segments[index];
    return seg?.kind === 'stand' && (seg.def as StandSegmentDef).script === 'dream';
  }

  /** 自动画质的决定在这里才真正生效（不跑的时刻）。 */
  private applyPendingQuality(): void {
    const t = this.pendingQ;
    this.pendingQ = null;
    if (t && t !== this.quality) this.setQuality(t);
  }

  // ——————————————————— 屏幕 ———————————————————
  setScreen(name: ScreenName, data?: unknown): void {
    this.screenName = name;
    this.ui.show(name, data);
    this.bus.emit('screen', { name });
    this.updateInputContext();
    this.dirty = true;
  }

  private updateInputContext(): void {
    if (!this.input) return;
    const play = this.screenName === 'play' && !this.failing;
    const kind = play ? this.next.segKind : 'menu';
    const look = play && this.ctxLook;
    const ask = play && this.ctxAsk;          // lead 集成（WP1 / WP8 契约申请）：读 prompt 的 context.ask
    this.input.setContext({ kind, look, ask, standHalves: this.next.player.stand?.phase === 'walking' });
  }
  private ctxLook = false;
  private ctxAsk = false;

  // ——————————————————— 主循环 ———————————————————
  /** 推进 1 tick（1/120 s 游戏时间）。 */
  tick(): void {
    if (!this.booted || this.titleReset) return;
    const evs = this.input.drain();
    const downs = evs.filter((e) => e.phase === 'down');
    for (const e of downs) {
      if (e.action === 'pause' && (this.screenName === 'play' || this.screenName === 'pause')) {
        this.pause(this.screenName === 'play');
        return;
      }
    }
    switch (this.screenName) {
      case 'intro': {
        this.introT += TICK_DT;
        if (this.introT >= INTRO_SEC || downs.some((e) => e.action !== 'pause')) this.enterPlay();
        break;
      }
      case 'play': {
        if (downs.some((e) => e.action === 'skip') && this.next.segKind !== 'run' && this.seenStills.has(this.next.segment)) this.skipStill();
        this.stepSim(evs);
        if (this.failing) {
          this.failing.t += TICK_DT;
          // §2.7 失败演出第 1 步：0–0.3 s 时间放慢到 0.3 倍（只影响实时推进；test 模式的 step() 不受影响）。
          this.loop.slowMul = this.failing.t < FAIL_SLOW_SEC ? FAIL_SLOW_MUL : 1;
          if (!this.failing.shown && this.failing.t >= FAIL_CARD_SEC) { this.failing.shown = true; this.setScreen('fail', { line: this.failing.line }); }
        }
        break;
      }
      case 'fail': {
        this.stepSim([]);
        if (this.failing) {
          this.failing.t += TICK_DT;
          const ready = this.failing.t >= FAIL_INPUT_SEC;
          if (ready && (this.settings.autoRetry || downs.length > 0)) this.retry();
        }
        break;
      }
      default: break;
    }
    for (const a of this.pendingUp) this.input.inject(a, 'up');
    this.pendingUp = [];
    if (!this.paused) this.dirty = true;
  }

  private stepSim(evs: readonly InputEvent[]): void {
    const tNow = this.next.t * 1000;
    const wall = nowMs();
    const simEvents: InputEvent[] = [];
    for (const e of evs) {
      if (!GAMEPLAY.has(e.action)) continue;
      const back = Math.min(100, Math.max(0, wall - e.t));
      simEvents.push({ ...e, t: tNow - back });
    }
    this.sim.step(simEvents, this.input.held());
    this.prev = this.next;
    this.next = this.sim.snapshot();
    this.input.setFlip(this.next.flip);
    this.dispatchAll();
  }

  private dispatchAll(): void {
    const out = this.sim.drain();
    for (const e of out) this.dispatch(e);
  }

  private dispatch(e: GameEvent): void {
    const snap = this.next;
    this.bus.tick = e.tick;
    this.log.push({ tick: e.tick, type: e.type, data: e.data });
    if (this.log.length > 4096) this.log.splice(0, this.log.length - 4096);
    this.bus.emit(e.type as GameEventName, e.data as GameEvents[GameEventName]);
    if (e.type === 'cue') this.onCue(e.data, snap);
    this.audio.onEvent(e, snap);
    this.ui.onEvent(e, snap);
    this.view.onEvent(e, snap);
    switch (e.type) {
      case 'fall': this.onFall(e.data); break;
      case 'chapter:end': this.onChapterEnd(e.data); break;
      case 'checkpoint':
        // 只在真正游玩时记录「继续」的位置（标题背景读章时也会发 checkpoint）
        if (this.chapterId && this.chapterId !== 'test' && (this.screenName === 'play' || this.screenName === 'intro')) {
          this.save.patch({ last: { chapter: this.chapterId, ...e.data } });
        }
        break;
      case 'segment':
        this.ctxLook = false; this.ctxAsk = false; this.updateInputContext();
        // 静场 / 站立段开头是镜头切换，重建 chunk 的那一下卡顿被切换盖住。梦里的站立（4-2 → 4-3）从爬行直接起身、没有黑场
        // （ui/hud/overlays.ts 的 segmentCut，§10.4），在那里切档会在最快的跑段和「我站起来。」之间卡一下：留到 4-4 的静场再切。
        if (e.data.kind !== 'run' && !this.isDreamStand(e.data.index)) this.applyPendingQuality();
        break;
      case 'prompt': this.ctxLook = e.data.context.look; this.ctxAsk = e.data.context.ask; this.updateInputContext();
        if (e.data.hint) this.hint = { id: e.data.hint, until: snap.t + 30 }; else this.hint = null;
        break;
      case 'note': {
        const sv = this.save.load();
        if (!sv.notes.includes(e.data.id)) this.save.patch({ notes: [...sv.notes, e.data.id] });
        break;
      }
      default: break;
    }
  }

  private onCue(cue: GameEvents['cue'], snap: SimSnapshot): void {
    const ch = this.compiled;
    const seg = ch?.segments[snap.segIndex];
    const ctxView = this.view.context;
    if (ctxView && seg) {
      const ctx: CueContext = { view: ctxView, snap, segment: seg, emit: (body: EventBody) => this.onCue({ body, segment: cue.segment }, snap) };
      this.cues.dispatch(cue, ctx);
    }
    const b = cue.body;
    if (b.type === 'text' && b.style !== 'board') {
      const ids = (Array.isArray(b.line) ? b.line : [b.line]) as LineId[];
      const text = ids.map((i) => lineText(i)).join('');
      const dur = (Array.from(text).length * TEXT.msPerChar + TEXT.baseMs) / 1000;
      this.texts.push({ text, until: snap.t + dur });
      while (this.texts.length > TEXT.maxLines) this.texts.shift();
    }
    if (b.type === 'hint') this.hint = { id: b.hint, until: snap.t + 3.2 };
  }

  private onFall(d: GameEvents['fall']): void {
    const key = `${this.next.checkpoint.segment}@${this.next.checkpoint.beat}`;
    const n = (this.failsAt.get(key) ?? 0) + 1;
    this.failsAt.set(key, n);
    this.failing = { t: 0, line: lineText(failLineId(this.chapterId, d.surface, d.cause)), shown: false };
    this.updateInputContext();
  }

  /** 同一个检查点连续失败次数（暂停菜单「放慢一点」用，§2.7）。 */
  failCountAtCheckpoint(): number {
    return this.failsAt.get(`${this.next.checkpoint.segment}@${this.next.checkpoint.beat}`) ?? 0;
  }

  private onChapterEnd(d: GameEvents['chapter:end']): void {
    const def = getChapter(d.id);
    const next = nextChapterOf(d.id);
    const sv = this.save.load();
    if (next) this.save.patch({ unlocked: Array.from(new Set([...sv.unlocked, next])), last: null });
    else this.save.patch({ last: null });
    const pickups = def ? def.notes.filter((n) => n.pickup).map((n) => n.id) : [];
    const got = pickups.filter((id) => d.stats.notes.includes(id)).length;
    const lines = def ? def.outro.lines.flatMap((l) => ('line' in l ? [lineText(l.line)] : [])) : [];
    this.failing = null; this.loop.slowMul = 1;
    this.setScreen('outro', { chapter: d.id, stats: d.stats, next, lines, notes: { got, total: pickups.length } });
    for (const s of this.compiled?.segments ?? []) if (s.kind !== 'run') this.seenStills.add(s.def.id);
  }

  // ——————————————————— 渲染 ———————————————————
  private onFrame(alpha: number, dt: number): void {
    if (!this.booted) return;
    if (this.loop.manual && !this.dirty) return;
    this.renderFrame(alpha, dt);
    if (this.autoQ && this.screenName === 'play' && dt > 0) {
      const t = this.autoQ.sample(dt);
      if (t) this.pendingQ = t !== this.quality ? t : null;   // 只记下决定；跑段中途不重建（U4）
    }
  }

  renderFrame(alpha: number, dt: number): void {
    const prev = this.prev, next = this.next;
    // 暂停仍处理菜单和重绘，但不推进镜头、姿势等表现状态；设置变更时只刷新一次。
    if (!this.paused || this.dirty) this.view.frame(prev, next, alpha, this.paused ? 0 : dt);
    // U4：不透明的启动屏、开场卡、结尾卡、演职卡背后不画 3D（test 模式照常画）；复位标题背景期间停在离开时那一帧
    if (!this.titleReset && (this.loop.manual || !OPAQUE_SCREENS.has(this.screenName))) this.view.render();
    this.audio.frame(next, dt);
    // lead 集成（WP8 契约申请）：先把最后一次输入的设备交给界面，再画界面，本帧的提示文字就是对的设备
    (this.ui as UIExt).setDevice?.(this.input.device());
    this.ui.frame(next, dt);
    this.dirty = false;
  }

  // ——————————————————— 测试钩子用 ———————————————————
  stepTicks(n: number, render: boolean): void {
    for (let i = 0; i < n; i++) this.tick();
    if (render) this.renderFrame(1, n * TICK_DT);
  }
  tapAction(a: Action): void { this.input.inject(a, 'down'); this.pendingUp.push(a); }
  currentText(): string[] { const t = this.next?.t ?? 0; this.texts = this.texts.filter((x) => x.until > t); return this.texts.map((x) => x.text); }
  currentHint(): HintId | null { const t = this.next?.t ?? 0; if (this.hint && this.hint.until < t) this.hint = null; return this.hint?.id ?? null; }
  isRunSegment(): boolean { return this.compiled?.segments[this.next.segIndex]?.kind === 'run'; }
  segmentDef(): RunSegmentDef | null {
    const s = this.compiled?.segments[this.next.segIndex];
    return s && s.kind === 'run' ? (s.def as RunSegmentDef) : null;
  }
}

/** 失败卡句子（附录 B.5，按顺序匹配第一条）。 */
export function failLineId(ch: ChapterId | null, surface: Surface, cause: string): LineId {
  if (ch === 'ch4') return 'fail.dream';
  if (surface === 'rubber') return 'fail.rubber';
  if (surface === 'asphaltWet') return 'fail.rain';
  if (surface === 'water' || surface === 'leavesWet' || cause === 'mopBucket') return 'fail.wet';
  return 'fail.knee';
}
