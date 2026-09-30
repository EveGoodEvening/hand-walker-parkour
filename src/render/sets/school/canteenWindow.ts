// src/render/sets/school/canteenWindow.ts —— 静场「窗边」（DESIGN.md §4.2 2-5，WP3）。
// 「我习惯坐在靠窗的最角落……但今天它很干净。」低机位（WP5 的 windowSeat 机位 (0.2, 0.5, 1.2) → (−1.5, 0.8, −1)）对着窗玻璃。
// 窗是墙上的开口（§5.8）：玻璃面 x = −1.1，开口后面是镜中房间——一张镜像的桌子和椅子（替身就坐在那把椅子上），
// 再往后是窗外的操场（发光的渐变、篮球架与几个没有五官的剪影）。反光面 id：'canteenGlass'（surfaces()）。
// 陈默 7.0 s 端着餐盘坐下：只看得见他正常弯曲的腿（鞋尖朝前、膝盖并拢）。
// 餐盘里的菜用冷灰，不用暖色：红烧肉的暖色只在 2-3（附录 A-9）。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { clamp } from '../../../core/math';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { KitGeo } from '../../geom';
import { chair } from '../../kits/school/classroom';
import { PAL, SCHOOL } from '../../palette';
import { emissiveMesh, floorRect, lambertMesh, seatedLegs, setEnv, wallX } from './common';

export const GLASS_X = -1.1;
const GZ0 = -3.0, GZ1 = 1.6, GY0 = 0.75, GY1 = 2.8;
const ROOM_D = 4.2;

let chenMo: THREE.Mesh | null = null;

/** 一张方桌（桌面 + 四条腿），可以在镜中房间里再画一张镜像的。 */
function squareTable(g: KitGeo, x: number, z: number): void {
  g.box([x, 0.74, z], [0.8, 0.03, 0.8], SCHOOL.canteenTable, { faces: '+y-y+z-z+x-x' });
  for (const dx of [-0.36, 0.36]) for (const dz of [-0.36, 0.36]) g.box([x + dx, 0.37, z + dz], [0.035, 0.74, 0.035], PAL.deskLeg, { faces: '+x-x+z-z' });
}

