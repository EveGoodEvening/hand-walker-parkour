// @vitest-environment happy-dom
// tests/unit/core/game.test.ts —— Game 的流程（U4）：回到标题复位场景、失焦后进入游玩即暂停、自动画质延后切换、不透明界面背后不画 3D。
// 真实的 Sim / Solver / 章节数据；画面、声音、界面、输入用假的（只记录调用）。
import { beforeEach, describe, expect, it } from 'vitest';
import '../../../src/sim/index';
import type { AudioAPI, InputAPI, UIAPI, ViewAPI } from '../../../src/core/contracts';
import type { GameEvent } from '../../../src/core/events';
import { Game } from '../../../src/core/Game';
import { AutoQuality } from '../../../src/core/quality';
import { registerAudio, registerInput, registerUI, registerView } from '../../../src/core/registry';
import type { Action, QualityTier, ScreenName, SimSnapshot } from '../../../src/core/types';
import { CameraRig } from '../../../src/render/camera/CameraRig';

interface Rec { renders: number; resets: number; viewQ: QualityTier[]; uiQ: QualityTier[]; screens: ScreenName[]; skips: number; suspend: boolean[] }
let rec: Rec;

const fakeView = (): ViewAPI => ({
  init: async () => {}, loadChapter: async () => {}, onEvent: () => {}, onReset: () => { rec.resets++; },
  frame: () => {}, render: () => { rec.renders++; }, setQuality: (t) => { rec.viewQ.push(t); },
  perf: () => ({ fps: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, simMs: 0, frameMs: 0 }),
});
const fakeAudio = (): AudioAPI => ({
  enabled: false, unlock: async () => {}, onEvent: () => {}, frame: () => {}, setVolumes: () => {}, suspend: (on) => { rec.suspend.push(on); }, cues: () => [],
});
const fakeUI = (): UIAPI & { setQualityTier(t: QualityTier): void; noteSkip(): void } => ({
  mount: () => {}, show: (s) => { rec.screens.push(s); }, onEvent: () => {}, frame: () => {},
  setQualityTier: (t) => { rec.uiQ.push(t); }, noteSkip: () => { rec.skips++; },
});
const fakeInput = (): InputAPI => {
  const q: Array<{ action: Action; phase: 'down' | 'up'; t: number; device: 'keyboard' }> = [];
  return {
    attach: () => {}, drain: () => q.splice(0), held: () => new Set<Action>(), device: () => 'keyboard',
    setContext: () => {}, setFlip: () => {}, inject: (action, phase) => { q.push({ action, phase, t: 0, device: 'keyboard' }); },
  };
};
registerView(fakeView);
registerAudio(fakeAudio);
registerUI(fakeUI);
registerInput(fakeInput);

type Internals = { autoQ: AutoQuality | null; pendingQ: QualityTier | null; onFrame(a: number, dt: number): void; dispatch(e: GameEvent): void };
const inner = (g: Game) => g as unknown as Internals;

async function booted(): Promise<Game> {
  const g = new Game();
  const c = document.createElement('canvas');
  await g.boot(c, document.createElement('div'), document.createElement('div'));
  g.loop.stop();                    // 只由测试推进
  return g;
}
function steps(g: Game, n: number): void { for (let i = 0; i < n; i++) g.tick(); }
function until(g: Game, pred: () => boolean, max = 120 * 240): boolean {
  for (let i = 0; i < max; i++) { if (pred()) return true; g.tick(); }
  return pred();
}
const segBeats = (g: Game, id: string) => (g.compiled?.segments.find((s) => s.def.id === id)?.def as { beats?: number } | undefined)?.beats ?? 0;

