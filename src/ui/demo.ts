// src/ui/demo.ts —— HUD 版面演示（调试扩展 __game.ext.hudDemo，只在 ?test=1 / ?debug= 下可用）。WP8。
// 把 HUD 的每一个元素都填上最长的内容：两行最长的字幕（其中一行是贴边的低语、一行带说话人）、最长的提示、数数加残影、
// 平衡线、纸条闪现、纸条翻看、空心点（右上方最远）、情境按钮。e2e-touch 的版面检查和 WP8 的截图清单用它确认
// 360×640 与 1920×1080 下没有横向滚动条、HUD 与字幕互不重叠（§8.10 WP8 验收 3）。
import { LINES, type LineEntry } from '../levels/lines';
import { Input } from '../input/Input';
import { noteDef } from './screens/notes';
import type { UI } from './UI';

/** LINES 里最长的 n 句（按字数）。 */
function longest(n: number): string[] {
  return Object.entries(LINES as Record<string, LineEntry>).filter(([k]) => !k.startsWith('fail.'))
    .sort((a, b) => Array.from(b[1].t).length - Array.from(a[1].t).length).slice(0, n).map(([k]) => k);
}

export function hudDemo(ui: UI, mode: string): void {
  const st = (ui as unknown as { snap: { t: number } | null }).snap;
  const t = st?.t ?? 0;
  const hud = ui.hud;
  hud.reset();
  const [a, b] = longest(2);
  hud.text([a as string], 'other', 'englishTeacher', 0, t);
  hud.text([b as string], mode === 'center' ? 'narration' : 'whisper', undefined, -0.6, t);
  for (const l of hud.subs.lines) l.until = t + 999;
  hud.subs.version++;
  hud.showHint('balance', 'still', t, 999);
  hud.countStart(1, 4, 1, t); hud.countTick(t); hud.countTick(t);
  const c = hud as unknown as { count: { until: number } | null };
  if (c.count) c.count.until = t + 999;
  hud.forceBalance = 0.2;
  hud.noteFlash(t, 999);
  if (mode !== 'noCard') hud.openNote('n1-a', noteDef('n1-a'), t);
  const inp = Input.active;
  if (inp) { inp.hooks.ask = true; inp.setContext({ ...inp.context, kind: 'run' }); }
}
