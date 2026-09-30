// src/ui/hud/Hud.ts —— HUD：章名、暂停键、字幕、操作提示、节拍器（实心点 / 空心点）、数数、纸条闪现、暗角（DESIGN.md §7.2）。
// CORE 写初版，之后归 WP8。所有计时用模拟时间（snap.t），无头测试里截图稳定；每帧对 DOM 的写入合并成一次。
import { FOLLOWER_MIX, HUD_PX_PER_BEAT, TEXT } from '../../core/constants';
import type { Settings } from '../../core/settings';
import type { Device, HintId, SimSnapshot, Speaker, TextStyle } from '../../core/types';
import { lineText } from '../../levels/lines';
import { ALWAYS_HINTS, HINTS, SPEAKERS, STR } from '../strings';

interface SubLine { text: string; style: TextStyle; speaker: string | null; until: number; pan: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  private chname: HTMLDivElement;
  private subs: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private selfDots: HTMLDivElement;
  private followDots: HTMLDivElement;
  private countEl: HTMLDivElement;
  private noteEl: HTMLDivElement;
  readonly vignette: HTMLDivElement;
  readonly pauseBtn: HTMLButtonElement;
  private lines: SubLine[] = [];
  private spoken = new Set<string>();
  private hint: { id: HintId; until: number } | null = null;
  private flashSelf = [-1, -1, -1];
  private flashFollow = [-1, -1, -1];
  private count: { n: number; to: number; step: number; ghost: number; shown: number; ghostShown: number; until: number } | null = null;
  private noteUntil = -1;
  private chT0 = 0;
  private dirty = true;
  private lastKey = '';
  showFollower = true;
  device: Device = 'keyboard';
  settings: Settings | null = null;
  private lastT = 0;

