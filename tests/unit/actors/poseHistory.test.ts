// tests/unit/actors/poseHistory.test.ts —— §8.10 WP5 验收 3：PoseHistory.sample 的插值正确，单次 < 0.02 ms。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_COUNT, createPose, type Pose } from '../../../src/core/rig';
import { PoseHistory } from '../../../src/render/actors/PoseHistory';

function poseAt(angle: number, s: number): Pose {
  const p = createPose();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
  for (let i = 0; i < BONE_COUNT; i++) q.toArray(p.q, i * 4);
  p.root[0] = s * 0.1; p.root[1] = 0.2; p.root[2] = s; p.root[3] = angle;
  p.thirdHand = angle / Math.PI;
  return p;
}

describe('PoseHistory (§5.8)', () => {
  it('interpolates between neighbouring frames with slerp and linear root', () => {
    const h = new PoseHistory(1024);
    h.push(0, poseAt(0, 0));
    h.push(1, poseAt(Math.PI / 2, 10));
    const out = createPose();
    expect(h.sample(0.5, out)).toBe(true);
    const q = new THREE.Quaternion().fromArray(out.q, 0);
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4);
    expect(q.angleTo(want)).toBeLessThan(1e-3);          // Float32 存储 + acos 在 1 附近放大误差（约 0.03°）
    expect(out.root[2]).toBeCloseTo(5, 6);
    expect(out.root[0]).toBeCloseTo(0.5, 6);
    expect(out.root[3]).toBeCloseTo(Math.PI / 4, 6);
    expect(out.thirdHand).toBeCloseTo(0.25, 6);
  });

  it('takes the short arc and handles angle wrap for yaw', () => {
    const h = new PoseHistory(8);
    const a = poseAt(0, 0), b = poseAt(0, 0);
    a.root[3] = Math.PI - 0.1; b.root[3] = -Math.PI + 0.1;
    // q 与 −q 表示同一旋转：插值必须走短弧
    for (let i = 0; i < BONE_COUNT * 4; i++) b.q[i] = -(b.q[i] as number);
    h.push(0, a); h.push(1, b);
    const out = createPose();
    h.sample(0.5, out);
    expect(Math.abs(Math.abs(out.root[3] as number) - Math.PI)).toBeLessThan(1e-6);
    expect(Math.abs(out.q[3] as number)).toBeCloseTo(1, 6);
  });

  it('clamps outside the stored range, overwrites equal times, clears on time rewind, keeps the newest cap frames', () => {
    const h = new PoseHistory(64);
    const out = createPose();
    expect(h.sample(0, out)).toBe(false);
    for (let i = 0; i < 200; i++) h.push(i / 120, poseAt(0, i));
    expect(h.size).toBe(64);
    h.sample(-5, out); expect(out.root[2]).toBe(200 - 64);
    h.sample(99, out); expect(out.root[2]).toBe(199);
    h.push(199 / 120, poseAt(0, 500));
    expect(h.size).toBe(64);
    h.sample(99, out); expect(out.root[2]).toBe(500);
    h.push(0.1, poseAt(0, 7));            // 时间回退（读新章）→ 清空
    expect(h.size).toBe(1);
    h.sample(3, out); expect(out.root[2]).toBe(7);
  });

  it('sample() costs < 0.02 ms on a full buffer', () => {
    const h = new PoseHistory(1024);
    for (let i = 0; i < 1024; i++) h.push(i / 120, poseAt((i % 50) / 50, i));
    const out = createPose();
    const N = 20000;
    for (let i = 0; i < 2000; i++) h.sample(((i * 37) % 1024) / 120 + 0.003, out);   // 预热
    const t0 = performance.now();
    for (let i = 0; i < N; i++) h.sample(((i * 37) % 1024) / 120 + 0.003, out);
    const per = (performance.now() - t0) / N;
    expect(per).toBeLessThan(0.02);
  });
});
