// src/render/sets/school/common.ts —— 校园静场 set 的公共构件（DESIGN.md §5.9、§8.4 StillSet，WP3）。不注册任何东西。
// 坐标相对 STILL_ORIGIN（core/constants.ts）：主角在原点附近，面朝 −z；镜头机位见 WP5 的 camera/shots.ts。
// 每个 set ≤ 12 次 draw call：一个 static（Lambert 顶点色）、一个 emissive（窗、灯），外加少数几个会动的部件。
import * as THREE from 'three';
import type { ViewContext } from '../../../core/contracts';
import { createRng } from '../../../core/rng';
import { KitGeo, type Col } from '../../geom';
import { emissiveAlbedo, propTone, wallAlbedo } from '../../wallTone';
import type { Env } from '../../kits/school/shell';
import { PAL } from '../../palette';
import type { AtmosphereId } from '../../../core/types';

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

/**
 * 静场的道具 / 人物颜色补偿（wallTone.ts propTone）：按这个 set 自己的氛围、静场的亮度场整张取 1。
 * 暗色（裤子、鞋、实验台、黑板、裙子）在画面上落回 §5.1 的色板值，不再是饱和的深蓝。
 */
export function setPropTone(atmo: AtmosphereId): ((hex: number) => Col) | null {
  return propTone({ atmo, lamp: 1 });
}

/** 发光体的累积器：暗色按 toe 的逆写入（wallTone.ts emissiveAlbedo），亮色（窗光）不动。 */
export function emiGeo(): KitGeo {
  const g = new KitGeo();
  g.tone = emissiveAlbedo;
  return g;
}

/** 新累积器，十六进制颜色走 setPropTone(atmo)。 */
export function propGeo(atmo: AtmosphereId): KitGeo {
  const g = new KitGeo();
  g.tone = setPropTone(atmo);
  return g;
}

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

/** 贴图地面（水磨石 / 瓷砖）：单独一个网格（1 次 draw call），uv 以米为单位（tex 米一个周期）。 */
export function texturedFloor(ctx: ViewContext, x0: number, x1: number, z0: number, z1: number, id: string, params: Readonly<Record<string, string | number>>, tex = 1, color = 0xf2f4f4): THREE.Mesh {
  const g = new KitGeo();
  g.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], color,
    [[x0 / tex, -z1 / tex], [x1 / tex, -z1 / tex], [x1 / tex, -z0 / tex], [x0 / tex, -z0 / tex]], [0.9, 0.9, 1, 1]);
  const geom = g.build();
  ctx.mat.ensureChalkAttr(geom);
  const m = new THREE.Mesh(geom, ctx.mat.lambert({ vertexColors: true, map: ctx.tex.get(id, { ...params, repeat: 1 }), flat: true }));
  m.name = 'floor';
  return m;
}

/** 一块地板（xz 矩形，顶点色带边缘变暗）。 */
export function floorRect(g: KitGeo, x0: number, x1: number, z0: number, z1: number, color: number, y = 0): void {
  g.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color, null, [0.85, 0.85, 1, 1]);
}

/**
 * 墙面色带 y0..y1 的受光补偿（wallTone.ts）：set 的墙没有贴图、静场的亮度场整张取 1，
 * 每条色带自带 0.75 → 1 的明暗（取平均 0.875）。
 */
export function setWallTone(color: number, y0: number, y1: number, atmo: AtmosphereId = 'morning'): Col {
  return wallAlbedo(color, Math.min(2.1, (y0 + y1) / 2), { shade: 0.875, tex: 1, lamp: 1, atmo });
}

/** 墙：x = const 的竖直面（side −1 朝 +x，+1 朝 −x）或 z = const（朝 +z）。 */
export function wallX(g: KitGeo, x: number, side: -1 | 1, z0: number, z1: number, y0: number, y1: number, color: Col): void {
  const sh: [number, number, number, number] = [0.75, 0.75, 1, 1];
  if (side < 0) g.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], color, null, sh);
  else g.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color, null, sh);
}
export function wallZ(g: KitGeo, z: number, x0: number, x1: number, y0: number, y1: number, color: Col): void {
  g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], color, null, [0.75, 0.75, 1, 1]);
}

/** 墙裙式的墙（x = const）：踢脚、墙裙、上沿、墙面。 */
export function schoolWallX(g: KitGeo, x: number, side: -1 | 1, z0: number, z1: number, h: number, wall: number = PAL.wall, wainscot: number = PAL.wainscot,
  atmo: AtmosphereId = 'morning'): void {
  wallX(g, x, side, z0, z1, 0, 0.1, setWallTone(0x3a464d, 0, 0.1, atmo));
  wallX(g, x, side, z0, z1, 0.1, 1.1, setWallTone(wainscot, 0.1, 1.1, atmo));
  wallX(g, x, side, z0, z1, 1.1, 1.15, setWallTone(PAL.wainscotTop, 1.1, 1.15, atmo));
  wallX(g, x, side, z0, z1, 1.15, h, setWallTone(wall, 1.15, h, atmo));
}
export function schoolWallZ(g: KitGeo, z: number, x0: number, x1: number, h: number, wall: number = PAL.wall, wainscot: number = PAL.wainscot,
  atmo: AtmosphereId = 'morning'): void {
  wallZ(g, z, x0, x1, 0, 0.1, setWallTone(0x3a464d, 0, 0.1, atmo));
  wallZ(g, z, x0, x1, 0.1, 1.1, setWallTone(wainscot, 0.1, 1.1, atmo));
  wallZ(g, z, x0, x1, 1.1, 1.15, setWallTone(PAL.wainscotTop, 1.1, 1.15, atmo));
  wallZ(g, z, x0, x1, 1.15, h, setWallTone(wall, 1.15, h, atmo));
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
