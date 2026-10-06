// tests/unit/actors/poses.test.ts —— §5.6 的特殊姿势与追尾镜头下的可读性（验收员第 1 轮的问题）：
// 腿自主抬起（髋部升高 0.25 m、前脚掌贴地）、伏低（整个身体在最低的横档下沿 0.36 m 以下）、
// 「用手爬」在默认追尾机位下的读法（修复轮 U5：腿低低地拖在身后、两腿并拢、小腿与地面 ≤ 20°，鞋底暗灰；摆动手的肘抬起）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../../src/core/quality';
import { BONE_INDEX, BONES, type Pose } from '../../../src/core/rig';
import { OBSTACLES } from '../../../src/levels/obstacles';
import { FOLLOW } from '../../../src/render/camera/shots';
import { vFromH } from '../../../src/render/camera/CameraRig';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { buildRigGeometry, Rig, rigColor, rigDetail } from '../../../src/render/actors/rigBuild';
import { presetOf, screenColor } from '../../../src/render/kits/outside/lib/tone';
import '../../../src/render/atmosphere';
import { crawlInput } from './helpers';

const geo = buildRigGeometry(rigDetail(QUALITY.low));
const rig = new Rig(geo, new THREE.MeshBasicMaterial(), 'player');
const pos = geo.getAttribute('position') as THREE.BufferAttribute;
const col = geo.getAttribute('color') as THREE.BufferAttribute;
const skin = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
const SKIP = new Set(['arm3Upper', 'arm3Fore', 'arm3Hand', 'propHead', 'propBack'].map((n) => BONE_INDEX[n as 'propHead']));
const sole = new THREE.Color().setHex(rigColor('sole'));
const _v = new THREE.Vector3();

/** 姿势下全身（不含缩放为 0 的第三只手与道具）的世界坐标顶点。 */
function skinned(p: Pose, each: (v: THREE.Vector3, i: number) => void): void {
  rig.apply(p);
  rig.root.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    if (SKIP.has(skin.getX(i))) continue;
    _v.fromBufferAttribute(pos, i);
    rig.mesh.applyBoneTransform(i, _v);
    _v.applyMatrix4(rig.mesh.matrixWorld);
    each(_v, i);
  }
}
function extentY(p: Pose): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  skinned(p, (v) => { min = Math.min(min, v.y); max = Math.max(max, v.y); });
  return { min, max };
}
const BEATS = [6.0, 6.2, 6.45, 6.7, 6.9, 7.15, 7.4, 7.65, 7.9, 8.1, 8.3, 8.5];
const b = new PoseBuilder();
const jointY = (name: (typeof BONES)[number]) => b.jointWorld(name, new THREE.Vector3()).y;

