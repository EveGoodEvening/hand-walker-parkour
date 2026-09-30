// src/core/math.ts —— 纯数学工具（DESIGN.md §8.9-2）。CORE 冻结。不依赖 three，Node 可用。

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp01(invLerp(a, b, v)); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t: number): number => { const u = 1 - clamp01(t); return 1 - u * u * u; };
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
export const frac = (v: number): number => v - Math.floor(v);
export const sign = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const DEG = Math.PI / 180;
/** 分贝 → 线性增益。 */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** 线性逼近：每秒最多变化 rate。 */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  const d = target - cur, m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}

/** 临界阻尼弹簧一步（ω 为角频率）。返回 [x, v]，写入 out 以免分配。 */
export function springStep(x: number, v: number, target: number, omega: number, dt: number, out: [number, number]): [number, number] {
  const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  out[0] = (f * x + dt * v + hhoo * target) * det;
  out[1] = (v + hoo * (target - x)) * det;
  return out;
}

/** 区间相交（开区间语义：只接触不算相交）。 */
export const overlap1 = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1;
/** 区间重叠长度（≥ 0）。 */
export const overlapLen = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** 分位数（p ∈ [0,1]），不修改输入。 */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const a = [...values].sort((x, y) => x - y);
  const i = clamp(Math.ceil(p * a.length) - 1, 0, a.length - 1);
  return a[i] as number;
}
