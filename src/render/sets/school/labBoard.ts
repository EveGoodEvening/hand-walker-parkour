// src/render/sets/school/labBoard.ts —— 静场「你后面」（DESIGN.md §4.2 2-9，WP3）。
// 空置的化学教室，窗户朝北，阳光照不进来。主角背靠实验桌腿坐在地上（头顶是「一片灰色的森林」）。
// 镜头转向身后的黑板（WP5 的 labBoard 机位 (0, 0.5, 1.4) → (0, 1.2, −3)）：黑板上的粉笔字由 board cue 写 / 擦，
// 黑板的反光面 id：'labBoard'（surfaces()；board cue 的 surface 用它）。写字、擦字的动画见 render/boards.ts。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import { Board, BOARDS, boardMaterial } from '../../boards';
import { KitGeo } from '../../geom';
import { bench, stool } from '../../kits/school/labRoom';
import { PAL } from '../../palette';
import { emiGeo, emissiveMesh, lambertMesh, propGeo, schoolWallX, schoolWallZ, setEnv, setWallTone, wallZ } from './common';

export const BOARD_Z = -3.2;
const BX = 1.8, BY0 = 0.85, BY1 = 2.1;
const XL = -3.6, XR = 3.6, ZB = 3.0, H = 3.4;

function build(ctx: ViewContext): THREE.Object3D {
  const e = setEnv(ctx, 'labBoard');
  const root = new THREE.Group();
  const stat = propGeo('labNorth'), emi = emiGeo(), floorG = new KitGeo();
  // 地面：灰绿小方砖（贴图）
  floorG.quad([XL, 0, ZB], [XR, 0, ZB], [XR, 0, BOARD_Z], [XL, 0, BOARD_Z], 0xffffff,
    [[XL / 1.2, -ZB / 1.2], [XR / 1.2, -ZB / 1.2], [XR / 1.2, -BOARD_Z / 1.2], [XL / 1.2, -BOARD_Z / 1.2]], [0.85, 0.85, 1, 1]);
  const fg = floorG.build();
  ctx.mat.ensureChalkAttr(fg);
  const floor = new THREE.Mesh(fg, ctx.mat.lambert({ vertexColors: true, map: ctx.tex.get('tile', { n: 2, tile: 0xb9c0c1, grout: 0x7f8b90, repeat: 1 }), flat: true }));
  floor.name = 'floor';
  // 墙：前墙（黑板这面）、左墙北窗、右墙柜子、后墙
  const wall = 0xc3ccd0, wains = 0x6e8288;
  const wallT = setWallTone(wall, 0.8, H, 'labNorth');
  wallZ(stat, BOARD_Z, XL, XR, 0, 0.1, setWallTone(0x3a464d, 0, 0.1, 'labNorth'));
  wallZ(stat, BOARD_Z, XL, XR, 0.1, 0.8, setWallTone(wains, 0.1, 0.8, 'labNorth'));
  wallZ(stat, BOARD_Z, XL, -BX - 0.1, 0.8, H, wallT); wallZ(stat, BOARD_Z, BX + 0.1, XR, 0.8, H, wallT);
  wallZ(stat, BOARD_Z, -BX - 0.1, BX + 0.1, 0.8, BY0 - 0.05, wallT); wallZ(stat, BOARD_Z, -BX - 0.1, BX + 0.1, BY1 + 0.05, H, wallT);
  // 黑板框（铝）与粉笔槽
  stat.box([0, BY0 - 0.04, BOARD_Z + 0.03], [2 * BX + 0.2, 0.05, 0.06], 0x9aa4a7);
  stat.box([0, BY1 + 0.03, BOARD_Z + 0.02], [2 * BX + 0.2, 0.05, 0.04], 0x9aa4a7);
  for (const x of [-BX - 0.07, BX + 0.07]) stat.box([x, (BY0 + BY1) / 2, BOARD_Z + 0.02], [0.05, BY1 - BY0 + 0.1, 0.04], 0x9aa4a7);
  stat.box([0, BY0 - 0.08, BOARD_Z + 0.09], [2 * BX, 0.03, 0.12], 0x8a979e, { faces: '+y+z-y' });
  stat.box([0.6, BY0 - 0.055, BOARD_Z + 0.1], [0.08, 0.02, 0.02], PAL.chalkText, { faces: '+y+z' });   // 一截粉笔
  schoolWallX(stat, XL, -1, BOARD_Z, ZB, H, wall, wains, 'labNorth');
  schoolWallX(stat, XR, 1, BOARD_Z, ZB, H, wall, wains, 'labNorth');
  schoolWallZ(stat, ZB, XR, XL, H, wall, wains, 'labNorth');
  stat.quad([XL, H, ZB], [XR, H, ZB], [XR, H, BOARD_Z], [XL, H, BOARD_Z], 0xb3bcc0, null, [0.7, 0.7, 0.7, 0.7]);
  // 北窗（冷、暗）
  for (const z of [-1.8, 0.8]) {
    emi.withSteady(1, () => emi.quad([XL + 0.012, 1.5, z + 0.9], [XL + 0.012, 1.5, z - 0.9], [XL + 0.012, 3.0, z - 0.9], [XL + 0.012, 3.0, z + 0.9], [0x8e9ca3, 0x8e9ca3, 0xb9c6cf, 0xb9c6cf]));
    stat.box([XL + 0.03, 2.25, z], [0.04, 1.5, 0.05], 0x9aa4a7, { faces: '+x+z-z' });
  }
  // 实验台：主角靠着的那张在右手边（钢架腿就在身旁），左边一张，两侧各一列；镜头从台与台之间看见黑板
  bench(stat, e, 1.05, -0.6, 2.4);
  bench(stat, e, -1.45, -0.2, 2.4);
  for (const [x, s] of [[-2.9, -0.2], [2.9, -0.2], [-2.9, 2.2], [2.9, 2.2], [-2.9, -2.4], [2.9, -2.4]] as const) {
    bench(stat, e, x, s, 2.0);
    stool(stat, e, x + (x < 0 ? 0.62 : -0.62), -s + 0.4);
  }
  stool(stat, e, -0.55, -0.9);
  // 右墙药品柜（暗玻璃）
  stat.box([XR - 0.22, 1.1, 0.4], [0.44, 2.2, 1.8], 0x6f7a7e, { faces: '-x+y+z-z', bottomShade: 0.7 });
  emi.withSteady(1, () => emi.quad([XR - 0.445, 1.25, 1.2], [XR - 0.445, 1.25, -0.4], [XR - 0.445, 2.05, -0.4], [XR - 0.445, 2.05, 1.2], 0x2a3439));
  // 黑板：Board（写 / 擦由 board cue 驱动）
  const blank = ctx.tex.get('chalkboard', { text: '' });
  const geom = new THREE.PlaneGeometry(2 * BX, BY1 - BY0);
  const board = new Board(new THREE.Mesh(geom), blank);
  board.mesh.material = boardMaterial(blank, ctx.lamps.uniforms, board.uniforms);
  board.mesh.position.set(0, (BY0 + BY1) / 2, BOARD_Z + 0.012);
  board.mesh.name = 'board:labBoard';
  BOARDS.set('labBoard', board);
  root.add(floor, lambertMesh(ctx, stat, 'labRoom'), emissiveMesh(ctx, emi, 'windows'), board.mesh);
  return root;
}

export const labBoardSet: StillSet = {
  id: 'labBoard', owner: 'WP3', variants: ['default'],
  build: (ctx) => build(ctx),
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.1),
  /** rect = [xMin, yMin, xMax, yMax]（相对 STILL_ORIGIN）。 */
  surfaces: () => [{ id: 'labBoard', plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOARD_Z), rect: [-BX, BY0, BX, BY1] }],
};

registerSet(labBoardSet);
