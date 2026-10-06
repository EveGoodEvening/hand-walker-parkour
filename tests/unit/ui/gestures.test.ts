// @vitest-environment happy-dom
// tests/unit/ui/gestures.test.ts —— 触摸手势（DESIGN.md §2.2 输入细节、D8；§8.10 WP8 验收 1）。
// 全部用合成 PointerEvent 驱动真实的 TouchInput（和 Input），timeStamp 由测试指定：
// 24 px 或 0.35 px/ms 阈值、1.2 主轴比、2 倍阈值连换两道、下滑按住、意图时刻 = pointerdown + 40 ms。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/types';
import { Input } from '../../../src/input/Input';
import { TouchInput, type TouchContextKind } from '../../../src/input/touch';

type Rec = { a: Action; phase: 'down' | 'up'; t: number };

function pe(type: string, o: { x: number; y: number; t: number; id?: number; kind?: string; target?: HTMLElement }): PointerEvent {
  const e = new PointerEvent(type, { pointerId: o.id ?? 1, pointerType: o.kind ?? 'touch', clientX: o.x, clientY: o.y, bubbles: true, cancelable: true, isPrimary: (o.id ?? 1) !== 2 });   // 测试里 id 2 代表第二根手指
  Object.defineProperty(e, 'timeStamp', { value: o.t });
  return e;
}

function rig(kind: TouchContextKind = 'run', standHalves = false) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 360 });
  document.body.appendChild(el);
  const out: Rec[] = [];
  const ctx = { kind, standHalves };
  const ti = new TouchInput({
    press: (a, t) => out.push({ a, phase: 'down', t }), release: (a, t) => out.push({ a, phase: 'up', t }), context: () => ctx,
  });
  ti.attach(el);
  const fire = (type: string, x: number, y: number, t: number, id = 1, kindP = 'touch') => el.dispatchEvent(pe(type, { x, y, t, id, kind: kindP }));
  return { el, out, ti, ctx, fire };
}

beforeEach(() => { document.body.replaceChildren(); });

describe('滑动阈值（24 px / 0.35 px/ms）', () => {
  it('位移达到 24 px 立即触发，不等抬手；意图时刻 = pointerdown + 40 ms', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 300, 1000);
    fire('pointermove', 110, 301, 1100);          // 10 px，0.1 px/ms：不触发
    expect(out).toEqual([]);
    fire('pointermove', 123, 302, 1180);          // 23 px：还差 1 px
    expect(out).toEqual([]);
    fire('pointermove', 124, 302, 1190);          // 24 px：触发（手指还没抬）
    expect(out).toEqual([{ a: 'right', phase: 'down', t: 1040 }, { a: 'right', phase: 'up', t: 1040 }]);
    fire('pointerup', 130, 302, 1300);
    expect(out.length).toBe(2);
  });
  it('速度 ≥ 0.35 px/ms 时不到 24 px 也触发', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 300, 500);
    fire('pointermove', 100, 288, 530);           // 上 12 px / 30 ms = 0.4 px/ms
    expect(out[0]).toEqual({ a: 'up', phase: 'down', t: 540 });
  });
  it('速度不够（0.3 px/ms）又不到 24 px 不触发', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 300, 0);
    fire('pointermove', 91, 300, 30);             // 9 px / 30 ms = 0.3 px/ms
    fire('pointermove', 82, 300, 60);             // 18 px，瞬时 0.3 px/ms
    expect(out).toEqual([]);
  });
  it('手指落下时的微小抖动（< 8 px）即使很快也不算滑动', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 300, 0);
    fire('pointermove', 104, 300, 2);             // 4 px / 2 ms
    expect(out).toEqual([]);
  });
});

describe('主轴判定（|主| / |次| ≥ 1.2）', () => {
  it('比值不够（30 / 28）不触发；之后比值够了再触发', () => {
    const { out, fire } = rig();
    fire('pointerdown', 0, 0, 0);
    fire('pointermove', 30, 28, 400);
    expect(out).toEqual([]);
    fire('pointermove', 36, 28, 450);             // 36 / 28 = 1.29
    expect(out[0]).toMatchObject({ a: 'right', phase: 'down', t: 40 });
  });
  it('刚好 1.2 倍算数：竖直 36、水平 30 → 下滑', () => {
    const { out, fire } = rig();
    fire('pointerdown', 0, 0, 0);
    fire('pointermove', 30, 36, 300);
    expect(out[0]).toMatchObject({ a: 'down', phase: 'down' });
  });
});

describe('同一次按下连换两道（2 倍阈值）', () => {
  it('累计 48 px 时再换一次，只一次', () => {
    const { out, fire } = rig();
    fire('pointerdown', 200, 300, 0);
    fire('pointermove', 170, 300, 60);            // −30：第一次
    fire('pointermove', 160, 300, 90);            // −40：不到 48
    expect(out.filter((r) => r.phase === 'down').map((r) => r.a)).toEqual(['left']);
    fire('pointermove', 152, 300, 110);           // −48：第二次
    fire('pointermove', 60, 300, 200);            // 再远也不会有第三次
    const downs = out.filter((r) => r.phase === 'down');
    expect(downs.map((r) => r.a)).toEqual(['left', 'left']);
    expect(downs[1]?.t).toBe(110);                // 第二次的意图时刻 = 它被识别的时刻
  });
  it('上滑、下滑不会连发两次', () => {
    const { out, fire } = rig();
    fire('pointerdown', 0, 300, 0);
    fire('pointermove', 0, 270, 50);
    fire('pointermove', 0, 200, 100);
    expect(out.filter((r) => r.phase === 'down').map((r) => r.a)).toEqual(['up']);
  });
});

