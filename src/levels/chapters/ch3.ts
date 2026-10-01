// src/levels/chapters/ch3.ts —— 第三章 · 雨夜（DESIGN.md §4.3、附录 B、附录 C）。归 WP2。
// 台词全部来自 lines.ts（原文逐字）。只 import schema（§8.2 规则 2）。
// 与 §4.3 表格的差异：
//   · 3-3 周主任站在 @18（表中 @14），对白挪到 @8 / @11 / @24：R5 文字休息窗与 R8 段首 1.6 s 之后要留出换道的时间。
//   · 3-4 水洼停拍里「倒影不抬头 → 慢慢站起来 → 嘘」写成**一个**组合 doubleMod（headDownHold → clip → thirdHand.at），
//     它是同一个主异常的连续演出；拆成三个 doubleMod 会被 R6 当作 1–3 s 内的三个主异常（附录 A-11）。
//     组合 doubleMod 的播放顺序约定见 docs/contract-requests/WP2.md。
//   · 3-4 静音段 hush 写 18 拍（表中 16 拍）。hush 按触发时的步频换成秒，而停拍之后要从 0 加速：写 16 拍在 Sim 里只静到
//     @127.5，正好是 @127 那一行的接触时刻；18 拍静到 @129.5，盖住表中「停拍之后 16 拍」的范围，三个必需动作都在里面。
//   · 3-2「我们之间隔着半层楼梯，像隔着一层很薄的玻璃。」在 @21（表中 @24）：22 个字要显示 2.78 s，要在段末之前显示完。
//   · 3-2 步频 3.0 → 3.6（评审修复 U1）：步幅 0.6 m、滞空上限 0.72 s 时，3.0 掌/s（1.8 m/s）下 @27 的拖把桶（0.35 m）任何起跳时刻
//     都跳不过，@9 的书包单车道撑跃窗口只有约 ±40 ms（§2.4 承诺约 ±113 ms）。现在 @9 是一摞书（3.6 掌/s 下窗口约 0.18 s），
//     @27 是横放在台阶上的拖把（mopAcross，横档，伏低）。仍是全作最慢的跑段（2.16 m/s），数数、三句文字的 R5 都成立。
//   · 3-6 是本章技巧高潮（§2.8 / §4.3）：每个乐句都有一个中道部件，求解器最少输入 1.0 次 / 10 拍，高于 3-4 的 0.95。
//     表中 3-6 @106「它不在我身后。」挪到 3-6 最后一排之后（@145），@112「它在所有能反光的地方，」「在所有我本该站起来……」挪到 3-7：
//     原文这一段就在「我家小区的门卫室里亮着灯」之前，并且补上被删掉的中间一句「在所有我看见自己的地方，」（附录 A-8，lint 的
//     A-8-splice 检查一个文字事件里的多行必须在原文里连续）。腾出来的 3-6 @104–@117 补了两个乐句。
//     3-7 从 36 拍加长到 46 拍，栏杆 @18 → @22：@3 两行、@16「在所有我本该站起来却没有站起来的地方。」（各自显示完或接近显示完），
//     R5 窗口之后才伏低钻栏杆，@29 再出「栏杆的红光在我身上扫了一下，」「像一道浅浅的伤口。」（原文一句，两行显示）。
//     WP4 的 compound kit 在栏杆之前只画门卫室（栏杆前 1.6–5.2 m），住宅楼、灌木、路灯都从栏杆之后才开始，所以栏杆不能再往后挪：
//     评审时挪到 @38，3-7 开头约 6 s 都是黑的。现在从段首（@2 截图）就能看见门卫室亮着的灯和栏杆，「它在所有能反光的地方」时它在画面里。
//   · 3-4 @40「铁皮顶棚会在下雨时发出很响的声音，」「把我的脚步声盖住。」（原文一句，两行）→ @58「但今天它没有盖。」（表中 @44 只有后一句，
//     没有前文，读不出「盖」指什么；@58 是前两行显示完之后，R5 窗口在 @55.4 的伏低之后）。
//   · 结尾卡在「它们在练习。」之前加原文「然后我的右脚动了。」（代替 fidelity 提的 3-11 静场：那会让非跑动超出 R13 的 25%）。
//   · 3-1 加一个 npc 组 'monitor'（班长同向走，和 @4 的脚步声 pan −0.4 同侧），WP6 的 specials 按组 id 认出来；她很快被超过，「渐远」只靠脚步声。
//   · 第二轮加密（修复单元 A，第 3 轮，第二次重排；取代上面 3-6「1.0 次 / 10 拍」）：3-6 是本章高潮，按 §4.3 的部件轮流来——
//     横跨三道的路沿（撑跃）、半开的卷帘门（伏低，全段 4 道）、只留一条缝的电动车和垃圾桶；「挤一下」4 处（停成一排的电动车挡住
//     你那条车道 3 拍，车尾之后 1.5 拍只有那条车道有缝）。倒在地上的电动车（bikeDown，低矮）只作点缀，全段 4 处（偏离 §4.3 的部件表，
//     建议 lead 写进 §10.4）。求解器按 0.65 s 最小间隔 1.07 → 1.73 次 / 10 拍。为了腾出检查点之后的跑动，回头窗口 @86–94 → @79–87
//     （提示 @84 → @77，紧接检查点 @76 的 1.6 s 喘息），「我已经知道回头没用。」@100 → @88（窗口结束之后）。
//     3-4 前半段约每 7 拍一个、车棚之后约每 4 拍一个（0.95 → 1.55，低于 3-6）。human 机器人 200 次：3-6 15.0% / 15.0%（施压，上限 2）；
//     3-4 3.0% / 0.5%：behind 稳度 3，即使把可跑的拍子全部排成最小间隔的撑跃链也只有 6%，到不了 §2.8 的 9%（见修复报告）。
//   · 3-1 班长（monitor 组）从 @2 挪到 @4：她先走、走在前面，说话时在画面里，@14 跟随者登场之前已经出画（见 3-1 段内注释）。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch3', title: '第三章', name: '雨夜', seed: 1703,
  card: ['c3.card'],
  outro: { lines: [{ line: 'c3.rightFootMoved' }, { line: 'c3.out1' }, { line: 'c3.out2' }, { line: 'c3.out3' }] },
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
      // 班长：一个人抱着作业本同向走（WP6 specials 按组 id 'monitor' 认出来）；和 @4 的脚步声 monitorSteps（pan −0.4）在同一侧。
      // 她走 1.35 m/s（WP6 写死）、玩家 4.8 m/s，画面上不可能「渐远」，只能靠脚步声。修复单元 A（第 3 轮）：她在玩家前方 4 m 起步
      // （第一次是 2 m，约 0.6 s 就被超过；第二次是 9 m，@12.5 才被超过，@14「另一串脚步声」之前 0.3 s 还在画面左沿）。
      // 现在 @0「我关灯了。」时她在横屏镜头前 6.8 m、竖屏 7.8 m（低画质雾的可读距离 12.3 m 以内），「嗯。」时正从左边被超过（约 @5.6），
      // 从中道看约 1.3–1.4 s（@6–7）出画，从左道看约 1.7 s（@8）出画；@14 的跟随者登场前 1 s（1.9 s）画面里已经没有人。
      // @4 起「先轻后重」的脚步声留在身后、越来越远。她真的走得比玩家远，要 WP6 给她单独的速度（见修复报告）。
      npcs: [{ id: 'monitor', kind: 'walkers', from: 4, to: 4, side: 'L', density: 1, gaze: 'none' }],
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
      beats: 32, stride: 0.6, cadence: 3.6, stairs: { dir: 'down', risePerBeat: 0.15 },
      follower: { mode: 'behind', lagOverride: 1 },                    // 「但比我慢一拍」
      rows: [
        [9, ['.', 'books', '.']],                    // 一摞书（3.6 掌/s 下单车道撑跃窗口约 0.18 s；书包只有 0.15 s）
        [27, ['.', '.', 'mopAcross']],               // 横放在台阶上的拖把（横档，伏低）：拖把桶 0.35 m 在楼梯的步速下撑跃根本跳不过
      ],
      events: [
        { at: 4, type: 'count', from: 1, to: 4, ghostLag: 1, id: 'stairsCount' },
        { at: 12, type: 'text', line: 'c3.countingToo' },
        { at: 16, type: 'text', line: 'c3.oneBeatLate', id: 'oneBeatLate' },
        { at: 21, type: 'text', line: 'c3.halfFlight' },
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
        // 第二轮加密（第 3 轮重排）：倒地的自行车（撑跃）、车棚铁架（伏低）、只留一条缝的路桩和垃圾桶轮流来，前半段约每 7 拍一个，
        // 车棚之后约每 4 拍一个；检查点之后同样由疏到密。「挤一下」：一排垃圾桶挡住你那条车道 3 拍，尾巴之后 1.5 拍只有那条车道有缝。
        // 求解器最少输入 1.55 次 / 10 拍，低于本章高潮 3-6。
        [12, ['.', 'bin', 'bin']],                       // 垃圾桶只留一条缝
        [13, ['.', '.', 'puddle']],                      // 水洼（软，里面有倒影）
        [19, ['bikeDown', 'bikeDown', 'bikeDown']],      // 倒地的自行车（撑跃）
        [26, ['bikeRack', 'bikeRack', 'bikeRack']],      // 车棚铁架（伏低）
        [33, ['bollard', '.', 'bollard']],               // 路桩第一次出现：这一行只有它（R7）
        [40, ['.', 'puddle', '.']],                      // 车棚（@40–@80）：铁皮顶雨声很响
        [46, ['bollard', 'bollard', '.']],
        [47, ['puddle', '.', '.']],
        [50, ['bikeRack', 'bikeRack', 'bikeRack']],
        [53.5, ['bin', '.', 'bin']],                     // 「但今天它没有盖。」（@58）之前最后一个动作
        [65, ['bikeDown', 'bikeDown', 'bikeDown']],
        [69, ['.', 'bin', '.'], 3],                      // 一排垃圾桶挡住中道 3 拍……
        [73.5, ['bollard', '.', 'bollard']],             // ……尾巴之后 1.5 拍只有中道有缝（挤一下）
        [77.5, ['bikeDown', 'bikeDown', 'bikeDown']],
        [81, ['bikeDown', 'bikeDown', 'bikeDown']],
        [85, ['bin', 'bin', '.']],
        [89, ['bikeDown', 'bikeDown', 'bikeDown']],
        [90, ['puddle', '.', '.']],
        [93, ['bollard', '.', 'bin']],
        [97, ['bikeDown', 'bikeDown', 'bikeDown']],      // 检查点（@104）之前最后一个动作
        [106, ['puddle', '.', '.']],
        [119, ['.', 'bikeRack', 'bikeRack']],            // 静音段里的三个必需动作（只能靠眼睛读）
        [123, ['bollard', '.', 'bollard']],
        [127, ['bikeDown', 'bikeDown', 'bikeDown']],
        [131.5, ['.', 'bin', 'bin']],
        [133, ['.', '.', 'puddle']],
        [135.5, ['bikeDown', 'bikeDown', 'bikeDown']],
        [140, ['bollard', '.', 'bin']],
        [148, ['bin', 'bin', '.']],                      // 右道 @150 是被雨泡过的纸条 n3-b
        [152, ['bikeDown', 'bikeDown', 'bikeDown']],
        [156, ['bin', '.', 'bollard']],
        [160, ['.', 'puddle', '.']],
        [162, ['.', 'bin', '.'], 3],                     // 挤一下
        [166.5, ['bollard', '.', 'bin']],
        [170.5, ['bikeDown', 'bikeDown', 'bikeDown']],
        [174.5, ['bikeDown', 'bikeDown', 'bikeDown']],
        [178.5, ['bin', 'bin', '.']],
        [182.5, ['bikeDown', 'bikeDown', 'bikeDown']],
        [190.5, ['bollard', '.', 'bin']],
      ],
      items: [
        { at: 110, lane: 0, kind: 'puddle', len: 3 },                                     // 中道那个大水洼
      ],
      notes: [{ at: 150, lane: 1, note: 'n3-b' }],
      events: [
        { at: 4, type: 'text', line: 'c3.goldPieces' },
        { at: 40, type: 'ambience', amb: 'shedRoof', level: 1, seconds: 1.5 },          // 车棚：铁皮顶雨声很响
        { at: 40, type: 'text', line: ['c3.shedRoof', 'c3.coverSteps'] },             // 原文一句，两行显示
        { at: 58, type: 'text', line: 'c3.notCovered' },                                // 前两行（26 字，3.14 s）显示完之后；R5 窗口在 @55.4 的伏低之后
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
      // 每个乐句都要有一个中道的部件（只占边道的行对中道的玩家是被动的）；后半段「它不在我身后。」那几句挪到 3-7 之后，
      // @104 起再补几个乐句（见文件头）
      rows: [
        // 第二轮加密（第 3 轮重排，取代上一轮几乎全是倒地自行车的版本）：§4.3 的部件轮流来——横跨三道的路沿（撑跃）、半开的卷帘门
        // （伏低，约每 16–20 拍一道，全段 4 道）、只留一条缝的电动车和垃圾桶（换道）。前半段约每 5 拍一个、后半段约每 4 拍一个。
        // 「挤一下」：停成一排的电动车挡住你那条车道 3 拍，车尾之后 1.5 拍只有那条车道有缝（全段 4 处）。
        [12, ['curb', 'curb', 'curb']],                  // 路沿（撑跃）
        [17.5, ['scooter', 'scooter', '.']],             // 电动车第一次出现：这一行只有它（R7）
        [23, ['.', '.', 'scooter'], 3],                  // 停成一排的电动车挡住右道 3 拍……
        [27.5, ['scooter', 'bin', '.']],                 // ……车尾之后 1.5 拍只有右道有缝（挤一下）
        [33, ['shutterHalf', 'shutterHalf', 'shutterHalf']], // 半开的卷帘门（伏低）
        [39, ['bin', '.', 'scooter']],                   // 左道 @40 是纸条 n3-c
        [43, ['.', 'scooter', '.'], 3],                  // 挤一下
        [47.5, ['bin', '.', 'scooter']],
        [51.5, ['curb', 'curb', 'curb']],
        [55.5, ['shutterHalf', 'shutterHalf', 'shutterHalf']],
        [59, ['curb', 'curb', 'curb']],                  // 「五根手指朝着地面……」（@64）之前最后一个动作
        [61, ['.', 'puddle', '.']],                      // 水洼（软）
        [71.5, ['scooter', 'bikeDown', 'bin']],          // 两辆车之间倒着一辆电动车：只能从中道撑过去
        [75, ['curb', 'curb', 'curb']],                  // 检查点（@76）之前
        [95.5, ['curb', 'curb', 'curb']],                // 回头窗口、「我已经知道回头没用。」之后
        [99.5, ['.', 'scooter', '.'], 3],                // 挤一下
        [104, ['bin', '.', 'scooter']],
        [108, ['shutterHalf', 'shutterHalf', 'shutterHalf']],
        [111.5, ['bikeDown', 'bikeDown', 'bikeDown']],   // 倒在地上的电动车（低矮，点缀：全段 4 处）
        [115.5, ['.', 'scooter', '.'], 3],               // 挤一下
        [120, ['bin', '.', 'scooter']],
        [124, ['shutterHalf', 'shutterHalf', 'shutterHalf']],
        [128, ['curb', 'curb', 'curb']],                 // 最后一段：路沿和倒地的电动车交替
        [132, ['bikeDown', 'bikeDown', 'bikeDown']],
        [136, ['curb', 'curb', 'curb']],
        [140, ['bikeDown', 'bikeDown', 'bikeDown']],     // 最后一排：之后「它不在我身后。」（@145）
      ],
      windows: [{ id: 'lookUseless', from: 79, to: 87, type: 'lookBack', gain: 0 }],
      notes: [{ at: 40, lane: -1, note: 'n3-c' }],
      events: [
        { at: 4, type: 'text', line: 'c3.closer', id: 'closerNow' },
        { at: 64, type: 'text', line: 'c3.fingersDown', id: 'graffitiHand' },
        { at: 77, type: 'hint', hint: 'look' },
        { at: 88, type: 'text', line: 'c3.useless', id: 'uselessLookBack' },
        // 原文紧接「我已经知道回头没用。」：最后一排（@140）之后、卷帘门和水洼还在两边的时候出字
        { at: 145, type: 'text', line: 'c3.notBehind' },
      ],
    },
    /* 3-7 小区：它在所有能反光的地方；门卫室亮着灯；电子栏杆的红光像一道浅浅的伤口 */
    {
      id: '3-7', kind: 'run', kit: 'street', variant: 'compound', atmosphere: 'rainNight', surface: 'asphaltWet',
      beats: 46, stride: 1.0, cadence: 5.0,
      follower: { mode: 'behind' },                                                      // 上限回到 3
      rows: [
        [22, 'HHH'],                                 // 电子栏杆横跨三道，红光扫过（门卫室在栏杆前 1.6–5.2 m）
      ],
      events: [
        // 原文（第三章）这一段在「我已经知道回头没用。它不在我身后。」（3-6 末尾）之后、「我家小区的门卫室里亮着灯」之前，按原文顺序。
        // compound kit 在栏杆之前只画门卫室，所以栏杆尽量靠前：文字从 @3 起，「它不在我身后。」（3-6 @145，1.43 s）显示完再滚上来
        { at: 3, type: 'text', line: ['c3.reflective', 'c3.seeSelf'], id: 'reflectiveEverywhere' },
        { at: 16, type: 'text', line: 'c3.shouldStand' },                               // 接在「在所有我看见自己的地方，」下面滚上来（前两行显示 2.6 s）
        { at: 29, type: 'text', line: ['c3.redLight', 'c3.wound'], id: 'barrierWound' },   // 钻过栏杆之后；上一句显示完
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
