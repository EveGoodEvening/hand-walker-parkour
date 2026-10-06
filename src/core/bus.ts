// src/core/bus.ts —— 事件总线（DESIGN.md §8.3、§8.4 Bus）。CORE 冻结。
// 同步分发；处理器抛错不会中断其他处理器（错误写到 console.error）。
import type { Bus, GameEventName, GameEvents } from './events';

type Handler = (d: never, tick: number) => void;

export class EventBus implements Bus {
  /** 当前 tick；Game 在分发模拟事件前写入。 */
  tick = 0;
  private map = new Map<GameEventName, Set<Handler>>();

  on<K extends GameEventName>(k: K, fn: (d: GameEvents[K], tick: number) => void): () => void {
    let set = this.map.get(k);
    if (!set) { set = new Set(); this.map.set(k, set); }
    set.add(fn as Handler);
    return () => { set?.delete(fn as Handler); };
  }

  emit<K extends GameEventName>(k: K, d: GameEvents[K]): void {
    const set = this.map.get(k);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { (fn as (d: GameEvents[K], tick: number) => void)(d, this.tick); } catch (err) { console.error(`[bus] ${k} handler failed`, err); }
    }
  }

  clear(): void { this.map.clear(); }
}
