// tests/unit/content/anomalies.test.ts —— 附录 A-11「任意 20 s 内最多一个主异常」，按 Sim 的实际时间轴检查。归 WP2。
// 校验器的 R6 只看跑段；这里把静场、站立段和跨段的间隔都算上（计数规则见 anomalyTimeline.ts 的头注释）。
import { describe, expect, it } from 'vitest';
import type { ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { A11_MIN_GAP, anomalyRun } from './anomalyTimeline';

const IDS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as const;
const ch = (id: ChapterId) => getChapter(id) as ChapterDef;

describe('附录 A-11：任意 20 s 内最多一个主异常（含静场、站立段、跨段；回头窗口按最坏时序）', () => {
  it.each(IDS)('%s', (id) => {
    const r = anomalyRun(ch(id));
    expect(r.ended, 'chapter reaches its end').toBe(true);
    expect(r.hits + r.falls, 'perfect autopilot has no hits').toBe(0);
    expect(r.violations).toEqual([]);
    for (let i = 1; i < r.scenes.length; i++) {
      const p = r.scenes[i - 1]!, q = r.scenes[i]!;
      expect(q.a - p.b, `${p.seg} → ${q.seg}`).toBeGreaterThanOrEqual(A11_MIN_GAP - 1e-6);
    }
  });

  it('第二章：2-5 → 2-6 → 2-7、2-9 → 2-10 → 停拍的五次间隔都 ≥ 20 s', () => {
    const r = anomalyRun(ch('ch2'));
    const segs = r.scenes.map((s) => s.seg);
    expect(segs).toEqual(['2-5', '2-6', '2-7', '2-9', '2-10', '2-10']);
    const what = r.scenes.map((s) => s.items.map((a) => a.what.replace(/ #.*/, '')).join(' + '));
    expect(what).toEqual(['doubleMod winSeat', 'doubleMod winWalk', 'follower behind', 'shadow pointBack + board write', 'shadow pointMirror', 'doubleMod chip']);
  });

  it('第一章 1-5：不按 Q、等到窗口结束自动回头时，水母影子与前后两个主异常都相隔 ≥ 20 s（§10.1 R6）', () => {
    const r = anomalyRun(ch('ch1'));
    const jelly = r.anomalies.find((a) => a.what.startsWith('shadow jellyfish'));
    expect(jelly).toBeDefined();
    expect(jelly!.b - jelly!.a, 'the look-back window spans an interval').toBeGreaterThan(1);
    const i = r.scenes.findIndex((s) => s.items.includes(jelly!));
    expect(r.scenes[i]!.a - r.scenes[i - 1]!.b).toBeGreaterThanOrEqual(A11_MIN_GAP);
    expect(r.scenes[i + 1]!.a - r.scenes[i]!.b).toBeGreaterThanOrEqual(A11_MIN_GAP);
  });
});
