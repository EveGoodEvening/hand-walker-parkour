// src/audio/ui.ts —— 界面音（DESIGN.md §6.2「UI：移动：极轻的纸张声（−40 dBFS）；确认：一次指腹触地声（−30 dBFS）」）。WP7。
// 契约里没有界面事件，所以只在菜单类界面（标题、章节、设置、纸条、暂停、失败、结尾、演职）监听键盘与按钮点击；
// 也接受 `window.dispatchEvent(new CustomEvent('hw-ui-sound', { detail: 'move' | 'confirm' }))`（给 WP8 的可选钩子）。
export function attachUiSounds(target: Window, play: (k: 'move' | 'confirm') => void, isMenu: () => boolean): () => void {
  let last = 0;
  const fire = (k: 'move' | 'confirm') => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - last < 40) return;
    last = now;
    play(k);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || !isMenu()) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') fire('move');
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
  target.addEventListener('keydown', onKey);
  target.addEventListener('click', onClick);
  target.addEventListener('hw-ui-sound', onCustom);
  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('click', onClick);
    target.removeEventListener('hw-ui-sound', onCustom);
  };
}
