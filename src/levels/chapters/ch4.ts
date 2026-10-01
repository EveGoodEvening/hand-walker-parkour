// src/levels/chapters/ch4.ts —— 第四章 · 广场（DESIGN.md §4.4、附录 B、附录 C）。归 WP2。
// 反转章：唯一「爽」的一段被放在梦里，然后马上翻转。本章没有纸条（梦里的手掌「太干净了」）。
// 台词全部来自 lines.ts（原文逐字）；原文混入英文的两句（附录 B.8）不引用。只 import schema（§8.2 规则 2）。
// 结尾卡可交互：卧室天花板的裂缝 → 「羡慕和歧视……」→ ↓ ↓ ↓（超时 6 s 自动）→「它不像鼓掌。」「像某种练习。」
// 评审修复 U1（lead 裁定，偏离 §2.3 / §2.8 / §4.4 的地方，建议 lead 写进 §10.3）：
//   · 4-5 照原文「我开始跑。很慢，很慢。但比站着好。」（lead 裁定，澄清版）：步幅 1.2 m（lead 批准：为了撑跃窗口 ≥ 0.16 s），
//     步频 4.2 → 5.4 掌/s 在段内渐变（5.0 → 6.5 m/s，远低于 4-1 的 9.6 m/s）。步幅不取 1.1：跪着的人（0.35 m 高、0.6 m 进深）
//     的单车道撑跃窗口约 0.94 拍，1.1 m 要跑到约 6.5 m/s 就得 5.9 掌/s，窗口只剩约 0.16 s；1.2 m 时约 1.02 拍，5.4 掌/s 仍有约 0.19 s。
//     @210 的 cadence 事件把剩下的渐变在 30 拍里走完（5.1 → 5.4，斜率约为段内渐变的两倍，不是可感知的换挡；5-3 @140
//     「我开始跑。」8 拍 5.0 → 5.8 仍是全作唯一一次换挡），@240 起稳定在 5.4 掌/s，@272「我们终于跑成了一样的速度。」时已经同拍约 6 s。
//     段首补「很慢，很慢。」「但比站着好。」
//     （两行一个事件），「身后的脚步声跟着我了。」「但它不是追上来的。」顺延到 @9、@18。技巧高潮靠必需动作的密度和同拍考试，
//     不靠速度：@96、@103、@160、@167 补了中道部件，求解器最少输入 0.82 次 / 10 拍（4-1 是 0.68）。两个同向爬行的人
//     按新的时间轴重新摆放（@54、@95.2），仍在约 @123、@207 被追上（都在 @210 的 cadence 事件之前，编译段的 timeAt 精确）。
//   · 4-5 @210 那一行只占边道：第一个必需动作（@213 伏低）落在「我跑过那面镜子，没有看。」消失之后。
//   · 4-1 @36–@116 每 8 拍左右一道人墙只留一条缝（§4.4「你在人群之间回旋」），求解器最少输入 0.68 次 / 10 拍（§2.8 的 1.0 是上限）。
//   · 第二轮加密（修复单元 A，第 3 轮，第二次重排；取代上面 4-5「0.82 次 / 10 拍」）：4-5 跪着的人连成三连撑、四连撑（间隔 3.5 拍），
//     中间夹着只留一条缝的围观的腿、人墙「挤一下」（墙挡住你那条车道 3 拍，墙尾之后 1.5 拍只有那条车道有缝）和伸出的手臂
//     （伏低，全段 5 处；上一次约 13 处，human 机器人遇到细横档一律撑跃，摔倒大多出在那里）。求解器按 0.6 s 最小间隔
//     0.82 → 1.86 次 / 10 拍（§2.8 的 2.2 是区间下沿）。@210 那一行仍只占边道；两个同向爬行的人的位置不变，被追上之前的路径上
//     不放同车道的障碍。human 机器人 200 次 10.5% / 9.0%（§2.8 第四章 ≤ 12%）。
//   · 复验后（修复单元 A，第 3 轮第三次）：上面的三连撑、四连撑链让 §4.4 的两组定点三连撑（@40、@176）看不出来。现在别处的跪着的人
//     最多两排连撑，中间换成只留一条缝的围观的腿；定点三连撑前后各空出约 6 拍（删掉 @52 和 @172.5 两排，不再和它们连成四连撑）；
//     只有镜子之后「同拍考试的最后一段」（@236）保留四连撑。求解器最少输入 1.86 → 1.75 次 / 10 拍（49 次）。
//     human 机器人：200 次 9.5% / 12.5%，种子 1–60 10.0% / 10.0%（§2.8 第四章 ≤ 12%，+3 个百分点以内）。
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
      beats: 280, stride: 1.2, cadence: [4.2, 5.4], checkpoints: [144],
      follower: { mode: 'synced', steady: 3 },
      npcs: [
        { id: 'ring5', kind: 'onlookerRing', from: 0, to: 250, side: 'both', density: 0.5, gaze: 'none' },
        { id: 'crawlers5', kind: 'crawlerStream', from: 20, to: 260, side: 'both', density: 0.6, gaze: 'none' },
      ],
      surfaces: [{ id: 'plazaMirror', kind: 'mirror', side: 'R', from: 196, to: 206, y: [0.1, 2.6], backdrop: 'darkRoom' }],
      rows: [
        // 第二轮加密（第 3 轮重排，复验后再调）：§4.4 的定点部件是 @40 和 @176 的三连撑（patterns：两侧围观的腿夹出中道、间隔 4 拍，
        // 前后各空出约 6 拍）。别处的跪着的人最多两排连撑（间隔 3.5 拍），中间夹着只留一条缝的围观的腿（换道）、
        // 人墙「挤一下」（墙挡住中道 3 拍，墙尾之后 1.5 拍只有中道有缝）和伸出的手臂（伏低，全段 5 处）。
        // 只有镜子之后「同拍考试的最后一段」（@236）是四连撑。
        [24, ['kneeler', 'kneeler', 'kneeler']],        // 一排跪着的人（撑跃）
        [28, ['.', 'legs', 'legs']],                    // 围观的腿只留一条缝
        [32, ['reach', 'legs', 'legs']],                // 伸出的手臂（伏低）
        [56, ['.', 'legs', 'legs']],                    // @40 的三连撑之后约 6 拍
        [60, ['kneeler', 'kneeler', 'kneeler']],
        [63.5, ['legs', '.', 'legs']],
        [67, ['kneeler', 'kneeler', 'kneeler']],
        [71, ['legs', 'legs', '.']],
        [75, ['reach', 'reach', 'reach']],
        [79, ['kneeler', 'kneeler', 'kneeler']],
        [82.5, ['legs', '.', 'legs']],
        [86, ['kneeler', 'kneeler', 'kneeler']],
        [90, ['.', 'legs', '.'], 3],                    // 一道人墙挡住中道 3 拍……
        [94.5, ['legs', '.', 'legs']],                  // ……墙尾之后 1.5 拍只有中道有缝（挤一下）
        [98.5, ['kneeler', 'kneeler', 'kneeler']],      // 两连撑
        [102, ['kneeler', 'kneeler', 'kneeler']],
        [105.5, ['.', 'legs', 'legs']],
        [109, ['kneeler', 'kneeler', '.']],   // 右道是 @54 那个同向爬行的人（约 @123 被追上）
        [112.5, ['kneeler', 'kneeler', '.']],
        [127, ['legs', 'kneeler', 'legs']],             // 「我快，它快；我慢，它慢。」之后
        [131, ['.', 'legs', 'legs']],
        [135, ['reach', 'legs', 'legs']],
        [139, ['legs', '.', 'legs']],                   // 检查点（@144）之前最后一个动作
        [154.5, ['kneeler', 'kneeler', 'kneeler']],     // 检查点之后 1.6 s 的喘息之后：两连撑
        [158, ['kneeler', 'kneeler', 'kneeler']],
        [161.5, ['legs', 'legs', '.']],
        [165, ['.', 'legs', '.'], 3],                   // 挤一下：人墙挡住中道 3 拍……
        [169.5, ['legs', '.', 'legs']],                 // ……墙尾之后 1.5 拍回到中道（@173 起两侧是围观的腿，@176 的三连撑单独成组）
        [210, ['kneeler', '.', '.']],                   // 只占边道：第一个必需动作（@213）在「我跑过那面镜子，没有看。」消失之后
        [213, ['kneeler', 'kneeler', 'kneeler']],
        [216.5, ['kneeler', 'kneeler', 'kneeler']],
        [220, ['legs', 'legs', '.']],
        [224, ['.', 'legs', '.'], 3],                   // 挤一下
        [228.5, ['legs', '.', 'legs']],
        [232.5, ['reach', 'reach', 'reach']],
        [236, ['kneeler', 'kneeler', 'kneeler']],       // 四连撑（同拍考试的最后一段）
        [239.5, ['kneeler', 'kneeler', 'kneeler']],
        [243, ['kneeler', 'kneeler', 'kneeler']],
        [246.5, ['kneeler', 'kneeler', 'kneeler']],
        [250, ['.', 'legs', '.'], 3],                   // 挤一下
        [254.5, ['legs', '.', 'legs']],
        [258.5, ['legs', 'reach', 'legs']],
        [262.5, ['kneeler', 'kneeler', 'kneeler']],
        [266, ['kneeler', 'kneeler', 'kneeler']],       // 「我们终于跑成了一样的速度。」（@272）之前最后一个动作
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
        { at: 95.2, lane: -1, kind: 'crawler', behavior: { type: 'walk', speed: 3.0 } },                    // 约 @207 追上（镜子在右侧）
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
        // 渐变提前走完：@240 起稳定同拍。只是把已有的渐变收尾（30 拍 5.1 → 5.4），不是可感知的换挡；
        // 5-3 @140「我开始跑。」（8 拍 5.0 → 5.8）仍是全作唯一一次换挡（§4.5）
        { at: 210, type: 'cadence', to: 5.4, beats: 30 },
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
