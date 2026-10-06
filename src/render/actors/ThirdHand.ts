// src/render/actors/ThirdHand.ts —— 第三只手：两骨 IK 与 6 种手势（DESIGN.md §3「第三只手」、§5.5）。WP5。纯函数，Node 可测。
// 「第三只，从它校服袖子里慢慢伸出来的，苍白、修长、指节分明。」整条骨骼从胸口按伸出程度 0 → 1 缩放，
// IK 目标沿「胸口 → 手势目标」随伸出程度前进，所以手是慢慢伸过去的。
// 手势：shush（放在嘴唇上）、palmGlass（掌心贴玻璃）、forehead（穿过玻璃碰额头）、shoulder（搭肩，只在 3-10 / 5-4 的镜子里）、
// point（指向一个方向）、neck（抚摸自己的脖子）。它从不帮你，也从不攻击你；不出现在失败画面和世界空间里（由 Doubles 保证）。
import * as THREE from 'three';
import { clamp, easeInOutSine } from '../../core/math';
import { BONE_INDEX } from '../../core/rig';
import type { ThirdHandGesture } from '../../core/types';
import { basisQuat, type PoseBuilder } from './handCycle';
import { SEG } from './rigBuild';

const FWD = new THREE.Vector3(0, 0, -1), DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const _hf = new THREE.Vector3(), _hu = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3();

/** 第三只手的手腕到指尖（伸直时，米；rigBuild：掌 0.08 + 两节手指约 0.11）。forehead 手势按它把手腕停在目标前面，指尖正好碰到。 */
export const HAND3_LEN = 0.19;

export interface ThirdHandTarget {
  /** 世界坐标目标点（palmGlass / forehead / shoulder 需要；其余可省略，按身体推算）。 */
  point?: THREE.Vector3;
  /** 世界方向（point 手势；palmGlass 为玻璃法线，指向玻璃）。 */
  dir?: THREE.Vector3;
}

/** 手势的伸出曲线：extendSec 秒内 0 → 1（慢），hold 秒后 retractSec 秒内收回。 */
export function gestureExtend(tSince: number, hold: number, extendSec = 1.2, retractSec = 1.0): number {
  if (tSince < 0) return 0;
  if (tSince < extendSec) return easeInOutSine(tSince / extendSec);
  if (tSince < extendSec + hold) return 1;
  return clamp(1 - (tSince - extendSec - hold) / retractSec, 0, 1);
}

/**
 * 在已经算好身体 FK 的构建器上加第三只手（写 arm3Upper / arm3Fore / arm3Hand，设 b.third）。
 * t：手势开始后的秒数（neck 的抚摸用）。extend：伸出程度 0..1。
 */
export function applyThirdHand(b: PoseBuilder, g: ThirdHandGesture, extend: number, t: number, tgt: ThirdHandTarget = {}): void {
  const e = clamp(extend, 0, 1);
  b.third = e;
  if (e <= 1e-3) return;
  b.fk(BONE_INDEX.arm3Upper);
  const S = _o.copy(b.wp[BONE_INDEX.arm3Upper] as THREE.Vector3);
  const head = b.wp[BONE_INDEX.head] as THREE.Vector3;
  const hq = b.wq[BONE_INDEX.head] as THREE.Quaternion;
  _hf.copy(FWD).applyQuaternion(hq);       // 头的前方（角色空间）
  _hu.copy(UP).applyQuaternion(hq);        // 头的上方
  switch (g) {
    case 'shush': {
      // 食指竖在嘴唇前：目标 = 头心 + 前方 0.13 − 上方 0.0（嘴的位置在头心略下，这里没有嘴，只有位置）
      _t.copy(head).addScaledVector(_hu, 0.07).addScaledVector(_hf, 0.16);
      _f.copy(_hu); _n.copy(_hf).negate();
      break;
    }
    case 'palmGlass': {
      if (tgt.point) b.toChar(tgt.point, _t); else _t.copy(S).addScaledVector(_hf, 0.5);
      if (tgt.dir) b.dirToChar(tgt.dir, _n).normalize(); else _n.copy(_hf);
      _f.copy(UP);
      break;
    }
    case 'forehead': {
      // 指尖碰到额头（修复轮 U5 第二轮）：目标是额头表面，手腕停在它前面一个手长（以前手腕对准头心，指尖要么够不着、要么戳进头里）
      if (tgt.point) b.toChar(tgt.point, _t); else _t.copy(head).addScaledVector(_hf, 0.6);
      _f.copy(_t).sub(S).normalize(); _n.copy(DOWN);
      _t.addScaledVector(_f, -HAND3_LEN);
      break;
    }
    case 'shoulder': {
      // 搭在前面那人的肩上，手指从肩头垂到前面（修复轮 U5：以前手平放在肩上，从镜头看是一条 2–3 px 的线）
      if (tgt.point) b.toChar(tgt.point, _t); else _t.copy(S).addScaledVector(FWD, 0.45).addScaledVector(DOWN, 0.25);
      _t.y += 0.05;
      _f.set(0, -0.7, -0.7).normalize(); _n.set(0, -0.7, 0.7).normalize();
      break;
    }
    case 'point': {
      if (tgt.dir) b.dirToChar(tgt.dir, _f).normalize(); else _f.set(0, 0, 1);
      _t.copy(S).addScaledVector(_f, 0.56);
      _n.copy(DOWN);
      break;
    }
    case 'neck': {
      // 抚摸自己的脖子：手停在颈侧，上下轻移
      const neck = b.wp[BONE_INDEX.neck] as THREE.Vector3;
      _t.copy(neck).addScaledVector(_hu, 0.05 + 0.025 * Math.sin(t * 2.2)).add(_x.set(-0.07, 0, 0).applyQuaternion(hq)).addScaledVector(_hf, 0.02);
      _f.copy(_hu); _n.set(1, 0, 0).applyQuaternion(hq);
      break;
    }
  }
  // 伸出：目标从胸口沿直线移向手势目标；骨段长度随缩放
  _p.copy(S).lerp(_t, e);
  const L = SEG.arm3 * e;
  const pole = _x.copy(DOWN).addScaledVector(_hf, -0.3).normalize();
  b.ik2('arm3Upper', 'arm3Fore', _p, pole, L, L, FWD, DOWN);
  basisQuat(FWD, DOWN, _f, _n, _q);
  b.world('arm3Hand', _q);
}
