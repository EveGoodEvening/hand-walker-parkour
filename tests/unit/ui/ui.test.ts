// @vitest-environment happy-dom
// tests/unit/ui/ui.test.ts —— 界面与 HUD（DESIGN.md §7、§2.7、附录 B；§8.10 WP8 验收 5、6，以及 lead 的补充要求）。
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventBody } from '../../../src/levels/schema';
import { LINES, lineText, type LineEntry } from '../../../src/levels/lines';
import { dwellSeconds } from '../../../src/ui/hud/subtitles';
import { bareLine, lineIdByText } from '../../../src/ui/UI';
import { ev, flushMicrotasks, mountUI, settings, snap } from './helpers';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

const text = (line: string, style: 'narration' | 'whisper' | 'other' | 'self' = 'narration', pan = 0) =>
  ({ type: 'text', line, style, pan } as Extract<EventBody, { type: 'text' }>);

describe('HUD 基本', () => {
  it('章名：chapter:start 时写上（40%），8 s 后降到 20%；重来时重新显示', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
    ui.frame(snap({ t: 0.1 }), 0.1);
    expect(ui.hud.chname.textContent).toBe('第一章　早自习');
    expect(ui.hud.chname.classList.contains('faded')).toBe(false);
    ui.frame(snap({ t: 8.2 }), 0.1);
    expect(ui.hud.chname.classList.contains('faded')).toBe(true);
    ui.onEvent(ev('retry', { segment: '1-5', beat: 104 }), snap({ t: 20 }));
    ui.frame(snap({ t: 20.1 }), 0.1);
    expect(ui.hud.chname.classList.contains('faded')).toBe(false);
  });
  it('低语贴在声像那一侧：用对齐类，不用会被淡入动画覆盖的 transform', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.cueText(text('c1.nickname', 'whisper', -0.6), snap({ t: 1 }));
    ui.frame(snap({ t: 1.1 }), 0.1);
    const line = ui.hud.subsEl.querySelector('.hw-line') as HTMLElement;
    expect(line.classList.contains('whisper')).toBe(true);
    expect(line.classList.contains('side-l')).toBe(true);
    expect(line.style.transform).toBe('');
  });
  it('字幕：同屏最多 2 行；旧行元素保留（不重建、不重播淡入）；重来后同一句停留减半', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.cueText(text('c1.hurtA1', 'self'), snap({ t: 1 }));
    ui.frame(snap({ t: 1 }), 0);
    const first = ui.hud.subsEl.firstElementChild;
    ui.cueText(text('c1.hurtA2', 'self'), snap({ t: 1.5 }));
    ui.frame(snap({ t: 1.5 }), 0);
    expect(ui.hud.subsEl.firstElementChild).toBe(first);
    ui.cueText(text('c1.oldFriend'), snap({ t: 1.7 }));
    ui.frame(snap({ t: 1.7 }), 0);
    expect(ui.hud.subsEl.children.length).toBe(2);
    expect(ui.hud.currentText()).toEqual(['“每天都疼。”', '像旧友拍肩。']);
    ui.onEvent(ev('retry', { segment: '1-2', beat: 96 }), snap({ t: 10 }));
    ui.cueText(text('c1.oldFriend'), snap({ t: 10 }));
    expect(ui.hud.subs.lines[0]?.until).toBeCloseTo(10 + (6 * 90 + 800) / 2000, 9);
  });
  it('数数：每次掌根落地计一个数，它的数字晚一个出现（灰色残影）', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.cueCount({ type: 'count', from: 1, to: 4, ghostLag: 1 }, snap({ t: 0 }));
    const heel = (t: number) => ui.onEvent(ev('contact', { hand: 'L', part: 'heel', t, s: 0, x: 0, surface: 'terrazzo', crisp: false, heavy: false }), snap({ t }));
    const shown: Array<[string | null, string | null]> = [];
    for (let i = 1; i <= 5; i++) { heel(i * 0.3); shown.push(ui.hud.countShown()); }
    expect(shown).toEqual([['一', null], ['二', '一'], ['三', '二'], ['四', '三'], [null, '四']]);
    heel(2); expect(ui.hud.countShown()).toEqual([null, null]);
  });
  it('画面翻转：canvas 做 CSS scaleX(-1)（快照 flip 为真时）', async () => {
    const { ui, canvas } = await mountUI();
    ui.show('play');
    ui.frame(snap({ t: 1, flip: true }), 0);
    expect(canvas.style.transform).toBe('scaleX(-1)');
    ui.frame(snap({ t: 2, flip: false }), 0);
    expect(canvas.style.transform).toBe('');
  });
  it('纸条：拾取时闪现 1.2 s；noteOpen 翻面并记进存档', async () => {
    const { ui, save } = await mountUI();
    ui.show('play');
    ui.onEvent(ev('note', { id: 'n1-a', auto: false }), snap({ t: 2 }));
    ui.frame(snap({ t: 2.5 }), 0);
    expect(ui.hud.noteFlashEl.classList.contains('on')).toBe(true);
    ui.frame(snap({ t: 3.3 }), 0);
    expect(ui.hud.noteFlashEl.classList.contains('on')).toBe(false);
    ui.cueNoteOpen({ type: 'noteOpen', note: 'n1-desk' }, snap({ t: 5 }));
    ui.frame(snap({ t: 5.5 }), 0);
    expect(ui.hud.noteCard.classList.contains('on')).toBe(true);
    expect(ui.hud.noteCard.classList.contains('flipped')).toBe(false);
    ui.frame(snap({ t: 6.2 }), 0);
    expect(ui.hud.noteCard.classList.contains('flipped')).toBe(true);
    expect(ui.hud.noteCard.textContent).toContain('你后面。');
    ui.frame(snap({ t: 10 }), 0);
    expect(ui.hud.noteCard.classList.contains('on')).toBe(false);
    expect(save.load().notesOpened).toContain('n1-desk');
  });
  it('七步：平衡线随 θ 移动', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const stand = { script: 'sevenSteps' as const, phase: 'walking' as const, held: 0, steps: 2, stepT: 0, theta: 0.35, x: 0 };
    ui.frame(snap({ t: 1, segKind: 'stand', stand }), 0);
    expect(ui.hud.balanceEl.classList.contains('on')).toBe(true);
    expect((ui.hud.balanceEl.querySelector('.dot') as HTMLElement).style.transform).toBe('translateX(56px)');
  });
});

