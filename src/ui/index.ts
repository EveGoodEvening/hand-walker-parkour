// src/ui/index.ts —— 界面包入口（DESIGN.md §7、§8.7）。WP8。
// 注册 UI 与 WP8 负责的 cue：text、hint、count、noteOpen、hud、overlay；另注册几个只在 ?test=1 / ?debug= 下可用的调试扩展
// （__game.ext.ui / hudDemo / uiScreen），供 e2e-touch 的版面检查和 tests/visual/WP8.json 的截图使用。
import './styles.css';
import { registerCueHandler, registerDebug, registerUI } from '../core/registry';
import type { ScreenName } from '../core/types';
import { urlParams } from '../core/urlParams';
import { Input } from '../input/Input';
import { UI } from './UI';
import { hudDemo } from './demo';

let ui: UI | null = null;
registerUI(() => { ui = new UI(); return ui; });

registerCueHandler('text', 'WP8', (b, c) => ui?.cueText(b, c.snap));
registerCueHandler('hint', 'WP8', (b, c) => ui?.cueHint(b, c));
registerCueHandler('count', 'WP8', (b, c) => ui?.cueCount(b, c.snap));
registerCueHandler('noteOpen', 'WP8', (b, c) => ui?.cueNoteOpen(b, c.snap));
registerCueHandler('hud', 'WP8', (b) => ui?.cueHud(b));
registerCueHandler('overlay', 'WP8', (b, c) => ui?.cueOverlay(b, c.snap));

const guard = () => { if (!urlParams().debugEnabled) throw new Error('debug disabled'); };
registerDebug('ui', () => ui?.debugState() ?? null);
registerDebug('hudDemo', (...a: unknown[]) => { guard(); if (ui) hudDemo(ui, (a[0] as string | undefined) ?? 'full'); return ui?.debugState() ?? null; });
registerDebug('uiSeed', (...a: unknown[]) => { guard(); ui?.seed((a[0] ?? {}) as Parameters<UI['seed']>[0]); return true; });
registerDebug('uiFlip', (...a: unknown[]) => {
  guard();
  const on = a[0] !== false;
  if (ui) ui.forceFlip = on;
  if (Input.active) Input.active.debugFlip = on;          // 画面和输入一起翻（§2.2）
  return ui?.forceFlip ?? null;
});
registerDebug('uiScreen', (...a: unknown[]) => { guard(); ui?.show(a[0] as ScreenName, a[1]); return ui?.screen ?? null; });
