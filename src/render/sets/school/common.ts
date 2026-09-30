// src/render/sets/school/common.ts —— 校园静场 set 的公共构件（DESIGN.md §5.9、§8.4 StillSet，WP3）。不注册任何东西。
// 坐标相对 STILL_ORIGIN（core/constants.ts）：主角在原点附近，面朝 −z；镜头机位见 WP5 的 camera/shots.ts。
// 每个 set ≤ 12 次 draw call：一个 static（Lambert 顶点色）、一个 emissive（窗、灯），外加少数几个会动的部件。
import * as THREE from 'three';
import type { ViewContext } from '../../../core/contracts';
import { createRng } from '../../../core/rng';
import { KitGeo } from '../../geom';
import type { Env } from '../../kits/school/shell';
import { PAL } from '../../palette';

/** 给家具构件（desk / chair / bench / table）用的「伪 chunk 环境」：z = −s，没有段信息。 */
export function setEnv(ctx: ViewContext, salt: string): Env {
  const low = ctx.quality.tier === 'low';
  return {
    ctx: null as never, hw: undefined, s0: -50, s1: 50, L: 100, stride: 1, segS0: -50, segS1: 50,
    tier: ctx.quality.tier, low, high: ctx.quality.tier === 'high', rng: createRng(0x5e7, salt),
    generic: false, head: false, tail: false, back: 0, period: 3, surfaces: [], openings: [],
    z: (s) => -s, fy: () => 0,
  };
}

export function geo(): KitGeo { return new KitGeo(); }

/** 把累积器变成网格（Lambert 顶点色，LampField 补丁由 ctx.mat 负责）。 */
export function lambertMesh(ctx: ViewContext, g: KitGeo, name: string): THREE.Mesh {
  const geom = g.build({ uv: false });
  ctx.mat.ensureChalkAttr(geom);
  const m = new THREE.Mesh(geom, ctx.mat.lambert({ vertexColors: true, flat: true }));
  m.name = name;
  return m;
}

/** 发光网格（窗、灯）：Basic 顶点色；aSteady = 1 的部分不跟灯走。 */
export function emissiveMesh(ctx: ViewContext, g: KitGeo, name: string): THREE.Mesh {
  const geom = g.build({ uv: false, steady: true });
  ctx.mat.ensureChalkAttr(geom);
  const mat = ctx.mat.basic({ color: 0xffffff, lampLit: true });
  mat.vertexColors = true;
  const m = new THREE.Mesh(geom, mat);
  m.name = name;
  return m;
}

/** 一块地板（xz 矩形，顶点色带边缘变暗）。 */
export function floorRect(g: KitGeo, x0: number, x1: number, z0: number, z1: number, color: number, y = 0): void {
  g.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color, null, [0.85, 0.85, 1, 1]);
}

/** 墙：x = const 的竖直面（side −1 朝 +x，+1 朝 −x）或 z = const（朝 +z）。 */
export function wallX(g: KitGeo, x: number, side: -1 | 1, z0: number, z1: number, y0: number, y1: number, color: number): void {
  const sh: [number, number, number, number] = [0.75, 0.75, 1, 1];
  if (side < 0) g.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], color, null, sh);
  else g.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color, null, sh);
}
export function wallZ(g: KitGeo, z: number, x0: number, x1: number, y0: number, y1: number, color: number): void {
  g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color, null, [0.75, 0.75, 1, 1]);
}

/** 墙裙式的墙（x = const）：踢脚、墙裙、上沿、墙面。 */
export function schoolWallX(g: KitGeo, x: number, side: -1 | 1, z0: number, z1: number, h: number, wall: number = PAL.wall, wainscot: number = PAL.wainscot): void {
  wallX(g, x, side, z0, z1, 0, 0.1, 0x3a464d);
  wallX(g, x, side, z0, z1, 0.1, 1.1, wainscot);
  wallX(g, x, side, z0, z1, 1.1, 1.15, PAL.wainscotTop);
  wallX(g, x, side, z0, z1, 1.15, h, wall);
}
export function schoolWallZ(g: KitGeo, z: number, x0: number, x1: number, h: number, wall: number = PAL.wall, wainscot: number = PAL.wainscot): void {
  wallZ(g, z, x0, x1, 0, 0.1, 0x3a464d);
  wallZ(g, z, x0, x1, 0.1, 1.1, wainscot);
  wallZ(g, z, x0, x1, 1.1, 1.15, PAL.wainscotTop);
  wallZ(g, z, x0, x1, 1.15, h, wall);
}

/**
 * 坐着的人的腿（没有五官，只到大腿）：小腿竖直、大腿水平向后，鞋尖朝 −z。rotY 转向。
 * pants / shoe 可换色（校服裤、运动鞋）。
 */
export function seatedLegs(g: KitGeo, x: number, z: number, rotY = 0, pants: number = PAL.trousers, shoe: number = PAL.shoeTop, spread = 0.1): void {
  g.withMatrix(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z), () => {
    for (const dx of [-spread, spread]) {
      g.box([dx, 0.23, -0.1], [0.11, 0.42, 0.11], pants, { bottomShade: 0.8 });
      g.box([dx, 0.47, 0.12], [0.12, 0.12, 0.46], pants);
      g.box([dx, 0.045, -0.17], [0.1, 0.08, 0.26], shoe, { colors: { '+z': PAL.shoeSole } });
    }
  });
}

/** 站着的腿（到腰带）：双腿、腰带、鞋。 */
export function standingLegs(g: KitGeo, x: number, z: number, rotY = 0, pants: number = PAL.trousers, shoe: number = PAL.shoeTop): void {
  g.withMatrix(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z), () => {
    for (const dx of [-0.1, 0.1]) {
      g.box([dx, 0.53, 0], [0.12, 0.92, 0.13], pants, { bottomShade: 0.8 });
      g.box([dx, 0.045, -0.05], [0.11, 0.08, 0.27], shoe, { colors: { '+z': PAL.shoeSole } });
    }
    g.box([0, 1.0, 0], [0.36, 0.1, 0.18], 0x1e2226);
  });
}
