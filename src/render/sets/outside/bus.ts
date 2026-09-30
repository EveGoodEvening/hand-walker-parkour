// src/render/sets/outside/bus.ts —— 3-5 公交车（DESIGN.md §4.3、§5.8、§5.9；氛围 busNight）。
// 「车厢里空无一人，只有最后一排靠窗的位置亮着一盏阅读灯。」「雨刷在挡风玻璃上来回摆动，把路灯切成一段一段的光。」
// 「我旁边的玻璃上贴着一张广告，边角被水泡得翘起。」—— 车窗是开口（§5.8）：玻璃后面是镜中车厢（按车窗平面把车厢镜像一遍，
// 调暗），替身（WP5）坐在镜中的座位上；窗外的路灯一段一段地从前往后滑过。阅读灯是冷白色（第三章的暖色只给路灯、烟头、栏杆）。
// 坐标相对 STILL_ORIGIN：车头朝 −z，左窗在 x = −1.22。主角坐在最后一排左侧靠窗的位置（playerAnchor）。
// draw call：车厢 1、座椅面料 1、发光 1、光晕 1、玻璃 1、广告 1、窗外滑过的光 1、雨刷 2 = 9（≤ 12）。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { C, mix, shade } from '../../kits/outside/lib/colors';
import { OGeo, TexGeo, bakeLights, keyRng, mirrorLights, reflectX, type BakeLight } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, glowDisc } from './lib/setkit';

export const BUS_WALL_X = -1.22;
const W = 1.22, H = 2.2, Z_BACK = 1.5, Z_FRONT = -9.4;
const WIN_Y0 = 0.95, WIN_Y1 = 1.85;
/** 车窗分格（z）：从车尾到车头。 */
const PANES: ReadonlyArray<readonly [number, number]> = [[1.3, 0.45], [0.35, -1.55], [-1.65, -3.55], [-3.65, -5.55], [-5.65, -7.55]];
const ROWS = [0, -0.85, -1.7, -2.55, -3.4, -4.25, -5.1, -5.95, -6.8];
/** 车窗开口（主角旁边那一格）：[z0, y0, z1, y1]。 */
export const BUS_WINDOW_RECT: readonly [number, number, number, number] = [-1.55, WIN_Y0, 0.35, WIN_Y1];

function seat(g: OGeo, x: number, z: number, frame: number): void {
  g.box([x, 0.24, z], [0.05, 0.48, 0.05], frame);
  g.box([x, 0.46, z + 0.02], [0.44, 0.05, 0.42], shade(frame, 0.9), { faces: '-y+x-x+z-z' });
  g.box([x, 1.02, z + 0.25], [0.44, 0.04, 0.1], shade(frame, 1.15));        // 椅背上的扶手
}

