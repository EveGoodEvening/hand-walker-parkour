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
import type { CompiledChapter, EventBody, RunSegmentDef } from '../levels/schema';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const GAMEPLAY: ReadonlySet<Action> = new Set(['left', 'right', 'up', 'down', 'look', 'ask']);
/** 开场卡：小字 → 0.6 s 章名 → 0.6 s 开场句 → 停留 2.2 s（§7.2）。 */
const INTRO_SEC = 3.4;
const FAIL_CARD_SEC = 1.0;
const FAIL_INPUT_SEC = 1.2;

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
    if (this.settings.quality === 'auto' && !this.params.q && !this.params.test) {
      const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
      this.autoQ = new AutoQuality(!touch);
    }
    if (typeof window !== 'undefined') {
      const autoPause = () => { if (this.screenName === 'play' && !this.params.test) this.pause(true); };
      window.addEventListener('blur', autoPause);
      document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
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
    this.failing = null;
    this.texts = []; this.hint = null;
    this.dirty = true;
  }

  // ——————————————————— GameCommands ———————————————————
  async start(ch: ChapterId, at?: { segment: string; beat: number }): Promise<void> {
    const o: StartOptions = { skipCards: this.params.nocards };
    if (at) { o.segment = at.segment; o.beat = at.beat; }
    await this.startWith(ch, o, false);
  }

  async startWith(ch: ChapterId, o: StartOptions = {}, reuse = false): Promise<void> {
    const at = o.segment ? { segment: o.segment, beat: o.beat ?? 0 } : undefined;
    if (!reuse || !this.compiled || this.compiled.def.id !== ch) await this.loadChapter(ch, at);
    else if (at) { this.sim.goto(at.segment, at.beat); this.afterJump(); }
    this.paused = false;
    this.failing = null;
    const def = getChapter(ch);
    if (o.skipCards || !def) { this.setScreen('play'); }
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
    this.sim.retry();
    this.afterJump();
    this.failing = null;
    this.setScreen('play');
    this.loop.resetClock();
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
      // 同一个检查点连续失败 3 次后，暂停菜单里安静地多出「放慢一点」（§2.7）
      this.setScreen('pause', { slowAvailable: this.failCountAtCheckpoint() >= 3, slowOn: this.next.slowOption });
      this.audio.suspend(true);
    }
    else if (!on && (this.screenName === 'pause' || this.screenName === 'settings') && this.paused) {
      this.paused = false; this.setScreen('play'); this.audio.suspend(false); this.loop.resetClock();
    }
  }

  toTitle(): void { this.paused = false; this.failing = null; this.setScreen('title'); }

  nextChapter(): void {
    const n = this.chapterId ? nextChapterOf(this.chapterId) : null;
    if (n) void this.start(n); else this.setScreen('credits');
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.settings[k] = v;
    storeSettings(this.settings);
    if (k === 'quality') {
      const t = v as Settings['quality'];
      this.setQuality(t === 'auto' ? 'medium' : t);
      this.autoQ = null;
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
    this.dirty = true;
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
    this.input.setContext({ kind, look, ask: false, standHalves: this.next.player.stand?.phase === 'walking' });
  }
  private ctxLook = false;

  // ——————————————————— 主循环 ———————————————————
  /** 推进 1 tick（1/120 s 游戏时间）。 */
  tick(): void {
    if (!this.booted) return;
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
        if (this.introT >= INTRO_SEC || downs.some((e) => e.action !== 'pause')) this.setScreen('play');
        break;
      }
      case 'play': {
        if (downs.some((e) => e.action === 'skip') && this.next.segKind !== 'run' && this.seenStills.has(this.next.segment)) this.skipStill();
        this.stepSim(evs);
        if (this.failing) {
          this.failing.t += TICK_DT;
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
    this.dirty = true;
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
      case 'segment': if (e.data.kind !== 'run') { /* 第一次看完之后才允许跳过 */ }
        this.ctxLook = false; this.updateInputContext(); break;
      case 'prompt': this.ctxLook = e.data.context.look; this.updateInputContext();
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
    this.failing = null;
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
      if (t && t !== this.quality) this.setQuality(t);
    }
  }

  renderFrame(alpha: number, dt: number): void {
    const prev = this.prev, next = this.next;
    this.view.frame(prev, next, alpha, dt);
    this.view.render();
    this.audio.frame(next, dt);
    this.ui.frame(next, dt);
    (this.ui as UIAPI & { setDevice?: (d: string) => void }).setDevice?.(this.input.device());
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
