// src/render/actors/index.ts —— 角色包入口（DESIGN.md §5.5、§5.6、§8.2）。CORE 写初版，之后归 WP5。
// 注册占位 RigFactory 与主角 ViewSystem（order 30）。主角按拍做最简爬行：
//   每只手 2 拍一个周期，左右相差 1 拍；支撑期手锁定在地面（两骨解析 IK），摆动期弧线前摆；
//   掌根触地时腕背伸、指节 / 指腹上翘，随后放平（让三段落地在画面上读得出来）。
// 替身、影子、第三只手、脚本姿势、PoseClip 全部由 WP5 实现；桩阶段 double / shadow 等 cue 走默认日志。
import * as THREE from 'three';
import type { RigHandle, ViewContext, ViewSystem } from '../../core/contracts';
import { clamp, easeInOutSine, frac, lerp, smoothstep } from '../../core/math';
import { registerRigFactory, registerViewSystem } from '../../core/registry';
import { BONE_INDEX, createPose, type BoneName, type Pose } from '../../core/rig';
import type { SimSnapshot } from '../../core/types';
import { ARM, BIND, createPlaceholderRigFactory } from './rigBuild';

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _qW = new THREE.Quaternion(), _qT = new THREE.Quaternion();
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Euler();

function setQ(p: Pose, b: BoneName, q: THREE.Quaternion): void { q.toArray(p.q, BONE_INDEX[b] * 4); }
function setEuler(p: Pose, b: BoneName, x: number, y: number, z: number): void { _q.setFromEuler(_e.set(x, y, z, 'XYZ')); setQ(p, b, _q); }

/** 两骨解析 IK：肩 S → 腕目标 W（角色空间），肘向后外侧弯。写入上臂、前臂、掌的局部旋转。 */
function armIK(p: Pose, side: 'L' | 'R', target: THREE.Vector3, palmPitch: number, knuckle: number, pad: number): void {
  const sb = BIND[`upperArm${side}`];
  _S.set(sb[0], sb[1], sb[2]);
  _d.copy(target).sub(_S);
  const a = ARM.upper, b = ARM.fore;
  const dist = clamp(_d.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  _u.copy(_d).normalize();
  // 极向量：后方偏外
  _v.set(side === 'L' ? -0.35 : 0.35, 0, 1);
  _v.addScaledVector(_u, -_v.dot(_u)).normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_v, a * sinA);
  _W.copy(_S).addScaledVector(_u, dist);
  // 上臂：绑定方向 −y → S→E
  _qU.setFromUnitVectors(DOWN, _v.copy(_E).sub(_S).normalize());
  // 前臂：在上臂坐标系里，−y → E→W
  _d.copy(_W).sub(_E).normalize().applyQuaternion(_qT.copy(_qU).invert());
  _qF.setFromUnitVectors(DOWN, _d);
  setQ(p, `upperArm${side}`, _qU);
  setQ(p, `foreArm${side}`, _qF);
  // 掌：世界（角色空间）朝向 = 绕 x 抬起 palmPitch；局部 = (qU·qF)^-1 · qWorld
  _qW.setFromEuler(_e.set(palmPitch, 0, 0));
  _qT.copy(_qU).multiply(_qF).invert().multiply(_qW);
  setQ(p, `palm${side}`, _qT);
  setEuler(p, `knuckle${side}`, knuckle, 0, 0);
  setEuler(p, `pad${side}`, pad, 0, 0);
}

export interface CrawlInput { s: number; x: number; y: number; floorY: number; beat: number; stride: number; duck: number; air: boolean; airT: number; mode: string; laneTarget: number; t: number }

