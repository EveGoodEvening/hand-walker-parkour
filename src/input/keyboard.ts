// src/input/keyboard.ts —— 键盘映射（DESIGN.md §2.2）。CORE 写初版，之后归 WP8。
// ← → / A D：换道；↑ / W / 空格：撑跃（站立段：起身）；↓ / S：伏低、按住；Q：回头；E：让一下；
// Esc / P：暂停；Enter：确认（长按 0.6 s = 跳过，由 Input 计时）；Backspace：返回。
import type { Action } from '../core/types';

export const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyQ: 'look', KeyE: 'ask', Escape: 'pause', KeyP: 'pause', Enter: 'confirm', NumpadEnter: 'confirm', Backspace: 'back',
};

/** KeyboardEvent → 动作（优先 code，退回 key）。 */
export function actionOfKey(code: string, key: string): Action | null {
  const a = KEY_ACTIONS[code];
  if (a) return a;
  const byKey: Record<string, Action> = { ' ': 'up', Left: 'left', Right: 'right', Up: 'up', Down: 'down', Esc: 'pause' };
  return byKey[key] ?? KEY_ACTIONS[key] ?? null;
}
