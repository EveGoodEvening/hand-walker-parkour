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

/** 腿长（米）：大腿、小腿。LegForest 的 BODY 用同一组数，走路的起伏按它算。 */
export const LEG = { thigh: 0.43, shin: 0.4 } as const;

/**
 * 走路：腿绕髋摆动 ±22°，摆动腿的膝盖屈 0–35°，身体起伏（§5.7 walk）。dist 为走过的距离（米）。
 * 支撑腿的脚踩住地面不滑：支撑期（走过一步长）里 sin(髋角) 随距离线性减小，脚踝相对髋的前后位置正好抵掉身体的前移
 * （2 × 0.83 × sin 22° ≈ 0.62 = 步长）；摆动期按余弦缓入缓出。两条腿相差半个周期（右腿 = 左腿在 dist + 步长 时的姿势）。
 * 起伏 bob ≤ 0：取两条腿里竖直方向伸得更长的那条，让它的脚踝正好落在地面高度（双支撑时两只脚都着地）。
 * 以前髋角是正弦、起伏只有 ±0.9 cm：双支撑时两只脚都悬空约 5 cm，支撑脚前后滑 7 cm。
 */
export interface WalkPose { hipL: number; hipR: number; kneeL: number; kneeR: number; bob: number }
export const WALK = { hipAmp: 22 * DEG, kneeMax: 35 * DEG, stepLen: 0.62 } as const;
const SIN_AMP = Math.sin(WALK.hipAmp);
/** 一条腿在相位 ph 的髋角与膝角。cos(ph) < 0 为支撑期（髋角从 +22° 减到 −22°），否则为摆动期。 */
function legAt(ph: number): [number, number] {
  const p = ph - Math.floor(ph / (2 * Math.PI)) * 2 * Math.PI;                  // [0, 2π)
  const c = Math.cos(p);
  let s: number;
  if (p >= Math.PI / 2 && p < 1.5 * Math.PI) s = SIN_AMP * (1 - 2 * (p - Math.PI / 2) / Math.PI);  // 支撑：线性
  else s = -SIN_AMP * Math.cos(((p < Math.PI / 2 ? p + Math.PI / 2 : p - 1.5 * Math.PI)));        // 摆动：−A → +A
  // 摆动腿屈膝，支撑腿几乎伸直
  return [Math.asin(s), WALK.kneeMax * Math.max(0, c) + 3 * DEG];
}
/** 腿在竖直方向的伸展：大腿转 −hip、小腿再转 +knee（与 LegForest 的正向运动学一致）。 */
const legExt = (hip: number, knee: number) => LEG.thigh * Math.cos(hip) + LEG.shin * Math.cos(knee - hip);
export function walkPose(dist: number, out: WalkPose): WalkPose {
  const ph = (dist / (2 * WALK.stepLen)) * Math.PI * 2;
  const [hl, kl] = legAt(ph), [hr, kr] = legAt(ph + Math.PI);
  out.hipL = hl; out.kneeL = kl;
  out.hipR = hr; out.kneeR = kr;
  out.bob = Math.max(legExt(hl, kl), legExt(hr, kr)) - (LEG.thigh + LEG.shin);
  return out;
}

