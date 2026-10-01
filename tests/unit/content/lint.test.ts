// tests/unit/content/lint.test.ts —— 内容 lint 自身（DESIGN.md R14、附录 B.8）与全部内容零问题。归 WP2。
import { describe, expect, it } from 'vitest';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import { charCount, lintChapter, lintContent, lintStrings, lintText } from '../../../src/levels/lint';
import type { ChapterDef } from '../../../src/levels/schema';
import { SOURCE_CHAPTERS } from '../../../src/levels/sourceQuotes';
import * as UI from '../../../src/ui/strings';

/** ui/strings.ts（WP8）导出的全部文字表：对象、数组、字符串（函数与 Set / Map 不是文字）。按值收集，不按导出名取，
 *  WP8 改名或新增导出时这里照样全覆盖，不会因为名字对不上而编译失败。 */
function uiTables(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(UI)) {
    if (typeof v === 'string' || Array.isArray(v)) out[k] = v;
    else if (v !== null && typeof v === 'object' && !(v instanceof Set) && !(v instanceof Map)) out[k] = v;
  }
  return out;
}

const rules = (t: string, o?: Parameters<typeof lintText>[2]) => lintText(t, 't', o).map((i) => i.rule);

describe('lintText（R14、附录 B.8）', () => {
  it('合法的原文句子没有问题', () => {
    expect(rules('掌心擦过地面的声音很稳，像在给自己鼓掌。')).toEqual([]);
    expect(rules('看！')).toEqual([]);                 // 唯一允许的感叹号
    expect(rules('走了七步。')).toEqual([]);
  });
  it('拉丁字母、emoji、感叹号', () => {
    expect(rules('广场 suddenly 变得很安静。')).toContain('B.8-latin');
    expect(rules('ＯＫ')).toContain('B.8-latin');
    expect(rules('好快🙂')).toContain('B.8-emoji');
    expect(rules('跑！')).toContain('B.8-exclamation');
    expect(rules('跑!')).toContain('B.8-exclamation');
    expect(rules('看！看！')).toContain('B.8-exclamation');
  });
  it('禁用词、禁止的自创句、「走了 N 步」', () => {
    expect(rules('恭喜通关')).toContain('B.8-word');
    expect(rules('YYDS')).toContain('B.8-word');
    expect(rules('肩膀上，多了一只手。')).toContain('B.8-sentence');
    expect(rules('你前面。')).toContain('B.8-sentence');
    expect(rules('走了四步。')).toContain('B.8-steps');
    expect(rules('走了 3 步')).toContain('B.8-steps');
  });
  it('第四章禁用原文的中文片段也不能引用', () => {
    expect(rules('纹路很清楚，但没有灰，没有雨水，')).toContain('B.8-forbidden-quote');
  });
  it('每行 ≤ 24 字（按码点计）', () => {
    expect(charCount('……——')).toBe(4);
    expect(rules('一'.repeat(24))).toEqual([]);
    expect(rules('一'.repeat(25))).toContain('R14-length');
  });
  it('ui/strings：只允许键名 Q、E、Enter', () => {
    expect(lintStrings({ a: 'Q 回头', b: 'E 让一下', c: '按住 Enter 跳过' })).toEqual([]);
    expect(lintStrings({ a: 'Esc 暂停' }).map((i) => i.rule)).toContain('B.8-latin');
    expect(lintStrings({ a: 'QE 回头' }).map((i) => i.rule)).toContain('B.8-latin');
    expect(lintStrings(['恭喜'], 'x').map((i) => i.rule)).toContain('B.8-word');
  });
  it('当前 ui/strings.ts 通过（附录 B.8 同时作用于 ui/strings.ts）', () => {
    const tables = uiTables();
    expect(Object.keys(tables).length, 'ui/strings exports at least one text table').toBeGreaterThan(0);
    expect(lintStrings(tables)).toEqual([]);
  });
});

describe('lintChapter：能抓到数据错误', () => {
  const base = (): ChapterDef => structuredClone(getChapter('ch2') as ChapterDef);
  it('端盘段出现低矮障碍（R11）', () => {
    const d = base();
    const tray = d.segments.find((s) => s.id === '2-4');
    if (tray?.kind !== 'run') throw new Error('2-4 missing');
    tray.rows = [...(tray.rows ?? []), [30, ['.', 'bag', '.']]];
    expect(lintChapter(d).map((i) => i.rule)).toContain('R11');
  });
  it('文字事件超过 2 行、变体不存在、纸条超过 3 张、空白纸条写了字', () => {
    const d = base();
    const s = d.segments[0];
    if (s?.kind !== 'run') throw new Error('2-1 missing');
    s.events = [...(s.events ?? []), { at: 30, type: 'text', line: ['c2.spine', 'c2.spine', 'c2.spine'] }];
    s.variant = 'nope';
    d.notes = [...d.notes, { id: 'x1', face: 'blank', front: null, back: 'c2.noteBack', folded: false, pickup: false },
      { id: 'x2', face: 'blank', front: null, back: null, folded: false, pickup: false }];
    const r = lintChapter(d).map((i) => i.rule);
    expect(r).toEqual(expect.arrayContaining(['R14-lines', 'variant', 'notes']));
  });
});

describe('全部内容零问题（五章 + lines.ts + 原文比对）', () => {
  it('lintContent：零 error、零 warning', () => {
    const chapters = availableChapters().map((c) => getChapter(c) as ChapterDef);
    expect(chapters.length).toBe(5);
    expect(lintContent({ chapters, sources: SOURCE_CHAPTERS })).toEqual([]);
  });
});
