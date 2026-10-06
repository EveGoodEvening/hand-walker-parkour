// src/ui/store.ts —— 界面自己的小存档（DESIGN.md §7.3「所有读写都包在 try/catch 里，失败时用默认值照常运行」）。WP8。
// SaveData（CORE 冻结）里没有的两项放这里，键名 `hw-parkour:v1:ui`：
//   · completed：打完的章（§7.2 Chapters「已完成的章在行尾加一道短横线」；第五章没有「下一章」可解锁，只能记在这里）；
//   · habit：「不是成心的，只是习惯。」是否已经出现过（附录 B.5「全作只出现一次」）。
// localStorage 不可用或抛异常时退回内存。已申请把它们并进 SaveData（docs/contract-requests/WP8.md）。
import type { ChapterId } from '../core/types';

export const UI_STORE_KEY = 'hw-parkour:v1:ui';

export interface UiStoreData { completed: ChapterId[]; habit: boolean }

function storage(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
}

export class UiStore {
  private mem: UiStoreData = { completed: [], habit: false };
  constructor() {
    try {
      const raw = storage()?.getItem(UI_STORE_KEY);
      const v = raw ? (JSON.parse(raw) as Partial<UiStoreData>) : null;
      if (v && typeof v === 'object') {
        if (Array.isArray(v.completed)) this.mem.completed = v.completed.filter((c): c is ChapterId => typeof c === 'string');
        this.mem.habit = v.habit === true;
      }
    } catch { /* 用默认值 */ }
  }
  get data(): Readonly<UiStoreData> { return this.mem; }
  patch(p: Partial<UiStoreData>): void {
    this.mem = { ...this.mem, ...p };
    try { storage()?.setItem(UI_STORE_KEY, JSON.stringify(this.mem)); } catch { /* 退回内存 */ }
  }
  reset(): void {
    this.mem = { completed: [], habit: false };
    try { storage()?.removeItem(UI_STORE_KEY); } catch { /* ignore */ }
  }
}
