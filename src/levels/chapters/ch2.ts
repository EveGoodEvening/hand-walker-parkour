// src/levels/chapters/ch2.ts —— 第二章 · 午饭（DESIGN.md §4.2、附录 B、附录 C）。归 WP2。
// 台词全部来自 lines.ts（原文逐字）。只 import schema（§8.2 规则 2）。
// 与 §4.2 表格的差异（为了附录 A-11「任意 20 s 内最多一个主异常」，按 Sim 时间轴算，静场里的异常也算；
// tests/unit/content/anomalies.test.ts 检查。其余照表）：
//   · 2-5 第三只手贴玻璃（静场 5.0 s）→ 2-6 加速 ≥ 20 s：2-6 从 90 拍加长到 110 拍，玻璃里的它 @52 出现、@66 加速
//     （表中 @30、@44），「玻璃里的它走得比我快。」@74，@80 走出画面；窗墙 @40–92。
//   · 2-6 加速 → 2-7 回声回来 ≥ 20 s：回声 @54（表中 @20）。停拍在 @82，离回声 28 拍（约 5.6 s，表中约 7 s），
//     检查点 @92、「不是回音。」@96、「回音不会在我停的时候停。」@102，加密的障碍从 @108 开始；段长 136 拍（表中 140）。
//   · 2-9 黑板上的问题（静场 6.0 s）→ 2-10 影子指向碎角镜 ≥ 20 s → 第三只手穿过玻璃 ≥ 20 s：2-10 从 40 拍加长到 140 拍，
//     影子 @56，碎角镜里的替身 @114，停拍 @139（停在镜前 1 m；第三只手在停拍 2.6 s，表中 2.2 s；冷色渐变、替身消失随之后移
//     0.4 s），镜子在 @140。纸条 n2-b 仍在 @16 左道。
//   · 2-10 加长只是为了时间，它仍是减速的叙事收束（§2.8）：只有 @10 一个障碍（中道的地面管线），另外 5 行只占边道，
//     待在中道不用动。密度 0.43 行 / 10 拍，去掉纸条后求解器只需要 1 次输入。本章最密的跑段是 2-8（1.63 行 / 10 拍）；
//     2-7 是 1.25。tests/unit/content/chapters.test.ts 的「§2.8 难度曲线」检查最后一个跑段不比高潮密。
//   · 为了让全章合计不超过 §4.6 的 +15%：2-2 从 150 拍缩到 136 拍（第三道人墙 @124 之后只留两行），2-8 从 96 拍缩到 86 拍。
//   · 2-2 加了一个走动的腿（@46 右道，1.2 m/s，约 @62 被追上），对应表中的「走动的腿」。人墙 2 前面 @95 那一行只挡左道：
//     @94 中道合上、右道打开时，中道的玩家往右换一次道就进了缝。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch2', title: '第二章', name: '午饭', seed: 1702,
  card: ['c2.card1', 'c2.card2'],
  outro: { lines: [{ line: 'c2.out1' }, { line: 'c2.out2' }] },
  notes: [
    { id: 'n2-a', face: 'blank', front: null, back: null, folded: false, pickup: true },
    { id: 'n2-b', face: 'blank', front: null, back: null, folded: false, pickup: true },
  ],
  requiredBeats: ['lunchBell', 'legForest', 'counterStand', 'trayCollar', 'reflectionSits', 'palmHeat', 'reflectionWalksFaster',
    'echoReturns', 'echoStops', 'feetHold', 'noteBehind', 'threeHands', 'boardQuestion', 'boardAnswer', 'handThroughGlass',
    'approachingFront'],
  segments: [
    /* 2-1 下楼：台阶随拍下降；同向下楼的腿要超车 */
    {
      id: '2-1', kind: 'run', kit: 'stairs', variant: 'dayDown', atmosphere: 'noon', surface: 'concrete',
      beats: 56, stride: 0.6, cadence: 4.6, stairs: { dir: 'down', risePerBeat: 0.15 },
      follower: { mode: 'absent', steady: 3 },
      npcs: [{ id: 'stairWalkers', kind: 'walkers', from: 0, to: 56, side: 'both', density: 0.3, gaze: 'none' }],
      rows: [
        [14, ['.', 'bag', '.']],                     // 台阶上的书包
        [28, ['.', '.', 'legs']],                    // 站在台阶上的人
        [44, ['books', '.', '.']],
      ],
      items: [
        { at: 22, lane: 0, kind: 'legs', behavior: { type: 'walk', speed: 1.2 } },   // 同向下楼的腿：约 @38 追上，换道超过去
      ],
      events: [
        { at: 0, type: 'bell', kind: 'lunch', id: 'lunchBell' },
        { at: 3, type: 'hint', hint: 'jump' },
        { at: 6, type: 'text', line: 'c2.spine' },
        { at: 10, type: 'hint', hint: 'lane' },
      ],
    },
    /* 2-2 腿的森林：人墙三次、让一下（人群段） */
    {
      id: '2-2', kind: 'run', kit: 'canteen', variant: 'forest', atmosphere: 'noon', surface: 'tile',
      beats: 136, stride: 1.0, cadence: [4.6, 5.0], checkpoints: [80], crowd: true,
      follower: { mode: 'absent' },
      npcs: [
        { id: 'tables', kind: 'seatedRow', from: 0, to: 136, side: 'both', density: 0.7, gaze: 'turnShoes' },
        { id: 'standing', kind: 'standingCluster', from: 30, to: 136, side: 'both', density: 0.6, gaze: 'turnShoes' },
      ],
      rows: [
        [14, ['.', 'chairBar', '.']],               // 第一次伏低：椅子横档
        [18, ['.', '.', 'footOut']],
        [29, ['.', '.', 'legs']],
        [32, ['.', 'longTable', '.']],               // 长桌，伏低钻过
        [36, ['.', '.', 'footOut']],
        [43, ['.', '.', 'footOut']],
        [53, ['legs', 'longTable', '.']],
        [68, ['.', '.', 'longTable']],               // 桌下的纸条 n2-a
        [71, ['.', 'longTable', 'longTable']],
        [74, ['longTable', '.', '.']],
        [92, ['.', 'bag', '.']],
        [95, ['legs', '.', '.']],                    // 人墙 2 之前只挡左道：@94 中道合上后往右一步就到缝里
        [106, ['footOut', 'legs', '.']],
        [113, ['chairBar', 'bag', '.']],
        [130, ['longTable', '.', 'legs']],
        [134, ['bag', '.', '.']],
      ],
      items: [
        { at: 40, lane: [0, 1], kind: 'legs', len: 2 },                                        // 人墙 1：缝一直开在左道
        { at: 46, lane: 1, kind: 'legs', behavior: { type: 'walk', speed: 1.2 } },             // 走动的腿：端着餐盘往前走，约 @62 被追上
        { at: 100, lane: -1, kind: 'legs', len: 2 },                                           // 人墙 2：缝原本在中道……
        { at: 100, lane: 1, kind: 'legs', len: 2, behavior: { type: 'shift', atBeat: 94, toLane: 0 } },   // ……@94 中道合上、右道打开
        { at: 124, lane: 0, kind: 'legs', id: 'girlA', behavior: { type: 'askable', ignore: 'seeded' } },   // 人墙 3：两个女生
        { at: 124, lane: 1, kind: 'legs', id: 'girlB', behavior: { type: 'askable', ignore: 'seeded' } },
        { at: 124, lane: -1, kind: 'longTable' },                                      // 左道是长桌，可以伏低钻过去
      ],
      windows: [{ id: 'askGirls', from: 114, to: 124, type: 'ask' }],
      notes: [{ at: 70, lane: 1, note: 'n2-a' }],
      events: [
        { at: 0, type: 'ambience', amb: 'canteen', level: 1, seconds: 1.5 },
        { at: 4, type: 'hint', hint: 'duck' },
        { at: 6, type: 'text', line: 'c2.forest', id: 'legForest' },
        { at: 112, type: 'hint', hint: 'ask' },
      ],
    },
    /* 2-3 取餐：扶着窗台站起来（静场） */
    {
      id: '2-3', kind: 'still', set: 'counter', variant: 'default', atmosphere: 'noon', duration: 8,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'counter', seconds: 0 },
        { at: 0.3, type: 'actor', clip: 'counterStand', seconds: 7.5 },
        { at: 0.3, type: 'text', line: 'c2.counter', id: 'counterStand' },
        { at: 3.0, type: 'text', line: 'c2.eatMore', style: 'other', speaker: 'lunchLady' },
        { at: 5.2, type: 'text', line: 'c2.compensate' },
      ],
    },
    /* 2-4 端盘：撑跃禁用，只有横档、挡道和走动的腿（R11：没有低矮） */
    {
      id: '2-4', kind: 'run', kit: 'canteen', variant: 'tray', atmosphere: 'noon', surface: 'tile',
      beats: 70, stride: 1.0, cadence: 4.4, controls: { jump: false },
      follower: { mode: 'absent' },
      npcs: [{ id: 'trayTables', kind: 'seatedRow', from: 0, to: 70, side: 'both', density: 0.6, gaze: 'turnShoes' }],
      rows: [
        [12, ['.', 'chairBar', '.']],
        [16, ['.', 'cart', '.']],
        [20, ['.', '.', 'legs']],
        [24, ['cart', '.', '.']],
        [28, ['.', 'chairBar', '.']],
        [40, ['.', '.', 'chairBar']],
        [44, ['.', 'longTable', '.']],
        [48, ['.', '.', 'chairBar']],
        [56, ['.', 'legs', '.']],
        [60, ['.', 'legs', 'chairBar']],
        [64, ['.', 'longTable', 'longTable']],
      ],
      items: [
        { at: 34, lane: 1, kind: 'legs', behavior: { type: 'walk', speed: -0.8 } },            // 迎面走来的腿
      ],
      events: [
        { at: 2, type: 'hint', hint: 'tray' },
        { at: 50, type: 'sfx', sfx: 'soupSpill' },
        { at: 50, type: 'text', line: 'c2.collar', id: 'trayCollar' },
      ],
    },
    /* 2-5 窗边：玻璃里的它坐在椅子上；第三只手贴玻璃，掌心发烫（静场） */
    {
      id: '2-5', kind: 'still', set: 'canteenWindow', variant: 'default', atmosphere: 'noon', duration: 11,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'windowSeat', seconds: 0 },
        { at: 0.0, type: 'double', spec: { id: 'winSeat', surface: 'window', source: 'script', clip: 'sitEat' } },
        { at: 0.5, type: 'text', line: 'c2.sits', id: 'reflectionSits' },
        { at: 2.4, type: 'text', line: 'c2.curled' },
        { at: 5.0, type: 'doubleMod', target: 'winSeat', mod: { thirdHand: { gesture: 'palmGlass', at: 0, hold: 1.5 } } },
        { at: 5.0, type: 'sfx', sfx: 'glassTouch' },
        { at: 5.2, type: 'overlay', op: 'palmHeat', seconds: 1.5, id: 'palmHeat' },
        { at: 5.6, type: 'text', line: 'c2.iron' },
        { at: 8.0, type: 'text', line: 'c2.lookingAt', style: 'other', speaker: 'chenMo' },
        { at: 9.4, type: 'text', line: 'c2.myself', style: 'self' },
        { at: 10.6, type: 'doubleEnd', target: 'winSeat', fade: 0.4 },
      ],
    },
    /* 2-6 窗墙：玻璃里的它直立行走，然后走得比我快 */
    {
      id: '2-6', kind: 'run', kit: 'canteen', variant: 'windowWall', atmosphere: 'noon', surface: 'tile',
      beats: 110, stride: 1.0, cadence: 4.6,
      follower: { mode: 'absent' },
      npcs: [{ id: 'windowTables', kind: 'seatedRow', from: 0, to: 110, side: 'R', density: 0.4, gaze: 'none' }],
      surfaces: [{ id: 'winWall', kind: 'window', side: 'L', from: 40, to: 92, y: [0.3, 2.4], backdrop: 'playground' }],
      rows: [
        [10, ['.', '.', 'chairBar']],               // 拉出来的椅子
        [16, ['legs', '.', '.']],
        [22, ['.', 'bag', '.']],                     // 地上的餐盘和书包
        [30, ['.', '.', 'legs']],
        [36, ['chairBar', '.', '.']],
        [80, ['.', 'chairBar', '.']],
        [86, ['legs', '.', '.']],
        [92, ['.', '.', 'bag']],
        [98, ['chairBar', '.', '.']],
        [104, ['.', 'legs', '.']],
      ],
      events: [
        { at: 52, type: 'double', spec: { id: 'winWalk', surface: 'winWall', source: 'script', clip: 'walkUpright' } },
        { at: 66, type: 'doubleMod', target: 'winWalk', mod: { speedFactor: 1.3 }, id: 'reflectionWalksFaster' },
        { at: 74, type: 'text', line: 'c2.faster' },
        { at: 80, type: 'doubleEnd', target: 'winWalk', fade: 0.6 },
      ],
    },
    /* 2-7 实验楼走廊：回声回来了；停拍——我停，它也停 */
    {
      id: '2-7', kind: 'run', kit: 'corridor', variant: 'labNorth', atmosphere: 'labNorth', surface: 'terrazzo',
      beats: 136, stride: 1.0, cadence: [4.8, 5.2], checkpoints: [92],
      follower: { mode: 'absent' },
      rows: [
        [10, ['.', 'pipe', '.']],                    // 地面管线
        [16, ['cart', '.', '.']],                    // 器材推车
        [22, ['.', '.', 'locker']],
        [28, ['mopAcross', '.', '.']],               // 横放的拖把
        [34, ['.', '.', 'books']],
        [37, ['.', '.', 'cart']],
        [41, ['books', '.', '.']],
        [46, ['.', '.', 'locker']],
        [74, ['pipe', '.', '.']],
        [108, ['mopAcross', 'locker', '.']],         // 检查点、两句文字之后才开始加密
        [111, ['mopAcross', '.', '.']],
        [115, ['mopAcross', 'mopAcross', '.']],
        [118, ['cart', 'locker', '.']],
        [122, ['.', 'cart', 'pipe']],
        [125, ['locker', '.', '.']],
        [129, ['pipe', 'pipe', '.']],
        [132, ['cart', '.', '.']],
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'labWind', level: 1, seconds: 2 },
        { at: 54, type: 'follower', def: { mode: 'behind', steady: 3 }, id: 'echoReturns' },
        { at: 54, type: 'hud', op: 'show' },
        { at: 54, type: 'text', line: 'c2.sameRoute' },
        { at: 82, type: 'stop', seconds: 2.4, timeline: [                 // 回声回来 5.6 s 之后
          { at: 0.2, type: 'text', line: 'c2.iStop' },
          { at: 0.9, type: 'text', line: 'c2.echoStops', id: 'echoStops' },
          { at: 1.7, type: 'text', line: 'c2.iStep' },
          { at: 1.7, type: 'autoCrawl', speed: 2.0, seconds: 0.5 },
          { at: 2.2, type: 'text', line: 'c2.echoSteps' },
        ] },
        { at: 96, type: 'text', line: 'c2.notEcho' },
        { at: 102, type: 'text', line: 'c2.echoRule' },
      ],
    },
    /* 2-8 化学教室：灰色的森林；腿自主抬起，一次 ↓ 同时按住和伏低（R9） */
    {
      id: '2-8', kind: 'run', kit: 'labRoom', variant: 'default', atmosphere: 'labNorth', surface: 'tile',
      beats: 86, stride: 1.0, cadence: 4.6,
      follower: { mode: 'behind' },
      rows: [
        [11, ['.', 'pipe', '.']],
        [17, ['cart', '.', '.']],
        [20, ['pipe', 'pipe', '.']],
        [30, 'HHH', 0.8],                            // 实验台：伏低（台面进深 0.8 m）
        [34, ['pipe', 'cart', '.']],
        [38, ['pipe', 'locker', '.']],
        [42, ['locker', 'pipe', '.']],
        [52, 'HHH', 0.8],
        [56, ['pipe', '.', '.']],
        [60, ['.', '.', 'pipe']],
        [64, ['cart', '.', '.']],
        [74, 'HHH', 0.8],
        [78, ['.', 'cart', '.']],
        [82, ['pipe', '.', '.']],
      ],
      events: [
        { at: 20, type: 'hint', hint: 'hold' },
        { at: 25, type: 'twitch', hold: 0.25, say: 'c2.dont', id: 'feetHold' },   // 腿在实验台前 0.4 s 抬起
        { at: 47, type: 'twitch', hold: 0.25 },
        { at: 69, type: 'twitch', hold: 0.25 },
      ],
    },
    /* 2-9 你后面：纸条背面有字；影子多了一只手；黑板上的问题（静场） */
    {
      id: '2-9', kind: 'still', set: 'labBoard', variant: 'default', atmosphere: 'labNorth', duration: 13,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'labBoard', seconds: 0 },
        { at: 0.0, type: 'ambience', amb: 'labWind', level: 0.4, seconds: 1 },
        { at: 0.2, type: 'noteOpen', note: 'n1-desk', id: 'noteBehind' },
        { at: 0.2, type: 'sfx', sfx: 'paper' },
        { at: 0.4, type: 'text', line: 'c2.blank' },
        { at: 4.4, type: 'shadow', mode: 'pointBack', seconds: 8 },                     // 多了一只手，从胸口伸出来指向身后
        { at: 4.4, type: 'text', line: 'c2.extraHand', id: 'threeHands' },
        { at: 5.2, type: 'camera', shot: 'turnBack', seconds: 0.8 },
        { at: 6.0, type: 'board', surface: 'board', op: 'write', line: 'c2.whyNotStand', tremble: true, id: 'boardQuestion' },
      ],
      input: { at: 7.4, hint: 'wipe', mode: 'hold', holdSeconds: 1.2, timeout: 5, onDone: [
        { at: 0.0, type: 'board', surface: 'board', op: 'wipe', byPlayer: true },
        { at: 0.2, type: 'actor', clip: 'writeBoard', seconds: 1.6 },
        { at: 0.4, type: 'sfx', sfx: 'chalk' },
        { at: 0.8, type: 'board', surface: 'board', op: 'write', line: 'c2.cantStand', byPlayer: true, id: 'boardAnswer' },
        { at: 3.0, type: 'text', line: 'c2.lying' },
      ] },
    },
    /* 2-10 碎角镜：影子指路；掌心贴掌心；第三只手穿过玻璃；脚步声从前方传来 */
    {
      id: '2-10', kind: 'run', kit: 'corridor', variant: 'labNorth', atmosphere: 'labNorth', surface: 'terrazzo',
      beats: 140, stride: 1.0, cadence: 4.6,
      follower: { mode: 'behind' },
      surfaces: [{ id: 'chipMirror', kind: 'endMirror', side: 'end', from: 140, to: 140, y: [0.1, 1.9], chipped: true, backdrop: 'darkRoom' }],
      // 减速的叙事收束（§2.8）：只有 @10 一个障碍、@16 左道的纸条，其余都是只占边道的被动行，待在中道不用动
      rows: [
        [10, ['.', 'pipe', '.']],                    // 「@10 一个障碍」：地面管线
        [30, ['locker', '.', '.']],
        [46, ['.', '.', 'cart']],
        [78, ['.', '.', 'locker']],
        [96, ['cart', '.', '.']],
        [124, ['.', '.', 'locker']],
      ],
      notes: [{ at: 16, lane: -1, note: 'n2-b' }],
      events: [
        { at: 0, type: 'ambience', amb: 'labWind', level: 1, seconds: 1.5 },
        { at: 56, type: 'shadow', mode: 'pointMirror', seconds: 18 },
        { at: 114, type: 'double', spec: { id: 'chip', surface: 'chipMirror', source: 'history', delay: 0 } },
        { at: 139, type: 'stop', seconds: 8, timeline: [            // 停在镜前 1 m：掌心贴掌心
          { at: 0.0, type: 'camera', shot: 'mirrorClose', seconds: 1.0 },
          { at: 0.3, type: 'actor', clip: 'palmToGlass', seconds: 4.0 },
          { at: 1.2, type: 'text', line: 'c2.whatTell', style: 'self' },
          { at: 2.6, type: 'doubleMod', target: 'chip', mod: { thirdHand: { gesture: 'forehead', at: 0, hold: 2.0 } }, id: 'handThroughGlass' },
          { at: 4.6, type: 'overlay', op: 'coldFade', seconds: 0.8 },
          { at: 5.2, type: 'doubleEnd', target: 'chip', fade: 0.3 },
          { at: 5.6, type: 'follower', def: { from: 'front' }, id: 'approachingFront' },
          { at: 6.0, type: 'text', line: 'c2.approach' },
          { at: 8.0, type: 'end' },
        ] },
      ],
    },
  ],
} satisfies ChapterDef;
