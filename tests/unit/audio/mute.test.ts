// @vitest-environment happy-dom
// tests/unit/audio/mute.test.ts —— 静音与解锁（DESIGN.md §6.1、§8.8 `mute=1`、§8.10 WP7 验收 6）。WP7。
// `?mute=1` 时完全不创建 AudioContext（也不创建 OfflineAudioContext），只把 cue 写进环形日志；
// 不静音时也要等第一次 pointerdown / keydown（Game 调 unlock）才创建，并在 iOS 上先播一段静音 buffer。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../../src/audio/Engine';
import { NullAudio } from '../../../src/audio/NullAudio';
import { EventBus } from '../../../src/core/bus';
import { getAudioFactory } from '../../../src/core/registry';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import type { GameEvent } from '../../../src/core/events';
import { createAudio } from '../../../src/audio/index';
import { MiniContext } from './offline/mini';
import { ev, snap } from './scenarios';

/** 计数用的构造器桩：真的造出一个最小 context（引擎建图要用），同时记下被 new 了几次。 */
function spies() {
  const made = { rt: 0, off: 0 };
  class RT extends MiniContext {
    resumed = 0; suspended = 0; started = 0;
    constructor() { super(2, 16000, 16000); made.rt++; }   // 低采样率：这里只测接线，库渲染快一些
    override resume(): Promise<void> { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    override suspend(): Promise<void> { this.suspended++; this.state = 'suspended'; return Promise.resolve(); }
  }
  class OFF extends MiniContext { constructor(c: number, l: number, s: number) { super(c, l, s); made.off++; } }
  const rt = vi.fn(RT), off = vi.fn(OFF);
  return { made, AudioContext: rt as unknown as typeof AudioContext, OfflineAudioContext: off as unknown as typeof OfflineAudioContext, rt, off };
}

const events = (): GameEvent[] => [
  ev('chapter:start', { id: 'ch1' }, 0),
  ev('segment', { id: '1-1', index: 0, kind: 'run' }, 0),
  ev('contact', { hand: 'L', part: 'heel', t: 0.1, s: 0, x: 0, surface: 'terrazzo', crisp: true, heavy: false }, 0.1),
  ev('followerContact', { hand: 'L', part: 'heel', t: 0.2, lagBeats: 0.5, steady: 3, from: 'behind' }, 0.2),
  ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 3, lane: 0, steady: 2, crowd: true, firstLegHit: true }, 0.3),
  ev('fall', { cause: 'legs', surface: 'terrazzo' }, 0.4),
  ev('cue', { body: { type: 'rain', intensity: 0.6, seconds: 1 }, segment: '1-1' }, 0.5),
];

afterEach(() => { vi.unstubAllGlobals(); });

describe('验收 6：mute=1 时不创建 AudioContext', () => {
  it('createAudio(mute = true)：NullAudio；解锁、事件、cue、帧、音量、暂停都不碰 AudioContext / OfflineAudioContext', async () => {
    const s = spies();
    const a = createAudio(true, { AudioContext: s.AudioContext, OfflineAudioContext: s.OfflineAudioContext });
    expect(a).toBeInstanceOf(NullAudio);
    expect(a.enabled).toBe(false);
    await a.unlock();
    for (const e of events()) a.onEvent(e, snap({ t: e.tick / 120 }));
    a.frame(snap({ t: 0.6, hush: true }), 1 / 60);
    a.onBell('morning', snap({ t: 0.7 }));
    a.onSfx('shush', -0.3, undefined, snap({ t: 0.7 }));
    a.onAmbience('reading', 1, 1, snap({ t: 0.7 }));
    a.onSilence(1, snap({ t: 0.7 }));
    a.setVolumes({ master: 50, sfx: 50, ambience: 50 });
    a.suspend(true); a.suspend(false);
    expect(s.rt).not.toHaveBeenCalled();
    expect(s.off).not.toHaveBeenCalled();
    // cue 照常记录（e2e 用 __game.cues() 读）
    expect(a.cues(50)).toEqual(['palm:heel', 'follower:heel', 'hit:stumble', 'quietSecond', 'kneeThud', 'rain:0.6', 'hush',
      'bell:morning', 'sfx:shush', 'ambience:reading', 'silence:1']);
  });

  it('经注册表走 Game 的路径（registerAudio 的工厂，mute = true）：全局 AudioContext 一次也没被 new', async () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('webkitAudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    const f = getAudioFactory();
    expect(f).toBeTypeOf('function');
    const bus = new EventBus();
    const a = (f as NonNullable<typeof f>)(bus, { ...DEFAULT_SETTINGS }, true);
    await a.unlock();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    bus.emit('screen', { name: 'title' });
    for (const e of events()) a.onEvent(e, snap({ t: e.tick / 120 }));
    a.frame(snap({ t: 1 }), 1 / 60);
    expect(s.rt).not.toHaveBeenCalled();
    expect(s.off).not.toHaveBeenCalled();
    expect(a.enabled).toBe(false);
  });

  it('浏览器没有 WebAudio 时同样回落到 NullAudio', () => {
    expect(createAudio(false, {})).toBeInstanceOf(NullAudio);
  });
});

