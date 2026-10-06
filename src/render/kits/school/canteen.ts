// src/render/kits/school/canteen.ts —— 食堂 kit（DESIGN.md §5.9、§4.2，WP3）。
// 变体：forest（2-2「椅子腿、人腿、桌腿，从四面八方围过来」：两侧满是连体餐桌凳）、
// tray（2-4 端盘：左侧是不锈钢打饭窗口一线）、windowWall（2-6：左侧整面窗，玻璃里映出另一个「它」）。
// 大厅高 3.8 m，方柱每 2 个周期一根，吊扇（高画质），灯管横挂每 2 拍一排。地面是旧一点、带油光的水磨石。
// 食堂里没有暖色：窗口那盏酱油色的灯只在 2-3 的静场 counter 里。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { KitGeo } from '../../geom';
import { markSchoolAtlas, type HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import { ATLAS } from '../../textures/school';
import {
  CORRIDOR_WALL, DAY_WINDOW, HW, beatsIn, brassStrips, chunkZ, contactShadow, floorUV, ceilingBack, ceilingQuad, crossWall, dataPlates, flatFloor, floorBlob, geos,
  makeEnv, mirrorRooms, sideHoles, sideWall, stepsIn, wallPaper, windowPane, type Env, type Hole, type WallStyle,
} from './shell';

const H = 3.8;
const ROOM = 5.2;
const WALL: WallStyle = { ...CORRIDOR_WALL, height: H, tileTop: 1.5, tileColor: 0xe0e5e6, wall: 0xcbd1d0, rim: 0x9aa3a4 };

interface Look { leftWall: number; counter: boolean; windows: boolean }
const LOOKS: Record<string, Look> = {
  forest: { leftWall: -ROOM, counter: false, windows: false },
  tray: { leftWall: -ROOM, counter: true, windows: false },
  windowWall: { leftWall: -HW, counter: false, windows: true },
};

/** 连体餐桌：桌面 + T 形钢架 + 四只圆凳（凳子挂在钢架上）。 */
export function table(g: KitGeo, e: Env, x: number, z: number, rot: boolean): void {
  const lo = e.low;
  const [w, d] = rot ? [0.7, 1.2] : [1.2, 0.7];
  g.box([x, 0.74, z], [w, 0.03, d], SCHOOL.canteenTable, { faces: lo ? '+y+z-y' : '+y+z-y+x-x' });
  const legF = lo ? '+z+x' : '+z+x-x';
  g.box([x, 0.37, z], [0.05, 0.72, 0.05], PAL.deskLeg, { faces: legF });
  g.box([x, 0.2, z], rot ? [0.04, 0.04, 1.6] : [1.6, 0.04, 0.04], PAL.deskLeg, { faces: '+y+z' });
  g.box([x, 0.2, z], rot ? [1.3, 0.04, 0.04] : [0.04, 0.04, 1.3], PAL.deskLeg, { faces: '+y+z' });
  const stools: Array<[number, number]> = rot ? [[-0.55, -0.35], [-0.55, 0.35], [0.55, -0.35], [0.55, 0.35]] : [[-0.35, -0.55], [0.35, -0.55], [-0.35, 0.55], [0.35, 0.55]];
  for (const [dx, dz] of stools) {
    g.prism([x + dx, 0.42, z + dz], 0.15, 0.03, lo ? 5 : 7, SCHOOL.canteenStool);
    g.box([x + dx, 0.21, z + dz], [0.035, 0.42, 0.035], PAL.deskLeg, { faces: legF });
  }
}

/** 餐盘与碗（桌上的一点杂物）。 */
export function trays(g: KitGeo, e: Env, x: number, z: number): void {
  const rng = e.rng;
  const n = rng.int(3);
  for (let i = 0; i < n; i++) {
    const xx = x + (rng.next() - 0.5) * 0.7, zz = z + (rng.next() - 0.5) * 0.35;
    g.box([xx, 0.765, zz], [0.36, 0.02, 0.26], PAL.steel, { faces: '+y+z' });
    if (!e.low) g.prism([xx + 0.07, 0.775, zz], 0.05, 0.04, 6, 0xe6ebee);
  }
}

/** 吊扇：一根杆、一个毂、三片扇叶（高画质）。 */
function fan(g: KitGeo, x: number, z: number, rot: number): void {
  g.box([x, H - 0.3, z], [0.03, 0.6, 0.03], 0x6f7a7e, { faces: '+x-x+z-z' });
  g.prism([x, H - 0.66, z], 0.1, 0.08, 6, 0x8a979e);
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * Math.PI * 2;
    const cx = x + Math.cos(a) * 0.45, cz = z - Math.sin(a) * 0.45;
    g.segment([x + Math.cos(a) * 0.08, H - 0.62, z - Math.sin(a) * 0.08], [cx + Math.cos(a) * 0.3, H - 0.6, cz - Math.sin(a) * 0.3], 0.12, 0.01, 0x9aa3a4, { faces: '+y-y' });
  }
}

