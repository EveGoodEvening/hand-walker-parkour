// src/render/actors/poses.ts —— 非爬行姿势：通用「体态描述」→ Pose（DESIGN.md §5.6 站立、摔倒、脚本姿势）。WP5。纯函数，Node 可测。
// Posture 用直观的量描述一个姿势：根抬高、骨盆 / 脊柱 / 胸 / 颈 / 头的局部角度，手腕与踝的目标点（角色空间、原点在地面），
// 肘 / 膝朝向，手掌与脚的朝向（「四指 / 鞋尖方向 + 掌心 / 鞋底法线」两个向量）。applyPosture 用 FK + 两骨 IK 生成 Pose。
// 站立段（4-3 梦、5-8 七步）的姿势由 StandSnap 驱动（§3「站起来」、§5.6 站立）。
import * as THREE from 'three';
import { clamp, DEG, easeInOutSine, frac, lerp, smoothstep } from '../../core/math';
import { BONE_COUNT, BONE_INDEX, type Pose } from '../../core/rig';
import type { SimSnapshot, StandSnap } from '../../core/types';
import type { V3 } from '../../core/geo';
import { slerpInto } from './PoseHistory';
import { basisQuat, PoseBuilder } from './handCycle';
import { SEG, STAND_LIFT } from './rigBuild';

const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, -1), BACK = new THREE.Vector3(0, 0, 1);
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();

export type E3 = readonly [number, number, number];
/** 手：腕目标（角色空间、原点在地面）；pole = 肘指向；f = 四指方向；n = 掌心法线；k / d = 指节 / 指腹弯曲。 */
export interface ArmSpec { t: V3; pole?: V3; f?: V3; n?: V3; k?: number; d?: number }
/** 腿：踝目标；pole = 膝盖指向；f = 鞋尖方向；n = 鞋底法线。 */
export interface LegSpec { t: V3; pole?: V3; f?: V3; n?: V3 }
export interface Posture {
  /** 根抬高（米，相对地面）。站立约 STAND_LIFT。 */
  lift: number;
  yaw?: number; pitch?: number; roll?: number;
  pelvis: E3; spine?: E3; chest?: E3; neck?: E3; head?: E3;
  L: ArmSpec; R: ArmSpec;
  legL: LegSpec; legR: LegSpec;
}

/** 根位置（世界）：x、地面 y、里程 s、朝向 yaw。 */
export interface RootAt { x: number; y: number; s: number; yaw: number }

const V = (a: V3 | undefined, fb: THREE.Vector3, out: THREE.Vector3) => (a ? out.set(a[0], a[1], a[2]) : out.copy(fb));

/** 按体态生成姿势（写进 b，返回 b.pose）。 */
export function applyPosture(P: Posture, at: RootAt, b: PoseBuilder): Pose {
  b.begin(at.x, at.y + P.lift, at.s, at.yaw + (P.yaw ?? 0), P.pitch ?? 0, P.roll ?? 0);
  b.local('pelvis', P.pelvis[0], P.pelvis[1], P.pelvis[2]);
  if (P.spine) b.local('spine', P.spine[0], P.spine[1], P.spine[2]);
  if (P.chest) b.local('chest', P.chest[0], P.chest[1], P.chest[2]);
  b.local('shoulderL', 0, 0, 0); b.local('shoulderR', 0, 0, 0);
  if (P.neck) b.local('neck', P.neck[0], P.neck[1], P.neck[2]); else b.local('neck', 0, 0, 0);
  if (P.head) b.local('head', P.head[0], P.head[1], P.head[2], 'YXZ'); else b.local('head', 0, 0, 0);
  const lift = P.lift;
  for (const side of ['L', 'R'] as const) {
    const A = side === 'L' ? P.L : P.R;
    const sx = side === 'L' ? -1 : 1;
    _t.set(A.t[0], A.t[1] - lift, A.t[2]);
    V(A.pole, _p.set(sx * 0.6, 0, 1).normalize(), _p);
    b.ik2(`upperArm${side}`, `foreArm${side}`, _t, _p.normalize(), SEG.upperArm, SEG.foreArm, DOWN, BACK);
    V(A.f, FWD, _f); V(A.n, DOWN, _n);
    basisQuat(FWD, DOWN, _f, _n, _q);
    b.world(`palm${side}`, _q);
    b.local(`knuckle${side}`, A.k ?? 0, 0, 0);
    b.local(`pad${side}`, A.d ?? 0, 0, 0);
  }
  for (const side of ['L', 'R'] as const) {
    const Lg = side === 'L' ? P.legL : P.legR;
    _t.set(Lg.t[0], Lg.t[1] - lift, Lg.t[2]);
    V(Lg.pole, FWD, _p);
    b.ik2(`thigh${side}`, `shin${side}`, _t, _p.normalize(), SEG.thigh, SEG.shin, DOWN, FWD);
    V(Lg.f, FWD, _f); V(Lg.n, DOWN, _n);
    basisQuat(FWD, DOWN, _f, _n, _q);
    b.world(`foot${side}`, _q);
  }
  b.fkAll(BONE_INDEX.arm3Upper);
  return b.finish();
}

