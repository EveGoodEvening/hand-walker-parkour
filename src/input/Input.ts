// src/input/Input.ts —— 输入汇总（DESIGN.md §2.2、§8.4 InputAPI）。WP8。
// 键盘 + 触摸 → InputEvent 队列（t = 意图时刻，performance.now() 时间轴）与按住集合。
// · 情境按钮「回头」「让一下」：只在跑段可用时出现（右下角 64 px），单独处理，不经过滑动识别。
// · 画面翻转（5-11）时左右互换：按 ← 或左滑，角色往屏幕左边走（§2.2）。
// · 菜单情境里任何键（修饰键除外）、轻触屏幕空白处都发出 confirm，供「按任意键 / 轻触」跳过开场卡、失败后重来。
// · 长按 Enter 跳过静场由 UI 计时（它知道哪些静场看过），这里不再自己发 skip，避免与 Game 的判断重复跳过。
// · UI 通过 hooks 补充 Game 没有传进来的情境：可请求「让一下」（Game 的 setContext 总是 ask: false）、
//   站立段是否已起身（按住左 / 右半屏），以及菜单子界面里 Esc 的「返回」。
import type { InputAPI } from '../core/contracts';
import { loadSettings } from '../core/save';
import { SWIPE_PX, type Settings } from '../core/settings';
import type { Action, Device, InputEvent } from '../core/types';
import { STR } from '../ui/strings';
import { actionOfKey, countsAsAnyKey } from './keyboard';
import { TouchInput } from './touch';

export type InputContext = { kind: 'run' | 'still' | 'stand' | 'menu'; look: boolean; ask: boolean; standHalves: boolean };

