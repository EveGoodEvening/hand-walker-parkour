// src/ui/hud/Hud.ts —— HUD（DESIGN.md §7.2 Play）。WP8。
// 左上章名（40% 不透明度，8 s 后 20%）、右上暂停（44 px）；下方三分之一是一个自下而上的纵向栈：
//   节拍器（实心点 / 空心点）→ 平衡线（七步）→ 操作提示（1 行）→ 字幕（最多 2 行）→ 纸条翻看。
// 同一个栈里依次排布，所以字幕、提示、节拍器在任何分辨率下都不会互相重叠；右下角的情境按钮 / 「跳过」
// 与左下角的纸条闪现在栈的两侧（竖屏 360 px 下也留出了间距，见 e2e-touch 的版面检查）。
// U4：数数离开了栈（它压在主角背上），放在约 34% 高度、中线偏左，残影在它右上方；横屏时操作提示挪到右下的空地上
// （styles.css，带半透明衬底），竖屏仍在栈里。
// 不画进度条，不画任何数字（数数除外）。所有计时用模拟时间（snap.t）；事件只改模型，DOM 在 render() 里经 DomBatch 一次写完。
import type { Settings } from '../../core/settings';
import type { Device, FollowerSnap, HintId, SimSnapshot, Speaker, TextStyle } from '../../core/types';
import { lineText } from '../../levels/lines';
import type { NoteDef } from '../../levels/schema';
import { DomBatch, h } from '../dom';
import { hintText, numZh, SPEAKERS, STR } from '../strings';
import { metronome, type MetroView } from './metronome';
import { SubtitleQueue, type SubLine } from './subtitles';

export type HintSource = 'cue' | 'prompt' | 'still';
interface HintState { id: HintId; source: HintSource; until: number; still: boolean; t0: number; first: boolean }
interface CountState { from: number; step: 1 | -1; len: number; lag: number; k: number; until: number }
interface NoteOpenState { def: NoteDef | null; id: string; t0: number }

export const NOTE_FLASH_SEC = 1.2;
/**
 * 教学提示（不是静场里的提示）整个存档只出现一次（UI.policyHint）：头 FIRST_HINT_SEC 秒放大一档、提亮（.hw-hint.first），
 * 之后缩回原来的大小。最终 QA：960×540 下 11–12 px 的灰字贴在右下角，第一次玩的人盯着主角和字幕，容易错过。
 */
export const FIRST_HINT_SEC = 2.0;
export const CHNAME_FADE_SEC = 8;
/** 纸条翻看（noteOpen）：正面 1.0 s → 翻面 → 背面停到 4.4 s → 0.4 s 淡出。 */
export const NOTE_OPEN = { flipAt: 1.0, fadeAt: 4.4, endAt: 4.8 } as const;
/** 七步平衡线：θ 达到 plantAngle（0.35 rad）时点到头（§2.4 stand.plantAngle）。 */
export const BALANCE_RANGE = 0.35;
export const BALANCE_HALF_PX = 56;
/**
 * 底部栈挪到画面上方的静场（修复轮 B3）：4-4 掌心（palmEye）镜头在他眼睛里，举起的右手占满画面下半部（指尖约在 53–55% 高度），
 * 节拍点原来在栈底、正压在掌心那只眼睛下面，字幕压在掌心上。整个底部栈（字幕 → 提示 → 节拍点，§7.2 的顺序不变）挪到指尖上方的空地，
 * 节拍点的中心在 METRO_LIFT_Y 高度（styles.css 的 .hw-hud.hw-lift .hw-bottom：translateY = 栈底到 (1 − METRO_LIFT_Y) × 100vh；
 * 横屏的操作提示在右下、不在栈里，抵消这次平移）。第三轮：以前只挪节拍器，点到了字幕上面，低语字幕还压在掌心上。
 */
export const METRO_LIFT_SETS: ReadonlySet<string> = new Set(['palmEye']);
export const METRO_LIFT_Y = 0.44;

