// src/render/sets/outside/bathroom.ts —— 3-10 家里的卫生间（DESIGN.md §4.3、§5.8；氛围 homeDark）。
// 「很大的镜子，从洗手台上方一直延伸到天花板。」「镜子里没有人。只有我背后的卫生间门，和门旁边墙上挂着的一条毛巾。毛巾在滴水」
// 镜子是开口（§5.8）：镜面后面按镜面把整个卫生间再建一遍（镜中房间），所以「镜子里只有门和毛巾」天然成立；替身（WP5）
// 站在镜中房间里。泼水之后镜面蒙一层水汽，擦掉后变清（update 按静场时间走）。没开灯：门缝下一线冷光、高处一扇磨砂小窗。
// 坐标相对 STILL_ORIGIN：镜面在 z = −0.62（朝 +z），门在身后 z = 1.9。draw call：房间 1、发光 1、水汽 1、水滴 1 = 4。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import { shade } from '../../kits/outside/lib/colors';
import { OGeo, bakeLights, mirrorLights, reflectZ, type BakeLight } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, glowDisc, tileLinesX, tileLinesZ } from './lib/setkit';

export const MIRROR_Z = -0.62;
const X0 = -1.15, X1 = 1.15, ZD = 1.9, H = 2.5;
/** 镜子开口：[x0, y0, x1, y1]（从洗手台上方一直到天花板）。 */
export const BATH_MIRROR_RECT: readonly [number, number, number, number] = [-0.72, 1.02, 0.72, H];
const TOWEL = { x: -0.72, y: 1.55, z: ZD - 0.03 };
/** 烘焙光源（没开灯）：门缝下一线冷光、右墙高处的磨砂小窗、洗手台上方的一点反光。 */
export const BATH_LIGHTS: readonly BakeLight[] = [
  { p: [0.2, 0.05, ZD - 0.1], color: 0x6f8594, intensity: 1.0, radius: 1.9 },
  { p: [X1 - 0.1, 2.2, 1.05], color: 0x8a9aa4, intensity: 1.3, radius: 3.2 },
  { p: [0, 1.6, 0.3], color: 0x2c3a44, intensity: 0.8, radius: 2.4 },
];
const BATH_AMBIENT = 0x161d22;

