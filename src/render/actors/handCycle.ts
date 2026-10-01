// src/render/actors/handCycle.ts —— 用手行走的动画循环（DESIGN.md §5.6）。WP5。纯函数（只用 three 的数学类），Node 可测。
//
// 每只手的周期是 2 拍，φ ∈ [0, 1)，左右手相差 1 拍（φ 相差 0.5）；偶数拍左手、奇数拍右手落掌（§2.3）。
// φ_stance = 0.6 / (2 × stride)：支撑期身体前移 0.6 m。支撑期手锁定在世界坐标里（由落掌时刻的里程决定，与当前帧无关），
// 所以任何步幅下支撑手都不漂移（单元测试 < 1 cm）。掌根在 φ = 0 触地 → 指节 +26 ms·k → 指腹 +52 ms·k；
// 蹬离时掌根先离地 → 指节 → 指腹最后离开；摆动期弧线前摆（清醒 7 cm、梦里 14 cm），φ = 0.92 起腕部背伸。
//
// 基础体态（§5.6，偏差见 CRAWL 的注释）：肩高约 0.43 m、髋高 0.34 m、头心约 0.6 m，躯干前倾（肩比髋略高）。髋高、伏低、腿自主抬起、摔倒
// 都通过移动根的高度实现（骨盆关节的静止高度是 REST.pelvis = 0.34 m），不是只改躯干的倾角。
// 腿是「行李」：大腿贴着地面向后、向外拖（两腿成 V 字），膝盖离地几厘米，小腿向后上方翘起，鞋底朝后上方、对着镜头
// （§10.1：鞋底要进画面；V 字让鞋底落在 HUD 节拍点的两侧）。行李随身体的摆动左右甩，相位落后。
// 正后方的追尾镜头（lead 补充要求 2：「用手爬」一眼可读）：手撑得比肩宽；支撑手的肘收向身后（贴着身体，不向外撇），
// 摆动手的肘向外上方抬起再落下，两条手臂一撑一抬地交替；躯干侧弯、髋滚转比 §5.6 的数值略大，从身后看得出「游动」。
import * as THREE from 'three';
import { clamp, DEG, easeInOutSine, frac, lerp, smoothstep } from '../../core/math';
import { BONE_INDEX, BONE_PARENT, BONES, createPose, type BoneName, type Pose } from '../../core/rig';
import type { PlayerMode } from '../../core/types';
import { PALM_DROP, REST, REST_OFFSET, SEG } from './rigBuild';

const N = BONES.length;
const PARENT_INDEX: readonly number[] = BONES.map((b) => { const p = BONE_PARENT[b]; return p ? BONE_INDEX[p] : -1; });
const OFFSET: readonly THREE.Vector3[] = BONES.map((b) => new THREE.Vector3(...REST_OFFSET[b]));

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _e = new THREE.Euler();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, -1), BACK = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

/**
 * 姿态构建器：按拓扑顺序（父骨骼先于子骨骼）写局部旋转，同时维护角色空间里的朝向与关节位置（FK），
 * 并提供把世界坐标换算到角色空间、两骨解析 IK、按基向量对齐骨骼等工具。不分配内存。
 */
export class PoseBuilder {
  readonly pose: Pose = createPose();
  readonly lq: THREE.Quaternion[] = BONES.map(() => new THREE.Quaternion());
  readonly wq: THREE.Quaternion[] = BONES.map(() => new THREE.Quaternion());
  readonly wp: THREE.Vector3[] = BONES.map(() => new THREE.Vector3());
  readonly rootQ = new THREE.Quaternion();
  readonly rootP = new THREE.Vector3();
  private readonly rootInv = new THREE.Quaternion();
  /** 第三只手的伸出程度（FK 时按它缩放 arm3 链）。 */
  third = 0;

  /** 开始一帧：根变换（x, y, s, yaw, pitch, roll），全部局部旋转归一。 */
  begin(x: number, y: number, s: number, yaw: number, pitch: number, roll: number): this {
    const r = this.pose.root;
    r[0] = x; r[1] = y; r[2] = s; r[3] = yaw; r[4] = pitch; r[5] = roll;
    this.rootP.set(x, y, -s);
    this.rootQ.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    this.rootInv.copy(this.rootQ).invert();
    this.third = 0;
    for (let i = 0; i < N; i++) this.lq[i]?.identity();
    for (let i = 0; i < N; i++) this.fk(i);
    return this;
  }

  /** 载入一个现成的姿势（局部旋转 + 根），并算好全部 FK。 */
  load(p: Pose): this {
    const r = p.root;
    this.begin(r[0] as number, r[1] as number, r[2] as number, r[3] as number, r[4] as number, r[5] as number);
    for (let i = 0; i < N; i++) (this.lq[i] as THREE.Quaternion).fromArray(p.q, i * 4);
    this.third = p.thirdHand;
    this.fkAll();
    return this;
  }