describe('每帧最多一次 DOM 写入（§7 总则、验收 6）', () => {
  it('事件和 cue 只改模型；frame() 末尾一次写完；画面不变的帧零写入', async () => {
    const { ui, app } = await mountUI();
    ui.show('play');
    ui.frame(snap({ t: 0 }), 0);
    const mo = new MutationObserver(() => {});
    mo.observe(app, { attributes: true, childList: true, subtree: true, characterData: true });
    let frames = 0, writingFrames = 0;
    for (let i = 1; i <= 240; i++) {
      const t = i / 60;
      const sn = snap({ t, steady: i % 97 === 0 ? 1 : 3 });
      // 一帧里来一串事件：三段触地、追随者、偶尔的字幕 / 提示 / 纸条
      for (const part of ['heel', 'knuckle', 'pad'] as const) ui.onEvent(ev('contact', { hand: 'L', part, t, s: 0, x: 0, surface: 'terrazzo', crisp: false, heavy: false }), sn);
      ui.onEvent(ev('followerContact', { hand: 'L', part: 'heel', t, lagBeats: 0.5, steady: 3, from: 'behind' }), sn);
      if (i % 50 === 0) ui.cueText(text('c1.empty'), sn);
      if (i % 70 === 0) ui.cueHint({ type: 'hint', hint: 'wet' }, { snap: sn, segment: { events: [] } as never });
      if (i % 90 === 0) ui.onEvent(ev('note', { id: 'n1-b', auto: false }), sn);
      expect(mo.takeRecords().length).toBe(0);                // 事件处理不碰 DOM
      const before = ui.batch.flushes;
      ui.frame(sn, 1 / 60);
      const wrote = ui.batch.flushes - before;
      expect(wrote).toBeLessThanOrEqual(1);
      frames++; if (wrote) writingFrames++;
      mo.takeRecords();
    }
    expect(frames).toBe(240);
    expect(writingFrames).toBeGreaterThan(0);
    // 静止：同一快照再渲染，零写入
    const still = snap({ t: 100 });
    ui.frame(still, 0); mo.takeRecords();
    const f0 = ui.batch.flushes;
    ui.frame(still, 0); ui.frame(still, 0);
    expect(ui.batch.flushes).toBe(f0);
    expect(mo.takeRecords().length).toBe(0);
    mo.disconnect();
  });
});

