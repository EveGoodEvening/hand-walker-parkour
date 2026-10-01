// src/levels/chapters/ch1.ts —— 第一章 · 早自习（DESIGN.md §4.1、§8.6）。CORE 编写（可玩的首章），之后归 WP2。
// 数据照抄 §8.6，WP2 按 §10.1 的 lead 修订改了两处：
//   · 1-2 @36：第一次出现清洁车（cart）的那一行只有它（R7「新种类首次出现，该行只有它」），写成显式种类。
//   · R6 / 附录 A-11：玩家不按 Q、窗口结束才自动回头的最坏时序下，1-5 的水母影子与 1-6 的 doubleMod 原来只隔 18.9 s。
//     现在 1-5 回头窗口 @124–136 → @124–133（窗口开始不能再早：离 @24 追随者登场也要 ≥ 20 s），1-6 停拍 @20 → @23
//     （自动爬行 3.6 s → 3.4 s，停在 @29.8，段长仍是 30 拍），第三只手从停拍 +1.4 s 挪到 +1.8 s（「嘘」仍在 +2.6 s）。
//     两个间隔都 ≥ 20 s。各段拍数不变（tests/unit/core 断言了全章长度）。
//   · lead 集成（WP1 校验器 R5-R10）：1-5 从检查点 @104 起原来没有合规路线。@113 的 L 从中道挪到左道、@161 的 L 从左道挪到右道，
//     路线变成 23.5–23.8 s 换进左道、32.15 s 回中道，三个休息窗各放宽 0.3 s 仍然有解。只换车道，不改节拍和台词。
// 台词全部来自 lines.ts。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch1', title: '第一章', name: '早自习', seed: 1701,
  card: ['c1.card'],
  outro: { lines: [{ line: 'c1.out1' }, { line: 'c1.out2' }, { line: 'c1.out3' }] },
  notes: [
    { id: 'n1-desk', face: 'blank', front: null, back: 'c2.noteBack', folded: true, pickup: false },
    { id: 'n1-a', face: 'doodle', front: 'c1.evoFail', back: null, folded: false, pickup: true },
    { id: 'n1-b', face: 'blank', front: null, back: null, folded: false, pickup: true },
  ],
  requiredBeats: ['whisperHandWalker', 'memoryInverted', 'chenMoAsk', 'mirrorLate', 'bellWarning', 'noteDesk',
    'teacherDuty', 'footTwitch', 'firstSteps', 'emptyHall', 'shadowStanding', 'thirdHandShush'],
  segments: [
    /* 1-1 出教室：教撑跃 */
    {
      id: '1-1', kind: 'run', kit: 'classroom', variant: 'morning', atmosphere: 'morning', surface: 'terrazzo',
      beats: 28, stride: 1.0, cadence: 4.4,
      follower: { mode: 'hidden', steady: 3 },
      npcs: [{ id: 'class7', kind: 'seatedRow', from: 0, to: 22, side: 'both', density: 0.9, gaze: 'turnShoes' }],
      surfaces: [{ id: 'plate7', kind: 'doorPlate', side: 'L', from: 25, to: 25, y: [1.9, 2.1], text: '高二（7）班' }],
      rows: [[12, ['.', 'footOut', '.']], [20, ['.', 'footOut', '.']]],     // 静止伸在过道里的脚
      events: [
        { at: 0, type: 'text', line: 'c1.leaveClass' },
        { at: 4, type: 'hint', hint: 'jump' },
        { at: 0, type: 'ambience', amb: 'reading', level: 1, seconds: 1.5 },
      ],
    },
    /* 1-2 走廊·早：教换道、伏低；记忆；陈默 */
    {
      id: '1-2', kind: 'run', kit: 'corridor', variant: 'morning', atmosphere: 'morning', surface: 'terrazzo',
      beats: 176, stride: 1.0, cadence: [4.6, 5.0], checkpoints: [96],
      follower: { mode: 'hidden' },
      npcs: [
        { id: 'doorways', kind: 'standingCluster', from: 20, to: 92, side: 'both', density: 0.35, gaze: 'turnShoes' },
        { id: 'eyes', kind: 'standingCluster', from: 146, to: 166, side: 'both', density: 0.9, gaze: 'turnShoes' },
      ],
      surfaces: [{ id: 'win3f', kind: 'window', side: 'L', from: 44, to: 56, y: [1.0, 2.2], backdrop: 'evening' }],
      rows: [
        [17, '.B.'], [24, 'B..'], [30, '..L'], [36, ['cart', '.', 'cart']],   // 清洁车第一次出现：这一行只有它（R7）
        [46, 'WWW', 3],                          // 楼梯口：拖把桶留下的水渍
        [68, 'HHH'],                             // 报名长桌横跨三道：第一次伏低
        [75, 'L..'], [80, '..B'], [85, '.H.'], [90, 'B.L'],
        [130, 'L..'], [136, '.B.'], [142, '..H'], [147, 'L.B'],
        [162, '.L.'], [167, 'B..'],
      ],
      items: [
        { at: 106, lane: -1, kind: 'locker', len: 14 },                     // 储物柜夹出中道
        { at: 106, lane: 1, kind: 'locker', len: 14 },
        { at: 116, lane: 0, kind: 'chenMo', id: 'chenmo', behavior: { type: 'yield', atBeat: 115 } },
        { at: 118, lane: 0, kind: 'footOut', id: 'chenmoFoot', behavior: { type: 'static' } },
      ],
      notes: [{ at: 132, lane: 1, note: 'n1-a' }],
      events: [
        { at: 2, type: 'text', line: 'c1.nickname', style: 'whisper', pan: -0.6, id: 'whisperHandWalker' },
        { at: 10, type: 'hint', hint: 'lane' },
        { at: 40, type: 'text', line: 'c1.lastWeek' },
        { at: 47, type: 'text', line: 'c1.cold' },
        { at: 48, type: 'memory', what: 'handstandWindow', surface: 'win3f', seconds: 1.2, id: 'memoryInverted' },
        { at: 48, type: 'overlay', op: 'desaturate', seconds: 1.2 },
        { at: 53, type: 'text', line: 'c1.inverted' },
        { at: 60, type: 'hint', hint: 'duck' },
        { at: 108, type: 'text', line: 'c1.hey', style: 'other', speaker: 'chenMo' },
        { at: 109, type: 'slow', speed: 1.2, seconds: 4.2, ramp: 0.5, timeline: [
          { at: 0.3, type: 'text', line: 'c1.handsQ', style: 'other', speaker: 'chenMo', id: 'chenMoAsk' },
          { at: 1.3, type: 'text', line: 'c1.hurtQ', style: 'other', speaker: 'chenMo' },
          { at: 2.4, type: 'text', line: 'c1.hurtA1', style: 'self' },
          { at: 3.2, type: 'text', line: 'c1.hurtA2', style: 'self' },
        ] },
        { at: 124, type: 'text', line: 'c1.oldFriend' },
        { at: 156, type: 'text', line: 'c1.gaze' },
      ],
    },
    /* 1-3 厕所：水渍、周期障碍、慢半拍的倒影 */
    {
      id: '1-3', kind: 'run', kit: 'washroom', variant: 'morning', atmosphere: 'morning', surface: 'tile',
      beats: 72, stride: 1.0, cadence: 4.4,
      follower: { mode: 'hidden' },
      surfaces: [{ id: 'wcMirror', kind: 'mirror', side: 'L', from: 8, to: 60, y: [0.25, 1.6], backdrop: 'darkRoom' }],
      rows: [[14, '.W.', 3], [27, '.L.'], [49, 'W..', 3], [49, '..L'], [54, '.H.'], [63, 'L..']],
      items: [
        { at: 20, lane: 1, kind: 'stallDoor', behavior: { type: 'swing', period: 1.8, phase: 0 } },
        { at: 32, lane: 1, kind: 'stallDoor', behavior: { type: 'swing', period: 1.8, phase: 0.5 } },
      ],
      events: [
        { at: 0, type: 'text', line: 'c1.washroom' },
        { at: 6, type: 'double', spec: { id: 'wc', surface: 'wcMirror', source: 'history', delay: 0.35 } },
        { at: 9, type: 'hint', hint: 'wet' },
        { at: 38, type: 'doubleMod', target: 'wc', mod: { headLag: 0.6, headDownHold: 1.0 }, id: 'mirrorLate' },
        { at: 38, type: 'camera', shot: 'glanceLeft', seconds: 1.0 },
        { at: 40, type: 'text', line: 'c1.lateHead' },
        { at: 44, type: 'text', line: 'c1.stillDown' },
        { at: 56, type: 'lights', op: 'flicker', from: 56, to: 60, every: 1 },
        { at: 58, type: 'bell', kind: 'morning', id: 'bellWarning' },
        { at: 58, type: 'text', line: 'c1.bell' },
        { at: 66, type: 'text', line: 'c1.feetQ' },
      ],
    },
    /* 1-4 英语老师：静场；教「按住」 */
    {
      id: '1-4', kind: 'still', set: 'deskFeet', variant: 'teacher', atmosphere: 'morning', duration: 12,
      follower: { mode: 'hidden' },
      events: [
        { at: 0.0, type: 'camera', shot: 'deskFeet', seconds: 0 },
        { at: 0.6, type: 'noteGet', note: 'n1-desk' },
        { at: 0.8, type: 'text', line: 'c1.note', id: 'noteDesk' },
        { at: 1.4, type: 'sfx', sfx: 'heels' },
        { at: 3.2, type: 'text', line: 'c1.duty', style: 'other', speaker: 'englishTeacher', id: 'teacherDuty' },
        { at: 4.6, type: 'ambience', amb: 'room', level: 1, seconds: 0.8 },     // 早读结束，人走光
        { at: 5.0, type: 'actor', clip: 'feetArchDesk', seconds: 1.0 },
        { at: 5.0, type: 'sfx', sfx: 'muscle' },
        { at: 5.0, type: 'text', line: 'c1.footMoved', id: 'footTwitch' },
      ],
      input: { at: 6.0, hint: 'hold', mode: 'hold', holdSeconds: 0.5, timeout: 4, onDone: [
        { at: 0.2, type: 'text', line: 'c1.holdIt' },
        { at: 1.4, type: 'text', line: 'c1.stopped' },
        { at: 3.2, type: 'text', line: 'c1.waiting' },
      ] },
    },
    /* 1-5 值日·水银河：追随者登场；回头 */
    {
      id: '1-5', kind: 'run', kit: 'corridor', variant: 'wet', atmosphere: 'morning', surface: 'terrazzo',
      beats: 212, stride: 1.0, cadence: [5.0, 5.4], checkpoints: [104],
      follower: { mode: 'hidden' },
      rows: [
        [10, 'L..'], [15, '..B'],
        [36, 'W..', 4], [36, '.L.'], [41, 'B.B'], [46, '.H.'], [52, 'L..'], [52, '..W', 4],
        [57, '.B.'], [62, 'H..'], [67, '..L'], [72, 'B.H'], [78, '.L.'], [83, 'BB.'], [88, '..H'], [94, 'L.L'],
        [113, 'L..'], [118, '..B'], [126, 'W.W', 6],
        [156, '.B.'], [161, '..L'], [167, '..H'], [172, 'B.B'],
        [194, '..B'], [199, 'H..'], [204, '.L.'],
      ],
      patterns: [{ at: 178, pattern: 'tripleVault', lane: 0, gap: 5 }],     // 第一次「三连撑」
      notes: [{ at: 166, lane: -1, note: 'n1-b' }],
      windows: [{ id: 'emptyHall', from: 124, to: 133, type: 'lookBack', auto: true, gain: 1, then: [
        { at: 0.0, type: 'text', line: 'c1.empty' },
        { at: 0.9, type: 'shadow', mode: 'jellyfish', seconds: 3.0 },
        { at: 1.2, type: 'text', line: 'c1.shadowProne', id: 'shadowStanding' },
        { at: 2.6, type: 'text', line: 'c1.soundStood' },
      ] }],
      events: [
        { at: 24, type: 'follower', def: { mode: 'behind', steady: 3 }, id: 'firstSteps' },
        { at: 24, type: 'hud', op: 'show' },
        { at: 24, type: 'text', line: 'c1.behind' },
        { at: 30, type: 'text', line: 'c1.sameSteps' },
        { at: 122, type: 'hint', hint: 'look' },
        { at: 208, type: 'text', line: 'c1.iSaw' },
      ],
    },
    /* 1-6 擦不干净的镜子：嘘 */
    {
      id: '1-6', kind: 'run', kit: 'corridor', variant: 'mirrorEnd', atmosphere: 'morning', surface: 'terrazzo',
      beats: 30, stride: 1.0, cadence: 4.8,
      follower: { mode: 'behind' },
      surfaces: [{ id: 'endMirror', kind: 'endMirror', side: 'end', from: 30, to: 30, y: [0.15, 1.9], chipped: false, backdrop: 'darkRoom' }],
      rows: [[6, 'L..'], [12, '..B']],
      events: [
        { at: 2, type: 'double', spec: { id: 'endMirror', surface: 'endMirror', source: 'history', delay: 0 } },
        // 停拍在 @23：1-5 自动回头的水母影子（最坏时序）到这里的 doubleMod ≥ 20 s（附录 A-11）
        { at: 23, type: 'stop', seconds: 8, timeline: [
          { at: 0.6, type: 'text', line: 'c1.noLag' },
          { at: 1.8, type: 'doubleMod', target: 'endMirror', mod: { thirdHand: { gesture: 'shush', at: 0, hold: 3 } } },
          { at: 2.6, type: 'text', line: 'c1.shush', id: 'thirdHandShush' },
          { at: 2.6, type: 'sfx', sfx: 'shush' },
          { at: 2.6, type: 'hush', seconds: 30 },
          { at: 4.2, type: 'overlay', op: 'black', seconds: 1.5 },
          { at: 4.4, type: 'autoCrawl', speed: 2.0, seconds: 3.4 },
          { at: 5.2, type: 'text', line: 'c1.applause' },
          { at: 8.0, type: 'end' },
        ] },
      ],
    },
  ],
} satisfies ChapterDef;
