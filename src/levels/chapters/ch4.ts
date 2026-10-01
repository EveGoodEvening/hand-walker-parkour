// src/levels/chapters/ch4.ts —— 第四章 · 广场（DESIGN.md §4.4、附录 B、附录 C）。归 WP2。
// 反转章：唯一「爽」的一段被放在梦里，然后马上翻转。本章没有纸条（梦里的手掌「太干净了」）。
// 台词全部来自 lines.ts（原文逐字）；原文混入英文的两句（附录 B.8）不引用。只 import schema（§8.2 规则 2）。
// 结尾卡可交互：卧室天花板的裂缝 → 「羡慕和歧视……」→ ↓ ↓ ↓（超时 6 s 自动）→「它不像鼓掌。」「像某种练习。」
// 评审修复 U1（lead 裁定，偏离 §2.3 / §2.8 / §4.4 的地方，建议 lead 写进 §10.3）：
//   · 4-5 照原文「我开始跑。很慢，很慢。但比站着好。」：用清醒的步幅 1.1 m，步频 4.6 → 5.9 掌/s 在段内渐变（5.1 → 6.5 m/s，
//     远低于 4-1 的 9.6 m/s），到 @272「我们终于跑成了一样的速度。」时 5.86 掌/s，基本稳定。段首补「很慢，很慢。」「但比站着好。」
//     （两行一个事件），「身后的脚步声跟着我了。」「但它不是追上来的。」顺延到 @9、@18。技巧高潮靠必需动作的密度和同拍考试，
//     不靠速度：@96、@103、@160、@167 补了中道部件，求解器最少输入 0.82 次 / 10 拍（4-1 是 0.68）。两个同向爬行的人
//     按新的时间轴重新摆放（@54、@95.5），仍在约 @123、@207 被追上。
//   · 4-5 @210 那一行只占边道：第一个必需动作（@213 伏低）落在「我跑过那面镜子，没有看。」消失之后。
//   · 4-1 @36–@116 每 8 拍左右一道人墙只留一条缝（§4.4「你在人群之间回旋」），求解器最少输入 0.68 次 / 10 拍（§2.8 的 1.0 是上限）。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch4', title: '第四章', name: '广场', seed: 1704,
  card: ['c4.card'],
  outro: {
    set: 'bedroom', variant: 'ceiling',
    lines: [
      { line: 'c4.out1' },
      { input: { at: 0, hint: 'taps3', mode: 'taps3', timeout: 6 }, id: 'fingerPractice' },   // 每按一下，床单上响一声掌根、指节或指腹
      { line: 'c4.out2' },
      { line: 'c4.out3' },
    ],
  },
  notes: [],
  requiredBeats: ['dreamFast', 'admired', 'teachMe', 'boyFalls', 'dreamStand', 'overtaken', 'shadowOtherWay', 'palmEye',
    'choiceDrowned', 'dontStand', 'kneel', 'inSync', 'passMirror', 'waterQuestion', 'waterBreaks', 'fingerPractice'],
  segments: [
    /* 4-1 很快：全作最快（9.6 m/s）；围观的腿围成弧；影子被拉长 */
    {
      id: '4-1', kind: 'run', kit: 'plaza', variant: 'bright', atmosphere: 'dream', surface: 'plaza',
      beats: 190, stride: 1.5, cadence: [6.2, 6.4],
      follower: { mode: 'absent', steady: 3 },
      npcs: [{ id: 'onlookers', kind: 'onlookerRing', from: 0, to: 190, side: 'both', density: 0.8, gaze: 'turnShoes' }],
      // 在人群之间回旋（§4.4）：@36–@116 每 8 拍左右一道人墙只留一条缝，缝在三条车道之间来回换（9.6 m/s 下 1.25 s 一次）
      rows: [
        [24, ['.', '.', 'legs']],                    // 围观的腿
        [36, ['.', 'legs', 'legs']],
        [44, ['legs', '.', 'legs']],
        [58, ['legs', 'legs', '.']],
        [66, ['legs', '.', 'legs']],
        [74, ['.', 'legs', 'legs']],
        [92, ['legs', '.', 'legs']],
        [100, ['legs', 'legs', '.']],
        [108, ['legs', '.', 'legs']],
        [116, ['.', 'legs', '.']],
        [124, ['.', 'kneeler', '.']],               // 第一批跪着模仿的人
        [135, ['legs', '.', '.']],
        [140, ['.', 'legs', '.']],
        [145, ['.', 'legs', '.']],
        [150, ['.', '.', 'legs']],
        [155, ['.', 'kneeler', 'kneeler']],
        [160, ['legs', '.', '.']],
        [165, ['.', '.', 'legs']],
        [170, ['kneeler', 'kneeler', '.']],
        [175, ['.', 'legs', 'kneeler']],
        [180, ['legs', 'kneeler', '.']],
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'dream', level: 1, seconds: 2 },
        { at: 0, type: 'text', line: 'c4.fast', id: 'dreamFast' },
        { at: 6, type: 'sfx', sfx: 'wind', gain: 0.6 },                                // 像有人把一张薄纸从中间撕开
        { at: 10, type: 'text', line: 'c4.muchFaster' },
        { at: 12, type: 'hint', hint: 'lane' },
        { at: 20, type: 'shadow', mode: 'long', seconds: 30 },                         // 影子被拉长，呈流线型
        { at: 48, type: 'text', line: 'c4.soFast', style: 'whisper', pan: 0.5, id: 'admired' },
        { at: 84, type: 'text', line: 'c4.how', style: 'whisper', pan: -0.5 },
        { at: 112, type: 'hint', hint: 'jump' },
        { at: 128, type: 'text', line: 'c4.wantRun', style: 'whisper', pan: 0.4 },
      ],
    },
    /* 4-2 模仿者：男生跪进中道然后摔倒；跪着的人、同向爬行的人、伸出的手臂 */
    {
      id: '4-2', kind: 'run', kit: 'plaza', variant: 'bright', atmosphere: 'dream', surface: 'plaza',
      beats: 130, stride: 1.4, cadence: 6.0,
      follower: { mode: 'absent' },
      npcs: [
        { id: 'ring2', kind: 'onlookerRing', from: 0, to: 130, side: 'both', density: 0.6, gaze: 'turnShoes' },
        { id: 'imitators', kind: 'imitators', from: 40, to: 130, side: 'both', density: 0.5, gaze: 'none' },
      ],
      rows: [
        [8, ['legs', '.', '.']],
        [36, ['.', 'legs', '.']],
        [41, ['.', '.', 'legs']],
        [44, ['.', '.', 'kneeler']],                 // 跪着的人
        [63, ['legs', 'kneeler', '.']],
        [68, ['kneeler', 'legs', '.']],
        [72, ['.', '.', 'kneeler']],
        [77, ['.', 'legs', '.']],
        [86, ['.', '.', 'legs']],
        [90, ['.', '.', 'legs']],
        [95, ['.', 'legs', 'legs']],
        [99, ['.', 'kneeler', '.']],
        [104, ['kneeler', '.', '.']],
        [108, ['.', 'kneeler', 'kneeler']],
        [120, ['.', 'reach', '.']],                  // 跪着的人伸出双臂拦在车道上（横档，新种类）
      ],
      items: [
        { at: 30, lane: 0, kind: 'kneeler', id: 'dreamBoy', behavior: { type: 'fallInto', atBeat: 22 } },   // 他跪进中道，摔倒，躺在那里
        { at: 60, lane: 0, kind: 'crawler', behavior: { type: 'walk', speed: 3.0 } },                       // 慢慢同向爬行的人（约 @93 追上）
        { at: 80, lane: -1, kind: 'crawler', behavior: { type: 'walk', speed: 3.0 } },
      ],
      events: [
        { at: 14, type: 'text', line: 'c4.teachMe', style: 'other', speaker: 'dreamBoy', id: 'teachMe' },
        { at: 23, type: 'sfx', sfx: 'kneeThud', id: 'boyFalls' },                     // 膝盖磕在地上，很响的一声
        { at: 48, type: 'text', line: 'c4.again', style: 'other', speaker: 'dreamBoy' },
        { at: 110, type: 'hint', hint: 'duck' },
      ],
    },
    /* 4-3 站起来：梦中站立，零扰动，走三步；然后被所有人超过；影子趴下去 */
    {
      id: '4-3', kind: 'stand', kit: 'plaza', variant: 'bright', script: 'dream', atmosphere: 'dream', duration: 12,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'standEye', seconds: 1.2 },
        { at: 0.0, type: 'actor', clip: 'standUp', seconds: 1.2 },
        { at: 0.3, type: 'text', line: 'c4.iStand', id: 'dreamStand' },
        { at: 1.4, type: 'text', line: 'c4.easy' },
        { at: 1.8, type: 'crowd', group: 'ring2', op: 'applaud' },                      // 整齐的掌声（4-2 围观的环）
        { at: 1.8, type: 'ambience', amb: 'dreamApplause', level: 1, seconds: 1.0 },
        { at: 2.6, type: 'sfx', sfx: 'heartbeat' },                                     // 咚咚
        { at: 3.2, type: 'double', spec: { id: 'dreamMirror', surface: 'world', source: 'script', clip: 'smile', anchor: { sAhead: 7, lane: 1, speed: 0 }, ttl: 3 } },
        { at: 4.4, type: 'ambience', amb: 'dream', level: 1, seconds: 0.4 },          // 掌声停了
        { at: 4.4, type: 'crowd', group: 'imitators', op: 'crawlOvertake' },            // 4-2 爬行的模仿者从两侧超过你
        { at: 5.0, type: 'follower', def: { mode: 'behind' } },                         // 身后传来一个人的三段落地
        { at: 5.5, type: 'text', line: 'c4.overtaken', id: 'overtaken' },
        { at: 7.4, type: 'shadow', mode: 'liesDown', seconds: 4.6 },                  // 影子趴下去，双手向前伸
        { at: 8.0, type: 'text', line: 'c4.otherWay', id: 'shadowOtherWay' },
        { at: 10.2, type: 'text', line: 'c4.tired' },
      ],
    },
    /* 4-4 掌心：掌心里有一只眼睛；问题被掌声盖住；别站着，跑（静场） */
    {
      id: '4-4', kind: 'still', set: 'palmEye', variant: 'default', atmosphere: 'dream', duration: 10,
      follower: { mode: 'behind', lagOverride: 0.1 },                                 // 身后的节拍停在很近的地方
      events: [
        { at: 0.0, type: 'camera', shot: 'palmEye', seconds: 0 },
        { at: 0.3, type: 'text', line: 'c4.eye', id: 'palmEye' },
        { at: 1.6, type: 'text', line: 'c4.envyRun', style: 'whisper' },
        { at: 3.0, type: 'text', line: 'c4.overtake', style: 'whisper' },
        { at: 4.4, type: 'text', line: 'c4.choose', style: 'whisper' },
        { at: 5.4, type: 'ambience', amb: 'dreamApplause', level: 1, seconds: 0.5, id: 'choiceDrowned' },   // 掌声涌上来，盖住一切
        { at: 6.4, type: 'ambience', amb: 'dream', level: 0.6, seconds: 0.4 },
        { at: 6.4, type: 'text', line: 'c4.dontStand', style: 'whisper', pan: 0, id: 'dontStand' },
        { at: 7.6, type: 'text', line: 'c4.run', style: 'whisper', pan: 0 },
      ],
      input: { at: 8.4, hint: 'kneel', mode: 'tap', timeout: 4, onDone: [
        { at: 0.0, type: 'actor', clip: 'kneel', seconds: 0.8 },
        { at: 0.1, type: 'sfx', sfx: 'kneeThud' },
        { at: 0.2, type: 'text', line: 'c4.kneel', id: 'kneel' },
      ] },
    },
    /* 4-5 同一个速度：本章技巧高潮，同拍考试；雾从 60 m 收到 28 m */
    {
      id: '4-5', kind: 'run', kit: 'plaza', variant: 'gray', atmosphere: 'dreamGray', surface: 'plaza',
      beats: 280, stride: 1.1, cadence: [4.6, 5.9], checkpoints: [144],
      follower: { mode: 'synced', steady: 3 },
      npcs: [
        { id: 'ring5', kind: 'onlookerRing', from: 0, to: 250, side: 'both', density: 0.5, gaze: 'none' },
        { id: 'crawlers5', kind: 'crawlerStream', from: 20, to: 260, side: 'both', density: 0.6, gaze: 'none' },
      ],
      surfaces: [{ id: 'plazaMirror', kind: 'mirror', side: 'R', from: 196, to: 206, y: [0.1, 2.6], backdrop: 'darkRoom' }],
      rows: [
        [24, ['legs', '.', '.']],
        [30, ['.', '.', 'reach']],
        [54, ['.', '.', 'reach']],
        [58, ['.', 'kneeler', 'reach']],
        [61, ['.', 'kneeler', 'legs']],
        [65, ['reach', '.', '.']],
        [68, ['.', '.', 'reach']],
        [72, ['reach', '.', 'kneeler']],
        [75, ['kneeler', 'kneeler', '.']],
        [79, ['.', '.', 'kneeler']],
        [82, ['legs', 'kneeler', '.']],
        [86, ['reach', '.', 'legs']],
        [89, ['reach', 'kneeler', '.']],
        [93, ['kneeler', '.', '.']],
        [96, ['kneeler', 'reach', '.']],
        [100, ['kneeler', '.', '.']],
        [103, ['.', 'kneeler', 'legs']],
        [107, ['legs', '.', '.']],
        [110, ['legs', '.', '.']],
        [128, ['kneeler', 'kneeler', '.']],
        [131, ['legs', 'legs', '.']],
        [135, ['kneeler', 'legs', '.']],
        [138, ['.', '.', 'legs']],
        [156, ['.', '.', 'legs']],
        [160, ['legs', 'kneeler', '.']],
        [163, ['.', '.', 'kneeler']],
        [167, ['.', 'reach', 'legs']],
        [210, ['kneeler', '.', '.']],                // 只占边道：第一个必需动作（@213 伏低）在「我跑过那面镜子，没有看。」消失之后
        [213, ['kneeler', 'reach', '.']],
        [217, ['.', 'legs', 'reach']],
        [220, ['legs', '.', 'kneeler']],
        [224, ['reach', '.', 'reach']],
        [227, ['reach', 'reach', '.']],
        [231, ['legs', '.', '.']],
        [234, ['legs', '.', '.']],
        [238, ['legs', '.', '.']],
        [241, ['kneeler', 'reach', '.']],
        [245, ['.', '.', 'legs']],
        [248, ['.', 'reach', 'reach']],
        [252, ['.', '.', 'reach']],
        [255, ['.', 'kneeler', '.']],
        [259, ['.', 'reach', 'kneeler']],
        [262, ['.', 'kneeler', '.']],
        [266, ['.', 'reach', 'kneeler']],
      ],
      patterns: [
        { at: 40, pattern: 'tripleVault', lane: 0, gap: 4 },                            // 三连撑（间隔 4 拍）
        { at: 176, pattern: 'tripleVault', lane: 0, gap: 4 },
      ],
      items: [
        { at: 37, lane: -1, kind: 'legs', len: 14 },                                    // 两侧围观的腿夹出中道：三连撑躲不开
        { at: 37, lane: 1, kind: 'legs', len: 14 },
        { at: 173, lane: -1, kind: 'legs', len: 14 },
        { at: 173, lane: 1, kind: 'legs', len: 14 },
        { at: 54, lane: 1, kind: 'crawler', behavior: { type: 'walk', speed: 3.0 } },                       // 爬行的人：约 @123 追上
        { at: 95.5, lane: -1, kind: 'crawler', behavior: { type: 'walk', speed: 3.0 } },                    // 约 @207 追上（镜子在右侧）
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'dream', level: 1, seconds: 1.5 },
        { at: 0, type: 'fog', near: 20, far: 28, seconds: 45 },                         // 越来越深的灰
        { at: 0, type: 'text', line: ['c4.slow', 'c4.better'] },                         // 「我开始跑。很慢，很慢。但比站着好。」
        { at: 9, type: 'text', line: 'c4.follows' },
        { at: 18, type: 'text', line: 'c4.notChasing' },
        { at: 120, type: 'text', line: 'c4.sameSpeed' },
        { at: 190, type: 'double', spec: { id: 'plazaMe', surface: 'plazaMirror', source: 'script', clip: 'standIdle', ttl: 5 } },   // 镜中站着的「我」一动不动
        { at: 200, type: 'text', line: 'c4.passMirror', id: 'passMirror' },
        { at: 272, type: 'text', line: 'c4.inSync', id: 'inSync' },
      ],
    },
    /* 4-6 水：广场突然到了尽头；水里站着的「我」；「我——」水面碎开（静场） */
    {
      id: '4-6', kind: 'still', set: 'water', variant: 'default', atmosphere: 'dreamGray', duration: 8,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'waterDown', seconds: 0 },
        { at: 0.3, type: 'text', line: 'c4.end' },
        { at: 0.6, type: 'sfx', sfx: 'splash' },
        { at: 1.0, type: 'double', spec: { id: 'waterMe', surface: 'water', source: 'script', clip: 'standIdle' } },
        { at: 2.0, type: 'text', line: 'c4.envyBoth', style: 'whisper', pan: 0 },
        { at: 4.2, type: 'text', line: 'c4.wantWhat', style: 'whisper', pan: 0, id: 'waterQuestion' },
      ],
      input: { at: 5.0, hint: 'anyKey', mode: 'any', timeout: 1.5, onDone: [          // 按任意键，或 6.5 s 后
        { at: 0.0, type: 'text', line: 'c4.i', style: 'self' },
        { at: 0.5, type: 'sfx', sfx: 'waterBreak', id: 'waterBreaks' },
        { at: 0.5, type: 'doubleEnd', target: 'waterMe', fade: 0.6 },
        { at: 1.1, type: 'overlay', op: 'black', seconds: 0.4 },
      ] },
    },
  ],
} satisfies ChapterDef;
