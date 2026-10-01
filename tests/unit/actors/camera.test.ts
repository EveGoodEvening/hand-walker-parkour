// tests/unit/actors/camera.test.ts —— §8.10 WP5 验收 6、7：竖屏 360×640 下三条车道中心都投影在视口内；
// 「减少晃动」关闭晃动、滚转、震动和视角变化。另测 §5.4 的机位数值。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/core/settings';
import { CameraRig, vFromH } from '../../../src/render/camera/CameraRig';
import { FOLLOW, SEGMENT_SHOTS } from '../../../src/render/camera/shots';
import { snap } from './helpers';

function apply(cam: THREE.PerspectiveCamera, o: { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number }, aspect: number): void {
  cam.aspect = aspect; cam.fov = o.fov;
  cam.position.copy(o.pos); cam.up.set(0, 1, 0); cam.lookAt(o.look);
  if (o.roll) cam.rotateZ(o.roll);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}

function settle(rig: CameraRig, s0: ReturnType<typeof snap>, aspect: number, settings: Settings, frames = 90) {
  let prev = s0, out = rig.compute(s0, s0, 1, 1 / 60, aspect, settings);
  for (let i = 1; i <= frames; i++) {
    const n = snap({ ...{ s: s0.player.s + i * 0.08, lane: s0.player.lane, x: s0.player.x, beat: (s0.player.s + i * 0.08) }, t: s0.t + i / 60 });
    out = rig.compute(prev, n, 1, 1 / 60, aspect, settings);
    prev = n;
  }
  return { out, last: prev };
}

describe('CameraRig (§5.4)', () => {
  it('landscape follow camera matches FOLLOW.landscape: (0.7·x, 1.15, +2.8) (U5, replaces §5.4 0.92 / 2.35), vertical fov 50–62°', () => {
    const rig = new CameraRig();
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: true };
    const { out, last } = settle(rig, snap({ s: 10, lane: 1 }), 16 / 9, settings);
    expect(out.pos.x).toBeCloseTo(0.7 * 1.1, 2);
    expect(out.pos.y).toBeCloseTo(FOLLOW.landscape.h, 3);
    expect(out.pos.z).toBeCloseTo(-last.player.s + FOLLOW.landscape.back, 3);
    expect(out.look.y).toBeCloseTo(FOLLOW.landscape.ly, 3);
    expect(out.fov).toBeGreaterThanOrEqual(50);
    expect(out.fov).toBeLessThanOrEqual(62);
  });

  it('portrait 360×640: all three lane centres project inside the viewport from every lane', () => {
    const aspect = 360 / 640;
    const cam = new THREE.PerspectiveCamera(55, aspect, 0.05, 240);
    for (const lane of [-1, 0, 1] as const) {
      const rig = new CameraRig();
      const { out, last } = settle(rig, snap({ s: 20, lane }), aspect, { ...DEFAULT_SETTINGS });
      expect(out.fov).toBeLessThanOrEqual(80);
      apply(cam, out, aspect);
      for (const l of [-1, 0, 1]) {
        // 车道中心：玩家所在里程处的地面，以及前方 4 m 处
        for (const ahead of [0, 4]) {
          const p = new THREE.Vector3(l * 1.1, 0, -(last.player.s + ahead)).project(cam);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
          expect(p.z).toBeLessThan(1);
        }
      }
    }
  });

  it('reducedMotion: no bob, no roll, no shake, no fov change; look-back is a cut', () => {
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: true };
    const rig = new CameraRig();
    let prev = snap({ s: 0 });
    const ys: number[] = [], rolls: number[] = [], fovs: number[] = [];
    rig.onEvent({ type: 'hit', tick: 0, data: { severity: 'stumble', kind: 'bag', obstacleId: 1, lane: 0, steady: 2, crowd: false, firstLegHit: false } } as never);
    for (let i = 1; i < 120; i++) {
      const lane = i < 40 ? 0 : 1;
      const x = i < 40 ? 0 : Math.min(1.1, (i - 40) * 0.15);
      const n = snap({ s: i * 0.05, beat: i * 0.05, lane, x, t: i / 60, speed: i > 80 ? 8 : 5 });
      const o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      ys.push(o.pos.y); rolls.push(o.roll); fovs.push(o.fov);
      prev = n;
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9);
    expect(rolls.every((r) => r === 0)).toBe(true);
    expect(Math.max(...fovs) - Math.min(...fovs)).toBeLessThan(1e-9);
    // 回头：直接切镜头（lookBack < 0.5 不转，≥ 0.5 转到 160°）
    const r2 = new CameraRig();
    const a = r2.compute(snap({ s: 5 }), snap({ s: 5, lookBack: 0.3, t: 0.1 }), 1, 1 / 60, 16 / 9, settings);
    expect(a.pos.z).toBeGreaterThan(-5);
    const b = r2.compute(snap({ s: 5, t: 0.1 }), snap({ s: 5, lookBack: 0.6, t: 0.2 }), 1, 1 / 60, 16 / 9, settings);
    expect(b.pos.z).toBeLessThan(-5);        // 转到玩家前方，看向身后
  });

  it('without reducedMotion the gait bob, lane-change roll, hit shake and dream fov are present', () => {
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: false };
    const rig = new CameraRig();
    let prev = snap({ s: 0 });
    const ys: number[] = [], rolls: number[] = [], fovs: number[] = [];
    for (let i = 1; i < 150; i++) {
      if (i === 100) rig.onEvent({ type: 'hit', tick: 0, data: { severity: 'crash', kind: 'bag', obstacleId: 1, lane: 0, steady: 1, crowd: false, firstLegHit: false } } as never);
      const lane = i < 40 ? 0 : 1;
      const x = i < 40 ? 0 : Math.min(1.1, (i - 40) * 0.15);
      const n = snap({ s: i * 0.08, beat: i * 0.08, lane, x, t: i / 60, speed: i > 110 ? 9 : 5 });
      const o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      ys.push(o.pos.y); rolls.push(o.roll); fovs.push(o.fov);
      prev = n;
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.008);
    expect(Math.max(...rolls.map(Math.abs))).toBeGreaterThan(0.005);
    expect(Math.max(...rolls.map(Math.abs))).toBeLessThanOrEqual(1.5 * Math.PI / 180 + 1e-9);
    expect(Math.max(...fovs)).toBeGreaterThan(Math.min(...fovs) + 1);
  });

  it('vFromH derives the vertical fov from 76° horizontal', () => {
    expect(vFromH(76, 16 / 9)).toBeCloseTo(47.4, 0);
    expect(vFromH(76, 1)).toBeCloseTo(76, 6);
  });
});