  /** 世界方向 → 角色空间方向。 */
  dirToChar(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 { return out.copy(world).applyQuaternion(this.rootInv); }

  /** 重新计算骨骼 i 的角色空间朝向与位置（父骨骼必须已是最终值）。 */
  fk(i: number): void {
    const p = PARENT_INDEX[i] as number;
    const wq = this.wq[i] as THREE.Quaternion, wp = this.wp[i] as THREE.Vector3;
    if (p < 0) { wq.copy(this.lq[i] as THREE.Quaternion); wp.copy(OFFSET[i] as THREE.Vector3); return; }
    const pq = this.wq[p] as THREE.Quaternion;
    wq.multiplyQuaternions(pq, this.lq[i] as THREE.Quaternion);
    let sc = 1;
    if (this.third > 0 && (i === BONE_INDEX.arm3Fore || i === BONE_INDEX.arm3Hand)) sc = Math.max(1e-4, this.third);
    wp.copy(OFFSET[i] as THREE.Vector3).multiplyScalar(sc).applyQuaternion(pq).add(this.wp[p] as THREE.Vector3);
  }
  /** 对 from 及之后（拓扑序）的全部骨骼重算 FK。 */
  fkAll(from = 0): void { for (let i = from; i < N; i++) this.fk(i); }

  /** 写局部欧拉角（弧度，XYZ）。 */
  local(b: BoneName, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): this {
    const i = BONE_INDEX[b];
    (this.lq[i] as THREE.Quaternion).setFromEuler(_e.set(x, y, z, order));
    this.fk(i);
    return this;
  }
  /** 在现有局部旋转上再右乘一个欧拉旋转。 */
  addLocal(b: BoneName, x: number, y: number, z: number): this {
    const i = BONE_INDEX[b];
    (this.lq[i] as THREE.Quaternion).multiply(_q3.setFromEuler(_e.set(x, y, z, 'XYZ')));
    this.fk(i);
    return this;
  }
  /** 写角色空间朝向（局部 = 父朝向⁻¹ · q）。 */
  world(b: BoneName, q: THREE.Quaternion): this {
    const i = BONE_INDEX[b];
    const p = PARENT_INDEX[i] as number;
    const l = this.lq[i] as THREE.Quaternion;
    if (p < 0) l.copy(q); else l.copy(this.wq[p] as THREE.Quaternion).invert().multiply(q);
    this.fk(i);
    return this;
  }
  /** 世界坐标点 → 角色空间。 */
  toChar(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(world).sub(this.rootP).applyQuaternion(this.rootInv);
  }
  /** 角色空间点 → 世界坐标。 */
  toWorld(ch: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(ch).applyQuaternion(this.rootQ).add(this.rootP);
  }
  /** 世界朝向 → 角色空间朝向。 */
  quatToChar(worldQ: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
    return out.multiplyQuaternions(this.rootInv, worldQ);
  }

  /**
   * 两骨解析 IK（余弦定理）：upper 的关节 → target（角色空间）。pole 为肘 / 膝指向的方向提示。
   * restDir：两段骨骼在静止时的方向（手臂、腿为 −y，第三只手为 −z）；restPole：静止时肘 / 膝指向的方向。
   * 返回实际到达的末端位置（够不到时停在最远处）。
   */
  ik2(upper: BoneName, lower: BoneName, target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number,
    restDir: THREE.Vector3, restPole: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3 {
    this.fk(BONE_INDEX[upper]);
    const S = this.wp[BONE_INDEX[upper]] as THREE.Vector3;
    const d = _v1.copy(target).sub(S);
    const len = d.length();
    const dist = clamp(len, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const u = len > 1e-6 ? d.multiplyScalar(1 / len) : d.set(0, -1, 0);
    const v = _v2.copy(pole).addScaledVector(u, -pole.dot(u));
    if (v.lengthSq() < 1e-8) { const ref = Math.abs(u.z) < 0.9 ? BACK : UP; v.copy(ref).addScaledVector(u, -ref.dot(u)); }
    v.normalize();
    const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const E = _v3.copy(S).addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
    const W = _v4.copy(S).addScaledVector(u, dist);
    // 上段：restDir → S→E，restPole → 与 v 同侧
    const du = _v5.copy(E).sub(S).normalize();
    basisQuat(restDir, restPole, du, v, _q1);
    this.world(upper, _q1);
    // 下段：restDir → E→W，restPole → v 在下段法平面上的投影
    const dl = _v5.copy(W).sub(E).normalize();
    basisQuat(restDir, restPole, dl, v, _q2);
    this.world(lower, _q2);
    return out ? out.copy(W) : W;
  }

  /** 让骨骼的 restDir 指向 dir（角色空间），restPole 尽量朝 pole。 */
  aim(b: BoneName, restDir: THREE.Vector3, restPole: THREE.Vector3, dir: THREE.Vector3, pole: THREE.Vector3): this {
    basisQuat(restDir, restPole, dir, pole, _q1);
    return this.world(b, _q1);
  }

  /** 结束：把局部旋转写进 pose.q。 */
  finish(): Pose {
    const q = this.pose.q;
    for (let i = 0; i < N; i++) (this.lq[i] as THREE.Quaternion).toArray(q, i * 4);
    this.pose.thirdHand = this.third;
    return this.pose;
  }

  /** 骨骼关节的世界坐标。 */
  jointWorld(b: BoneName, out: THREE.Vector3): THREE.Vector3 { this.fk(BONE_INDEX[b]); return this.toWorld(this.wp[BONE_INDEX[b]] as THREE.Vector3, out); }
}

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _cx = new THREE.Vector3(), _cy = new THREE.Vector3(), _cz = new THREE.Vector3();
/** 旋转：把（restA，restB 正交化）对齐到（worldA，worldB 正交化）。 */
export function basisQuat(restA: THREE.Vector3, restB: THREE.Vector3, worldA: THREE.Vector3, worldB: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _bx.copy(restA).normalize();
  _by.copy(restB).addScaledVector(_bx, -restB.dot(_bx));
  if (_by.lengthSq() < 1e-10) { const ref = Math.abs(_bx.y) < 0.9 ? UP : FWD; _by.copy(ref).addScaledVector(_bx, -ref.dot(_bx)); }
  _by.normalize();
  _bz.crossVectors(_bx, _by);
  _cx.copy(worldA).normalize();
  _cy.copy(worldB).addScaledVector(_cx, -worldB.dot(_cx));
  if (_cy.lengthSq() < 1e-10) { const ref = Math.abs(_cx.y) < 0.9 ? UP : FWD; _cy.copy(ref).addScaledVector(_cx, -ref.dot(_cx)); }
  _cy.normalize();
  _cz.crossVectors(_cx, _cy);
  _m1.makeBasis(_bx, _by, _bz);
  _m2.makeBasis(_cx, _cy, _cz);
  _m1.transpose();
  _m2.multiply(_m1);
  return out.setFromRotationMatrix(_m2);
}

// ————————————————————————————————— 爬行 —————————————————————————————————

/** 爬行输入（来自插值后的 PlayerSnap；纯数据）。 */
export interface CrawlInput {
  s: number; x: number; y: number; floorY: number;
  beat: number; stride: number; cadence: number; speed: number;
  duck: number; air: boolean; airT: number;
  mode: PlayerMode; modeT: number; laneTarget: number;
  twitch: number; drift: number; lookBack: number;
  /** 落地后的缓冲（0..1，1 = 刚落地）。 */
  land?: number;
  /** 腿的二次运动（髋角、膝角偏移，弧度；来自 CrawlAnimator 的阻尼弹簧）。 */
  legHip?: number; legKnee?: number;
}

/**
 * 爬姿常量（§5.6）。与 §5.6 字面数值不同的几处（lead 补充要求 2 / §10.1 优先：默认追尾机位下「用手爬」一眼可读）：
 * - 肩高 0.43 m（§5.6 写 0.46）、脊柱每节只弯 3°：肩只比髋高约 0.1 m，躯干更接近水平。肩比髋高得越多，
 *   追尾镜头（只比背高约 11°）看到的背就越像一块竖着的板。
 * - 腿：大腿向后下 30°、膝盖离地几厘米，小腿向后上 50°，两腿成 V 字（legSpread），鞋底斜对镜头。
 *   §5.6 的「膝弯 110°、小腿贴地」在追尾机位下鞋底出画（§10.1），而且从正后方看像跪着；
 *   现在鞋底在画面里、在 HUD 节拍点之上和两侧（单元测试 poses.test.ts 按追尾机位投影检查）。
 * - 躯干侧弯 ±9°、髋滚转 ±8°、根滚转 ±5°（§5.6：±6° / ±5° / ±4°），行李左右甩 legSwing：从正后方看得出「游动」。
 */
export const CRAWL = {
  hipY: 0.34, shoulderY: 0.43, reach: 0.3, handX: 0.33, spineCurve: 3 * DEG,
  swingLift: 0.07, dreamLift: 0.14, pushOff: 0.06, dorsiflex: 25 * DEG, knuckleUp: 20 * DEG, padUp: 15 * DEG,
  roll: 5 * DEG, yaw: 3 * DEG, pitch: 1.5 * DEG, bob: 0.0075, bend: 9 * DEG, hipRoll: 8 * DEG, shoulderDip: 0.02,
  thighDown: 30 * DEG, shinUp: 50 * DEG, legSpread: 0.23, legSwing: 0.12,
  /**
   * 伏低（§5.6）：骨盆关节高、肩高。整个身体在最低的横档下沿（0.36 m）以下，所以胸盒（0.26 m 厚）下沿离地约 0.06–0.1 m，
   * 比 §5.6 的 0.12 m 低一点（0.12 m 时胸盒上沿就到 0.38 m，会穿过横档）。
   */
  duckHipY: 0.18, duckShoulderY: 0.19,
  /** 腿自主抬起：髋部升高。 */
  twitchLift: 0.25,
} as const;

/** 骨盆关节的静止高度（根在地面时）。姿势里的髋高 hipY 通过把根抬高 hipY − PELVIS_REST_Y 实现。 */
export const PELVIS_REST_Y = REST.pelvis[1];

/** 肩关节相对根（里程 s）向前的名义距离；支撑手的世界位置按它计算（常量，保证锁定）。 */
export const SHOULDER_FWD = 0.2;

/** 三段触地的时间比例（§2.3）：k = clamp(4.8 / cadence, 0.8, 1.2)。 */
export function subScale(cadence: number): number { return clamp(4.8 / Math.max(0.1, cadence), 0.8, 1.2); }
/** 支撑期在手周期里的比例。 */
export function stancePhase(stride: number): number { return clamp(0.6 / (2 * Math.max(0.3, stride)), 0.12, 0.5); }
/** 撑跃滞空时间（与 sim/Player.jumpDuration 一致：3 拍，限制在 [0.48, 0.72] s）。 */
export function jumpDur(cadence: number): number { return clamp(3 / Math.max(0.1, cadence), 0.48, 0.72); }

/** 躯干前倾角：让肩高到 shoulderY（髋高 hipY，脊柱两段各弯 curve）。二分求解。 */
export function torsoTilt(hipY: number, shoulderY: number, curve: number): number {
  const h = (t: number) => 0.08 * Math.cos(t) + 0.2 * Math.cos(t - curve) + 0.2 * Math.cos(t - 2 * curve);
  let lo = 20 * DEG, hi = 150 * DEG;
  const want = shoulderY - hipY;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (h(m) > want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** 手在一个周期里的状态（世界坐标，纯函数）。 */
export interface HandState {
  phase: 'stance' | 'push' | 'swing' | 'air';
  /** 腕目标（世界坐标）。 */
  wx: number; wy: number; ws: number;
  palm: number; knuckle: number; pad: number;
  /** 周期内相位与支撑比例（测试用）。 */
  phi: number; stance: number;
  /** 摆动期进度 0..1（其他阶段为 0）：肘的抬起按它算。 */
  swingU?: number;
}

/**
 * 一只手在当前拍的状态。side 0 = 左（偶数拍落掌）、1 = 右。
 * 落掌里程 sStrike = s − (beat − bStrike) × stride，手落在「肩前 reach」：ws = sStrike + SHOULDER_FWD + reach。
 * baseX：这只手所在的世界横向位置（身体中心 + 撑开的宽度，调用方给出）。
 */
export function handState(i: CrawlInput, side: 0 | 1, baseX: number, out: HandState): HandState {
  const stride = Math.max(0.3, i.stride);
  const st = stancePhase(stride);
  const cyc = (i.beat - side) / 2;
  const phi = frac(cyc);
  const k = Math.floor(cyc);
  const bStrike = 2 * k + side;
  const sStrike = i.s - (i.beat - bStrike) * stride;
  const plantS = sStrike + SHOULDER_FWD + CRAWL.reach;
  const nextS = plantS + 2 * stride;
  const ground = i.floorY;
  const cad = Math.max(0.5, i.cadence);
  const ks = subScale(cad);
  const dK = (0.026 * ks * cad) / 2, dP = (0.052 * ks * cad) / 2;   // 指节、指腹相对掌根的相位差
  const dream = stride >= 1.25 || i.speed > 7;
  out.phi = phi; out.stance = st; out.wx = baseX; out.swingU = 0;
  if (phi < st) {
    out.phase = 'stance';
    const pitch = CRAWL.dorsiflex * (1 - smoothstep(0, dK, phi));
    out.palm = pitch;
    out.knuckle = CRAWL.knuckleUp * (1 - smoothstep(0, dK, phi));
    out.pad = phi < dK ? lerp(CRAWL.padUp, 10 * DEG, phi / Math.max(1e-6, dK)) : 10 * DEG * (1 - smoothstep(dK, dP, phi));
    out.ws = plantS;
    out.wy = ground + PALM_DROP * Math.cos(pitch);
    return out;
  }
  const push = CRAWL.pushOff;
  if (phi < st + push) {
    out.phase = 'push';
    const u = (phi - st) / push;
    const p = -40 * DEG * smoothstep(0, 1, u);
    out.palm = p;
    out.knuckle = -p * 0.9;
    out.pad = 0;
    // 绕指节关节转：腕抬起、稍向前（掌根先离地 → 指节 → 指腹最后离开）
    out.ws = plantS + SEG.palm * (1 - Math.cos(p));
    out.wy = ground + PALM_DROP + SEG.palm * Math.sin(-p);
    return out;
  }
  out.phase = 'swing';
  const u = (phi - st - push) / Math.max(1e-6, 1 - st - push);
  out.swingU = u;
  const pEnd = -40 * DEG;
  const liftS = plantS + SEG.palm * (1 - Math.cos(pEnd));
  const liftY = SEG.palm * Math.sin(-pEnd);
  const e = easeInOutSine(u);
  out.ws = lerp(liftS, nextS, e);
  const arc = (dream ? CRAWL.dreamLift : CRAWL.swingLift) * Math.sin(Math.PI * u);
  out.wy = ground + PALM_DROP * Math.cos(CRAWL.dorsiflex * smoothstep(0.84, 1, phi)) + lerp(liftY, 0, smoothstep(0, 0.35, u)) + arc;
  // 手指卷 25°，φ = 0.92 起腕部背伸，到 φ = 1 时正好是掌根触地的姿势
  const dors = smoothstep(0.92, 1, phi);
  out.palm = lerp(lerp(pEnd, -12 * DEG, smoothstep(0, 0.3, u)), CRAWL.dorsiflex, dors);
  // 手指：从蹬离末尾的姿势（指节相对掌面上翘、指尖还贴着地）连续过渡到卷 25°，手落向地面之前再松开（否则指腹会戳进地面）
  const curl = -25 * DEG * (1 - smoothstep(0.55, 0.9, u));
  const kIn = smoothstep(0, 0.3, u);
  out.knuckle = lerp(lerp(-pEnd * 0.9, curl, kIn), CRAWL.knuckleUp, dors);
  out.pad = lerp(lerp(0, curl, kIn), CRAWL.padUp, dors);
  return out;
}

const _hs: HandState = { phase: 'stance', wx: 0, wy: 0, ws: 0, palm: 0, knuckle: 0, pad: 0, phi: 0, stance: 0 };
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion();

/** 写手掌（角色空间朝向由世界朝向换算：四指朝前、贴地，pitch 为腕背伸，yawOut 为指尖外撇）。 */
export function setHand(b: PoseBuilder, side: 'L' | 'R', worldYaw: number, pitch: number, roll: number, knuckle: number, pad: number): void {
  _pq.setFromEuler(_e.set(pitch, worldYaw, roll, 'YXZ'));
  b.quatToChar(_pq, _pq2);
  b.world(`palm${side}`, _pq2);
  b.local(`knuckle${side}`, knuckle, 0, 0);
  b.local(`pad${side}`, pad, 0, 0);
}

/**
 * 手臂 IK：肩 → 腕（世界坐标目标）。elbowOut：肘向外的程度（1 左右 = 外后方）；lift：肘向上抬（摆动期 0..1）；
 * elbowUp：不抬时肘的上下倾向（伏低时为负：肘向外、略向下，不顶过横档）。
 */
export function armTo(b: PoseBuilder, side: 'L' | 'R', worldTarget: THREE.Vector3, elbowOut = 1.1, lift = 0, elbowUp = 0.15): void {
  b.toChar(worldTarget, _t);
  const sx = side === 'L' ? -1 : 1;
  _p.set(sx * lerp(elbowOut, 1.0, lift), lerp(elbowUp, 1.1, lift), lerp(1, 0.25, lift)).normalize();
  b.ik2(`upperArm${side}`, `foreArm${side}`, _t, _p, SEG.upperArm, SEG.foreArm, DOWN, BACK);
}

/** 爬行姿势的躯干：髋高 hipY、肩高 shoulderY，附加步态摆动。写入 pelvis → head。 */
export function crawlTorso(b: PoseBuilder, hipY: number, shoulderY: number, sway: { bend: number; hipRoll: number; dip: number; pitchComp: number; headYaw: number; headPitch: number; headRoll?: number; headDown?: number }): number {
  const curve = CRAWL.spineCurve;
  const tilt = torsoTilt(hipY, shoulderY, curve);
  const down = clamp(sway.headDown ?? 0, 0, 1);
  b.local('pelvis', -tilt, sway.hipRoll, sway.bend * 0.5, 'XYZ');
  b.local('spine', curve, 0, sway.bend * 0.3);
  // 胸：反向扭转一部分髋滚转；支撑手一侧的肩下沉约 2 cm（绕脊柱轴转）
  b.local('chest', curve, -sway.hipRoll * 0.6 + sway.dip, -sway.bend * 0.4);
  b.local('shoulderL', 0, 0, 0);
  b.local('shoulderR', 0, 0, 0);
  // 颈部上抬一半，头看前方略向下（头部反向补偿躯干俯仰的 50%）
  // headDown（伏低）：颈不再上抬，头顺着脊柱向前、略向下，脸贴近地面
  const chestPitch = tilt - 2 * curve;
  b.local('neck', lerp(chestPitch * 0.4, -8 * DEG, down), 0, 0);
  b.local('head', lerp(chestPitch * 0.6 - 12 * DEG, -14 * DEG, down) + sway.pitchComp + sway.headPitch, sway.headYaw, sway.headRoll ?? 0, 'YXZ');
  return tilt;
}

const _lq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
const _ank = new THREE.Vector3();

/**
 * 行李腿：大腿向后、略向下、向外（V 字），小腿向后上方，鞋底朝后上方。swing：整条腿的横向甩动（角色空间 x 分量）。
 * twitch 0..1 过渡到「站立姿势的半成品」（脚掌贴地、脚跟抬起、膝压向地面；髋部的升高由调用方抬根完成）。
 */
export function luggageLegs(b: PoseBuilder, o: { thighDown: number; shinUp: number; spread: number; swing?: number; twitch: number; drift: number; hip: number; knee: number; flat: number; ground: number }): void {
  const tw = o.twitch;
  const sw = o.swing ?? 0;
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const spread = o.spread * sx;
    const iT = BONE_INDEX[`thigh${side}`], iS = BONE_INDEX[`shin${side}`], iF = BONE_INDEX[`foot${side}`];
    // 行李：大腿方向（角色空间）向后下方，膝盖朝下
    const td = o.thighDown + o.hip;
    _d.set(spread + sw, -Math.sin(td), Math.cos(td)).normalize();
    _n.set(0, -Math.cos(td), -Math.sin(td) * 0.3).normalize();
    b.aim(`thigh${side}`, DOWN, FWD, _d, _n);
    const su = lerp(o.shinUp + o.knee, 2 * DEG, o.flat);
    _d.set(spread * 0.4 + sw * 1.4, Math.sin(su), Math.cos(su)).normalize();
    _n.set(0, -Math.cos(su), Math.sin(su)).normalize();
    b.aim(`shin${side}`, DOWN, FWD, _d, _n);
    const yaw = o.drift * 10 * DEG;
    // 鞋：小腿翘起时踝关节接近中立位，鞋尖朝后下方、鞋底朝后上方（正对追尾镜头）；腿平摊时脚背贴地、鞋底朝上
    // 脚像死物一样向外歪（toeOut），鞋底斜对镜头，不会正对着镜头变成两块白板
    const fa = lerp(12 * DEG, 62 * DEG - su, smoothstep(8 * DEG, 30 * DEG, su));
    _d.set(0, -Math.sin(fa), Math.cos(fa)); _n.set(0, Math.cos(fa), Math.sin(fa));
    const toeOut = sx * 22 * DEG * (1 - o.flat * 0.5);
    _d.applyAxisAngle(_v5.set(0, Math.sin(su), Math.cos(su)), toeOut); _n.applyAxisAngle(_v5, toeOut);
    if (Math.abs(yaw) > 1e-4) { _d.applyAxisAngle(UP, yaw); _n.applyAxisAngle(UP, yaw); }
    b.aim(`foot${side}`, FWD, DOWN, _d, _n);
    if (tw <= 1e-4) continue;
    // 半成品：踝落在髋后方偏下，脚掌贴地、脚跟抬起，膝盖朝前下方（压向地面）
    (_lq[0] as THREE.Quaternion).copy(b.lq[iT] as THREE.Quaternion);
    (_lq[1] as THREE.Quaternion).copy(b.lq[iS] as THREE.Quaternion);
    (_lq[2] as THREE.Quaternion).copy(b.lq[iF] as THREE.Quaternion);
    const hip = b.wp[iT] as THREE.Vector3;
    _ank.set(hip.x + sx * 0.04, o.ground + 0.2, hip.z + 0.2);     // o.ground：地面在角色空间里的高度
    _p.set(0, -0.6, -1).normalize();
    b.ik2(`thigh${side}`, `shin${side}`, _ank, _p, SEG.thigh, SEG.shin, DOWN, FWD);
    // 鞋尖朝前下方约 35°：前脚掌贴地、脚跟抬起
    _d.set(0, -0.57, -0.82); _n.set(0, -0.82, 0.57);
    if (Math.abs(yaw) > 1e-4) { _d.applyAxisAngle(UP, yaw); _n.applyAxisAngle(UP, yaw); }
    b.aim(`foot${side}`, FWD, DOWN, _d, _n);
    // 从行李姿势混到半成品（先 slerp 进临时四元数：slerpQuaternions 会先 copy(qa)，目标不能是 qb 自己）
    for (const [k, i] of [[0, iT], [1, iS], [2, iF]] as const) {
      const q = b.lq[i] as THREE.Quaternion;
      _q4.slerpQuaternions(_lq[k] as THREE.Quaternion, q, tw);
      q.copy(_q4);
      b.fk(i);
    }
  }
}

/**
 * 爬行姿势（纯函数，写进 b）。包括：支撑 / 蹬离 / 摆动、撑跃、伏低、绊、撞、摔倒、腿自主抬起、腿偏移、回头时转头。
 */
export function crawlPose(i: CrawlInput, b: PoseBuilder): Pose {
  const stride = Math.max(0.3, i.stride);
  const beat = i.beat;
  const air = i.air;
  const duck = clamp(i.duck, 0, 1);
  const tw = clamp(i.twitch, 0, 1);
  const dream = stride >= 1.25 || i.speed > 7;
  // —— 根：起伏、俯仰（2 倍频）、向支撑手一侧滚转、偏航 ——
  const moving = !air && i.mode !== 'fall';
  const w = Math.PI * beat;
  let bob = moving ? -CRAWL.bob * Math.cos(2 * w) : 0;
  let roll = moving ? CRAWL.roll * Math.cos(w - 0.6) : 0;        // 偶数拍左手支撑 → 向左滚（+z）
  const laneYaw = clamp((i.laneTarget * 1.1 - i.x) * 0.3, -0.25, 0.25);
  let yaw = laneYaw + (moving ? CRAWL.yaw * Math.sin(w) : 0);
  let pitch = moving ? CRAWL.pitch * Math.sin(2 * w) : 0;
  let hipY: number = CRAWL.hipY, shoulderY: number = CRAWL.shoulderY;
  // 伏低：骨盆、肩一起压低（整个身体在 0.36 m 的横档下沿以下，胸盒下沿离地约 0.06–0.1 m），肘弯约 70°
  hipY = lerp(hipY, CRAWL.duckHipY, duck); shoulderY = lerp(shoulderY, CRAWL.duckShoulderY, duck);
  roll *= 1 - 0.7 * duck;
  // 腿自主抬起：髋部升高 0.25 m（抬根；肩还撑在手上，躯干变成前低后高）
  hipY += CRAWL.twitchLift * tw;
  // 落地缓冲：肘弯 35°
  const land = clamp(i.land ?? 0, 0, 1);
  shoulderY -= 0.06 * land;
  // 撞：肩部下沉
  if (i.mode === 'crash') shoulderY -= 0.06 * (1 - smoothstep(0.1, 0.4, i.modeT));
  // 撑跃：身体接近水平（8°）
  if (air) { shoulderY = hipY + 0.07; pitch = 0; roll = 0; }
  // 绊：躯干偏航 12°，0.5 s 内恢复
  let stumble = 0;
  if (i.mode === 'stumble') { stumble = 1 - smoothstep(0, 0.5, i.modeT); yaw += 12 * DEG * stumble; }
  // 摔倒：手臂撑不住，胸口砸地，身体侧翻
  let fall = 0;
  if (i.mode === 'fall') {
    fall = smoothstep(0, 0.35, i.modeT);
    shoulderY = lerp(shoulderY, 0.14, fall); hipY = lerp(hipY, 0.2, fall);
    roll = 0.35 * fall; bob = 0;
  }
  const rootY = i.floorY + (air ? i.y : 0) + bob + (hipY - PELVIS_REST_Y);
  b.begin(i.x, rootY, i.s, yaw, pitch, roll);
  const sideSwing = moving ? Math.sin(w) : 0;
  crawlTorso(b, hipY, shoulderY, {
    bend: CRAWL.bend * sideSwing * (1 - duck * 0.5), hipRoll: CRAWL.hipRoll * sideSwing * (1 - duck * 0.5),
    dip: moving ? -0.1 * Math.cos(w - 0.4) : 0, pitchComp: -pitch * 0.5,
    headYaw: lerp(0, 55 * DEG, clamp(i.lookBack, 0, 1)), headRoll: 15 * DEG * smoothstep(0.4, 1, duck),
    headPitch: fall * 20 * DEG + (i.mode === 'crash' ? 12 * DEG : 0), headDown: duck,
  });
  // —— 手 ——
  const heading = yaw;
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const baseX = i.x + sx * lerp(CRAWL.handX, 0.5, duck) * Math.cos(heading);   // 伏低：手撑得更宽，肘弯约 70°
    if (air) {
      // 撑跃：双手在肩前下方，准备同时着地
      const cad = Math.max(0.5, i.cadence);
      const u = clamp(i.airT / jumpDur(cad), 0, 1);
      const reachDown = clamp(i.y + 0.42, 0.1, 0.46);
      b.jointWorld(`upperArm${side}`, _w);
      _w.x = baseX; _w.y -= reachDown; _w.z -= lerp(0.26, 0.34, u);
      armTo(b, side, _w, 0.5);
      setHand(b, side, heading, lerp(-15 * DEG, CRAWL.dorsiflex, smoothstep(0.6, 1, u)), 0, 0, 0);
      continue;
    }
    const hs = handState(i, side === 'L' ? 0 : 1, baseX, _hs);
    let wx = hs.wx, ws = hs.ws;
    let palmRoll = 0;
    if (stumble > 0 && hs.phase === 'stance') { wx += sx * 0.08 * stumble; palmRoll = -sx * 25 * DEG * stumble; }
    if (fall > 0) { wx += sx * 0.12 * fall; ws += 0.1 * fall; }
    _w.set(wx, hs.wy, -ws);
    // 支撑手：肘收向身后（贴着身体，不向外撇）；伏低时肘向外、略向下撑开（弯约 70°）；摆动手：肘向外上方抬起
    const lift = moving && hs.phase === 'swing' ? Math.sin(Math.PI * (hs.swingU ?? 0)) * (1 - duck) * (1 - tw * 0.5) : 0;
    armTo(b, side, _w, lerp(0.45, 2.4, duck), lift, lerp(0.15, -0.5, duck));
    setHand(b, side, heading - sx * 6 * DEG, hs.palm * (1 - fall), palmRoll + sx * fall * 0.4, hs.knuckle, hs.pad);
  }
  // —— 腿 ——
  const flat = Math.max(duck, fall);
  // 梦里（> 7 m/s）：髋部伸展，腿「从身体下面解放出来，拖在后面」
  const free = dream ? smoothstep(6.5, 8.5, i.speed) : 0;
  luggageLegs(b, {
    thighDown: air ? 14 * DEG : lerp(lerp(CRAWL.thighDown, 8 * DEG, duck), 14 * DEG, free), shinUp: air ? 10 * DEG : lerp(CRAWL.shinUp, 14 * DEG, free),
    spread: air ? 0.04 : lerp(CRAWL.legSpread, 0.42, duck), swing: moving ? CRAWL.legSwing * Math.sin(w - 1.1) * (1 - duck * 0.6) : 0,
    twitch: tw, drift: clamp(i.drift, -1, 1),
    hip: i.legHip ?? 0, knee: i.legKnee ?? 0, flat: air ? 0 : flat, ground: i.floorY - rootY,
  });
  // 头顶的餐盘保持水平（只随身体偏航，轻微摇晃）
  _pq.setFromEuler(_e.set(0.03 * Math.sin(w * 0.5), yaw, 0.04 * Math.sin(w), 'YXZ'));
  b.quatToChar(_pq, _pq2);
  b.world('propHead', _pq2);
  b.fkAll(BONE_INDEX.arm3Upper);
  return b.finish();
}

/** 手腕在世界里的实际位置（FK 结果，测试用）。 */
export function wristWorld(b: PoseBuilder, side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 { return b.jointWorld(`palm${side}`, out); }

/**
 * 有状态的爬行动画器：维护落地缓冲与腿的阻尼弹簧（k = 60，c = 8，相位落后约 0.15 拍），然后调用纯函数 crawlPose。
 */
export class CrawlAnimator {
  private hip = 0; private hipV = 0; private knee = 0; private kneeV = 0;
  private landT = 9;
  private lastY = 0; private lastVy = 0;
  onLand(): void { this.landT = 0; }
  reset(): void { this.hip = this.hipV = this.knee = this.kneeV = 0; this.landT = 9; this.lastVy = 0; }
  update(i: CrawlInput, dt: number, b: PoseBuilder): Pose {
    const h = Math.min(0.05, Math.max(0, dt));
    if (h > 0) {
      this.landT += h;
      // 身体竖直加速度 → 腿的偏移（行李被甩动）
      const y = i.y + (-CRAWL.bob * Math.cos(2 * Math.PI * i.beat));
      const vy = (y - this.lastY) / h;
      const ay = clamp((vy - this.lastVy) / h, -30, 30);
      this.lastY = y; this.lastVy = vy;
      const tHip = -ay * 0.004, tKnee = ay * 0.006;
      const k = 60, c = 8;
      this.hipV += (k * (tHip - this.hip) - c * this.hipV) * h; this.hip += this.hipV * h;
      this.kneeV += (k * (tKnee - this.knee) - c * this.kneeV) * h; this.knee += this.kneeV * h;
      this.hip = clamp(this.hip, -0.25, 0.25); this.knee = clamp(this.knee, -0.3, 0.3);
    }
    i.land = this.landT < 0.22 ? 1 - this.landT / 0.22 : 0;
    i.legHip = this.hip; i.legKnee = this.knee;
    return crawlPose(i, b);
  }
}