/** 爬行姿势（纯函数，写入 out）。 */
export function crawlPose(i: CrawlInput, out: Pose): Pose {
  out.q.fill(0);
  for (let k = 0; k < out.q.length; k += 4) out.q[k + 3] = 1;
  const stride = Math.max(0.3, i.stride);
  const phiStance = clamp(0.6 / (2 * stride), 0.2, 0.45);
  const R = 0.26;
  const duckDrop = 0.12 * i.duck;
  const bodyY = i.air ? i.y : -duckDrop;
  // 支撑手一侧：偶数拍左手、奇数拍右手
  const b = i.beat;
  const heelPhase = frac(b);
  const support = Math.floor(b) % 2 === 0 ? -1 : 1;
  const bob = i.air ? 0 : -0.02 * (1 - smoothstep(0, 0.35, heelPhase)) + 0.012 * Math.sin(heelPhase * Math.PI);
  const roll = i.air ? 0 : support * 0.07 * Math.sin(Math.PI * clamp(heelPhase * 1.4, 0, 1));
  const yaw = clamp((i.laneTarget * 1.1 - i.x) * 0.25, -0.2, 0.2) + (i.air ? 0 : -support * 0.04 * Math.sin(Math.PI * heelPhase));
  let pitch = i.air ? 0.06 : 0;
  if (i.mode === 'stumble') pitch += 0.05;
  let rootY = i.floorY + bodyY + bob;
  let rollAll = roll;
  if (i.mode === 'fall') { rootY = i.floorY - 0.16; rollAll = 0.45; pitch = 0.12; }
  out.root[0] = i.x; out.root[1] = rootY; out.root[2] = i.s; out.root[3] = yaw; out.root[4] = pitch; out.root[5] = rollAll;
  // 手
  for (const side of ['L', 'R'] as const) {
    const off = side === 'L' ? 0 : 1;
    const phi = frac((b - off) / 2);
    const sb = BIND[`upperArm${side}`];
    let dz: number, dy: number, palm = 0, kn = 0, pd = 0;
    if (i.air) {
      const k = clamp(i.airT / 0.3, 0, 1);
      dz = lerp(-0.1, -0.34, k); dy = 0.1 - (i.y > 0.05 ? 0.06 : 0);
      palm = 0.25; kn = 0.2; pd = 0.15;
    } else if (phi < phiStance) {
      const u = phi / phiStance;
      dz = -R + 2 * R * u; dy = 0;
      // 掌根触地 → 指节（+26 ms）→ 指腹（+52 ms）：用拍内相位近似
      const tSince = u * phiStance * 2 / 5;        // 约 5 掌/s 时的秒数
      palm = 0.44 * (1 - smoothstep(0, 0.03, tSince));
      kn = 0.35 * (1 - smoothstep(0.02, 0.05, tSince));
      pd = 0.26 * (1 - smoothstep(0.045, 0.08, tSince));
    } else {
      const u = (phi - phiStance) / (1 - phiStance);
      dz = R - 2 * R * easeInOutSine(u); dy = 0.07 * Math.sin(Math.PI * u) * (stride > 1.25 ? 2 : 1);
      palm = u > 0.85 ? 0.44 * smoothstep(0.85, 1, u) : -0.2 * Math.sin(Math.PI * u);
      kn = -0.4 * Math.sin(Math.PI * u); pd = -0.3 * Math.sin(Math.PI * u);
    }
    // 目标腕位（角色空间）：地面在 y = −(bodyY + bob)
    const ground = -(bodyY + bob) + 0.01;
    _W.set(sb[0] * 1.25, ground + dy, sb[2] + dz);
    armIK(out, side, _W, palm, kn, pd);
  }
  // 腿：行李，随步态轻摆；撑跃时向后伸直（流线型）
  const sway = i.air ? 0 : 0.05 * Math.sin(Math.PI * b);
  const lift = i.air ? -0.35 : 0;
  setEuler(out, 'thighL', lift, sway, 0);
  setEuler(out, 'thighR', lift, -sway, 0);
  setEuler(out, 'shinL', i.air ? 0.25 : 0, 0, 0);
  setEuler(out, 'shinR', i.air ? 0.25 : 0, 0, 0);
  // 头：补偿一部分俯仰，微微抬头看前方
  setEuler(out, 'head', -pitch * 0.5 - 0.05, 0, -rollAll * 0.4);
  out.thirdHand = 0;
  return out;
}

class PlayerActor implements ViewSystem {
  readonly id = 'actors';
  readonly owner = 'WP5' as const;
  readonly order = 30;
  private rig!: RigHandle;
  private ctx!: ViewContext;
  private pose = createPose();
  init(ctx: ViewContext): void {
    this.ctx = ctx;
    this.rig = ctx.rig.create('player');
    ctx.scene.add(this.rig.root);
  }
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
    if (next.segKind !== 'run') { this.rig.root.visible = false; return; }
    this.rig.root.visible = true;
    const same = prev.segIndex === next.segIndex && prev.segKind === 'run';
    const a = same ? alpha : 1;
    const P = prev.player, N = next.player;
    crawlPose({
      s: lerp(P.s, N.s, a), x: lerp(P.x, N.x, a), y: lerp(P.y, N.y, a), floorY: lerp(P.floorY, N.floorY, a),
      beat: same ? lerp(P.beat, N.beat, a) : N.beat, stride: N.stride, duck: lerp(P.duck, N.duck, a), air: N.mode === 'air',
      airT: N.airT, mode: N.mode, laneTarget: N.laneTarget, t: next.t,
    }, this.pose);
    this.rig.apply(this.pose);
    this.ctx.rig.history.push(next.t, this.pose);
  }
}

registerRigFactory((ctx) => createPlaceholderRigFactory(ctx));
registerViewSystem(new PlayerActor());
