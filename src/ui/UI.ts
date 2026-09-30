// src/ui/UI.ts —— 界面框架（DESIGN.md §7、§8.4 UIAPI）。CORE 写初版（框架），之后归 WP8。
// 界面：Boot → Title（章节 / 设置 / 纸条）→ Intro → Play ⇄ Pause → Fail → Outro → 下一章 | Title → Credits。
// HUD 与叠加层（暗角、黑场、去饱和、掌心发烫）都是 DOM；不画进度条、不画分数。
import type { GameCommands, UIAPI } from '../core/contracts';
import type { GameEvent } from '../core/events';
import type { SaveAPI } from '../core/save';
import type { Settings } from '../core/settings';
import type { ChapterId, Device, RunStats, ScreenName, SimSnapshot } from '../core/types';
import { availableChapters, CHAPTER_ORDER, getChapter } from '../levels/chapters/index';
import { lineText } from '../levels/lines';
import type { EventBody } from '../levels/schema';
import { Hud } from './hud/Hud';
import { button, h, moveFocus, ScreenEl } from './screens/menus';
import { CHAPTER_NAMES, STR, statsLine } from './strings';

export interface IntroData { chapter: ChapterId; title: string; name: string; lines: string[] }
export interface FailData { line: string }
export interface OutroData { chapter: ChapterId; stats: RunStats; next: ChapterId | null; lines: string[]; notes: { got: number; total: number } | null }

type OverlayOp = Extract<EventBody, { type: 'overlay' }>['op'];

export class UI implements UIAPI {
  private root!: HTMLElement;
  private cmd!: GameCommands;
  private save!: SaveAPI;
  hud!: Hud;
  private screens = new Map<ScreenName, ScreenEl>();
  private current: ScreenName = 'boot';
  private settings: Settings | null = null;
  private settingsReturn: ScreenName = 'title';
  private black!: HTMLDivElement;
  private heat!: HTMLDivElement;
  private blackState = { from: 0, to: 0, t0: 0, dur: 0 };
  private desatUntil = -1;
  private canvas: HTMLCanvasElement | null = null;
  private failPromptAt = Infinity;
  private failEl: HTMLDivElement | null = null;
  private lastSnapT = 0;
  private device: Device = 'keyboard';
  private confirmReset = false;
  private lastOutro: OutroData | null = null;

  mount(root: HTMLElement, cmd: GameCommands, save: SaveAPI): void {
    this.root = root; this.cmd = cmd; this.save = save;
    this.canvas = document.getElementById('game') as HTMLCanvasElement | null;
    this.hud = new Hud(root, () => cmd.pause(true));
    this.black = h('div', 'hw-layer hw-black', undefined, root);
    this.heat = h('div', 'hw-layer hw-heat', undefined, root);
    for (const n of ['boot', 'title', 'chapters', 'settings', 'notes', 'intro', 'pause', 'fail', 'outro', 'credits'] as ScreenName[]) {
      this.screens.set(n, new ScreenEl(root, n, n === 'boot' || n === 'intro' || n === 'credits' || n === 'outro'));
    }
    h('div', 'hw-card', STR.boot, this.screens.get('boot')?.el);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.screens.get('fail')?.el.addEventListener('pointerdown', () => { if (performance.now() >= this.failPromptAt) cmd.retry(); });
    this.show('boot');
  }