/** 卫生间本体（除了镜子那面墙；真实与镜中共用）。 */
function room(g: OGeo, tint: number): void {
  const k = (h: number) => shade(h, tint);
  const tile = k(0xb9c1c3), grout = k(0x7a8486), floor = k(0x8a9395);
  g.flat(0, X0, X1, ZD, MIRROR_Z, floor, true);
  for (let x = X0 + 0.3; x < X1; x += 0.3) g.flat(0.001, x - 0.005, x + 0.005, ZD, MIRROR_Z, grout, true);
  for (let z = MIRROR_Z + 0.3; z < ZD; z += 0.3) g.flat(0.001, X0, X1, z + 0.005, z - 0.005, grout, true);
  g.flat(H, X0, X1, ZD, MIRROR_Z, k(0x6d7577), false);
  // 左右墙、门那面墙
  g.wallX(X0, MIRROR_Z, ZD, 0, H, tile, 1);
  g.wallX(X1, MIRROR_Z, ZD, 0, H, shade(tile, 0.95), -1);
  tileLinesX(g, X0, MIRROR_Z, ZD, 0, H, 0.3, grout, 1);
  tileLinesX(g, X1, MIRROR_Z, ZD, 0, H, 0.3, grout, -1);
  g.wallZ(ZD, X0, X1, 0, H, shade(tile, 0.9), -1);
  tileLinesZ(g, ZD, X0, X1, 0, H, 0.3, grout, -1);
  // 门（身后）：门框 + 门板 + 门把
  g.box([0.2, 1.02, ZD - 0.03], [0.82, 2.04, 0.04], k(0x3a4349), { faces: '-z' });
  g.box([0.2, 2.08, ZD - 0.04], [0.94, 0.08, 0.06], k(0x4a545a), { faces: '-z-y' });
  for (const x of [-0.24, 0.64]) g.box([x, 1.04, ZD - 0.04], [0.06, 2.08, 0.06], k(0x4a545a), { faces: '-z+x-x' });
  g.box([-0.08, 1.0, ZD - 0.07], [0.1, 0.03, 0.04], k(0x7d878b));
  // 毛巾架 + 毛巾（门旁边的墙上）
  g.box([TOWEL.x, TOWEL.y + 0.3, ZD - 0.05], [0.5, 0.03, 0.03], k(0x9ba5a9));
  g.box([TOWEL.x, TOWEL.y, ZD - 0.06], [0.36, 0.6, 0.03], k(0x6f7c86));
  g.box([TOWEL.x, TOWEL.y - 0.32, ZD - 0.07], [0.36, 0.06, 0.02], k(0x5d6973));
  // 洗手台（贴着镜子那面墙）：台面、盆、龙头、柜
  g.box([0, 0.83, MIRROR_Z + 0.27], [1.3, 0.06, 0.54], k(0xb9c0c1));
  g.box([0, 0.42, MIRROR_Z + 0.25], [1.2, 0.8, 0.5], k(0x7f898d), { faces: '+z+x-x' });
  g.box([0, 0.84, MIRROR_Z + 0.3], [0.5, 0.02, 0.34], k(0x4d5659), { faces: '+y' });
  g.box([0, 0.95, MIRROR_Z + 0.06], [0.05, 0.18, 0.05], k(0x9ba5a9));
  g.box([0, 1.02, MIRROR_Z + 0.13], [0.04, 0.04, 0.16], k(0x9ba5a9));
  // 地漏、马桶（右侧一角）
  g.box([0.8, 0.2, 0.7], [0.4, 0.4, 0.55], k(0x9aa3a4));
  g.box([0.8, 0.42, 0.72], [0.42, 0.04, 0.58], k(0xb0b8ba));
  g.box([0.8, 0.62, 1.02], [0.44, 0.4, 0.18], k(0x9aa3a4));
}

/** 镜子那面墙：留出镜面的洞。 */
function mirrorWall(g: OGeo): void {
  const [x0, y0, x1] = BATH_MIRROR_RECT;
  const tile = 0xb9c1c3;
  g.wallZ(MIRROR_Z, X0, x0, 0, H, tile, 1);
  g.wallZ(MIRROR_Z, x1, X1, 0, H, tile, 1);
  g.wallZ(MIRROR_Z, x0, x1, 0, y0, tile, 1);
  // 镜子的下沿（一条细细的不锈钢边）
  g.box([0, y0 - 0.01, MIRROR_Z + 0.01], [x1 - x0, 0.02, 0.02], 0x9ba5a9);
}