describe('不静音：第一次手势时才创建 AudioContext（§6.1 iOS 解锁）', () => {
  it('工厂只造引擎不造 context；unlock 时 new 一次、先播一段 1 样本的静音 buffer、再 resume；重复解锁不再 new', async () => {
    const s = spies();
    const a = createAudio(false, { AudioContext: s.AudioContext, OfflineAudioContext: s.OfflineAudioContext });
    expect(a).toBeInstanceOf(AudioEngine);
    for (const e of events()) a.onEvent(e, snap({ t: e.tick / 120 }));
    expect(s.rt).not.toHaveBeenCalled();
    expect(a.cues(3)).toEqual(['quietSecond', 'kneeThud', 'rain:0.6']);   // 解锁前也记录
    await a.unlock();
    expect(s.rt).toHaveBeenCalledTimes(1);
    const eng = a as AudioEngine;
    const ctx = eng.ctx as unknown as MiniContext & { resumed: number; suspended: number };
    expect(ctx.resumed).toBe(1);
    const silent = ctx.sources.find((x) => (x as unknown as { buffer?: { length: number } }).buffer?.length === 1);
    expect(silent).toBeDefined();
    await a.unlock();
    expect(s.rt).toHaveBeenCalledTimes(1);
    await eng.ready;
    expect(eng.libraryReady).toBe(true);
    expect(s.off).toHaveBeenCalled();                                     // 预渲染与压缩器校准用离线 context
    // 暂停 / 失焦：ctx.suspend()；继续：resume()
    a.suspend(true);
    expect(ctx.suspended).toBe(1);
    a.suspend(false);
    expect(ctx.resumed).toBe(2);
    expect(eng.stats().errors).toBe(0);
  }, 60_000);

  it('解锁前的状态（地点、雨、失败）在建图时一次性补上', async () => {
    const s = spies();
    const a = createAudio(false, { AudioContext: s.AudioContext, OfflineAudioContext: s.OfflineAudioContext }) as AudioEngine;
    a.onEvent(ev('chapter:start', { id: 'ch1' }, 0), snap({ t: 0, chapter: 'ch1' }));
    a.onEvent(ev('segment', { id: '1-1', index: 0, kind: 'run' }, 0), snap({ t: 0, chapter: 'ch1' }));
    await a.unlock();
    await a.ready;
    expect(a.stats().reverb).toBe('classroom');
    expect(a.stats().ambience).toBe('reading');
  }, 60_000);

  it('屏幕切换经 EventBus 到达引擎；菜单屏幕里方向键 / 回车发界面音', async () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    const bus = new EventBus();
    const f = getAudioFactory() as NonNullable<ReturnType<typeof getAudioFactory>>;
    const a = f(bus, { ...DEFAULT_SETTINGS }, false) as AudioEngine;
    await a.unlock();
    bus.emit('screen', { name: 'title' });
    expect(a.screen).toBe('title');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await new Promise((r) => setTimeout(r, 50));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(a.cues(2)).toEqual(['ui:move', 'ui:confirm']);
    bus.emit('screen', { name: 'play' });
    await new Promise((r) => setTimeout(r, 50));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(a.cues(1)).toEqual(['ui:confirm']);                           // 游玩中不发界面音
  }, 60_000);
});

