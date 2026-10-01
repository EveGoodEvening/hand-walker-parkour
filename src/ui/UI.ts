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
import type { AtmosphereId, ChapterId, Device, HintId, QualityTier, ScreenName, SimSnapshot, Speaker, TextStyle } from '../core/types';
import { urlParams } from '../core/urlParams';
import { availableChapters, getChapter } from '../levels/chapters/index';
import { LINES, lineText, type LineEntry } from '../levels/lines';
import type { EventBody } from '../levels/schema';
import { Input } from '../input/Input';
import { DomBatch, h } from './dom';
import { Hud, type HintSource } from './hud/Hud';
import { INK_CLASS, inkForSegment } from './hud/ink';
import { OverlayState, SKIP_KEEP_OVERLAYS, type OverlayOp } from './hud/overlays';
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
/** 「不是成心的，只是习惯。」只在清醒的章里出现（梦里没有「习惯」可说；U4）。 */
export const HABIT_CHAPTERS: ReadonlySet<ChapterId> = new Set<ChapterId>(['ch1', 'ch2', 'ch3']);

const MENU_SCREENS: ReadonlySet<ScreenName> = new Set(['title', 'chapters', 'settings', 'notes', 'pause', 'outro', 'credits', 'fail']);
const HUD_SCREENS: ReadonlySet<ScreenName> = new Set(['play', 'pause']);
const GAME_SCREENS: ReadonlySet<ScreenName> = new Set(['play', 'pause', 'fail']);