export class Hud {
  readonly root: HTMLDivElement;
  readonly chname: HTMLDivElement;
  readonly pauseBtn: HTMLButtonElement;
  readonly bottom: HTMLDivElement;
  readonly subsEl: HTMLDivElement;
  readonly hintEl: HTMLDivElement;
  readonly countEl: HTMLDivElement;
  readonly balanceEl: HTMLDivElement;
  readonly metroEl: HTMLDivElement;
  readonly selfDots: HTMLDivElement;
  readonly followDots: HTMLDivElement;
  readonly noteFlashEl: HTMLDivElement;
  readonly noteCard: HTMLDivElement;
  readonly skipBtn: HTMLButtonElement;
  private readonly countSelf: HTMLSpanElement;
  private readonly countGhost: HTMLSpanElement;
  private readonly balanceDot: HTMLElement;
  private readonly noteFront: HTMLDivElement;
  private readonly noteBack: HTMLDivElement;
  private readonly lineEls = new Map<number, HTMLDivElement>();

  readonly subs = new SubtitleQueue();
  hint: HintState | null = null;
  private flashSelf = [-1, -1, -1];
  private flashFollow = [-1, -1, -1];
  private count: CountState | null = null;
  private noteUntil = -1;
  private noteOpen: NoteOpenState | null = null;
  private chName = '';
  private chT0 = 0;
  private subsVersion = -1;
  private hintDrawn = '';
  private noteVersion = 0;
  private noteDrawn = -1;
  showFollower = true;
  behindFaded = false;
  device: Device = 'keyboard';
  settings: Settings | null = null;
  /** 当前段是不是静场（hold 提示的触摸文字随之变化）。 */
  inStill = false;
  /** 最近一次腿偏移的方向（straighten 提示显示反方向箭头）。 */
  driftDir: -1 | 1 | null = null;
  /** 「跳过」按钮是否可用（由 UI 按「看过 / 重试」判断）。 */
  skipVisible = false;
  skipHolding = false;
  /** 调试（hudDemo）：强制显示平衡线，值为 θ（rad）。 */
  forceBalance: number | null = null;
  private lastT = 0;
  /** 最近一次 render 的节拍器视图（测试用）。 */
  lastMetro: MetroView | null = null;

