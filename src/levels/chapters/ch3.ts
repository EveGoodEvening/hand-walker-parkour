// src/levels/chapters/ch3.ts —— 第三章 · 雨夜（DESIGN.md §4.3、附录 B、附录 C）。归 WP2。
// 台词全部来自 lines.ts（原文逐字）。只 import schema（§8.2 规则 2）。
// 与 §4.3 表格的差异：
//   · 3-3 周主任站在 @18（表中 @14），对白挪到 @8 / @11 / @24：R5 文字休息窗与 R8 段首 1.6 s 之后要留出换道的时间。
//   · 3-4 水洼停拍里「倒影不抬头 → 慢慢站起来 → 嘘」写成**一个**组合 doubleMod（headDownHold → clip → thirdHand.at），
//     它是同一个主异常的连续演出；拆成三个 doubleMod 会被 R6 当作 1–3 s 内的三个主异常（附录 A-11）。
//     组合 doubleMod 的播放顺序约定见 docs/contract-requests/WP2.md。
//   · 3-4 静音段 hush 写 18 拍（表中 16 拍）。hush 按触发时的步频换成秒，而停拍之后要从 0 加速：写 16 拍在 Sim 里只静到
//     @127.5，正好是 @127 那一行的接触时刻；18 拍静到 @129.5，盖住表中「停拍之后 16 拍」的范围，三个必需动作都在里面。
//   · 3-2「我们之间隔着半层楼梯，像隔着一层很薄的玻璃。」在 @22（表中 @24）：22 个字要显示 2.78 s，从 @24 开始会超出段末 0.1 s。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch3', title: '第三章', name: '雨夜', seed: 1703,
  card: ['c3.card'],
  outro: { lines: [{ line: 'c3.out1' }, { line: 'c3.out2' }, { line: 'c3.out3' }] },
  notes: [
    { id: 'n3-a', face: 'blank', front: null, back: null, folded: false, pickup: true },
    { id: 'n3-b', face: 'blank', front: null, back: null, folded: false, pickup: true },   // 被雨泡过，纸面发皱
    { id: 'n3-c', face: 'blank', front: null, back: null, folded: false, pickup: true },   // 被雨泡过
  ],
  requiredBeats: ['lightsOut', 'anotherSteps', 'stairsCount', 'oneBeatLate', 'directorZhou', 'rainStarts', 'puddleStands',
    'puddleShush', 'hushRun', 'busTap', 'closerNow', 'graffitiHand', 'uselessLookBack', 'reflectiveEverywhere', 'barrierWound',
    'soundLight', 'twelvePalms', 'mirrorEmpty', 'handOnShoulder'],
  segments: [
    /* 3-1 熄灯：身后的灯一盏一盏灭；前方每三盏一盏在闪；另一串脚步声 */
    {
      id: '3-1', kind: 'run', kit: 'corridor', variant: 'night', atmosphere: 'nightIndoor', surface: 'terrazzo',
      beats: 110, stride: 1.0, cadence: [4.8, 5.2],
      follower: { mode: 'absent', steady: 3 },
      rows: [
        [12, ['.', '.', 'bag']],                     // 书包
        [22, ['.', 'mopBucket', '.']],              // 拖把桶
        [28, ['locker', '.', '.']],                  // 储物柜
        [34, ['.', '.', 'chairBar']],               // 倒扣的椅子
        [47, ['.', '.', 'pillar']],
        [50, ['.', '.', 'bin']],
        [54, ['.', '.', 'bin']],
        [57, ['.', '.', 'pillar']],
        [61, ['locker', '.', '.']],
        [64, ['locker', 'bag', '.']],
        [68, ['.', '.', 'chairBar']],
        [71, ['chairBar', '.', '.']],
        [75, ['bin', '.', '.']],
        [78, ['mopBucket', '.', '.']],
        [82, ['.', 'bag', 'mopBucket']],
        [85, ['bin', 'chairBar', '.']],
        [96, ['chairBar', 'bin', '.']],
        [99, ['.', 'pillar', 'chairBar']],
        [103, ['.', '.', 'chairBar']],
        [106, ['mopBucket', '.', '.']],
      ],
      notes: [{ at: 50, lane: 0, note: 'n3-a' }],
      events: [
        { at: 0, type: 'ambience', amb: 'nightCorridor', level: 1, seconds: 1.5 },
        { at: 0, type: 'text', line: 'c3.lightsOff', style: 'other', speaker: 'monitor' },
        { at: 0, type: 'lights', op: 'out', from: -9, to: -6 },          // 后排两盏
        { at: 1, type: 'lights', op: 'out', from: -6, to: -2 },          // 中间三盏
        { at: 2, type: 'lights', op: 'out', from: -2, to: 0, id: 'lightsOut' },   // 讲台一盏
        { at: 0, type: 'lights', op: 'flicker', from: 3, to: 110, every: 3 },     // 前方每三盏一盏在闪
        { at: 0, type: 'lights', op: 'out', from: 60, to: 80 },          // @60–80 暗段
        { at: 3, type: 'text', line: 'c3.mm', style: 'self' },
        { at: 4, type: 'sfx', sfx: 'monitorSteps', pan: -0.4 },           // 正常人的脚步：先轻后重，渐远
        { at: 2, type: 'hint', hint: 'jump' },
        { at: 14, type: 'follower', def: { mode: 'behind', steady: 3 }, id: 'anotherSteps' },
        { at: 14, type: 'hud', op: 'show' },
        { at: 14, type: 'text', line: 'c3.anotherSteps' },
        { at: 18, type: 'hint', hint: 'lane' },
        { at: 24, type: 'hint', hint: 'duck' },
        { at: 40, type: 'text', line: 'c3.noLookYet' },
        { at: 90, type: 'text', line: 'c3.noPatience' },
      ],
    },
    /* 3-2 数台阶：一、二、三、四；它的数字晚一个出现 */
    {
      id: '3-2', kind: 'run', kit: 'stairs', variant: 'nightDown', atmosphere: 'nightIndoor', surface: 'concrete',
      beats: 32, stride: 0.6, cadence: 3.0, stairs: { dir: 'down', risePerBeat: 0.15 },
      follower: { mode: 'behind', lagOverride: 1 },                    // 「但比我慢一拍」
      rows: [
        [9, ['.', 'bag', '.']],                      // 书包
        [27, ['.', '.', 'mopBucket']],               // 拖把
      ],
      events: [
        { at: 4, type: 'count', from: 1, to: 4, ghostLag: 1, id: 'stairsCount' },
        { at: 12, type: 'text', line: 'c3.countingToo' },
        { at: 16, type: 'text', line: 'c3.oneBeatLate', id: 'oneBeatLate' },
        { at: 22, type: 'text', line: 'c3.halfFlight' },
      ],
    },
    /* 3-3 校门：周主任和烟头；两道校门横档；下雨了 */
    {
      id: '3-3', kind: 'run', kit: 'street', variant: 'schoolGate', atmosphere: 'rainNight', surface: 'concrete',
      beats: 64, stride: 1.0, cadence: 5.0,
      follower: { mode: 'behind', lagOverride: null },
      rows: [
        [36, 'HHH'],                                 // 校门横档（铁栅栏的影子像一排被拉长的牙齿）
        [42, 'HHH'],
      ],
      items: [
        { at: 18, lane: 0, kind: 'legs', id: 'directorZhou' },                      // 周主任的灰裤腿，画面上沿烟头一明一灭
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'nightCorridor', level: 0.6, seconds: 1 },
        { at: 8, type: 'text', line: 'c3.notBack', style: 'other', speaker: 'directorZhou', id: 'directorZhou' },
        { at: 11, type: 'text', line: 'c3.leaving', style: 'self' },
        { at: 24, type: 'text', line: 'c3.safe', style: 'other', speaker: 'directorZhou' },
        { at: 48, type: 'text', line: 'c3.strange', style: 'whisper', speaker: 'directorZhou', pan: -0.6 },
        { at: 52, type: 'rain', intensity: 0.6, seconds: 4, id: 'rainStarts' },
        { at: 52, type: 'ambience', amb: 'rainStreet', level: 1, seconds: 4 },
        { at: 56, type: 'text', line: 'c3.rain' },
      ],
    },
    /* 3-4 小路·车棚·水洼：水洼里的影子站起来；嘘；静音段里的三个必需动作 */
    {
      id: '3-4', kind: 'run', kit: 'street', variant: 'alley', atmosphere: 'rainNight', surface: 'asphaltWet',
      beats: 200, stride: 1.1, cadence: [5.0, 5.4], checkpoints: [104],
      follower: { mode: 'behind' },
      surfaces: [{ id: 'bigPuddle', kind: 'puddle', side: 'floor', from: 111, to: 114, lane: 0 }],
      rows: [
        [12, ['.', '.', 'puddle']],
        [15, ['bikeDown', '.', '.']],
        [19, ['bikeRack', '.', '.']],
        [22, ['bikeRack', '.', '.']],
        [26, ['.', '.', 'bin']],
        [29, ['bikeRack', '.', '.']],
        [33, ['.', '.', 'bikeRack']],
        [36, ['bin', '.', '.']],
        [40, ['.', 'puddle', '.']],
        [47, ['.', '.', 'puddle']],
        [56, ['.', 'bikeRack', 'puddle']],
        [61, ['.', '.', 'curb']],
        [64, ['bikeRack', 'bin', '.']],
        [68, ['bikeDown', '.', '.']],
        [71, ['.', 'bin', 'bikeDown']],
        [75, ['bikeRack', '.', 'bikeDown']],
        [78, ['.', '.', 'bikeRack']],
        [82, ['bollard', 'bollard', '.']],
        [85, ['.', '.', 'bikeRack']],
        [90, ['puddle', '.', 'bollard']],
        [96, ['bollard', '.', '.']],
        [99, ['.', '.', 'bikeRack']],
        [103, ['bikeRack', '.', 'bikeDown']],
        [106, ['puddle', '.', '.']],
        [119, ['.', 'bikeRack', 'bikeRack']],       // 静音段里的三个必需动作（只能靠眼睛读）
        [123, ['bollard', 'bollard', '.']],
        [127, ['.', 'curb', 'curb']],
        [130, ['curb', '.', '.']],
        [133, ['.', '.', 'puddle']],
        [134, ['curb', '.', '.']],
        [137, ['bikeRack', '.', 'bollard']],
        [141, ['.', 'bin', 'bin']],
        [144, ['.', '.', 'bollard']],
        [148, ['bikeRack', 'bikeDown', '.']],             // 右道留给被雨泡过的纸条 n3-b
        [151, ['bikeRack', 'curb', '.']],
        [155, ['bikeDown', '.', 'curb']],
        [158, ['.', '.', 'bikeDown']],
        [160, ['.', 'puddle', '.']],
        [162, ['bikeRack', 'curb', '.']],
        [166, ['curb', '.', 'puddle']],
        [169, ['.', 'bollard', 'bikeRack']],
        [172, ['bikeRack', '.', 'bikeDown']],
        [176, ['bin', '.', '.']],
        [179, ['.', 'curb', 'curb']],
        [182, ['.', '.', 'puddle']],
        [183, ['bin', '.', '.']],
        [186, ['bollard', '.', 'bikeDown']],
        [190, ['.', 'bollard', '.']],
        [193, ['bikeRack', 'bikeDown', '.']],
      ],
      items: [
        { at: 110, lane: 0, kind: 'puddle', len: 3 },                                     // 中道那个大水洼
      ],
      notes: [{ at: 150, lane: 1, note: 'n3-b' }],
      events: [
        { at: 4, type: 'text', line: 'c3.goldPieces' },
        { at: 40, type: 'ambience', amb: 'shedRoof', level: 1, seconds: 1.5 },          // 车棚：铁皮顶雨声很响
        { at: 44, type: 'text', line: 'c3.notCovered' },
        { at: 80, type: 'ambience', amb: 'rainStreet', level: 1, seconds: 1.5 },
        { at: 112, type: 'stop', seconds: 6, timeline: [
          { at: 0.0, type: 'camera', shot: 'puddleDown', seconds: 1.0 },
          { at: 0.0, type: 'double', spec: { id: 'puddle', surface: 'bigPuddle', source: 'history', delay: 0 } },
          { at: 0.2, type: 'text', line: 'c3.iStop' },
          { at: 0.9, type: 'text', line: 'c3.itStops' },
          // 一个主异常的连续演出：头不抬（1.2 s）→ 慢慢站起来 → 第三只手：嘘（相对本 mod 3.0 s）
          { at: 1.8, type: 'doubleMod', target: 'puddle', mod: { headDownHold: 1.2, clip: 'standUp', thirdHand: { gesture: 'shush', at: 3.0, hold: 1.2 } }, id: 'puddleStands' },
          { at: 1.8, type: 'text', line: 'c3.noLift' },
          { at: 3.0, type: 'text', line: 'c3.standsUp' },
          { at: 4.8, type: 'text', line: 'c3.shush', id: 'puddleShush' },
          { at: 4.8, type: 'sfx', sfx: 'shush' },
          { at: 5.4, type: 'sfx', sfx: 'drip', gain: 0.5 },                             // 一滴雨把它打碎
          { at: 5.4, type: 'doubleEnd', target: 'puddle', fade: 0.2 },
          { at: 5.9, type: 'hush', beats: 18, id: 'hushRun' },                          // 静音段：只剩自己的掌声
          { at: 5.9, type: 'camera', shot: 'follow', seconds: 0.6 },
        ] },
      ],
    },
    /* 3-5 公交车：车窗里的「我」正常地坐着；笃（静场） */
    {
      id: '3-5', kind: 'still', set: 'bus', variant: 'default', atmosphere: 'busNight', duration: 12,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'busWindow', seconds: 0 },
        { at: 0.0, type: 'actor', clip: 'busSeat', seconds: 12 },
        { at: 0.0, type: 'ambience', amb: 'bus', level: 1, seconds: 0.8 },
        { at: 1.6, type: 'double', spec: { id: 'busMe', surface: 'window', source: 'script', clip: 'busSeatNormal' } },
        { at: 3.6, type: 'text', line: 'c3.notMe' },
        { at: 5.8, type: 'doubleMod', target: 'busMe', mod: { clip: 'tapGlass' } },
        { at: 6.8, type: 'sfx', sfx: 'tap' },
        { at: 6.8, type: 'text', line: 'c3.tap', id: 'busTap' },
        { at: 7.0, type: 'overlay', op: 'palmNumb', seconds: 1.5 },
        { at: 9.4, type: 'doubleEnd', target: 'busMe', fade: 0.3 },                     // 雨刷扫过，它不见了
      ],
    },
    /* 3-6 卷帘门街：本章技巧高潮；施压；回头窗口收益 0 */
    {
      id: '3-6', kind: 'run', kit: 'street', variant: 'shopStreet', atmosphere: 'rainNight', surface: 'asphaltWet',
      beats: 150, stride: 1.1, cadence: [5.4, 5.8], checkpoints: [76],
      follower: { mode: 'pressure', steady: 2 },
      rows: [
        [13, ['.', '.', 'shutterHalf']],
        [16, ['scooter', '.', '.']],
        [20, ['curb', 'bin', '.']],
        [23, ['shutterHalf', '.', 'bin']],
        [27, ['.', '.', 'scooter']],
        [33, ['.', '.', 'puddle']],
        [37, ['curb', '.', 'curb']],
        [41, ['curb', 'curb', '.']],
        [44, ['.', '.', 'bin']],
        [48, ['.', 'curb', 'curb']],
        [51, ['shutterHalf', 'curb', '.']],
        [55, ['scooter', '.', 'scooter']],
        [58, ['shutterHalf', '.', 'bin']],
        [62, ['shutterHalf', '.', '.']],
        [67, ['.', 'puddle', '.']],
        [72, ['curb', 'bin', '.']],
        [84, ['.', '.', 'curb']],
        [88, ['shutterHalf', '.', '.']],
        [92, ['shutterHalf', '.', '.']],
        [96, ['.', '.', 'shutterHalf']],
        [100, ['.', '.', 'shutterHalf']],
        [104, ['.', '.', 'bin']],
        [108, ['bin', '.', '.']],
        [112, ['curb', '.', '.']],
        [118, ['shutterHalf', 'curb', '.']],
        [121, ['curb', 'bin', '.']],
        [125, ['shutterHalf', '.', '.']],
        [128, ['.', '.', 'bin']],
        [132, ['shutterHalf', '.', 'curb']],
        [135, ['shutterHalf', 'curb', '.']],
        [139, ['shutterHalf', '.', 'bin']],
        [142, ['curb', '.', '.']],
      ],
      windows: [{ id: 'lookUseless', from: 86, to: 94, type: 'lookBack', gain: 0 }],
      notes: [{ at: 40, lane: -1, note: 'n3-c' }],
      events: [
        { at: 4, type: 'text', line: 'c3.closer', id: 'closerNow' },
        { at: 64, type: 'text', line: 'c3.fingersDown', id: 'graffitiHand' },
        { at: 84, type: 'hint', hint: 'look' },
        { at: 100, type: 'text', line: 'c3.useless', id: 'uselessLookBack' },
        { at: 106, type: 'text', line: 'c3.notBehind' },
        { at: 112, type: 'text', line: ['c3.reflective', 'c3.shouldStand'], id: 'reflectiveEverywhere' },
      ],
    },
    /* 3-7 小区：电子栏杆的红光像一道浅浅的伤口 */
    {
      id: '3-7', kind: 'run', kit: 'street', variant: 'compound', atmosphere: 'rainNight', surface: 'asphaltWet',
      beats: 36, stride: 1.0, cadence: 5.0,
      follower: { mode: 'behind' },                                                      // 上限回到 3
      rows: [
        [18, 'HHH'],                                 // 电子栏杆横跨三道，红光扫过
      ],
      events: [
        { at: 24, type: 'text', line: 'c3.wound', id: 'barrierWound' },
      ],
    },
    /* 3-8 楼道：全黑；声控灯（撑跃落地或 ↓ 拍地） */
    {
      id: '3-8', kind: 'run', kit: 'stairs', variant: 'stairwellUp', atmosphere: 'nightIndoor', surface: 'concrete',
      beats: 48, stride: 0.6, cadence: 4.4, stairs: { dir: 'up', risePerBeat: 0.15 },
      follower: { mode: 'behind' },
      rows: [
        [16, ['.', 'newspapers', '.']],              // 旧报纸堆
        [26, ['.', '.', 'stroller']],                // 婴儿车
        [34, ['newspapers', '.', '.']],
        [40, ['.', 'stroller', '.']],
      ],
      events: [
        { at: 0, type: 'lights', op: 'sound', from: 0, to: 48 },
        { at: 0, type: 'ambience', amb: 'none', level: 0, seconds: 1 },
        { at: 0, type: 'hint', hint: 'slap' },
        { at: 2, type: 'text', line: 'c3.soundLight', id: 'soundLight' },
      ],
    },
    /* 3-9 十二掌：黑暗的客厅，从十二倒数到一（静场，自动爬行） */
    {
      id: '3-9', kind: 'still', set: 'home', variant: 'default', atmosphere: 'homeDark', duration: 7,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'homeCrawl', seconds: 0 },
        { at: 0.0, type: 'ambience', amb: 'home', level: 1, seconds: 0.6 },
        { at: 0.2, type: 'text', line: 'c3.twelveSteps' },
        { at: 0.4, type: 'count', from: 12, to: 1 },
        { at: 0.4, type: 'autoCrawl', speed: 2.2, seconds: 5.6 },
        { at: 1.4, type: 'text', line: 'c3.twelvePalms', id: 'twelvePalms' },
      ],
    },
    /* 3-10 卫生间：镜子里没有人；关门前最后一眼，它站在你身后，手搭在你肩上（静场） */
    {
      id: '3-10', kind: 'still', set: 'bathroom', variant: 'default', atmosphere: 'homeDark', duration: 14,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'bathroomMirror', seconds: 0 },
        { at: 0.0, type: 'actor', clip: 'sinkLean', seconds: 5 },
        { at: 0.2, type: 'double', spec: { id: 'bath', surface: 'mirror', source: 'history', delay: 0 } },
        { at: 2.2, type: 'sfx', sfx: 'splash', gain: 0.6 },                              // 泼水，擦镜子
        { at: 3.8, type: 'doubleEnd', target: 'bath', fade: 0 },
        { at: 4.0, type: 'text', line: 'c3.noOne', id: 'mirrorEmpty' },
        { at: 4.6, type: 'sfx', sfx: 'drip', gain: 0.4 },                                 // 毛巾在滴水
        { at: 5.4, type: 'camera', shot: 'turnBack', seconds: 1.0 },                    // 回头：什么也没有
        { at: 7.2, type: 'text', line: 'c3.wantStand', style: 'self' },
        { at: 8.8, type: 'text', line: 'c3.afterStand', style: 'self' },
        { at: 10.4, type: 'camera', shot: 'bathroomMirror', seconds: 0.4 },
        { at: 10.8, type: 'double', spec: { id: 'bath2', surface: 'mirror', source: 'history', delay: 0 } },
        { at: 10.8, type: 'double', spec: { id: 'bathBehind', surface: 'mirror', source: 'script', clip: 'standBehindShoulder', attachBehind: 'bath2',
          thirdHand: { gesture: 'shoulder', at: 0, hold: 0.8 } }, id: 'handOnShoulder' },
        { at: 11.6, type: 'sfx', sfx: 'doorClose' },
        { at: 11.6, type: 'overlay', op: 'black', seconds: 0.3 },
        { at: 13.2, type: 'text', line: 'c3.doorClosed' },
      ],
    },
  ],
} satisfies ChapterDef;
