// src/render/npc/behaviors.ts —— NPC 行为的纯函数（DESIGN.md §5.7 行为表、§3「腿的森林」「让一下」）。不依赖 three，Node 可测。
// 原则（D11、附录 A-5）：NPC 从不追人、推人、冲撞；伸进过道的脚只按自己的节律；凝视只用鞋尖表示。
// 所有函数都只取决于时间和数据，不累积逐帧状态——test 模式下 step(N) 之后只渲染一帧，画面也是对的。
import { clamp01, easeInOutSine, frac } from '../../core/math';

const DEG = Math.PI / 180;

/** turnShoes：玩家进入 3 m 内，鞋尖在 0.4 s 内转向玩家，停 0.5 s，再转回去（§5.7）。 */
export const GAZE = { radius: 3, turn: 0.4, hold: 0.5, back: 0.4 } as const;
/** 鞋尖最多转多少（弧度）；腿和髋跟着转一部分。 */
export const GAZE_MAX = 100 * DEG;

/** 凝视程度 0..1：dt 为触发后经过的秒数。 */
export function gazeAmount(dt: number): number {
  if (dt < 0) return 0;
  if (dt < GAZE.turn) return easeInOutSine(dt / GAZE.turn) + 0;
  if (dt < GAZE.turn + GAZE.hold) return 1;
  const u = (dt - GAZE.turn - GAZE.hold) / GAZE.back;
  return u >= 1 ? 0 : 1 - easeInOutSine(u);
}
/** 一次凝视的总时长（秒）。 */
export const GAZE_TOTAL = GAZE.turn + GAZE.hold + GAZE.back;

/**
 * 玩家「进入 3 m」的时刻（向前推算）：按当前距离与速度，估计玩家越过 3 m 边界是多少秒以前。
 * 画面在 test 模式下可能隔很多 tick 才渲染一次，所以不能只靠「第一次看到」的那一帧。
 * alongS = NPC 的 s − 玩家的 s（> 0 在前方），dx 为横向距离，speed 为玩家沿 s 的速度。
 * 返回经过的秒数；还没进入 3 m 返回 −1。
 */
export function gazeSince(alongS: number, dx: number, speed: number): number {
  const r = Math.sqrt(Math.max(0, GAZE.radius * GAZE.radius - dx * dx));
  if (r <= 0 || alongS > r) return -1;
  return (r - alongS) / Math.max(0.5, speed);
}

/** 伸脚的碰撞状态（与 sim/Track.ts 的 stretch 完全相同）：相位落在 [0, outFrac) 时伸在车道里。 */
export function stretchActive(tSeg: number, period: number, phase: number, outFrac: number): boolean {
  return frac(tSeg / period + phase) < outFrac;
}

/** 伸 / 收的过渡时间（秒）：画面在碰撞生效前 0.25 s 开始伸出，碰撞结束后 0.25 s 收完——先看见、后碰到。 */
export const STRETCH_RAMP = 0.25;

/**
 * 伸脚的画面程度 0..1，只取决于段内时间和它自己的周期、相位（§5.7「自身周期」，WP6 验收 3）。
 * 碰撞生效期间恒为 1；伸出过渡在生效之前，收回过渡在结束之后。
 */
export function stretchVisual(tSeg: number, period: number, phase: number, outFrac: number, ramp = STRETCH_RAMP): number {
  const P = Math.max(1e-3, period);
  const tau = frac(tSeg / P + phase) * P;          // 周期内的时刻；[0, A) 为伸出
  const A = outFrac * P;
  if (tau < A) return 1;
  const r = Math.min(ramp, (P - A) / 2);
  if (r <= 0) return 1;
  const down = tau < A + r ? 1 - easeInOutSine((tau - A) / r) : 0;
  const up = tau > P - r ? easeInOutSine((tau - (P - r)) / r) : 0;
  return Math.max(down, up);
}

