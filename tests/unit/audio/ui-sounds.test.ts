// @vitest-environment happy-dom
// tests/unit/audio/ui-sounds.test.ts —— 修复轮 B3：第四章结尾卡等 ↓ ↓ ↓ 时，别的键不发菜单的「移动」「确认」声。
// 以前只认 ↓（床单声把它「用掉」了）；↑ ← → 照样响「移动」，回车、空格照样响「确认」，可这些键在等输入时什么也不做
// （UI.onKey 把它们交给 OutroScreen.press，被吞掉）。现在结尾卡开始 / 结束等输入时在 window 上发 hw-ui-await，声音包据此静音。
// 计时一律用假时钟（setTimeout、performance.now 都是假的），不依赖机器快慢。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachUiSounds, UI_AWAIT_EVENT } from '../../../src/audio/ui';
import { getChapter } from '../../../src/levels/chapters/index';
import { lineText } from '../../../src/levels/lines';
import { OUTRO_AWAIT_EVENT } from '../../../src/ui/screens/outro';
import { mountUI } from '../ui/helpers';

const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] as const };
afterEach(() => { vi.useRealTimers(); try { localStorage.clear(); } catch { /* ignore */ } });

const key = (k: string, code = k) => new KeyboardEvent('keydown', { key: k, code, bubbles: true });

describe('attachUiSounds: while a screen awaits card input, keys make no menu sound (B3)', () => {
  it('awaiting: arrows, Enter and Space are silent; after it, they sound again; another screen is never muted by a stale flag', () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const t = new EventTarget() as unknown as Window;
    const played: string[] = [];
    let screenIsOutro = true;
    const off = attachUiSounds(t, (k) => played.push(k), () => true, { awaitScreen: () => screenIsOutro });
    const press = (k: string) => { t.dispatchEvent(key(k)); vi.advanceTimersByTime(50); };
    expect(UI_AWAIT_EVENT).toBe(OUTRO_AWAIT_EVENT);
    t.dispatchEvent(new CustomEvent(UI_AWAIT_EVENT, { detail: true }));
    for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'Enter', ' ']) press(k);
    expect(played).toEqual([]);
    screenIsOutro = false;                                   // 标志没收回、却已经在别的屏幕：照常响
    press('ArrowUp');
    expect(played).toEqual(['move']);
    screenIsOutro = true;
    t.dispatchEvent(new CustomEvent(UI_AWAIT_EVENT, { detail: false }));
    press('ArrowUp'); press('Enter');
    expect(played).toEqual(['move', 'move', 'confirm']);
    off();
    press('ArrowUp');
    expect(played.length).toBe(3);
  });
});

describe('real UI + OutroScreen (ch4 outro, ↓ ↓ ↓): the card input is silent apart from the cloth, the menu afterwards is not', () => {
  it('before the hint: menu sounds; while waiting: no move / confirm for any key; after the third ↓: move / confirm again', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const { ui } = await mountUI();
    const played: string[] = [];
    let cloth = 0;
    const off = attachUiSounds(window, (k) => played.push(k), () => true, {
      mayConsume: (k) => k === 'ArrowDown' && ui.screen === 'outro', consumed: () => cloth, awaitScreen: () => ui.screen === 'outro',
    });
    // Game.outroInput → sfx cloth（引擎的 outroTaps）：这里在界面把输入报给 Game 时记一下
    const cmd = (ui as unknown as { cmd: { outroInput?: (id: string | undefined, n: number) => void } }).cmd;
    cmd.outroInput = (_id, n) => { if (n > 0) cloth++; };
    const awaits: boolean[] = [];
    const onAwait = (e: Event) => awaits.push((e as CustomEvent).detail === true);
    window.addEventListener(OUTRO_AWAIT_EVENT, onAwait);
    try {
      const lines = (getChapter('ch4')?.outro.lines ?? []).flatMap((l) => ('line' in l ? [lineText(l.line)] : []));
      ui.show('outro', { chapter: 'ch4', stats: { timeMs: 1000, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, next: 'ch5', lines, notes: null });
      const press = (k: string, code = k) => { window.dispatchEvent(key(k, code)); vi.advanceTimersByTime(60); };
      const hint = document.querySelector('[data-screen="outro"] .hint') as HTMLElement;
      const hintAt = parseFloat(hint.style.animationDelay);
      vi.advanceTimersByTime(hintAt * 1000 + 10);
      expect(awaits).toEqual([true]);
      for (const [k, code] of [['ArrowUp', 'ArrowUp'], ['Enter', 'Enter'], ['ArrowLeft', 'ArrowLeft'], [' ', 'Space'], ['ArrowRight', 'ArrowRight']] as const) press(k, code);
      expect(played).toEqual([]);                                                 // 以前：move, confirm, move, confirm, move
      for (let i = 0; i < 3; i++) press('ArrowDown');
      expect(cloth).toBe(3);
      expect(played).toEqual([]);
      expect(awaits).toEqual([true, false]);                                     // 第三下：等输入结束
      vi.advanceTimersByTime(8000);                                              // 其余两句和按钮出来
      press('ArrowDown'); press('Enter');
      expect(played).toEqual(['move', 'confirm']);
    } finally {
      window.removeEventListener(OUTRO_AWAIT_EVENT, onAwait);
      off();
      ui.show('title');
    }
  });

  it('leaving the outro while it waits (e.g. to the title) clears the await flag', async () => {
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const { ui } = await mountUI();
    const awaits: boolean[] = [];
    const onAwait = (e: Event) => awaits.push((e as CustomEvent).detail === true);
    window.addEventListener(OUTRO_AWAIT_EVENT, onAwait);
    try {
      const lines = (getChapter('ch4')?.outro.lines ?? []).flatMap((l) => ('line' in l ? [lineText(l.line)] : []));
      ui.show('outro', { chapter: 'ch4', stats: { timeMs: 1000, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, next: 'ch5', lines, notes: null });
      vi.advanceTimersByTime(3000);
      expect(awaits).toEqual([true]);
      ui.show('title');
      expect(awaits).toEqual([true, false]);
    } finally { window.removeEventListener(OUTRO_AWAIT_EVENT, onAwait); }
  });
});