describe('情境按钮也走 DomBatch（验收 6）', () => {
  it('Game 在 tick 里改输入情境不碰 DOM；按钮的显隐和文字在 frame() 里随本帧唯一一次写入', async () => {
    const { Input } = await import('../../../src/input/Input');
    document.body.replaceChildren();
    const app = document.createElement('div'); app.id = 'app'; document.body.appendChild(app);
    const inp = new Input(); inp.attach(app);
    try {
      const { ui } = await mountUI();
      // mountUI 换掉了 body 的内容：把 Input 的元素挂回同一棵树里观察
      const btn = inp.buttonView()?.el as HTMLButtonElement;
      const uiApp = document.getElementById('app') as HTMLElement;
      uiApp.appendChild(btn);
      ui.show('play');
      inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
      ui.frame(snap({ t: 0 }), 0);
      expect(btn.style.display).toBe('none');
      const mo = new MutationObserver(() => {});
      mo.observe(uiApp, { attributes: true, childList: true, subtree: true, characterData: true });
      // 回头窗口打开（tick 里）
      inp.setContext({ kind: 'run', look: true, ask: false, standHalves: false });
      expect(mo.takeRecords().length).toBe(0);
      expect(btn.style.display).toBe('none');
      const f0 = ui.batch.flushes;
      ui.frame(snap({ t: 0.1 }), 0);
      expect(ui.batch.flushes - f0).toBe(1);
      expect(btn.style.display).toBe(''); expect(btn.textContent).toBe('回头');
      mo.takeRecords();
      // prompt 事件补上「让一下」、窗口关闭：同样只改模型
      inp.setContext({ kind: 'run', look: false, ask: false, standHalves: false });
      ui.onEvent(ev('prompt', { hint: null, context: { look: false, ask: true } }), snap({ t: 0.2 }));
      expect(mo.takeRecords().length).toBe(0);
      const f1 = ui.batch.flushes;
      ui.frame(snap({ t: 0.2 }), 0);
      expect(ui.batch.flushes - f1).toBe(1);
      expect(btn.style.display).toBe(''); expect(btn.textContent).toBe('让一下');
      mo.takeRecords();
      // 进静场：隐藏，同样在 frame() 里
      inp.setContext({ kind: 'still', look: false, ask: false, standHalves: false });
      expect(mo.takeRecords().length).toBe(0);
      ui.frame(snap({ t: 0.3, segKind: 'still' }), 0);
      expect(btn.style.display).toBe('none');
      // 不变的帧零写入
      mo.takeRecords();
      const f2 = ui.batch.flushes;
      ui.frame(snap({ t: 0.3, segKind: 'still' }), 0);
      expect(ui.batch.flushes).toBe(f2);
      expect(mo.takeRecords().length).toBe(0);
      mo.disconnect();
    } finally { inp.detach(); }
  });
});

