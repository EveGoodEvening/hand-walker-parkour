// src/core/cues.ts —— 表现类 cue 分发器（DESIGN.md §8.7）。CORE 冻结。
// 每种 cue 只有一个处理者（CUE_OWNER）；处理者由各包 registerCueHandler 注册。
// 还没有处理者的 cue 走默认处理器：写进环形日志（__game.ext.unhandledCues 可读），不抛错。
import { CUE_OWNER } from './constants';
import type { GameEvents } from './events';
import { getCueHandler, type CueContext } from './registry';

export interface CueLogEntry { type: string; segment: string; id?: string; handled: boolean; owner: string }

export class CueDispatcher {
  private ring: CueLogEntry[] = [];
  private readonly cap = 512;
  verbose = false;

  dispatch(cue: GameEvents['cue'], ctx: CueContext): void {
    const type = cue.body.type;
    const h = getCueHandler(type);
    const entry: CueLogEntry = { type, segment: cue.segment, handled: !!h, owner: CUE_OWNER[type] };
    if (cue.id !== undefined) entry.id = cue.id;
    this.push(entry);
    if (!h) {
      if (this.verbose) console.debug(`[cue] unhandled ${type} (owner ${CUE_OWNER[type]})`, cue.body);
      return;
    }
    try {
      (h.fn as (b: typeof cue.body, c: CueContext) => void)(cue.body, ctx);
    } catch (err) {
      console.error(`[cue] handler for ${type} failed`, err);
    }
  }

  private push(e: CueLogEntry): void {
    this.ring.push(e);
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
  }

  /** 最近 n 条（默认全部）。 */
  recent(n = this.cap): CueLogEntry[] { return this.ring.slice(-n); }
  unhandled(n = this.cap): CueLogEntry[] { return this.ring.filter((e) => !e.handled).slice(-n); }
  clear(): void { this.ring = []; }
}
