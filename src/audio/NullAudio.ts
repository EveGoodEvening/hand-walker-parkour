// src/audio/NullAudio.ts —— 静音占位（DESIGN.md §6.1、§8.9-10）。CORE 写初版，之后归 WP7。
// 不创建 AudioContext，不出声，只把 cue 写进环形日志（__game.cues() 读取）。`?mute=1` 时 WP7 也应该用它。
import type { AudioAPI, Volumes } from '../core/contracts';
import type { GameEvent } from '../core/events';
import type { SimSnapshot } from '../core/types';

export class NullAudio implements AudioAPI {
  readonly enabled = false;
  private ring: string[] = [];
  private readonly cap = 1024;
  volumes: Volumes = { master: 80, sfx: 90, ambience: 70 };

  async unlock(): Promise<void> { /* 静音：无需解锁 */ }

  /** 记录一个 cue 名。 */
  record(name: string): void {
    this.ring.push(name);
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
  }

  onEvent(e: GameEvent, _snap: SimSnapshot): void {
    switch (e.type) {
      case 'contact': this.record(`${e.data.heavy ? 'land' : 'palm'}:${e.data.part}`); break;
      case 'followerContact': this.record(`follower:${e.data.part}`); break;
      case 'hit': this.record(`hit:${e.data.severity}`); break;
      case 'fall': this.record('kneeThud'); break;
      case 'lookBack': if (e.data.phase === 'start') this.record('followerSilence'); break;
      default: break;
    }
  }
  frame(_snap: SimSnapshot, _dt: number): void { /* 静音 */ }
  setVolumes(v: Volumes): void { this.volumes = { ...v }; }
  suspend(_on: boolean): void { /* 静音 */ }
  cues(n: number): string[] { return this.ring.slice(-Math.max(0, n)); }
}

/** 当前的 NullAudio 实例（cue 处理器写日志用）。 */
export const nullAudioRef: { current: NullAudio | null } = { current: null };