  constructor(parent: HTMLElement, onPause: () => void) {
    this.root = h('div', 'hw-layer hw-hud', undefined, parent);
    this.chname = h('div', 'hw-chname', undefined, this.root);
    this.pauseBtn = h('button', 'hw-pausebtn', '‖', this.root);
    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('data-ui-control', '1');
    this.pauseBtn.setAttribute('aria-label', STR.pause);
    this.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); onPause(); });
    this.bottom = h('div', 'hw-bottom', undefined, this.root);
    // 纸条翻看也在纵向栈里（最上面），所以它和字幕在任何分辨率下都不会重叠
    this.noteCard = h('div', 'hw-noteopen', undefined, this.bottom);
    const inner = h('div', 'hw-paper-inner', undefined, this.noteCard);
    this.noteFront = h('div', 'hw-paper-face front', undefined, inner);
    this.noteBack = h('div', 'hw-paper-face back', undefined, inner);
    this.subsEl = h('div', 'hw-subs', undefined, this.bottom);
    this.hintEl = h('div', 'hw-hint', undefined, this.bottom);
    this.countEl = h('div', 'hw-count', undefined, this.root);
    this.countSelf = h('span', 'n', undefined, this.countEl);
    this.countGhost = h('span', 'ghost', undefined, this.countEl);
    this.balanceEl = h('div', 'hw-balance', undefined, this.bottom);
    h('i', 'line', undefined, this.balanceEl);
    this.balanceDot = h('b', 'dot', undefined, this.balanceEl);
    this.metroEl = h('div', 'hw-metro', undefined, this.bottom);
    this.followDots = h('div', 'hw-dots hw-follow', undefined, this.metroEl);
    this.selfDots = h('div', 'hw-dots hw-self', undefined, this.metroEl);
    for (let i = 0; i < 3; i++) { h('i', 'hw-dot', undefined, this.selfDots); h('i', 'hw-dot', undefined, this.followDots); }
    this.noteFlashEl = h('div', 'hw-notefl', undefined, this.root);
    h('span', 'paper', undefined, this.noteFlashEl);
    h('span', 'label', STR.note, this.noteFlashEl);
    this.skipBtn = h('button', 'hw-skipbtn', STR.skip, this.root);
    this.skipBtn.type = 'button';
    this.skipBtn.setAttribute('data-ui-control', '1');
  }

  // ——————————————— 模型（事件调用，不碰 DOM）———————————————
  setChapter(name: string, t: number): void { this.chName = name; this.chT0 = t; }
  /** 重来 / 读章：清空字幕、提示、数数、闪点。 */
  reset(): void {
    this.subs.clear(); this.hint = null; this.count = null; this.noteOpen = null; this.noteUntil = -1;
    this.flashSelf = [-1, -1, -1]; this.flashFollow = [-1, -1, -1]; this.noteVersion++;
  }
  newChapter(t: number): void {
    this.reset(); this.subs.newChapter(); this.showFollower = true; this.behindFaded = false; this.driftDir = null; this.chT0 = t;
  }

  text(keys: readonly string[], style: TextStyle, speaker: Speaker | undefined, pan: number, t: number): number {
    return this.subs.push(keys, keys.map((k) => lineText(k)), style, speaker, pan, t);
  }
  /** 直接推入显示文字（keys 仍用于「看过没有」）。 */
  textRaw(keys: readonly string[], texts: readonly string[], style: TextStyle, pan: number, t: number): number {
    return this.subs.push(keys, texts, style, undefined, pan, t);
  }

  showHint(id: HintId, source: HintSource, t: number, seconds: number): void {
    this.hint = { id, source, until: t + seconds, still: source === 'still' || this.inStill, t0: t, first: source !== 'still' };
  }
  /** prompt 事件的 hint = null：只撤掉由 prompt / 静场显示的提示，不影响教学提示。 */
  clearPromptHint(): void { if (this.hint && this.hint.source !== 'cue') this.hint = null; }
  clearHint(): void { this.hint = null; }

  contact(part: 'heel' | 'knuckle' | 'pad', t: number, follower: boolean): void {
    const i = part === 'heel' ? 0 : part === 'knuckle' ? 1 : 2;
    (follower ? this.flashFollow : this.flashSelf)[i] = t;
  }

  /** 数数（§3、§7.2）：之后每次掌根落地计一个数；ghostLag > 0 时它的数字晚 ghostLag 个出现（灰色残影）。 */
  countStart(from: number, to: number, ghostLag: number, t: number): void {
    this.count = { from, step: to >= from ? 1 : -1, len: Math.abs(to - from) + 1, lag: Math.max(0, Math.round(ghostLag)), k: 0, until: t + 30 };
  }
  countTick(t: number): void {
    const c = this.count;
    if (!c) return;
    c.k++;
    if (c.k - 1 - c.lag >= c.len) { this.count = null; return; }
    c.until = t + 1.5;
  }
  /** 当前显示的数（测试用）：[自己, 残影]，没有时为 null。 */
  countShown(): [string | null, string | null] {
    const c = this.count;
    if (!c || c.k === 0) return [null, null];
    const i = c.k - 1, g = c.k - 1 - c.lag;
    const self = i < c.len ? numZh(c.from + c.step * i) : null;
    const ghost = c.lag > 0 && g >= 0 && g < c.len ? numZh(c.from + c.step * g) : null;
    return [self, ghost];
  }

  noteFlash(t: number, seconds = NOTE_FLASH_SEC): void { this.noteUntil = t + seconds; }
  openNote(id: string, def: NoteDef | null, t: number): void { this.noteOpen = { id, def, t0: t }; this.noteVersion++; }
  /** 收起纸条翻看（跳过静场之后不能挂到下一段上）。 */
  closeNote(): void { if (this.noteOpen) { this.noteOpen = null; this.noteVersion++; } }

  // ——————————————— 渲染（每帧一次，经 DomBatch）———————————————
  render(snap: SimSnapshot, b: DomBatch, o: { palm: 'none' | 'heat' | 'numb'; playing: boolean }): void {
    const t = snap.t;
    if (t < this.lastT - 0.5) this.reset();        // 读章 / 跳转后模拟时钟回退
    this.lastT = t;
    const st = this.settings;
    // 章名
    b.text(this.chname, this.chName);
    b.cls(this.chname, 'faded', t - this.chT0 > CHNAME_FADE_SEC);
    // 字幕
    this.subs.expire(t);
    if (this.subs.version !== this.subsVersion) {
      this.subsVersion = this.subs.version;
      const lines = this.subs.lines.slice();
      b.run(() => this.reconcileLines(lines));
    }
    // 提示
    if (this.hint && this.hint.until < t) this.hint = null;
    const hint = this.hint;
    const ht = hint ? hintText(hint.id, this.device, { still: hint.still, driftDir: this.driftDir }) : '';
    if (ht !== this.hintDrawn) { this.hintDrawn = ht; b.run(() => fillHint(this.hintEl, ht)); }
    b.cls(this.hintEl, 'on', !!ht);
    b.cls(this.hintEl, 'first', !!ht && !!hint && hint.first && t - hint.t0 < FIRST_HINT_SEC);
    // 数数：每出一个新数，数字和残影各自重新淡入（换一个同样的动画名，CSS 动画才会重播）
    if (this.count && this.count.until < t) this.count = null;
    const [cs, cg] = this.countShown();
    const alt = (this.count?.k ?? 0) % 2 === 1;
    b.cls(this.countEl, 'on', !!(cs || cg));
    b.text(this.countSelf, cs ?? '');
    b.text(this.countGhost, cg ?? '');
    b.cls(this.countSelf, 'alt', alt);
    b.cls(this.countGhost, 'alt', alt);
    // 平衡线（七步）
    const stand = snap.player.stand;
    const bal = this.forceBalance !== null || (!!stand && stand.script === 'sevenSteps' && (stand.phase === 'walking' || stand.phase === 'planted'));
    b.cls(this.balanceEl, 'on', bal);
    const theta = this.forceBalance ?? stand?.theta ?? 0;
    const bx = bal ? Math.round(Math.max(-1, Math.min(1, theta / BALANCE_RANGE)) * BALANCE_HALF_PX) : 0;
    b.style(this.balanceDot, 'transform', `translateX(${bx}px)`);
    // 节拍器
    const m = metronome({
      t, steady: snap.player.steady, follower: snap.follower as FollowerSnap, flashSelf: this.flashSelf, flashFollow: this.flashFollow,
      metronome: st?.metronome !== false, showFollower: this.showFollower, behindFaded: this.behindFaded,
      reducedMotion: st?.reducedMotion === true, palm: o.palm,
    });
    this.lastMetro = m;
    b.cls(this.metroEl, 'on', o.playing);
    b.cls(this.root, 'hw-lift', snap.segKind === 'still' && METRO_LIFT_SETS.has(snap.still?.set ?? ''));
    b.style(this.selfDots, 'opacity', m.selfVisible ? String(m.selfOpacity) : '0');
    b.style(this.selfDots, 'transform', `translate(calc(-50% + ${m.selfDx}px), calc(-50% + ${m.selfDy}px))`);
    b.cls(this.selfDots, 'white', m.selfWhite);
    b.cls(this.selfDots, 'tremble', m.selfTremble);
    const sd = this.selfDots.children;
    for (let i = 0; i < 3; i++) { const d = sd[i]; if (d) b.cls(d, 'lit', m.selfLit[i] as boolean); }
    b.style(this.followDots, 'opacity', String(m.followOpacity));
    b.cls(this.followDots, 'shadow', m.followKind === 'shadow');
    b.style(this.followDots, 'transform', `translate(calc(-50% + ${m.followDx}px), calc(-50% + ${m.followDy}px))`);
    const fd = this.followDots.children;
    for (let i = 0; i < 3; i++) { const d = fd[i]; if (d) b.cls(d, 'lit', m.followLit[i] as boolean); }
    // 纸条闪现、纸条翻看
    b.cls(this.noteFlashEl, 'on', this.noteUntil > t);
    this.renderNoteOpen(t, b);
    // 跳过
    b.cls(this.skipBtn, 'on', this.skipVisible);
    b.cls(this.skipBtn, 'holding', this.skipVisible && this.skipHolding);
  }

  private renderNoteOpen(t: number, b: DomBatch): void {
    const n = this.noteOpen;
    if (n && t - n.t0 >= NOTE_OPEN.endAt) this.noteOpen = null;
    const cur = this.noteOpen;
    if (this.noteDrawn !== this.noteVersion) {
      this.noteDrawn = this.noteVersion;
      const def = cur?.def ?? null;
      b.run(() => {
        fillPaper(this.noteFront, def, 'front');
        fillPaper(this.noteBack, def, 'back');
      });
    }
    const k = cur ? t - cur.t0 : -1;
    b.cls(this.noteCard, 'on', !!cur);
    b.cls(this.noteCard, 'fading', !!cur && k >= NOTE_OPEN.fadeAt);
    b.cls(this.noteCard, 'flipped', !!cur && k >= NOTE_OPEN.flipAt);
  }

  private reconcileLines(lines: readonly SubLine[]): void {
    const keep = new Set(lines.map((l) => l.key));
    for (const [k, el] of this.lineEls) if (!keep.has(k)) { el.remove(); this.lineEls.delete(k); }
    for (const l of lines) {
      if (this.lineEls.has(l.key)) continue;
      const d = document.createElement('div');
      d.className = `hw-line ${l.style}${l.side < 0 ? ' side-l' : l.side > 0 ? ' side-r' : ''}`;
      if (l.speaker) { const s = document.createElement('span'); s.className = 'sp'; s.textContent = SPEAKERS[l.speaker]; d.appendChild(s); }
      d.appendChild(document.createTextNode(l.text));
      this.subsEl.appendChild(d);
      this.lineEls.set(l.key, d);
    }
  }

  /** 当前显示的字幕文字（测试用）。 */
  currentText(): string[] { return this.subs.lines.map((l) => l.text); }
}