/** 走路：腿绕髋摆动 ±22°，摆动腿的膝盖屈 0–35°，身体起伏（§5.7 walk）。dist 为走过的距离（米）。 */
export interface WalkPose { hipL: number; hipR: number; kneeL: number; kneeR: number; bob: number }
export const WALK = { hipAmp: 22 * DEG, kneeMax: 35 * DEG, stepLen: 0.62 } as const;
export function walkPose(dist: number, out: WalkPose): WalkPose {
  const ph = (dist / (2 * WALK.stepLen)) * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  out.hipL = WALK.hipAmp * s;
  out.hipR = -WALK.hipAmp * s;
  // 摆动腿（髋角在增大）屈膝，支撑腿几乎伸直
  out.kneeL = WALK.kneeMax * Math.max(0, c) + 3 * DEG;
  out.kneeR = WALK.kneeMax * Math.max(0, -c) + 3 * DEG;
  out.bob = 0.018 * Math.abs(c) - 0.009;
  return out;
}

/** idle：重心左右换，每个人相位不同（周期 3.2–4.8 s）。返回横移（米）与重心脚的屈膝（弧度）。 */
export function idleSway(t: number, phase: number): { dx: number; knee: number; side: number } {
  const period = 3.2 + 1.6 * phase;
  const u = Math.sin((t / period + phase) * Math.PI * 2);
  return { dx: 0.018 * u, knee: 6 * DEG * Math.max(0, -u), side: u >= 0 ? 1 : -1 };
}

/**
 * 「安静的一秒」（§3：人群段里一绊倒，所有人静止 1 s，再用 0.6 s 恢复）：把真实时间换成动画时钟。
 * starts 为各次静止的开始时刻（升序）。静止期间动画时钟不走；恢复期间按 0 → 1 的速度追上。
 */
export const SILENCE = { hold: 1.0, recover: 0.6 } as const;
export function silenceClock(t: number, starts: readonly number[]): number {
  let lost = 0;
  const n = starts.length;
  let i = 0;
  while (i < n) {
    const a = starts[i] as number;
    if (t <= a) break;
    // 重叠的静止合并成一段
    let end = a + SILENCE.hold, j = i + 1;
    while (j < n && (starts[j] as number) < end) { end = Math.max(end, (starts[j] as number) + SILENCE.hold); j++; }
    lost += Math.min(t, end) - a;
    if (t > end) {
      // 恢复段：速度从 0 线性升到 1；下一次静止开始时截断
      const next = j < n ? (starts[j] as number) : Number.POSITIVE_INFINITY;
      const u = (Math.min(t, end + SILENCE.recover, next) - end) / SILENCE.recover;
      lost += SILENCE.recover * (u - (u * u) / 2);
    }
    i = j;
  }
  return t - lost;
}
/** 此刻是否处于「静止」（给音频以外的画面用，例如行人停下）。 */
export function silenceLevel(t: number, starts: readonly number[]): number {
  let v = 0;
  for (const t0 of starts) {
    if (t < t0) break;
    if (t < t0 + SILENCE.hold) v = Math.max(v, 1);
    else if (t < t0 + SILENCE.hold + SILENCE.recover) v = Math.max(v, 1 - (t - t0 - SILENCE.hold) / SILENCE.recover);
  }
  return v;
}

/** 「让一下」：0.5 s 后横移 0.6 m 让出一条缝（part）；ignore 不动（§5.7）。返回 0..0.6（米）。 */
export const PART = { delay: 0.5, move: 0.35, dist: 0.6 } as const;
export function partOffset(dt: number): number {
  if (dt < PART.delay) return 0;
  return PART.dist * easeInOutSine(clamp01((dt - PART.delay) / PART.move));
}

/**
 * 人墙的缝按时间表移动（shift）：移动前 1.2 s 鞋尖先转过去（§5.7），碰撞在 tAt 瞬间切换；
 * 画面的平移集中在 [tAt − 0.25, tAt + 0.15]，以 tAt 为中心。返回 { turn, move } ∈ 0..1。
 */