/** 去掉句子两端的引号和空白（第二章原文的对白用 ASCII 双引号，WP2 可能原样收录）。 */
export function bareLine(s: string): string {
  return s.trim().replace(/^["'“”‘’「『]+/u, '').replace(/["'“”‘’」』]+$/u, '').trim();
}

/** 按文字找 LineId（第二章「让一下。」这类由 WP2 收录、键名未知的句子）。先逐字匹配，再忽略两端引号匹配。 */
export function lineIdByText(t: string): string | null {
  const want = bareLine(t);
  let loose: string | null = null;
  for (const [k, v] of Object.entries(LINES as Record<string, LineEntry>)) {
    if (v.t === t) return k;
    if (loose === null && bareLine(v.t) === want) loose = k;
  }
  return loose;
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
  private prevSeg: { id: string; index: number; kind: 'run' | 'still' | 'stand' } | null = null;
  /** 回头窗口是否开着（prompt 事件的 context.look）：窗口关上时撤掉还挂着的「Q 回头」。 */
  private lookOpen = false;
  private enterAt: number | null = null;
  private skipAt: number | null = null;
  private skipDone = '';
  // 延后执行（模拟时间）
  private scheduled: Array<{ at: number; fn: () => void }> = [];
  private creditsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStandHalves = false;
  /** 本段已经出现过「让一下」之后的低语（每段每次重来只出现一次；每段最多可以请求 2 次）。 */
  private askWhispered = false;
  /** 调试（__game.ext.uiFlip）：不经模拟强制画面翻转，只用于截图。 */
  forceFlip = false;
  /** 正在跳过静场（Game.skipStill 通知）：直到下一个 segment 事件，上一段的字幕、纸条翻看、提示一律不显示（U4）。 */
  private skipping = false;
  /** atmosphere cue 改过的本段氛围（墨色模式按它判断）；换段时清掉。 */
  private atmo: { segment: string; id: AtmosphereId } | null = null;
  private inkKey = '';
  private inkOn = false;
  /** Game 的实际画质档位（setQualityTier；颗粒层按它开关，§9.4）。 */
  private tier: QualityTier | null = null;

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
      reset: () => { cmd.resetProgress(); this.store.reset(); this.hud.subs.forgetSeen(); this.hud.subs.replayed = false; this.seenStills.clear(); },
      back: () => this.show(this.settingsReturn),
    });
    this.notesScreen = new NotesScreen(this.el('notes'), () => this.show('title'));
    this.outroScreen = new OutroScreen(this.el('outro'), {
      next: () => cmd.nextChapter(), replay: () => { const c = this.lastOutro?.chapter; if (c) void cmd.start(c); },
      toTitle: () => cmd.toTitle(), device: () => this.device,
      input: (id, n) => cmd.outroInput?.(id, n),
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
    if (inp) { inp.hooks.escape = () => this.onEscape(); inp.deferButton(); }
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
    // 上一个界面里按下、还没被 Game 取走的键作废（选章的回车不能顺带跳过开场卡，见 Input.dropPending）
    if (prev !== s) Input.active?.dropPending();
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
    // 暂停时只留章名和‖：字幕、提示、节拍器会从压暗的背景里透出来，和菜单项叠在一起
    this.hud.root.classList.toggle('paused', s === 'pause');
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
        this.lookOpen = false;
        this.askWhispered = false;
        this.skipping = false;
        this.atmo = null;
        this.hud.subs.replayed = chapterDone(e.data.id, this.save.load(), this.store.data.completed);
        break;
      }
      case 'retry':
        this.hud.reset();
        this.hud.setChapter(chapterName(snap.chapter), t);
        this.overlays.reset();
        this.scheduled = [];
        this.fallT = -1;
        this.askWhispered = false;
        this.skipping = false;
        break;
      case 'segment': {
        const prev = this.prevSeg;
        if (this.skipping) {
          // U4：跳过静场时剩下的字幕、纸条翻看、提示都不能挂到下一段上（即使旧 cue 仍然到达）
          this.skipping = false;
          this.hud.subs.clear();
          this.hud.closeNote();
          this.hud.clearHint();
          this.scheduled = [];
        }
        this.atmo = null;
        // 只有按顺序走到下一段才算看过这段静场。读章再跳转（?seg=<静场>：load 和 goto 各发一次 segment）、
        // 从暂停里重来，都不能让一段还没看过的静场第一次就能跳过。
        if (prev && prev.kind === 'still' && this.chapter && e.data.index === prev.index + 1) this.seenStills.add(`${this.chapter}:${prev.id}`);
        const cut = !!prev && prev.kind !== e.data.kind && (prev.kind === 'still' || e.data.kind === 'still');
        this.overlays.segment(t, cut);
        this.prevSeg = { id: e.data.id, index: e.data.index, kind: e.data.kind };
        this.lookOpen = false;
        this.hud.inStill = e.data.kind === 'still';
        this.hud.clearPromptHint();
        this.skipDone = '';
        this.askWhispered = false;
        if (e.data.kind === 'still' && this.skippable(e.data.id)) this.policyHint('skip', 'cue', t, HINT_SEC);
        break;
      }
      case 'contact': this.hud.contact(e.data.part, e.data.t, false); if (e.data.part === 'heel') this.hud.countTick(t); break;
      case 'followerContact': this.hud.contact(e.data.part, e.data.t, true); break;
      case 'note': if (!e.data.auto) this.hud.noteFlash(t); break;
      case 'prompt': {
        const inp = Input.active;
        if (inp && inp.hooks.ask !== e.data.context.ask) { inp.hooks.ask = e.data.context.ask; inp.refreshHooks(); }
        // 回头窗口关上（回过头了，或者窗口结束）：提前出现的教学提示「Q 回头」（cue，3.2 s）也一起撤掉
        if (this.lookOpen && !e.data.context.look) this.clearLookHint();
        this.lookOpen = e.data.context.look;
        if (!e.data.hint) { this.hud.clearPromptHint(); break; }
        const still = snap.segKind !== 'run';
        // 4-6「你到底想要什么？」下面不出字：附录 B 里「按任意键」只属于失败卡，静场里的 anyKey 只是等输入（U4）
        if (still && e.data.hint === 'anyKey') { this.hud.clearPromptHint(); break; }
        this.policyHint(e.data.hint, still ? 'still' : 'prompt', t, 600);
        break;
      }
      case 'hit': {
        this.overlays.hit(t);
        if (this.settings?.vibrate && this.device === 'touch') vibrate(25);
        // 「不是成心的，只是习惯。」是「我」的自述（居中旁白，不按车道声像），不是伸脚的人在解释；梦里不出（U4）
        if (e.data.firstLegHit && !this.store.data.habit && HABIT_CHAPTERS.has(snap.chapter)) {
          this.store.patch({ habit: true });
          this.later(t + HABIT_DELAY, (tt) => this.hud.text(['c1.habit'], 'narration', undefined, 0, tt));
        }
        break;
      }
      case 'fall': this.overlays.fall(t); this.fallT = t; break;
      case 'lookBack': if (e.data.phase === 'start') this.clearLookHint(); break;
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
        // 「让一下。」每次请求都说；低语每段只出现一次（同一句低语连着出现两次会显得像机关）
        const me = lineIdByText('让一下。');
        const whisper = lineIdByText('他每天都这样，不脏吗？');
        if (me) this.hud.textRaw([me], [bareLine(lineText(me))], 'self', 0, t);
        if (whisper && !this.askWhispered) {
          this.askWhispered = true;
          this.later(t + ASK_WHISPER_DELAY, (tt) => this.hud.textRaw([whisper], [bareLine(lineText(whisper))], 'whisper', 0.6, tt));
        }
        break;
      }
      case 'cue': {
        const body = e.data.body;
        if (body.type === 'sfx' && body.sfx === 'tap' && this.settings?.vibrate && this.device === 'touch') vibrate(15);
        if (body.type === 'atmosphere') this.atmo = { segment: snap.segment, id: body.id };
        break;
      }
      case 'chapter:end': {
        const id = e.data.id;
        if (!this.store.data.completed.includes(id)) this.store.patch({ completed: [...this.store.data.completed, id] });
        for (const s of getChapter(id)?.segments ?? []) if (s.kind === 'still') this.seenStills.add(`${id}:${s.id}`);
        break;
      }
      default: break;
    }
  }

  private clearLookHint(): void { if (this.hud.hint?.id === 'look') this.hud.clearHint(); }

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
    if (b.style === 'board' || this.skipping) return;       // 黑板字不进字幕（§7.2）；跳过中的旧字幕不显示
    const ids = (Array.isArray(b.line) ? b.line : [b.line]) as string[];
    this.hud.text(ids, (b.style ?? 'narration') as TextStyle, b.speaker as Speaker | undefined, b.pan ?? 0, snap.t);
  }
  cueHint(b: Extract<EventBody, { type: 'hint' }>, ctx: Pick<CueContext, 'snap' | 'segment'>): void {
    if (this.skipping) return;
    if (b.hint === 'straighten') {
      // 提示在偏移之前出现：往后找本段下一次腿偏移，显示反方向箭头（B.2）
      const next = ctx.segment.events.find((ev) => ev.at >= ctx.snap.segBeat - 1e-6 && ev.body.type === 'drift');
      if (next && next.body.type === 'drift') this.hud.driftDir = next.body.dir;
    }
    this.policyHint(b.hint, ctx.snap.segKind === 'run' ? 'cue' : 'still', ctx.snap.t, HINT_SEC);
  }
  cueCount(b: Extract<EventBody, { type: 'count' }>, snap: SimSnapshot): void { if (!this.skipping) this.hud.countStart(b.from, b.to, b.ghostLag ?? 0, snap.t); }
  cueNoteOpen(b: Extract<EventBody, { type: 'noteOpen' }>, snap: SimSnapshot): void {
    if (!this.skipping) this.hud.openNote(b.note, noteDef(b.note), snap.t);
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
  /**
   * Game.skipStill 在跳过之前调用（U4）：到下一个 segment 事件为止，上一段的表现类 cue 不显示，到时清空。
   * 修复轮 B3：模拟在跳过时丢掉叠加层 cue，可是闭眼（5-9 → 5-10）、黑场会留在画面上、进下一段。正在进行的黑场 / 冷色渐变直接走完，
   * 本段还没到的这类叠加层（含 onDone）按顺序立即应用（终态），下一段开始时和自然看完一样（5-10 开头从 60% 的暗里睁开眼）。
   */
  noteSkip(): void {
    this.skipping = true;
    const snap = this.snap;
    if (!snap || snap.segKind === 'run' || !snap.still) return;
    this.overlays.settle();
    for (const op of skippedOverlays(snap.chapter, snap.segment, snap.still.t)) this.overlays.apply(op, 0, snap.t);
  }

  /** Game 的实际画质档位（启动时和每次切换时由 Game 调用）。 */
  setQualityTier(t: QualityTier): void { this.tier = t; }

  /** 当前是否用亮底墨色（只在游玩画面；暂停、失败卡的压暗背景上保持粉笔白）。 */
  private inkWanted(snap: SimSnapshot): boolean {
    if (this.current !== 'play') return false;
    const ov = this.atmo && this.atmo.segment === snap.segment ? this.atmo.id : null;
    const key = `${snap.chapter}|${snap.segment}|${ov ?? ''}`;
    if (key !== this.inkKey) { this.inkKey = key; this.inkOn = inkForSegment(snap.chapter, snap.segment, ov); }
    return this.inkOn;
  }

  /** 设备变化（提示文字随最后一次输入的设备切换，§7.3）。 */
  setDevice(d: Device): void {
    if (d === this.device) return;
    this.device = d; this.hud.device = d;          // 文字在下一帧的 frame() 里随 DomBatch 一起写
  }

  frame(snap: SimSnapshot, _dt: number): void {
    this.snap = snap;
    const t = snap.t;
    // Game 在 frame() 之后才调 setDevice：先自己取一次，本帧的提示文字就已经是最后一次输入的设备
    const inp = Input.active;
    if (inp) this.setDevice(inp.device());
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
    // lead 集成（WP2 契约申请）：追随者的 HUD 为 none 时（5-3「身后什么也没有」）不加稳度暗角
    const vig = playing && f.mode !== 'hidden' && f.hud !== 'none' ? (FOLLOWER_MIX[s]?.vignette ?? 0) : 0;
    b.style(this.layers.vignette, 'opacity', String(Math.min(1, vig + ov.pulse * 0.25)));
    b.style(this.layers.black, 'opacity', String(playing ? ov.black : 0));
    b.style(this.layers.cold, 'opacity', String(playing ? ov.cold : 0));
    b.style(this.layers.heat, 'opacity', String(playing ? ov.palmEdge : 0));
    b.cls(this.layers.grain, 'on', playing && this.grainWanted());
    b.cls(this.root, INK_CLASS, this.inkWanted(snap));
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
      if (inp) { inp.hooks.standHalves = halves; inp.refreshHooks(); }
    }
    // 情境按钮「回头」「让一下」：Input 在 tick 里只改模型，这里随本帧的批量写入一起写
    const cb = inp?.buttonView();
    if (cb) { b.style(cb.el, 'display', cb.show ? '' : 'none'); b.text(cb.el, cb.label); }
    b.flush();
  }

  /** 颗粒层按 Game 的实际档位开关（low 不要颗粒，§9.4）；Game 还没告诉档位时按 URL / 设置猜。 */
  private grainWanted(): boolean {
    if (this.tier) return this.tier !== 'low';
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
      ctxLook: Input.active?.context.look ?? false,
      ink: this.root.classList.contains(INK_CLASS), grain: this.layers.grain.classList.contains('on'), tier: this.tier,
    };
  }
}