function build(ctx: ViewContext): THREE.Object3D {
  const e = setEnv(ctx, 'canteenWindow');
  const root = new THREE.Group();
  const stat = new KitGeo(), emi = new KitGeo();
  // 这一侧：地面、窗墙（留洞）、窗台、暖气管、后面的桌子
  floorRect(stat, GLASS_X, 4, -6, 3, 0x9ba1a0);
  wallX(stat, GLASS_X, -1, -6, GZ0, 0, 3.6, 0xcbd1d0);
  wallX(stat, GLASS_X, -1, GZ1, 3, 0, 3.6, 0xcbd1d0);
  wallX(stat, GLASS_X, -1, GZ0, GZ1, 0, GY0, 0xe0e5e6);
  wallX(stat, GLASS_X, -1, GZ0, GZ1, GY1, 3.6, 0xcbd1d0);
  stat.box([GLASS_X + 0.1, GY0 - 0.02, (GZ0 + GZ1) / 2], [0.2, 0.04, GZ1 - GZ0], 0xb9c0c1, { faces: '+y+x' });
  stat.box([GLASS_X + 0.06, 0.25, (GZ0 + GZ1) / 2], [0.08, 0.08, GZ1 - GZ0 + 2], SCHOOL.pipe, { faces: '+x+y' });   // 暖气管
  for (const z of [GZ0 + 1.5, GZ0 + 3.0]) stat.box([GLASS_X - 0.02, (GY0 + GY1) / 2, z], [0.06, GY1 - GY0, 0.06], 0x9aa4a7, { faces: '+x+z-z' });
  // 自己的桌子与椅子（腿蜷在椅子下面的横档里）；对面陈默的椅子
  squareTable(stat, -0.45, -0.45);
  chair(stat, e, -0.45, -0.45, 0.05);
  stat.box([-0.45, 0.12, 0.02], [0.36, 0.02, 0.02], PAL.deskLeg, { faces: '+y+z' });   // 横档
  stat.withMatrix(new THREE.Matrix4().makeRotationY(Math.PI).setPosition(-0.9, 0, -0.9), () => chair(stat, e, -0.45, -0.45, 0));
  stat.box([-0.5, 0.765, -0.3], [0.36, 0.02, 0.26], PAL.steel, { faces: '+y+z+x-x' });              // 推开的餐盘
  stat.box([-0.55, 0.785, -0.3], [0.1, 0.02, 0.1], 0x7e878b, { faces: '+y' });
  for (const [x, z] of [[1.6, -1.2], [1.6, -3.6], [3.2, -2.4], [1.6, 1.4]] as const) {
    squareTable(stat, x, z);
    chair(stat, e, x, z, 0.1);
  }
  // 镜中房间：以玻璃为对称面的这一侧（地面、桌椅），再往后是操场
  const XB = GLASS_X - ROOM_D;
  floorRect(stat, XB, GLASS_X - 0.01, GZ0, GZ1, 0x6f7678);
  stat.quad([XB, 0, GZ0], [GLASS_X, 0, GZ0], [GLASS_X, GY1, GZ0], [XB, GY1, GZ0], 0x5e6567);     // 两端
  stat.quad([GLASS_X, 0, GZ1], [XB, 0, GZ1], [XB, GY1, GZ1], [GLASS_X, GY1, GZ1], 0x5e6567);
  const mx = (x: number) => 2 * GLASS_X - x;
  squareTable(stat, mx(-0.45), -0.45);
  stat.withMatrix(new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(2 * GLASS_X, 0, 0), () => chair(stat, e, -0.45, -0.45, 0.05));
  // 操场：发光的天与地，篮球架、围网、几个没有五官的剪影（远处，冷灰）
  emi.withSteady(1, () => {
    emi.quad([XB, 0, GZ1 + 2], [XB, 0, GZ0 - 2], [XB, 1.2, GZ0 - 2], [XB, 1.2, GZ1 + 2], 0x8f9a9c);
    emi.quad([XB, 1.2, GZ1 + 2], [XB, 1.2, GZ0 - 2], [XB, 3.6, GZ0 - 2], [XB, 3.6, GZ1 + 2], [PAL.windowBottom, PAL.windowBottom, PAL.windowTop, PAL.windowTop]);
    const xs = XB + 0.02;
    emi.quad([xs, 1.2, -0.2], [xs, 1.2, -0.26], [xs, 2.6, -0.26], [xs, 2.6, -0.2], 0x50606a);          // 篮球架的杆
    emi.quad([xs, 2.3, -0.05], [xs, 2.3, -0.6], [xs, 2.75, -0.6], [xs, 2.75, -0.05], 0x5a6a74);          // 篮板
    for (const [z, h] of [[-1.4, 0.55], [-1.9, 0.5], [0.6, 0.52], [-2.5, 0.46]] as const) {
      emi.quad([xs, 1.2, z + 0.05], [xs, 1.2, z - 0.05], [xs, 1.2 + h, z - 0.05], [xs, 1.2 + h, z + 0.05], 0x5f6f7a);
      emi.quad([xs, 1.2 + h, z + 0.04], [xs, 1.2 + h, z - 0.04], [xs, 1.2 + h + 0.1, z - 0.04], [xs, 1.2 + h + 0.1, z + 0.04], 0x5f6f7a);
    }
    for (let i = 0; i < 12; i++) { const z = GZ1 + 1.5 - i * 0.6; emi.quad([xs + 0.01, 1.2, z + 0.01], [xs + 0.01, 1.2, z - 0.01], [xs + 0.01, 1.75, z - 0.01], [xs + 0.01, 1.75, z + 0.01], 0x6e7c82); }
  });
  // 陈默：7.0 s 坐下，只看得见腿
  const cm = new KitGeo();
  seatedLegs(cm, -0.45, -0.87, Math.PI, PAL.trousers, 0xdfe3e2, 0.09);
  chenMo = lambertMesh(ctx, cm, 'chenMoLegs');
  root.add(lambertMesh(ctx, stat, 'canteenCorner'), emissiveMesh(ctx, emi, 'playground'), chenMo);
  update(0, null as unknown as SimSnapshot);
  return root;
}

function update(t: number, _snap: SimSnapshot): void {
  if (!chenMo) return;
  const k = clamp((t - 6.6) / 0.6, 0, 1);
  chenMo.visible = k > 0;
  chenMo.position.set(0, 0, -0.5 * (1 - k));
}

export const canteenWindowSet: StillSet = {
  id: 'canteenWindow', owner: 'WP3', variants: ['default'],
  build: (ctx) => build(ctx),
  playerAnchor: () => new THREE.Matrix4().makeTranslation(-0.45, 0, -0.45 + 0.42),
  /** rect = [zMin, yMin, zMax, yMax]（相对 STILL_ORIGIN）。 */
  surfaces: () => [{ id: 'canteenGlass', plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), -GLASS_X), rect: [GZ0, GY0, GZ1, GY1] }],
  update,
};

registerSet(canteenWindowSet);
