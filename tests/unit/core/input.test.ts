// @vitest-environment happy-dom
// tests/unit/core/input.test.ts —— 输入（DESIGN.md §2.2、D8、§8.9-3）：滑动识别、键盘映射、Input 汇总（翻转、情境按钮）。
import { describe, expect, it } from 'vitest';
import { SwipeRecognizer } from '../../../src/input/gestures';
import { actionOfKey } from '../../../src/input/keyboard';
import { Input } from '../../../src/input/Input';

describe('滑动识别', () => {
  it('位移超过 24 px 立即触发（不等抬手），意图时刻 = 按下 + 40 ms', () => {
    const r = new SwipeRecognizer();
    r.down(100, 100, 1000);
    expect(r.move(110, 102, 1100)).toEqual([]);
    expect(r.move(125, 103, 1150)).toEqual([{ kind: 'swipe', dir: 'right', t: 1040 }]);
    expect(r.move(130, 103, 1160)).toEqual([]);
  });
  it('速度 ≥ 0.35 px/ms 也触发', () => {
    const r = new SwipeRecognizer();
    r.down(0, 0, 0);
    expect(r.move(0, -12, 20)).toEqual([{ kind: 'swipe', dir: 'up', t: 40 }]);
  });
  it('主轴比 < 1.2 不触发', () => {
    const r = new SwipeRecognizer();
    r.down(0, 0, 0);
    expect(r.move(30, 28, 500)).toEqual([]);
  });
  it('同一次按下，累计位移超过 2 倍阈值可以再换一次道（只一次）', () => {
    const r = new SwipeRecognizer();
    r.down(0, 0, 0);
    expect(r.move(-30, 0, 100).length).toBe(1);
    expect(r.move(-50, 0, 150)).toMatchObject([{ dir: 'left' }]);
    expect(r.move(-120, 0, 200)).toEqual([]);
  });
  it('下滑不抬手即按住，抬手时释放', () => {
    const r = new SwipeRecognizer();
    r.down(0, 0, 0);
    expect(r.move(0, 30, 50)).toMatchObject([{ dir: 'down' }]);
    expect(r.holding).toBe(true);
    expect(r.up(0, 40, 400)).toEqual([{ kind: 'release', dir: 'down', t: 400 }]);
  });
  it('阈值可调（32 / 24 / 16）', () => {
    const r = new SwipeRecognizer({ threshold: 16, velocity: 10, ratio: 1.2, intentOffsetMs: 40 });
    r.down(0, 0, 0);
    expect(r.move(17, 0, 500)).toMatchObject([{ dir: 'right' }]);
  });
});

describe('键盘映射（§2.2）', () => {
  it('方向键 / WASD / 空格 / Q / E / Esc / P / Enter', () => {
    expect(actionOfKey('ArrowLeft', '')).toBe('left'); expect(actionOfKey('KeyD', 'd')).toBe('right');
    expect(actionOfKey('Space', ' ')).toBe('up'); expect(actionOfKey('KeyS', 's')).toBe('down');
    expect(actionOfKey('KeyQ', 'q')).toBe('look'); expect(actionOfKey('KeyE', 'e')).toBe('ask');
    expect(actionOfKey('Escape', 'Escape')).toBe('pause'); expect(actionOfKey('KeyP', 'p')).toBe('pause');
    expect(actionOfKey('Enter', 'Enter')).toBe('confirm'); expect(actionOfKey('KeyZ', 'z')).toBeNull();
  });
});

describe('Input 汇总', () => {
  it('键盘事件进队列、按住集合；画面翻转时左右互换；情境按钮只在可用时出现', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const inp = new Input();
    inp.attach(el);
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' }));
    expect(inp.held().has('down')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', key: 'ArrowDown' }));
    expect(inp.drain().map((e) => `${e.action}:${e.phase}`)).toEqual(['down:down', 'down:up']);
    inp.setFlip(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }));
    expect(inp.drain()[0]?.action).toBe('right');
    const btn = el.querySelector('.hw-context-btn') as HTMLButtonElement;
    expect(btn.style.display).toBe('none');
    inp.setContext({ kind: 'run', look: true, ask: false, standHalves: false });
    expect(btn.style.display).toBe('');
    expect(btn.textContent).toBe('回头');
    inp.inject('look', 'down');
    expect(inp.drain()[0]).toMatchObject({ action: 'look', phase: 'down' });
  });
});
