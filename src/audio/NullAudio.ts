// src/audio/NullAudio.ts —— 静音实现（DESIGN.md §6.1、§8.8 `mute=1`）。CORE 写初版，归 WP7。
// 不创建 AudioContext（也不创建 OfflineAudioContext），不出声，只把 cue 写进环形日志（__game.cues() 读取）。
// `?mute=1`、或者浏览器没有 WebAudio 时使用。cue 命名与 WebAudio 实现一致（cueLog.ts）。
import type { AudioAPI, Volumes } from '../core/contracts';
import type { GameEvent } from '../core/events';
import type { AmbienceId, BellKind, SfxId, SimSnapshot } from '../core/types';
import { CueLog, cueNames } from './cueLog';

/** 两种实现共有的 cue 处理入口（index.ts 注册的 bell / sfx / ambience / silence 处理器调用它们）。 */
export interface AudioImpl extends AudioAPI {
  onBell(kind: BellKind, snap: SimSnapshot): void;
  onSfx(sfx: SfxId, pan: number | undefined, gain: number | undefined, snap: SimSnapshot): void;
  onAmbience(amb: AmbienceId, level: number, seconds: number, snap: SimSnapshot): void;
  onSilence(seconds: number, snap: SimSnapshot): void;
  /** 屏幕切换（Game 只发到 EventBus，index.ts 订阅后转过来）。 */
  onScreen(name: string): void;
  /** 窗口失焦或标签页隐藏（index.ts 监听 blur / focus / visibilitychange）：挂起 AudioContext。 */
  background(on: boolean): void;
  /** 设置「减少闪烁」（index.ts 从 EventBus 的 settings 转过来）。 */
  setReducedFlicker(on: boolean): void;
  /** 调试信息（__game.ext.audio）。 */
  stats(): Record<string, unknown>;
}

export class NullAudio implements AudioImpl {
  readonly enabled = false;
  private readonly log = new CueLog();
  private hush = false;
  volumes: Volumes = { master: 80, sfx: 90, ambience: 70 };

  async unlock(): Promise<void> { /* 静音：不创建 AudioContext */ }

  /** 记录一个 cue 名。 */
  record(name: string): void { this.log.record(name); }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    for (const n of cueNames(e)) this.log.record(n);
    this.observe(snap);
  }
  frame(snap: SimSnapshot, _dt: number): void { this.observe(snap); }
  private observe(snap: SimSnapshot | undefined): void {
    if (!snap) return;
    if (snap.hush !== this.hush) { this.hush = snap.hush; if (snap.hush) this.log.record('hush'); }
  }
  setVolumes(v: Volumes): void { this.volumes = { ...v }; }
  suspend(_on: boolean): void { /* 静音 */ }
  cues(n: number): string[] { return this.log.recent(n); }

  onBell(kind: BellKind): void { this.log.record(`bell:${kind}`); }
  onSfx(sfx: SfxId): void { this.log.record(`sfx:${sfx}`); }
  onAmbience(amb: AmbienceId): void { this.log.record(`ambience:${amb}`); }
  onSilence(seconds: number): void { this.log.record(`silence:${seconds}`); }
  onScreen(_name: string): void { /* 静音：没有界面音 */ }
  background(_on: boolean): void { /* 静音 */ }
  setReducedFlicker(_on: boolean): void { /* 静音 */ }
  stats(): Record<string, unknown> { return { enabled: false, context: false }; }
}
