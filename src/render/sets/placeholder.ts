// src/render/sets/placeholder.ts —— CORE 的占位静场 set（DESIGN.md §8.9-10）。CORE 冻结。
// 任何没注册的 set 都回落到这里（registry.getSet）。统一做成「课桌下面」：水磨石地面、墙裙、一排排桌腿和椅腿、
// 前景里自己那双鞋（鞋底朝镜头）。坐标相对 STILL_ORIGIN（core/constants.ts）；主角锚点在原点。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../core/contracts';
import { GeoBuilder, mixHex } from '../../core/geo';
import { registerSet } from '../../core/registry';

function buildRoom(ctx: ViewContext): THREE.Object3D {
  const g = new GeoBuilder();
  const rng = ctx.rngFx.fork('placeholderSet');
  // 地面 8 × 8 m
  for (let z = -6; z < 2; z += 0.5) for (let x = -4; x < 4; x += 0.6) {
    const c = mixHex(0x8d9493, [0x6b7270, 0xb7bdbb, 0x9a9f9d][rng.int(3)] as number, 0.15 + rng.next() * 0.15);
    g.quad([x, 0, z + 0.5], [x + 0.6, 0, z + 0.5], [x + 0.6, 0, z], [x, 0, z], c);
  }
  // 远墙（墙裙 + 墙面）
  g.quad([-4, 0, -6], [4, 0, -6], [4, 1.1, -6], [-4, 1.1, -6], 0x5f7f7a);
  g.quad([-4, 1.1, -6], [4, 1.1, -6], [4, 3, -6], [-4, 3, -6], 0xc9cfcf);
  // 左右墙
  g.quad([-4, 0, 2], [-4, 0, -6], [-4, 3, -6], [-4, 3, 2], 0xb9c0c1);
  g.quad([4, 0, -6], [4, 0, 2], [4, 3, 2], [4, 3, -6], 0xb9c0c1);
  // 头顶的课桌（桌肚朝下）
  g.box([0, 0.74, -0.2], [1.2, 0.04, 0.6], 0xa8a294);
  g.box([0, 0.66, -0.2], [1.1, 0.12, 0.5], 0x5b6468, { faces: '-y+x-x-z' });
  for (const dx of [-0.55, 0.55]) for (const dz of [-0.45, 0.05]) g.box([dx, 0.36, dz], [0.035, 0.72, 0.035], 0x5b6468);
  // 一排排桌腿与椅腿（腿的森林）
  for (let row = 0; row < 4; row++) {
    for (let col = -2; col <= 2; col++) {
      if (row === 0 && col === 0) continue;
      const cx = col * 1.4 + (row % 2) * 0.3, cz = -1.2 - row * 1.3;
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.22, 0.22]) g.box([cx + dx, 0.36, cz + dz], [0.035, 0.72, 0.035], 0x5b6468);
      g.box([cx, 0.74, cz], [1.2, 0.04, 0.55], 0xa8a294, { faces: '-y' });
      // 椅子
      for (const dx of [-0.18, 0.18]) for (const dz of [0.35, 0.7]) g.box([cx + dx, 0.22, cz + dz], [0.03, 0.44, 0.03], 0x3a464d);
      // 一些同学的腿（没有五官，只到膝盖以上一点）
      if (rng.next() < 0.45) {
        for (const dx of [-0.1, 0.1]) {
          g.box([cx + dx, 0.24, cz + 0.55], [0.1, 0.46, 0.1], 0x2a3a52);
          g.box([cx + dx, 0.035, cz + 0.45], [0.1, 0.07, 0.24], 0x2b3034);
        }
      }
    }
  }
  // 前景：自己那双鞋（鞋底浅色，朝向镜头）
  for (const dx of [0.22, 0.42]) {
    g.box([dx, 0.05, 0.55], [0.1, 0.08, 0.26], 0x2b3034, { colors: { '+z': 0xcfd4d6 } });
    g.box([dx, 0.2, 0.3], [0.11, 0.3, 0.11], 0x2a3a52);
  }
  const geo = g.build();
  ctx.mat.ensureChalkAttr(geo);
  const mat = ctx.mat.lambert({ vertexColors: true, flat: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'placeholderSet';
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

export const placeholderSet: StillSet = {
  id: 'placeholder', owner: 'CORE', variants: ['default'],
  build: (ctx) => buildRoom(ctx),
  playerAnchor: () => new THREE.Matrix4(),
};

registerSet(placeholderSet);