/** 两个姿势按 k 混合（四元数 slerp、根线性），写进 out（可与 a 或 b 相同）。 */
export function blendPoses(a: Pose, b: Pose, k: number, out: Pose): Pose {
  const kk = clamp(k, 0, 1);
  for (let i = 0; i < BONE_COUNT; i++) slerpInto(a.q, i * 4, b.q, i * 4, kk, out.q, i * 4);
  for (let i = 0; i < 6; i++) out.root[i] = lerp(a.root[i] as number, b.root[i] as number, kk);
  out.thirdHand = lerp(a.thirdHand, b.thirdHand, kk);
  return out;
}

// ———————————————————— 常用体态 ————————————————————
const PELVIS_Z = 0.26;   // 骨盆静止时在根后方 0.26 m
const HIP_STAND = 0.84;

/** 站立（膝微屈 kneeDeg，躯干前倾 leanDeg）；双手悬在大腿两侧，掌心向下，五指张开（§5.6 站立）。 */
export function standing(o: { knee?: number; lean?: number; hover?: boolean; arms?: 'hang' | 'hover' } = {}): Posture {
  const knee = (o.knee ?? 4) * DEG, lean = (o.lean ?? 2) * DEG;
  const drop = SEG.thigh * (1 - Math.cos(knee)) * 1.6;
  const hover = o.arms === 'hover' || o.hover;
  return {
    lift: STAND_LIFT - drop, pelvis: [-lean, 0, 0], spine: [0, 0, 0], chest: [lean * 0.3, 0, 0], neck: [lean * 0.4, 0, 0], head: [lean * 0.3, 0, 0],
    L: hover ? { t: [-0.3, 0.78, PELVIS_Z - 0.12], pole: [-0.3, 0, 1], f: [-0.2, -0.1, -1], n: [0, -1, 0], k: 0.1, d: 0.1 }
      : { t: [-0.24, 0.8, PELVIS_Z + 0.02], pole: [-0.2, 0, 1], f: [0, -1, 0.05], n: [1, 0, 0] },
    R: hover ? { t: [0.3, 0.78, PELVIS_Z - 0.12], pole: [0.3, 0, 1], f: [0.2, -0.1, -1], n: [0, -1, 0], k: 0.1, d: 0.1 }
      : { t: [0.24, 0.8, PELVIS_Z + 0.02], pole: [0.2, 0, 1], f: [0, -1, 0.05], n: [-1, 0, 0] },
    legL: { t: [-0.1, 0.09, PELVIS_Z - drop * 0.5], pole: [0, 0, -1] },
    legR: { t: [0.1, 0.09, PELVIS_Z - drop * 0.5], pole: [0, 0, -1] },
  };
}

