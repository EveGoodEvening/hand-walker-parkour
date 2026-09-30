// src/levels/lines.ts —— 全部显示文字的唯一来源（DESIGN.md §8.5、§8.6、附录 B）。CORE 写第一章部分，之后归 WP2。
// quote = true 的句子必须与小说原文逐字一致（WP2 的 lint 对照 sourceQuotes 检查）。
// 第一章条目已用脚本对五章原文做过子串检查（见 AGENTS.md Lessons）。
export interface LineEntry { t: string; ch: 1 | 2 | 3 | 4 | 5; quote: boolean }

export const LINES = {
  // ——— 第一章（§8.6）———
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
  'c1.evoFail':     { t: '进化失败', ch: 1, quote: true },
  'c1.habit':       { t: '不是成心的，只是习惯。', ch: 1, quote: true },   // 第一次撞到人腿时的低语字幕（WP8）
  'c2.noteBack':    { t: '你后面。', ch: 2, quote: true },                 // n1-desk 的背面（第二章打开）
  // ——— 失败卡（附录 B.5，按顺序匹配第一条）———
  'fail.dream':     { t: '在梦里，害怕是一种很迟钝的情绪。', ch: 4, quote: true },
  'fail.rubber':    { t: '指节擦过塑胶，留下几道浅白色的痕。', ch: 5, quote: true },
  'fail.rain':      { t: '雨丝落在后颈上，凉得像某种提醒。', ch: 3, quote: true },
  'fail.wet':       { t: '凉意从掌心一直爬到小臂。', ch: 1, quote: true },
  'fail.knee':      { t: '膝盖落地的时候，地面发出一声很闷的响。', ch: 4, quote: true },
} as const satisfies Record<string, LineEntry>;
export type LineId = keyof typeof LINES;

/** 取显示文字；未知 id 返回空串（不抛错，便于占位）。 */
export function lineText(id: string): string {
  return (LINES as Record<string, LineEntry>)[id]?.t ?? '';
}
