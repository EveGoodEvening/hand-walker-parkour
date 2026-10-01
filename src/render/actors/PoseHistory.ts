// src/render/actors/PoseHistory.ts —— 姿态历史（DESIGN.md §5.8）。WP5。纯 TS，不依赖 three，Node 可测。
// 环形缓冲，容量 1024（每 tick 一帧，约 8.5 s）。每帧存 29 个局部四元数、根偏移（x, y, s, yaw, pitch, roll）和第三只手。
// sample(t) 二分查找相邻两帧，四元数做 slerp（走短弧），根做线性插值（角度按最短角差），不分配内存。
// 时间回退（读新章、模拟时钟重置）时自动清空。
import { BONE_COUNT, type Pose } from '../../core/rig';

const QN = BONE_COUNT * 4;

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** 两个四元数（数组 a[ia..], b[ib..]）的 slerp，写入 out[io..]。 */
export function slerpInto(a: Float32Array, ia: number, b: Float32Array, ib: number, k: number, out: Float32Array, io: number): void {
  const ax = a[ia] as number, ay = a[ia + 1] as number, az = a[ia + 2] as number, aw = a[ia + 3] as number;
  let bx = b[ib] as number, by = b[ib + 1] as number, bz = b[ib + 2] as number, bw = b[ib + 3] as number;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka: number, kb: number;
  if (cos > 0.9995) { ka = 1 - k; kb = k; } else {
    const th = Math.acos(Math.min(1, cos));
    const s = Math.sin(th);
    ka = Math.sin((1 - k) * th) / s; kb = Math.sin(k * th) / s;
  }
  let x = ax * ka + bx * kb, y = ay * ka + by * kb, z = az * ka + bz * kb, w = aw * ka + bw * kb;
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  out[io] = x; out[io + 1] = y; out[io + 2] = z; out[io + 3] = w;
}

export class PoseHistory {
  readonly cap: number;
  private readonly ts: Float64Array;
  private readonly qs: Float32Array;
  private readonly roots: Float32Array;
  private readonly third: Float32Array;
  private head = 0;          // 下一个写入位置
  private count = 0;

  constructor(cap = 1024) {
    this.cap = cap;
    this.ts = new Float64Array(cap);
    this.qs = new Float32Array(cap * QN);
    this.roots = new Float32Array(cap * 6);
    this.third = new Float32Array(cap);
  }

  get size(): number { return this.count; }
  /** 最新一帧的时间（没有数据时 −∞）。 */
  get latest(): number { return this.count ? (this.ts[(this.head - 1 + this.cap) % this.cap] as number) : -Infinity; }
  /** 最老一帧的时间（没有数据时 +∞）。 */
  get oldest(): number { return this.count ? (this.ts[(this.head - this.count + this.cap) % this.cap] as number) : Infinity; }

  clear(): void { this.head = 0; this.count = 0; }

  /** 写入一帧。t 与上一帧相同时覆盖；t 回退时清空重来。 */
  push(t: number, p: Pose): void {
    if (this.count) {
      const last = this.latest;
      if (t < last - 1e-9) this.clear();
      else if (Math.abs(t - last) <= 1e-9) { this.head = (this.head - 1 + this.cap) % this.cap; this.count--; }
    }
    const i = this.head;
    this.ts[i] = t;
    this.qs.set(p.q, i * QN);
    this.roots.set(p.root, i * 6);
    this.third[i] = p.thirdHand;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** 第 k 老的一帧在环里的下标。 */
  private slot(k: number): number { return (this.head - this.count + k + this.cap) % this.cap; }

  /**
   * 按时间 t 采样（相邻两帧插值）。早于最老一帧时取最老一帧，晚于最新一帧时取最新一帧。
   * 没有任何数据时返回 false，out 不变。
   */
  sample(t: number, out: Pose): boolean {
    const n = this.count;
    if (!n) return false;
    let lo = 0, hi = n - 1;
    if (t <= (this.ts[this.slot(0)] as number)) return this.copyFrom(this.slot(0), out);
    if (t >= (this.ts[this.slot(hi)] as number)) return this.copyFrom(this.slot(hi), out);
    // 找最大的 k 使 ts[k] <= t
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.ts[this.slot(mid)] as number) <= t) lo = mid; else hi = mid;
    }
    const a = this.slot(lo), b = this.slot(hi);
    const ta = this.ts[a] as number, tb = this.ts[b] as number;
    const k = tb > ta ? (t - ta) / (tb - ta) : 0;
    const qs = this.qs, oq = out.q;
    for (let i = 0; i < BONE_COUNT; i++) slerpInto(qs, a * QN + i * 4, qs, b * QN + i * 4, k, oq, i * 4);
    const r = this.roots, or = out.root;
    for (let i = 0; i < 3; i++) or[i] = (r[a * 6 + i] as number) + ((r[b * 6 + i] as number) - (r[a * 6 + i] as number)) * k;
    for (let i = 3; i < 6; i++) or[i] = lerpAngle(r[a * 6 + i] as number, r[b * 6 + i] as number, k);
    out.thirdHand = (this.third[a] as number) + ((this.third[b] as number) - (this.third[a] as number)) * k;
    return true;
  }

  private copyFrom(i: number, out: Pose): boolean {
    out.q.set(this.qs.subarray(i * QN, i * QN + QN));
    out.root.set(this.roots.subarray(i * 6, i * 6 + 6));
    out.thirdHand = this.third[i] as number;
    return true;
  }
}