/** 提示文字：箭头单独包一层（更粗的字重，styles.css 的 .k），其余照常。 */
export function fillHint(el: HTMLElement, text: string): void {
  el.replaceChildren();
  for (const part of text.split(/([←↑→↓]+)/u)) {
    if (!part) continue;
    if (/^[←↑→↓]+$/u.test(part)) { const k = document.createElement('b'); k.className = 'k'; k.textContent = part; el.appendChild(k); }
    else el.appendChild(document.createTextNode(part));
  }
}

/** 纸条的一面（HUD 翻看与纸条界面共用）。 */
export function fillPaper(el: HTMLElement, def: NoteDef | null, side: 'front' | 'back'): void {
  el.replaceChildren();
  if (!def) return;
  if (side === 'front' && def.face === 'doodle') {
    const d = document.createElement('div');
    d.className = 'doodle';
    d.innerHTML = DOODLE_SVG;
    el.appendChild(d);
  }
  const line = side === 'front' ? def.front : def.back;
  if (line) {
    const p = document.createElement('div');
    p.className = `pencil${side === 'back' ? ' back' : ''}`;
    p.textContent = lineText(line);
    el.appendChild(p);
  }
}

/** 手掌和脚掌的简笔画（n1-a，§3「纸条」）。铅笔线，不画脸。 */
export const DOODLE_SVG = `<svg viewBox="0 0 120 70" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
<path d="M14 58 C12 46 13 38 16 32 L15 16 C15 13 19 13 19 16 L20 29 L21 11 C21 8 25 8 25 11 L25 29 L27 12 C27 9 31 9 31 12 L30 30 L33 18 C33 15 37 16 36 19 L34 36 C36 33 40 32 41 35 C38 41 35 47 33 58 Z"/>
<path d="M66 58 C63 50 64 42 70 36 C74 32 76 24 79 18 C81 14 87 14 88 19 C90 27 88 36 88 44 C88 52 84 58 78 59 C73 60 68 60 66 58 Z"/>
<circle cx="81" cy="12" r="2.2"/><circle cx="86" cy="11" r="1.8"/><circle cx="90" cy="13" r="1.6"/><circle cx="93" cy="16" r="1.4"/><circle cx="95" cy="20" r="1.2"/>
<path d="M50 40 L58 40 M55 37 L58 40 L55 43"/>
</svg>`;
