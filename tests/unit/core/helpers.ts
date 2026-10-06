// tests/unit/core/helpers.ts —— 单元测试工具：造一章、跑模拟。CORE。
import type { GameEvent } from '../../../src/core/events';
import type { Action, InputEvent } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, RunSegmentDef, SegmentDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';

export function runSeg(o: Partial<RunSegmentDef> = {}): RunSegmentDef {
  return {
    id: 's1', kind: 'run', kit: 'placeholder', variant: 'default', atmosphere: 'morning', surface: 'terrazzo',
    beats: 200, stride: 1, cadence: 4.8, follower: { mode: 'behind', steady: 3 }, ...o,
  };
}

export function chapter(segments: SegmentDef[], o: Partial<ChapterDef> = {}): ChapterDef {
  return {
    id: 'test', title: '测试', name: '测试', seed: 7, card: ['c1.card'], outro: { lines: [] }, notes: [], requiredBeats: [],
    segments, ...o,
  };
}

/** 驱动一个 Sim：按 tick 注入动作，记录全部事件。 */
export class Driver {
  readonly sim = new Sim(solver);
  readonly events: GameEvent[] = [];
  private held = new Set<Action>();
  private pending: InputEvent[] = [];
  constructor(def: ChapterDef, at?: { segment: string; beat: number }, seed?: number) {
    this.sim.load(compile(def, seed), at, seed);
    this.events.push(...this.sim.drain());
  }
  get snap() { return this.sim.snapshot(); }
  press(a: Action): this { this.pending.push({ action: a, phase: 'down', t: this.snap.t * 1000, device: 'keyboard' }); this.held.add(a); return this; }
  release(a: Action): this { this.pending.push({ action: a, phase: 'up', t: this.snap.t * 1000, device: 'keyboard' }); this.held.delete(a); return this; }
  tap(a: Action): this { this.press(a); this.stepOne(); this.release(a); return this; }
  stepOne(): GameEvent[] {
    const evs = this.pending; this.pending = [];
    this.sim.step(evs, this.held);
    const out = this.sim.drain();
    this.events.push(...out);
    return out;
  }
  step(n: number): this { for (let i = 0; i < n; i++) this.stepOne(); return this; }
  /** 推进直到条件成立（最多 max tick），返回用掉的 tick 数；不成立返回 -1。 */
  until(pred: () => boolean, max = 120 * 120): number {
    for (let i = 0; i < max; i++) { if (pred()) return i; this.stepOne(); }
    return pred() ? max : -1;
  }
  of<T extends GameEvent['type']>(type: T): Array<Extract<GameEvent, { type: T }>> {
    return this.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
  }
}
