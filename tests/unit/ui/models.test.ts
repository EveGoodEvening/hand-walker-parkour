// tests/unit/ui/models.test.ts —— 叠加层与章节进度的纯模型（DESIGN.md §2.7 失败演出、§5 总则、§7.2 Pause、§7.3 减少闪烁）。
import { describe, expect, it } from 'vitest';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { OverlayState } from '../../../src/ui/hud/overlays';
import { chapterProgress, segmentSeconds } from '../../../src/ui/hud/progress';

describe('叠加层', () => {
  it('black：seconds 内淡到全黑；clear 回到 0；eyesClosed 压暗 60%', () => {
    const o = new OverlayState();
    o.apply('black', 1.5, 10);
    expect(o.view(10).black).toBe(0); expect(o.view(10.75).black).toBe(0.5); expect(o.view(12).black).toBe(1);
    o.apply('clear', 1, 12);
    expect(o.view(12.5).black).toBe(0.5); expect(o.view(13).black).toBe(0);
    o.apply('eyesClosed', 0.5, 20);
    expect(o.view(21).black).toBe(0.6);
  });
  it('desaturate：持续 seconds，前后渐变；canvas filter 用灰度，不用红色', () => {
    const o = new OverlayState();
    o.apply('desaturate', 1.2, 5);
    expect(o.view(5.1).desat).toBe(0.5); expect(o.view(5.6).desat).toBe(1); expect(o.view(6.3).desat).toBe(0);
    expect(o.view(5.6).filter).toContain('grayscale');
    expect(o.view(5.6).filter).not.toMatch(/sepia|hue-rotate/);
  });
  it('失败：摔倒后 0.8 s 内去饱和并变冷（减少闪烁时 1.2 s）', () => {
    const o = new OverlayState();
    o.fall(3);
    expect(o.view(3.4).desat).toBe(0.5); expect(o.view(3.8).desat).toBe(1); expect(o.view(3.8).cold).toBe(0.8);
    o.reset(); o.reducedFlicker = true; o.fall(3);
    expect(o.view(3.6).desat).toBe(0.5);
    o.reset();
    expect(o.view(4).filter).toBe('');
  });
  it('coldFade：减少闪烁时拉长到 ≥ 1.2 s；段落切换时褪去', () => {
    const o = new OverlayState();
    o.apply('coldFade', 0.8, 0);
    expect(o.view(0.4).cold).toBe(0.5); expect(o.view(1).cold).toBe(1);
    o.segment(2, false);
    expect(o.view(2.6).cold).toBe(0);
    const r = new OverlayState(); r.reducedFlicker = true;
    r.apply('coldFade', 0.8, 0);
    expect(r.view(0.6).cold).toBe(0.5);
  });
  it('掌心发烫 / 发麻：右缘渐晕 1.5 s，节拍器泛白 / 抖动', () => {
    const o = new OverlayState();
    o.apply('palmHeat', 1.5, 10);
    expect(o.view(10.75)).toMatchObject({ palm: 'heat', palmEdge: 1 });
    expect(o.view(11.6).palm).toBe('none');
    o.apply('palmNumb', 0, 20);
    expect(o.view(21).palm).toBe('numb');
  });
  it('跑段 ↔ 静场切换：黑场 1 → 0，0.4 s；黑场正在淡入时不打断', () => {
    const o = new OverlayState();
    o.segment(5, true);
    expect(o.view(5).black).toBe(1); expect(o.view(5.2).black).toBe(0.5); expect(o.view(5.4).black).toBe(0);
    o.apply('black', 1.5, 10); o.segment(10.5, true);
    expect(o.view(11.5).black).toBe(1);
  });
  it('受击：暗角脉冲 0.35 s', () => {
    const o = new OverlayState();
    o.hit(1);
    expect(o.view(1).pulse).toBe(1); expect(o.view(1.4).pulse).toBe(0);
  });
});

describe('章节进度线', () => {
  const ch1 = getChapter('ch1') as ChapterDef;
  it('段时长：跑段 = 拍数 ÷ 步频（渐变按对数公式），静场 = duration', () => {
    const s11 = ch1.segments[0]!; const s12 = ch1.segments[1]!; const s14 = ch1.segments[3]!;
    expect(segmentSeconds(s11)).toBeCloseTo(28 / 4.4, 6);
    expect(segmentSeconds(s12)).toBeCloseTo((176 / 0.4) * Math.log(5.0 / 4.6), 6);
    expect(segmentSeconds(s14)).toBe(12);
  });
  it('刻度 = 每个跑段的起点 + 段内检查点；当前位置单调前进，0..1', () => {
    const p0 = chapterProgress(ch1, { segIndex: 0, segBeat: 0 });
    expect(p0.pos).toBe(0);
    expect(p0.marks.length).toBe(5 + 2);            // 5 个跑段 + 1-2 @96、1-5 @104
    expect(p0.marks.every((m) => m >= 0 && m < 1)).toBe(true);
    const a = chapterProgress(ch1, { segIndex: 1, segBeat: 96 }).pos;
    const b = chapterProgress(ch1, { segIndex: 3, segBeat: 0, stillT: 6 }).pos;
    const c = chapterProgress(ch1, { segIndex: 5, segBeat: 30 }).pos;
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(c).toBe(1);
    expect(p0.marks).toContain(a);
  });
});
