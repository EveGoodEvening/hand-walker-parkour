// tests/unit/content/subtitles.test.ts —— 字幕的滚动两行不把还没读完的行提前挤掉（DESIGN.md §7.2 字幕规则、附录 A-8）。归 WP2。
// 屏幕上最多 2 行，新的文字事件把最旧的行挤上去、挤掉（ui/hud/subtitles.ts）。一个两行事件之后紧跟一行，最旧的那行
// 只显示了一半就没了（评审修复 U1 复验：5-11「我要找到那个还在爬行的影子，」只显示 46%）。这里用 perfect 自动驾驶把五章
// 各跑一遍，按 SubtitleQueue 的规则模拟队列：每一行被挤掉之前，至少要显示它停留时间的 85%。
import { describe, expect, it } from 'vitest';
import type { ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import { compile } from '../../../src/levels/compile';
import { lineText, type LineId } from '../../../src/levels/lines';
import type { ChapterDef, EventBody } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';
import { dwellSeconds } from '../../../src/ui/hud/subtitles';
import { TEXT } from '../../../src/core/constants';

const IDS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as const;
const MIN_SHOWN = 0.85;

interface Shown { id: string; seg: string; t: number; until: number }

function pushedEarly(id: ChapterId): string[] {
  const c = compile(getChapter(id) as ChapterDef);
  const sim = new Sim(solver);
  sim.load(c, undefined, c.seed);
  sim.setAutopilot('perfect');
  let q: Shown[] = [];
  const out: string[] = [];
  for (let i = 0; i < 120 * 600 && !sim.isEnded; i++) {
    sim.step([], new Set());
    const t = sim.snapshot().t;
    for (const e of sim.drain()) {
      const d = e.data as { body?: EventBody; segment?: string };
      const b = d.body;
      if (e.type !== 'cue' || !b || b.type !== 'text' || b.style === 'board') continue;
      const ids = (Array.isArray(b.line) ? b.line : [b.line]) as LineId[];
      const dur = dwellSeconds(ids.map((l) => lineText(l)).join(''), false);
      q = q.filter((l) => l.until > t);
      for (const lid of ids) q.push({ id: lid, seg: d.segment ?? sim.snapshot().segment, t, until: t + dur });
      while (q.length > TEXT.maxLines) {
        const old = q.shift() as Shown;
        const k = (t - old.t) / (old.until - old.t);
        if (k < MIN_SHOWN) out.push(`${old.seg} ${old.id} shown ${(100 * k).toFixed(0)}% (pushed by ${ids.join('+')})`);
      }
    }
  }
  return out;
}

describe('字幕：滚动的两行不把还没读完的行提前挤掉（perfect 自动驾驶，章节种子）', () => {
  for (const id of IDS) {
    it(`${id}：每一行被挤掉前至少显示停留时间的 ${MIN_SHOWN * 100}%`, () => {
      expect(pushedEarly(id)).toEqual([]);
    });
  }
});
