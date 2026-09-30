// src/render/sets/school/counter.ts —— 静场「取餐窗口」（DESIGN.md §4.2 2-3，WP3）。
// 「我把双手撑在窗台边缘，膝盖弯曲，脚踮地」：镜头在主角身后（WP5 的 counter 机位 (0, 1.1, 1.6) → (0, 1.0, −1)），
// 看见不锈钢窗台、窗口里的菜盆、窗口阿姨的一只手和勺子（只露出这只手）。
// 窗口里那盏酱油色的灯（#B08D5E）和那勺红烧肉（#9C5F3E）是全作第一处暖色，只在这里（附录 A-9）。
// 手的动作：先盛一勺菜，再「又舀了一勺红烧肉，盖在最上面」（2.8 s 落到餐盘上），然后收回去。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { clamp, lerp, smoothstep } from '../../../core/math';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { KitGeo } from '../../geom';
import { PAL, WARM } from '../../palette';
import { emissiveMesh, floorRect, lambertMesh, wallZ } from './common';
import { mixHex } from '../../../core/geo';

const ZW = -0.62;         // 窗口所在的墙
const WX = 0.8;           // 窗口半宽
const Y0 = 0.95, Y1 = 1.85;

interface Built { hand: THREE.Group; ladleVeg: THREE.Mesh; ladlePork: THREE.Mesh; porkOnTray: THREE.Mesh; vegOnTray: THREE.Mesh }
let built: Built | null = null;

/** 手的关键帧：[t, x, y, z, 腕部翻转]；勺子在 1.6 s 与 2.8 s 倒进餐盘。 */
const KEYS: Array<[number, number, number, number, number]> = [
  [0.0, 0.35, 1.25, -1.35, 0], [0.6, -0.25, 1.05, -1.2, 0], [1.1, 0.05, 1.32, -0.75, 0], [1.55, 0.02, 1.12, -0.42, 1],
  [1.85, 0.2, 1.3, -0.9, 0], [2.3, 0.45, 1.05, -1.2, 0], [2.6, 0.1, 1.3, -0.72, 0], [2.85, 0.05, 1.1, -0.42, 1],
  [3.3, 0.25, 1.28, -0.95, 0], [4.2, 0.45, 1.22, -1.4, 0], [99, 0.45, 1.22, -1.4, 0],
];
export function handAt(t: number): { x: number; y: number; z: number; tip: number } {
  for (let i = 0; i + 1 < KEYS.length; i++) {
    const a = KEYS[i] as (typeof KEYS)[number], b = KEYS[i + 1] as (typeof KEYS)[number];
    if (t <= b[0]) {
      const k = smoothstep(a[0], b[0], t);
      return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), z: lerp(a[3], b[3], k), tip: lerp(a[4], b[4], k) };
    }
  }
  const l = KEYS[KEYS.length - 1] as (typeof KEYS)[number];
  return { x: l[1], y: l[2], z: l[3], tip: l[4] };
}