/** 脚踝相对髋沿朝向的前后位置（与 LegForest 的正向运动学一致）。 */
const legFwd = (hip: number, knee: number) => LEG.thigh * Math.sin(hip) + LEG.shin * Math.sin(hip - knee);
/** 落脚时（支撑期开始：髋 +22°、膝 3°）脚踝在髋前面多远。 */
const PLANT_FWD = legFwd(WALK.hipAmp, 3 * DEG);
const smooth01 = (u: number) => { const t = clamp01(u); return t * t * (3 - 2 * t); };
/** 两骨 IK（髋所在的竖直平面里）：脚踝沿朝向的位置不变，竖直伸展缩到 ext。只缩不伸。 */
function shorten(hip: number, knee: number, ext: number, out: [number, number]): [number, number] {
  const fwd = legFwd(hip, knee);
  const t = LEG.thigh, s = LEG.shin;
  const D = Math.min(t + s - 1e-6, Math.hypot(fwd, ext));
  const k = Math.acos(Math.max(-1, Math.min(1, (D * D - t * t - s * s) / (2 * t * s))));
  out[0] = Math.atan2(fwd, ext) + Math.atan2(s * Math.sin(k), t + s * Math.cos(k));
  out[1] = k;
  return out;
}
const _ik: [number, number] = [0, 0];
/** 摆动脚经过踏面边沿时的过渡宽度（米）。 */
const SWING_EDGE = 0.12;
/**
 * 台阶地面的连续上包络：x 处的高度，往上的边沿提前 w 抬起，往下的边沿过了之后 w 内才落下，处处 ≥ ground，且随 x 连续。
 * 假设 w 内最多一个边沿（踏面 0.6 m）。边沿位置用二分找（ground 只能逐点取）。dir 为前进方向。
 */
function softGround(x: number, dir: number, w: number, ground: (s: number) => number): number {
  const c = ground(x);
  if (w <= 1e-4) return c;
  let out = c;
  for (let side = 1; side >= -1; side -= 2) {
    const far = ground(x + side * dir * w);
    if (far <= c) continue;
    let lo = 0, hi = w;                                  // ground(x + side·dir·lo) = c，ground(x + side·dir·hi) ≠ c
    for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (ground(x + side * dir * m) === c) lo = m; else hi = m; }
    out = Math.max(out, c + (far - c) * smooth01(1 - hi / w));
  }
  return out;
}

/**
 * 在台阶上走路（楼梯段的路边行人、走路的人腿障碍）：步态与 walkPose 相同，高度跟着步子走，不再随里程一级一级地跳。
 * - 每只脚踩在自己落脚处的踏面上：支撑脚按落脚点（支撑期里不动）取高度；摆动脚从离地处的踏面过渡到落脚处的踏面
 *   （上楼先抬到高的一级，下楼到最后才落下去），也不低于脚正下方的踏面。
 * - 身体的高度只在步子里变：换脚的那一刻取前后两级里低的那级，支撑期中间到这一级；所以身体从不高过支撑脚的踏面，
 *   上楼在落脚之后抬起，下楼在落脚之前降下——支撑脚永远不会悬空（腿伸不长），只会需要弯膝。
 * - 哪只脚会陷进踏面，就用两骨 IK 把那条腿缩短（脚踝前后位置不变，只弯膝），正好踩在踏面上。
 * 平地上（ground 是常数）结果与 walkPose 完全相同。都是走过的距离和此刻位置的纯函数，不累积逐帧状态。
 * dist：walkPose 的距离；sNow：身体此刻的里程；dir：朝向沿 s 的符号（±1）；ground(s)：画面上 s 处的地面高度。
 * 返回身体（根）的高度；out 写入髋角、膝角与起伏（照常加在 hipH 上）。
 */