  constructor(parent: HTMLElement, onPause: () => void) {
    this.vignette = el('div', 'hw-layer hw-vignette', parent);
    this.root = el('div', 'hw-layer hw-hud', parent);
    this.chname = el('div', 'hw-chname', this.root);
    this.pauseBtn = el('button', 'hw-pausebtn', this.root);
    this.pauseBtn.type = 'button';
    this.pauseBtn.textContent = '‖';
    this.pauseBtn.setAttribute('data-ui-control', '1');
    this.pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); onPause(); });
    this.subs = el('div', 'hw-subs', this.root);
    this.hintEl = el('div', 'hw-hint', this.root);
    const metro = el('div', 'hw-metro', this.root);
    this.followDots = el('div', 'hw-dots hw-follow', metro);
    this.selfDots = el('div', 'hw-dots hw-self', metro);
    for (let i = 0; i < 3; i++) { el('i', 'hw-dot', this.selfDots); el('i', 'hw-dot', this.followDots); }
    this.countEl = el('div', 'hw-count', this.root);
    this.noteEl = el('div', 'hw-notefl', this.root);
    this.noteEl.textContent = STR.note;
  }

  show(on: boolean): void { this.root.classList.toggle('on', on); }
  setChapter(name: string, t: number): void { this.chname.textContent = name; this.chname.classList.remove('faded'); this.chT0 = t; }
  reset(): void { this.lines = []; this.hint = null; this.count = null; this.flashSelf = [-1, -1, -1]; this.flashFollow = [-1, -1, -1]; this.dirty = true; }
  resetSpeakers(): void { this.spoken.clear(); }

  text(ids: readonly string[], style: TextStyle, speaker: Speaker | undefined, pan: number, t: number): void {
    const text = ids.map((i) => lineText(i)).join('');
    if (!text) return;
    let sp: string | null = null;
    if (speaker && !this.spoken.has(speaker)) { this.spoken.add(speaker); sp = SPEAKERS[speaker]; }
    const quoted = style === 'self' || style === 'other' ? `“${text}”` : text;
    const dur = (Array.from(text).length * TEXT.msPerChar + TEXT.baseMs) / 1000;
    this.lines.push({ text: quoted, style, speaker: sp, until: t + dur, pan });
    while (this.lines.length > TEXT.maxLines) this.lines.shift();
    this.dirty = true;
  }

  setHint(id: HintId | null, t: number, seconds = 3.2): void {
    if (id && this.settings && !this.settings.hints && !ALWAYS_HINTS.has(id)) return;
    this.hint = id ? { id, until: t + seconds } : null;
    this.dirty = true;
  }

  contact(part: 'heel' | 'knuckle' | 'pad', t: number, follower: boolean): void {
    const i = part === 'heel' ? 0 : part === 'knuckle' ? 1 : 2;
    (follower ? this.flashFollow : this.flashSelf)[i] = t;
  }

  countStart(from: number, to: number, ghostLag: number, t: number): void {
    this.count = { n: from, to, step: to >= from ? 1 : -1, ghost: ghostLag, shown: from - (to >= from ? 1 : -1), ghostShown: NaN, until: t + 30 };
    this.dirty = true;
  }
  countTick(t: number): void {
    const c = this.count;
    if (!c) return;
    c.shown += c.step;
    c.ghostShown = c.ghost ? c.shown - c.step * c.ghost : NaN;
    if ((c.step > 0 && c.shown > c.to) || (c.step < 0 && c.shown < c.to)) this.count = null;
    else c.until = t + 1.5;
    this.dirty = true;
  }
  noteFlash(t: number): void { this.noteUntil = t + 1.2; this.dirty = true; }

  frame(snap: SimSnapshot): void {
    const t = snap.t;
    if (t < this.lastT - 0.5) { this.reset(); }
    this.lastT = t;
    if (t - this.chT0 > 8) this.chname.classList.add('faded');
    // 过期字幕
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.until > t);
    if (this.lines.length !== before) this.dirty = true;
    if (this.hint && this.hint.until < t) { this.hint = null; this.dirty = true; }
    if (this.count && this.count.until < t) { this.count = null; this.dirty = true; }
    // 节拍器：亮度按稳度 100 / 80 / 60 / 40%，稳度 0 时轻微颤动
    const steady = snap.player.steady;
    const bright = [0.4, 0.6, 0.8, 1][Math.max(0, Math.min(3, steady))] as number;
    const f = snap.follower;
    const metro = this.settings?.metronome !== false;
    const fShow = metro && this.showFollower && f.hud !== 'none';
    const lagPx = Math.abs(f.lagBeats) * HUD_PX_PER_BEAT;
    const ahead = f.from === 'front' || f.lagBeats < 0;
    const selfLit = this.flashSelf.map((ft) => ft >= 0 && t - ft >= 0 && t - ft < 0.15);
    const folLit = this.flashFollow.map((ft) => ft >= 0 && t - ft >= 0 && t - ft < 0.15);
    const jitter = steady === 0 && !(this.settings?.reducedMotion) ? Math.sin(t * 40) * 1.5 : 0;
    const vig = (f.mode === 'behind' || f.mode === 'pressure') ? (FOLLOWER_MIX[Math.max(0, Math.min(3, steady))]?.vignette ?? 0) : 0;
    const key = [selfLit.join(), folLit.join(), bright, fShow, lagPx.toFixed(1), ahead, f.hud, jitter.toFixed(1), vig, metro, this.noteUntil > t].join('|');
    if (!this.dirty && key === this.lastKey) return;
    this.lastKey = key;
    this.dirty = false;
    // —— 一次性写 DOM ——
    this.selfDots.style.display = metro ? '' : 'none';
    this.selfDots.style.opacity = String(bright);
    this.selfDots.style.transform = `translate(calc(-50% + ${jitter}px), -50%)`;
    Array.from(this.selfDots.children).forEach((d, i) => d.classList.toggle('lit', !!selfLit[i]));
    this.followDots.style.display = fShow ? '' : 'none';
    this.followDots.classList.toggle('shadow', f.hud === 'shadow');
    const dx = ahead ? lagPx : -lagPx, dy = ahead ? -lagPx * 0.5 : lagPx * 0.5;
    this.followDots.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    Array.from(this.followDots.children).forEach((d, i) => d.classList.toggle('lit', !!folLit[i]));
    this.vignette.style.opacity = String(vig);
    this.subs.replaceChildren(...this.lines.map((l) => {
      const d = document.createElement('div');
      d.className = `hw-line ${l.style}`;
      if (l.speaker) { const s = document.createElement('span'); s.className = 'sp'; s.textContent = l.speaker; d.appendChild(s); }
      d.appendChild(document.createTextNode(l.text));
      if (l.style === 'whisper' && l.pan) d.style.transform = `translateX(${Math.round(l.pan * 22)}vw)`;
      return d;
    }));
    const h = this.hint ? HINTS[this.hint.id][this.device === 'touch' ? 1 : 0] : '';
    this.hintEl.textContent = h;
    this.hintEl.classList.toggle('on', !!h);
    if (this.count) {
      this.countEl.style.display = '';
      this.countEl.replaceChildren();
      this.countEl.appendChild(document.createTextNode(numZh(this.count.shown)));
      if (!Number.isNaN(this.count.ghostShown)) { const g = document.createElement('span'); g.className = 'ghost'; g.textContent = numZh(this.count.ghostShown); this.countEl.appendChild(g); }
    } else this.countEl.style.display = 'none';
    this.noteEl.classList.toggle('on', this.noteUntil > t);
  }

  /** 当前显示的字幕文字（__game.getState().text）。 */
  currentText(): string[] { return this.lines.map((l) => l.text); }
}

const ZH = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
function numZh(n: number): string { return ZH[n] ?? String(n); }
