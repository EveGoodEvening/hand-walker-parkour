// src/ui/hud/subtitles.ts —— 字幕队列（DESIGN.md §7.2 字幕规则、§2.7、§4.0 字幕样式）。WP8。纯模型，不碰 DOM。
// · 停留时间 = 字数 × 90 ms + 800 ms（字数按整个文字事件算，不含自动加的引号）；已看过的减半（重试、重看）。
// · 屏幕上最多 2 行，新行把旧行往上推（超出时丢掉最旧的一行）。
// · self / other 自动加「“”」；other 的说话人名只在他本章第一次开口时显示在上方（11 px 小字）。
// · whisper 贴在声像那一侧（pan < −0.15 靠左，> 0.15 靠右）；board 不进字幕。
// · 一个文字事件的 line 可以是数组（原文一句拆成两行），每个 LineId 一行，共用同一个停留时间。
import { TEXT } from '../../core/constants';
import type { Speaker, TextStyle } from '../../core/types';

export interface SubLine {
  key: number; text: string; style: TextStyle; speaker: Speaker | null; until: number; side: -1 | 0 | 1;
}

/** 停留时间（秒）。 */
export function dwellSeconds(text: string, seen: boolean): number {
  const ms = Array.from(text).length * TEXT.msPerChar + TEXT.baseMs;
  return (seen ? ms / 2 : ms) / 1000;
}

export function sideOf(pan: number): -1 | 0 | 1 { return pan < -0.15 ? -1 : pan > 0.15 ? 1 : 0; }

export class SubtitleQueue {
  lines: SubLine[] = [];
  /** 已经显示过的文字（按 LineId 或文字本身），本次运行内有效。 */
  private readonly seen = new Set<string>();
  private readonly spoken = new Set<Speaker>();
  private seq = 0;
  /** 模型版本号：每次变化 +1，渲染层据此判断要不要改 DOM。 */
  version = 0;

  /**
   * 推入一个文字事件。keys 用来判断「看过没有」（通常是 LineId）；texts 是对应的显示文字。
   * 返回本次的停留时间（秒）。
   */
  push(keys: readonly string[], texts: readonly string[], style: TextStyle, speaker: Speaker | undefined, pan: number, t: number): number {
    const pairs = texts.map((x, i) => [keys[i] ?? x, x] as const).filter(([, x]) => !!x);
    if (!pairs.length || style === 'board') return 0;
    const all = pairs.map(([, x]) => x).join('');
    const seen = pairs.every(([k]) => this.seen.has(k));
    const dur = dwellSeconds(all, seen);
    for (const [k] of pairs) this.seen.add(k);
    let sp: Speaker | null = null;
    if (speaker && style === 'other' && !this.spoken.has(speaker)) { this.spoken.add(speaker); sp = speaker; }
    else if (speaker) this.spoken.add(speaker);
    const side = style === 'whisper' ? sideOf(pan) : 0;
    pairs.forEach(([, x], i) => {
      const quoted = style === 'self' || style === 'other' ? `“${x}”` : x;
      this.lines.push({ key: ++this.seq, text: quoted, style, speaker: i === 0 ? sp : null, until: t + dur, side });
    });
    while (this.lines.length > TEXT.maxLines) this.lines.shift();
    this.version++;
    return dur;
  }

  /** 去掉过期的行；返回是否有变化。 */
  expire(t: number): boolean {
    const n = this.lines.length;
    this.lines = this.lines.filter((l) => l.until > t);
    if (this.lines.length !== n) { this.version++; return true; }
    return false;
  }

  clear(): void { if (this.lines.length) { this.lines = []; this.version++; } }
  /** 新章节：说话人重新计「第一次开口」。已看过的文字不清（重玩时减半）。 */
  newChapter(): void { this.spoken.clear(); this.clear(); }
  /** 清除进度时一并忘掉看过的文字。 */
  forgetSeen(): void { this.seen.clear(); }
  hasSeen(key: string): boolean { return this.seen.has(key); }
}
