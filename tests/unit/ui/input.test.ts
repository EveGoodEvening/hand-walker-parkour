// @vitest-environment happy-dom
// tests/unit/ui/input.test.ts —— Input 汇总（DESIGN.md §2.2、§7.2 开场卡「按任意键」、§8.4 InputAPI）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actionOfKey, countsAsAnyKey } from '../../../src/input/keyboard';
import { Input } from '../../../src/input/Input';

let inp: Input;
let el: HTMLElement;
const key = (type: 'keydown' | 'keyup', code: string, k = code, o: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true, ...o }));
const drain = () => inp.drain().map((e) => `${e.action}:${e.phase}`);

beforeEach(() => {
  document.body.replaceChildren();
  el = document.createElement('div'); document.body.appendChild(el);
  inp = new Input(); inp.attach(el);
});
afterEach(() => inp.detach());

describe('键盘', () => {
  it('映射：方向键 / WASD / 空格 / Q / E / Esc / P / Enter / 退格', () => {
    expect(actionOfKey('ArrowLeft', '')).toBe('left'); expect(actionOfKey('KeyD', 'd')).toBe('right');
    expect(actionOfKey('Space', ' ')).toBe('up'); expect(actionOfKey('KeyS', 's')).toBe('down');
    expect(actionOfKey('KeyQ', 'q')).toBe('look'); expect(actionOfKey('KeyE', 'e')).toBe('ask');
    expect(actionOfKey('Escape', 'Escape')).toBe('pause'); expect(actionOfKey('KeyP', 'p')).toBe('pause');
    expect(actionOfKey('Enter', 'Enter')).toBe('confirm'); expect(actionOfKey('Backspace', 'Backspace')).toBe('back');
    expect(actionOfKey('KeyZ', 'z')).toBeNull();
  });
  it('菜单情境里「任意键」（没映射的键也算）= 确认；修饰键、Tab、F 键不算', () => {
    inp.setContext({ kind: 'menu', look: false, ask: false, standHalves: false });
    key('keydown', 'KeyZ', 'z'); key('keyup', 'KeyZ', 'z');
    expect(drain()).toEqual(['confirm:down', 'confirm:up']);
    for (const [c, k] of [['ShiftLeft', 'Shift'], ['Tab', 'Tab'], ['F5', 'F5'], ['AltLeft', 'Alt'], ['MetaLeft', 'Meta']]) key('keydown', c as string, k);
    expect(drain()).toEqual([]);
    expect(countsAsAnyKey('x')).toBe(true); expect(countsAsAnyKey('Control')).toBe(false); expect(countsAsAnyKey('F12', 'F12')).toBe(false);
  });
  it('跑段里没映射的键什么也不做；自动连发只算一次', () => {
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    key('keydown', 'KeyZ', 'z');
    key('keydown', 'ArrowUp', 'ArrowUp'); key('keydown', 'ArrowUp', 'ArrowUp', { repeat: true });
    expect(drain()).toEqual(['up:down']);
  });
  it('长按 Enter 不再由 Input 发出 skip（跳过由 UI 按「看过没有」判断，避免重复跳过）', async () => {
    inp.setContext({ kind: 'still', look: false, ask: false, standHalves: false });
    key('keydown', 'Enter', 'Enter');
    await new Promise((r) => setTimeout(r, 700));
    key('keyup', 'Enter', 'Enter');
    expect(drain()).toEqual(['confirm:down', 'confirm:up']);
  });
  it('菜单子界面里 Esc 先交给 UI（返回上一级），UI 没处理时才是暂停', () => {
    inp.setContext({ kind: 'menu', look: false, ask: false, standHalves: false });
    let handled = true;
    inp.hooks.escape = () => handled;
    key('keydown', 'Escape', 'Escape');
    expect(drain()).toEqual([]);
    handled = false;
    key('keydown', 'Escape', 'Escape');
    expect(drain()).toEqual(['pause:down']);
  });
});