/** 车厢本体（真实的一半与镜中的一半共用）。tint < 1 调暗（玻璃里的倒影）。 */
function cabin(g: OGeo, tint: number, mirrored: boolean): void {
  const k = (hex: number) => shade(hex, tint);
  const floor = 0x262d32, panel = 0x4a5760, roof = 0x353f46, frame = 0x5b6468;
  g.flat(0, -W, W, Z_BACK, Z_FRONT, k(floor), true);
  for (let z = Z_BACK - 0.4; z > Z_FRONT; z -= 0.4) g.flat(0.002, -0.35, 0.35, z, z - 0.03, k(0x1d2327), true);
  g.flat(H, -W, W, Z_BACK, Z_FRONT, k(roof), false);
  g.box([0, H - 0.02, (Z_BACK + Z_FRONT) / 2], [0.3, 0.04, Z_BACK - Z_FRONT - 0.4], k(0x2a3237), { faces: '-y' });   // 车顶灯带（关着）
  // 两侧墙：窗下的板、窗上的板、窗框
  for (const side of [-1, 1] as const) {
    const x = side * W, f = (-side) as 1 | -1;
    g.wallX(x, Z_BACK, Z_FRONT, 0, WIN_Y0, k(panel), f);
    g.wallX(x, Z_BACK, Z_FRONT, WIN_Y1, H, k(shade(panel, 0.85)), f);
    for (const [za, zb] of PANES) {
      g.box([x - side * 0.03, (WIN_Y0 + WIN_Y1) / 2, za + 0.05], [0.06, WIN_Y1 - WIN_Y0, 0.1], k(frame));
      g.box([x - side * 0.03, (WIN_Y0 + WIN_Y1) / 2, zb - 0.05], [0.06, WIN_Y1 - WIN_Y0, 0.1], k(frame));
    }
    // 窗之间的墙（车窗只在 PANES 里）
    let z = Z_BACK;
    for (const [za, zb] of PANES) { if (z > za + 1e-3) g.wallX(x, z, za, WIN_Y0, WIN_Y1, k(panel), f); z = zb; }
    if (z > Z_FRONT) g.wallX(x, z, Z_FRONT, WIN_Y0, WIN_Y1, k(panel), f);
    // 窗外：右侧（非开口）是夜色；左侧是开口，外面交给镜中车厢
    if (side > 0 || mirrored) for (const [za, zb] of PANES) g.wallX(x + side * 0.02, za, zb, WIN_Y0, WIN_Y1, k(0x0a0f12), f);
    // 扶杆
    g.box([side * 0.62, H - 0.12, (Z_BACK + Z_FRONT) / 2], [0.035, 0.035, Z_BACK - Z_FRONT - 0.6], k(0x9ba5a9));
  }
  // 车尾墙（后窗是暗的）、车头的挡风玻璃框
  g.wallZ(Z_BACK, -W, W, 0, H, k(panel), -1);
  g.wallZ(Z_BACK - 0.01, -0.9, 0.9, 1.1, 1.9, k(0x0a0f12), -1);
  g.wallZ(Z_FRONT, -W, W, 0, 0.95, k(0x1d2327), 1);
  g.wallZ(Z_FRONT, -W, W, 1.95, H, k(roof), 1);
  // 座椅：两侧各一排；最后一排是横排长椅
  for (const z of ROWS) {
    if (z === 0) continue;
    for (const x of [-0.85, -0.4, 0.4, 0.85]) seat(g, x, z, k(frame));
  }
  g.box([0, 0.3, 1.05], [2.3, 0.6, 0.6], k(0x2c343a));
  g.box([0, 0.6, 1.05], [2.3, 0.06, 0.55], k(frame), { faces: '+y' });
  for (const x of [-0.85, -0.4]) seat(g, x, 0, k(frame));
  // 投币箱、前门台阶（远处）
  g.box([-0.8, 0.55, -8.6], [0.3, 1.1, 0.3], k(0x5b6468));
  g.box([0.8, 0.12, -8.8], [0.8, 0.24, 1.0], k(0x2a3237));
}

/** 座椅面料（busInterior 纹理）：坐垫与靠背。 */
function fabric(tg: TexGeo, tint: number): void {
  const col = shade(0xffffff, tint);
  const cushion = (x: number, z: number) => {
    const y = 0.49, x0 = x - 0.21, x1 = x + 0.21, z0 = z + 0.22, z1 = z - 0.18;
    tg.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 0], [1, 0], [1, 1], [0, 1], col);
    const bz = z + 0.23, b0 = 0.5, b1 = 1.0;
    tg.quad([x0, b0, bz - 0.05], [x1, b0, bz - 0.05], [x1, b1, bz], [x0, b1, bz], [0, 0], [1, 0], [1, 1.2], [0, 1.2], col);
    tg.quad([x1, b0, bz + 0.03], [x0, b0, bz + 0.03], [x0, b1, bz + 0.07], [x1, b1, bz + 0.07], [0, 0], [1, 0], [1, 1.2], [0, 1.2], shade(col, 0.8));
  };
  for (const z of ROWS) for (const x of z === 0 ? [-0.85, -0.4] : [-0.85, -0.4, 0.4, 0.85]) cushion(x, z);
}

interface BusAnim { lights: THREE.Mesh; wipers: THREE.Mesh[]; glowMat: THREE.MeshBasicMaterial }

