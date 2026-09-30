// src/audio/cueLog.ts —— 声音 cue 的环形日志（DESIGN.md §6.1「?mute=1 时只把 cue 写进环形日志，供 __game.cues() 读取」）。WP7。
// 静音与出声两种实现用同一套命名，所以 e2e（mute=1）读到的 cue 与真实出声时一致。
import type { GameEvent } from '../core/events';

export class CueLog {
  private ring: string[] = [];
  constructor(private readonly cap = 1024) {}
  record(name: string): void {
    this.ring.push(name);
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
  }
  recent(n: number): string[] { return this.ring.slice(-Math.max(0, n)); }
}

/** 一个模拟事件对应的声音 cue 名（没有声音的事件返回空数组）。 */
export function cueNames(e: GameEvent): string[] {
  switch (e.type) {
    case 'contact': return [`${e.data.heavy ? 'land' : 'palm'}:${e.data.part}`];
    case 'followerContact': return [`follower:${e.data.part}`];
    case 'hit': return e.data.crowd ? [`hit:${e.data.severity}`, 'quietSecond'] : [`hit:${e.data.severity}`];
    case 'fall': return ['kneeThud'];
    case 'lookBack': return e.data.phase === 'start' ? ['followerSilence'] : [];
    case 'twitch': return e.data.phase === 'warn' ? ['muscle'] : [];
    case 'drift': return e.data.phase === 'warn' ? ['muscle'] : [];
    case 'stand': return e.data.phase === 'step' ? ['step'] : e.data.phase === 'fall' ? ['kneeThud'] : [];
    case 'nearMiss': return ['cloth'];
    case 'ask': return ['whisper', 'laughShort'];
    case 'note': return ['paper'];
    case 'cue': {
      const b = e.data.body;
      switch (b.type) {
        case 'text': return b.style === 'whisper' ? ['whisper'] : [];
        case 'rain': return [`rain:${b.intensity}`];
        case 'lights': return [`lights:${b.op}`];
        case 'board': return [b.op === 'write' ? 'chalk' : 'wipe'];
        case 'noteOpen': return ['paper'];
        default: return [];
      }
    }
    default: return [];
  }
}