export function buildCanteen(ctx: HwKitChunkContext, look: Look): KitChunk {
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos();
  const lamps: LampSpec[] = [];
  const rng = e.rng;
  const xl = look.leftWall;
  const from = e.s0 - e.back;

  flatFloor(floor, e, { color: 0xeef0f0, x0: xl, x1: ROOM });
  const fuv = floorUV(e);
  brassStrips(stat, e, PAL.brass, -HW, HW);
  for (let i = 0; i < 2; i++) floorBlob(floor, e, (rng.next() - 0.5) * 2.4, e.s0 + 1 + rng.next() * (e.L - 2), 0.3 + rng.next() * 0.4, 0.5 + rng.next(), 0xb9c0c2, rng.next(), 0xeef0f0);

  // —— 桌凳 ——
  const rowStep = e.period / Math.max(1, Math.round(e.period / 1.9));
  for (const s of stepsIn(e, rowStep, rowStep / 2, 0.6)) {
    const z = e.z(s);
    for (const x of look.windows ? [2.85, 4.45] : [-4.45, -2.85, 2.85, 4.45]) {
      if (look.counter && x < -3.5) continue;
      if (rng.next() < 0.1) continue;
      const zt = z + (rng.next() - 0.5) * 0.1;
      table(stat, e, x, zt, false);
      contactShadow(floor, x, zt, 1.1, 1.3, fuv, 0xb2b9ba, 0xeef0f0, 0.25, 0.0015, chunkZ(e));
      if (rng.next() < 0.5) trays(stat, e, x, z);
    }
  }
  // 方柱：每 2 个周期一根，在两侧桌列之间
  for (const s of stepsIn(e, e.period * 2, e.period, 0.3)) {
    for (const x of look.windows ? [1.95] : [-1.95, 1.95]) {
      stat.box([x, H / 2, e.z(s)], [0.5, H, 0.5], SCHOOL.pillar, { faces: '+x-x+z-z', bottomShade: 0.7 });
      stat.box([x, 0.6, e.z(s)], [0.52, 1.2, 0.52], 0xe0e5e6, { faces: '+x-x+z-z', bottomShade: 0.75 });
    }
  }

  // —— 左侧：打饭窗口一线（tray）或整面窗（windowWall）或墙 ——
  const holesL: Hole[] = sideHoles(e, 'L');
  if (look.windows) {
    const wins: Hole[] = [];
    for (let s = e.s0 + e.period / 2; s < e.s1 - 0.3; s += e.period) {
      const a = s - e.period / 2 + 0.12, b = s + e.period / 2 - 0.12;
      if (holesL.some((h) => h.s0 < b + 0.3 && h.s1 > a - 0.3) || b > e.s1 + 1e-6) continue;
      wins.push({ s0: a, s1: b, y0: 0.8, y1: 3.2 });
    }
    sideWall(stat, e, -1, WALL, [...holesL, ...wins], -HW, () => 0, from, e.s1);
    for (const h of wins) {
      windowPane(emi, stat, e, -1, h, { ...DAY_WINDOW, horizon: 0x7f909a }, 1.0);
      lamps.push({ s: (h.s0 + h.s1) / 2, x: -HW + 0.3, y: 2, kind: 'window', flickerable: false });
      stat.box([-HW + 0.18, 0.78, e.z((h.s0 + h.s1) / 2)], [0.36, 0.04, h.s1 - h.s0], 0xb9c0c1, { faces: '+y+x-y' });   // 窗台吧台
    }
  } else sideWall(stat, e, -1, WALL, holesL, xl, () => 0, from, e.s1);
  if (look.counter) {
    // 不锈钢打饭台：沿左侧 x = −3.9，台面 0.9 m，上面一排菜盆与挡板玻璃（暗）
    const za = e.z(e.s0), zb = e.z(e.s1);
    stat.box([-3.9, 0.45, (za + zb) / 2], [0.7, 0.9, e.L], PAL.steel, { faces: '+x+y', bottomShade: 0.7 });
    for (const s of stepsIn(e, 0.75, 0.37, 0.3)) stat.box([-3.9, 0.93, e.z(s)], [0.5, 0.06, 0.55], 0x7c878c, { faces: '+y+x+z' });
    emi.withSteady(1, () => emi.quad([-3.54, 1.05, za], [-3.54, 1.05, zb], [-3.54, 1.45, zb], [-3.54, 1.45, za], 0x3a464d));
    stat.box([-3.9, 2.4, (za + zb) / 2], [0.8, 0.08, e.L], 0x8a979e, { faces: '-y+x' });
  }
  const holesR = sideHoles(e, 'R');
  sideWall(stat, e, 1, WALL, holesR, ROOM, () => 0, from, e.s1);
  for (const s of stepsIn(e, e.period * 2, e.period * 0.5, 0.8)) if (rng.next() < 0.5) wallPaper(stat, e, 1, s, 2.1, 0.5, 0.7, ATLAS.poster, 0, ROOM);

  // —— 天花板、灯管（横挂，每 2 拍一排三支）、吊扇 ——
  ceilingQuad(stat, e, xl, ROOM, H, 0xbfc6c7);
  if (e.back > 0) ceilingBack(stat, e, xl, ROOM, H, 0xbfc6c7);
  for (const s of beatsIn(e, 2, 1, 0.3)) {
    const z = e.z(s);
    for (const x of look.windows ? [0, 2.8] : [-2.8, 0, 2.8]) {
      stat.box([x, H - 0.1, z], [1.3, 0.035, 0.2], SCHOOL.pipe, { faces: '-y+z-z+x-x' });
      emi.box([x, H - 0.14, z], [1.2, 0.045, 0.075], PAL.tube, { faces: '-y+z-z+x-x' });
    }
    lamps.push({ s, x: 0, y: H - 0.14, kind: 'tube', flickerable: true });
  }
  if (!e.low) for (const s of stepsIn(e, e.period * 2, e.period * 1.5, 0.5)) for (const x of look.windows ? [3.3] : [-3.3, 3.3]) fan(stat, x, e.z(s), rng.next() * 3);

  mirrorRooms(stat, emi, e);
  dataPlates(stat, e);
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, xl, ROOM, H, 0, WALL, true);
  else if (e.head && ctx.hw?.prev?.kit !== 'canteen') crossWall(stat, e, e.segS0, xl, ROOM, H, 2.6, WALL);
  if (e.tail && ctx.hw?.next?.kit !== 'canteen') crossWall(stat, e, e.segS1, xl, ROOM, H, ctx.hw?.next ? 2.6 : 0, WALL, !ctx.hw?.next);

  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'terrazzo', params: { base: 0x868d8c } }, hwGloss: 0.3 };
  const out: KitChunk = { floor: f, static: markSchoolAtlas(stat.build()), lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

export const canteenKit: EnvKit = {
  id: 'canteen', owner: 'WP3', variants: ['forest', 'tray', 'windowWall'],
  build: (ctx) => buildCanteen(ctx as HwKitChunkContext, LOOKS[ctx.variant] ?? (LOOKS.forest as Look)),
  ambience: () => 'canteen',
  reverb: () => 'canteen',
};

registerKit(canteenKit);
