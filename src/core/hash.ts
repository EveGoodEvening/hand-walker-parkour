// src/core/hash.ts —— FNV-1a 哈希（DESIGN.md §8.3）。CORE 冻结。
// 模拟状态哈希：数值先四舍五入到 1e-4 再参与哈希，避免浮点尾数噪声。

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashString(s: string, h = FNV_OFFSET): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** 增量哈希器：push 数值（四舍五入到 1e-4）或字符串。 */
export class Hasher {
  private h = FNV_OFFSET;
  num(v: number): this {
    const r = Number.isFinite(v) ? Math.round(v * 1e4) : (Number.isNaN(v) ? -0x7fffffff : (v > 0 ? 0x7ffffffe : -0x7ffffffe));
    // 32 位以内逐字节；超出部分再哈希一次高位
    let x = r | 0;
    for (let i = 0; i < 4; i++) { this.h ^= x & 0xff; this.h = Math.imul(this.h, FNV_PRIME); x >>>= 8; }
    const hi = Math.floor(r / 4294967296);
    if (hi !== 0 && hi !== -1) this.str(String(hi));
    return this;
  }
  str(s: string): this { this.h = hashString(s, this.h); return this; }
  bool(b: boolean): this { return this.num(b ? 1 : 0); }
  digest(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}
