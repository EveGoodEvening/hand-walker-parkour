// @vitest-environment happy-dom
// tests/unit/ui/flow.test.ts —— 修复单元 U4 的界面部分：4-6 不借用失败卡文字、亮底墨色模式、结尾卡节奏、颗粒层按实际档位、
// 跳过静场后清掉上一段的字幕与纸条、稳度低时节拍点轻颤、数数离开底部栈、提示的箭头加粗。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtmosphereId, ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import { lineText } from '../../../src/levels/lines';
import type { EventBody } from '../../../src/levels/schema';
import { DARK_ATMOSPHERES, INK_ATMOSPHERES, INK_CLASS, inkFor, inkForSegment } from '../../../src/ui/hud/ink';
import { EYES_OPEN_SEC, segmentCut } from '../../../src/ui/hud/overlays';
import { skippedOverlays } from '../../../src/ui/UI';
import { metronome } from '../../../src/ui/hud/metronome';
import { CREDITS_AFTER, FINAL_OUTRO, OUTRO_LINE_GAP } from '../../../src/ui/screens/outro';
import { ev, follower, mountUI, snap } from './helpers';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { vi.useRealTimers(); });

const stats = { timeMs: 200_000, falls: 1, stumbles: 0, crashes: 0, lookBacks: 2, notes: [] };
const outroLines = (ch: ChapterId) => (getChapter(ch)?.outro.lines ?? []).flatMap((l) => ('line' in l ? [lineText(l.line)] : []));
const delays = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).map((e) => parseFloat(e.style.animationDelay));

describe('4-6：静场里的 anyKey 不出失败卡的字', () => {
  it('静场 prompt { hint: anyKey }：提示为空；失败卡上仍是「按任意键，从检查点重来。」', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.onEvent(ev('segment', { id: '4-6', index: 5, kind: 'still' }), snap({ t: 1, chapter: 'ch4', segment: '4-6', segKind: 'still' }));
    ui.onEvent(ev('prompt', { hint: 'anyKey', context: { look: false, ask: false } }), snap({ t: 6, chapter: 'ch4', segment: '4-6', segKind: 'still' }));
    ui.frame(snap({ t: 6.1, chapter: 'ch4', segment: '4-6', segKind: 'still' }), 0);
    expect(ui.hud.hintEl.textContent).toBe('');
    expect(ui.hud.hintEl.classList.contains('on')).toBe(false);
    ui.onEvent(ev('fall', { cause: 'legs', surface: 'plaza' }), snap({ t: 10 }));
    ui.show('fail', { line: '在梦里，害怕是一种很迟钝的情绪。' });
    ui.frame(snap({ t: 11.3 }), 0);
    expect((document.querySelector('[data-screen="fail"] .prompt') as HTMLElement).textContent).toBe('按任意键，从检查点重来。');
  });
});

