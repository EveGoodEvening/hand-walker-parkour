// src/sim/stateHash.ts —— 模拟状态的反射式哈希（DESIGN.md §8.3「对全部数值做 FNV-1a」）。WP1。
// 手写字段清单总会漏（翻转、静音、辅助、检查点、追随者队列、步态待发子事件、timed 队列、换道预排、跳跃缓冲、绊 / 撞计时……），
// 新加字段也容易忘。这里按对象自身的可枚举字段递归哈希：数值（Hasher 四舍五入到 1e-4）、布尔、字符串、数组、Set、Map、
// 嵌套对象（含 rng 的内部状态）。跳过函数，以及 skip 里列出的字段名（指向只读编译数据或输出缓冲的引用）。循环引用只记一次。
// 只读，不改任何状态；字段按插入顺序（类字段的声明顺序）哈希，确定。
import { Hasher } from '../core/hash';

export function hashState(h: Hasher, v: unknown, skip: ReadonlySet<string>, seen: Set<object> = new Set()): Hasher {
  switch (typeof v) {
    case 'number': return h.num(v);
    case 'boolean': return h.bool(v);
    case 'string': return h.str(v);
    case 'undefined': return h.str('∅u');
    case 'function': case 'symbol': return h;
    case 'bigint': return h.str(String(v));
    default: break;
  }
  if (v === null) return h.str('∅n');
  const o = v as object;
  if (seen.has(o)) return h.str('↺');
  seen.add(o);
  if (Array.isArray(o) || ArrayBuffer.isView(o)) {
    const a = o as ArrayLike<unknown>;
    h.num(a.length);
    for (let i = 0; i < a.length; i++) hashState(h, a[i], skip, seen);
    return h;
  }
  if (o instanceof Set) { h.str('S').num(o.size); for (const x of o) hashState(h, x, skip, seen); return h; }
  if (o instanceof Map) { h.str('M').num(o.size); for (const [k, x] of o) { hashState(h, k, skip, seen); hashState(h, x, skip, seen); } return h; }
  for (const k of Object.keys(o)) {
    if (skip.has(k)) continue;
    const x = (o as Record<string, unknown>)[k];
    if (typeof x === 'function') continue;
    h.str(k);
    hashState(h, x, skip, seen);
  }
  return h;
}
