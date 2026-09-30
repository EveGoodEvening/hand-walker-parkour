// src/ui/UI.ts —— 界面（DESIGN.md §7、§8.4 UIAPI、§8.7 WP8 负责的事件与 cue）。WP8。
// 流程：Boot → Title（章节 / 设置 / 纸条）→ Intro → Play ⇄ Pause → Fail → Play；Outro → 下一章 | Title；第五章之后 Credits → Title。
// 界面切换（show）直接写 DOM；游玩中的一切画面更新（HUD、叠加层、canvas 的 filter 与翻转）都先写进模型，
// 在 frame() 末尾经 DomBatch 一次写完（§7 总则「每帧对 DOM 的写入合并成最多一次」）。
// 所有计时用模拟时间（snap.t），?test=1 下 step() 之后截图稳定；只有菜单里的淡入动画是 CSS（真实时间）。
import type { GameCommands, UIAPI } from '../core/contracts';
import { FOLLOWER_MIX } from '../core/constants';
import type { GameEvent } from '../core/events';
import type { CueContext } from '../core/registry';
import type { SaveAPI } from '../core/save';
import type { Settings } from '../core/settings';
import type { ChapterId, Device, HintId, ScreenName, SimSnapshot, Speaker, TextStyle } from '../core/types';
import { urlParams } from '../core/urlParams';
import { availableChapters, getChapter } from '../levels/chapters/index';
import { LINES, lineText, type LineEntry } from '../levels/lines';
import type { EventBody } from '../levels/schema';
import { Input } from '../input/Input';
import { DomBatch, h } from './dom';
import { Hud, type HintSource } from './hud/Hud';
import { OverlayState, type OverlayOp } from './hud/overlays';
import { chapterProgress } from './hud/progress';
import { buildCredits, buildFail, buildIntro, buildPause, type FailData, type IntroData, type OutroData, type PauseData } from './screens/cards';
import { moveFocus, ScreenEl } from './screens/menus';
import { NotesScreen, noteDef } from './screens/notes';
import { OutroScreen } from './screens/outro';
import { SettingsScreen } from './screens/settings';
import { buildChapters, buildTitle, chapterDone, chapterRows } from './screens/title';
import { UiStore } from './store';
import { ALWAYS_HINTS, CHAPTER_NAMES, STR } from './strings';

export type { FailData, IntroData, OutroData };

/** 失败卡：摔倒后 1.2 s（模拟时间）起接受输入并显示提示（§2.7）。 */
export const FAIL_PROMPT_SEC = 1.2;
/** 长按 Enter / 「跳过」0.6 s 跳过静场（§2.2）。 */
export const SKIP_HOLD_SEC = 0.6;
/** 教学提示显示多久（秒）；prompt 类提示一直显示到 prompt 撤销。 */
export const HINT_SEC = 3.2;
/** 第一次撞到人腿后多久出现低语（附录 B.5）。 */
export const HABIT_DELAY = 1.0;
/** 「让一下。」之后多久出现低语（§4.2 2-2）。 */
export const ASK_WHISPER_DELAY = 0.8;

const MENU_SCREENS: ReadonlySet<ScreenName> = new Set(['title', 'chapters', 'settings', 'notes', 'pause', 'outro', 'credits', 'fail']);
const HUD_SCREENS: ReadonlySet<ScreenName> = new Set(['play', 'pause']);
const GAME_SCREENS: ReadonlySet<ScreenName> = new Set(['play', 'pause', 'fail']);

/** 按文字找 LineId（第二章「让一下。」这类由 WP2 收录、键名未知的句子）。 */
export function lineIdByText(t: string): string | null {
  for (const [k, v] of Object.entries(LINES as Record<string, LineEntry>)) if (v.t === t) return k;
  return null;
}

