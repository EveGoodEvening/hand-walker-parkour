// src/input/Input.ts —— 输入汇总（DESIGN.md §2.2、§8.4 InputAPI）。WP8。
// 键盘 + 触摸 → InputEvent 队列（t = 意图时刻，performance.now() 时间轴）与按住集合。
// · 情境按钮「回头」「让一下」：只在跑段可用时出现（右下角 64 px），单独处理，不经过滑动识别。
//   Input 只维护模型（buttonView）；UI 挂载后由 UI.frame() 经 DomBatch 写进 DOM。
// · 画面翻转（5-11）时左右互换：按 ← 或左滑，角色往屏幕左边走（§2.2）。
// · 菜单情境里任何键（修饰键除外）、轻触屏幕空白处都发出 confirm，供「按任意键 / 轻触」跳过开场卡、失败后重来。
// · 长按 Enter 跳过静场由 UI 计时（它知道哪些静场看过），这里不再自己发 skip，避免与 Game 的判断重复跳过。
// · UI 通过 hooks 补充 Game 没有传进来的情境：可请求「让一下」（Game 的 setContext 总是 ask: false）、
//   站立段是否已起身（按住左 / 右半屏），以及菜单子界面里 Esc 的「返回」。
// · 最后一次输入的设备（§7.3，提示文字随之切换）：window 上的捕获阶段 pointerdown 记下每一次按下的指针类型，
//   界面按钮、情境按钮、「跳过」也算（它们不进 TouchInput）。否则手机上点「开始」之后让开场卡自己走完，
//   教学提示还是键盘文字，而每个提示只显示一次。初始值按 (pointer: coarse) 猜。
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
/** 指针类型 → 设备。未知类型（合成事件没写 pointerType）返回 null，不改设备。 */
export function deviceOf(pointerType: string | undefined): Device | null {
  if (pointerType === 'touch' || pointerType === 'pen') return 'touch';
  if (pointerType === 'mouse') return 'keyboard';
  return null;
}

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
  private attached: Array<[EventTarget, string, EventListener, boolean]> = [];
  /** 最近一次物理输入（任意键 / 触摸）的时刻。 */
  lastAny = 0;

  attach(el: HTMLElement): void {
    Input.active = this;
    if (typeof window === 'undefined') return;
    const on = (t: EventTarget, type: string, fn: EventListener, capture = false) => { t.addEventListener(type, fn, capture); this.attached.push([t, type, fn, capture]); };
    try { if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) this.dev = 'touch'; } catch { /* 不支持就当键盘 */ }
    // 捕获阶段：比按钮自己的监听（会 stopPropagation）先到；只记设备，不发出任何动作
    on(window, 'pointerdown', (e) => this.notePointer(e as PointerEvent), true);
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, 'down'));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, 'up'));
    on(window, 'blur', () => this.releaseAll());
    this.touch = new TouchInput({
      press: (a, t, pt) => this.push(a, 'down', t, deviceOf(pt) ?? 'touch'),
      release: (a, t, pt) => this.push(a, 'up', t, deviceOf(pt) ?? 'touch'),
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
    for (const [t, type, fn, capture] of this.attached) t.removeEventListener(type, fn, capture);
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

  /** 任何指针按下（包括界面按钮）：记下设备。手指 / 笔 = 触屏，鼠标 = 键盘（桌面端）。 */
  private notePointer(e: PointerEvent): void {
    const d = deviceOf(e.pointerType);
    if (!d) return;
    this.dev = d;
    this.lastAny = now();
  }

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
    if (this.flipped && (a === 'left' || a === 'right')) return a === 'left' ? 'right' : 'left';
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

  /**
   * 界面切换时由 UI 调用：丢掉还没被 Game 取走的「按下」。它们属于上一个界面——
   * 例如在章节列表里按回车选章，同一次回车会作为「任意键」立刻跳过刚出现的开场卡；
   * 在暂停菜单按回车「继续」，那次回车不该再进入游玩。松开事件保留（按住集合要配对）。
   */
  dropPending(): void {
    if (this.queue.some((e) => e.phase === 'down')) this.queue = this.queue.filter((e) => e.phase === 'up');
  }
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

  /** 情境按钮该怎么显示（模型）。UI 接管之后每帧读它，经 DomBatch 写进 DOM。 */
  buttonView(): { el: HTMLButtonElement; show: boolean; label: string } | null {
    if (!this.btn) return null;
    const c = this.ctx;
    return { el: this.btn, show: c.kind === 'run' && (c.look || c.ask), label: c.look ? STR.look : STR.ask };
  }

  /**
   * UI 挂载时调用：情境按钮改由 UI.frame() 经 DomBatch 写（§7 总则「每帧最多一次 DOM 写入」）。
   * setContext 在模拟 tick 里被调用，这里直接写 DOM 会在同一帧里多出一次写入。
   */
  deferButton(): void { this.buttonDeferred = true; }
  private buttonDeferred = false;

  private refreshButton(): void {
    if (this.buttonDeferred) return;
    // 没有 UI（单独使用 Input 的测试）：值变了才写
    const v = this.buttonView();
    if (!v) return;
    const display = v.show ? '' : 'none';
    if (v.el.style.display !== display) v.el.style.display = display;
    if (v.el.textContent !== v.label) v.el.textContent = v.label;
  }

  setFlip(on: boolean): void { this.flip = on; }
  /** 调试（__game.ext.uiFlip）：不经模拟强制翻转，与 UI.forceFlip 一起用，截图和手动试玩时画面与输入一致。 */
  debugFlip = false;
  get flipped(): boolean { return this.flip || this.debugFlip; }

  inject(a: Action, phase: 'down' | 'up'): void { this.push(a, phase, now(), 'keyboard'); }
}
