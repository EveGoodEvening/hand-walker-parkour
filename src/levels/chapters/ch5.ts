// src/levels/chapters/ch5.ts —— 第五章 · 七步（DESIGN.md §4.5、附录 B、附录 C）。归 WP2。
// 台词全部来自 lines.ts（原文逐字）。只 import schema（§8.2 规则 2）。
// 与 §4.5 表格的差异（都为了 R6 / 附录 A-11「任意 20 s 内最多一个主异常」与 R13 非跑动占比）：
//   · 5-3 反向的影子是**一个**主异常：@30 的 shadow 'reversed' 开始；@44 追随者 hud 换成 'shadow'（影子开始朝你爬，
//     画面按 follower.distance 摆放），@52 上限收到 2（身后 2 m）。为此 5-3 段首就是 pressure 模式，但 hud / voice 为
//     none、上限 3，玩家在 @44 之前感觉不到任何差别；这样 @44、@52 不会被 R6 当作另外两次「跟随者登场」。
//   · 5-6 站着的「我」是一个 double（从走廊尽头迎面走来、避开你的车道）加**一个** doubleMod（在 5 m 处停下、指镜子、
//     第三只手摸脖子）；手势 hold 结束后它自己继续走过你身边（约定见 docs/contract-requests/WP2.md）。
//   · 停拍、静场略短于表格（5-1 6.4 s、5-3 停拍 2.0 s、5-5 8 s），让非跑动占比 ≤ 25%。5-8 取 13 s（表中 ≤ 15 s）：
//     起身后每 0.9 s 一步，第 7 步之后 +3.0 s 的「不是。是它们在练习。」、+4.4 s 的「我失败了。」也要显示完（等输入的时间不计入 duration）。
//   · 5-11 门牌「高二（7）班」挂在 @214、y 1.3–1.6 m（表中 @200–212；评审修复 U1 之前是 @215、y 1.9–2.1）。@208 翻转时它在横屏镜头前
//     约 9 m，翻转后约 1 s 内从 4–6 m 处以反字经过 0.92 m 机位的视线带；放在 @206 的话翻转时它已经在镜头旁边，反字根本看不见。
//     tests/unit/content/chapters.test.ts 的「5-11 门牌」检查。门牌的尺寸和自发光由 WP3 的 shell.ts 负责。
//   · 5-11 翻转之后是减速的收束：@208–@218 不放障碍，之后每 8–12 拍一行。§2.8 的「必需动作密度」按求解器的最少输入次数算
//     （只占边道的行对中道的玩家是被动的，行密度只是上限）：5-11 0.46 次 / 10 拍，低于高潮 5-3 的 0.55。
//   · 评审修复 U1：
//     - 腿偏移有代价：5-4 两次偏移之后约 1 s，被迫换进的左道上有一只拖把桶（原来中道 @44 的拖把桶删掉），不掰正就得多跳一次；
//       5-11 @90 偏移之后左道 @96 一个书包。R9 只禁止 block。
//     - 5-6 两侧人墙只封边道，中道的玩家原来 24 s 不用按键：@30、@100 伸进中缝的脚（静止，「只是习惯」），@46 书包，@106 再一道人墙。
//     - 5-3 @185 中道的垃圾桶换成路沿（不挡下一排），@192 的路桩挪到 @194，@206 的路桩挪到左道；@199 中道补一道路沿，
//       求解器最少输入仍是 13 次（5-3 不削弱）。
//     - 5-11 @150「我要找到那个还在爬行的影子，」「那个和我一模一样、在我前面、」→ @168「用掌根指节指腹敲出节奏的影子。」：以前两行之间
//       删掉了中间一句（附录 A-8）。@168 是前两行（28 字，3.32 s）显示完的时刻，不再把它们提前挤掉。删掉 @8–@12 三个互相覆盖、此前都教过的提示。
//     - 5-9 纸条显示 4.8 s，「像有人刚刚坐过。」挪到纸条收起之后；静场开头接 5-8 的「我失败了。」补原文下一句「或者说，我的身体成功了七步，
//       然后把我摔在地上。」，5-9 因此 14.3 s。
//     - 5-7 加 npc 组 'teacherMa'（跑道边站着的马老师，一个人，不是中道上的障碍），放在本段终点前方 2 m（@66），5-8 七步时在身边。
//       WP6 的 specialOfGroup 按组 id 认出他（黑色运动裤、两侧白条）。
//   · 第二轮加密（修复单元 A，第 3 轮；取代上面 5-3 / 5-11 的密度）：5-3 @52 之后约每 4 拍一道只留一条缝的路障（停着的汽车、
//     路桩、垃圾桶）或横跨三道的路沿，@140「我开始跑。」之后最密；求解器按 0.6 s 最小间隔 0.59 → 1.45 次 / 10 拍。
//     汽车之后要回到它那条车道的缝至少隔 1.5 拍（以前试过 0.6 拍，换道窗口只有约 0.1 s，不公平）。
//     5-11 翻转之前约每 4–5 拍一个动作（0.46 → 1.36），仍低于 5-3（chapters.test 的「§2.8 难度曲线」）；@208 翻转之后照旧稀疏。
import type { ChapterDef } from '../schema';

