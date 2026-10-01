// src/sim/StillPilot.ts —— 静场与站立段的自动输入（perfect 与 human 共用，DESIGN.md §2.2 静场、§3 站起来）。WP1。
// 提示出现 delay 秒之后照做：hold 按住 ↓；tap / any 按一下 ↓；taps3 每 0.3 s 按一下、共三下；
// 七步：按住 ↑ 直到站起；站起后（balance 为真时）按与晃动相反的方向键稳住（只影响画面）。
import type { Action } from '../core/types';
import type { AutopilotView } from './Autopilot';

export type KeyEv = { action: Action; phase: 'down' | 'up' };

/** 静场 / 站立段的自动输入（perfect 与 human 共用；human 传入反应延迟）。 */
export class StillPilot {
  private held = new Set<Action>();
  private tapDone = false;
  private waitSince = -1;
  private taps = 0;
  private lastTapT = -1;

  reset(): void { this.held.clear(); this.tapDone = false; this.waitSince = -1; this.taps = 0; this.lastTapT = -1; }

  /** 返回本 tick 的按键事件，并更新 held（调用方合并）。delay = 提示出现后多久开始动作（秒）。 */
  step(v: AutopilotView, delay: number, out: KeyEv[], balance: boolean): Set<Action> {
    const t = v.tMs() / 1000;
    const kind = v.segKind();
    const st = v.stand();
    const inp = v.stillInput();
    const waiting = v.stillWaiting();
    if (waiting && this.waitSince < 0) this.waitSince = t;
    if (!waiting) { this.waitSince = -1; this.tapDone = false; this.taps = 0; }
    const ready = waiting && t - this.waitSince >= delay - 1e-9;
    const want = new Set<Action>();
    if (kind === 'stand' && st) {
      if (st.script === 'sevenSteps' && (st.phase === 'wait' || st.phase === 'rising') && ready) want.add('up');
      if (balance && st.script === 'sevenSteps' && st.phase === 'walking') {
        if (st.theta > 0.04) want.add('left'); else if (st.theta < -0.04) want.add('right');
      }
    } else if (inp && ready) {
      if (inp.mode === 'hold') want.add('down');
      else if (inp.mode === 'taps3') {
        if (this.taps < 3 && (this.lastTapT < 0 || t - this.lastTapT >= 0.3)) { out.push({ action: 'down', phase: 'down' }, { action: 'down', phase: 'up' }); this.taps++; this.lastTapT = t; }
      } else if (!this.tapDone) { out.push({ action: 'down', phase: 'down' }, { action: 'down', phase: 'up' }); this.tapDone = true; }
    }
    for (const a of this.held) if (!want.has(a)) { out.push({ action: a, phase: 'up' }); this.held.delete(a); }
    for (const a of want) if (!this.held.has(a)) { out.push({ action: a, phase: 'down' }); this.held.add(a); }
    return this.held;
  }
}
