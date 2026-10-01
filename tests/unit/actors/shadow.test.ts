// tests/unit/actors/shadow.test.ts —— 平面影子的模式（§3「影子与本体不一致」）：独立骨架，按模式改姿势。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, copyPose } from '../../../src/core/rig';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { applyPosture, standing } from '../../../src/render/actors/poses';
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

// —— 修复轮 U5：影子异常事件期间，影子伸出身体 2–3 m，方向在前右方（+x、−z），追尾 / 站立机位都看得见 ——
function projected(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  const m = mesh as unknown as THREE.SkinnedMesh;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, skin = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const bi = skin.getX(i);
    if (bi >= BONE_INDEX.propHead) continue;                                     // 道具（缩放为 0）
    if (bi >= BONE_INDEX.arm3Upper && (root.getObjectByName('arm3Upper') as THREE.Bone).scale.x < 0.01) continue;
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    m.applyBoneTransform(i, v);
    out.push(v.applyMatrix4(m.matrixWorld));
  }
  return out;
}

describe('shadow anomalies are cast long and front-right (U5)', () => {
  const MODES = ['jellyfish', 'threeHands', 'pointBack', 'pointMirror', 'long', 'reversed', 'chase', 'liesDown'] as const;
  for (const atmo of ['morning', 'dawn', 'dream'] as const) {
    for (const mode of MODES) {
      it(`${mode} (${atmo}): the shadow reaches ≥ 2 m from the root, toward +x / −z`, () => {
        const m = setup('low');
        m.sh.onEvent({ type: 'cue', tick: 0, data: { body: { type: 'atmosphere', id: atmo, seconds: 0.01 } } } as never);
        const b = new PoseBuilder();
        let s = snap({ s: 20, beat: 20.2, t: 1 });
        if (mode === 'liesDown') {
          s = snap({ s: 20, t: 1, segKind: 'stand' });
          s.player.stand = { phase: 'walking', x: 0, theta: 0, steps: 0, stepT: 0, held: 0, script: 'dream' } as never;
          copyPose(WP5.playerPose, applyPosture(standing({ knee: 6, lean: 3 }), { x: 0, y: 0, s: 20, yaw: 0 }, b));
        } else copyPose(WP5.playerPose, crawlPose(crawlInput({ s: 20, beat: 20.2 }), b));
        if (mode === 'chase') s.follower = { ...s.follower, mode: 'pressure', hud: 'shadow', distance: 2 };
        WP5.playerRoot.set(s.player.x, s.player.floorY, -s.player.s);
        m.sh.frame(s, s, 1, 1 / 60);
        m.sh.setMode(mode === 'chase' ? 'reversed' : mode, 10, 1.05);
        for (let i = 1; i <= 60; i++) { const n = { ...s, t: 1.05 + i / 60 }; m.sh.frame(n, n, 1, 1 / 60); }
        expect(m.sh.state.planar).toBe(true);
        expect(m.sh.state.eventK).toBe(1);
        if (mode !== 'long' && mode !== 'liesDown') expect(m.sh.state.ratio).toBeGreaterThanOrEqual(3);
        const L = m.sh.light;
        expect(L.x).toBeGreaterThan(0); expect(L.z).toBeLessThan(0);
        const hx = L.x / Math.hypot(L.x, L.z), hz = L.z / Math.hypot(L.x, L.z);
        const pts = projected(m.rigs[0] as THREE.Object3D);
        const rx = s.player.x, rz = -s.player.s;
        let tip = -Infinity, cx = 0, cz = 0;
        for (const p of pts) { tip = Math.max(tip, (p.x - rx) * hx + (p.z - rz) * hz); cx += p.x - rx; cz += p.z - rz; }
        expect(tip).toBeGreaterThanOrEqual(2);
        if (mode !== 'long') expect(tip).toBeLessThanOrEqual(mode === 'liesDown' ? 4.8 : 4.0);           // 关节伸出约 2.5 m（鞋尖、发梢再远一点），不是一条拖到画面外的长带
        expect(cx / pts.length).toBeGreaterThan(0);
        expect(cz / pts.length).toBeLessThan(0);
      });
    }
  }

  it('chase: the second shadow is 0.5 opaque, compact behind you and does not overlap your own shadow', () => {
    const m = setup('medium');
    const b = new PoseBuilder();
    copyPose(WP5.playerPose, crawlPose(crawlInput({ s: 20, beat: 20.2 }), b));
    const s = snap({ s: 20, beat: 20.2, t: 2 });
    s.follower = { ...s.follower, mode: 'pressure', hud: 'shadow', distance: 2 };
    for (let i = 0; i < 60; i++) { const n = { ...s, t: 2 + i / 60 }; m.sh.frame(n, n, 1, 1 / 60); }
    expect(m.sh.state.second).toBe(true);
    const second = m.rigs[1] as THREE.Object3D;
    let mesh: THREE.SkinnedMesh | null = null;
    second.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
    expect(((mesh as unknown as THREE.SkinnedMesh).material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.5, 6);
    const mine = projected(m.rigs[0] as THREE.Object3D), its = projected(second);
    const zMineMax = Math.max(...mine.map((p) => p.z)), zItsMin = Math.min(...its.map((p) => p.z));
    expect(zItsMin).toBeGreaterThan(zMineMax - 0.05);                  // 它整个在你的影子后面（+z 是身后）
  });
});