describe('special poses (§5.6)', () => {
  it('twitch: the hips rise about 0.25 m, the feet plant on the balls under / behind the hips, and the body is the tallest pose', () => {
    for (const beat of BEATS) {
      crawlPose(crawlInput({ s: 10, beat }), b);
      const hip0 = jointY('pelvis');
      const crawlTop = extentY(b.finish()).max;
      const tw = crawlPose(crawlInput({ s: 10, beat, twitch: 1 }), b);
      const hip1 = jointY('pelvis');
      expect(hip1 - hip0).toBeGreaterThan(0.22);
      expect(hip1 - hip0).toBeLessThan(0.28);
      const hipZ = b.jointWorld('pelvis', new THREE.Vector3()).z;
      for (const side of ['L', 'R'] as const) {
        const ank = b.jointWorld(`foot${side}`, new THREE.Vector3());
        expect(ank.y).toBeLessThan(0.25);                 // 脚贴着地面
        expect(ank.z).toBeGreaterThan(hipZ - 0.05);       // 在髋的正下方或后方（−z 是前方）
        const knee = b.jointWorld(`shin${side}`, new THREE.Vector3());
        expect(knee.y).toBeLessThan(hip1 - 0.2);          // 膝盖压向地面
      }
      const e = extentY(tw);
      expect(e.min).toBeGreaterThan(-0.015);              // 鞋尖不戳进地面
      expect(e.max).toBeGreaterThan(0.69);                // 骨盆是最高点之一（≈ 0.72 m）
      expect(e.max).toBeGreaterThan(crawlTop - 0.05);
    }
  });

  it('twitch blends from the luggage legs (the leg bones really change; regression for slerpQuaternions aliasing)', () => {
    crawlPose(crawlInput({ s: 10, beat: 6.2 }), b);
    const q0 = b.lq[BONE_INDEX.thighL]!.clone(), s0 = b.lq[BONE_INDEX.shinL]!.clone(), f0 = b.lq[BONE_INDEX.footL]!.clone();
    crawlPose(crawlInput({ s: 10, beat: 6.2, twitch: 0.5 }), b);
    const qh = b.lq[BONE_INDEX.thighL]!.clone();
    crawlPose(crawlInput({ s: 10, beat: 6.2, twitch: 1 }), b);
    const q1 = b.lq[BONE_INDEX.thighL]!.clone();
    expect(q0.angleTo(q1)).toBeGreaterThan(0.5);
    expect(s0.angleTo(b.lq[BONE_INDEX.shinL]!)).toBeGreaterThan(0.3);
    expect(f0.angleTo(b.lq[BONE_INDEX.footL]!)).toBeGreaterThan(0.3);
    // 一半的时候在两者之间
    expect(q0.angleTo(qh)).toBeGreaterThan(0.1);
    expect(qh.angleTo(q1)).toBeGreaterThan(0.1);
  });

  it('duck: the whole body stays below the lowest bar (0.36 m), the chest close to the floor, elbows bent', () => {
    const lowest = Math.min(...Object.values(OBSTACLES).filter((o) => o.cls === 'bar').map((o) => o.y0));
    expect(lowest).toBeCloseTo(0.36, 2);
    for (const beat of BEATS) {
      const crawlTop = extentY(crawlPose(crawlInput({ s: 10, beat }), b)).max;
      const p = crawlPose(crawlInput({ s: 10, beat, duck: 1, mode: 'duck' }), b);
      const e = extentY(p);
      expect(e.max).toBeLessThan(lowest - 0.01);
      expect(e.max).toBeLessThan(crawlTop - 0.3);
      expect(e.min).toBeGreaterThan(-0.02);
      // 胸口：胸骨关节离地 ≤ 0.24 m（胸盒下沿约 0.07–0.12 m）
      expect(jointY('chest')).toBeLessThan(0.24);
      // 左手支撑期（偶数拍起的 0.57 拍）：肘弯（上臂方向与前臂方向的夹角）约 70°，在 45°–115° 之间
      if (beat % 2 < 0.57) {
        const sh = b.jointWorld('upperArmL', new THREE.Vector3()), el = b.jointWorld('foreArmL', new THREE.Vector3()), wr = b.jointWorld('palmL', new THREE.Vector3());
        const flex = el.clone().sub(sh).angleTo(wr.clone().sub(el)) * 180 / Math.PI;
        expect(flex).toBeGreaterThan(45);
        expect(flex).toBeLessThan(115);
      }
    }
  });
});

