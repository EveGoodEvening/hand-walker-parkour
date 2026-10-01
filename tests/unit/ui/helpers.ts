// tests/unit/ui/helpers.ts —— WP8 单元测试的公共工具：假的快照、假的 GameCommands、事件构造。
import type { GameCommands } from '../../../src/core/contracts';
import type { GameEvent, GameEventName, GameEvents } from '../../../src/core/events';
import { createSave } from '../../../src/core/save';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/core/settings';
import type { FollowerSnap, SimSnapshot } from '../../../src/core/types';

export function follower(p: Partial<FollowerSnap> = {}): FollowerSnap {
  return { mode: 'behind', voice: 'echo', hud: 'dots', from: 'behind', lagBeats: 0.5, distance: 0, leaderS: null, leaderLane: null, ...p };
}

export function snap(p: Partial<SimSnapshot> & { steady?: number; stand?: SimSnapshot['player']['stand'] } = {}): SimSnapshot {
  const { steady, stand, ...rest } = p;
  return {
    tick: 0, t: 0, chapter: 'ch1', segment: '1-5', segIndex: 4, segKind: 'run', segBeat: 0,
    checkpoint: { segment: '1-5', beat: 0 },
    player: {
      s: 0, x: 0, y: 0, floorY: 0, lane: 0, laneTarget: 0, mode: 'crawl', modeT: 0, speed: 5, cadence: 5, stride: 1, beat: 0,
      airT: 0, duck: 0, twitch: 0, drift: 0, steady: steady ?? 3, steadyMax: 3, graceT: 0, surface: 'terrazzo',
      hitbox: { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 }, lookBack: 0, carrying: 'none', stand: stand ?? null,
    },
    follower: follower(), still: null, hush: false, flip: false, slowOption: false,
    stats: { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] }, beatsFired: [],
    ...rest,
  };
}

export function ev<K extends GameEventName>(type: K, data: GameEvents[K], tick = 0): GameEvent {
  return { type, tick, data } as GameEvent;
}

export interface FakeCmd extends GameCommands { calls: string[] }
export function fakeCmd(): FakeCmd {
  const calls: string[] = [];
  const rec = (name: string) => (...a: unknown[]) => { calls.push(a.length ? `${name}:${a.map((x) => JSON.stringify(x)).join(',')}` : name); };
  return {
    calls,
    start: async (...a: unknown[]) => { rec('start')(...a); },
    continueGame: async () => { rec('continueGame')(); },
    retry: rec('retry'), pause: rec('pause') as (on: boolean) => void, toTitle: rec('toTitle'), nextChapter: rec('nextChapter'),
    setSetting: rec('setSetting') as GameCommands['setSetting'], resetProgress: rec('resetProgress'), skipStill: rec('skipStill'),
    setSlowOption: rec('setSlowOption') as (on: boolean) => void,
  } as FakeCmd;
}

export function settings(p: Partial<Settings> = {}): Settings { return { ...DEFAULT_SETTINGS, ...p }; }

/** 挂一个 UI（happy-dom 环境）。 */
export async function mountUI(o: { settings?: Partial<Settings> } = {}) {
  const { UI } = await import('../../../src/ui/UI');
  document.body.replaceChildren();
  const app = document.createElement('div'); app.id = 'app';
  const canvas = document.createElement('canvas'); canvas.id = 'game';
  const root = document.createElement('div'); root.id = 'ui';
  app.append(canvas, root);
  document.body.appendChild(app);
  const ui = new UI();
  const cmd = fakeCmd();
  const save = createSave();
  ui.mount(root, cmd, save);
  ui.onEvent(ev('settings', settings(o.settings)), snap());
  return { ui, cmd, save, root, canvas, app };
}

export const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));