describe('失败卡（§2.7；lead 补充 4）', () => {
  it('提示与按钮按模拟时间在摔倒后 1.2 s 出现；之前按「再来」无效', async () => {
    const { ui, cmd } = await mountUI();
    ui.show('play');
    ui.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }), snap({ t: 5 }));
    ui.frame(snap({ t: 5.5 }), 0);
    expect(ui.hud.root.classList.contains('on')).toBe(true);
    ui.show('fail', { line: '膝盖落地的时候，地面发出一声很闷的响。' });
    ui.frame(snap({ t: 6.1 }), 0);
    const prompt = document.querySelector('[data-screen="fail"] .prompt') as HTMLElement;
    const again = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-screen="fail"] button')).find((b) => b.textContent === '再来') as HTMLButtonElement;
    expect(prompt.classList.contains('on')).toBe(false);
    again.click();
    expect(cmd.calls).not.toContain('retry');
    ui.frame(snap({ t: 6.2 }), 0);
    expect(prompt.classList.contains('on')).toBe(true);
    expect(prompt.textContent).toBe('按任意键，从检查点重来。');
    again.click();
    expect(cmd.calls).toContain('retry');
    // 失败时画面去饱和、变冷，不用红色
    expect((document.getElementById('game') as HTMLElement).style.filter).toMatch(/grayscale/);
  });
  it('触屏上提示是「轻触，从检查点重来。」', async () => {
    const { ui } = await mountUI();
    ui.setDevice('touch');
    ui.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }), snap({ t: 0 }));
    ui.show('fail', { line: 'x' });
    ui.frame(snap({ t: 1.3 }), 0);
    expect((document.querySelector('[data-screen="fail"] .prompt') as HTMLElement).textContent).toBe('轻触，从检查点重来。');
  });
});

