// src/audio/ui.ts —— 界面音（DESIGN.md §6.2「UI：移动：极轻的纸张声（−40 dBFS）；确认：一次指腹触地声（−30 dBFS）」）。WP7。
// 契约里没有界面事件，所以只在菜单类界面（标题、章节、设置、纸条、暂停、失败、结尾、演职）监听键盘与按钮点击；
// 也接受 `window.dispatchEvent(new CustomEvent('hw-ui-sound', { detail: 'move' | 'confirm' }))`（给 WP8 的可选钩子）。
// 键盘在 capture 阶段监听：界面（UI.ts）的 keydown 挂在 window 的冒泡阶段，这里总是先于它看到同一次按键。
// 修复轮 B3：第四章结尾卡等 ↓ ↓ ↓ 时，界面把每一次按键都当作结尾卡的输入（ui/screens/outro.ts 在 window 上发 'hw-ui-await'，
// detail = true / false）。这段时间里方向键、回车、空格都不发「移动」「确认」（以前 ↓ 以外的键照样响）；↓ 只响床单声。
// B3 r2：可交互的卡从出现起就发 true（提示出来之前卡上没有按钮），到输入完成才收回。

/** 一次按键可能被当前界面当作别的输入用掉时的判断（U3）。 */
export interface UiSoundHooks {
  /**
   * 这一键可能被界面用掉吗（第四章结尾卡等输入时，↓ 是床单上的一下，不是菜单里的「移动」）。为 true 时，
   * 「移动」声推迟到这次按键分发完（界面的监听跑过之后）再决定。
   */
  mayConsume?(key: string): boolean;
  /** 只增不减的计数（引擎收到的结尾卡床单声）：这次按键分发期间它变了，说明按键已被用掉，不再发「移动」。 */
  consumed?(): number;
  /** 'hw-ui-await' 说正在等输入时，还要当前屏幕确实是它（缺省 true）：别的屏幕上不会因为一个没收回的标志变哑。 */
  awaitScreen?(): boolean;
}

/** 界面等输入的事件名（与 ui/screens/outro.ts 的 OUTRO_AWAIT_EVENT 相同；声音包不 import 界面包）。 */
export const UI_AWAIT_EVENT = 'hw-ui-await';

export function attachUiSounds(target: Window, play: (k: 'move' | 'confirm') => void, isMenu: () => boolean, hooks: UiSoundHooks = {}): () => void {
  let last = -Infinity;                                               // 第一个音不受去重影响（时钟可能从 0 起）
  const fire = (k: 'move' | 'confirm') => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - last < 40) return;
    last = now;
    play(k);
  };
  const move = (key: string) => {
    if (!hooks.mayConsume?.(key) || !hooks.consumed) { fire('move'); return; }
    const before = hooks.consumed();
    const check = hooks.consumed;
    setTimeout(() => { if (check() === before && isMenu()) fire('move'); }, 0);
  };
  let awaiting = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !isMenu()) return;
    if (awaiting && (hooks.awaitScreen?.() ?? true)) return;          // 这一键是结尾卡的输入，不是菜单操作
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') move(e.key);
    else if (e.key === 'Enter' || e.key === ' ') fire('confirm');
  };
  const onClick = (e: Event) => {
    if (!isMenu()) return;
    const el = e.target as Element | null;
    if (el && typeof el.closest === 'function' && el.closest('button, [role="button"], a')) fire('confirm');
  };
  const onCustom = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (d === 'move' || d === 'confirm') fire(d);
  };
  const onAwait = (e: Event) => { awaiting = (e as CustomEvent).detail === true; };
  target.addEventListener('keydown', onKey, true);
  target.addEventListener('click', onClick);
  target.addEventListener('hw-ui-sound', onCustom);
  target.addEventListener(UI_AWAIT_EVENT, onAwait);
  return () => {
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('click', onClick);
    target.removeEventListener('hw-ui-sound', onCustom);
    target.removeEventListener(UI_AWAIT_EVENT, onAwait);
  };
}
