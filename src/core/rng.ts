// src/core/rng.ts —— 确定性随机数（DESIGN.md §8.3）。CORE 冻结。
// mulberry32；种子 = hash(chapter.seed, segment.id)。rng.sim / rng.bot / rng.fx 三路互不影响。
import type { Rng } from './types';
import { hashString } from './hash';

export class Mulberry32 implements Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  /** 当前内部状态（给 hash() 用）。 */
  get state(): number { return this.a; }
  next(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(a: readonly T[]): T {
    if (a.length === 0) throw new Error('Rng.pick: empty array');
    return a[this.int(a.length)] as T;
  }
  fork(salt: string): Rng { return new Mulberry32(seedFrom(this.a, salt)); }
}

/** 由数值种子和字符串盐得到 32 位种子（FNV-1a）。 */
export function seedFrom(seed: number, salt: string): number {
  return hashString(`${seed >>> 0}:${salt}`);
}
export function createRng(seed: number, salt = ''): Mulberry32 { return new Mulberry32(salt ? seedFrom(seed, salt) : seed); }
