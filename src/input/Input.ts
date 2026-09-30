// src/input/Input.ts —— 输入汇总（DESIGN.md §2.2、§8.4 InputAPI）。CORE 写初版，之后归 WP8。
// 键盘 + 触摸 → InputEvent 队列（t = 意图时刻，performance.now() 时间轴）与按住集合。
// 情境按钮「回头」「让一下」的最简 DOM：只在可用时出现（右下角 64 px）。画面翻转时左右互换（§2.2）。
import type { InputAPI } from '../core/contracts';
import { SWIPE_PX } from '../core/settings';
import type { Action, Device, InputEvent } from '../core/types';
import { DEFAULT_SWIPE } from './gestures';
import { actionOfKey } from './keyboard';
import { TouchInput } from './touch';

type Ctx = { kind: 'run' | 'still' | 'stand' | 'menu'; look: boolean; ask: boolean; standHalves: boolean };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Input implements InputAPI {
  private queue: InputEvent[] = [];
  private readonly heldSet = new Set<Action>();
  private dev: Device = 'keyboard';
  private ctx: Ctx = { kind: 'menu', look: false, ask: false, standHalves: false };
  private flip = false;
  private btn: HTMLButtonElement | null = null;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private touch: TouchInput | null = null;
  /** 最近一次物理输入（任意键 / 触摸）的时刻，UI 用来切换提示文字。 */
  lastAny = 0;

  attach(el: HTMLElement): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => this.onKey(e, 'down'));
    window.addEventListener('keyup', (e) => this.onKey(e, 'up'));
    window.addEventListener('blur', () => this.releaseAll());
    this.touch = new TouchInput({
      press: (a, t) => this.push(a, 'down', t, 'touch'),
      release: (a, t) => this.push(a, 'up', t, 'touch'),
      context: () => ({ kind: this.ctx.kind, standHalves: this.ctx.standHalves }),
    }, DEFAULT_SWIPE);
    this.touch.attach(el);
    el.style.touchAction = 'none';
    const btn = document.createElement('button');
    btn.className = 'hw-context-btn';
    btn.type = 'button';
    btn.setAttribute('data-ui-control', '1');
    btn.style.display = 'none';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const a: Action = this.ctx.look ? 'look' : 'ask';
      this.push(a, 'down', e.timeStamp, e.pointerType === 'mouse' ? 'keyboard' : 'touch');
      this.push(a, 'up', e.timeStamp, e.pointerType === 'mouse' ? 'keyboard' : 'touch');
    });
    el.appendChild(btn);
    this.btn = btn;
  }

  /** 设置滑动灵敏度（px）。 */
  setSwipeThreshold(level: 'low' | 'mid' | 'high'): void {
    if (this.touch) this.touch.swipe.cfg = { ...this.touch.swipe.cfg, threshold: SWIPE_PX[level] };
  }

  private onKey(e: KeyboardEvent, phase: 'down' | 'up'): void {
    const a = actionOfKey(e.code, e.key);
    this.lastAny = now();
    if (!a) return;
    const target = e.target as HTMLElement | null;
    const inMenu = this.ctx.kind === 'menu';
    // 菜单里的方向键、回车交给界面（按钮焦点导航）；游玩时阻止页面滚动
    if (!inMenu && (a === 'up' || a === 'down' || a === 'left' || a === 'right')) e.preventDefault();
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (phase === 'down' && e.repeat) return;
    if (a === 'confirm') {
      if (phase === 'down') {
        if (this.enterTimer) clearTimeout(this.enterTimer);
        this.enterTimer = setTimeout(() => {
          if (this.heldSet.has('confirm')) { this.push('skip', 'down', now(), 'keyboard'); this.push('skip', 'up', now(), 'keyboard'); }
        }, 600);
      } else if (this.enterTimer) { clearTimeout(this.enterTimer); this.enterTimer = null; }
    }
    this.push(a, phase, e.timeStamp || now(), 'keyboard');
  }

  private push(a: Action, phase: 'down' | 'up', t: number, device: Device): void {
    let action = a;
    if (this.flip && (a === 'left' || a === 'right')) action = a === 'left' ? 'right' : 'left';
    if (phase === 'down') this.heldSet.add(action); else this.heldSet.delete(action);
    this.queue.push({ action, phase, t, device });
    this.dev = device;
    this.lastAny = now();
  }

  private releaseAll(): void {
    for (const a of Array.from(this.heldSet)) this.push(a, 'up', now(), this.dev);
  }

  drain(): InputEvent[] { const q = this.queue; this.queue = []; return q; }
  held(): ReadonlySet<Action> { return this.heldSet; }
  device(): Device { return this.dev; }

  setContext(c: Ctx): void {
    const changed = c.kind !== this.ctx.kind;
    this.ctx = { ...c };
    if (changed) this.releaseAll();
    if (this.btn) {
      const show = c.kind === 'run' && (c.look || c.ask);
      this.btn.style.display = show ? '' : 'none';
      this.btn.textContent = c.look ? '回头' : '让一下';
    }
  }

  setFlip(on: boolean): void { this.flip = on; }

  inject(a: Action, phase: 'down' | 'up'): void { this.push(a, phase, now(), 'keyboard'); }
}
