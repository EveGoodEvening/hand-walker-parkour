// tests/unit/content/quotes.test.ts —— 原文逐字核对（DESIGN.md R14、§8.10 WP2 验收 5）。归 WP2。
// 每条 quote = true 的台词都必须是出处章节原文的连续片段；原文由 sourceQuotes.ts 提供（只给测试用，不进产物）。
import { describe, expect, it } from 'vitest';
import { LINES, LINE_HOOKS, type LineEntry } from '../../../src/levels/lines';
import { FORBIDDEN_SOURCE, lintLines } from '../../../src/levels/lint';
import { SOURCE_CHAPTERS } from '../../../src/levels/sourceQuotes';

const entries = Object.entries(LINES as Readonly<Record<string, LineEntry>>);
const ZH = ['一', '二', '三', '四', '五'];

describe('sourceQuotes：五章原文', () => {
  it('每章以「# 第X章」开头、以「第X章·完」结尾', () => {
    for (const n of [1, 2, 3, 4, 5] as const) {
      const src = SOURCE_CHAPTERS[n];
      expect(src.startsWith(`# 第${ZH[n - 1]}章\n`), `ch${n}`).toBe(true);
      expect(src.trimEnd().endsWith(`第${ZH[n - 1]}章·完`), `ch${n}`).toBe(true);
      expect(src.length, `ch${n}`).toBeGreaterThan(2000);
    }
  });
  it('第四章那两句混入英文的原文确实在原文里（禁用表没有写错）', () => {
    for (const f of FORBIDDEN_SOURCE) expect(SOURCE_CHAPTERS[4].includes(f), f).toBe(true);
  });
});

describe('lines.ts：逐字对照原文', () => {
  it('全部条目都是原文（quote = true）', () => {
    for (const [id, e] of entries) expect(e.quote, id).toBe(true);
  });
  it.each(entries)('%s 是出处章节原文的连续片段', (_id, e) => {
    expect(SOURCE_CHAPTERS[e.ch].includes(e.t)).toBe(true);
  });
  it('不带引号、不跨段落', () => {
    for (const [id, e] of entries) {
      expect(/["“”「」\n]/.test(e.t), id).toBe(false);
    }
  });
  it('没有任何台词是第四章禁用原文的片段', () => {
    for (const [id, e] of entries) for (const f of FORBIDDEN_SOURCE) expect(f.includes(e.t), `${id} ⊂ ${f}`).toBe(false);
  });
  it('lintLines（含原文比对）零 error', () => {
    expect(lintLines(LINES, SOURCE_CHAPTERS).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('AGENTS.md Lessons 里的陷阱：拆句与标点', () => {
    // 「疼。每天都疼。」原文中间隔着「我说」→ 拆成两句
    expect(LINES['c1.hurtA1'].t).toBe('疼。');
    expect(LINES['c1.hurtA2'].t).toBe('每天都疼。');
    // 「它在所有能反光的地方，」原文后面是逗号
    expect(LINES['c3.reflective'].t.endsWith('，')).toBe(true);
    // 第二章「让一下。」「别。」原文用 ASCII 双引号：这里不带引号
    expect(LINES['c2.excuse'].t).toBe('让一下。');
    expect(LINES['c2.dont'].t).toBe('别。');
    // 跨段落的「我猛地回头。」「走廊空了。」只引后一句
    expect(LINES['c1.empty'].t).toBe('走廊空了。');
    // 「走了七步。」是「我」回答陈默；步数只能是七
    expect(LINES['c5.sevenSteps'].t).toBe('走了七步。');
  });
  it('代码取用的台词（LINE_HOOKS）都存在', () => {
    for (const id of Object.values(LINE_HOOKS)) expect((LINES as Record<string, LineEntry>)[id], id).toBeDefined();
  });
});
