// src/audio/index.ts —— 声音包入口（DESIGN.md §6、§8.7、§8.10 WP7）。CORE 写初版，归 WP7。
// 注册 AudioAPI 工厂：`?mute=1` 或没有 WebAudio 时用 NullAudio（完全不创建 AudioContext，只记录 cue）；
// 否则用 AudioEngine（第一次 pointerdown / keydown 时才创建 AudioContext）。
// 注册 WP7 负责的 cue：bell、sfx、ambience、silence。
// 另外注册一个不画任何东西的「探针」ViewSystem，只为经 ViewContext 拿到 LampField（嗡鸣跟随灯光亮度，§6.2）。
import type { LampFieldAPI } from '../core/contracts';
import { getKit, hasKit, registerAudio, registerCueHandler, registerDebug, registerViewSystem } from '../core/registry';
import type { KitId } from '../core/types';
import { getChapter } from '../levels/chapters/index';
import { AudioEngine } from './Engine';
import { NullAudio, type AudioImpl } from './NullAudio';
import { attachUiSounds } from './ui';

type Ctor<T> = new (...a: never[]) => T;
interface AudioGlobals {
  AudioContext?: Ctor<AudioContext>;
  webkitAudioContext?: Ctor<AudioContext>;
  OfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  webkitOfflineAudioContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

/** 当前的声音实现（cue 处理器与调试钩子用）。 */
export const audioRef: { current: AudioImpl | null } = { current: null };
const probe: { lamps: LampFieldAPI | null } = { lamps: null };

/** 创建声音实现（index 注册的工厂；测试可以直接调用）。 */
export function createAudio(mute: boolean, g: AudioGlobals = globalThis as unknown as AudioGlobals): AudioImpl {
  const AC = g.AudioContext ?? g.webkitAudioContext;
  const OAC = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (mute || !AC || !OAC) return new NullAudio();
  const engine = new AudioEngine({
    createContext: () => new (AC as new (o?: AudioContextOptions) => AudioContext)({ latencyHint: 'interactive' }),
    makeOffline: (ch, len, sr) => new (OAC as new (c: number, l: number, s: number) => OfflineAudioContext)(ch, len, sr),
    lamps: () => probe.lamps,
    chapter: (id) => getChapter(id),
    kitLookup: (kit: KitId, variant: string) => {
      if (!hasKit(kit)) return null;
      const k = getKit(kit);
      return k ? { ambience: k.ambience(variant), reverb: k.reverb(variant) } : null;
    },
  });
  const w = (g as unknown as { addEventListener?: unknown }).addEventListener ? (g as unknown as Window) : null;
  if (w) attachUiSounds(w, (k) => engine.ui(k), () => engine.menuScreen);
  return engine;
}

registerAudio((bus, _settings, mute) => {
  const a = createAudio(mute);
  audioRef.current = a;
  // Game 的屏幕切换只发到 EventBus（不经过 AudioAPI.onEvent）：界面音和结尾卡的静音要靠它
  bus.on('screen', (d) => { if (audioRef.current === a) a.onScreen(d.name); });
  return a;
});
registerCueHandler('bell', 'WP7', (b, c) => audioRef.current?.onBell(b.kind, c.snap));
registerCueHandler('sfx', 'WP7', (b, c) => audioRef.current?.onSfx(b.sfx, b.pan, b.gain, c.snap));
registerCueHandler('ambience', 'WP7', (b, c) => audioRef.current?.onAmbience(b.amb, b.level, b.seconds, c.snap));
registerCueHandler('silence', 'WP7', (b, c) => audioRef.current?.onSilence(b.seconds, c.snap));
registerViewSystem({
  id: 'wp7-audio-probe', owner: 'WP7', order: 99,
  init(ctx) { probe.lamps = ctx.lamps; },
  frame() { /* 不画任何东西 */ },
});
registerDebug('audio', () => audioRef.current?.stats() ?? null);