describe('亮底墨色模式', () => {
  it('氛围到墨色的映射：梦、梦里变灰、阴天、日光灯是墨色；暗的预设永远不是；白瓷砖厕所和医务室在不暗的时候是', () => {
    const all: AtmosphereId[] = ['morning', 'noon', 'labNorth', 'nightIndoor', 'rainNight', 'busNight', 'homeDark', 'dream', 'dreamGray', 'dawn', 'overcast', 'fluorescent', 'voidDark'];
    expect(all.filter((a) => inkFor(a))).toEqual(['dream', 'dreamGray', 'overcast', 'fluorescent']);
    expect([...INK_ATMOSPHERES].every((a) => !DARK_ATMOSPHERES.has(a))).toBe(true);
    expect(inkFor('morning', { kit: 'washroom' })).toBe(true);
    expect(inkFor('nightIndoor', { kit: 'washroom' })).toBe(false);
    expect(inkFor('morning', { set: 'infirmary' })).toBe(true);
    expect(inkFor('morning', { kit: 'corridor' })).toBe(false);
  });
  it('各段：1-3 厕所、4-1、4-4、4-6、5-8、5-9 是墨色；1-2、3-4、3-9、5-11 不是', () => {
    const on: Array<[ChapterId, string]> = [['ch1', '1-3'], ['ch4', '4-1'], ['ch4', '4-4'], ['ch4', '4-6'], ['ch5', '5-8'], ['ch5', '5-9'], ['ch5', '5-10']];
    const off: Array<[ChapterId, string]> = [['ch1', '1-2'], ['ch3', '3-4'], ['ch3', '3-9'], ['ch5', '5-11'], ['ch2', '2-8']];
    for (const [c, s] of on) expect(inkForSegment(c, s), `${s}`).toBe(true);
    for (const [c, s] of off) expect(inkForSegment(c, s), `${s}`).toBe(false);
    expect(inkForSegment('ch3', '3-4', 'overcast')).toBe(true);
  });
  it('#ui 的类：游玩画面按当前段切换；暂停时回到粉笔白；atmosphere cue 改了氛围就跟着改，换段后恢复段定义', async () => {
    const { ui, root } = await mountUI();
    ui.show('play');
    ui.frame(snap({ t: 1, chapter: 'ch4', segment: '4-1' }), 0);
    expect(root.classList.contains(INK_CLASS)).toBe(true);
    ui.show('pause', {});
    ui.frame(snap({ t: 1.1, chapter: 'ch4', segment: '4-1' }), 0);
    expect(root.classList.contains(INK_CLASS)).toBe(false);
    ui.show('play');
    ui.frame(snap({ t: 2, chapter: 'ch3', segment: '3-4' }), 0);
    expect(root.classList.contains(INK_CLASS)).toBe(false);
    const atmo = { type: 'atmosphere', id: 'dream', seconds: 1 } as Extract<EventBody, { type: 'atmosphere' }>;
    ui.onEvent(ev('cue', { body: atmo, segment: '3-4' }), snap({ t: 3, chapter: 'ch3', segment: '3-4' }));
    ui.frame(snap({ t: 3.1, chapter: 'ch3', segment: '3-4' }), 0);
    expect(root.classList.contains(INK_CLASS)).toBe(true);
    ui.onEvent(ev('segment', { id: '3-5', index: 4, kind: 'still' }), snap({ t: 4, chapter: 'ch3', segment: '3-5', segKind: 'still' }));
    ui.frame(snap({ t: 4.1, chapter: 'ch3', segment: '3-5', segKind: 'still' }), 0);
    expect(root.classList.contains(INK_CLASS)).toBe(false);
  });
});