  private onKey(e: KeyboardEvent): void {
    const sc = this.screens.get(this.current);
    if (!sc || this.current === 'play' || this.current === 'intro' || this.current === 'fail' || this.current === 'boot') return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { moveFocus(sc, 1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { moveFocus(sc, -1); e.preventDefault(); }
    else if ((e.code === 'Escape' || e.code === 'Backspace') && (this.current === 'settings' || this.current === 'chapters' || this.current === 'notes')) {
      e.preventDefault();
      this.show(this.current === 'settings' ? this.settingsReturn : 'title');
    }
  }

  show(s: ScreenName, data?: unknown): void {
    this.current = s;
    if (s === 'title') this.buildTitle();
    if (s === 'chapters') this.buildChapters();
    if (s === 'settings') this.buildSettings();
    if (s === 'notes') this.buildNotes();
    if (s === 'intro') this.buildIntro(data as IntroData);
    if (s === 'pause') this.buildPause(data as { slowAvailable?: boolean; slowOn?: boolean } | undefined);
    if (s === 'fail') this.buildFail(data as FailData);
    if (s === 'outro') { this.lastOutro = data as OutroData; this.buildOutro(data as OutroData); }
    if (s === 'credits') this.buildCredits();
    for (const [n, sc] of this.screens) sc.show(n === s);
    this.hud.show(s === 'play' || s === 'pause' || s === 'fail');
    if (s !== 'fail') this.failPromptAt = Infinity;
    if (s === 'play' || s === 'intro' || s === 'title') this.setCanvasFilter('');
  }

  // ——— 界面 ———
  private buildTitle(): void {
    const el = this.screens.get('title')?.clear();
    if (!el) return;
    // 竖排：逐字堆叠（不依赖 writing-mode，缺竖排字形度量的字体里也不会叠字）
    const vert = (cls: string, text: string) => { const box = h('div', cls, undefined, el); for (const ch of Array.from(text)) h('span', '', ch, box); };
    vert('hw-title', STR.title);
    vert('hw-sub', STR.subtitle);
    const menu = h('div', 'hw-menu', undefined, el);
    const sv = this.save.load();
    if (sv.last) button(STR.continue, () => void this.cmd.continueGame(), menu);
    button(STR.start, () => void this.cmd.start(this.firstPlayable()), menu);
    button(STR.chapters, () => this.show('chapters'), menu);
    button(STR.settings, () => { this.settingsReturn = 'title'; this.show('settings'); }, menu);
    button(STR.notes, () => this.show('notes'), menu);
    h('div', 'hw-corner', STR.adapted, el);
    if (!sv.firstRunShown) { h('div', 'hw-notice', STR.firstRun, el); this.save.patch({ firstRunShown: true }); }
    const p = h('div', 'hw-pulse', undefined, el);
    for (let i = 0; i < 3; i++) h('i', '', undefined, p);
  }

  private firstPlayable(): ChapterId { return availableChapters()[0] ?? 'ch1'; }

  private buildChapters(): void {
    const el = this.screens.get('chapters')?.clear();
    if (!el) return;
    const menu = h('div', 'hw-menu', undefined, el);
    const sv = this.save.load();
    const avail = new Set(availableChapters());
    for (const c of CHAPTER_ORDER) {
      const unlocked = avail.has(c) && sv.unlocked.includes(c);
      const name = c === 'ch1' || c === 'ch2' || c === 'ch3' || c === 'ch4' || c === 'ch5' ? CHAPTER_NAMES[c] : c;
      button(unlocked ? name : STR.locked, () => void this.cmd.start(c), menu, !unlocked);
    }
    button(STR.back, () => this.show('title'), menu);
  }

  private buildSettings(): void {
    const el = this.screens.get('settings')?.clear();
    const s = this.settings;
    if (!el || !s) return;
    h('div', 'hw-h', STR.settings, el);
    const box = h('div', 'hw-settings hw-menu', undefined, el);
    const row = (label: string, value: string, onClick: () => void) => {
      const r = h('div', 'hw-row', undefined, box);
      h('span', '', label, r);
      const b = button(value, onClick, r);
      b.classList.add('v');
      return b;
    };
    const onOff = (v: boolean) => (v ? STR.on : STR.off);
    const qNames = { auto: STR.auto, low: STR.low, medium: STR.medium, high: STR.high } as const;
    const qOrder = ['auto', 'low', 'medium', 'high'] as const;
    row(STR.quality, qNames[s.quality], () => this.cmd.setSetting('quality', qOrder[(qOrder.indexOf(s.quality) + 1) % 4] as Settings['quality']));
    for (const k of ['master', 'sfx', 'ambience'] as const) row(STR[k], String(s[k]), () => this.cmd.setSetting(k, (s[k] + 10) % 110));
    for (const k of ['reducedFlicker', 'reducedMotion', 'metronome', 'hints', 'assist', 'outlines', 'vibrate', 'autoRetry'] as const) {
      row(STR[k], onOff(s[k]), () => this.cmd.setSetting(k, !s[k]));
    }
    row(STR.subtitleSize, s.subtitleSize === 'large' ? STR.large : STR.normal, () => this.cmd.setSetting('subtitleSize', s.subtitleSize === 'large' ? 'normal' : 'large'));
    const sw = { low: STR.low, mid: STR.medium, high: STR.high } as const;
    const swo = ['low', 'mid', 'high'] as const;
    row(STR.swipe, sw[s.swipe], () => this.cmd.setSetting('swipe', swo[(swo.indexOf(s.swipe) + 1) % 3] as Settings['swipe']));
    row(STR.reset, this.confirmReset ? STR.resetConfirm : '', () => {
      if (this.confirmReset) { this.cmd.resetProgress(); this.confirmReset = false; } else this.confirmReset = true;
      this.buildSettings(); this.screens.get('settings')?.show(true);
    });
    button(STR.back, () => { this.confirmReset = false; this.show(this.settingsReturn); }, box);
  }

  private buildNotes(): void {
    const el = this.screens.get('notes')?.clear();
    if (!el) return;
    h('div', 'hw-h', STR.notes, el);
    const menu = h('div', 'hw-menu', undefined, el);
    const sv = this.save.load();
    // 大多数纸条两面都是白的；折着的那张在第二章之前打不开（§7.2 Notes）。3D 翻转由 WP8 实现。
    const defs = availableChapters(true).flatMap((c) => getChapter(c)?.notes ?? []);
    for (const id of sv.notes) {
      const d = defs.find((x) => x.id === id);
      const opened = !d?.folded || sv.notesOpened.includes(id);
      const text = d && opened ? [d.front, d.back].filter((x): x is NonNullable<typeof x> => !!x).map((l) => lineText(l)).join('　') : '';
      h('div', 'hw-row', text ? `${STR.note}　${text}` : STR.note, menu);
    }
    button(STR.back, () => this.show('title'), menu);
  }

  private buildIntro(d: IntroData | undefined): void {
    const el = this.screens.get('intro')?.clear();
    if (!el || !d) return;
    const card = h('div', 'hw-card', undefined, el);
    h('div', 'small', d.title, card);
    const big = h('div', 'big', d.name, card);
    big.style.animation = 'hw-in .6s .6s ease-out both';
    d.lines.forEach((l, i) => { const e = h('div', 'line', l, card); e.style.animationDelay = `${1.2 + i * 0.6}s`; });
  }

  private buildPause(d?: { slowAvailable?: boolean; slowOn?: boolean }): void {
    const el = this.screens.get('pause')?.clear();
    if (!el) return;
    if (d) this.pauseData = d;
    const pd = this.pauseData;
    h('div', 'hw-h', STR.pause, el);
    const menu = h('div', 'hw-menu', undefined, el);
    button(STR.resume, () => this.cmd.pause(false), menu);
    button(STR.retry, () => this.cmd.retry(), menu);
    button(STR.settings, () => { this.settingsReturn = 'pause'; this.show('settings'); }, menu);
    if (pd.slowAvailable) {
      // 「放慢一点」：只对本段生效，速度 ×0.9；不弹窗、不劝说（§2.7）
      const b = button(`${STR.slower}　${pd.slowOn ? STR.on : STR.off}`, () => {
        pd.slowOn = !pd.slowOn;
        this.cmd.setSlowOption(!!pd.slowOn);
        b.textContent = `${STR.slower}　${pd.slowOn ? STR.on : STR.off}`;
      }, menu);
    }
    button(STR.toTitle, () => this.cmd.toTitle(), menu);
  }
  private pauseData: { slowAvailable?: boolean; slowOn?: boolean } = {};

  private buildFail(d: FailData | undefined): void {
    const el = this.screens.get('fail')?.clear();
    if (!el) return;
    const card = h('div', 'hw-card hw-fail', undefined, el);
    h('div', 'line', d?.line ?? '', card);
    this.failEl = h('div', 'prompt', this.device === 'touch' ? STR.failTouch : STR.failKey, card);
    this.failPromptAt = performance.now() + 200;
    this.setCanvasFilter('grayscale(0.85) brightness(0.8) hue-rotate(-10deg)');
  }

  private buildOutro(d: OutroData | undefined): void {
    const el = this.screens.get('outro')?.clear();
    if (!el || !d) return;
    const card = h('div', 'hw-card', undefined, el);
    d.lines.forEach((l, i) => { const e = h('div', 'line', l, card); e.style.animationDelay = `${0.3 + i * 0.9}s`; });
    const st = h('div', 'stats', statsLine(d.stats.timeMs, d.stats.falls, d.stats.lookBacks, d.chapter === 'ch4' ? null : d.notes), card);
    st.style.animation = `hw-in .8s ${0.3 + d.lines.length * 0.9}s ease-out both`;
    const menu = h('div', 'hw-menu', undefined, el);
    menu.style.marginTop = '2em';
    if (d.next) button(STR.next, () => this.cmd.nextChapter(), menu);
    button(STR.replay, () => void this.cmd.start(d.chapter), menu);
    button(STR.toTitle, () => this.cmd.toTitle(), menu);
  }

  private buildCredits(): void {
    const el = this.screens.get('credits')?.clear();
    if (!el) return;
    const card = h('div', 'hw-card', undefined, el);
    STR.credits.forEach((l, i) => { const e = h('div', 'line', l, card); e.style.animationDelay = `${0.4 + i * 1.2}s`; });
    const menu = h('div', 'hw-menu', undefined, el);
    button(STR.toTitle, () => this.cmd.toTitle(), menu);
  }

  // ——— 叠加层 ———
  private setCanvasFilter(f: string): void { if (this.canvas) this.canvas.style.filter = f; }

  overlay(op: OverlayOp, seconds: number, t: number): void {
    const cur = this.blackLevel(t);
    switch (op) {
      case 'black': this.blackState = { from: cur, to: 1, t0: t, dur: Math.max(0.01, seconds) }; break;
      case 'eyesClosed': this.blackState = { from: cur, to: 0.6, t0: t, dur: Math.max(0.01, seconds) }; break;
      case 'clear': this.blackState = { from: cur, to: 0, t0: t, dur: Math.max(0.01, seconds) }; this.desatUntil = -1; break;
      case 'desaturate': case 'coldFade': this.desatUntil = t + seconds; break;
      case 'palmHeat': case 'palmNumb': this.heat.style.opacity = '1'; setTimeout(() => { this.heat.style.opacity = '0'; }, Math.max(300, seconds * 1000)); break;
    }
  }
  private blackLevel(t: number): number {
    const b = this.blackState;
    if (b.dur <= 0) return b.to;
    const k = Math.min(1, Math.max(0, (t - b.t0) / b.dur));
    return b.from + (b.to - b.from) * k;
  }

  // ——— 事件 ———
  onEvent(e: GameEvent, snap: SimSnapshot): void {
    switch (e.type) {
      case 'settings':
        this.settings = { ...e.data };
        this.hud.settings = this.settings;
        this.root.classList.toggle('hw-large', e.data.subtitleSize === 'large');
        if (this.current === 'settings') { this.buildSettings(); this.screens.get('settings')?.show(true); }
        break;
      case 'contact': this.hud.contact(e.data.part, e.data.t, false); if (e.data.part === 'heel') this.hud.countTick(snap.t); break;
      case 'followerContact': this.hud.contact(e.data.part, e.data.t, true); break;
      case 'note': if (!e.data.auto) this.hud.noteFlash(snap.t); break;
      case 'prompt': if (e.data.hint) this.hud.setHint(e.data.hint, snap.t, 30); else this.hud.setHint(null, snap.t); break;
      case 'chapter:start': this.hud.resetSpeakers(); this.hud.reset(); this.blackState = { from: 0, to: 0, t0: 0, dur: 0 }; this.desatUntil = -1; break;
      case 'retry': this.hud.reset(); this.blackState = { from: 0, to: 0, t0: 0, dur: 0 }; this.desatUntil = -1; this.setCanvasFilter(''); break;
      case 'segment': if (this.blackState.to < 1) this.blackState = { from: 0, to: 0, t0: 0, dur: 0 }; break;
      default: break;
    }
  }

  /** 设备变化（提示文字随最后一次输入的设备切换）。 */
  setDevice(d: Device): void { this.device = d; this.hud.device = d; }

  frame(snap: SimSnapshot, _dt: number): void {
    const t = snap.t;
    this.lastSnapT = t;
    if (this.current === 'play' || this.current === 'pause' || this.current === 'fail') this.hud.frame(snap);
    this.black.style.opacity = String(this.blackLevel(t));
    if (this.current === 'play') this.setCanvasFilter(this.desatUntil > t ? 'grayscale(0.9) brightness(0.95)' : '');
    if (this.failEl) this.failEl.classList.toggle('on', performance.now() >= this.failPromptAt + 1000);
  }

  get screen(): ScreenName { return this.current; }
  get outroData(): OutroData | null { return this.lastOutro; }
}

/** 字幕文字（lineText 的再导出，给 cue 处理器用）。 */
export { lineText };