describe('操作提示（附录 B.2）', () => {
  const seg = { events: [] } as never;
  it('同一个提示只显示一次，记进存档 hintsSeen；重玩时不再出现', async () => {
    const { ui, save } = await mountUI();
    ui.show('play');
    ui.cueHint({ type: 'hint', hint: 'jump' }, { snap: snap({ t: 1 }), segment: seg });
    ui.frame(snap({ t: 1.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('↑ 撑跃');
    expect(save.load().hintsSeen).toEqual(['jump']);
    ui.frame(snap({ t: 5 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('');
    ui.cueHint({ type: 'hint', hint: 'jump' }, { snap: snap({ t: 6 }), segment: seg });
    ui.frame(snap({ t: 6.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('');
  });
  it('提示随最后一次输入的设备切换；hold 的触摸文字：跑段「下滑不松手」、静场「按住屏幕」', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.setDevice('touch');
    ui.cueHint({ type: 'hint', hint: 'hold' }, { snap: snap({ t: 1 }), segment: seg });
    ui.frame(snap({ t: 1.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('下滑不松手');
    ui.setDevice('keyboard');
    ui.frame(snap({ t: 1.2 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('↓ 按住');
    // 静场里等待输入的提示每次都显示，不计入 hintsSeen
    ui.setDevice('touch');
    ui.onEvent(ev('segment', { id: '1-4', index: 3, kind: 'still' }), snap({ t: 2, segKind: 'still' }));
    ui.onEvent(ev('prompt', { hint: 'hold', context: { look: false, ask: false } }), snap({ t: 8, segKind: 'still' }));
    ui.frame(snap({ t: 8.1, segKind: 'still' }), 0);
    expect(ui.hud.hintEl.textContent).toBe('按住屏幕');
    ui.onEvent(ev('prompt', { hint: null, context: { look: false, ask: false } }), snap({ t: 9, segKind: 'still' }));
    ui.frame(snap({ t: 9.1, segKind: 'still' }), 0);
    expect(ui.hud.hintEl.textContent).toBe('');
  });
  it('「显示操作提示」关闭后全部不显示，wet、tray 除外', async () => {
    const { ui } = await mountUI({ settings: { hints: false } });
    ui.show('play');
    expect(ui.policyHint('jump', 'cue', 0, 3)).toBe(false);
    expect(ui.policyHint('wet', 'cue', 0, 3)).toBe(true);
  });
  it('straighten：提示先于腿偏移出现时，往后找本段的偏移方向，显示反方向箭头', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const segment = { events: [{ at: 18, body: { type: 'drift', dir: -1 } }] } as never;
    ui.cueHint({ type: 'hint', hint: 'straighten' }, { snap: snap({ t: 3, segBeat: 14 }), segment });
    ui.frame(snap({ t: 3.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('→ 掰正');
  });
  it('第一次撞到人腿：1 s 后低语「不是成心的，只是习惯。」，全作只一次', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const hit = (t: number) => ui.onEvent(ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 1, lane: -1, steady: 2, crowd: false, firstLegHit: true }), snap({ t }));
    hit(10);
    ui.frame(snap({ t: 10.9 }), 0);
    expect(ui.hud.currentText()).toEqual([]);
    ui.frame(snap({ t: 11.0 }), 0);
    expect(ui.hud.currentText()).toEqual(['不是成心的，只是习惯。']);
    expect(ui.hud.subs.lines[0]?.style).toBe('whisper');
    ui.hud.subs.clear();
    hit(30); ui.frame(snap({ t: 31.5 }), 0);
    expect(ui.hud.currentText()).toEqual([]);
  });
  it('按文字找 LineId（第二章「让一下。」由 WP2 收录）', () => {
    expect(lineIdByText('喂。')).toBe('c1.hey');
    expect(lineIdByText('并不存在的句子')).toBeNull();
    expect(bareLine('"让一下。"')).toBe('让一下。'); expect(bareLine('“别。”')).toBe('别。'); expect(bareLine('喂。')).toBe('喂。');
  });
  it('「让一下」：WP2 用 ASCII 引号收录也能找到；「让一下。」每次都说，低语每段只出现一次，显示时不带原文引号', async () => {
    const lines = LINES as unknown as Record<string, LineEntry>;
    lines['t.letMe'] = { t: '"让一下。"', ch: 2, quote: true };
    lines['t.dirty'] = { t: '他每天都这样，不脏吗？', ch: 2, quote: true };
    try {
      const { ui } = await mountUI();
      ui.show('play');
      ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
      ui.onEvent(ev('segment', { id: '2-2', index: 1, kind: 'run' }), snap({ t: 0 }));
      const ask = (t: number) => ui.onEvent(ev('ask', { targetId: 1, result: 'part' }), snap({ t }));
      ask(10);
      ui.frame(snap({ t: 10.1 }), 0);
      expect(ui.hud.currentText()).toEqual(['“让一下。”']);
      ui.frame(snap({ t: 10.8 }), 0);
      expect(ui.hud.currentText()).toEqual(['“让一下。”', '他每天都这样，不脏吗？']);
      ui.hud.subs.clear();
      ask(14); ui.frame(snap({ t: 14.1 }), 0);
      expect(ui.hud.currentText()).toEqual(['“让一下。”']);
      ui.frame(snap({ t: 14.9 }), 0);
      expect(ui.hud.currentText()).not.toContain('他每天都这样，不脏吗？');   // 同一段第二次：不再低语
      ui.hud.subs.clear();
      ui.onEvent(ev('retry', { segment: '2-2', beat: 0 }), snap({ t: 20 }));
      ask(21); ui.frame(snap({ t: 21.8 }), 0);
      expect(ui.hud.currentText()).toContain('他每天都这样，不脏吗？');   // 重来后重新计
    } finally { delete lines['t.letMe']; delete lines['t.dirty']; }
  });
  it('重玩存档里已经打完的章：整章字幕都算看过（跨会话也减半）', async () => {
    const { ui } = await mountUI();
    ui.seed({ completed: ['ch1'] });
    ui.show('play');
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
    expect(ui.hud.subs.replayed).toBe(true);
    const d = ui.hud.text(['c1.empty'], 'narration', undefined, 0, 1);
    expect(d).toBeCloseTo(dwellSeconds(lineText('c1.empty'), true), 9);
    ui.seed({ completed: [] });
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 10 }));
    expect(ui.hud.subs.replayed).toBe(false);
    expect(ui.hud.text(['c1.inverted'], 'narration', undefined, 0, 11)).toBeCloseTo(dwellSeconds(lineText('c1.inverted'), false), 9);
  });
});

describe('跳过静场（§2.2、§2.7；lead 补充 5）', () => {
  it('第一次必须看完；看过之后长按「跳过」0.6 s（模拟时间）才跳过', async () => {
    const { ui, cmd } = await mountUI();
    ui.show('play');
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
    ui.onEvent(ev('segment', { id: '1-4', index: 3, kind: 'still' }), snap({ t: 1, segKind: 'still', segment: '1-4' }));
    ui.frame(snap({ t: 1.1, segKind: 'still', segment: '1-4' }), 0);
    expect(ui.skipAvailable).toBe(false);
    ui.onEvent(ev('segment', { id: '1-5', index: 4, kind: 'run' }), snap({ t: 13 }));   // 看完了
    ui.onEvent(ev('retry', { segment: '1-3', beat: 0 }), snap({ t: 20 }));
    ui.onEvent(ev('segment', { id: '1-4', index: 3, kind: 'still' }), snap({ t: 30, segKind: 'still', segment: '1-4' }));
    ui.frame(snap({ t: 30.1, segKind: 'still', segment: '1-4' }), 0);
    expect(ui.skipAvailable).toBe(true);
    expect(ui.hud.skipBtn.classList.contains('on')).toBe(true);
    ui.hud.skipBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    ui.frame(snap({ t: 30.5, segKind: 'still', segment: '1-4' }), 0);
    await flushMicrotasks();
    expect(cmd.calls).not.toContain('skipStill');
    ui.frame(snap({ t: 30.75, segKind: 'still', segment: '1-4' }), 0);
    await flushMicrotasks();
    expect(cmd.calls.filter((c) => c === 'skipStill').length).toBe(1);
  });
  it('键盘：按住 Enter 0.6 s；这一章打完之后所有静场都能跳过', async () => {
    const { ui, cmd } = await mountUI();
    ui.store.patch({ completed: ['ch1'] });
    ui.show('play');
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
    ui.onEvent(ev('segment', { id: '1-4', index: 3, kind: 'still' }), snap({ t: 1, segKind: 'still', segment: '1-4' }));
    ui.frame(snap({ t: 1, segKind: 'still', segment: '1-4' }), 0);
    expect(ui.hud.hintEl.textContent).toBe('按住 Enter 跳过');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }));
    ui.frame(snap({ t: 1.61, segKind: 'still', segment: '1-4' }), 0);
    await flushMicrotasks();
    expect(cmd.calls).toContain('skipStill');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', key: 'Enter' }));
  });
});

describe('界面', () => {
  it('标题：没有存档时「开始」，有存档时「继续」；首次启动提示只出现一次', async () => {
    const { ui, save } = await mountUI();
    ui.show('title');
    const labels = () => Array.from(document.querySelectorAll('[data-screen="title"] .hw-title-menu button')).map((b) => b.textContent);
    expect(labels()).toEqual(['开始', '章节', '设置', '纸条']);
    expect(document.querySelector('[data-screen="title"] .hw-notice')?.textContent).toBe('建议佩戴耳机。本作含灯光闪烁，可在设置中减弱。');
    save.patch({ last: { chapter: 'ch1', segment: '1-2', beat: 96 } });
    ui.show('title');
    expect(labels()).toEqual(['继续', '章节', '设置', '纸条']);
    expect(document.querySelector('[data-screen="title"] .hw-notice')).toBeNull();
  });
  it('章节：已完成的章行尾一道短横线加「纸条 a/b」；未解锁只显示「——」', async () => {
    const { ui, save } = await mountUI();
    save.patch({ notes: ['n1-a'] });
    ui.store.patch({ completed: ['ch1'] });
    ui.show('chapters');
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-screen="chapters"] .hw-chrow'));
    expect(rows.length).toBe(5);
    expect(rows[0]?.textContent).toBe('第一章　早自习纸条 1/2');
    expect(rows[0]?.querySelector('.dash')).not.toBeNull();
    expect(rows.slice(1).every((r) => r.textContent === '——' && r.disabled)).toBe(true);
  });
  it('设置：点一下换到下一个值；← → 在当前行里往前 / 往后；清除进度要二次确认', async () => {
    const { ui, cmd } = await mountUI();
    ui.show('settings');
    const btn = (k: string) => document.querySelector<HTMLButtonElement>(`[data-screen="settings"] button[data-key="${k}"]`) as HTMLButtonElement;
    btn('reducedFlicker').click();
    expect(cmd.calls).toContain('setSetting:"reducedFlicker",true');
    expect(btn('reducedFlicker').textContent).toBe('开');
    btn('master').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }));
    expect(cmd.calls).toContain('setSetting:"master",70');
    btn('reset').click();
    expect(cmd.calls).not.toContain('resetProgress');
    expect(btn('reset').textContent).toBe('确定清除？');
    btn('reset').click();
    expect(cmd.calls).toContain('resetProgress');
  });
  it('设置从暂停进入：Esc / 返回回到暂停界面', async () => {
    const { ui } = await mountUI();
    ui.show('pause', { slowAvailable: true, slowOn: false });
    (Array.from(document.querySelectorAll<HTMLButtonElement>('[data-screen="pause"] button')).find((b) => b.textContent === '设置') as HTMLButtonElement).click();
    expect(ui.screen).toBe('settings');
    expect(ui.onEscape()).toBe(true);
    expect(ui.screen).toBe('pause');
    // 「放慢一点」还在（没有因为回来而丢失）
    expect(document.querySelector('[data-screen="pause"] .hw-slow')?.textContent).toBe('放慢一点　关');
  });
  it('暂停：下方 1 px 的章节进度线，检查点是刻度，当前位置是一个点', async () => {
    const { ui } = await mountUI();
    ui.frame(snap({ t: 1, chapter: 'ch1', segIndex: 1, segBeat: 100 }), 0);
    ui.show('pause', {});
    const bar = document.querySelector('[data-screen="pause"] .hw-progress') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.querySelectorAll('.tick').length).toBe(7);
    expect(bar.querySelectorAll('.dot').length).toBe(1);
  });
  it('纸条：已获得的排成一行；折着的那张在打开之前不能翻看', async () => {
    const { ui, save } = await mountUI();
    save.patch({ notes: ['n1-a', 'n1-desk'] });
    ui.show('notes');
    const thumbs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-screen="notes"] .hw-note-thumb'));
    expect(thumbs.map((b) => b.getAttribute('data-note'))).toEqual(['n1-desk', 'n1-a']);
    expect(thumbs[0]?.disabled).toBe(true);
    thumbs[1]?.click();
    const viewer = document.querySelector('[data-screen="notes"] .hw-note-viewer') as HTMLElement;
    expect(viewer.classList.contains('on')).toBe(true);
    expect(viewer.textContent).toContain('进化失败');
    (viewer.querySelector('.hw-note-flip') as HTMLButtonElement).click();
    expect(viewer.querySelector('.hw-paper')?.classList.contains('flipped')).toBe(true);
    expect(ui.onEscape()).toBe(true);
    expect(viewer.classList.contains('on')).toBe(false);
    save.patch({ notesOpened: ['n1-desk'] });
    ui.show('notes');
    expect(document.querySelector<HTMLButtonElement>('[data-note="n1-desk"]')?.disabled).toBe(false);
  });
  it('结尾卡：结尾句、统计（B.6）、「下一章」「重玩本章」「回到标题」；没有评级字样', async () => {
    const { ui } = await mountUI();
    ui.show('outro', { chapter: 'ch1', stats: { timeMs: 130_000, falls: 0, stumbles: 1, crashes: 0, lookBacks: 1, notes: ['n1-a', 'n1-b'] },
      next: 'ch2', lines: ['有些问题问出来就回不去了。', '但我现在已经不想问了。', '我想知道答案。'], notes: { got: 2, total: 2 } });
    const el = document.querySelector('[data-screen="outro"]') as HTMLElement;
    expect(el.textContent).toContain('用时 2:10　摔倒 0　回头 1　纸条 2/2');
    expect(Array.from(el.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['下一章', '重玩本章', '回到标题']);
    expect(el.textContent).not.toMatch(/完美|恭喜|评级|胜利/);
  });
  it('演职卡（B.7）', async () => {
    const { ui } = await mountUI();
    ui.show('credits');
    expect(document.querySelector('[data-screen="credits"]')?.textContent).toContain('全部画面与声音均由程序生成。');
  });
  it('设置变化：大字幕、减少晃动的类名挂在根上', async () => {
    const { ui, root } = await mountUI({ settings: { subtitleSize: 'large', reducedMotion: true } });
    void ui;
    expect(root.classList.contains('hw-large')).toBe(true);
    expect(root.classList.contains('hw-rm')).toBe(true);
    void settings;
  });
});