/** 烘焙光源：最后一排的阅读灯（冷白）、挡风玻璃外的夜色、右侧车窗透进来的街上的微光。 */
export const BUS_LIGHTS: readonly BakeLight[] = [
  { p: [-0.95, 1.95, 0.05], color: 0xdce6ec, intensity: 1.8, radius: 3.0 },
  { p: [0, 1.5, Z_FRONT + 0.5], color: 0x5d6b73, intensity: 0.8, radius: 3.4 },
  { p: [1.25, 1.4, -3.2], color: 0x2a3440, intensity: 0.7, radius: 4.2 },
];
const BUS_AMBIENT = 0x12181c;

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.bus.${variant}`);
  const g = new OGeo();
  g.cell = ctx.quality.tier === 'low' ? 0.5 : 0.3;
  cabin(g, 1, false);
  const n1 = g.vertexCount;
  bakeLights(g, BUS_LIGHTS, BUS_AMBIENT, 0, n1);
  // 镜中车厢：按左窗平面镜像、调暗（夜里车窗上的倒影），替身就坐在镜中那一排；灯也镜像过去再烘一遍
  const R = reflectX(BUS_WALL_X);
  g.mirrored(R, () => cabin(g, 0.62, true));
  bakeLights(g, mirrorLights(BUS_LIGHTS, R), BUS_AMBIENT, n1, g.vertexCount);
  b.baked(g, 'cabin');
  // 面料
  const tg = new TexGeo();
  fabric(tg, 1);
  bakeLights(tg, BUS_LIGHTS, BUS_AMBIENT);
  b.texturedBasic(tg, 'busInterior', {}, 'fabric', true);
  // 发光：阅读灯（冷白）、前面挡风玻璃外的夜色与路灯
  const e = new OGeo();
  e.box([-0.95, H - 0.18, 0.05], [0.18, 0.05, 0.14], 0xdce6ec, { faces: '-y+x' });
  e.wallZ(Z_FRONT + 0.01, -W + 0.1, W - 0.1, 0.95, 1.95, 0x0c1216, 1);
  e.wallZ(Z_FRONT + 0.015, 0.3, 0.55, 1.6, 1.64, C.lampGold, 1);
  e.wallZ(Z_FRONT + 0.015, -0.7, -0.52, 1.52, 1.55, mix(C.lampGold, 0x0c1216, 0.4), 1);
  b.emissive(e);
  // 光晕：阅读灯的灯罩周围一小圈
  const gl = new OGeo();
  glowDisc(gl, [-0.95, H - 0.21, 0.05], 0.3, 0x5d6b73, 12, [0, -1, 0]);
  const glowMesh = b.glow(gl, 'readingLight');
  // 玻璃：左侧车窗（开口）上一层很淡的深色 + 雨丝（竖向的细条）
  const gg = new OGeo();
  const rng = keyRng('bus', 'rain');
  for (const [za, zb] of PANES) {
    gg.wallX(BUS_WALL_X + 0.005, za, zb, WIN_Y0, WIN_Y1, 0x1a2a33, 1);
    for (let i = 0; i < 12; i++) {
      const z = za - rng.next() * (za - zb), y = WIN_Y0 + 0.05 + rng.next() * 0.7, l = 0.04 + rng.next() * 0.14;
      gg.wallX(BUS_WALL_X + 0.008, z + 0.003, z - 0.003, y, y + l, 0x55666f, 1);
    }
  }
  b.glass(gg, 0.3, 'glass');
  // 广告：贴在主角旁边那格玻璃的前下角，右下角翘起
  const ad = new TexGeo();
  const az0 = -0.66, az1 = -1.21, ay0 = WIN_Y0 + 0.04, ay1 = ay0 + 0.75, ax = BUS_WALL_X + 0.012;
  const uvAt = (z: number, y: number): [number, number] => [(az0 - z) / (az0 - az1), (y - ay0) / (ay1 - ay0)];
  const cz = az1 + 0.13, cy = ay0 + 0.13;                               // 翘起的角：从 (cz, ay0) 到 (az1, cy) 折出去
  const P = (z: number, y: number): [number, number, number] => [ax, y, z];
  ad.quad(P(az0, cy), P(az1, cy), P(az1, ay1), P(az0, ay1), uvAt(az0, cy), uvAt(az1, cy), uvAt(az1, ay1), uvAt(az0, ay1));
  ad.quad(P(az0, ay0), P(cz, ay0), P(cz, cy), P(az0, cy), uvAt(az0, ay0), uvAt(cz, ay0), uvAt(cz, cy), uvAt(az0, cy));
  ad.tri(P(cz, ay0), P(az1, cy), P(cz, cy), uvAt(cz, ay0), uvAt(az1, cy), uvAt(cz, cy));
  // 折出来的角（纸背，浅灰），离开玻璃 4 cm
  ad.tri([ax, ay0, cz], [ax + 0.04, ay0 + 0.1, az1 + 0.02], [ax, cy, az1], [0.99, 0.01], [0.99, 0.01], [0.99, 0.01], 0xc9d0d4);
  ad.tri([ax, ay0, cz], [ax, cy, az1], [ax + 0.04, ay0 + 0.1, az1 + 0.02], [0.99, 0.01], [0.99, 0.01], [0.99, 0.01], 0xc9d0d4);
  bakeLights(ad, BUS_LIGHTS, BUS_AMBIENT);
  b.texturedBasic(ad, 'adRunner', {}, 'ad');
  // 窗外滑过的路灯光：几道竖直的光带，从车头往车尾移动（update 里平移，循环）
  const lg = new OGeo();
  for (let i = 0; i < 4; i++) {
    const z = -i * 3.1;
    for (const x of [BUS_WALL_X - 0.02, -BUS_WALL_X + 0.02]) {
      const f = (x < 0 ? 1 : -1) as 1 | -1;
      const col = mix(0x1a1f22, C.lampGold, 0.55), dark = 0x000000;
      const y0 = WIN_Y0, y1 = WIN_Y1, w2 = 0.35;
      lg.gtri([x, y0, z], [x, y1, z], [x, y0, z - w2 * f], col, col, dark);
      lg.gtri([x, y1, z], [x, y1, z - w2 * f], [x, y0, z - w2 * f], col, dark, dark);
      lg.gtri([x, y0, z + w2 * f], [x, y1, z + w2 * f], [x, y0, z], dark, dark, col);
      lg.gtri([x, y1, z + w2 * f], [x, y1, z], [x, y0, z], dark, col, col);
    }
  }
  const lights = b.glow(lg, 'passingLights', 0.8);
  lights.matrixAutoUpdate = true;
  // 雨刷：挡风玻璃上两根，绕下方的支点摆动
  const wipers: THREE.Mesh[] = [];
  for (const px of [-0.55, 0.45]) {
    const wg = new OGeo();
    wg.box([0, 0.42, 0], [0.025, 0.84, 0.02], 0x0d1216);
    wg.box([0, 0.02, 0], [0.06, 0.06, 0.03], 0x2a3237);
    const m = b.lambert(wg, 'wiper');
    m.position.set(px, 1.0, Z_FRONT + 0.05);
    m.matrixAutoUpdate = true;
    wipers.push(m);
  }
  const anim: BusAnim = { lights, wipers, glowMat: glowMesh.material as THREE.MeshBasicMaterial };
  liveList('bus').add({ variant, root: b.root, update: (t, snap) => animate(anim, t, snap) });
  animate(anim, 0, null);
  return b.root;
}

function animate(a: BusAnim, t: number, _snap: SimSnapshot | null): void {
  // 路灯每 3.1 m 一盏，车速约 8 m/s：光带从车头滑到车尾
  const period = 3.1, speed = 8;
  a.lights.position.z = ((t * speed) % period) + 1.2;
  // 雨刷：周期 1.4 s（与 WP7 的雨刷声一致），±35°
  const ph = Math.sin((t / 1.4) * Math.PI * 2);
  for (const w of a.wipers) w.rotation.z = -0.6 + ph * 0.6;
  // 阅读灯很稳（不闪）
  a.glowMat.opacity = 1;
}

export const busSet: StillSet = {
  id: 'bus', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(-0.62, 0, 0),
  surfaces: () => {
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -BUS_WALL_X);
    const rect = [...BUS_WINDOW_RECT] as [number, number, number, number];
    return ['busWindow', 'window', 'busGlass'].map((id) => ({ id, plane: plane.clone(), rect }));
  },
  update: (t, snap) => liveList('bus').update(snap.still?.t ?? t, snap),
};

registerSet(busSet);
