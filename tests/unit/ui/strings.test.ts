// tests/unit/ui/strings.test.ts —— ui/strings.ts 过附录 B.8 的禁用规则（§8.10 WP8 验收 8）。
// WP2 的 levels/lint.ts 合并之前，这里按 B.8 原文实现同一套规则（纯函数，只读）；lint.ts 合并后 lead 可改为直接 import 它。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allStrings, CHAPTER_NAMES, HINTS, hintText, numZh, SPEAKERS, statsLine, STR } from '../../../src/ui/strings';

const BANNED_WORDS = ['yyds', '绝绝子', '破防', '内卷', '躺平', '666', '哈哈', '恭喜', '完美', '胜利', '通关', '成就', '解锁', '连击', '分数', '评级'];
const BANNED_SENTENCES = ['肩膀上，多了一只手。', '节奏散了。', '它没有等你。', '你前面。', '它搭上了我的肩。', '它走远了。', '走了四步。'];
const KEY_NAMES = /\b(Enter|Q|E)\b/g;

/** B.8：返回违规描述；空数组 = 通过。 */
function lint(s: string): string[] {
  const out: string[] = [];
  if (/\p{Extended_Pictographic}/u.test(s)) out.push('emoji');
  if (/[A-Za-z]/.test(s.replace(KEY_NAMES, ''))) out.push('latin');
  if (s.includes('！') && s !== '看！') out.push('exclamation');
  if (s.includes('!')) out.push('ascii exclamation');
  for (const w of BANNED_WORDS) if (s.includes(w)) out.push(`word ${w}`);
  for (const b of BANNED_SENTENCES) if (s.includes(b)) out.push(`sentence ${b}`);
  const m = s.match(/走了\s*([0-9一二三四五六八九十两]+)\s*步/);
  if (m && m[1] !== '七') out.push('walked N steps');
  if (Array.from(s).length > 24) out.push('longer than 24');
  if (s.includes('suddenly') || s.includes('chalk')) out.push('forbidden quote');
  return out;
}

describe('B.8 禁用规则', () => {
  it('lint 本身能抓到违规', () => {
    expect(lint('恭喜通关！')).toEqual(expect.arrayContaining(['exclamation', 'word 恭喜', 'word 通关']));
    expect(lint('Press E')).toContain('latin');
    expect(lint('走了四步。')).toEqual(expect.arrayContaining(['walked N steps']));
    expect(lint('Q 回头')).toEqual([]);
    expect(lint('按住 Enter 跳过')).toEqual([]);
  });
  it('ui/strings.ts 的每一个字符串都通过', () => {
    const bad = allStrings().map((s) => [s, lint(s)] as const).filter(([, v]) => v.length);
    expect(bad).toEqual([]);
  });
  it('只用附录 B.4 允许的系统文字（抽查），拉丁字母只出现在键名 Q、E、Enter 里', () => {
    expect(STR.failKey).toBe('按任意键，从检查点重来。'); expect(STR.failTouch).toBe('轻触，从检查点重来。');
    expect(STR.credits).toEqual(['手行者 · 跑酷', '改编自小说《手行者》', '全部画面与声音均由程序生成。']);
    expect(Object.values(CHAPTER_NAMES)).toEqual(['第一章　早自习', '第二章　午饭', '第三章　雨夜', '第四章　广场', '第五章　七步']);
    expect(SPEAKERS.lunchLady).toBe('阿姨');
    const latin = allStrings().filter((s) => /[A-Za-z]/.test(s));
    expect(latin.sort()).toEqual(['E 让一下', 'Q 回头', '按住 Enter 跳过'].sort());
  });
});

describe('B.2 操作提示按设备与情境', () => {
  it('键盘 / 触摸各一套', () => {
    expect(hintText('jump', 'keyboard')).toBe('↑ 撑跃'); expect(hintText('jump', 'touch')).toBe('上滑 撑跃');
    expect(hintText('look', 'touch')).toBe('点「回头」'); expect(hintText('skip', 'touch')).toBe('长按「跳过」');
    expect(HINTS.balance[1]).toBe('按住左半 / 右半屏 稳住');
  });
  it('HINTS 与 DESIGN.md 附录 B.2 表格逐条一致（括号里是给实现者的注释，不显示）', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../docs/DESIGN.md', import.meta.url)), 'utf8');
    const sec = doc.slice(doc.indexOf('### B.2'), doc.indexOf('### B.3'));
    const rows = new Map<string, [string, string]>();
    for (const line of sec.split('\n')) {
      const m = line.match(/^\|\s*`(\w+)`\s*\|([^|]*)\|([^|]*)\|\s*$/);
      if (!m) continue;
      const clean = (s: string) => s.replace(/（[^）]*）/g, '').trim();
      rows.set(m[1] as string, [clean(m[2] as string), clean(m[3] as string)]);
    }
    expect(rows.size).toBeGreaterThanOrEqual(17);
    // anyKey 不在 B.2 表里（取 B.4 失败卡文字的前半句），其余每一条都必须在表里且逐字一致。
    const ids = Object.keys(HINTS).filter((k) => k !== 'anyKey').sort();
    expect([...rows.keys()].sort()).toEqual(ids);
    for (const [id, pair] of rows) expect([id, ...HINTS[id as keyof typeof HINTS]]).toEqual([id, ...pair]);
    expect(sec).toContain('静场：按住屏幕');
  });
  it('hold 的触摸文字：跑段「下滑不松手」，静场「按住屏幕」', () => {
    expect(hintText('hold', 'touch')).toBe('下滑不松手');
    expect(hintText('hold', 'touch', { still: true })).toBe('按住屏幕');
    expect(hintText('hold', 'keyboard', { still: true })).toBe('↓ 按住');
  });
  it('straighten 的键盘文字显示偏移方向的反方向箭头', () => {
    expect(hintText('straighten', 'keyboard', { driftDir: -1 })).toBe('→ 掰正');
    expect(hintText('straighten', 'keyboard', { driftDir: 1 })).toBe('← 掰正');
    expect(hintText('straighten', 'keyboard')).toBe('← / → 掰正');
    expect(hintText('straighten', 'touch', { driftDir: 1 })).toBe('反方向滑 掰正');
  });
});

describe('B.6 结尾统计与数数', () => {
  it('用时 m:ss　摔倒 N　回头 N　纸条 a/b（全角空格分隔，第四章不写纸条）', () => {
    expect(statsLine(130_000, 0, 1, { got: 2, total: 2 })).toBe('用时 2:10　摔倒 0　回头 1　纸条 2/2');
    expect(statsLine(61_400, 3, 0, null)).toBe('用时 1:01　摔倒 3　回头 0');
  });
  it('中文数字（3-2 一到四，3-9 十二到一）', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 20, 21].map(numZh)).toEqual(['一', '二', '三', '四', '十', '十一', '十二', '二十', '二十一']);
  });
});