export default {
  id: 'ch5', title: '第五章', name: '七步', seed: 1705,
  card: ['c5.card'],
  outro: { lines: [{ line: 'c5.out1' }, { line: 'c5.out2' }] },
  notes: [
    { id: 'n5-a', face: 'blank', front: null, back: null, folded: false, pickup: true },
    { id: 'n5-note', face: 'blank', front: null, back: 'c5.noteBack', folded: false, pickup: false },   // 陈默递来，铅笔，比上次更轻
  ],
  requiredBeats: ['feetDisobey', 'feetRelax', 'lateLight', 'followerAbsent', 'reversedShadow', 'shadowFaster', 'startRun',
    'shadowGone', 'driftStraighten', 'standingBehind', 'noOneBehind', 'mathSilence', 'standingMeWalks', 'windEar',
    'notInMirror', 'riseThreeSeconds', 'seventhFall', 'theyPractice', 'walkedSeven', 'noteNoMe', 'pillowDent', 'aheadRhythm',
    'fist', 'leaderAhead', 'mirrorFlip'],
  segments: [
    /* 5-1 脚：被子里的脚自己弯起来；按住，过了几秒它终于放松（静场） */
    {
      id: '5-1', kind: 'still', set: 'bedroom', variant: 'feet', atmosphere: 'homeDark', duration: 6.4,   // 「过了几秒，它终于放松。」显示到 6.19 s
      follower: { mode: 'absent', steady: 3 },
      events: [
        { at: 0.0, type: 'camera', shot: 'bedFeet', seconds: 0 },
        { at: 0.0, type: 'ambience', amb: 'home', level: 0.6, seconds: 1 },
        { at: 0.3, type: 'actor', clip: 'feetArch', seconds: 3.0 },
        { at: 0.3, type: 'text', line: 'c5.feetMoved' },
        { at: 1.8, type: 'text', line: 'c5.enough', style: 'self' },
        { at: 3.0, type: 'text', line: 'c5.didntListen', id: 'feetDisobey' },
        { at: 3.0, type: 'sfx', sfx: 'muscle' },
      ],
      input: { at: 4.2, hint: 'hold', mode: 'hold', holdSeconds: 2.5, timeout: 5, onDone: [   // 脚在你手下轻轻挣动，最后放松
        { at: 0.2, type: 'text', line: 'c5.relaxed', id: 'feetRelax' },
      ] },
    },
    /* 5-2 迟疑的灯：声控灯晚 0.5 s 才亮 */
    {
      // lead 集成：§4.5 写 5-2「暗」、声控灯晚 0.5 s 才亮。dawn 不是暗色预设（日光照亮一切、没有粉笔描边），WP1 的 R4 判声控区间里的障碍不可读；
      // 楼道没有窗，改用暗色的 nightIndoor（描边 0.35），5-3 出楼道再进 dawn。
      id: '5-2', kind: 'run', kit: 'stairs', variant: 'dawnDown', atmosphere: 'nightIndoor', surface: 'concrete',
      beats: 36, stride: 0.6, cadence: 4.4, stairs: { dir: 'down', risePerBeat: 0.15 },
      follower: { mode: 'absent' },
      rows: [
        [14, ['.', 'newspapers', '.']],              // 报纸堆
        [24, ['.', '.', 'stroller']],                // 婴儿车
      ],
      events: [
        { at: 0, type: 'lights', op: 'sound', from: 0, to: 36, delay: 0.5 },
        { at: 0, type: 'text', line: 'c5.hesitant', id: 'lateLight' },
        { at: 2, type: 'hint', hint: 'jump' },
        { at: 4, type: 'text', line: 'c5.seeMe' },
        { at: 12, type: 'hint', hint: 'lane' },
      ],
    },
    /* 5-3 反向的影子：身后什么也没有；影子是反的，朝我爬过来；我开始跑 */
    {
      id: '5-3', kind: 'run', kit: 'street', variant: 'dawn', atmosphere: 'dawn', surface: 'concrete',
      beats: 220, stride: 1.1, cadence: 5.0, checkpoints: [110],
      // pressure，但 @44 之前 hud / voice 都是 none、上限 3：见文件头
      follower: { mode: 'pressure', voice: 'none', hud: 'none', steadyMax: 3, steady: 3 },
      rows: [
        [10, 'HHH'],                                 // 电子栏杆
        [24, ['.', '.', 'curb']],
        // @52 起它保持在身后 2 m：约每 4 拍一道只留一条缝的路障，或横跨三道的路沿（第二轮加密）
        [55, ['bin', '.', 'bin']],
        [58, ['.', 'car', '.'], 3],                  // 停着的汽车
        [62.5, ['bollard', '.', 'bollard']],
        [66, ['curb', 'curb', 'curb']],
        [68, ['.', '.', 'leaves']],                  // 湿落叶（软）
        [70, ['.', 'bin', 'bin']],
        [74.5, ['bin', 'bollard', '.']],
        [78, ['bollard', '.', 'bin']],
        [81.5, ['curb', 'curb', 'curb']],
        [85, ['.', 'bin', '.']],
        [85, ['.', '.', 'car'], 3],
        [88.5, ['bollard', '.', '.']],
        [92, ['bin', 'bollard', '.']],
        [94.5, ['curb', 'curb', 'curb']],
        [125, ['.', 'bin', '.']],
        [125, ['.', '.', 'car'], 3],
        [129, ['bollard', '.', '.']],
        [133, ['curb', 'curb', 'curb']],
        [136, ['bin', 'bollard', '.']],
        // @140「我开始跑。」之后：现实部分最密的一段
        [146, ['bin', '.', 'bin']],
        [150, ['curb', 'curb', 'curb']],
        [154, ['.', 'car', '.'], 3],
        [155, ['.', '.', 'leaves']],
        [159.5, ['bollard', '.', 'bollard']],
        [163.5, ['curb', 'curb', 'curb']],
        [167.5, ['.', 'bin', 'bin']],                // 右道 @168–@172 留给纸条 n5-a
        [171.5, ['bollard', '.', '.']],
        [175.5, ['.', 'car', '.'], 3],
        [175.5, ['bin', '.', '.']],
        [181, ['bollard', '.', 'bin']],
        [185, ['curb', 'curb', 'curb']],
        [189, ['.', 'bollard', 'bin']],
        [193, ['bollard', '.', 'curb']],
        [197, ['.', 'curb', '.']],
        [201, ['.', 'car', '.'], 3],
        [201, ['.', '.', 'bin']],
        [206.5, ['bin', '.', 'bollard']],
      ],
      windows: [{ id: 'seeShadow', from: 96, to: 104, type: 'lookBack', gain: 1 }],   // 唯一一次回头能看见东西
      notes: [{ at: 170, lane: 1, note: 'n5-a' }],
      events: [
        { at: 0, type: 'ambience', amb: 'dawnStreet', level: 1, seconds: 1.5 },
        { at: 2, type: 'hint', hint: 'duck' },
        { at: 18, type: 'text', line: 'c5.noFollow', id: 'followerAbsent' },          // HUD 不显示空心点，要等 3 s 的沉默
        { at: 30, type: 'shadow', mode: 'reversed', id: 'reversedShadow' },           // 影子是反的，头朝小区门口
        { at: 34, type: 'text', line: 'c5.reversed' },
        { at: 44, type: 'follower', def: { hud: 'shadow' } },                           // 它开始朝你爬（HUD 深灰实心点 = 影子）
        { at: 44, type: 'text', line: 'c5.crawls' },
        { at: 48, type: 'text', line: 'c5.towardMe' },
        { at: 52, type: 'follower', def: { steadyMax: 2 } },                            // 施压：上限 2，稳度 2 = 身后 2 m
        { at: 94, type: 'hint', hint: 'look' },
        { at: 114, type: 'text', line: 'c5.twoMeters' },
        { at: 120, type: 'text', line: 'c5.faster', id: 'shadowFaster' },
        { at: 140, type: 'cadence', to: 5.8, beats: 8 },                                // 全作唯一一次段中换挡
        { at: 140, type: 'text', line: 'c5.startRun', id: 'startRun' },
        { at: 212, type: 'stop', seconds: 2.0, timeline: [                              // 公交站
          { at: 0.0, type: 'shadow', mode: 'normal' },
          { at: 0.0, type: 'follower', def: { mode: 'absent' } },
          { at: 0.8, type: 'text', line: 'c5.gone', id: 'shadowGone' },
        ] },
      ],
    },
    /* 5-4 厕所镜：腿偏移、掰正；镜子里它身后站着另一个人；身后没有人 */
    {
      id: '5-4', kind: 'run', kit: 'washroom', variant: 'morning', atmosphere: 'overcast', surface: 'tile',
      beats: 80, stride: 1.0, cadence: 4.8,
      follower: { mode: 'absent' },
      surfaces: [{ id: 'wcMirror5', kind: 'mirror', side: 'L', from: 38, to: 70, y: [0.25, 1.6], backdrop: 'darkRoom' }],
      // 腿偏移要有代价：被迫换进的左道约 1 s 后有一只拖把桶（R9 只禁止 block），原来的中道是空的——
      // 掰正就什么也不用做，不掰正就得多跳一次
      rows: [
        [8, ['.', '.', 'mopBucket']],
        [25, ['mopBucket', '.', '.']],
        [43, ['mopBucket', '.', '.']],
        [66, ['mopAcross', '.', '.']],
      ],
      items: [
        { at: 28, lane: 1, kind: 'stallDoor' },                                          // 右道一扇隔间门
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'room', level: 0.6, seconds: 1 },
        { at: 12, type: 'text', line: 'c5.tenDegrees' },
        { at: 14, type: 'hint', hint: 'straighten' },
        { at: 18, type: 'drift', dir: -1, say: 'c5.straighten', id: 'driftStraighten' },   // 第一次腿偏移（向左）
        { at: 36, type: 'drift', dir: -1 },                                                 // 第二次（向左）
        { at: 40, type: 'double', spec: { id: 'wcMe', surface: 'wcMirror5', source: 'history', delay: 0 } },   // 这次没有延迟
        { at: 46, type: 'double', spec: { id: 'wcStand', surface: 'wcMirror5', source: 'script', clip: 'standBehindShoulder', attachBehind: 'wcMe',
          thirdHand: { gesture: 'shoulder', at: 0.4, hold: 2.6 } }, id: 'standingBehind' },   // 它身后站着另一个人，手搭在爬行者肩上
        { at: 50, type: 'text', line: 'c5.anotherStands' },
        { at: 56, type: 'camera', shot: 'turnBack', seconds: 0.8 },                       // 镜头自动回头：身后没有人
        { at: 57, type: 'doubleEnd', target: 'wcStand', fade: 0 },
        { at: 60, type: 'text', line: 'c5.noOneBehind', id: 'noOneBehind' },
        { at: 62, type: 'sfx', sfx: 'drip' },                                              // 一滴水砸在瓷盆里，很响
        { at: 72, type: 'text', line: 'c5.sleeve' },
      ],
    },
    /* 5-5 数学课：脚弓成站姿；撑着桌沿回答；坐下时脚没跟上，全班安静一秒（静场） */
    {
      id: '5-5', kind: 'still', set: 'deskFeet', variant: 'math', atmosphere: 'overcast', duration: 8,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'deskFeet', seconds: 0 },
        { at: 0.0, type: 'actor', clip: 'feetArchDesk', seconds: 0.6 },
        { at: 0.0, type: 'ambience', amb: 'room', level: 1, seconds: 0.6 },
      ],
      input: { at: 0.3, hint: 'hold', mode: 'hold', holdSeconds: 1.2, timeout: 4, onDone: [
        { at: 0.4, type: 'text', line: 'c5.youAnswer', style: 'other', speaker: 'mathTeacher' },
        { at: 1.2, type: 'actor', clip: 'answerLean', seconds: 3.0 },
        { at: 2.0, type: 'text', line: 'c5.whichQ', style: 'self' },
        { at: 3.2, type: 'text', line: 'c5.example3', style: 'other', speaker: 'mathTeacher' },
        { at: 4.4, type: 'actor', clip: 'sitMissFeet', seconds: 1.0 },
        { at: 4.6, type: 'sfx', sfx: 'chairScrape' },
        { at: 4.6, type: 'silence', seconds: 1.0 },                                       // 全部声音静音 1 s
        { at: 5.0, type: 'text', line: 'c5.silence', id: 'mathSilence' },
      ] },
    },
    /* 5-6 课间：鞋尖全部朝向走廊中央；站着的「我」从你身边走过（人群段） */
    {
      id: '5-6', kind: 'run', kit: 'corridor', variant: 'recess', atmosphere: 'overcast', surface: 'terrazzo', crowd: true,
      beats: 140, stride: 1.0, cadence: 5.0,
      follower: { mode: 'absent' },
      npcs: [{ id: 'recessSides', kind: 'lineSides', from: 0, to: 140, side: 'both', density: 0.9, gaze: 'center' }],
      surfaces: [{ id: 'recessMirror', kind: 'mirror', side: 'L', from: 124, to: 132, y: [0.25, 1.6], chipped: true, backdrop: 'darkRoom' }],
      rows: [
        [10, ['legs', '.', '.'], 2],                 // 两侧车道的人墙，中间留着缝
        [16, ['.', '.', 'legs'], 2],
        [30, ['.', 'footOut', '.']],                 // 伸进中缝的脚：不是成心的，只是习惯（静止）
        [36, ['legs', '.', '.'], 2],
        [42, ['.', '.', 'legs'], 2],
        [46, ['.', 'bag', '.']],
        [82, ['legs', '.', '.'], 2],
        [88, ['.', '.', 'legs'], 2],
        [94, ['legs', '.', 'legs'], 2],
        [100, ['.', 'footOut', '.']],
        [106, ['legs', '.', 'legs'], 2],
        [112, ['.', 'bag', '.']],                    // 书包和长桌
        [118, ['longTable', '.', '.']],
        [136, ['.', 'longTable', '.']],
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'canteen', level: 0.7, seconds: 1.5 },
        { at: 0, type: 'crowd', group: 'recessSides', op: 'centerShoes' },              // 不是给我让的
        { at: 22, type: 'hint', hint: 'straighten' },
        { at: 24, type: 'drift', dir: 1 },                                                // 第三次腿偏移（向右）
        { at: 54, type: 'slow', speed: 0.8, seconds: 8.5, ramp: 0.5, timeline: [      // 慢行：仍然可以换道，这段没有障碍
          { at: 0.0, type: 'double', spec: { id: 'standMe', surface: 'world', source: 'script', clip: 'walkUpright',
            anchor: { sAhead: 12, speed: -1.2 }, avoidPlayerLane: true, ttl: 8.5 }, id: 'standingMeWalks' },   // 迎面 1.2 m/s：约 3.5 s 走到 5 m
          { at: 0.3, type: 'text', line: 'c5.who', style: 'whisper', speaker: 'classmate', pan: -0.5 },
          { at: 1.4, type: 'text', line: 'c5.seemsLike', style: 'whisper', speaker: 'classmate', pan: 0.5 },
          { at: 3.2, type: 'text', line: 'c5.myFace' },
          // 在 5 m 处停下，指向碎角的镜子，第三只手轻轻抚摸脖子；手势结束后自己继续走过你身边
          { at: 3.4, type: 'doubleMod', target: 'standMe', mod: { stopAtDistance: 5, clip: 'pointMirror', thirdHand: { gesture: 'neck', at: 0.6, hold: 2.2 } } },
          { at: 7.2, type: 'sfx', sfx: 'wind' },
          { at: 7.4, type: 'text', line: 'c5.wind', id: 'windEar' },
        ] },
        { at: 62, type: 'text', line: 'c5.twins', style: 'whisper', speaker: 'classmate', pan: -0.5 },
        { at: 66, type: 'text', line: 'c5.impossible', style: 'whisper', speaker: 'classmate', pan: 0.5 },
        { at: 120, type: 'double', spec: { id: 'recessMe', surface: 'recessMirror', source: 'history', delay: 0, ttl: 4 } },   // 镜子里只有爬行的你
        { at: 128, type: 'text', line: 'c5.notInMirror', id: 'notInMirror' },
      ],
    },
    /* 5-7 体育课：塑胶跑道；测一千米；不跑；但我今天有点想试试 */
    {
      id: '5-7', kind: 'run', kit: 'track', variant: 'default', atmosphere: 'overcast', surface: 'rubber',
      beats: 64, stride: 1.0, cadence: 4.6,
      follower: { mode: 'absent' },
      npcs: [
        { id: 'class5', kind: 'classmates', from: 0, to: 64, side: 'L', density: 0.8, gaze: 'none' },
        { id: 'queue5', kind: 'queue', from: 20, to: 50, side: 'R', density: 0.6, gaze: 'none' },
        // 马老师一个人站在跑道左边（不是中道上的障碍）。站立段沿用紧挨着的前一个跑段的组（§10.2），所以他站在 5-8 七步的起点
        // （本段终点 @64）前方 2 m：起身时在画面左前方，第 7 步摔倒时就在身边，「你……在练习走路？」是他说的。
        // WP6 的 specialOfGroup 按组 id 认出马老师（黑色运动裤、两侧白条），集成时补上。
        { id: 'teacherMa', kind: 'lineSides', from: 66, to: 66, side: 'L', density: 1, gaze: 'none' },
      ],
      // 修复单元 A：马老师说话时要在画面里。以前 @2 / @12 说话时他在约 62 m 外的雾里。台词按原文顺序整体后移：前半段爬过跑道边
      // （标志桶、放倒的栏架、最低档栏架、排队同学的腿），走近集合的队伍时他才开口——@40「今天测一千米。」（他在镜头前约 28 m，
      // 低画质雾的可读距离 29 m 以内）→ @46「特殊情况可以申请免试。」（约 22 m）→ @51 陈默「你行吗？」→ @55「不跑。」→
      // @59「但我今天有点想试试。」（字幕两行滚动，每行被挤掉之前都显示完）。
      // 另一个办法（在 5-7 起点附近再放一个马老师组）不行：站立段 5-8 会显示 5-7 的全部组，WP6 的 upper.test 断言了这个清单。
      rows: [
        [8, ['.', '.', 'cone']],                     // 标志桶
        [14, ['.', 'hurdleDown', '.']],              // 放倒的栏架
        [19, ['cone', 'cone', '.']],
        [24, ['legs', '.', '.']],                    // 排队同学的腿（本段只有两处，WP6 的 upper.test 按两处检查）
        [27, ['.', 'hurdle', 'hurdle']],             // 最低档栏架
        [31.5, ['hurdleDown', 'cone', '.']],
        [58, ['legs', '.', '.']],
      ],
      events: [
        { at: 0, type: 'sfx', sfx: 'whistle' },
        { at: 0, type: 'ambience', amb: 'field', level: 1, seconds: 1.5 },
        { at: 12, type: 'hint', hint: 'duck' },
        { at: 40, type: 'text', line: 'c5.test1000', style: 'other', speaker: 'teacherMa' },
        { at: 46, type: 'text', line: 'c5.exempt', style: 'other', speaker: 'teacherMa' },
        { at: 51, type: 'text', line: 'c5.canYou', style: 'other', speaker: 'chenMo' },
        { at: 55, type: 'text', line: 'c5.noRun', style: 'self' },
        { at: 59, type: 'text', line: 'c5.wantTry' },
      ],
    },
    /* 5-8 七步：按住 ↑ 三秒起身；脚自己迈步；第 2 步失衡；第 7 步摔倒（站立段） */
    {
      id: '5-8', kind: 'stand', kit: 'track', variant: 'default', script: 'sevenSteps', atmosphere: 'overcast', duration: 13,
      follower: { mode: 'absent' },
      input: { at: 0.4, hint: 'rise', mode: 'hold', holdSeconds: 3, timeout: 12,   // 8 s 不按再提示一次，12 s 后腿自己站起来
        progress: [{ at: 1, line: 'c5.oneSec' }, { at: 2, line: 'c5.twoSec' }, { at: 3, line: 'c5.threeSec' }],
        onDone: [
          { at: 0.0, type: 'camera', shot: 'standEye', seconds: 1.2 },
          { at: 0.2, type: 'text', line: 'c5.rightFoot', id: 'riseThreeSeconds' },
          { at: 0.6, type: 'hint', hint: 'balance' },
        ] },
      events: [
        { atStep: 2, type: 'text', line: 'c5.almostFell' },                              // 第 2 步必定失衡一次，手撑跑道后稳住
        { atStep: 3, type: 'text', line: 'c5.walking' },
        { atStep: 4, type: 'text', line: 'c5.look', style: 'other', speaker: 'classmate' },
        { atStep: 4, type: 'crowd', group: 'class5', op: 'turnShoes' },                 // 全班都转过来看
        { atStep: 5, type: 'text', line: 'c5.you', style: 'other', speaker: 'chenMo' }, // 陈默停在 3 m 外
        { atStep: 7, type: 'sfx', sfx: 'kneeThud' },
        { atStep: 7, type: 'camera', shot: 'trackSky', seconds: 0.35 },                 // 仰望灰白色、没有云的天
        { atStep: 7, type: 'text', line: 'c5.seventh', id: 'seventhFall' },
        { atStep: 7, delay: 1.6, type: 'text', line: 'c5.practiceQ', style: 'other', speaker: 'teacherMa' },
        { atStep: 7, delay: 3.0, type: 'text', line: 'c5.theyPractice', style: 'self', id: 'theyPractice' },
        { atStep: 7, delay: 4.4, type: 'text', line: 'c5.failed' },                       // 原文紧接着的一段：11.7 s 出字，显示到 12.95 s（段长 13 s）
      ],
    },
    /* 5-9 医务室：走了七步；纸条背面「现在，你后面没有我了。」；枕边的凹陷；它在前面（静场） */
    {
      id: '5-9', kind: 'still', set: 'infirmary', variant: 'bed', atmosphere: 'fluorescent', duration: 14.3,
      follower: { mode: 'absent' },
      events: [
        { at: 0.0, type: 'camera', shot: 'infirmaryBed', seconds: 0 },
        { at: 0.0, type: 'ambience', amb: 'infirmary', level: 1, seconds: 1 },
        { at: 0.3, type: 'text', line: 'c5.orRather' },                                  // 接 5-8 的「我失败了。」（原文下一句）
        { at: 2.5, type: 'text', line: 'c5.walkingQ', style: 'other', speaker: 'chenMo' },
        { at: 3.8, type: 'text', line: 'c5.sevenSteps', style: 'self', id: 'walkedSeven' },
        { at: 5.0, type: 'noteGet', note: 'n5-note' },
        { at: 5.2, type: 'noteOpen', note: 'n5-note', id: 'noteNoMe' },                // 纸条显示 4.8 s（到 10.0 s）
        { at: 5.2, type: 'sfx', sfx: 'paper' },
        { at: 7.2, type: 'hud', op: 'followerFadeOutBehind' },                            // 身后的空心点永久淡出
        // 纸条收起之后才摸枕边的凹陷、出「像有人刚刚坐过。」（以前在纸条还盖在画面上的时候）
        { at: 10.0, type: 'actor', clip: 'touchPillowDent', seconds: 1.6 },
        { at: 10.4, type: 'text', line: 'c5.sat', id: 'pillowDent' },
        { at: 11.2, type: 'overlay', op: 'eyesClosed', seconds: 1.2 },                  // 闭上眼：画面压暗 60%
        { at: 12.2, type: 'follower', def: { mode: 'ahead', steady: 3 } },              // 远处传来轻敲般的三段落地
        { at: 12.2, type: 'hud', op: 'followerFadeInAhead' },
        { at: 12.9, type: 'text', line: 'c5.ahead', id: 'aheadRhythm' },                 // 显示到 14.15 s
      ],
    },
    /* 5-10 握紧：天花板上的裂缝像一只张开的手（静场） */
    {
      id: '5-10', kind: 'still', set: 'infirmary', variant: 'ceiling', atmosphere: 'fluorescent', duration: 5,
      follower: { mode: 'ahead' },
      events: [
        { at: 0.0, type: 'camera', shot: 'ceilingCrack', seconds: 0 },
        { at: 0.3, type: 'text', line: 'c5.openHand' },
        { at: 1.8, type: 'text', line: 'c5.palmParts' },                                  // 每念一个词，空中响一声很轻的掌根、指节、指腹
      ],
      input: { at: 3.4, hint: 'fist', mode: 'hold', holdSeconds: 0.8, timeout: 4, onDone: [
        { at: 0.0, type: 'actor', clip: 'fistAir', seconds: 1.0 },
        { at: 0.2, type: 'text', line: 'c5.fist', id: 'fist' },
      ] },
    },
    /* 5-11 找到它：前方的它，追不上；@208 画面水平翻转，持续到结尾 */
    {
      id: '5-11', kind: 'run', kit: 'corridor', variant: 'void', atmosphere: 'voidDark', surface: 'terrazzo',
      beats: 280, stride: 1.1, cadence: [5.0, 5.4], checkpoints: [140],
      follower: { mode: 'ahead', steady: 3 },
      // 门牌在翻转那一拍还在玩家前方 7.7 m：翻转之后它以反字经过画面（见文件头）
      surfaces: [{ id: 'plate7b', kind: 'doorPlate', side: 'L', from: 214, to: 214, y: [1.3, 1.6], text: '高二（7）班' }],
      rows: [
        // 前四章的回声：课桌、拖把桶、伸出的脚、人腿、倒扣的椅子、书包、推车（第二轮加密：约每 4–5 拍一个动作）
        [16, ['deskBar', 'deskBar', 'deskBar']],     // 课桌
        [20.5, ['.', 'legs', 'legs']],               // 人腿
        [25, ['legs', '.', 'mopBucket']],            // 拖把桶
        [29.5, ['mopBucket', 'footOut', 'mopBucket']],   // 伸出的脚
        [34, ['.', 'legs', 'legs']],
        [38.5, ['chairBar', 'chairBar', 'chairBar']],   // 倒扣的椅子
        [43, ['legs', '.', 'legs']],
        [46, ['.', '.', 'puddle']],                  // 水洼
        [47.5, ['mopBucket', 'mopBucket', 'mopBucket']],
        [52, ['.', 'cart', '.']],                    // 推车
        [56, ['legs', '.', 'legs']],
        [72, ['bag', 'footOut', 'bag']],
        [76, ['.', 'legs', 'cart']],
        [80, ['cart', '.', 'legs']],
        [84, ['longTable', 'longTable', 'longTable']],
        [96, ['bag', '.', '.']],                     // @90 偏移进左道约 1 s 后：不掰正就得多跳一次
        [101, ['legs', 'cart', '.']],
        [105, ['cart', '.', 'legs']],
        [109, ['mopBucket', 'bag', 'mopBucket']],
        [113, ['.', 'legs', 'legs']],
        [117, ['chairBar', 'chairBar', 'chairBar']],
        [121, ['legs', '.', 'cart']],
        [125, ['bag', 'mopBucket', 'bag']],
        [129, ['cart', 'legs', '.']],
        [133, ['deskBar', 'deskBar', 'deskBar']],
        [137, ['legs', '.', 'legs']],
        [156, ['.', 'cart', 'legs']],
        [160, ['legs', '.', 'cart']],
        [164, ['deskBar', 'deskBar', 'deskBar']],
        [174.5, ['mopBucket', 'mopBucket', 'mopBucket']],
        [178, ['legs', 'cart', '.']],
        [181, ['cart', '.', 'legs']],
        [185, ['chairBar', 'chairBar', 'chairBar']],
        [189, ['.', 'legs', 'cart']],
        [193, ['mopBucket', 'mopBucket', 'mopBucket']],
        [197, ['legs', '.', 'legs']],
        [201, ['longTable', 'longTable', 'longTable']],
        // @208 翻转之后是减速的收束（§2.8）：门牌前后不放障碍，之后每 8–12 拍一行
        [220, ['.', '.', 'mopBucket']],
        [228, ['mopBucket', '.', 'longTable']],
        [240, ['.', 'legs', '.']],
        [248, ['bag', 'mopBucket', '.']],
        [256, ['mopBucket', '.', 'longTable']],
      ],
      events: [
        { at: 0, type: 'ambience', amb: 'void', level: 1, seconds: 2 },
        { at: 0, type: 'lights', op: 'palmRings', from: 0, to: 280 },                    // 每一掌在地上激起一圈淡光
        { at: 0, type: 'text', line: 'c5.findIt' },
        { at: 4, type: 'leader', op: 'appear', id: 'leaderAhead' },                      // 它出现在前方的雾里
        { at: 60, type: 'text', line: 'c5.notStanding' },
        { at: 66, type: 'text', line: 'c5.alreadyAhead' },
        { at: 88, type: 'hint', hint: 'straighten' },
        { at: 90, type: 'drift', dir: -1 },                                               // 第四次腿偏移（向左）
        { at: 150, type: 'text', line: ['c5.stillCrawling', 'c5.likeMe'] },             // 原文一句，按原文顺序拆开（附录 A-8）
        { at: 168, type: 'text', line: 'c5.rhythm' },                                     // 上面两行（28 字，3.32 s）显示完之后
        { at: 208, type: 'flip', on: true, id: 'mirrorFlip' },                             // 门牌成了反字，墙和影子换到另一侧
        { at: 260, type: 'leader', op: 'recede' },                                        // 它渐渐走远，光圈一个个淡进雾里
        { at: 270, type: 'slow', speed: 1.8, seconds: 6, ramp: 1.5 },                     // 你减速停下（段在减速里结束，不再加速）
        { at: 276, type: 'overlay', op: 'black', seconds: 1.8 },
      ],
    },
  ],
} satisfies ChapterDef;
