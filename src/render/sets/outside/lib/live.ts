// src/render/sets/outside/lib/live.ts —— WP4 set 实例表（DESIGN.md §8.4 StillSet.update）。
// StillSet.update(t, snap) 没有实例参数，所以每个 set 自己记下 build() 建出来的实例；被移出场景（parent 为 null）的实例自动剔除，
// 同时取消它在总线上的订阅。update 是 t 与快照的纯函数（不累加 dt），所以 WP3 的 World 和 WP4 的 outdoor 系统
// 同一帧各调一次也没关系（CORE 的占位 World 不调用 set.update，由 weather/outdoor.ts 代为驱动）。
import type * as THREE from 'three';
import type { SetId, SimSnapshot } from '../../../../core/types';

export interface SetInstance {
  variant: string;
  root: THREE.Object3D;
  update(t: number, snap: SimSnapshot | null): void;
  dispose?(): void;
}

export class InstanceList {
  private items: SetInstance[] = [];
  add(i: SetInstance): void { this.items.push(i); }
  /** 剔除已经不在场景里的实例（World 重新读章时会移除旧的 set）。keep 为 true 的不剔除（刚建好还没挂上去）。 */
  prune(keep?: (i: SetInstance) => boolean): void {
    const out: SetInstance[] = [];
    for (const i of this.items) {
      if (i.root.parent || keep?.(i)) out.push(i);
      else i.dispose?.();
    }
    this.items = out;
  }
  update(t: number, snap: SimSnapshot | null, variant?: string): void {
    for (const i of this.items) if (i.root.parent && (variant === undefined || i.variant === variant)) i.update(t, snap);
  }
  get size(): number { return this.items.length; }
  all(): readonly SetInstance[] { return this.items; }
}

/** WP4 的全部 set：id → 实例表。 */
export const LIVE_SETS = new Map<SetId, InstanceList>();
export function liveList(id: SetId): InstanceList {
  let l = LIVE_SETS.get(id);
  if (!l) { l = new InstanceList(); LIVE_SETS.set(id, l); }
  return l;
}