/** 坐在椅子上（座高 0.46）。hands：手腕目标。 */
export function seated(o: { seat?: number; lean?: number; L?: ArmSpec; R?: ArmSpec; feetZ?: number; tucked?: boolean; flat?: boolean } = {}): Posture {
  const seat = o.seat ?? 0.46, lean = (o.lean ?? 6) * DEG;
  const lift = seat + 0.04 - 0.34;
  const fz = o.feetZ ?? PELVIS_Z - 0.42;
  const tuck = o.tucked ?? false;
  return {
    lift, pelvis: [-lean, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [lean * 0.5, 0, 0], head: [lean * 0.3, 0, 0],
    L: o.L ?? { t: [-0.17, seat + 0.18, PELVIS_Z - 0.3], pole: [-0.5, 0, 1], f: [0.2, 0, -1], n: [0, -1, 0] },
    R: o.R ?? { t: [0.17, seat + 0.18, PELVIS_Z - 0.3], pole: [0.5, 0, 1], f: [-0.2, 0, -1], n: [0, -1, 0] },
    // 脚：垂落、脚尖点地；tucked = 把腿蜷进椅子下面
    legL: tuck ? { t: [-0.1, 0.16, PELVIS_Z + 0.05], pole: [0, -0.3, -1], f: [0, -0.7, 0.7], n: [0, -0.7, -0.7] }
      : o.flat ? { t: [-0.12, 0.09, fz - 0.08], pole: [0, 0, -1], f: [-0.08, 0, -1], n: [0, -1, 0] }
      : { t: [-0.11, 0.1, fz], pole: [0, 0, -1], f: [0, -0.5, -0.86], n: [0, -0.86, 0.5] },
    legR: tuck ? { t: [0.1, 0.16, PELVIS_Z + 0.05], pole: [0, -0.3, -1], f: [0, -0.7, 0.7], n: [0, -0.7, -0.7] }
      : o.flat ? { t: [0.12, 0.09, fz - 0.08], pole: [0, 0, -1], f: [0.08, 0, -1], n: [0, -1, 0] }
      : { t: [0.11, 0.1, fz], pole: [0, 0, -1], f: [0, -0.5, -0.86], n: [0, -0.86, 0.5] },
  };
}

/** 跪立（膝着地、躯干直立）。 */
export function kneeling(o: { L?: ArmSpec; R?: ArmSpec; lean?: number; sitBack?: number } = {}): Posture {
  const lean = (o.lean ?? 4) * DEG, back = o.sitBack ?? 0;
  const hip = lerp(0.62, 0.42, back);
  return {
    lift: hip - 0.34, pelvis: [-lean, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [lean * 0.4, 0, 0], head: [0, 0, 0],
    L: o.L ?? { t: [-0.2, hip - 0.12, PELVIS_Z - 0.2], pole: [-0.5, 0, 1], f: [0, -0.3, -1], n: [0, -1, 0.2] },
    R: o.R ?? { t: [0.2, hip - 0.12, PELVIS_Z - 0.2], pole: [0.5, 0, 1], f: [0, -0.3, -1], n: [0, -1, 0.2] },
    legL: { t: [-0.11, 0.07, PELVIS_Z + lerp(0.34, 0.12, back)], pole: [0, -1, -0.4], f: [0, -0.2, 1], n: [0, 1, 0.1] },
    legR: { t: [0.11, 0.07, PELVIS_Z + lerp(0.34, 0.12, back)], pole: [0, -1, -0.4], f: [0, -0.2, 1], n: [0, 1, 0.1] },
  };
}

/** 仰躺（头朝 +z），knees：屈膝角；feetUp：脚悬空的高度。 */
export function lyingBack(o: { knees?: number; feetUp?: number; L?: ArmSpec; R?: ArmSpec; bed?: number } = {}): Posture {
  const h = o.bed ?? 0;
  const knees = (o.knees ?? 8) * DEG;
  const up = o.feetUp ?? 0;
  return {
    lift: h + 0.1 - 0.34, pelvis: [Math.PI / 2 - 0.04, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [-0.1, 0, 0], head: [-0.15, 0, 0],
    L: o.L ?? { t: [-0.3, h + 0.05, PELVIS_Z + 0.25], pole: [-1, 0.3, 0], f: [0, 0, -1], n: [0, -1, 0] },
    R: o.R ?? { t: [0.3, h + 0.05, PELVIS_Z + 0.25], pole: [1, 0.3, 0], f: [0, 0, -1], n: [0, -1, 0] },
    legL: { t: [-0.12, h + 0.1 + up + Math.sin(knees) * 0.2, PELVIS_Z - 0.72 + (1 - Math.cos(knees)) * 0.3], pole: [0, 1, 0], f: [0, 0.9, -0.3], n: [0, 0.3, 0.9] },
    legR: { t: [0.12, h + 0.1 + up + Math.sin(knees) * 0.2, PELVIS_Z - 0.72 + (1 - Math.cos(knees)) * 0.3], pole: [0, 1, 0], f: [0, 0.9, -0.3], n: [0, 0.3, 0.9] },
  };
}

/** 坐在地上（膝盖竖起，手撑在身后）。 */
export function floorSit(): Posture {
  return {
    lift: 0.12 - 0.34, pelvis: [0.35, 0, 0], spine: [-0.1, 0, 0], chest: [-0.1, 0, 0], neck: [-0.1, 0, 0], head: [0, 0, 0],
    L: { t: [-0.24, 0.03, PELVIS_Z + 0.22], pole: [-0.5, 0, 1], f: [-0.2, 0, 1], n: [0, -1, 0] },
    R: { t: [0.24, 0.03, PELVIS_Z + 0.22], pole: [0.5, 0, 1], f: [0.2, 0, 1], n: [0, -1, 0] },
    legL: { t: [-0.13, 0.09, PELVIS_Z - 0.5], pole: [0, 1, -0.3] },
    legR: { t: [0.13, 0.09, PELVIS_Z - 0.5], pole: [0, 1, -0.3] },
  };
}

/** 行走一步的腿（phase 0..1 为一个完整的左右周期；stepLen 步长）。stiff：膝盖发僵（七步）。 */
export function walkingLegs(P: Posture, phase: number, stepLen: number, stiff: number): Posture {
  const lift = P.lift;
  const leg = (ph: number, sx: number): LegSpec => {
    const u = frac(ph);
    // 支撑 0..0.6：脚从前到后；摆动 0.6..1：抬起前摆（脚跟先着地）
    const swing = u >= 0.6;
    const k = swing ? (u - 0.6) / 0.4 : u / 0.6;
    const z = swing ? lerp(stepLen / 2, -stepLen / 2, easeInOutSine(k)) : lerp(-stepLen / 2, stepLen / 2, k);
    const y = 0.09 + (swing ? (0.1 - stiff * 0.05) * Math.sin(Math.PI * k) : 0);
    const heel = swing ? smoothstep(0.7, 1, k) * 0.35 : (1 - smoothstep(0, 0.25, k)) * 0.35;
    const toeOff = !swing ? smoothstep(0.75, 1, k) * 0.5 : 0;
    const pitch = heel - toeOff;
    return { t: [sx * 0.1, y, PELVIS_Z + z], pole: [0, 0, -1], f: [0, Math.sin(pitch), -Math.cos(pitch)], n: [0, -Math.cos(pitch), -Math.sin(pitch)] };
  };
  void lift;
  return { ...P, legL: leg(phase, -1), legR: leg(phase + 0.5, 1) };
}

// ———————————————————— 站立段（§3「站起来」、§5.6 站立）————————————————————
const _stand = { at: { x: 0, y: 0, s: 0, yaw: 0 } as RootAt };

/**
 * 站立段姿势：按 StandSnap（WP1 的 Stand）驱动；没有快照时是梦中那种稳定站立。
 * fallSec：摔倒之后经过的秒数（Stand 在 fallen 之后不再推进 stepT，由 Actor 自己计时；修复轮 U5：以前一直停在跪姿，
 * 「翻成仰躺，脚悬在空中发抖」从来没出现）。
 */
export function standPose(next: SimSnapshot, prev: SimSnapshot, a: number, b: PoseBuilder, fallSec?: number): Pose {
  const N = next.player, Pp = prev.player;
  const st: StandSnap | null = N.stand;
  const at = _stand.at;
  at.x = lerp(Pp.x, N.x, a) + (st?.x ?? 0); at.y = lerp(Pp.floorY, N.floorY, a); at.s = lerp(Pp.s, N.s, a); at.yaw = 0;
  const theta = st?.theta ?? 0;
  const t = next.t;
  if (!st) return applyPosture(standing({ knee: 6, lean: 3 }), at, b);
  switch (st.phase) {
    case 'wait': return applyPosture(floorSit(), at, b);
    case 'rising': {
      const k = clamp(st.held / 3, 0, 1);
      const P0 = floorSit(), P1 = standing({ knee: 20, lean: 18, arms: 'hover' });
      return applyPosture(mixPosture(P0, P1, easeInOutSine(k)), at, b);
    }
    case 'planted': {
      // 失衡：双手撑地 0.6 s 后再起来
      const P = standing({ knee: 35, lean: 55, arms: 'hover' });
      P.L = { t: [-0.3, 0.03, PELVIS_Z - 0.55], pole: [-0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.R = { t: [0.3, 0.03, PELVIS_Z - 0.55], pole: [0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.roll = theta * 0.5;
      return applyPosture(P, at, b);
    }
    case 'fallen': {
      // 第 7 步：膝盖砸地，手拍地，翻成仰躺，脚悬在空中发抖
      const u = clamp((fallSec ?? st.stepT) / 1.2, 0, 1);
      const P0 = kneeling({ lean: 30, L: { t: [-0.3, 0.03, PELVIS_Z - 0.5] }, R: { t: [0.3, 0.03, PELVIS_Z - 0.5] } });
      const shake = 0.03 * Math.sin(t * 38) * smoothstep(0.6, 1, u);
      const P1 = lyingBack({ knees: 50, feetUp: 0.35 + shake });
      return applyPosture(mixPosture(P0, P1, smoothstep(0.3, 1, u)), at, b);
    }
    default: {
      // walking：每 0.9 s 一步，脚跟先着地，膝盖发僵，躯干随 θ 滚转，手臂小幅乱摆（「像一只刚上岸的动物」）
      const dream = st.script === 'dream';
      const period = 0.9;
      const phase = (st.steps + clamp(st.stepT / period, 0, 1)) / 2;
      const P = walkingLegs(standing({ knee: dream ? 6 : 12, lean: dream ? 3 : 10, arms: 'hover' }), phase, dream ? 0.6 : 0.45, dream ? 0 : 1);
      P.roll = dream ? 0 : theta;
      if (!dream) {
        const flail = 0.06;
        P.L = { ...P.L, t: [P.L.t[0] - 0.02 + flail * Math.sin(t * 7.1), P.L.t[1] + flail * Math.sin(t * 5.3), P.L.t[2] + flail * Math.cos(t * 6.2)] };
        P.R = { ...P.R, t: [P.R.t[0] + 0.02 + flail * Math.sin(t * 6.4 + 1), P.R.t[1] + flail * Math.cos(t * 4.7), P.R.t[2] + flail * Math.sin(t * 5.9)] };
      }
      return applyPosture(P, at, b);
    }
  }
}

/** 两个体态按 k 插值（数值线性；手 / 脚方向向量线性后由 basisQuat 正交化）。 */
export function mixPosture(A: Posture, B: Posture, k: number): Posture {
  const l = (x: number, y: number) => lerp(x, y, k);
  const l3 = (x: V3 | undefined, y: V3 | undefined, fb: V3): V3 => {
    const a = x ?? fb, c = y ?? fb;
    return [l(a[0], c[0]), l(a[1], c[1]), l(a[2], c[2])];
  };
  const e3 = (x: E3 | undefined, y: E3 | undefined): E3 => l3(x, y, [0, 0, 0]);
  const arm = (x: ArmSpec, y: ArmSpec, sx: number): ArmSpec => ({
    t: l3(x.t, y.t, x.t), pole: l3(x.pole, y.pole, [sx * 0.6, 0, 1]), f: l3(x.f, y.f, [0, 0, -1]), n: l3(x.n, y.n, [0, -1, 0]),
    k: l(x.k ?? 0, y.k ?? 0), d: l(x.d ?? 0, y.d ?? 0),
  });
  const leg = (x: LegSpec, y: LegSpec): LegSpec => ({ t: l3(x.t, y.t, x.t), pole: l3(x.pole, y.pole, [0, 0, -1]), f: l3(x.f, y.f, [0, 0, -1]), n: l3(x.n, y.n, [0, -1, 0]) });
  return {
    lift: l(A.lift, B.lift), yaw: l(A.yaw ?? 0, B.yaw ?? 0), pitch: l(A.pitch ?? 0, B.pitch ?? 0), roll: l(A.roll ?? 0, B.roll ?? 0),
    pelvis: e3(A.pelvis, B.pelvis), spine: e3(A.spine, B.spine), chest: e3(A.chest, B.chest), neck: e3(A.neck, B.neck), head: e3(A.head, B.head),
    L: arm(A.L, B.L, -1), R: arm(A.R, B.R, 1), legL: leg(A.legL, B.legL), legR: leg(A.legR, B.legR),
  };
}

export { HIP_STAND, PELVIS_Z };
