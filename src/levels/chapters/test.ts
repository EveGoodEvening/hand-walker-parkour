// src/levels/chapters/test.ts —— 32 拍测试章（DESIGN.md §8.9-11）。CORE 冻结。
// 覆盖三类必需动作障碍（低矮 / 横档 / 挡道）和一次回头窗口；只用 CORE 占位 kit，不依赖任何工作包。
// 节奏按第一章的铁律排：前 1.6 s、后 0.8 s 空；新类别首次出现时该行只有它，接触前 ≥ 1.2 s 有提示，
// 接触后 1.2 s 内没有别的必需动作；回头窗口 ≥ 1.2 s。
import type { ChapterDef } from '../schema';

export default {
  id: 'test', title: '测试', name: '测试', seed: 42,
  card: ['c1.card'],
  outro: { lines: [{ line: 'c1.out3' }] },
  notes: [],
  requiredBeats: ['testLook'],
  segments: [
    {
      id: 't-1', kind: 'run', kit: 'placeholder', variant: 'default', atmosphere: 'morning', surface: 'terrazzo',
      beats: 32, stride: 1.0, cadence: 4.4,
      follower: { mode: 'behind', steady: 3 },
      rows: [[10, '.L.'], [17, '.H.'], [24, '.B.']],
      windows: [{ id: 'testLook', from: 25, to: 31, type: 'lookBack', auto: true, gain: 1, then: [
        { at: 0.0, type: 'text', line: 'c1.empty' },
      ] }],
      events: [
        { at: 2, type: 'hint', hint: 'jump' },
        { at: 9, type: 'hint', hint: 'duck' },
        { at: 16, type: 'hint', hint: 'lane' },
        { at: 24, type: 'hint', hint: 'look' },
      ],
    },
  ],
} satisfies ChapterDef;