function build(ctx: ViewContext): THREE.Object3D {
  const root = new THREE.Group();
  const stat = new KitGeo(), emi = new KitGeo();
  // 食堂这一侧：地面、墙（下半截白瓷砖）、窗口
  floorRect(stat, -3.5, 3.5, ZW, 3, 0x9aa0a0);
  const tileG = new KitGeo();
  const wall = (x0: number, x1: number, y0: number, y1: number) => {
    // 下半截白瓷砖（贴图），上半截灰泥
    const ya = y0, yb = Math.min(y1, 1.5);
    if (yb > ya) tileG.quad([x0, ya, ZW], [x1, ya, ZW], [x1, yb, ZW], [x0, yb, ZW], 0xffffff,
      [[x0 / 0.6, ya / 0.6], [x1 / 0.6, ya / 0.6], [x1 / 0.6, yb / 0.6], [x0 / 0.6, yb / 0.6]], [0.8, 0.8, 1, 1]);
    if (y1 > 1.5) wallZ(stat, ZW, x0, x1, Math.max(y0, 1.5), y1, 0xcbd1d0);
  };
  wall(-3.5, -WX, 0, 3.4); wall(WX, 3.5, 0, 3.4); wall(-WX, WX, 0, Y0); wall(-WX, WX, Y1, 3.4);
  // 不锈钢窗台（伸出墙外，双手撑在这里）与窗框
  stat.box([0, Y0 - 0.02, ZW + 0.17], [WX * 2 + 0.3, 0.04, 0.38], PAL.steel, { faces: '+y+z-y+x-x' });
  stat.box([0, Y0 - 0.02, ZW - 0.25], [WX * 2, 0.04, 0.5], 0x8a979e, { faces: '+y' });
  for (const x of [-WX, WX]) stat.box([x, (Y0 + Y1) / 2, ZW], [0.06, Y1 - Y0, 0.12], PAL.steel, { faces: '+z+x-x' });
  stat.box([0, Y1 + 0.03, ZW], [WX * 2 + 0.12, 0.06, 0.12], PAL.steel, { faces: '+z-y' });
  // 左右两个关着的窗口（卷帘）
  for (const x of [-2.3, 2.3]) {
    stat.box([x, (Y0 + Y1) / 2, ZW + 0.01], [1.4, Y1 - Y0, 0.02], 0x8f9a9c, { faces: '+z' });
    for (let i = 1; i < 9; i++) stat.box([x, Y0 + (i * (Y1 - Y0)) / 9, ZW + 0.022], [1.38, 0.012, 0.004], 0x6e7c82, { faces: '+z' });
    stat.box([x, Y0 - 0.02, ZW + 0.12], [1.5, 0.04, 0.26], PAL.steel, { faces: '+y+z' });
  }
  // 窗口上方：一块没有字的深色价目板；窗台下沿一道积灰
  stat.box([0, 2.25, ZW + 0.02], [1.9, 0.5, 0.04], 0x3a464d, { faces: '+z+y-y' });
  stat.box([0, 0.08, ZW + 0.01], [7, 0.16, 0.02], 0x8a979e, { faces: '+z' });
  // 窗口里：操作台、菜盆（暖灯下带一点暖）、后墙与暖灯
  const warm = (c: number, k: number) => mixHex(c, WARM.windowLamp, k);
  stat.box([0, 0.88, -1.25], [2.4, 0.06, 1.0], warm(0xaab4b8, 0.35), { faces: '+y+z' });
  stat.quad([-1.8, 0, -2.4], [1.8, 0, -2.4], [1.8, 3.2, -2.4], [-1.8, 3.2, -2.4], warm(0x3a4246, 0.35), null, [0.6, 0.6, 1, 1]);
  const basins: Array<[number, number]> = [[-0.45, WARM.braisedPork], [0.1, 0x5e6b5a], [0.62, 0xd9dcd6]];
  for (const [x, food] of basins) {
    stat.box([x, 0.97, -1.15], [0.5, 0.12, 0.42], warm(0xc9cfcf, 0.3), { faces: '+x-x+z-z' });
    stat.box([x, 1.02, -1.15], [0.44, 0.02, 0.36], food, { faces: '+y' });
  }
  stat.box([0, 2.9, -1.6], [0.02, 0.6, 0.02], 0x3a4246);
  emi.withSteady(1, () => {
    emi.box([0, 2.55, -1.6], [0.16, 0.12, 0.16], WARM.windowLamp);                    // 酱油色的灯
    emi.quad([-1.6, 1.2, -2.39], [1.6, 1.2, -2.39], [1.6, 3.0, -2.39], [-1.6, 3.0, -2.39], [0x3a3228, 0x3a3228, 0x6e5a40, 0x6e5a40]); // 灯照亮的后墙
  });
  // 窗台上主角的餐盘（米饭；菜与那勺红烧肉按时间出现）
  stat.box([0, Y0 + 0.012, ZW + 0.12], [0.4, 0.02, 0.3], PAL.steel, { faces: '+y+z+x-x' });
  stat.box([-0.08, Y0 + 0.035, ZW + 0.12], [0.16, 0.03, 0.2], 0xe6ebee, { faces: '+y+z' });
  const vegG = new KitGeo(); vegG.box([0.1, Y0 + 0.035, ZW + 0.16], [0.12, 0.03, 0.1], 0x5e6b5a, { faces: '+y+z+x' });
  const porkG = new KitGeo(); porkG.box([-0.04, Y0 + 0.06, ZW + 0.1], [0.14, 0.04, 0.12], WARM.braisedPork, { faces: '+y+z+x-x' });
  const vegOnTray = lambertMesh(ctx, vegG, 'veg'), porkOnTray = lambertMesh(ctx, porkG, 'pork');
  // 窗口阿姨的手：白袖口 + 前臂 + 手，握着长柄勺
  const handG = new KitGeo();
  handG.box([0, 0, 0.3], [0.13, 0.13, 0.36], 0xdfe3e2, { faces: '+x-x+y-y+z' });       // 袖子
  handG.box([0, -0.01, 0.02], [0.08, 0.07, 0.24], PAL.skin, { faces: '+x-x+y-y+z-z' });  // 前臂与手
  handG.box([0.02, -0.02, -0.12], [0.07, 0.06, 0.07], mixHex(PAL.skin, 0x8c8279, 0.2));
  handG.segment([0.02, -0.02, -0.12], [0.02, -0.22, -0.3], 0.02, 0.02, PAL.steel);       // 勺柄
  handG.prism([0.02, -0.28, -0.32], 0.07, 0.05, 6, PAL.steel);                          // 勺头
  const vegL = new KitGeo(); vegL.box([0.02, -0.23, -0.32], [0.09, 0.02, 0.09], 0x5e6b5a, { faces: '+y' });
  const porkL = new KitGeo(); porkL.box([0.02, -0.22, -0.32], [0.1, 0.03, 0.1], WARM.braisedPork, { faces: '+y' });
  const hand = new THREE.Group();
  hand.name = 'lunchLadyHand';
  hand.add(lambertMesh(ctx, handG, 'hand'));
  const ladleVeg = lambertMesh(ctx, vegL, 'ladleVeg'), ladlePork = lambertMesh(ctx, porkL, 'ladlePork');
  hand.add(ladleVeg, ladlePork);
  const tileGeom = tileG.build();
  ctx.mat.ensureChalkAttr(tileGeom);
  const tiles = new THREE.Mesh(tileGeom, ctx.mat.lambert({ vertexColors: true, map: ctx.tex.get('tile', { n: 4, tile: 0xe6ebee, grout: 0xaab4b8, repeat: 1 }), flat: true }));
  tiles.name = 'tiles';
  root.add(lambertMesh(ctx, stat, 'counter'), tiles, emissiveMesh(ctx, emi, 'lamp'), vegOnTray, porkOnTray, hand);
  built = { hand, ladleVeg, ladlePork, porkOnTray, vegOnTray };
  update(0, null as unknown as SimSnapshot);
  return root;
}

function update(t: number, _snap: SimSnapshot): void {
  if (!built) return;
  const p = handAt(t);
  built.hand.position.set(p.x, p.y, p.z);
  built.hand.rotation.set(-0.25 - p.tip * 0.9, 0.1, p.tip * 0.4);
  // 勺里有东西：舀起来之后、倒下之前
  built.ladleVeg.visible = t > 0.62 && t < 1.55;
  built.ladlePork.visible = t > 2.32 && t < 2.85;
  built.vegOnTray.visible = t >= 1.55;
  built.porkOnTray.visible = t >= 2.85;
  void clamp;
}

export const counterSet: StillSet = {
  id: 'counter', owner: 'WP3', variants: ['default'],
  build: (ctx) => build(ctx),
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0),
  update,
};

registerSet(counterSet);