describe('下滑按住', () => {
  it('下滑触发后手指不抬 = 按住 ↓；抬手时才松开', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 100, 1000);
    fire('pointermove', 100, 130, 1050);
    expect(out).toEqual([{ a: 'down', phase: 'down', t: 1040 }]);
    fire('pointermove', 100, 140, 1300);
    expect(out.length).toBe(1);                   // 还按着
    fire('pointerup', 100, 140, 1600);
    expect(out[1]).toEqual({ a: 'down', phase: 'up', t: 1600 });
  });
  it('pointercancel 也会松开', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 100, 0);
    fire('pointermove', 100, 130, 30);
    fire('pointercancel', 100, 130, 500);
    expect(out.map((r) => `${r.a}:${r.phase}`)).toEqual(['down:down', 'down:up']);
  });
});

describe('只认第一根手指；鼠标、界面按钮、情境', () => {
  it('第二根手指的滑动被忽略', () => {
    const { out, fire } = rig();
    fire('pointerdown', 100, 300, 0, 1);
    fire('pointerdown', 250, 300, 5, 2);
    fire('pointermove', 290, 300, 30, 2);          // 第二根手指右滑 40 px
    expect(out).toEqual([]);
    fire('pointermove', 60, 300, 40, 1);           // 第一根手指左滑
    expect(out[0]).toMatchObject({ a: 'left' });
  });
  it('跑段里鼠标拖动不算滑动；菜单里轻触（或鼠标点击）空白处 = 确认', () => {
    const r = rig('run');
    r.fire('pointerdown', 0, 0, 0, 1, 'mouse');
    r.fire('pointermove', 60, 0, 30, 1, 'mouse');
    expect(r.out).toEqual([]);
    r.ctx.kind = 'menu';
    r.fire('pointerdown', 10, 10, 100, 3, 'touch');
    expect(r.out).toEqual([{ a: 'confirm', phase: 'down', t: 100 }, { a: 'confirm', phase: 'up', t: 100 }]);
    r.fire('pointerdown', 10, 10, 200, 4, 'mouse');
    expect(r.out.length).toBe(4);
  });
  it('按在界面按钮（data-ui-control）上的手指不进滑动识别', () => {
    const { el, out } = rig('run');
    const b = document.createElement('button'); b.setAttribute('data-ui-control', '1'); el.appendChild(b);
    b.dispatchEvent(pe('pointerdown', { x: 0, y: 0, t: 0 }));
    el.dispatchEvent(pe('pointermove', { x: 60, y: 0, t: 20 }));
    expect(out).toEqual([]);
  });
  it('静场：按住屏幕任意处 = ↓；站立段：起身前 = ↑，起身后按左 / 右半屏', () => {
    const r = rig('still');
    r.fire('pointerdown', 50, 50, 10);
    r.fire('pointerup', 50, 50, 900);
    expect(r.out.map((x) => `${x.a}:${x.phase}`)).toEqual(['down:down', 'down:up']);
    r.out.length = 0;
    r.ctx.kind = 'stand';
    r.fire('pointerdown', 50, 50, 1000); r.fire('pointerup', 50, 50, 1100);
    r.ctx.standHalves = true;
    r.fire('pointerdown', 50, 50, 1200); r.fire('pointerup', 50, 50, 1300);
    r.fire('pointerdown', 300, 50, 1400); r.fire('pointerup', 300, 50, 1500);
    expect(r.out.filter((x) => x.phase === 'down').map((x) => x.a)).toEqual(['up', 'left', 'right']);
  });
});

describe('经过 Input：灵敏度设置与画面翻转', () => {
  let inp: Input | null = null;
  afterEach(() => { inp?.detach(); inp = null; });
  it('滑动灵敏度 低 / 中 / 高 = 32 / 24 / 16 px', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    inp = new Input(); inp.attach(el);
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    const swipe = (dx: number, t0: number) => {
      el.dispatchEvent(pe('pointerdown', { x: 100, y: 300, t: t0 }));
      el.dispatchEvent(pe('pointermove', { x: 100 + dx, y: 300, t: t0 + 500 }));
      el.dispatchEvent(pe('pointerup', { x: 100 + dx, y: 300, t: t0 + 600 }));
      return inp!.drain().filter((e) => e.phase === 'down').length;
    };
    inp.setSwipeThreshold('low'); expect(inp.swipeThreshold).toBe(32);
    expect(swipe(30, 0)).toBe(0); expect(swipe(32, 1000)).toBe(1);
    inp.setSwipeThreshold('high'); expect(inp.swipeThreshold).toBe(16);
    expect(swipe(16, 2000)).toBe(1);
    inp.setSwipeThreshold('mid');
    expect(swipe(20, 3000)).toBe(0); expect(swipe(24, 4000)).toBe(1);
  });
  it('画面翻转时左滑 = 往屏幕左边走（模拟里是 right），意图时刻照旧 +40 ms', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    inp = new Input(); inp.attach(el);
    inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
    inp.setFlip(true);
    el.dispatchEvent(pe('pointerdown', { x: 200, y: 300, t: 5000 }));
    el.dispatchEvent(pe('pointermove', { x: 170, y: 300, t: 5020 }));
    const evs = inp.drain();
    expect(evs[0]).toMatchObject({ action: 'right', phase: 'down', t: 5040, device: 'touch' });
    expect(inp.device()).toBe('touch');
  });
});
