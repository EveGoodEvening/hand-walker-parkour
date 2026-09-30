// src/ui/strings.ts —— 系统文字（DESIGN.md 附录 B.2、B.4、B.6、B.7）。CORE 写初版，之后归 WP8。
// 只允许这里列出的文字；原文句子一律从 levels/lines.ts 取。拉丁字母只允许键名 Q、E、Enter（B.8）。
import type { HintId, Speaker } from '../core/types';

export const STR = {
  title: '手行者', subtitle: '掌根，指节，指腹。',
  start: '开始', continue: '继续', chapters: '章节', settings: '设置', notes: '纸条',
  adapted: '改编自小说《手行者》', firstRun: '建议佩戴耳机。本作含灯光闪烁，可在设置中减弱。',
  locked: '——',
  pause: '暂停', resume: '继续', retry: '从检查点重来', toTitle: '回到标题', slower: '放慢一点',
  failKey: '按任意键，从检查点重来。', failTouch: '轻触，从检查点重来。', again: '再来', back: '返回',
  next: '下一章', replay: '重玩本章',
  note: '纸条', look: '回头', ask: '让一下', skip: '跳过',
  quality: '画质', auto: '自动', low: '低', medium: '中', high: '高',
  master: '主音量', sfx: '音效', ambience: '环境', reducedFlicker: '减少闪烁', reducedMotion: '减少晃动',
  subtitleSize: '字幕大小', normal: '标准', large: '大', metronome: '节拍器', hints: '操作提示', assist: '辅助模式',
  outlines: '显示障碍轮廓', swipe: '滑动灵敏度', vibrate: '震动', autoRetry: '失败后自动重来',
  reset: '清除进度', resetConfirm: '确定清除？', on: '开', off: '关',
  boot: '……',
  credits: ['手行者 · 跑酷', '改编自小说《手行者》', '全部画面与声音均由程序生成。'],
} as const;

/** 章节名（B.4）。 */
export const CHAPTER_NAMES: Record<'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5', string> = {
  ch1: '第一章　早自习', ch2: '第二章　午饭', ch3: '第三章　雨夜', ch4: '第四章　广场', ch5: '第五章　七步',
};

/** 说话人小字（B.4）。 */
export const SPEAKERS: Record<Speaker, string> = {
  chenMo: '陈默', englishTeacher: '英语老师', monitor: '班长', directorZhou: '周主任', lunchLady: '阿姨', mathTeacher: '数学老师',
  teacherMa: '马老师', dreamBoy: '男生', classmate: '同学',
};

/** 操作提示（B.2）：[键盘, 触摸]。 */
export const HINTS: Record<HintId, readonly [string, string]> = {
  jump: ['↑ 撑跃', '上滑 撑跃'], lane: ['← → 换道', '左右滑 换道'], duck: ['↓ 伏低', '下滑 伏低'],
  hold: ['↓ 按住', '按住屏幕'], wet: ['水渍会让手掌打滑', '水渍会让手掌打滑'], look: ['Q 回头', '点「回头」'],
  ask: ['E 让一下', '点「让一下」'], tray: ['端着餐盘：只能换道、伏低', '端着餐盘：只能换道、伏低'],
  wipe: ['↓ 按住 擦掉', '按住屏幕 擦掉'], slap: ['↓ 拍地 亮灯', '下滑 拍地 亮灯'], straighten: ['← / → 掰正', '反方向滑 掰正'],
  rise: ['↑ 按住 站起来', '按住屏幕 站起来'], balance: ['← → 稳住', '按住左半 / 右半屏 稳住'], kneel: ['↓', '下滑'],
  taps3: ['↓ ↓ ↓', '轻点三下'], fist: ['↓ 按住', '按住屏幕'], anyKey: ['按任意键', '轻触'], skip: ['按住 Enter 跳过', '长按「跳过」'],
};
/** 「显示操作提示」关闭后仍然显示的提示（B.2）。 */
export const ALWAYS_HINTS: ReadonlySet<HintId> = new Set(['wet', 'tray']);

/** 结尾统计（B.6）：用时 m:ss　摔倒 N　回头 N　纸条 a/b。 */
export function statsLine(timeMs: number, falls: number, lookBacks: number, notes: { got: number; total: number } | null): string {
  const sec = Math.round(timeMs / 1000);
  const m = Math.floor(sec / 60), s = sec % 60;
  const parts = [`用时 ${m}:${String(s).padStart(2, '0')}`, `摔倒 ${falls}`, `回头 ${lookBacks}`];
  if (notes && notes.total > 0) parts.push(`纸条 ${notes.got}/${notes.total}`);
  return parts.join('　');
}
