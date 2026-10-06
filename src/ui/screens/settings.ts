// src/ui/screens/settings.ts —— 设置界面（DESIGN.md §7.3，文字见附录 B.4）。WP8。
// 每一行一个按钮：点一下（或回车）切到下一个值；键盘 ← → 在当前行里往前 / 往后改。音量 0–100，每步 10。
// 改值立即生效并存盘（Game.setSetting → storeSettings，try/catch）；值变化后原地更新文字，不重建界面，焦点不丢。
// 「清除进度」需要二次确认：第一次按显示「确定清除？」，再按一次才清除。
import type { Settings } from '../../core/settings';
import { button, h } from '../dom';
import { STR } from '../strings';

type Key = keyof Settings;
interface RowDef { key: Key | 'reset'; label: string; values?: readonly unknown[]; show(s: Settings): string }

const onOff = (v: unknown) => (v ? STR.on : STR.off);
const VOL = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const QUALITY = ['auto', 'low', 'medium', 'high'] as const;
const Q_NAME: Record<(typeof QUALITY)[number], string> = { auto: STR.auto, low: STR.low, medium: STR.medium, high: STR.high };
const SWIPE = ['low', 'mid', 'high'] as const;
const SW_NAME: Record<(typeof SWIPE)[number], string> = { low: STR.low, mid: STR.medium, high: STR.high };
const BOOL = [false, true] as const;

export const SETTING_ROWS: readonly RowDef[] = [
  { key: 'quality', label: STR.quality, values: QUALITY, show: (s) => Q_NAME[s.quality] },
  { key: 'master', label: STR.master, values: VOL, show: (s) => String(s.master) },
  { key: 'sfx', label: STR.sfx, values: VOL, show: (s) => String(s.sfx) },
  { key: 'ambience', label: STR.ambience, values: VOL, show: (s) => String(s.ambience) },
  { key: 'reducedFlicker', label: STR.reducedFlicker, values: BOOL, show: (s) => onOff(s.reducedFlicker) },
  { key: 'reducedMotion', label: STR.reducedMotion, values: BOOL, show: (s) => onOff(s.reducedMotion) },
  { key: 'subtitleSize', label: STR.subtitleSize, values: ['normal', 'large'], show: (s) => (s.subtitleSize === 'large' ? STR.large : STR.normal) },
  { key: 'metronome', label: STR.metronome, values: BOOL, show: (s) => onOff(s.metronome) },
  { key: 'hints', label: STR.hints, values: BOOL, show: (s) => onOff(s.hints) },
  { key: 'assist', label: STR.assist, values: BOOL, show: (s) => onOff(s.assist) },
  { key: 'outlines', label: STR.outlines, values: BOOL, show: (s) => onOff(s.outlines) },
  { key: 'swipe', label: STR.swipe, values: SWIPE, show: (s) => SW_NAME[s.swipe] },
  { key: 'vibrate', label: STR.vibrate, values: BOOL, show: (s) => onOff(s.vibrate) },
  { key: 'autoRetry', label: STR.autoRetry, values: BOOL, show: (s) => onOff(s.autoRetry) },
  { key: 'reset', label: STR.reset, show: () => STR.reset },
];

/** 某一行往前 / 往后一格的值（音量到头不绕回；其余循环）。 */
export function stepValue(row: RowDef, s: Settings, dir: 1 | -1): unknown {
  const vals = row.values;
  if (!vals || row.key === 'reset') return undefined;
  const cur = s[row.key as Key] as unknown;
  let i = vals.indexOf(cur as never);
  if (i < 0 && typeof cur === 'number') i = Math.round(cur / 10);
  const isVol = row.key === 'master' || row.key === 'sfx' || row.key === 'ambience';
  if (isVol) return vals[Math.max(0, Math.min(vals.length - 1, i + dir))];
  return vals[(i + dir + vals.length) % vals.length];
}

export interface SettingsActions { set<K extends Key>(k: K, v: Settings[K]): void; reset(): void; back(): void }

export class SettingsScreen {
  private values = new Map<string, HTMLButtonElement>();
  private confirm = false;
  private s: Settings | null = null;
  constructor(private el: HTMLElement, private a: SettingsActions) {}

  build(s: Settings): void {
    this.s = { ...s };
    this.confirm = false;
    this.el.replaceChildren();
    this.values.clear();
    h('div', 'hw-h', STR.settings, this.el);
    const box = h('div', 'hw-settings hw-menu', undefined, this.el);
    for (const row of SETTING_ROWS) {
      const r = h('div', `hw-row${row.key === 'reset' ? ' hw-reset' : ''}`, undefined, box);
      r.setAttribute('data-key', row.key);
      if (row.key !== 'reset') h('span', 'k', row.label, r);
      const b = button(row.key === 'reset' ? STR.reset : row.show(s), () => this.activate(row, 1), r);
      b.classList.add('v');
      b.setAttribute('data-key', row.key);
      this.values.set(row.key, b);
    }
    const back = button(STR.back, () => { this.confirm = false; this.a.back(); }, box);
    back.classList.add('hw-back');
  }

  /** 设置变化（来自 Game 的 settings 事件）：原地更新文字。 */
  update(s: Settings): void {
    this.s = { ...s };
    for (const row of SETTING_ROWS) {
      const b = this.values.get(row.key);
      if (!b) continue;
      const v = row.key === 'reset' ? (this.confirm ? STR.resetConfirm : STR.reset) : row.show(s);
      if (b.textContent !== v) b.textContent = v;
    }
  }

  /** 键盘 ← →：改当前焦点所在行。返回是否处理了。 */
  adjustFocused(dir: 1 | -1): boolean {
    const key = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-key');
    const row = SETTING_ROWS.find((r) => r.key === key);
    if (!row || row.key === 'reset') return false;
    this.activate(row, dir);
    return true;
  }

  private activate(row: RowDef, dir: 1 | -1): void {
    const s = this.s;
    if (!s) return;
    if (row.key === 'reset') {
      if (this.confirm) { this.confirm = false; this.a.reset(); } else this.confirm = true;
      this.update(s);
      return;
    }
    const v = stepValue(row, s, dir);
    if (v === undefined) return;
    this.a.set(row.key, v as never);
    (s as unknown as Record<string, unknown>)[row.key] = v;
    this.update(s);
  }

  get confirming(): boolean { return this.confirm; }
}