describe('画面翻转（§2.2）', () => {
  it('翻转时 ← 变成 right、→ 变成 left；按下后翻转再松开，松开的是按下的那一侧', () => {
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    inp.setFlip(true);
    key('keydown', 'ArrowLeft', 'ArrowLeft');
    expect(inp.held().has('right')).toBe(true);
    inp.setFlip(false);
    key('keyup', 'ArrowLeft', 'ArrowLeft');
    expect(inp.held().size).toBe(0);
    expect(drain()).toEqual(['right:down', 'right:up']);
  });
  it('调试翻转（__game.ext.uiFlip）同样互换输入；Game 每 tick 的 setFlip(false) 不会把它冲掉', () => {
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    inp.debugFlip = true;
    inp.setFlip(false);
    expect(inp.flipped).toBe(true);
    key('keydown', 'ArrowRight', 'ArrowRight'); key('keyup', 'ArrowRight', 'ArrowRight');
    expect(drain()).toEqual(['left:down', 'left:up']);
    inp.debugFlip = false;
    key('keydown', 'ArrowRight', 'ArrowRight'); key('keyup', 'ArrowRight', 'ArrowRight');
    expect(drain()).toEqual(['right:down', 'right:up']);
  });
});

describe('情境按钮', () => {
  it('只在跑段可用时出现：回头（Game 传入）、让一下（UI 从 prompt 事件补上）', () => {
    const btn = el.querySelector('.hw-context-btn') as HTMLButtonElement;
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    expect(btn.style.display).toBe('none');
    inp.setContext({ kind: 'run', look: true, ask: false, standHalves: false });
    expect(btn.style.display).toBe(''); expect(btn.textContent).toBe('回头');
    btn.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    expect(drain()).toEqual(['look:down', 'look:up']);
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    inp.hooks.ask = true; inp.refreshHooks();
    expect(btn.style.display).toBe(''); expect(btn.textContent).toBe('让一下');
    inp.setContext({ kind: 'still', look: false, ask: false, standHalves: false });
    expect(btn.style.display).toBe('none');
  });
  it('站立段：UI 告诉 Input「已起身」后，触摸按左 / 右半屏', () => {
    inp.setContext({ kind: 'stand', look: false, ask: false, standHalves: false });
    inp.hooks.standHalves = true; inp.refreshHooks();
    expect(inp.context.standHalves).toBe(true);
  });
  it('界面切换时丢掉上一个界面里按下的键（选章的回车不会顺带跳过开场卡），松开事件保留', async () => {
    inp.setContext({ kind: 'menu', look: false, ask: false, standHalves: false });
    key('keydown', 'ArrowDown', 'ArrowDown'); key('keyup', 'ArrowDown', 'ArrowDown');
    key('keydown', 'Enter', 'Enter');
    inp.dropPending();
    expect(drain()).toEqual(['down:up']);
    // 经过 UI：show() 换界面时调用
    const { UI } = await import('../../../src/ui/UI');
    const { createSave } = await import('../../../src/core/save');
    const { fakeCmd } = await import('./helpers');
    const root = document.createElement('div'); document.body.appendChild(root);
    const ui = new UI(); ui.mount(root, fakeCmd(), createSave());
    ui.show('chapters');
    key('keydown', 'Enter', 'Enter');
    ui.show('intro', { chapter: 'ch1', title: '第一章', name: '早自习', lines: [] });
    expect(drain()).toEqual([]);
    key('keyup', 'Enter', 'Enter');
    key('keydown', 'KeyK', 'k');
    expect(drain()).toEqual(['confirm:up', 'confirm:down']);
  });
  it('界面在同一帧里就用最后一次输入的设备（失败卡：滑动之后摔倒 →「轻触，从检查点重来。」）', async () => {
    const { UI } = await import('../../../src/ui/UI');
    const { createSave } = await import('../../../src/core/save');
    const { fakeCmd, ev, snap } = await import('./helpers');
    const root = document.createElement('div'); document.body.appendChild(root);
    const ui = new UI(); ui.mount(root, fakeCmd(), createSave());
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    const o = { pointerType: 'touch', pointerId: 3, bubbles: true, isPrimary: true } as const;
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: 100, clientY: 300 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: 140, clientY: 300 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: 140, clientY: 300 }));
    expect(inp.device()).toBe('touch');
    ui.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }), snap({ t: 0 }));
    ui.show('fail', { line: 'x' });
    ui.frame(snap({ t: 1.3 }), 0);           // Game 还没调过 setDevice
    expect((root.querySelector('[data-screen="fail"] .prompt') as HTMLElement).textContent).toBe('轻触，从检查点重来。');
  });
  it('情境切换时松开所有按住的键', () => {
    inp.setContext({ kind: 'still', look: false, ask: false, standHalves: false });
    key('keydown', 'ArrowDown', 'ArrowDown');
    expect(inp.held().has('down')).toBe(true);
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    expect(inp.held().size).toBe(0);
    expect(drain()).toEqual(['down:down', 'down:up']);
  });
});