interface BathAnim { vapor: THREE.MeshBasicMaterial; drops: THREE.Mesh; dropBase: Float32Array }

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.bathroom.${variant}`);
  const g = new OGeo();
  g.cell = ctx.quality.tier === 'low' ? 0.4 : 0.25;
  room(g, 1);
  mirrorWall(g);
  const n1 = g.vertexCount;
  bakeLights(g, BATH_LIGHTS, BATH_AMBIENT, 0, n1);
  // 镜中房间：整个卫生间按镜面反射一遍（稍暗），门和毛巾都在里面；灯也按镜面反射过去再烘一遍
  const R = reflectZ(MIRROR_Z);
  g.mirrored(R, () => room(g, 0.85));
  bakeLights(g, mirrorLights(BATH_LIGHTS, R), BATH_AMBIENT, n1, g.vertexCount);
  b.baked(g, 'room');
  // 发光：门缝下一线冷光、高处的磨砂小窗（真实与镜中各一份）
  const e = new OGeo();
  const light = (gg: OGeo) => {
    gg.wallZ(ZD - 0.075, -0.2, 0.6, 0.0, 0.012, 0x6f8594, -1);
    gg.wallX(X1 - 0.01, 1.3, 0.8, 2.05, 2.35, 0x43525c, -1);
  };
  light(e);
  e.mirrored(reflectZ(MIRROR_Z), () => light(e));
  b.emissive(e);
  const gl = new OGeo();
  glowDisc(gl, [0.2, 0.004, ZD - 0.3], 0.7, 0x1b252c, 16, [0, 1, 0], 0.5);
  glowDisc(gl, [0.2, 0.004, 2 * MIRROR_Z - (ZD - 0.3)], 0.7, 0x111820, 16, [0, 1, 0], 0.5);
  b.glow(gl, 'doorLight');
  // 水汽：蒙在镜面上
  const v = new OGeo();
  const [x0, y0, x1, y1] = BATH_MIRROR_RECT;
  v.wallZ(MIRROR_Z + 0.006, x0, x1, y0, y1, 0x6d7a82, 1);
  const vapor = b.glass(v, 0, 'vapor');
  // 水滴：毛巾下沿和龙头各一串，循环下落
  const d = new OGeo();
  const drop = (x: number, y: number, z: number) => d.box([x, y, z], [0.012, 0.03, 0.012], 0x8fa4b0);
  for (let i = 0; i < 3; i++) { drop(TOWEL.x - 0.1 + i * 0.1, TOWEL.y - 0.36, ZD - 0.07); drop(TOWEL.x - 0.1 + i * 0.1, TOWEL.y - 0.36, 2 * MIRROR_Z - (ZD - 0.07)); }
  drop(0, 0.98, MIRROR_Z + 0.2);
  const drops = b.emissive(d, 'drops');
  drops.frustumCulled = false;
  const pos = drops.geometry.getAttribute('position') as THREE.BufferAttribute;
  const anim: BathAnim = { vapor: vapor.material as THREE.MeshBasicMaterial, drops, dropBase: new Float32Array(pos.array as Float32Array) };
  liveList('bathroom').add({ variant, root: b.root, update: (t) => animate(anim, t) });
  animate(anim, 0);
  return b.root;
}

/** 泼水后镜面起雾（约 1.2–2.2 s），擦镜子时擦掉（约 3.0–3.8 s），之后清楚（§4.3 3-10 时间线：4.0 s「镜子里没有人。」）。 */
export function vaporAt(t: number): number {
  if (t < 1.2) return 0;
  if (t < 2.2) return 0.32 * (t - 1.2);
  if (t < 3.0) return 0.32;
  if (t < 3.8) return 0.32 * (1 - (t - 3.0) / 0.8);
  return 0;
}

function animate(a: BathAnim, t: number): void {
  a.vapor.opacity = vaporAt(t);
  // 每一滴按自己的相位从起点落下 0.35 m，循环（毛巾：一声一声，像有人在用手指敲玻璃）
  const p = a.drops.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = p.array as Float32Array;
  const per = 36;                                // 每个 box 36 个顶点
  const n = arr.length / 3 / per;
  for (let i = 0; i < n; i++) {
    const ph = ((t * 0.9 + i * 0.37) % 1);
    const dy = -0.35 * ph * ph;
    for (let v = 0; v < per; v++) {
      const k = (i * per + v) * 3 + 1;
      arr[k] = (a.dropBase[k] as number) + dy;
    }
  }
  p.needsUpdate = true;
}

export const bathroomSet: StillSet = {
  id: 'bathroom', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.25),
  surfaces: () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -MIRROR_Z);
    const rect = [...BATH_MIRROR_RECT] as [number, number, number, number];
    return ['bathMirror', 'mirror', 'bathroomMirror'].map((id) => ({ id, plane: plane.clone(), rect }));
  },
  update: (t, snap) => liveList('bathroom').update(snap.still?.t ?? t, snap),
};

registerSet(bathroomSet);
