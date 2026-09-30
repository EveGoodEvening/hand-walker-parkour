// tests/unit/ui/subtitles.test.ts —— 字幕队列（DESIGN.md §7.2 字幕规则、§2.7；§8.10 WP8 验收 5）。
// 停留时间 = 字数 × 90 ms + 800 ms，重试 / 重看时已看过的减半；屏幕上最多 2 行，新行把旧行往上推。
import { describe, expect, it } from 'vitest';
import { TEXT } from '../../../src/core/constants';
import { lineText } from '../../../src/levels/lines';
import { dwellSeconds, sideOf, SubtitleQueue } from '../../../src/ui/hud/subtitles';

const q = () => new SubtitleQueue();
const push = (s: SubtitleQueue, id: string, t: number, style: 'narration' | 'self' | 'other' | 'whisper' | 'board' = 'narration', o: { speaker?: 'chenMo'; pan?: number } = {}) =>
  s.push([id], [lineText(id)], style, o.speaker, o.pan ?? 0, t);

describe('停留时间公式', () => {
  it('字数 × 90 ms + 800 ms（字数含标点，不含自动加的引号）', () => {
    expect(TEXT.msPerChar).toBe(90); expect(TEXT.baseMs).toBe(800);
    expect(dwellSeconds('走廊空了。', false)).toBeCloseTo((5 * 90 + 800) / 1000, 9);   // 1.25 s
    expect(dwellSeconds('掌心擦过地面的声音很稳，像在给自己鼓掌。', false)).toBeCloseTo((20 * 90 + 800) / 1000, 9);
    const s = q();
    const d = push(s, 'c1.hey', 10, 'other', { speaker: 'chenMo' });                 // 「喂。」2 字
    expect(d).toBeCloseTo(0.98, 9);
    expect(s.lines[0]?.until).toBeCloseTo(10.98, 9);
    expect(s.lines[0]?.text).toBe('“喂。”');
  });
  it('已看过的减半（重试时同一句再出现）', () => {
    const s = q();
    expect(push(s, 'c1.empty', 0)).toBeCloseTo(1.25, 9);
    s.clear();                                                              // 重来
    expect(push(s, 'c1.empty', 5)).toBeCloseTo(0.625, 9);
    expect(s.hasSeen('c1.empty')).toBe(true);
  });
  it('过期按模拟时间去掉', () => {
    const s = q();
    push(s, 'c1.empty', 0);
    expect(s.expire(1.24)).toBe(false);
    expect(s.expire(1.26)).toBe(true);
    expect(s.lines.length).toBe(0);
  });
});

describe('同屏最多 2 行', () => {
  it('第三行进来时最旧的一行被推走', () => {
    const s = q();
    push(s, 'c1.hurtQ', 0, 'other', { speaker: 'chenMo' });
    push(s, 'c1.hurtA1', 0.8, 'self');
    push(s, 'c1.hurtA2', 1.6, 'self');
    expect(s.lines.map((l) => l.text)).toEqual(['“疼。”', '“每天都疼。”']);
    expect(s.lines.length).toBeLessThanOrEqual(TEXT.maxLines);
  });
  it('一个文字事件的两行（原文一句拆两行）共用停留时间，按总字数算', () => {
    const s = q();
    const d = s.push(['a', 'b'], ['它在所有能反光的地方，', '在所有我本该站起来却没有站起来的地方。'], 'narration', undefined, 0, 0);
    const n = Array.from('它在所有能反光的地方，在所有我本该站起来却没有站起来的地方。').length;
    expect(d).toBeCloseTo((n * 90 + 800) / 1000, 9);
    expect(s.lines.length).toBe(2);
    expect(s.lines[0]?.until).toBe(s.lines[1]?.until);
  });
});

describe('样式', () => {
  it('说话人名只在他本章第一次开口时显示；新章节重新计', () => {
    const s = q();
    push(s, 'c1.hey', 0, 'other', { speaker: 'chenMo' });
    push(s, 'c1.handsQ', 1, 'other', { speaker: 'chenMo' });
    expect(s.lines.map((l) => l.speaker)).toEqual(['chenMo', null]);
    s.newChapter();
    push(s, 'c1.hey', 0, 'other', { speaker: 'chenMo' });
    expect(s.lines[0]?.speaker).toBe('chenMo');
  });
  it('低语贴在声像那一侧；旁白、自己不加位移', () => {
    expect(sideOf(-0.6)).toBe(-1); expect(sideOf(0.6)).toBe(1); expect(sideOf(0.1)).toBe(0);
    const s = q();
    push(s, 'c1.nickname', 0, 'whisper', { pan: -0.6 });
    push(s, 'c1.empty', 0, 'narration', { pan: -0.6 });
    expect(s.lines.map((l) => l.side)).toEqual([-1, 0]);
  });
  it('黑板字不进字幕', () => {
    const s = q();
    expect(push(s, 'c1.empty', 0, 'board')).toBe(0);
    expect(s.lines.length).toBe(0);
  });
});
