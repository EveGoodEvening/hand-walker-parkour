// tests/unit/actors/rig.test.ts —— §8.10 WP5 验收 1、4：每个角色 1 次 draw call；三角形高 ≤ 2.5k、低 ≤ 1.2k；
// 附录 A-4 没有嘴（只有两个小方块做眼睛）；镜像替身的左右手正确（负缩放后法线不翻转）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX } from '../../../src/core/rig';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { ActorRigFactory, buildRigGeometry, RIG_COLORS, rigDetail, triangleCount } from '../../../src/render/actors/rigBuild';
import { reflectX, reflectZ } from '../../../src/render/actors/surfaces';
import { QUALITY } from '../../../src/core/quality';
import { crawlInput, fakeCtx } from './helpers';

describe('rig geometry', () => {
  it('stays within the triangle budget per quality tier (§5.5)', () => {
    const low = triangleCount(buildRigGeometry(rigDetail(QUALITY.low)));
    const med = triangleCount(buildRigGeometry(rigDetail(QUALITY.medium)));
    const high = triangleCount(buildRigGeometry(rigDetail(QUALITY.high)));
    expect(low).toBeLessThanOrEqual(1200);
    expect(high).toBeLessThanOrEqual(2500);
    expect(low).toBeLessThan(med + 1);
    expect(med).toBeLessThan(high + 1);
  });

  it('is rigid-skinned: one skin index per vertex, weight 1', () => {
    const g = buildRigGeometry(rigDetail(QUALITY.low));
    const idx = g.getAttribute('skinIndex') as THREE.BufferAttribute;
    const w = g.getAttribute('skinWeight') as THREE.BufferAttribute;
    expect(idx.count).toBe((g.getAttribute('position') as THREE.BufferAttribute).count);
    for (let i = 0; i < w.count; i += 17) {
      expect(w.getX(i)).toBe(1);
      expect(w.getY(i) + w.getZ(i) + w.getW(i)).toBe(0);
    }
    expect(g.getAttribute('color')).toBeTruthy();
    expect(g.getAttribute('aChalk')).toBeTruthy();
  });

  it('has exactly two small eye boxes and no mouth (appendix A-4)', () => {
    const g = buildRigGeometry(rigDetail(QUALITY.low));
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const skin = g.getAttribute('skinIndex') as THREE.BufferAttribute;
    const eye = new THREE.Color().setHex(RIG_COLORS.eye);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const boxes = [new THREE.Box3(), new THREE.Box3()];
    let n = 0;
    for (let i = 0; i < col.count; i++) {
      if (Math.abs(col.getX(i) - eye.r) < 1e-4 && Math.abs(col.getY(i) - eye.g) < 1e-4 && Math.abs(col.getZ(i) - eye.b) < 1e-4) {
        n++;
        expect(skin.getX(i)).toBe(BONE_INDEX.head);
        boxes[pos.getX(i) < 0 ? 0 : 1]!.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
      }
    }
    expect(n).toBe(2 * 36);       // 两个方块，每个 12 个三角形
    // §5.5：每只眼是 0.012 m 的小方块
    for (const bx of boxes) {
      const sz = bx.getSize(new THREE.Vector3());
      for (const c of [sz.x, sz.y, sz.z]) expect(c).toBeCloseTo(0.012, 4);
    }
  });

  it('every character is a single SkinnedMesh (1 draw call) sharing one geometry', () => {
    const f = new ActorRigFactory(fakeCtx('low'));
    const roles = ['player', 'double', 'shadow', 'leader'] as const;
    const rigs = roles.map((r) => f.make(r));
    for (const r of rigs) {
      let meshes = 0;
      r.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes).toBe(1);
      expect(r.mesh.isSkinnedMesh).toBe(true);
      expect(Array.isArray(r.mesh.material)).toBe(false);
      expect(r.mesh.geometry).toBe(rigs[0]?.mesh.geometry);
    }
    // 切换画质：换共用几何体，不新建角色
    f.setQuality({ ...fakeCtx('high').quality });
    expect(triangleCount(rigs[0]!.mesh.geometry)).toBeGreaterThan(triangleCount(f.geometry('low')));
    for (const r of rigs) expect(r.mesh.geometry).toBe(rigs[0]?.mesh.geometry);
  });
});

describe('mirrored doubles', () => {
  const place = (reflect: THREE.Matrix4) => {
    const f = new ActorRigFactory(fakeCtx('low'));
    const rig = f.make('double');
    const box = new THREE.Group();
    box.matrixAutoUpdate = false;
    box.matrix.copy(reflect);
    box.add(rig.root);
    const b = new PoseBuilder();
    // 源姿势：站在走廊里（x = −1.0），朝 −z 爬
    rig.apply(crawlPose(crawlInput({ s: 10, x: -1.0, beat: 0.2 }), b));
    box.updateMatrixWorld(true);
    const L = new THREE.Vector3().setFromMatrixPosition((rig.bones[BONE_INDEX.palmL] as THREE.Bone).matrixWorld);
    const R = new THREE.Vector3().setFromMatrixPosition((rig.bones[BONE_INDEX.palmR] as THREE.Bone).matrixWorld);
    const H = new THREE.Vector3().setFromMatrixPosition((rig.bones[BONE_INDEX.head] as THREE.Bone).matrixWorld);
    const P = new THREE.Vector3().setFromMatrixPosition((rig.bones[BONE_INDEX.pelvis] as THREE.Bone).matrixWorld);
    return { rig, L, R, H, P, mat: rig.mesh.material as THREE.MeshLambertMaterial };
  };

  it('side mirror: negative determinant (three flips the front face), left hand stays on the mirror side', () => {
    const wall = -1.8;
    const { rig, L, R, mat } = place(reflectX(wall));
    expect(rig.mesh.matrixWorld.determinantAffine()).toBeLessThan(0);
    // 真实镜子：离镜面近的那只手，在倒影里仍然离镜面近
    const srcL = -1.0 - 0.3, srcR = -1.0 + 0.3;
    expect(Math.abs(srcL - wall)).toBeLessThan(Math.abs(srcR - wall));
    expect(Math.abs(L.x - wall)).toBeLessThan(Math.abs(R.x - wall));
    // 替身在镜面后面（镜中房间里）
    expect(L.x).toBeLessThan(wall);
    expect(R.x).toBeLessThan(wall);
    // 平面着色：法线由屏幕空间导数得出，负缩放不会把法线翻到里面
    expect(mat.flatShading).toBe(true);
  });

  it('end mirror: the double faces back toward the player', () => {
    const { rig, H, P } = place(reflectZ(-20));
    expect(rig.mesh.matrixWorld.determinantAffine()).toBeLessThan(0);
    // 源在 s = 10（z = −10）朝 −z；倒影在 z = −30 附近，头朝 +z（朝向玩家）
    expect(P.z).toBeLessThan(-20);
    expect(H.z).toBeGreaterThan(P.z);
  });
});
