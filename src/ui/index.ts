// src/ui/index.ts —— 界面包入口（DESIGN.md §7、§8.7）。CORE 写初版（框架），之后归 WP8。
// 注册 UI 与 WP8 负责的 cue：text、hint、count、noteOpen、hud、overlay。
import './styles.css';
import { registerCueHandler, registerUI } from '../core/registry';
import type { LineId } from '../levels/lines';
import { UI } from './UI';

let ui: UI | null = null;
registerUI(() => { ui = new UI(); return ui; });

registerCueHandler('text', 'WP8', (b, c) => {
  if (b.style === 'board') return;                        // 黑板字不进字幕（§7.2）
  const ids = (Array.isArray(b.line) ? b.line : [b.line]) as LineId[];
  ui?.hud.text(ids, b.style ?? 'narration', b.speaker, b.pan ?? 0, c.snap.t);
});
registerCueHandler('hint', 'WP8', (b, c) => ui?.hud.setHint(b.hint, c.snap.t));
registerCueHandler('count', 'WP8', (b, c) => ui?.hud.countStart(b.from, b.to, b.ghostLag ?? 0, c.snap.t));
registerCueHandler('noteOpen', 'WP8', () => { /* 打开纸条（2-9）：WP8 实现翻面 */ });
registerCueHandler('hud', 'WP8', (b) => {
  if (!ui) return;
  if (b.op === 'show' || b.op === 'followerFadeInAhead') ui.hud.showFollower = true;
  if (b.op === 'hide' || b.op === 'followerFadeOutBehind') ui.hud.showFollower = false;
});
registerCueHandler('overlay', 'WP8', (b, c) => ui?.overlay(b.op, b.seconds, c.snap.t));