beforeEach(() => {
  rec = { renders: 0, resets: 0, viewQ: [], uiQ: [], screens: [], skips: 0, suspend: [] };
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('回到标题：复位场景（U4）', () => {
  it('从第二章失败卡「返回」：读回首章开头，不是倒地的那一帧；失败、慢放清掉；「继续」的位置不被标题背景覆盖', async () => {
    const g = await booted();
    await g.startWith('ch2', { segment: '2-2', beat: 0, skipCards: true });
    expect(until(g, () => g.screenName === 'fail', 120 * 120)).toBe(true);
    expect(g.next.player.mode).toBe('fall');
    const last = g.save.load().last;
    expect(last?.chapter).toBe('ch2');
    rec.screens = [];
    g.toTitle();
    await g.enterTitle();               // 同一个复位（返回同一个 Promise）
    expect(g.screenName).toBe('title');
    expect(rec.screens).toEqual(['title']);
    expect(g.chapterId).toBe('ch1');
    expect(g.next.segment).toBe('1-1');
    expect(g.next.player.mode).not.toBe('fall');
    expect(g.failing).toBeNull();
    expect(g.loop.slowMul).toBe(1);
    expect(rec.resets).toBeGreaterThan(0);
    expect(g.save.load().last).toEqual(last);
    // 标题上模拟不动
    const t = g.next.t; steps(g, 120); expect(g.next.t).toBe(t);
  });
  it('首章里从暂停「回到标题」：跳回 1-1 开头，恢复声音；之后「开始」正常读章', async () => {
    const g = await booted();
    await g.startWith('ch1', { segment: '1-2', beat: 40, skipCards: true });
    steps(g, 60);
    g.pause(true);
    expect(g.screenName).toBe('pause');
    g.toTitle();
    await g.enterTitle();
    expect(g.screenName).toBe('title');
    expect(g.paused).toBe(false);
    expect(rec.suspend.at(-1)).toBe(false);
    expect(g.next.segment).toBe('1-1');
    expect(g.next.segBeat).toBeCloseTo(0, 6);
    await g.start('ch1');
    expect(g.screenName).toBe('intro');
  });
  it('复位期间 startWith 先等它完成', async () => {
    const g = await booted();
    await g.startWith('ch3', { segment: '3-6', beat: 10, skipCards: true });
    g.toTitle();
    const p = g.startWith('ch2', { skipCards: true });
    await p;
    expect(g.chapterId).toBe('ch2');
    expect(g.screenName).toBe('play');
  });
});

describe('暂停画面', () => {
  it('Esc 暂停和设置页保持镜头机位，继续时不回跳、不补跑暂停时间', async () => {
    const g = await booted();
    await g.startWith('ch1', { segment: '1-2', beat: 15, skipCards: true });
    const rig = new CameraRig();
    rig.onReset(g.next);
    g.view.frame = (p, n, a, dt) => { rig.compute(p, n, a, dt, 16 / 9, g.settings); };
    g.loop.resetClock();
    let now = 0;
    g.loop.frame(now);
    g.loop.frame(now += 17);
    g.loop.frame(now += 17);
    expect(g.next.player.s).toBeGreaterThan(g.prev.player.s);
    g.input.inject('pause', 'down');
    g.loop.frame(now += 17);
    expect(g.screenName).toBe('pause');
    const frozen = [...rig.out.pos.toArray(), ...rig.out.look.toArray(), rig.out.roll, rig.out.fov];
    const hash = g.sim.hash(), t = g.next.t;
    // 覆盖小于一个 tick 的帧，以及跨多个 tick 的帧；暂停菜单仍需处理输入。
    for (const screen of ['pause', 'settings', 'pause'] as const) {
      g.setScreen(screen);
      for (let i = 0; i < 30; i++) {
        for (const ms of [3, 19, 7, 31]) {
          g.loop.frame(now += ms);
          expect([...rig.out.pos.toArray(), ...rig.out.look.toArray(), rig.out.roll, rig.out.fov]).toEqual(frozen);
          expect(g.sim.hash()).toBe(hash);
        }
      }
    }
    g.input.inject('pause', 'down');
    g.loop.frame(now += 17);
    expect(g.screenName).toBe('play');
    expect(rig.out.pos.z).toBeLessThanOrEqual(frozen[2]!);
    g.loop.frame(now += 17);
    g.loop.frame(now += 17);
    expect(g.next.t).toBeGreaterThan(t);
    expect(g.next.t - t).toBeLessThan(0.1);
    expect(rig.out.pos.z).toBeLessThan(frozen[2]!);
  });
});

describe('失焦（U4）', () => {
  it('开场卡期间失焦：开场卡结束时直接暂停；回到前台后照常继续', async () => {
    const g = await booted();
    await g.start('ch1');
    expect(g.screenName).toBe('intro');
    window.dispatchEvent(new Event('blur'));
    expect(g.screenName).toBe('intro');
    expect(until(g, () => g.screenName !== 'intro', 120 * 5)).toBe(true);
    expect(g.screenName).toBe('pause');
    window.dispatchEvent(new Event('focus'));
    g.pause(false);
    expect(g.screenName).toBe('play');
  });
  it('失败卡期间失焦（失败后自动重来）：重来之后是暂停', async () => {
    const g = await booted();
    g.setSetting('autoRetry', true);
    await g.startWith('ch2', { segment: '2-2', beat: 0, skipCards: true });
    expect(until(g, () => g.screenName === 'fail', 120 * 120)).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(until(g, () => g.screenName !== 'fail', 120 * 5)).toBe(true);
    expect(g.screenName).toBe('pause');
    expect(g.failing).toBeNull();
  });
  it('按键或点按也算回到前台', async () => {
    const g = await booted();
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    await g.startWith('ch1', { skipCards: true });
    expect(g.screenName).toBe('play');
  });
});

describe('自动画质（U4）', () => {
  it('跑段中途给出 low：只记下，直到下一个静场 / 站立段开始才切换；重来也会切换', async () => {
    const g = await booted();
    const beats = segBeats(g, '1-3');
    await g.startWith('ch1', { segment: '1-3', beat: Math.max(0, beats - 12), skipCards: true });
    g.autopilot = 'perfect'; g.sim.setAutopilot('perfect');
    inner(g).autoQ = new AutoQuality(true);
    for (let i = 0; i < 120; i++) inner(g).onFrame(1, 0.03);      // 3.6 s，p90 = 30 ms > 24 ms
    expect(inner(g).pendingQ).toBe('low');
    expect(g.quality).toBe('medium');
    expect(rec.viewQ).toEqual([]);
    let sawRunLow = false;
    expect(until(g, () => { if (g.next.segKind === 'run' && g.quality === 'low') sawRunLow = true; return g.next.segKind !== 'run'; }, 120 * 30)).toBe(true);
    expect(sawRunLow).toBe(false);
    expect(g.next.segment).toBe('1-4');
    expect(g.quality).toBe('low');
    expect(rec.viewQ).toEqual(['low']);
    expect(rec.uiQ.at(-1)).toBe('low');
    // 重来时生效
    await g.startWith('ch1', { segment: '1-2', beat: 10, skipCards: true });
    inner(g).pendingQ = 'high';
    steps(g, 10);
    expect(g.quality).toBe('low');
    g.retry();
    expect(g.quality).toBe('high');
  });
  it('梦里的站立（4-2 → 4-3）没有黑场切，不在那里切档；留到 4-4 的静场', async () => {
    const g = await booted();
    const beats = segBeats(g, '4-2');
    await g.startWith('ch4', { segment: '4-2', beat: Math.max(0, beats - 10), skipCards: true });
    g.autopilot = 'perfect'; g.sim.setAutopilot('perfect');
    inner(g).pendingQ = 'low';
    expect(until(g, () => g.next.segment === '4-3', 120 * 30)).toBe(true);
    steps(g, 2);
    expect(g.next.segKind).toBe('stand');
    expect(g.quality).toBe('medium');
    expect(rec.viewQ).toEqual([]);
    expect(until(g, () => g.next.segment === '4-4', 120 * 60)).toBe(true);
    steps(g, 2);
    expect(g.quality).toBe('low');
    expect(rec.viewQ).toEqual(['low']);
  });
  it('设置里选「自动」：重新开始统计（autoQ 不为空）；手选档位：立即生效、不再自动', async () => {
    const g = await booted();
    g.setSetting('quality', 'low');
    expect(g.quality).toBe('low');
    expect(inner(g).autoQ).toBeNull();
    g.setSetting('quality', 'auto');
    expect(inner(g).autoQ).not.toBeNull();
    expect(inner(g).autoQ?.done).toBe(false);
    expect(g.quality).toBe('medium');
    expect(rec.uiQ.at(-1)).toBe('medium');
  });
});

describe('不透明界面背后不画 3D（U4）', () => {
  it('outro / intro / credits / boot 不调 view.render；play、title、pause 照常；test 模式照常', async () => {
    const g = await booted();
    const at = (s: ScreenName) => { g.screenName = s; rec.renders = 0; g.renderFrame(1, 0.016); return rec.renders; };
    expect(at('outro')).toBe(0);
    expect(at('intro')).toBe(0);
    expect(at('credits')).toBe(0);
    expect(at('boot')).toBe(0);
    expect(at('play')).toBe(1);
    expect(at('title')).toBe(1);
    expect(at('pause')).toBe(1);
    g.loop.manual = true;
    expect(at('outro')).toBe(1);
  });
});

describe('跳过静场：先通知界面（U4）', () => {
  it('skipStill 在跳过之前调用 ui.noteSkip', async () => {
    const g = await booted();
    await g.startWith('ch1', { segment: '1-4', beat: 0, skipCards: true });
    expect(g.next.segKind).toBe('still');
    g.skipStill();
    expect(rec.skips).toBe(1);
    expect(g.next.segment).toBe('1-5');
    const snap: SimSnapshot = g.next;
    expect(snap.segKind).toBe('run');
  });
});