export const SHIFT = { warn: 1.2, turnIn: 0.4, moveBefore: 0.25, moveAfter: 0.15, settle: 0.6 } as const;
export function shiftBlend(t: number, tAt: number): { turn: number; move: number } {
  const dt = t - tAt;
  let turn = 0;
  if (dt >= -SHIFT.warn) turn = easeInOutSine(clamp01((dt + SHIFT.warn) / SHIFT.turnIn));
  if (dt > SHIFT.moveAfter) turn *= 1 - clamp01((dt - SHIFT.moveAfter) / SHIFT.settle);
  const move = easeInOutSine(clamp01((dt + SHIFT.moveBefore) / (SHIFT.moveBefore + SHIFT.moveAfter)));
  return { turn: turn + 0, move: move + 0 };
}

/** 梦中鼓掌（applaud）：两臂在胸前开合，每秒约 3 下；返回此刻手是否合在一起。 */
export function clapClosed(t: number, phase: number): boolean {
  return frac(t * 3.1 + phase) < 0.45;
}

/** 发抖（梦里跪着模仿的人：「身体在发抖，像刚出生的小动物」）：小幅抖动的角度（弧度）。 */
export function tremble(t: number, seed: number): { roll: number; pitch: number } {
  return { roll: 0.02 * Math.sin(t * 37 + seed * 1.3), pitch: 0.014 * Math.sin(t * 29 + seed * 2.1) };
}

/** 确定性的 0..1 散列（热路径里不分配 rng 对象）。 */
export function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 人腿障碍里每个人的朝向（由障碍 id 和人的序号决定，不随时间变）：60% 朝玩家，40% 背对，各带 ±STAND_YAW.jitter 的随机偏转；
 * 其中约 30% 的人上身（胯和垂着的手）再扭过去 ±STAND_YAW.twist，像在和旁边的人说话。
 * 碰撞盒是 0.52 × 0.30 的横长方形（halfW 0.26、depth 0.30），人要横着「填满」它：整个人侧身时剪影只有 0.26 宽，
 * 比碰撞盒窄 13 cm（危险方向：玩家会撞上看不见的部分），所以脚和腿只取朝前 / 朝后两种朝向，侧身只扭上身。
 * 这些姿势下模型外沿与碰撞盒的偏差 ≤ 5 cm 由 tests/unit/npc/archetypes.test.ts 逐个检查。
 */
export const STAND_YAW = { jitter: 0.1, twist: 0.3 } as const;
export function obstacleYaw(id: number, i: number): number {
  const r = hash01(id * 31 + i * 7);
  const j = (hash01(id * 13 + i) - 0.5) * 2 * STAND_YAW.jitter;
  return r < 0.6 ? j : Math.PI + j;
}
/** 上身扭转角（弧度，0 = 不扭）。 */
export function obstacleTwist(id: number, i: number): number {
  const r = hash01(id * 17 + i * 3);
  return r < 0.3 ? (hash01(id * 23 + i) < 0.5 ? 1 : -1) * STAND_YAW.twist : 0;
}

/** 人的鞋子相对脚踝前移（鞋尖在前）。障碍里的人沿朝向后退这么多，脚和腿的前后沿居中在碰撞盒里。 */
export const FOOT_CENTER = 0.045;

/**
 * 「减少闪烁」（§7.3、附录 A-10）：明灭的光源一律换成 0.5 Hz 的平滑明暗，最低不低于峰值的 0.4。返回 0.4..1（乘峰值用）。
 */
export const REDUCED_FLICKER = { hz: 0.5, min: 0.4 } as const;
export function reducedPulse(t: number): number {
  const u = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * REDUCED_FLICKER.hz);
  return REDUCED_FLICKER.min + (1 - REDUCED_FLICKER.min) * u;
}