describe('结尾卡节奏', () => {
  it('终章：两句相隔 ≥ 2.5 s；最后一句之后 ≥ 4.5 s 才出统计和按钮；统计出现 ≥ 6 s 后才进演职卡', async () => {
    vi.useFakeTimers();
    const { ui, cmd } = await mountUI();
    ui.show('outro', { chapter: 'ch5', stats, next: null, lines: outroLines('ch5'), notes: { got: 1, total: 1 } });
    const lines = delays('[data-screen="outro"] .line');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < lines.length; i++) expect((lines[i] as number) - (lines[i - 1] as number)).toBeGreaterThanOrEqual(2.5);
    const statsAt = delays('[data-screen="outro"] .stats')[0] as number;
    expect(statsAt - (lines.at(-1) as number)).toBeGreaterThanOrEqual(4.5);
    const menu = document.querySelector('[data-screen="outro"] .hw-outro-actions') as HTMLElement;
    expect(parseFloat(menu.style.animationDelay)).toBeGreaterThanOrEqual(statsAt);
    const creditsAt = (ui as unknown as { outroScreen: { timing: { creditsAt: number | null } } }).outroScreen.timing.creditsAt as number;
    expect(creditsAt - statsAt).toBeGreaterThanOrEqual(6);
    expect(CREDITS_AFTER).toBeGreaterThanOrEqual(6);
    expect(FINAL_OUTRO.lineGap).toBeGreaterThanOrEqual(2.5);
    vi.advanceTimersByTime((statsAt + 5.9) * 1000);
    expect(cmd.calls).not.toContain('nextChapter');
    vi.advanceTimersByTime(CREDITS_AFTER * 1000);
    expect(cmd.calls).toContain('nextChapter');
  });
  it('其他章：行间隔 1.6–2.0 s；第四章的输入提示在第一句之后、e2e 按键（2.5 s）之前出现，其余两句同样的间隔', async () => {
    expect(OUTRO_LINE_GAP).toBeGreaterThanOrEqual(1.6);
    expect(OUTRO_LINE_GAP).toBeLessThanOrEqual(2.0);
    for (const ch of ['ch1', 'ch2', 'ch3'] as const) {
      const { ui } = await mountUI();
      ui.show('outro', { chapter: ch, stats, next: 'ch5', lines: outroLines(ch), notes: { got: 0, total: 2 } });
      const d = delays('[data-screen="outro"] .line');
      expect(d.length).toBe(outroLines(ch).length);
      for (let i = 1; i < d.length; i++) { const g = (d[i] as number) - (d[i - 1] as number); expect(g).toBeGreaterThanOrEqual(1.6); expect(g).toBeLessThanOrEqual(2.0); }
      expect(document.querySelector('[data-screen="outro"] .hw-outro-actions')?.textContent).toContain('下一章');
    }
    vi.useFakeTimers();
    const { ui } = await mountUI();
    ui.show('outro', { chapter: 'ch4', stats, next: 'ch5', lines: outroLines('ch4'), notes: null });
    const first = delays('[data-screen="outro"] .line')[0] as number;
    const hintAt = delays('[data-screen="outro"] .hint')[0] as number;
    expect(hintAt).toBeGreaterThan(first + 0.8);
    expect(hintAt).toBeLessThan(2.3);
    vi.advanceTimersByTime(hintAt * 1000 + 10);
    for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' }));
    const d = delays('[data-screen="outro"] .line');
    expect(d.length).toBe(3);
    const g = (d[2] as number) - (d[1] as number);
    expect(g).toBeGreaterThanOrEqual(1.6); expect(g).toBeLessThanOrEqual(2.0);
  });
});

describe('颗粒层按 Game 的实际档位', () => {
  it('实际档位 low：没有 on；medium：有', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const grain = document.querySelector('.hw-grain') as HTMLElement;
    ui.setQualityTier('low');
    ui.frame(snap({ t: 1 }), 0);
    expect(grain.classList.contains('on')).toBe(false);
    ui.setQualityTier('medium');
    ui.frame(snap({ t: 2 }), 0);
    expect(grain.classList.contains('on')).toBe(true);
  });
});

describe('跳过静场之后', () => {
  it('2-9 的字幕和纸条翻看：跳过后进入 2-10，字幕清空、纸条收起；跳过中到达的旧 cue 不显示', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const s29 = (t: number) => snap({ t, chapter: 'ch2', segment: '2-9', segKind: 'still' });
    ui.onEvent(ev('chapter:start', { id: 'ch2' }), s29(0));
    ui.onEvent(ev('segment', { id: '2-9', index: 8, kind: 'still' }), s29(0));
    ui.cueText({ type: 'text', line: 'c1.empty' } as Extract<EventBody, { type: 'text' }>, s29(1));
    ui.cueNoteOpen({ type: 'noteOpen', note: 'n1-desk' }, s29(1.5));
    ui.frame(s29(2), 0);
    expect(ui.hud.subsEl.children.length).toBe(1);
    expect(ui.hud.noteCard.classList.contains('on')).toBe(true);
    ui.noteSkip();
    ui.cueText({ type: 'text', line: 'c1.inverted' } as Extract<EventBody, { type: 'text' }>, s29(2.1));   // 跳过时补发的旧字幕
    const s210 = snap({ t: 2.1, chapter: 'ch2', segment: '2-10', segKind: 'run' });
    ui.onEvent(ev('segment', { id: '2-10', index: 9, kind: 'run' }), s210);
    ui.frame(s210, 0);
    expect(ui.hud.subsEl.children.length).toBe(0);
    expect(ui.hud.currentText()).toEqual([]);
    expect(ui.hud.noteCard.classList.contains('on')).toBe(false);
    // 新的一段照常出字
    ui.cueText({ type: 'text', line: 'c1.empty' } as Extract<EventBody, { type: 'text' }>, snap({ t: 3, chapter: 'ch2', segment: '2-10' }));
    ui.frame(snap({ t: 3.1, chapter: 'ch2', segment: '2-10' }), 0);
    expect(ui.hud.subsEl.children.length).toBe(1);
  });
});

