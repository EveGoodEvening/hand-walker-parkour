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
