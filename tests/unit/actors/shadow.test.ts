// tests/unit/actors/shadow.test.ts —— 平面影子的模式（§3「影子与本体不一致」）：独立骨架，按模式改姿势。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, copyPose } from '../../../src/core/rig';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { PlanarShadowSystem } from '../../../src/render/actors/PlanarShadow';
import { ActorRigFactory, type Rig } from '../../../src/render/actors/rigBuild';
import { WP5 } from '../../../src/render/actors/shared';
import { crawlInput, fakeCtx, snap } from './helpers';

function setup(tier: 'low' | 'medium' = 'medium') {
  const ctx = fakeCtx(tier);
  const f = new ActorRigFactory(ctx);
  (ctx as { rig: unknown }).rig = f;
  const sh = new PlanarShadowSystem();
  sh.init(ctx);
  const b = new PoseBuilder();
  copyPose(WP5.playerPose, crawlPose(crawlInput({ s: 5, beat: 5.2 }), b));
  WP5.playerVisible = true;
  WP5.poseTest = null;
  const rigs = ctx.scene.children.filter((o) => o.name === 'rig:shadow');
  return { ctx, sh, rigs };
}
const boneWorld = (root: THREE.Object3D, name: string) => {
  root.updateMatrixWorld(true);
  const bone = root.getObjectByName(name) as THREE.Bone;
  return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
};

describe('planar shadow modes', () => {
  it('normal: planar on medium, blob-only on low until an event', () => {
    const m = setup('medium');
    const s = snap({ s: 5, beat: 5.2, t: 1 });
    m.sh.frame(s, s, 1, 1 / 60);
    expect(m.sh.state.planar).toBe(true);
    const l = setup('low');
    l.sh.frame(s, s, 1, 1 / 60);
    expect(l.sh.state.planar).toBe(false);
    expect(l.sh.state.blob).toBe(true);
    l.sh.setMode('jellyfish', 3, 1);
    l.sh.frame(s, snap({ s: 5, beat: 5.2, t: 1.5 }), 1, 1 / 60);
    expect(l.sh.state.planar).toBe(true);
    l.sh.frame(s, snap({ s: 5, beat: 5.2, t: 4.5 }), 1, 1 / 60);   // seconds 到了回到 normal
    expect(l.sh.mode).toBe('normal');
  });

  it('threeHands: the shadow grows a third arm from the chest, pointing out and back', () => {
    const m = setup('medium');
    m.sh.setMode('threeHands', undefined, 1);
    m.sh.frame(snap({ s: 5, beat: 5.2, t: 3 }), snap({ s: 5, beat: 5.2, t: 3 }), 1, 1 / 60);
    const root = m.rigs[0] as THREE.Object3D;
    const chest = boneWorld(root, 'chest');
    const hand = boneWorld(root, 'arm3Hand');
    expect((root.getObjectByName('arm3Upper') as THREE.Bone).scale.x).toBeGreaterThan(0.99);
    expect(hand.distanceTo(chest)).toBeGreaterThan(0.35);
    expect(hand.z).toBeGreaterThan(chest.z);       // 指向身后（+z）
  });

  it('jellyfish spreads the limbs wider than the body; reversed turns the head backward', () => {
    const m = setup('medium');
    const s = snap({ s: 5, beat: 5.2, t: 2 });
    m.sh.frame(s, s, 1, 1 / 60);
    const root = m.rigs[0] as THREE.Object3D;
    const w0 = Math.abs(boneWorld(root, 'palmL').x - boneWorld(root, 'palmR').x);
    m.sh.setMode('jellyfish', 3, 2);
    m.sh.frame(s, snap({ s: 5, beat: 5.2, t: 2.5 }), 1, 1 / 60);
    const w1 = Math.abs(boneWorld(root, 'palmL').x - boneWorld(root, 'palmR').x);
    expect(w1).toBeGreaterThan(w0 + 0.3);
    m.sh.setMode('reversed', undefined, 3);
    m.sh.frame(s, snap({ s: 5, beat: 5.2, t: 3.5 }), 1, 1 / 60);
    expect(boneWorld(root, 'head').z).toBeGreaterThan(boneWorld(root, 'pelvis').z);   // 头朝后（+z）
  });

  it('chase: a second shadow crawls behind at the follower distance', () => {
    const m = setup('medium');
    m.sh.setMode('chase', undefined, 1);
    const s = snap({ s: 20, beat: 20.1, t: 2 });
    s.follower = { ...s.follower, mode: 'pressure', distance: 2 };
    m.sh.frame(s, s, 1, 1 / 60);
    expect(m.sh.state.second).toBe(true);
    const second = m.rigs[1] as THREE.Object3D;
    expect(-boneWorld(second, 'pelvis').z).toBeLessThan(20 - 1.5);
  });
});