describe('segment chase shot (U5): 5-3 @30–@140 pulls back so the shadow crawling after you is in frame', () => {
  const run = (segBeatOf: (i: number) => number, frames: number) => {
    const rig = new CameraRig();
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: false };
    let prev = snap({ s: 0 }); prev.segment = '5-3';
    let o = rig.compute(prev, prev, 1, 1 / 60, 16 / 9, settings);
    for (let i = 1; i <= frames; i++) {
      const n = snap({ s: i * 0.09, beat: i * 0.09, t: i / 60 });
      n.segment = '5-3'; n.segBeat = segBeatOf(i);
      o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      prev = n;
    }
    return { o, last: prev };
  };
  it('inside the range the camera is ~1.8 m up and ~3.8 m back, looking at the ground 2 m ahead; outside it is the normal follow camera', () => {
    const inside = run((i) => 40 + i * 0.08, 120);
    const sh = SEGMENT_SHOTS['5-3']!;
    expect(inside.o.pos.y).toBeCloseTo(sh.h, 1);
    expect(inside.o.pos.z - -inside.last.player.s).toBeCloseTo(sh.back, 1);
    expect(inside.o.look.y).toBeLessThan(0.15);
    // 身后 2 m 的地面在画面里（追来的影子）
    const cam = new THREE.PerspectiveCamera(inside.o.fov, 16 / 9, 0.05, 200);
    apply(cam, inside.o, 16 / 9);
    const behind = new THREE.Vector3(0, 0, -inside.last.player.s + 2).project(cam);
    expect(Math.abs(behind.x)).toBeLessThan(1); expect(Math.abs(behind.y)).toBeLessThan(1);
    const outside = run((i) => 141 + i * 0.08, 120);
    expect(outside.o.pos.y).toBeCloseTo(FOLLOW.landscape.h, 1);
  });
});
