// src/ui/strings.ts —— 系统文字（DESIGN.md 附录 B.2、B.4、B.6、B.7）。WP8。
// 只允许这里列出的文字；原文句子一律从 levels/lines.ts 取。拉丁字母只允许键名 Q、E、Enter（B.8）。
// tests/unit/ui/strings.test.ts 按 B.8 的规则逐条检查这里的每一个字符串。
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

/** 章节名（B.4）。test 章只在调试时出现。 */
export const CHAPTER_NAMES: Record<'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5', string> = {
  ch1: '第一章　早自习', ch2: '第二章　午饭', ch3: '第三章　雨夜', ch4: '第四章　广场', ch5: '第五章　七步',
};

/** 说话人小字（B.4）。 */
export const SPEAKERS: Record<Speaker, string> = {
  chenMo: '陈默', englishTeacher: '英语老师', monitor: '班长', directorZhou: '周主任', lunchLady: '阿姨', mathTeacher: '数学老师',
  teacherMa: '马老师', dreamBoy: '男生', classmate: '同学',
};

/**
 * 操作提示（B.2）：[键盘, 触摸]。B.2 表格里的括号是给实现者的注释，按情境取值：
 *   · hold 的触摸：跑段「下滑不松手」，静场「按住屏幕」（HOLD_TOUCH_STILL）；
 *   · straighten 的键盘：显示偏移方向的反方向箭头（STRAIGHTEN_KEY）。
 * anyKey 不在 B.2 表里，取 B.4 失败卡文字的前半句。
 */
export const HINTS: Record<HintId, readonly [string, string]> = {
  jump: ['↑ 撑跃', '上滑 撑跃'], lane: ['← → 换道', '左右滑 换道'], duck: ['↓ 伏低', '下滑 伏低'],
  hold: ['↓ 按住', '下滑不松手'], wet: ['水渍会让手掌打滑', '水渍会让手掌打滑'], look: ['Q 回头', '点「回头」'],
  ask: ['E 让一下', '点「让一下」'], tray: ['端着餐盘：只能换道、伏低', '端着餐盘：只能换道、伏低'],
  wipe: ['↓ 按住 擦掉', '按住屏幕 擦掉'], slap: ['↓ 拍地 亮灯', '下滑 拍地 亮灯'], straighten: ['← / → 掰正', '反方向滑 掰正'],
  rise: ['↑ 按住 站起来', '按住屏幕 站起来'], balance: ['← → 稳住', '按住左半 / 右半屏 稳住'], kneel: ['↓', '下滑'],
  taps3: ['↓ ↓ ↓', '轻点三下'], fist: ['↓ 按住', '按住屏幕'], anyKey: ['按任意键', '轻触'], skip: ['按住 Enter 跳过', '长按「跳过」'],
};
/** hold 在静场里的触摸文字（B.2「静场：按住屏幕」）。 */
export const HOLD_TOUCH_STILL = '按住屏幕';
/** straighten 的键盘文字：偏移向左（dir = −1）时显示 →，向右时显示 ←（B.2「显示偏移方向的反方向箭头」）。 */
export const STRAIGHTEN_KEY: Readonly<Record<-1 | 1, string>> = { [-1]: '→ 掰正', 1: '← 掰正' };
/** 「显示操作提示」关闭后仍然显示的提示（B.2）。 */
export const ALWAYS_HINTS: ReadonlySet<HintId> = new Set(['wet', 'tray']);

/** 取提示文字（按设备与情境）。 */
export function hintText(id: HintId, device: 'keyboard' | 'touch', o: { still?: boolean; driftDir?: -1 | 1 | null } = {}): string {
  if (id === 'hold' && device === 'touch' && o.still) return HOLD_TOUCH_STILL;
  if (id === 'straighten' && device === 'keyboard' && o.driftDir) return STRAIGHTEN_KEY[o.driftDir];
  return HINTS[id][device === 'touch' ? 1 : 0];
}

/** 数数用的中文数字（3-2、3-9；§7.2「数数除外」）。 */
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
export function numZh(n: number): string {
  const k = Math.floor(Math.abs(n));
  if (k < 10) return DIGITS[k] as string;
  if (k < 100) {
    const tens = Math.floor(k / 10), ones = k % 10;
    return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
  }
  return String(k);
}

/** 结尾统计（B.6）：用时 m:ss　摔倒 N　回头 N　纸条 a/b。第四章不显示纸条（调用方传 null）。 */
export function statsLine(timeMs: number, falls: number, lookBacks: number, notes: { got: number; total: number } | null): string {
  const sec = Math.round(timeMs / 1000);
  const m = Math.floor(sec / 60), s = sec % 60;
  const parts = [`用时 ${m}:${String(s).padStart(2, '0')}`, `摔倒 ${falls}`, `回头 ${lookBacks}`];
  if (notes && notes.total > 0) parts.push(notesLine(notes.got, notes.total));
  return parts.join('　');
}
/** 「纸条 a/b」（B.6、§7.2 Chapters）。 */
export function notesLine(got: number, total: number): string { return `${STR.note} ${got}/${total}`; }

/** 全部系统文字（lint 测试用）。 */
export function allStrings(): string[] {
  const out: string[] = [];
  for (const v of Object.values(STR)) { if (typeof v === 'string') out.push(v); else out.push(...v); }
  out.push(...Object.values(CHAPTER_NAMES), ...Object.values(SPEAKERS), HOLD_TOUCH_STILL, ...Object.values(STRAIGHTEN_KEY));
  for (const [k, t] of Object.values(HINTS)) out.push(k, t);
  for (let i = 0; i <= 20; i++) out.push(numZh(i));
  out.push(statsLine(130_000, 0, 1, { got: 2, total: 2 }));
  return out;
}
