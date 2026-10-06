// src/input/keyboard.ts —— 键盘映射（DESIGN.md §2.2）。WP8。
// ← → / A D：换道；↑ / W / 空格：撑跃（站立段：起身）；↓ / S：伏低、按住；Q：回头；E：让一下；
// Esc / P：暂停；Enter：确认（长按 0.6 s = 跳过，由 UI 计时）；Backspace：返回。
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

const NOT_ANY = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Tab', 'ContextMenu',
  'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock', 'Dead', 'Unidentified', 'Process',
  'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'PrintScreen']);
/**
 * 「按任意键」算不算这个键（§7.2 开场卡、失败卡）：修饰键、Tab、F1–F12 这类不算，
 * 否则 Alt-Tab 切窗口、F5 刷新都会被当成「跳过」。
 */
export function countsAsAnyKey(key: string, code = ''): boolean {
  if (NOT_ANY.has(key)) return false;
  if (/^F\d{1,2}$/.test(key) || /^F\d{1,2}$/.test(code)) return false;
  return true;
}