/**
 * 跳过静场 segment（已经放到 tNow 秒）时，本段还没到、会留在画面上的叠加层（SKIP_KEEP_OVERLAYS），按发生的先后：
 * 先是 events 里 at > tNow 的，再是输入完成后的 onDone（等输入时跳过，onDone 都还没到）。修复轮 B3。
 */
export function skippedOverlays(chapter: ChapterId, segment: string, tNow: number): OverlayOp[] {
  const def = getChapter(chapter)?.segments.find((s) => s.id === segment);
  if (!def || def.kind === 'run') return [];
  const keep = (e: { type: string; op?: unknown }): e is { type: 'overlay'; op: OverlayOp } => e.type === 'overlay' && SKIP_KEEP_OVERLAYS.has(e.op as OverlayOp);
  const evs = (def.events as ReadonlyArray<{ at?: number; type: string; op?: unknown }>).filter((e) => (e.at ?? 0) > tNow + 1e-9);
  const later = [...evs].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const done = [...(def.input?.onDone ?? [])].sort((a, b) => a.at - b.at);
  return [...later, ...done].filter(keep).map((e) => e.op);
}

function chapterName(id: ChapterId): string {
  if (id === 'ch1' || id === 'ch2' || id === 'ch3' || id === 'ch4' || id === 'ch5') return CHAPTER_NAMES[id];
  const d = getChapter(id);
  return d ? `${d.title}　${d.name}` : '';
}

/** 字幕文字（lineText 的再导出，给 cue 处理器用）。 */
export { lineText };
