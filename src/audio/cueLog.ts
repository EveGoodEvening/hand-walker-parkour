// src/audio/cueLog.ts —— 声音 cue 的环形日志（DESIGN.md §6.1「?mute=1 时只把 cue 写进环形日志，供 __game.cues() 读取」）。WP7。
// 静音与出声两种实现用同一套命名，所以 e2e（mute=1）读到的 cue 与真实出声时一致。
import type { GameEvent } from '../core/events';

/** 每拍都会出现的 cue（三段掌声、追随者）：数量大，单独限量，不把稀有的 cue 挤掉。 */
const frequent = (name: string): boolean => name.startsWith('palm:') || name.startsWith('land:') || name.startsWith('follower:');

/**
 * 两个环形：全部 cue 保留最近 cap 条；铃、音效、环境、静音段这类稀有 cue 另外保留最近 rareCap 条。
 * recent(n) 按发生顺序合并（全部环形覆盖不到的更早部分只剩稀有 cue），取最后 n 条——
 * 一章跑完（每掌六条）之后，章首的 bell:morning、sfx:heels 仍然读得到。
 */
export class CueLog {
  private seq = 0;
  private all: Array<[number, string]> = [];
  private rare: Array<[number, string]> = [];
  constructor(private readonly cap = 1024, private readonly rareCap = 1024) {}
  record(name: string): void {
    const e: [number, string] = [this.seq++, name];
    this.all.push(e);
    if (this.all.length > this.cap * 2) this.all = this.all.slice(-this.cap);       // 摊还 O(1)
    if (!frequent(name)) {
      this.rare.push(e);
      if (this.rare.length > this.rareCap * 2) this.rare = this.rare.slice(-this.rareCap);
    }
  }
  recent(n: number): string[] {
    const k = Math.max(0, n);
    if (k === 0) return [];
    const all = this.all.slice(-this.cap);
    const first = all[0]?.[0] ?? this.seq;
    const older = this.rare.slice(-this.rareCap).filter((e) => e[0] < first);
    return older.concat(all).slice(-k).map((e) => e[1]);
  }
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
