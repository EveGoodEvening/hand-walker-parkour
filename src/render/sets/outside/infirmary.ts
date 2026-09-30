// src/render/sets/outside/infirmary.ts —— 医务室（DESIGN.md §4.5 5-9、5-10；氛围 fluorescent）。
// 变体 bed（5-9）：病床、白床单；「枕头旁边，有一个浅浅的凹陷。像有人刚刚坐过。」窗外是操场（阴天的白光，一线跑道和草）。
// 变体 ceiling（5-10）：躺着往上看；「天花板上的裂缝……像一只张开的手，五根手指朝着我的方向。」（ceilingCrack，手）。
// 日光灯（发光几何），墙 #DDE4E6。坐标相对 STILL_ORIGIN。draw call：房间 1、发光 1、床单 1、天花板 1 = 4。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import { C, mix } from '../../kits/outside/lib/colors';
import { OGeo, TexGeo, heightGrid } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, roomShell } from './lib/setkit';

const X0 = -2.4, X1 = 2.4, Z0 = -3.6, Z1 = 2.4, H = 2.8;

interface Bed { cx: number; z0: number; z1: number; top: number; pillowZ: number; dent: [number, number] | null }
const BEDS: Record<'bed' | 'ceiling', Bed> = {
  bed: { cx: -0.9, z0: -2.7, z1: -0.7, top: 0.6, pillowZ: -2.42, dent: [-0.62, -2.12] },
  ceiling: { cx: 0, z0: -1.2, z1: 0.8, top: 0.6, pillowZ: -0.95, dent: null },
};