describe('crawl readability in the default chase camera (lead requirement 2, §10.1)', () => {
  const W = 640, H = 360;
  function chaseCam(x: number): THREE.PerspectiveCamera {
    const L = FOLLOW.landscape;
    const fov = Math.min(L.vMax, Math.max(L.vMin, vFromH(L.hfov, W / H)));
    const cam = new THREE.PerspectiveCamera(fov, W / H, 0.05, 100);
    cam.position.set(L.k * x, L.h, L.back);
    cam.lookAt(L.lookK * x, L.ly, L.lz);
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('the legs drag low behind the hips, close together (no V, no scorpion tail), and swing sideways with the gait (U5)', () => {
    const xs: number[] = [];
    for (const beat of BEATS) {
      crawlPose(crawlInput({ s: 0, beat }), b);
      const L = b.jointWorld('footL', new THREE.Vector3()), R = b.jointWorld('footR', new THREE.Vector3());
      const hip = b.jointWorld('pelvis', new THREE.Vector3());
      expect(R.x - L.x).toBeGreaterThan(0.1);                   // 两脚没有并成一条
      expect(R.x - L.x).toBeLessThan(0.36);                     // 也不再张成 V 字
      expect(L.z - hip.z).toBeGreaterThan(0.6);                  // 在髋后方拖着（+z 是身后）
      expect(R.z - hip.z).toBeGreaterThan(0.6);
      expect(L.y).toBeLessThan(0.42); expect(R.y).toBeLessThan(0.42);   // 鞋不翘过髋
      xs.push((L.x + R.x) / 2);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.08);   // 行李左右甩
  });

  it('crawl: the shin makes at most 20° with the ground, in every phase and at the leg-spring extremes (U5)', () => {
    let worst = 0;
    for (const beat of BEATS) for (const legKnee of [-0.3, 0, 0.3]) for (const legHip of [-0.25, 0, 0.25]) {
      crawlPose(crawlInput({ s: 0, beat, legKnee, legHip }), b);
      for (const side of ['L', 'R'] as const) {
        const knee = b.jointWorld(`shin${side}`, new THREE.Vector3()), ankle = b.jointWorld(`foot${side}`, new THREE.Vector3());
        const d = ankle.sub(knee);
        worst = Math.max(worst, Math.abs(Math.atan2(d.y, Math.hypot(d.x, d.z))) * 180 / Math.PI);
      }
    }
    expect(worst).toBeLessThanOrEqual(20);
  });

  it('the swing arm lifts its elbow; the stance arm stays tucked', () => {
    // 偶数拍左手落掌：拍 6.0 左手刚支撑、右手在摆动中段附近
    let maxGap = 0;
    for (const beat of [6.3, 6.5, 6.7]) {
      crawlPose(crawlInput({ s: 0, beat }), b);
      const eL = jointY('foreArmL'), eR = jointY('foreArmR');
      maxGap = Math.max(maxGap, eR - eL);
    }
    expect(maxGap).toBeGreaterThan(0.08);
  });

  it('the soles are dark: their vertex colour lit by morning (Lambert ÷ π, Neutral, sRGB) has HSL lightness ≤ 0.45 (U5)', () => {
    // 鞋底朝后上方（正对追尾镜头），也正对着早晨的平行光：取爬姿里鞋底的实际法线
    crawlPose(crawlInput({ s: 0, beat: 6.2 }), b);
    const n = new THREE.Vector3(0, -1, 0).applyQuaternion(b.wq[BONE_INDEX.footL]!).applyQuaternion(b.rootQ).normalize();
    let found = 0;
    for (let i = 0; i < col.count; i++) {
      if (Math.abs(col.getX(i) - sole.r) > 1e-4 || Math.abs(col.getY(i) - sole.g) > 1e-4 || Math.abs(col.getZ(i) - sole.b) > 1e-4) continue;
      found++;
      for (const atmo of ['morning', 'noon', 'dream'] as const) {
        const c = screenColor([col.getX(i), col.getY(i), col.getZ(i)], presetOf(atmo), [n.x, n.y, n.z]);
        const l = (Math.max(...c) + Math.min(...c)) / 2;
        expect(l).toBeLessThanOrEqual(atmo === 'morning' ? 0.45 : 0.5);
      }
      break;
    }
    expect(found).toBe(1);
  });

  it('the planted hands show beside the torso in the chase camera (reach 0.38, hands 0.38 m out; U5)', () => {
    const cam = chaseCam(0);
    const P = new THREE.Vector3();
    const torso = new Set([BONE_INDEX.spine, BONE_INDEX.chest]);
    for (const beat of [6.1, 6.3, 7.1, 7.3]) {
      const p = crawlPose(crawlInput({ s: 0, beat }), b);
      let tx0 = Infinity, tx1 = -Infinity;
      skinned(p, (v, i) => { if (!torso.has(skin.getX(i))) return; P.copy(v).project(cam); tx0 = Math.min(tx0, P.x); tx1 = Math.max(tx1, P.x); });
      const side = Math.floor(beat) % 2 === 0 ? 'L' : 'R';                   // 偶数拍左手支撑
      const palm = b.jointWorld(`pad${side}`, new THREE.Vector3()).project(cam);
      // 指腹在躯干剪影外侧至少约 10 px（640 宽；以前 reach 0.3、handX 0.33 时只有约 8 px）
      expect(side === 'L' ? tx0 - palm.x : palm.x - tx1).toBeGreaterThan(0.032);
    }
  });

  it('the torso leans forward: shoulders only a little above the hips, the head above the shoulders', () => {
    crawlPose(crawlInput({ s: 0, beat: 6.2 }), b);
    const hip = jointY('pelvis'), sh = (jointY('upperArmL') + jointY('upperArmR')) / 2, head = jointY('head');
    expect(sh - hip).toBeGreaterThan(0.02);
    expect(sh - hip).toBeLessThan(0.14);
    expect(head).toBeGreaterThan(sh);
  });
});