describe('稳度低时节拍点轻颤（absent 段也看得出来）', () => {
  it('steady = 1、follower absent：有颤动类；steady = 3：没有；减少晃动：没有', async () => {
    const base = { t: 3, flashSelf: [-1, -1, -1], flashFollow: [-1, -1, -1], metronome: true, showFollower: true, behindFaded: false, palm: 'none' as const };
    const absent = follower({ mode: 'absent', hud: 'none', voice: 'none' });
    expect(metronome({ ...base, steady: 1, follower: absent, reducedMotion: false }).selfTremble).toBe(true);
    expect(metronome({ ...base, steady: 0, follower: absent, reducedMotion: false }).selfTremble).toBe(true);
    expect(metronome({ ...base, steady: 3, follower: absent, reducedMotion: false }).selfTremble).toBe(false);
    expect(metronome({ ...base, steady: 1, follower: absent, reducedMotion: true }).selfTremble).toBe(false);
    const { ui } = await mountUI();
    ui.show('play');
    ui.frame(snap({ t: 1, steady: 1, follower: absent }), 0);
    expect(ui.hud.selfDots.classList.contains('tremble')).toBe(true);
    ui.frame(snap({ t: 2, steady: 3, follower: absent }), 0);
    expect(ui.hud.selfDots.classList.contains('tremble')).toBe(false);
  });
});

