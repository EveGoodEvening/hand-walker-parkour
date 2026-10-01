// @vitest-environment happy-dom
// tests/unit/ui/storage.test.ts —— localStorage 抛异常时游戏照常运行（DESIGN.md §7.3；§8.10 WP8 验收 4）。
// 把 window.localStorage 换成一读就抛异常的 getter（隐私模式、被禁用的站点数据），然后走一遍界面：
// 挂载、标题、章节、设置（改值、清除进度）、纸条、HUD（提示写 hintsSeen、纸条翻看写 notesOpened、第一次撞腿写界面存档）、失败卡。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSave, loadSettings, storeSettings } from '../../../src/core/save';
import { UiStore } from '../../../src/ui/store';
import { ev, mountUI, snap } from './helpers';

let restore: (() => void) | null = null;
beforeAll(() => {
  const desc = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  restore = () => { if (desc) { Object.defineProperty(window, 'localStorage', desc); Object.defineProperty(globalThis, 'localStorage', desc); } };
});
afterAll(() => restore?.());

describe('localStorage 抛异常', () => {
  it('前提：访问 localStorage 确实会抛', () => {
    expect(() => (globalThis as { localStorage?: Storage }).localStorage).toThrow();
  });
  it('存档、设置、界面存档都退回内存', () => {
    const s = createSave();
    s.patch({ hintsSeen: ['jump'] });
    expect(s.load().hintsSeen).toEqual(['jump']);
    expect(loadSettings().master).toBe(80);
    expect(() => storeSettings(loadSettings())).not.toThrow();
    const u = new UiStore();
    u.patch({ habit: true });
    expect(u.data.habit).toBe(true);
    expect(() => u.reset()).not.toThrow();
  });
  it('界面全流程不抛异常', async () => {
    const { ui, save, cmd } = await mountUI();
    for (const s of ['title', 'chapters', 'settings', 'notes', 'intro', 'pause', 'outro', 'credits'] as const) {
      expect(() => ui.show(s, s === 'intro' ? { chapter: 'ch1', title: '第一章', name: '早自习', lines: ['x'] }
        : s === 'outro' ? { chapter: 'ch1', stats: { timeMs: 1000, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, next: null, lines: ['x'], notes: null }
          : undefined)).not.toThrow();
    }
    ui.show('settings');
    (document.querySelector('[data-screen="settings"] button[data-key="reset"]') as HTMLButtonElement).click();
    (document.querySelector('[data-screen="settings"] button[data-key="reset"]') as HTMLButtonElement).click();
    expect(cmd.calls).toContain('resetProgress');
    ui.show('play');
    ui.onEvent(ev('chapter:start', { id: 'ch1' }), snap({ t: 0 }));
    ui.cueHint({ type: 'hint', hint: 'jump' }, { snap: snap({ t: 1 }), segment: { events: [] } as never });
    ui.cueNoteOpen({ type: 'noteOpen', note: 'n1-desk' }, snap({ t: 2 }));
    ui.onEvent(ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 1, lane: 0, steady: 2, crowd: false, firstLegHit: true }), snap({ t: 3 }));
    ui.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }), snap({ t: 4 }));
    ui.show('fail', { line: 'x' });
    expect(() => ui.frame(snap({ t: 5.5 }), 0)).not.toThrow();
    expect(save.load().hintsSeen).toContain('jump');
    expect(save.load().notesOpened).toContain('n1-desk');
    expect(ui.store.data.habit).toBe(true);
    expect(ui.failPromptVisible).toBe(true);
  });
});