export function walkOnGround(dist: number, sNow: number, dir: number, ground: (s: number) => number, out: WalkPose): number {
  walkPose(dist, out);
  const L = WALK.stepLen, P = 2 * L;
  // 当前支撑的那条腿：左腿相位 q ∈ [L/2, 1.5L) 时支撑，否则右腿（右腿 = 左腿在 dist + L 时的姿势，两腿交替，不重叠）
  const qL = dist - Math.floor(dist / P) * P;
  const leftStance = qL >= L / 2 && qL < 1.5 * L;
  const qS = leftStance ? qL : (qL + L) % P;          // 支撑腿的相位
  const v = qS - L / 2;                                // 支撑期走过的距离 [0, L)
  const plant = sNow + dir * (PLANT_FWD - v);          // 支撑脚的落脚点
  const hS = ground(plant);
  const hPrev = ground(plant - dir * L), hNext = ground(plant + dir * L);
  const u = v / L;
  const lo = Math.min(hPrev, hS);
  const y = u < 0.5 ? lo + (hS - lo) * smooth01(2 * u) : hS + (Math.min(hS, hNext) - hS) * smooth01(2 * u - 1);
  // 摆动脚：离地处 = 上一个落脚点，落脚处 = 下一个落脚点
  const hSwingRaw = hNext > hPrev ? hPrev + (hNext - hPrev) * smooth01(2 * u) : hPrev + (hNext - hPrev) * smooth01(2 * u - 1);
  const maxE = out.bob + LEG.thigh + LEG.shin;
  // 脚踝离各自地面的高度 = y + maxE − 伸展 − 地面；< 0 就是陷进去了，把那条腿缩短
  for (let leg = 0; leg < 2; leg++) {
    const isLeft = leg === 0;
    const h = isLeft ? out.hipL : out.hipR, k = isLeft ? out.kneeL : out.kneeR;
    // 摆动脚也不穿过它下面的踏面（下楼时脚从高的一级上方经过）。踏面是台阶函数，直接取会让摆动脚跨过边沿时跳 15 cm，
    // 所以按 softGround 取：边沿前后 SWING_EDGE 内连续过渡。离地后 20%、落脚前 10% 的摆动期里渐变到离地处、落脚处的踏面，
    // 和支撑期的高度接上（落脚点紧挨着边沿时，脚在最后这一小段里落下去，不在一帧里跳）
    let g = hS;
    if (isLeft !== leftStance) {
      g = Math.max(hSwingRaw, softGround(sNow + dir * legFwd(h, k), dir, SWING_EDGE, ground));
      if (u < 0.2) g = hPrev + (g - hPrev) * smooth01(u / 0.2);
      else if (u > 0.9) g = hNext + (g - hNext) * smooth01((1 - u) / 0.1);
    }
    const e = legExt(h, k);
    const sink = g - (y + maxE - e);
    if (sink <= 1e-6) continue;
    shorten(h, k, e - sink, _ik);
    if (isLeft) { out.hipL = _ik[0]; out.kneeL = _ik[1]; } else { out.hipR = _ik[0]; out.kneeR = _ik[1]; }
  }
  return y;
}

/** idle：重心左右换，每个人相位不同（周期 3.2–4.8 s）。返回横移（米）与重心脚的屈膝（弧度）。热路径传入 out 复用。 */
export interface Sway { dx: number; knee: number; side: number }
export function idleSway(t: number, phase: number, out: Sway = { dx: 0, knee: 0, side: 1 }): Sway {
  const period = 3.2 + 1.6 * phase;
  const u = Math.sin((t / period + phase) * Math.PI * 2);
  out.dx = 0.018 * u; out.knee = 6 * DEG * Math.max(0, -u); out.side = u >= 0 ? 1 : -1;
  return out;
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
export interface ShiftBlend { turn: number; move: number }
export function shiftBlend(t: number, tAt: number, out: ShiftBlend = { turn: 0, move: 0 }): ShiftBlend {
  const dt = t - tAt;
  let turn = 0;
  if (dt >= -SHIFT.warn) turn = easeInOutSine(clamp01((dt + SHIFT.warn) / SHIFT.turnIn));
  if (dt > SHIFT.moveAfter) turn *= 1 - clamp01((dt - SHIFT.moveAfter) / SHIFT.settle);
  const move = easeInOutSine(clamp01((dt + SHIFT.moveBefore) / (SHIFT.moveBefore + SHIFT.moveAfter)));
  out.turn = turn + 0; out.move = move + 0;
  return out;
}

/** 梦中鼓掌（applaud）：两臂在胸前开合，每秒约 3 下；返回此刻手是否合在一起。 */
export function clapClosed(t: number, phase: number): boolean {
  return frac(t * 3.1 + phase) < 0.45;
}

/** 发抖（梦里跪着模仿的人：「身体在发抖，像刚出生的小动物」）：小幅抖动的角度（弧度）。 */
export interface Tremble { roll: number; pitch: number }
export function tremble(t: number, seed: number, out: Tremble = { roll: 0, pitch: 0 }): Tremble {
  out.roll = 0.02 * Math.sin(t * 37 + seed * 1.3); out.pitch = 0.014 * Math.sin(t * 29 + seed * 2.1);
  return out;
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