describe('数数与提示的版面', () => {
  it('数数不在底部纵向栈里；每出一个新数，数字和残影都换一次动画类（重新淡入）', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    expect(ui.hud.countEl.parentElement).toBe(ui.hud.root);
    expect(ui.hud.bottom.contains(ui.hud.countEl)).toBe(false);
    ui.cueCount({ type: 'count', from: 1, to: 4, ghostLag: 1 }, snap({ t: 0 }));
    const heel = (t: number) => ui.onEvent(ev('contact', { hand: 'L', part: 'heel', t, s: 0, x: 0, surface: 'terrazzo', crisp: false, heavy: false }), snap({ t }));
    const n = ui.hud.countEl.querySelector('.n') as HTMLElement, g = ui.hud.countEl.querySelector('.ghost') as HTMLElement;
    heel(0.3); ui.frame(snap({ t: 0.3 }), 0);
    const a0 = n.classList.contains('alt');
    heel(0.6); ui.frame(snap({ t: 0.6 }), 0);
    expect(n.textContent).toBe('二'); expect(g.textContent).toBe('一');
    expect(n.classList.contains('alt')).toBe(!a0);
    expect(g.classList.contains('alt')).toBe(!a0);
  });
  it('提示的箭头单独一层（加粗）；文字不变', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    ui.cueHint({ type: 'hint', hint: 'taps3' }, { snap: snap({ t: 1 }), segment: { events: [] } as never });
    ui.frame(snap({ t: 1.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('↓ ↓ ↓');
    expect(ui.hud.hintEl.querySelectorAll('.k').length).toBe(3);
    ui.cueHint({ type: 'hint', hint: 'jump' }, { snap: snap({ t: 2 }), segment: { events: [] } as never });
    ui.frame(snap({ t: 2.1 }), 0);
    expect(ui.hud.hintEl.textContent).toBe('↑ 撑跃');
    expect(ui.hud.hintEl.querySelector('.k')?.textContent).toBe('↑');
  });
});

// 修复轮 B3：5-9「我闭上眼」（11.2 s eyesClosed，压暗 60%）。以前自然看完时压暗一直留到 5-10 结束，跳过 5-9 时（模拟丢掉叠加层 cue）
// 5-10 一开始就是亮的，两种走法不一样。现在：跳过时本段还没到的闭眼按终态应用；下一段开始时都在 1 s 内睁开眼（5-10「我睁开眼。天花板上的裂缝还在。」）。
describe('5-9 eyes closed → 5-10: watched or skipped, 5-10 opens the eyes the same way', () => {
  const ch5 = getChapter('ch5')!;
  const i59 = ch5.segments.findIndex((s) => s.id === '5-9');
  const seg59 = ch5.segments[i59] as { duration: number; events: Array<{ at: number; type: string; op?: string; seconds?: number }> };
  const close = seg59.events.find((e) => e.type === 'overlay' && e.op === 'eyesClosed')!;
  const s = (t: number, segment: string, still: number | null) => snap({ t, chapter: 'ch5', segment, segKind: 'still',
    still: still === null ? null : { set: 'infirmary', variant: segment === '5-9' ? 'bed' : 'ceiling', t: still, duration: 14.3, prompt: null, held: 0 } });
  /** 进 5-10 之后各时刻的压暗（black 层的不透明度）。 */
  const after510 = async (skipAt: number | null): Promise<number[]> => {
    const { ui } = await mountUI();
    ui.show('play');
    const T0 = 500;
    ui.onEvent(ev('chapter:start', { id: 'ch5' }), s(T0, '5-9', 0));
    ui.onEvent(ev('segment', { id: '5-9', index: i59, kind: 'still' }), s(T0, '5-9', 0));
    // 自然播放到 stop（含 11.2 s 的 eyesClosed cue）；skipAt 不为 null 时在那一刻跳过
    const stop = skipAt ?? seg59.duration;
    for (let k = 0; k * 0.1 <= stop + 1e-9; k++) {
      const t = k * 0.1;
      if (Math.abs(t - close.at) < 0.05) ui.cueOverlay({ type: 'overlay', op: 'eyesClosed', seconds: close.seconds ?? 0 }, s(T0 + t, '5-9', t));
      ui.frame(s(T0 + t, '5-9', t), 0);
    }
    if (skipAt !== null) ui.noteSkip();
    const tEnd = T0 + stop;
    ui.onEvent(ev('segment', { id: '5-10', index: i59 + 1, kind: 'still' }), s(tEnd, '5-10', 0));
    return [0, 0.5, EYES_OPEN_SEC, 3].map((dt) => ui.overlays.view(tEnd + dt).black);
  };

  it('5-9 has one eyesClosed (60 %) near its end and nothing after it that clears the screen', () => {
    expect(close.at).toBeGreaterThan(10);
    expect(skippedOverlays('ch5', '5-9', 3.0)).toEqual(['eyesClosed']);
    expect(skippedOverlays('ch5', '5-9', close.at)).toEqual([]);                    // 已经闭上眼了：不再补
    expect(skippedOverlays('ch5', '5-10', 0)).toEqual([]);
    expect(skippedOverlays('ch2', '2-5', 0)).toEqual([]);                           // 掌心发烫是一次性的，不带走
    expect(skippedOverlays('ch4', '4-6', 0)).toEqual(['black']);                    // onDone 里的黑场（章末）
  });

  it('watched to the end and skipped at 3 s / 12 s give the same 5-10: 60 % dark at its start, eyes open within 1 s', async () => {
    const watched = await after510(null);
    expect(watched[0]).toBeCloseTo(0.6, 2);
    expect(watched[1]).toBeCloseTo(0.3, 2);
    expect(watched[2]).toBe(0);
    expect(watched[3]).toBe(0);                                                     // 以前：自然看完 5-10 整段 0.6；跳过时一开始就是 0
    for (const at of [3.0, 11.6, 12.0, 14.0]) expect(await after510(at), `skip at ${at}`).toEqual(watched);   // 11.6 / 12.0：正在闭眼
  });
});

// 修复轮 B3 r2：5-7 → 5-8。站立段的第一帧镜头还在追尾的位置，主角从爬行跳到坐姿，5-7 的同学和马老师按 §5.7 从这一帧起才有上身
// （tests/unit/npc/standCut.test.ts 量过：视锥里有 2 个人当着镜头长出躯干和头）。界面像进出静场一样用 0.4 s 黑场切进去；
// 梦里的站立（4-2 → 4-3）从爬行直接起身，广场上的人一直有上身，照旧无缝；跑段之间永远无缝。
describe('run → sevenSteps stand (5-7 → 5-8) is a black cut; the dream stand and run → run stay seamless', () => {
  it('segmentCut: stills in and out, run → stand unless dream; nothing else', () => {
    expect(segmentCut(null, 'still')).toBe(false);                                 // 读章的第一段
    expect(segmentCut('run', 'run')).toBe(false);
    expect(segmentCut('still', 'still')).toBe(false);
    expect(segmentCut('run', 'still')).toBe(true);
    expect(segmentCut('still', 'run')).toBe(true);
    expect(segmentCut('stand', 'still')).toBe(true);
    expect(segmentCut('run', 'stand', 'sevenSteps')).toBe(true);
    expect(segmentCut('run', 'stand', 'dream')).toBe(false);
    expect(segmentCut('stand', 'run')).toBe(false);
  });

  const enter = async (ch: 'ch4' | 'ch5', from: string, to: string): Promise<{ black: number[]; dom: string }> => {
    const { ui, root } = await mountUI();
    ui.show('play');
    const segs = getChapter(ch)!.segments;
    const i = segs.findIndex((s) => s.id === from);
    const kind = (k: number) => segs[k]!.kind as 'run' | 'still' | 'stand';
    expect(segs[i + 1]?.id).toBe(to);
    const T0 = 300;
    const sn = (t: number, k: number) => snap({ t, chapter: ch, segment: segs[k]!.id, segIndex: k, segKind: kind(k) });
    ui.onEvent(ev('chapter:start', { id: ch }), sn(T0, i));
    ui.onEvent(ev('segment', { id: from, index: i, kind: kind(i) }), sn(T0, i));
    for (let k = 1; k <= 30; k++) ui.frame(sn(T0 + k / 60, i), 1 / 60);
    const t1 = T0 + 0.5 + 1 / 120;
    ui.onEvent(ev('segment', { id: to, index: i + 1, kind: kind(i + 1) }), sn(t1, i + 1));
    ui.frame(sn(t1 + 1 / 120, i + 1), 1 / 60);                                         // 站立段的第一帧（1 tick 之后）
    const dom = (root.querySelector('.hw-black') as HTMLElement).style.opacity;
    return { black: [1 / 120, 0.2, 0.4, 2].map((dt) => ui.overlays.view(t1 + dt).black), dom };
  };

  it('5-7 → 5-8: the first stand frame is black (≥ 0.97 on screen), gone after 0.4 s', async () => {
    const r = await enter('ch5', '5-7', '5-8');
    expect(r.black[0]).toBeGreaterThan(0.97);
    expect(r.black[1]).toBeCloseTo(0.5, 6);
    expect(r.black[2]).toBe(0);
    expect(r.black[3]).toBe(0);
    expect(Number(r.dom)).toBeGreaterThan(0.97);                                       // 画到 DOM 的黑场层上
  });

  it('4-2 → 4-3 (dream): no black at all; the rise stays in view', async () => {
    const r = await enter('ch4', '4-2', '4-3');
    expect(r.black).toEqual([0, 0, 0, 0]);
    expect(Number(r.dom)).toBe(0);
  });
});
