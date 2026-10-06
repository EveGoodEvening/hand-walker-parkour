// tests/unit/actors/clips.test.ts —— §5.6 脚本姿势、第三只手、站立段、平面影子矩阵。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, createPose, type Pose } from '../../../src/core/rig';
import type { StandSnap, ThirdHandGesture } from '../../../src/core/types';
import { ALL_CLIPS, clipPose } from '../../../src/render/actors/clips';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { readableLight, shadowMatrix } from '../../../src/render/actors/PlanarShadow';
import { standPose } from '../../../src/render/actors/poses';
import { applyThirdHand, gestureExtend } from '../../../src/render/actors/ThirdHand';
import { crawlInput, snap } from './helpers';

function finite(p: Pose): boolean {
  for (let i = 0; i < p.q.length; i += 4) {
    const n = Math.hypot(p.q[i]!, p.q[i + 1]!, p.q[i + 2]!, p.q[i + 3]!);
    if (!Number.isFinite(n) || Math.abs(n - 1) > 1e-3) return false;
  }
  return Array.from(p.root).every(Number.isFinite);
}

describe('PoseClipId library', () => {
  it('covers all 31 frozen clip ids and produces valid poses over time', () => {
    expect(ALL_CLIPS.length).toBe(31);
    const b = new PoseBuilder();
    const out = createPose();
    for (const id of ALL_CLIPS) {
      for (const t of [0, 0.4, 1.3, 3]) {
        clipPose(id, t, b, out, { x: 0, y: 0, s: 0, yaw: 0 });
        expect(finite(out), `${id} @ ${t}`).toBe(true);
      }
    }
  });

  it('standing clips put the feet on the floor and the head at eye height (~1.5 m)', () => {
    const b = new PoseBuilder();
    const out = createPose();
    clipPose('standIdle', 0, b, out, { x: 0, y: 0, s: 0, yaw: 0 });
    b.load(out);
    const head = b.wp[BONE_INDEX.head]!.y + out.root[1]!;
    const foot = b.wp[BONE_INDEX.footL]!.y + out.root[1]!;
    expect(head).toBeGreaterThan(1.3); expect(head).toBeLessThan(1.6);
    expect(foot).toBeGreaterThan(0.05); expect(foot).toBeLessThan(0.14);
  });

  it('handstand: wrists at the pivot, feet pointing at the sky (1-2 memory)', () => {
    const b = new PoseBuilder();
    const out = createPose();
    clipPose('handstand', 0.3, b, out, { x: 0, y: 0, s: 0, yaw: 0 });
    b.load(out);
    const wrist = b.wp[BONE_INDEX.palmL]!.y + out.root[1]!;
    const foot = b.wp[BONE_INDEX.footL]!.y + out.root[1]!;
    const head = b.wp[BONE_INDEX.head]!.y + out.root[1]!;
    expect(wrist).toBeLessThan(0.15);
    expect(foot).toBeGreaterThan(1.6);
    expect(head).toBeLessThan(foot);
  });
});

describe('third hand (§3)', () => {
  it('extends slowly (1.2 s), holds, retracts', () => {
    expect(gestureExtend(-0.1, 3)).toBe(0);
    expect(gestureExtend(0.6, 3)).toBeGreaterThan(0.3);
    expect(gestureExtend(0.6, 3)).toBeLessThan(0.7);
    expect(gestureExtend(2, 3)).toBe(1);
    expect(gestureExtend(4.2 + 1.0, 3)).toBe(0);
  });

  it('every gesture solves to finite rotations; shush puts the hand in front of the face', () => {
    const b = new PoseBuilder();
    for (const g of ['shush', 'palmGlass', 'forehead', 'shoulder', 'point', 'neck'] as ThirdHandGesture[]) {
      crawlPose(crawlInput({ s: 3, beat: 3.2 }), b);
      applyThirdHand(b, g, 1, 0.5, { point: new THREE.Vector3(0.1, 0.6, -3.8), dir: new THREE.Vector3(0, 0, -1) });
      b.fkAll();
      const p = b.finish();
      expect(finite(p), g).toBe(true);
      expect(p.thirdHand).toBe(1);
    }
    crawlPose(crawlInput({ s: 3, beat: 3.2 }), b);
    applyThirdHand(b, 'shush', 1, 0.5);
    b.fkAll();
    const hand = b.wp[BONE_INDEX.arm3Hand]!, head = b.wp[BONE_INDEX.head]!;
    expect(hand.distanceTo(head)).toBeLessThan(0.3);
    // 从胸口伸出（伸出程度为 0 时整条缩为 0）
    crawlPose(crawlInput({ s: 3, beat: 3.2 }), b);
    applyThirdHand(b, 'shush', 0, 0.5);
    expect(b.finish().thirdHand).toBe(0);
  });
});

describe('stand segment poses (§3「站起来」)', () => {
  const st = (o: Partial<StandSnap>): StandSnap => ({ script: 'sevenSteps', phase: 'walking', held: 3, steps: 2, stepT: 0.3, theta: 0.1, x: 0, ...o });
  it('covers wait / rising / walking / planted / fallen with valid poses', () => {
    const b = new PoseBuilder();
    for (const phase of ['wait', 'rising', 'walking', 'planted', 'fallen'] as const) {
      const s = snap({ s: 5, segKind: 'stand' });
      s.player.stand = st({ phase });
      expect(finite(standPose(s, s, 1, b)), phase).toBe(true);
    }
    const s = snap({ s: 5, segKind: 'stand' });
    s.player.stand = null;
    expect(finite(standPose(s, s, 1, b))).toBe(true);
  });
});

describe('planar shadow matrix (§5.8)', () => {
  it('projects along the light direction onto y = h', () => {
    const L = new THREE.Vector3(0.3, -1, -0.55).normalize();
    const M = shadowMatrix(L, 0.004);
    const p = new THREE.Vector3(0.2, 0.5, -3).applyMatrix4(M);
    expect(p.y).toBeCloseTo(0.004, 6);
    const k = (0.5 - 0.004) / -L.y;
    expect(p.x).toBeCloseTo(0.2 + L.x * k, 6);
    expect(p.z).toBeCloseTo(-3 + L.z * k, 6);
  });
  it('readableLight keeps the direction but lowers steep light so the shadow leaves the body (front-right)', () => {
    const out = readableLight(new THREE.Vector3(0.3, -1, -0.55).normalize(), new THREE.Vector3());
    expect(Math.hypot(out.x, out.z) / -out.y).toBeGreaterThanOrEqual(1.2 - 1e-6);
    expect(out.x).toBeGreaterThan(0); expect(out.z).toBeLessThan(0);
    const dawn = readableLight(new THREE.Vector3(0.1, -0.6, 0.8).normalize(), new THREE.Vector3());
    expect(dawn.z).toBeGreaterThan(0);        // 第五章清晨：光从前方来，影子向后落
  });
});