describe('§6.1 失焦 / 隐藏时 ctx.suspend()：任何屏幕都生效（不只游玩屏幕）', () => {
  type Spy = MiniContext & { resumed: number; suspended: number };
  const boot = async () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    const bus = new EventBus();
    const f = getAudioFactory() as NonNullable<ReturnType<typeof getAudioFactory>>;
    const a = f(bus, { ...DEFAULT_SETTINGS }, false) as AudioEngine;
    bus.emit('screen', { name: 'title' });
    await a.unlock();
    await a.ready;
    return { a, bus, ctx: a.ctx as unknown as Spy };
  };

  it('标题屏：窗口失焦 → suspend；重新获得焦点 → resume', async () => {
    const { a, ctx } = await boot();
    expect(ctx.state).toBe('running');
    window.dispatchEvent(new Event('blur'));
    expect(ctx.suspended).toBe(1);
    expect(ctx.state).toBe('suspended');
    expect(a.stats().suspended).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(ctx.resumed).toBe(2);
    expect(ctx.state).toBe('running');
  }, 60_000);

  it('章节 / 设置屏：标签页隐藏 → suspend；可见 → resume', async () => {
    const { bus, ctx } = await boot();
    bus.emit('screen', { name: 'chapters' });
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(ctx.suspended).toBe(1);
      bus.emit('screen', { name: 'settings' });
      expect(ctx.state).toBe('suspended');                                // 换屏幕不会把隐藏的标签页唤醒
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      expect(ctx.resumed).toBe(2);
    } finally { Reflect.deleteProperty(document, 'hidden'); }
  }, 60_000);

  it('游玩中失焦：Game 暂停（suspend(true)）+ 失焦；重新获得焦点时仍在暂停菜单，不恢复；继续游戏才恢复', async () => {
    const { a, bus, ctx } = await boot();
    bus.emit('screen', { name: 'play' });
    window.dispatchEvent(new Event('blur'));                             // Game.autoPause：先切到暂停屏，再 suspend(true)
    bus.emit('screen', { name: 'pause' });
    a.suspend(true);
    expect(ctx.suspended).toBe(1);
    window.dispatchEvent(new Event('focus'));
    expect(ctx.state).toBe('suspended');
    bus.emit('screen', { name: 'play' });                                // Game.pause(false)：先切屏，再 suspend(false)
    a.suspend(false);
    expect(ctx.state).toBe('running');
    expect(ctx.resumed).toBe(2);
  }, 60_000);

  it('暂停菜单里「重来」「回到标题」：Game 不调 suspend(false)，离开暂停屏幕就恢复', async () => {
    const { a, bus, ctx } = await boot();
    for (const next of ['play', 'title'] as const) {
      bus.emit('screen', { name: 'play' });
      bus.emit('screen', { name: 'pause' });
      a.suspend(true);
      expect(ctx.state).toBe('suspended');
      bus.emit('screen', { name: 'settings' });                          // 暂停菜单里的设置：仍然暂停
      expect(ctx.state).toBe('suspended');
      bus.emit('screen', { name: next });
      expect(ctx.state, next).toBe('running');
    }
  }, 60_000);

  it('设置「减少闪烁」经工厂的初始设置和 EventBus 的 settings 到达引擎（回退的灯光模型不再闪）', () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    const bus = new EventBus();
    const f = getAudioFactory() as NonNullable<ReturnType<typeof getAudioFactory>>;
    const a = f(bus, { ...DEFAULT_SETTINGS, reducedFlicker: true }, false) as AudioEngine;
    const lights = (a as unknown as { lights: { reducedFlicker: boolean } }).lights;
    expect(lights.reducedFlicker).toBe(true);
    bus.emit('settings', { ...DEFAULT_SETTINGS, reducedFlicker: false });
    expect(lights.reducedFlicker).toBe(false);
  });

  it('mute = 1：失焦、隐藏都不创建 AudioContext', () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    const f = getAudioFactory() as NonNullable<ReturnType<typeof getAudioFactory>>;
    const a = f(new EventBus(), { ...DEFAULT_SETTINGS }, true);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    a.suspend(true); a.suspend(false);
    expect(s.rt).not.toHaveBeenCalled();
    expect(s.off).not.toHaveBeenCalled();
  });
});

describe('U3：第四章结尾卡上的 ↓ 是床单声，不是菜单的「移动」声', () => {
  it('结尾卡等输入时按 ↓：只排床单声（界面总线），不排「移动」；输入结束后 ↓ 在按钮之间移动，照常有「移动」声', async () => {
    const s = spies();
    vi.stubGlobal('AudioContext', s.AudioContext);
    vi.stubGlobal('OfflineAudioContext', s.OfflineAudioContext);
    // 界面（UI.ts）的 keydown 挂在 window 的冒泡阶段，而且这里比声音包先注册：声音包在 capture 阶段，照样先看到按键
    let a: AudioEngine | null = null;
    let waiting = true;
    const uiKey = (e: KeyboardEvent) => {
      // OutroScreen.press → Game.outroInput → sfx cue cloth（gain −4 dB）→ 声音包
      if (waiting && e.key === 'ArrowDown' && a) a.onSfx('cloth', undefined, Math.pow(10, -4 / 20), snap({ t: 1 }));
    };
    window.addEventListener('keydown', uiKey);
    try {
      const bus = new EventBus();
      const f = getAudioFactory() as NonNullable<ReturnType<typeof getAudioFactory>>;
      a = f(bus, { ...DEFAULT_SETTINGS }, false) as AudioEngine;
      await a.unlock();
      await a.ready;
      bus.emit('screen', { name: 'outro' });
      const press = async (key: string) => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
      };
      for (let i = 0; i < 3; i++) await press('ArrowDown');
      expect(a.scheduled.filter((x) => x.key === 'uiMove')).toEqual([]);
      expect(a.scheduled.filter((x) => x.key === 'cloth').map((x) => x.bus)).toEqual(['ui', 'ui', 'ui']);
      expect(a.cues(3)).toEqual(['sfx:cloth', 'sfx:cloth', 'sfx:cloth']);
      waiting = false;                                                      // 三下按完（或超时）：↓ 回到按钮之间移动
      await press('ArrowDown');
      await press('ArrowUp');
      expect(a.cues(2)).toEqual(['ui:move', 'ui:move']);
      expect(a.scheduled.filter((x) => x.key === 'uiMove').length).toBe(2);
      bus.emit('screen', { name: 'title' });                                // 别的菜单：↓ 立刻发「移动」，不推迟
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(a.cues(1)).toEqual(['ui:move']);
    } finally { window.removeEventListener('keydown', uiKey); }
  }, 60_000);
});