function vibrate(ms: number): void {
  try { (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(ms); } catch { /* 不支持 */ }
}

export class UI implements UIAPI {
  private root!: HTMLElement;
  private cmd!: GameCommands;
  private save!: SaveAPI;
  hud!: Hud;
  readonly batch = new DomBatch();
  readonly overlays = new OverlayState();
  readonly store = new UiStore();
  private screens = new Map<ScreenName, ScreenEl>();
  private current: ScreenName = 'boot';
  private settings: Settings | null = null;
  private settingsReturn: ScreenName = 'title';
  private canvas: HTMLElement | null = null;
  private layers!: { vignette: HTMLDivElement; grain: HTMLDivElement; cold: HTMLDivElement; heat: HTMLDivElement; black: HTMLDivElement };
  private device: Device = 'keyboard';
  private snap: SimSnapshot | null = null;
  private chapter: ChapterId | null = null;
  private settingsScreen!: SettingsScreen;
  private notesScreen!: NotesScreen;
  private outroScreen!: OutroScreen;
  private pauseData: PauseData = {};
  private lastOutro: OutroData | null = null;
  // 失败
  private fallT = -1;
  private failEls: { prompt: HTMLDivElement; actions: HTMLDivElement } | null = null;
  private failReady = false;
  // 跳过静场
  private readonly seenStills = new Set<string>();
  private prevSeg: { id: string; kind: 'run' | 'still' | 'stand' } | null = null;
  private enterAt: number | null = null;
  private skipAt: number | null = null;
  private skipDone = '';
  // 延后执行（模拟时间）
  private scheduled: Array<{ at: number; fn: () => void }> = [];
  private creditsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStandHalves = false;
  /** 调试（__game.ext.uiFlip）：不经模拟强制画面翻转，只用于截图。 */
  forceFlip = false;

  // ——————————————————— 挂载 ———————————————————
  mount(root: HTMLElement, cmd: GameCommands, save: SaveAPI): void {
    this.root = root; this.cmd = cmd; this.save = save;
    this.canvas = (typeof document !== 'undefined' && document.getElementById('game')) || null;
    // 叠加层在 HUD 下面：黑场、闭眼时字幕照常可读（1-6「掌心擦过地面的声音……」出现在黑场上）
    this.layers = {
      vignette: h('div', 'hw-layer hw-vignette', undefined, root),
      grain: h('div', 'hw-layer hw-grain', undefined, root),
      cold: h('div', 'hw-layer hw-cold', undefined, root),
      heat: h('div', 'hw-layer hw-heat', undefined, root),
      black: h('div', 'hw-layer hw-black', undefined, root),
    };
    this.makeGrain();
    this.hud = new Hud(root, () => cmd.pause(true));
    this.hud.skipBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.skipAt = this.snap?.t ?? 0; });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.hud.skipBtn.addEventListener(ev, () => { this.skipAt = null; });
    for (const n of ['boot', 'title', 'chapters', 'settings', 'notes', 'intro', 'pause', 'fail', 'outro', 'credits'] as ScreenName[]) {
      this.screens.set(n, new ScreenEl(root, n, n === 'boot' || n === 'intro' || n === 'credits' || n === 'outro'));
    }
    h('div', 'hw-card hw-boot', '……', this.el('boot'));
    this.settingsScreen = new SettingsScreen(this.el('settings'), {
      set: (k, v) => cmd.setSetting(k, v),
      reset: () => { cmd.resetProgress(); this.store.reset(); this.hud.subs.forgetSeen(); this.seenStills.clear(); },
      back: () => this.show(this.settingsReturn),
    });
    this.notesScreen = new NotesScreen(this.el('notes'), () => this.show('title'));
    this.outroScreen = new OutroScreen(this.el('outro'), {
      next: () => cmd.nextChapter(), replay: () => { const c = this.lastOutro?.chapter; if (c) void cmd.start(c); },
      toTitle: () => cmd.toTitle(), device: () => this.device,
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('keyup', (e) => this.onKeyUp(e));
      this.el('outro').addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement | null)?.closest?.('button')) return;
        this.outroScreen.press('down');
      });
    }
    const inp = Input.active;
    if (inp) inp.hooks.escape = () => this.onEscape();
    this.show('boot');
  }

  private el(n: ScreenName): HTMLDivElement { return (this.screens.get(n) as ScreenEl).el; }

  private makeGrain(): void {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d');
      if (!g) return;
      const img = g.createImageData(96, 96);
      let s = 1234567;
      for (let i = 0; i < img.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const v = (s >> 16) & 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.layers.grain.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
    } catch { /* 没有 2D canvas（单元测试）就不要颗粒 */ }
  }

  // ——————————————————— 键盘 ———————————————————
  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!e.repeat && this.current === 'play') this.enterAt = this.snap?.t ?? 0; }
    const sc = this.screens.get(this.current);
    if (this.current === 'outro' && this.outroScreen.awaitingInput) {
      const down = e.code === 'ArrowDown' || e.code === 'KeyS';
      if (!e.repeat && this.outroScreen.press(down ? 'down' : 'any')) { e.preventDefault(); return; }
    }
    if (!sc || !MENU_SCREENS.has(this.current)) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { moveFocus(sc, 1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { moveFocus(sc, -1); e.preventDefault(); }
    else if ((e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') && this.current === 'settings') {
      if (this.settingsScreen.adjustFocused(e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1)) e.preventDefault();
    } else if (e.code === 'Backspace') { if (this.onEscape()) e.preventDefault(); }
  }
  private onKeyUp(e: KeyboardEvent): void { if (e.code === 'Enter' || e.code === 'NumpadEnter') this.enterAt = null; }

  /** Esc / 退格：子界面返回上一级。返回 true 表示已处理（Input 不再发 pause）。 */
  onEscape(): boolean {
    switch (this.current) {
      case 'settings': this.show(this.settingsReturn); return true;
      case 'notes': if (!this.notesScreen.close()) this.show('title'); return true;
      case 'chapters': this.show('title'); return true;
      case 'credits': this.cmd.toTitle(); return true;
      default: return false;
    }
  }

  // ——————————————————— 界面 ———————————————————
  show(s: ScreenName, data?: unknown): void {
    const prev = this.current;
    this.current = s;
    if (prev === 'outro' && s !== 'outro') this.outroScreen.dispose();
    if (this.creditsTimer && s !== 'credits') { clearTimeout(this.creditsTimer); this.creditsTimer = null; }
    switch (s) {
      case 'title': buildTitle(this.el('title'), this.save, {
        onContinue: () => void this.cmd.continueGame(), onStart: () => void this.cmd.start(this.firstPlayable()),
        onChapters: () => this.show('chapters'), onSettings: () => { this.settingsReturn = 'title'; this.show('settings'); }, onNotes: () => this.show('notes'),
      }); break;
      case 'chapters': buildChapters(this.el('chapters'), chapterRows(this.save.load(), this.store.data.completed), (c) => void this.cmd.start(c), () => this.show('title')); break;
      case 'settings': if (this.settings) this.settingsScreen.build(this.settings); break;
      case 'notes': this.notesScreen.build(this.save.load()); break;
      case 'intro': buildIntro(this.el('intro'), data as IntroData | undefined); break;
      case 'pause': this.buildPause(data as PauseData | undefined, prev); break;
      case 'fail': this.buildFail(data as FailData | undefined); break;
      case 'outro': this.lastOutro = data as OutroData; if (this.lastOutro) this.outroScreen.build(this.lastOutro); break;
      case 'credits': buildCredits(this.el('credits'), () => this.cmd.toTitle());
        this.creditsTimer = setTimeout(() => { if (this.current === 'credits') this.cmd.toTitle(); }, (0.4 + 3 * 1.2 + 3) * 1000);
        break;
      default: break;
    }
    for (const [n, sc] of this.screens) sc.show(n === s);
    this.hud.root.classList.toggle('on', HUD_SCREENS.has(s));
    if (s === 'play') this.failEls = null;
  }

  private firstPlayable(): ChapterId { return availableChapters()[0] ?? 'ch1'; }

  private buildPause(d: PauseData | undefined, prev: ScreenName): void {
    if (d || prev !== 'settings') this.pauseData = { ...(d ?? {}) };
    const snap = this.snap;
    const def = snap ? getChapter(snap.chapter) : null;
    const prog = def && snap ? chapterProgress(def, { segIndex: snap.segIndex, segBeat: snap.segBeat, stillT: snap.still?.t ?? 0 }) : null;
    buildPause(this.el('pause'), this.pauseData, prog, {
      resume: () => this.cmd.pause(false), retry: () => this.cmd.retry(),
      settings: () => { this.settingsReturn = 'pause'; this.show('settings'); },
      slow: (on) => this.cmd.setSlowOption(on), toTitle: () => this.cmd.toTitle(),
    });
  }

  private buildFail(d: FailData | undefined): void {
    this.failReady = false;
    this.failEls = buildFail(this.el('fail'), d, this.device === 'touch', {
      again: () => { if (this.failReady) this.cmd.retry(); },
      back: () => { if (this.failReady) this.cmd.toTitle(); },
    });
  }

  // ——————————————————— 事件 ———————————————————
  onEvent(e: GameEvent, snap: SimSnapshot): void {
    this.snap = snap;
    const t = snap.t;
    switch (e.type) {
      case 'settings': {
        this.settings = { ...e.data };
        this.hud.settings = this.settings;
        this.overlays.reducedFlicker = e.data.reducedFlicker;
        this.root.classList.toggle('hw-large', e.data.subtitleSize === 'large');
        this.root.classList.toggle('hw-rm', e.data.reducedMotion);
        this.root.classList.toggle('hw-rf', e.data.reducedFlicker);
        if (this.current === 'settings') this.settingsScreen.update(this.settings);
        break;
      }
      case 'chapter:start': {
        this.chapter = e.data.id;
        this.hud.newChapter(t);
        this.hud.setChapter(chapterName(e.data.id), t);
        this.overlays.reset();
        this.scheduled = [];
        this.fallT = -1;
        this.prevSeg = null;
        break;
      }
      case 'retry':
        this.hud.reset();
        this.hud.setChapter(chapterName(snap.chapter), t);
        this.overlays.reset();
        this.scheduled = [];
        this.fallT = -1;
        break;
      case 'segment': {
        const prev = this.prevSeg;
        if (prev && prev.kind === 'still' && this.chapter) this.seenStills.add(`${this.chapter}:${prev.id}`);
        const cut = !!prev && prev.kind !== e.data.kind && (prev.kind === 'still' || e.data.kind === 'still');
        this.overlays.segment(t, cut);
        this.prevSeg = { id: e.data.id, kind: e.data.kind };
        this.hud.inStill = e.data.kind === 'still';
        this.hud.clearPromptHint();
        this.skipDone = '';
        if (e.data.kind === 'still' && this.skippable(e.data.id)) this.policyHint('skip', 'cue', t, HINT_SEC);
        break;
      }
      case 'contact': this.hud.contact(e.data.part, e.data.t, false); if (e.data.part === 'heel') this.hud.countTick(t); break;
      case 'followerContact': this.hud.contact(e.data.part, e.data.t, true); break;
      case 'note': if (!e.data.auto) this.hud.noteFlash(t); break;
      case 'prompt': {
        const inp = Input.active;
        if (inp && inp.hooks.ask !== e.data.context.ask) { inp.hooks.ask = e.data.context.ask; inp.refreshHooks(); }
        if (!e.data.hint) { this.hud.clearPromptHint(); break; }
        const still = snap.segKind !== 'run';
        this.policyHint(e.data.hint, still ? 'still' : 'prompt', t, 600);
        break;
      }
      case 'hit': {
        this.overlays.hit(t);
        if (this.settings?.vibrate && this.device === 'touch') vibrate(25);
        if (e.data.firstLegHit && !this.store.data.habit) {
          this.store.patch({ habit: true });
          const pan = e.data.lane * 0.6;
          this.later(t + HABIT_DELAY, (tt) => this.hud.text(['c1.habit'], 'whisper', undefined, pan, tt));
        }
        break;
      }
      case 'fall': this.overlays.fall(t); this.fallT = t; break;
      case 'twitch':
        if (e.data.phase === 'warn') {
          if (this.settings?.vibrate && this.device === 'touch') vibrate(30);
          this.policyHint('hold', 'cue', t, 2.0);
        }
        break;
      case 'drift':
        if (e.data.phase === 'warn') { this.hud.driftDir = e.data.dir; this.policyHint('straighten', 'cue', t, 2.0); }
        break;
      case 'ask': {
        const me = lineIdByText('让一下。');
        const whisper = lineIdByText('他每天都这样，不脏吗？');
        if (me) this.hud.text([me], 'self', undefined, 0, t);
        if (whisper) this.later(t + ASK_WHISPER_DELAY, (tt) => this.hud.text([whisper], 'whisper', undefined, 0.6, tt));
        break;
      }
      case 'cue': if (e.data.body.type === 'sfx' && e.data.body.sfx === 'tap' && this.settings?.vibrate && this.device === 'touch') vibrate(15); break;
      case 'chapter:end': {
        const id = e.data.id;
        if (!this.store.data.completed.includes(id)) this.store.patch({ completed: [...this.store.data.completed, id] });
        for (const s of getChapter(id)?.segments ?? []) if (s.kind === 'still') this.seenStills.add(`${id}:${s.id}`);
        break;
      }
      default: break;
    }
  }

  /** 在模拟时间 at 执行（字幕延后出现）。 */
  private later(at: number, fn: (t: number) => void): void { this.scheduled.push({ at, fn: () => fn(at) }); }

  /**
   * 显示一个提示，按附录 B.2 的规则：
   *   · 「显示操作提示」关闭后全部不显示（wet、tray 除外）；
   *   · 教学提示和跑段里的情境提示「同一个提示只显示一次」，记在存档 hintsSeen 里，重玩时不再出现；
   *   · 静场 / 站立段等待输入时的提示是「屏幕提示的那一个输入」（§2.2），每次都显示，不计入 hintsSeen。
   */
  policyHint(id: HintId, source: HintSource, t: number, seconds: number): boolean {
    const st = this.settings;
    if (st && !st.hints && !ALWAYS_HINTS.has(id)) return false;
    if (source !== 'still') {
      const sv = this.save.load();
      if (sv.hintsSeen.includes(id)) return false;
      this.save.patch({ hintsSeen: [...sv.hintsSeen, id] });
    }
    this.hud.showHint(id, source, t, seconds);
    return true;
  }

  /** 这一段静场能不能跳过：看过（本次运行里看完过，或这一章已经打完）才行（§2.2、§2.7）。 */
  skippable(segment: string): boolean {
    const ch = this.chapter;
    if (!ch) return false;
    if (this.seenStills.has(`${ch}:${segment}`)) return true;
    return chapterDone(ch, this.save.load(), this.store.data.completed);
  }

  // ——————————————————— cue（§8.7：text、hint、count、noteOpen、hud、overlay）———————————————————
  cueText(b: Extract<EventBody, { type: 'text' }>, snap: SimSnapshot): void {
    if (b.style === 'board') return;                        // 黑板字不进字幕（§7.2）
    const ids = (Array.isArray(b.line) ? b.line : [b.line]) as string[];
    this.hud.text(ids, (b.style ?? 'narration') as TextStyle, b.speaker as Speaker | undefined, b.pan ?? 0, snap.t);
  }
  cueHint(b: Extract<EventBody, { type: 'hint' }>, ctx: Pick<CueContext, 'snap' | 'segment'>): void {
    if (b.hint === 'straighten') {
      // 提示在偏移之前出现：往后找本段下一次腿偏移，显示反方向箭头（B.2）
      const next = ctx.segment.events.find((ev) => ev.at >= ctx.snap.segBeat - 1e-6 && ev.body.type === 'drift');
      if (next && next.body.type === 'drift') this.hud.driftDir = next.body.dir;
    }
    this.policyHint(b.hint, ctx.snap.segKind === 'run' ? 'cue' : 'still', ctx.snap.t, HINT_SEC);
  }
  cueCount(b: Extract<EventBody, { type: 'count' }>, snap: SimSnapshot): void { this.hud.countStart(b.from, b.to, b.ghostLag ?? 0, snap.t); }
  cueNoteOpen(b: Extract<EventBody, { type: 'noteOpen' }>, snap: SimSnapshot): void {
    this.hud.openNote(b.note, noteDef(b.note), snap.t);
    const sv = this.save.load();
    if (!sv.notesOpened.includes(b.note)) this.save.patch({ notesOpened: [...sv.notesOpened, b.note] });
  }
  cueHud(b: Extract<EventBody, { type: 'hud' }>): void {
    switch (b.op) {
      case 'show': this.hud.showFollower = true; break;
      case 'hide': this.hud.showFollower = false; break;
      case 'followerFadeOutBehind': this.hud.behindFaded = true; break;
      case 'followerFadeInAhead': this.hud.showFollower = true; break;
    }
  }
  cueOverlay(b: Extract<EventBody, { type: 'overlay' }>, snap: SimSnapshot): void { this.overlays.apply(b.op as OverlayOp, b.seconds, snap.t); }

  // ——————————————————— 每帧 ———————————————————
  /** 设备变化（提示文字随最后一次输入的设备切换，§7.3）。 */
  setDevice(d: Device): void {
    if (d === this.device) return;
    this.device = d; this.hud.device = d;          // 文字在下一帧的 frame() 里随 DomBatch 一起写
  }

  frame(snap: SimSnapshot, _dt: number): void {
    this.snap = snap;
    const t = snap.t;
    const b = this.batch;
    const inGame = GAME_SCREENS.has(this.current);
    // 延后的字幕
    if (this.scheduled.length) {
      const due = this.scheduled.filter((x) => x.at <= t + 1e-9);
      if (due.length) { this.scheduled = this.scheduled.filter((x) => x.at > t + 1e-9); for (const x of due) x.fn(); }
    }
    // 跳过静场
    const canSkip = this.current === 'play' && snap.segKind === 'still' && this.skippable(snap.segment);
    this.hud.skipVisible = canSkip;
    this.hud.skipHolding = this.skipAt !== null;
    const heldSince = this.skipAt ?? this.enterAt;
    if (canSkip && heldSince !== null && t - heldSince >= SKIP_HOLD_SEC - 1e-6 && this.skipDone !== snap.segment) {
      this.skipDone = snap.segment;
      this.skipAt = null; this.enterAt = null;
      queueMicrotask(() => this.cmd.skipStill());
    }
    // 叠加层
    const ov = this.overlays.view(t);
    const playing = inGame;
    const f = snap.follower;
    const s = Math.max(0, Math.min(3, Math.floor(snap.player.steady)));
    const vig = playing && f.mode !== 'hidden' ? (FOLLOWER_MIX[s]?.vignette ?? 0) : 0;
    b.style(this.layers.vignette, 'opacity', String(Math.min(1, vig + ov.pulse * 0.25)));
    b.style(this.layers.black, 'opacity', String(playing ? ov.black : 0));
    b.style(this.layers.cold, 'opacity', String(playing ? ov.cold : 0));
    b.style(this.layers.heat, 'opacity', String(playing ? ov.palmEdge : 0));
    b.cls(this.layers.grain, 'on', playing && this.grainWanted());
    if (this.canvas) {
      b.style(this.canvas, 'filter', playing ? ov.filter : '');
      // 画面翻转（5-11）：canvas 做 CSS 水平翻转；输入的左右互换由 Game 调 Input.setFlip 完成（§2.2）
      b.style(this.canvas, 'transform', playing && (snap.flip || this.forceFlip) ? 'scaleX(-1)' : '');
    }
    // HUD
    this.hud.render(snap, b, { palm: playing ? ov.palm : 'none', playing });
    // 失败卡：1.2 s（模拟时间）后显示提示与按钮
    if (this.current === 'fail' && this.failEls) {
      const ready = this.fallT >= 0 && t - this.fallT >= FAIL_PROMPT_SEC - 1e-6;
      if (ready && !this.failReady) this.failReady = true;
      b.text(this.failEls.prompt, this.device === 'touch' ? STR.failTouch : STR.failKey);
      b.cls(this.failEls.prompt, 'on', ready);
      b.cls(this.failEls.actions, 'hidden', !ready);
    }
    // 站立段：起身后按住左 / 右半屏（Game 只在事件时更新输入情境，这里补上）
    const halves = !!snap.player.stand && (snap.player.stand.phase === 'walking' || snap.player.stand.phase === 'planted');
    if (halves !== this.lastStandHalves) {
      this.lastStandHalves = halves;
      const inp = Input.active;
      if (inp) { inp.hooks.standHalves = halves; inp.refreshHooks(); }
    }
    b.flush();
  }

  private grainWanted(): boolean {
    const p = urlParams();
    const q = p.q ?? (this.settings?.quality === 'auto' || !this.settings ? 'medium' : this.settings.quality);
    return q !== 'low';
  }

  /** 调试（__game.ext.uiSeed）：写入演示用的存档（纸条、解锁、打完的章），只用于截图和 e2e。 */
  seed(o: { notes?: string[]; opened?: string[]; unlock?: ChapterId[]; completed?: ChapterId[] }): void {
    const sv = this.save.load();
    this.save.patch({
      notes: o.notes ?? sv.notes, notesOpened: o.opened ?? sv.notesOpened,
      unlocked: o.unlock ? Array.from(new Set([...sv.unlocked, ...o.unlock])) : sv.unlocked,
    });
    if (o.completed) this.store.patch({ completed: o.completed });
  }

  // ——————————————————— 读取（测试钩子用）———————————————————
  get screen(): ScreenName { return this.current; }
  get outroData(): OutroData | null { return this.lastOutro; }
  get failPromptVisible(): boolean { return this.failReady && this.current === 'fail'; }
  get skipAvailable(): boolean { return this.hud.skipVisible; }
  /** 显示层面的状态（__game.ext.ui()）。 */
  debugState(): Record<string, unknown> {
    return {
      screen: this.current, text: this.hud.currentText(), hint: this.hud.hint?.id ?? null, hintText: this.hud.hintEl.textContent,
      skip: this.hud.skipVisible, failPrompt: this.failPromptVisible, flushes: this.batch.flushes, device: this.device,
      chapterName: this.hud.chname.textContent, count: this.hud.countShown(), metro: this.hud.lastMetro,
      canvasTransform: this.canvas?.style.transform ?? '', canvasFilter: this.canvas?.style.filter ?? '',
      black: this.layers.black.style.opacity, seenStills: Array.from(this.seenStills),
    };
  }
}

function chapterName(id: ChapterId): string {
  if (id === 'ch1' || id === 'ch2' || id === 'ch3' || id === 'ch4' || id === 'ch5') return CHAPTER_NAMES[id];
  const d = getChapter(id);
  return d ? `${d.title}　${d.name}` : '';
}

/** 字幕文字（lineText 的再导出，给 cue 处理器用）。 */
export { lineText };