/** 床单高度：平铺，两侧垂下；枕边的凹陷（高斯，深 4 cm）。 */
export function sheetHeight(bed: Bed, x: number, z: number): number {
  let y = bed.top + 0.03;
  const ax = Math.abs(x - bed.cx);
  if (ax > 0.42) y -= (ax - 0.42) * 2.4;
  if (bed.dent) y -= 0.04 * Math.exp(-((x - bed.dent[0]) ** 2) / 0.02 - ((z - bed.dent[1]) ** 2) / 0.03);
  return y;
}

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const v = variant === 'ceiling' ? 'ceiling' : 'bed';
  const bed = BEDS[v];
  const b = new SetBuild(ctx, `set.infirmary.${v}`);
  const g = new OGeo();
  roomShell(g, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H, floor: 0xb3bdc1, ceiling: v === 'ceiling' ? null : 0xd6dde0, wall: C.infirmary,
    wainscot: { h: 1.0, color: 0xc4cfd4 } });
  for (let x = X0 + 0.5; x < X1; x += 0.5) g.flat(0.001, x - 0.006, x + 0.006, Z1, Z0, 0x9ea9ae);
  for (let z = Z0 + 0.5; z < Z1; z += 0.5) g.flat(0.001, X0, X1, z + 0.006, z - 0.006, 0x9ea9ae);
  // 病床：钢架、床垫、枕头
  const zc = (bed.z0 + bed.z1) / 2, len = bed.z1 - bed.z0;
  for (const dx of [-0.45, 0.45]) for (const zz of [bed.z0 + 0.05, bed.z1 - 0.05]) g.box([bed.cx + dx, 0.28, zz], [0.04, 0.56, 0.04], C.steel);
  g.box([bed.cx, 0.5, zc], [0.94, 0.08, len], 0x8d989d);
  g.box([bed.cx, 0.82, bed.z0 - 0.02], [0.96, 0.6, 0.04], C.steel);
  g.box([bed.cx, 0.72, bed.pillowZ], [0.58, 0.12, 0.36], 0xe4eaec);
  if (v === 'bed') {
    // 床边的帘子（半拉）、柜子、洗手池、桌子
    g.box([bed.cx - 0.75, H - 0.25, zc], [0.03, 0.03, len + 1.2], C.steel);
    for (let i = 0; i < 6; i++) g.box([bed.cx - 0.75, 1.3, bed.z0 + 0.2 + i * 0.16], [0.04, 2.1, 0.14], i % 2 ? 0xb4c3cb : 0xbecbd2);
    g.box([2.1, 1.2, -1.8], [0.45, 1.8, 1.0], 0xe4eaec);
    g.box([1.87, 1.5, -1.8], [0.01, 0.9, 0.8], 0x9fb2bc, { faces: '-x' });
    g.box([2.15, 0.85, 0.4], [0.4, 0.1, 0.5], 0xd8dfe2);
    g.box([2.15, 0.4, 0.4], [0.2, 0.8, 0.2], 0xb8c2c6);
    g.box([0.9, 0.74, -3.2], [1.1, 0.04, 0.6], 0xcfd8dc);
    for (const dx of [-0.5, 0.5]) g.box([0.9 + dx, 0.37, -3.2], [0.04, 0.74, 0.55], 0x9aa3a6);
    // 窗框（远墙）
    g.wallZ(Z0 + 0.02, -0.25, 1.65, 0.95, 1.0, 0xe8eef0, 1);
    g.wallZ(Z0 + 0.02, -0.25, 1.65, 2.2, 2.25, 0xe8eef0, 1);
    g.wallZ(Z0 + 0.021, 0.68, 0.72, 1.0, 2.2, 0xe8eef0, 1);
  }
  b.lambert(g, 'room');
  // 发光：日光灯；窗（操场的白光，下沿一线跑道和草）
  const e = new OGeo();
  const tubes: Array<[number, number]> = v === 'ceiling' ? [[0.9, -0.8], [-0.9, 1.2]] : [[0.3, -1.2], [0.3, 1.0]];
  for (const [x, z] of tubes) {
    e.box([x, H - 0.04, z], [0.12, 0.03, 1.2], C.tube, { faces: '-y+x-x' });
    e.box([x, H - 0.015, z], [0.2, 0.03, 1.3], 0xc9cfd2, { faces: '-y' });
  }
  if (v === 'bed') {
    e.wallZ(Z0 + 0.015, -0.2, 1.6, 1.62, 2.2, C.windowLightTop, 1);
    e.wallZ(Z0 + 0.015, -0.2, 1.6, 1.12, 1.62, C.windowLight, 1);
    // 窗外远处的跑道和草：隔着玻璃、阴天，颜色淡下去（第五章不要跳出来的暖色）
    e.wallZ(Z0 + 0.016, -0.2, 1.6, 1.12, 1.2, mix(C.track, C.windowLight, 0.45), 1);
    e.wallZ(Z0 + 0.016, -0.2, 1.6, 1.0, 1.12, mix(C.grass, C.windowLight, 0.3), 1);
  }
  b.emissive(e);
  // 床单（可变形网格，带枕边的凹陷）
  const grid = heightGrid(bed.cx - 0.55, bed.cx + 0.55, bed.z0 + 0.05, bed.z1 + 0.05, ctx.quality.tier === 'low' ? 10 : 20, ctx.quality.tier === 'low' ? 16 : 32, 0.8,
    (x, z) => sheetHeight(bed, x, z));
  // 凹陷处顶点色压暗一点（平面着色下很浅的凹陷不够显眼）
  if (bed.dent) {
    const pos = grid.geometry.getAttribute('position') as THREE.BufferAttribute, col = grid.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = Math.exp(-((pos.getX(i) - bed.dent[0]) ** 2) / 0.02 - ((pos.getZ(i) - bed.dent[1]) ** 2) / 0.03);
      const f = 1 - 0.28 * k;
      col.setXYZ(i, f, f, f);
    }
    col.needsUpdate = true;
  }
  b.textured(grid.geometry, 'bedSheet', {}, 'sheet', true);
  // 天花板（ceiling 变体）：手形的裂缝，正对着躺着的人
  if (v === 'ceiling') {
    const tg = new TexGeo();
    tg.quad([X0, H, Z1], [X0, H, Z0], [X1, H, Z0], [X1, H, Z1], [-0.25, 1.3], [-0.25, -0.3], [1.25, -0.3], [1.25, 1.3], 0xd4dadc);
    // 日光灯下的天花板：不受半球光（朝下的面只吃地面色），直接给亮度
    b.texturedBasic(tg, 'ceilingCrack', { shape: 'hand' }, 'ceiling');
  }
  liveList('infirmary').add({ variant: v, root: b.root, update: () => { /* 静止 */ } });
  return b.root;
}

export const infirmarySet: StillSet = {
  id: 'infirmary', owner: 'WP4', variants: ['bed', 'ceiling'],
  build,
  playerAnchor: (variant) => {
    const bed = BEDS[variant === 'ceiling' ? 'ceiling' : 'bed'];
    return new THREE.Matrix4().makeTranslation(bed.cx, bed.top, (bed.z0 + bed.z1) / 2 + 0.2);
  },
  update: (t, snap) => liveList('infirmary').update(snap.still?.t ?? t, snap),
};

registerSet(infirmarySet);