/** UI 注入的情境补充（同一个工作包内部的桥，不是跨包契约）。 */
export interface InputHooks {
  /** 菜单情境里按 Esc 时先问 UI；返回 true 表示 UI 已处理（子界面返回），不再发出 pause。 */
  escape: (() => boolean) | null;
  /** 可请求「让一下」（来自 prompt 事件的 context.ask）。 */
  ask: boolean;
  /** 站立段已起身（按住左 / 右半屏稳住）。 */
  standHalves: boolean;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Input implements InputAPI {
  /** 最近一次 attach 的实例（UI 用它挂 hooks；同一个工作包内部）。 */
  static active: Input | null = null;
  readonly hooks: InputHooks = { escape: null, ask: false, standHalves: false };
  private queue: InputEvent[] = [];
  private readonly heldSet = new Set<Action>();
  private dev: Device = 'keyboard';
  /** Game 传进来的情境。 */
  private base: InputContext = { kind: 'menu', look: false, ask: false, standHalves: false };
  /** 生效的情境 = base 加上 UI hooks 的补充。 */
  private ctx: InputContext = { ...this.base };
  private flip = false;
  private btn: HTMLButtonElement | null = null;
  private touch: TouchInput | null = null;
  private attached: Array<[EventTarget, string, EventListener]> = [];
  /** 最近一次物理输入（任意键 / 触摸）的时刻。 */
  lastAny = 0;

  attach(el: HTMLElement): void {
    Input.active = this;
    if (typeof window === 'undefined') return;
    const on = (t: EventTarget, type: string, fn: EventListener) => { t.addEventListener(type, fn); this.attached.push([t, type, fn]); };
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, 'down'));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, 'up'));
    on(window, 'blur', () => this.releaseAll());
    this.touch = new TouchInput({
      press: (a, t) => this.push(a, 'down', t, 'touch'),
      release: (a, t) => this.push(a, 'up', t, 'touch'),
      context: () => ({ kind: this.ctx.kind, standHalves: this.ctx.standHalves }),
    });
    this.touch.attach(el);
    try { this.setSwipeThreshold(loadSettings().swipe); } catch { /* 默认 24 px */ }
    el.style.touchAction = 'none';
    const btn = document.createElement('button');
    btn.className = 'hw-context-btn';
    btn.type = 'button';
    btn.setAttribute('data-ui-control', '1');
    btn.style.display = 'none';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const a: Action = this.ctx.look ? 'look' : 'ask';
      const dev: Device = e.pointerType === 'mouse' ? 'keyboard' : 'touch';
      this.push(a, 'down', e.timeStamp, dev);
      this.push(a, 'up', e.timeStamp, dev);
    });
    // 键盘把焦点移到按钮上再按空格 / 回车时也能用（无障碍）
    btn.addEventListener('click', (e) => { if ((e as MouseEvent).detail === 0) { const a: Action = this.ctx.look ? 'look' : 'ask'; this.push(a, 'down', now(), 'keyboard'); this.push(a, 'up', now(), 'keyboard'); } });
    el.appendChild(btn);
    this.btn = btn;
  }

  /** 解除监听（测试用）。 */
  detach(): void {
    for (const [t, type, fn] of this.attached) t.removeEventListener(type, fn);
    this.attached = [];
    this.btn?.remove();
    if (Input.active === this) Input.active = null;
  }

  /** 设置滑动灵敏度：低 / 中 / 高 = 32 / 24 / 16 px（§7.3）。Game 在设置变化时调用。 */
  setSwipeThreshold(level: Settings['swipe']): void {
    if (this.touch) this.touch.swipe.cfg = { ...this.touch.swipe.cfg, threshold: SWIPE_PX[level] };
  }
  get swipeThreshold(): number { return this.touch?.swipe.cfg.threshold ?? SWIPE_PX.mid; }
  /** 触摸识别器（测试用）。 */
  get touchInput(): TouchInput | null { return this.touch; }

  private onKey(e: KeyboardEvent, phase: 'down' | 'up'): void {
    const a = actionOfKey(e.code, e.key);
    this.lastAny = now();
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const inMenu = this.ctx.kind === 'menu';
    if (!a) {
      // 菜单情境：任意键（修饰键除外）= 确认，供开场卡、失败卡的「按任意键」使用
      if (inMenu && countsAsAnyKey(e.key, e.code) && !(phase === 'down' && e.repeat)) this.push('confirm', phase, e.timeStamp || now(), 'keyboard');
      return;
    }
    // 游玩时阻止方向键和空格滚动页面；菜单里的方向键、回车交给界面（按钮焦点导航）
    if (!inMenu && (a === 'up' || a === 'down' || a === 'left' || a === 'right')) e.preventDefault();
    if (phase === 'down' && e.repeat) return;
    if (a === 'pause' && phase === 'down' && inMenu && this.hooks.escape?.()) { e.preventDefault(); return; }
    // 松开时发出与按下时相同的动作（按住 ← 期间画面翻转，松开的仍是按下的那一侧）
    const code = e.code || e.key;
    if (phase === 'down') {
      const act = this.mapFlip(a);
      this.keyActs.set(code, act);
      this.push(act, 'down', e.timeStamp || now(), 'keyboard', true);
    } else {
      const act = this.keyActs.get(code) ?? this.mapFlip(a);
      this.keyActs.delete(code);
      this.push(act, 'up', e.timeStamp || now(), 'keyboard', true);
    }
  }
  private readonly keyActs = new Map<string, Action>();

  private mapFlip(a: Action): Action {
    if (this.flip && (a === 'left' || a === 'right')) return a === 'left' ? 'right' : 'left';
    return a;
  }

  private push(a: Action, phase: 'down' | 'up', t: number, device: Device, mapped = false): void {
    const action = mapped ? a : this.mapFlip(a);
    if (phase === 'down') this.heldSet.add(action);
    else if (!this.heldSet.delete(action) && (action === 'left' || action === 'right')) {
      // 按下后画面翻转、再松开：松开的是另一侧
      this.heldSet.delete(action === 'left' ? 'right' : 'left');
    }
    this.queue.push({ action, phase, t, device });
    this.dev = device;
    this.lastAny = now();
  }

  private releaseAll(): void {
    for (const a of Array.from(this.heldSet)) {
      this.heldSet.delete(a);
      this.queue.push({ action: a, phase: 'up', t: now(), device: this.dev });
    }
  }

  drain(): InputEvent[] { const q = this.queue; this.queue = []; return q; }
  held(): ReadonlySet<Action> { return this.heldSet; }
  device(): Device { return this.dev; }
  get context(): Readonly<InputContext> { return this.ctx; }

  setContext(c: InputContext): void {
    const changed = c.kind !== this.base.kind;
    this.base = { ...c };
    this.recompute();
    if (changed) { this.releaseAll(); this.touch?.reset(); }
  }

  /** UI 更新 hooks 之后调用：重新合成情境、刷新情境按钮。 */
  refreshHooks(): void { this.recompute(); }

  private recompute(): void {
    const b = this.base;
    this.ctx = {
      kind: b.kind, look: b.look,
      ask: b.ask || (b.kind === 'run' && this.hooks.ask),
      standHalves: b.standHalves || (b.kind === 'stand' && this.hooks.standHalves),
    };
    this.refreshButton();
  }

  private refreshButton(): void {
    if (!this.btn) return;
    const c = this.ctx;
    const show = c.kind === 'run' && (c.look || c.ask);
    this.btn.style.display = show ? '' : 'none';
    const label = c.look ? STR.look : STR.ask;
    if (this.btn.textContent !== label) this.btn.textContent = label;
  }

  setFlip(on: boolean): void { this.flip = on; }
  get flipped(): boolean { return this.flip; }

  inject(a: Action, phase: 'down' | 'up'): void { this.push(a, phase, now(), 'keyboard'); }
}
