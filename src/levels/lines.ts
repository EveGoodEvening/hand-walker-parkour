// src/levels/lines.ts —— 全部显示文字的唯一来源（DESIGN.md §4、§8.5、§8.6、附录 B）。CORE 写第一章部分，之后归 WP2。
// quote = true 的句子与小说原文逐字一致（ch = 出处章节）：tests/unit/content/quotes.test.ts 用 sourceQuotes.ts 做子串检查，
// lint.ts 检查 R14 与附录 B.8（每行 ≤ 24 字、无拉丁字母与 emoji、除「看！」外无感叹号、禁用词、禁止的自创句与禁止引用）。
// 键名约定：c<章>.<名>；fail.* 是失败卡（附录 B.5，Game.failLineId 按条件取）。
// 原文里的对白用 ASCII 双引号（第四章用中文引号），这里一律不带引号：界面按 TextStyle 自动加「“”」（§4.0）。
export interface LineEntry { t: string; ch: 1 | 2 | 3 | 4 | 5; quote: boolean }

export const LINES = {
  // ——— 第一章 · 早自习（§4.1、§8.6）———
  'c1.card':        { t: '早自习的铃声还没响，走廊里已经有人了。', ch: 1, quote: true },
  'c1.leaveClass':  { t: '我把书包甩上肩，双手撑地，出了教室。', ch: 1, quote: true },
  'c1.nickname':    { t: '手行者来了。', ch: 1, quote: true },
  'c1.lastWeek':    { t: '直到上周。', ch: 1, quote: true },
  'c1.cold':        { t: '凉意从掌心一直爬到小臂。', ch: 1, quote: true },
  'c1.inverted':    { t: '一个倒着的人。', ch: 1, quote: true },
  'c1.hey':         { t: '喂。', ch: 1, quote: true },
  'c1.handsQ':      { t: '你手……', ch: 1, quote: true },
  'c1.hurtQ':       { t: '不疼吗？', ch: 1, quote: true },
  'c1.hurtA1':      { t: '疼。', ch: 1, quote: true },
  'c1.hurtA2':      { t: '每天都疼。', ch: 1, quote: true },
  'c1.oldFriend':   { t: '像旧友拍肩。', ch: 1, quote: true },
  'c1.gaze':        { t: '规矩管不住所有的眼睛。', ch: 1, quote: true },
  'c1.washroom':    { t: '我拐进厕所。', ch: 1, quote: true },
  'c1.lateHead':    { t: '镜子里，我的倒影晚了半拍才抬起头。', ch: 1, quote: true },
  'c1.stillDown':   { t: '它还在低头。', ch: 1, quote: true },
  'c1.bell':        { t: '尖锐，像某种警告。', ch: 1, quote: true },
  'c1.feetQ':       { t: '那我的脚，究竟是用来做什么的？', ch: 1, quote: true },
  'c1.note':        { t: '手指触到一团纸。', ch: 1, quote: true },
  'c1.duty':        { t: '今天你值日。', ch: 1, quote: true },
  'c1.footMoved':   { t: '然后我的右脚动了一下。', ch: 1, quote: true },
  'c1.holdIt':      { t: '我伸手按住它。', ch: 1, quote: true },
  'c1.stopped':     { t: '它不动了。', ch: 1, quote: true },
  'c1.waiting':     { t: '它像是一直在等。', ch: 1, quote: true },
  'c1.behind':      { t: '有人从我身后走过。', ch: 1, quote: true },
  'c1.sameSteps':   { t: '掌根、指节、指腹，依次落地。', ch: 1, quote: true },
  'c1.empty':       { t: '走廊空了。', ch: 1, quote: true },
  'c1.shadowProne': { t: '我的影子是趴着的。', ch: 1, quote: true },
  'c1.soundStood':  { t: '而那个刚刚消失的声音，是站着的。', ch: 1, quote: true },
  'c1.iSaw':        { t: '我看见了。', ch: 1, quote: true },
  'c1.noLag':       { t: '它这次没有慢半拍。', ch: 1, quote: true },
  'c1.shush':       { t: '嘘。', ch: 1, quote: true },
  'c1.applause':    { t: '掌心擦过地面的声音很稳，像在给自己鼓掌。', ch: 1, quote: true },
  'c1.out1':        { t: '有些问题问出来就回不去了。', ch: 1, quote: true },
  'c1.out2':        { t: '但我现在已经不想问了。', ch: 1, quote: true },
  'c1.out3':        { t: '我想知道答案。', ch: 1, quote: true },
  'c1.evoFail':     { t: '进化失败', ch: 1, quote: true },                  // n1-a 简笔画旁的字
  'c1.habit':       { t: '不是成心的，只是习惯。', ch: 1, quote: true },   // 第一次撞到人腿时的低语字幕（WP8，附录 B.5）

  // ——— 第二章 · 午饭（§4.2）———
  'c2.card1':       { t: '午饭铃比早自习铃更长，', ch: 2, quote: true },   // 原文一句，拆成两行显示
  'c2.card2':       { t: '像一把钝锯在空气里来回拉扯。', ch: 2, quote: true },
  'c2.spine':       { t: '一节一节，像某种被拆开的脊椎。', ch: 2, quote: true },
  'c2.forest':      { t: '椅子腿、人腿、桌腿，从四面八方围过来。', ch: 2, quote: true },
  'c2.excuse':      { t: '让一下。', ch: 2, quote: true },                 // 按 E「让一下」时（WP8，self）
  'c2.dirty':       { t: '他每天都这样，不脏吗？', ch: 2, quote: true },   // 让一下之后 0.8 s 的低语（WP8，whisper）
  'c2.counter':     { t: '我爬到窗口前，站起来取餐。', ch: 2, quote: true },
  'c2.eatMore':     { t: '多吃点。', ch: 2, quote: true },
  'c2.compensate':  { t: '那多出来的一勺不是善意，是补偿。', ch: 2, quote: true },
  'c2.collar':      { t: '像一枚温热的印章。', ch: 2, quote: true },
  'c2.sits':        { t: '它坐在椅子上。', ch: 2, quote: true },
  'c2.curled':      { t: '而我正把腿蜷在椅子下面。', ch: 2, quote: true },
  'c2.iron':        { t: '像被人用熨斗轻轻贴了一下。', ch: 2, quote: true },
  'c2.lookingAt':   { t: '看什么呢？', ch: 2, quote: true },
  'c2.myself':      { t: '看自己。', ch: 2, quote: true },
  'c2.faster':      { t: '玻璃里的它走得比我快。', ch: 2, quote: true },
  'c2.sameRoute':   { t: '像有人在更远的地方跟我走同样的路线。', ch: 2, quote: true },
  'c2.iStop':       { t: '我停下来。', ch: 2, quote: true },
  'c2.echoStops':   { t: '回声也停下来。', ch: 2, quote: true },
  'c2.iStep':       { t: '我往前一步。', ch: 2, quote: true },
  'c2.echoSteps':   { t: '回声也往前一步。', ch: 2, quote: true },
  'c2.notEcho':     { t: '不是回音。', ch: 2, quote: true },
  'c2.echoRule':    { t: '回音不会在我停的时候停。', ch: 2, quote: true },
  'c2.dont':        { t: '别。', ch: 2, quote: true },                     // 2-8 第一次压住腿时的低语（twitch.say）
  'c2.blank':       { t: '空白。', ch: 2, quote: true },
  'c2.noteBack':    { t: '你后面。', ch: 2, quote: true },                 // n1-desk 的背面（第二章打开）
  'c2.extraHand':   { t: '它多了一只手。', ch: 2, quote: true },
  'c2.whyNotStand': { t: '你为什么不站起来？', ch: 2, quote: true },       // 黑板字（board）
  'c2.cantStand':   { t: '因为我站不起来。', ch: 2, quote: true },         // 他擦掉问题后自己写的黑板字（board）
  'c2.lying':       { t: '我在撒谎。', ch: 2, quote: true },
  'c2.whatTell':    { t: '你想告诉我什么？', ch: 2, quote: true },
  'c2.approach':    { t: '它正在靠近。', ch: 2, quote: true },
  'c2.out1':        { t: '我没有回头。', ch: 2, quote: true },
  'c2.out2':        { t: '像有人在空房间里鼓掌。', ch: 2, quote: true },

  // ——— 第三章 · 雨夜（§4.3）———
  'c3.card':        { t: '晚自习的灯是一盏一盏灭的。', ch: 3, quote: true },
  'c3.lightsOff':   { t: '我关灯了。', ch: 3, quote: true },
  'c3.mm':          { t: '嗯。', ch: 3, quote: true },
  'c3.anotherSteps':{ t: '然后走廊里响起另一串脚步声。', ch: 3, quote: true },
  'c3.noLookYet':   { t: '我没有立刻回头看。', ch: 3, quote: true },
  'c3.noPatience':  { t: '回音没有耐心，不会等我。', ch: 3, quote: true },
  'c3.countingToo': { t: '身后的脚步声也在数台阶。', ch: 3, quote: true },
  'c3.oneBeatLate': { t: '但比我慢一拍。', ch: 3, quote: true },
  'c3.halfFlight':  { t: '我们之间隔着半层楼梯，像隔着一层很薄的玻璃。', ch: 3, quote: true },
  'c3.notBack':     { t: '还没回？', ch: 3, quote: true },
  'c3.leaving':     { t: '这就走。', ch: 3, quote: true },
  'c3.safe':        { t: '路上注意安全。', ch: 3, quote: true },
  'c3.strange':     { t: '这天也怪。', ch: 3, quote: true },
  'c3.rain':        { t: '下雨了。', ch: 3, quote: true },
  'c3.goldPieces':  { t: '路灯倒在里面，碎成一块一块的金色。', ch: 3, quote: true },
  'c3.notCovered':  { t: '但今天它没有盖。', ch: 3, quote: true },
  'c3.iStop':       { t: '我停下来。', ch: 3, quote: true },
  'c3.itStops':     { t: '它也停下来。', ch: 3, quote: true },
  'c3.noLift':      { t: '水洼里的影子没有抬。', ch: 3, quote: true },
  'c3.standsUp':    { t: '然后它慢慢地、慢慢地站了起来。', ch: 3, quote: true },
  'c3.shush':       { t: '嘘。', ch: 3, quote: true },
  'c3.notMe':       { t: '那不是我。', ch: 3, quote: true },
  'c3.tap':         { t: '笃。', ch: 3, quote: true },
  'c3.closer':      { t: '这次它离得更近了。', ch: 3, quote: true },
  'c3.fingersDown': { t: '五根手指朝着地面，像要撑住什么。', ch: 3, quote: true },
  'c3.useless':     { t: '我已经知道回头没用。', ch: 3, quote: true },
  'c3.notBehind':   { t: '它不在我身后。', ch: 3, quote: true },
  'c3.reflective':  { t: '它在所有能反光的地方，', ch: 3, quote: true },     // 原文后面是逗号
  'c3.shouldStand': { t: '在所有我本该站起来却没有站起来的地方。', ch: 3, quote: true },
  'c3.wound':       { t: '像一道浅浅的伤口。', ch: 3, quote: true },
  'c3.soundLight':  { t: '楼道里的灯是声控的。', ch: 3, quote: true },
  'c3.twelveSteps': { t: '客厅到卫生间的距离是十二步——', ch: 3, quote: true },
  'c3.twelvePalms': { t: '不，十二掌。', ch: 3, quote: true },
  'c3.noOne':       { t: '镜子里没有人。', ch: 3, quote: true },
  'c3.wantStand':   { t: '你想让我站起来？', ch: 3, quote: true },
  'c3.afterStand':  { t: '站起来之后呢？', ch: 3, quote: true },
  'c3.doorClosed':  { t: '门关上了。', ch: 3, quote: true },
  'c3.out1':        { t: '它们在练习。', ch: 3, quote: true },
  'c3.out2':        { t: '它在等我。', ch: 3, quote: true },
  'c3.out3':        { t: '而我，第一次想要回头。', ch: 3, quote: true },

  // ——— 第四章 · 广场（§4.4）。原文两句混入英文的句子禁止引用（附录 B.8）———
  'c4.card':        { t: '我睡着的时候，脚还在抖。', ch: 4, quote: true },
  'c4.fast':        { t: '我很快。', ch: 4, quote: true },
  'c4.muchFaster':  { t: '不是快一点。是快很多。', ch: 4, quote: true },
  'c4.soFast':      { t: '好快。', ch: 4, quote: true },
  'c4.how':         { t: '他怎么做到的。', ch: 4, quote: true },
  'c4.wantRun':     { t: '我也想那样跑。', ch: 4, quote: true },
  'c4.teachMe':     { t: '你能教我吗？', ch: 4, quote: true },
  'c4.again':       { t: '再来一次。', ch: 4, quote: true },
  'c4.iStand':      { t: '我站起来。', ch: 4, quote: true },
  'c4.easy':        { t: '在梦里，站起来很容易。', ch: 4, quote: true },
  'c4.overtaken':   { t: '有人超过了我。', ch: 4, quote: true },
  'c4.otherWay':    { t: '它选择了另一个方向。', ch: 4, quote: true },
  'c4.tired':       { t: '在梦里站着，比在现实里用手走路更累。', ch: 4, quote: true },
  'c4.handsLimp':   { t: '我的手垂在身侧，不听使唤。', ch: 4, quote: true },   // 4-3 按 ↓ 时显示一次（WP1 Stand）
  'c4.eye':         { t: '掌心里有一只眼睛。', ch: 4, quote: true },
  'c4.envyRun':     { t: '你跑的时候，他们羡慕你。', ch: 4, quote: true },
  'c4.overtake':    { t: '你站起来，他们超过你。', ch: 4, quote: true },
  'c4.choose':      { t: '你想选哪一个？', ch: 4, quote: true },
  'c4.dontStand':   { t: '别站着。', ch: 4, quote: true },
  'c4.run':         { t: '跑。', ch: 4, quote: true },
  'c4.kneel':       { t: '我跪下去。', ch: 4, quote: true },
  'c4.follows':     { t: '身后的脚步声跟着我了。', ch: 4, quote: true },
  'c4.notChasing':  { t: '但它不是追上来的。', ch: 4, quote: true },
  'c4.sameSpeed':   { t: '我快，它快；我慢，它慢。', ch: 4, quote: true },
  'c4.passMirror':  { t: '我跑过那面镜子，没有看。', ch: 4, quote: true },
  'c4.inSync':      { t: '我们终于跑成了一样的速度。', ch: 4, quote: true },
  'c4.end':         { t: '广场突然到了尽头。', ch: 4, quote: true },
  'c4.envyBoth':    { t: '你羡慕他们站起来。他们羡慕你跑得快。', ch: 4, quote: true },
  'c4.wantWhat':    { t: '你到底想要什么？', ch: 4, quote: true },
  'c4.i':           { t: '我——', ch: 4, quote: true },
  'c4.out1':        { t: '羡慕和歧视，有时候是同一件事，只是换了一个表情。', ch: 4, quote: true },
  'c4.out2':        { t: '它不像鼓掌。', ch: 4, quote: true },
  'c4.out3':        { t: '像某种练习。', ch: 4, quote: true },

  // ——— 第五章 · 七步（§4.5）———
  'c5.card':        { t: '我醒的时候，闹钟还没响。', ch: 5, quote: true },
  'c5.feetMoved':   { t: '我的脚在被子里动了一下。', ch: 5, quote: true },
  'c5.enough':      { t: '够了。', ch: 5, quote: true },
  'c5.didntListen': { t: '它们没听。', ch: 5, quote: true },
  'c5.relaxed':     { t: '过了几秒，它终于放松。', ch: 5, quote: true },
  'c5.hesitant':    { t: '它的反应比往常慢半拍，', ch: 5, quote: true },
  'c5.seeMe':       { t: '像在犹豫要不要看见我。', ch: 5, quote: true },
  'c5.noFollow':    { t: '身后的脚步声没有跟上来。', ch: 5, quote: true },
  'c5.reversed':    { t: '它是反的。', ch: 5, quote: true },
  'c5.crawls':      { t: '然后它开始往前爬。', ch: 5, quote: true },
  'c5.towardMe':    { t: '朝我爬过来。', ch: 5, quote: true },
  'c5.twoMeters':   { t: '影子在我身后两米处。', ch: 5, quote: true },
  'c5.faster':      { t: '它比我快。', ch: 5, quote: true },
  'c5.startRun':    { t: '我开始跑。', ch: 5, quote: true },
  'c5.gone':        { t: '影子不见了。', ch: 5, quote: true },
  'c5.tenDegrees':  { t: '鞋尖向左偏了十度。', ch: 5, quote: true },
  'c5.straighten':  { t: '我伸手把它掰正。', ch: 5, quote: true },         // 第一次掰正时（drift.say）
  'c5.anotherStands':{ t: '但它后面，站着另一个人。', ch: 5, quote: true },
  'c5.noOneBehind': { t: '身后没有人。', ch: 5, quote: true },
  'c5.sleeve':      { t: '我用袖子擦了擦脸，没有擦镜子。', ch: 5, quote: true },
  'c5.youAnswer':   { t: '你来回答。', ch: 5, quote: true },
  'c5.whichQ':      { t: '第几题？', ch: 5, quote: true },
  'c5.example3':    { t: '例题三。', ch: 5, quote: true },
  'c5.silence':     { t: '全班都安静了一秒。', ch: 5, quote: true },
  'c5.who':         { t: '那是谁？', ch: 5, quote: true },
  'c5.seemsLike':   { t: '好像是……', ch: 5, quote: true },
  'c5.myFace':      { t: '是我的脸。', ch: 5, quote: true },
  'c5.wind':        { t: '它走路带起的风擦过我的耳廓，凉凉的。', ch: 5, quote: true },
  'c5.twins':       { t: '那是双胞胎吗？', ch: 5, quote: true },
  'c5.impossible':  { t: '不可能……', ch: 5, quote: true },
  'c5.notInMirror': { t: '那个站着的影子，已经不在镜子里了。', ch: 5, quote: true },
  'c5.test1000':    { t: '今天测一千米。', ch: 5, quote: true },
  'c5.exempt':      { t: '特殊情况可以申请免试。', ch: 5, quote: true },
  'c5.canYou':      { t: '你行吗？', ch: 5, quote: true },
  'c5.noRun':       { t: '不跑。', ch: 5, quote: true },
  'c5.wantTry':     { t: '但我今天有点想试试。', ch: 5, quote: true },
  'c5.oneSec':      { t: '我站起来了一秒。', ch: 5, quote: true },
  'c5.twoSec':      { t: '两秒。', ch: 5, quote: true },
  'c5.threeSec':    { t: '三秒。', ch: 5, quote: true },
  'c5.rightFoot':   { t: '然后右脚动了。', ch: 5, quote: true },
  'c5.almostFell':  { t: '我差点摔倒。', ch: 5, quote: true },
  'c5.walking':     { t: '我在走路。', ch: 5, quote: true },
  'c5.look':        { t: '看！', ch: 5, quote: true },                     // 全作唯一允许的感叹号（R14）
  'c5.you':         { t: '你……', ch: 5, quote: true },
  'c5.seventh':     { t: '第七步的时候，我摔倒了。', ch: 5, quote: true },
  'c5.practiceQ':   { t: '你……在练习走路？', ch: 5, quote: true },
  'c5.theyPractice':{ t: '不是。是它们在练习。', ch: 5, quote: true },
  'c5.walkingQ':    { t: '你刚才……在走路？', ch: 5, quote: true },
  'c5.sevenSteps':  { t: '走了七步。', ch: 5, quote: true },               // 是「我」回答陈默
  'c5.noteBack':    { t: '现在，你后面没有我了。', ch: 5, quote: true },   // n5-note 的背面
  'c5.sat':         { t: '像有人刚刚坐过。', ch: 5, quote: true },
  'c5.ahead':       { t: '它在前面。', ch: 5, quote: true },
  'c5.openHand':    { t: '我伸出右手，在空中张开五指。', ch: 5, quote: true },
  'c5.palmParts':   { t: '掌根，指节，指腹。', ch: 5, quote: true },
  'c5.fist':        { t: '我握紧。', ch: 5, quote: true },
  'c5.findIt':      { t: '从今晚开始，我要找到它。', ch: 5, quote: true },
  'c5.notStanding': { t: '不是那个站着的影子。', ch: 5, quote: true },
  'c5.alreadyAhead':{ t: '它已经在往前走了。', ch: 5, quote: true },
  'c5.stillCrawling':{ t: '我要找到那个还在爬行的影子，', ch: 5, quote: true },
  'c5.rhythm':      { t: '用掌根指节指腹敲出节奏的影子。', ch: 5, quote: true },
  'c5.out1':        { t: '因为它可能是真正的我。', ch: 5, quote: true },
  'c5.out2':        { t: '而我，只是它的倒影。', ch: 5, quote: true },

  // ——— 失败卡（附录 B.5，按顺序匹配第一条）———
  'fail.dream':     { t: '在梦里，害怕是一种很迟钝的情绪。', ch: 4, quote: true },
  'fail.rubber':    { t: '指节擦过塑胶，留下几道浅白色的痕。', ch: 5, quote: true },
  'fail.rain':      { t: '雨丝落在后颈上，凉得像某种提醒。', ch: 3, quote: true },
  'fail.wet':       { t: '凉意从掌心一直爬到小臂。', ch: 1, quote: true },
  'fail.knee':      { t: '膝盖落地的时候，地面发出一声很闷的响。', ch: 4, quote: true },
} as const satisfies Record<string, LineEntry>;
export type LineId = keyof typeof LINES;

/**
 * 不挂在章节数据上、由代码按事件取用的台词（WP1 / WP8 按键名取，不要写死文字）。
 * lint 把这些算作「已引用」。
 */
export const LINE_HOOKS = {
  firstLegHit: 'c1.habit',        // hit.firstLegHit 后 1 s 的低语，全作一次（附录 B.5，WP8）
  askSelf: 'c2.excuse',           // 按 E「让一下」（§3、§4.2 2-2，WP8，style self）
  askWhisper: 'c2.dirty',         // 让一下 0.8 s 后的低语，外加一声短笑（WP8 whisper，WP7 laughShort）
  dreamDownPress: 'c4.handsLimp', // 4-3 梦中站立时按 ↓，显示一次（WP1 Stand → WP8）
} as const satisfies Record<string, LineId>;

/** 取显示文字；未知 id 返回空串（不抛错，便于占位）。 */
export function lineText(id: string): string {
  return (LINES as Record<string, LineEntry>)[id]?.t ?? '';
}
