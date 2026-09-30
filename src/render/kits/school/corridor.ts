// src/render/kits/school/corridor.ts —— 走廊 kit（DESIGN.md §5.9、§4，WP3）。
// 变体：morning（早晨，左窗右门）、wet（值日后的水痕，「天花板的灯管连成一条没有尽头的水银河」）、mirrorEnd（尽头那面擦不干净的镜子）、
// labNorth（实验楼北向走廊：窗小而冷，墙上的值日表，裸露的管道）、night（晚自习后：窗黑，灯管是唯一的光）、
// recess（课间：门开着）、void（第五章终段：说不清时间的长走廊，几乎全黑，只有掌光）。
// 左墙窗、右墙门；地面水磨石（铜条每拍一道）；灯管每 2 拍一盏沿中线排成一条；横梁每 2 个墙面周期一道。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { AmbienceId, ReverbId } from '../../../core/types';
import type { HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import { ATLAS } from '../../textures/school';
import {
  CORRIDOR_WALL, DAY_WINDOW, HW, NIGHT_WINDOW, NORTH_WINDOW, brassStrips, ceilingBack, ceilingQuad, chunkZ, contactShadow, crossWall, dataPlates, endWalls, flatFloor, floorBlob, floorUV,
  geos, hydrantBox, makeEnv, mirrorRooms, noticeBoard, radiator, sideDoor, sideHoles, sideWall, tubes, wallPaper, windowPane,
  type Env, type Hole, type WallStyle, type WindowStyle,
} from './shell';
import type { KitGeo } from '../../geom';

interface Look {
  floor: number; floorBase: number; gloss: number;
  wall: WallStyle; ceiling: number;
  windows: WindowStyle | null; windowSize: [number, number];
  doorLeaf: number; doorPane: number | null; doorOpen: number;
  lamps: boolean; roster: boolean; pipes: boolean; wet: boolean; dark: boolean; lockers: boolean;
}

const BASE: Look = {
  floor: 0xffffff, floorBase: PAL.terrazzo, gloss: 0.22, wall: CORRIDOR_WALL, ceiling: PAL.ceiling,
  windows: DAY_WINDOW, windowSize: [0.95, 2.65], doorLeaf: SCHOOL.doorLeaf, doorPane: 0x8d9aa2, doorOpen: 0,
  lamps: true, roster: false, pipes: false, wet: false, dark: false, lockers: true,
};

export const CORRIDOR_LOOKS: Record<string, Look> = {
  morning: BASE,
  mirrorEnd: BASE,
  recess: { ...BASE, doorOpen: 0.55 },
  wet: { ...BASE, floor: 0xb4bcc0, gloss: 0.8, wet: true },
  labNorth: {
    ...BASE, floorBase: 0x8a9294, windows: NORTH_WINDOW, windowSize: [1.25, 2.45], roster: true, pipes: true, lockers: false, doorPane: 0x6f7d85,
    wall: { ...CORRIDOR_WALL, wall: 0xc3ccd0, wainscot: 0x6e8288, rim: 0x5a6c72 }, ceiling: 0xb3bcc0,
  },
  night: { ...BASE, windows: NIGHT_WINDOW, doorPane: 0x1a2a33, gloss: 0.3, floor: 0xe0e4e6 },
  void: {
    ...BASE, floorBase: PAL.voidFloor, floor: 0x8d969b, gloss: 0.12, windows: { top: 0x0f1316, bottom: 0x0a0c0e, frame: 0x0a0c0e, horizon: null },
    wall: { ...CORRIDOR_WALL, wall: 0x1c2227, wainscot: 0x15191c, rim: 0x101316, baseboard: 0x0a0c0e }, ceiling: 0x14181b,
    doorLeaf: PAL.voidSilhouette, doorPane: 0x0a0c0e, lamps: false, dark: true, lockers: false,
  },
};

/** 墙面周期的中心（相对 chunk 起点；周期整除 chunk 名义长度，通用变体之间连续）。 */
function slots(e: Env): number[] {
  const out: number[] = [];
  for (let s = e.s0 + e.period / 2; s < e.s1 - 0.3; s += e.period) out.push(s);
  return out;
}

function overlapsOpening(e: Env, side: 'L' | 'R', a: number, b: number): boolean {
  return e.openings.some((o) => o.side === side && o.s0 < b + 0.4 && o.s1 > a - 0.4)
    || e.surfaces.some((su) => su.side === side && (su.kind === 'doorPlate' || su.kind === 'board') && su.s0 < b + 0.6 && su.s1 > a - 0.6);
}

export function buildCorridor(ctx: HwKitChunkContext, look: Look): KitChunk {
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos();
  const lamps: LampSpec[] = [];
  const H = look.wall.height;
  const rng = e.rng;

  // —— 地面 ——
  flatFloor(floor, e, { color: look.floor });
  if (look.wet) {
    // 水痕：几块不规则的更暗、更蓝的湿地（同一张水磨石纹理），沿着抹布推过的方向拉长
    for (let i = 0; i < 6; i++) {
      const s = e.s0 + 1 + rng.next() * (e.L - 2), x = (rng.next() - 0.5) * 2.4;
      floorBlob(floor, e, x, s, 0.35 + rng.next() * 0.7, 1.0 + rng.next() * 2.6, 0x8997a0, rng.next(), look.floor);
    }
  }
  brassStrips(stat, e, look.dark ? 0x2c3439 : PAL.brass);

  // —— 左墙：窗 ——
  const holesL: Hole[] = sideHoles(e, 'L');
  const holesR: Hole[] = sideHoles(e, 'R');
  const winW = e.period - 0.7;
  const winHoles: Hole[] = [];
  if (look.windows) {
    for (const c of slots(e)) {
      const a = c - winW / 2, b = c + winW / 2;
      if (b > e.s1 + 1e-6 || overlapsOpening(e, 'L', a, b)) continue;
      winHoles.push({ s0: a, s1: b, y0: look.windowSize[0], y1: look.windowSize[1] });
    }
  }
  sideWall(stat, e, -1, look.wall, [...holesL, ...winHoles], -HW, () => 0, e.s0 - e.back);
  for (const h of winHoles) {
    windowPane(emi, stat, e, -1, h, look.windows as WindowStyle, 1.2);
    if (!look.windows?.night && !look.dark) lamps.push({ s: (h.s0 + h.s1) / 2, x: -HW + 0.25, y: 1.8, kind: 'window', flickerable: false });
    stat.box([-HW + 0.06, h.y0 - 0.02, e.z((h.s0 + h.s1) / 2)], [0.2, 0.04, h.s1 - h.s0 + 0.1], look.dark ? 0x121619 : 0xc3c9c9, { faces: '+y+x' });
    if (!look.dark) radiator(stat, e, -1, (h.s0 + h.s1) / 2, Math.min(1.3, winW - 0.4));
  }
  for (const h of holesL) holeRevealSafe(stat, e, -1, h, look);

  // —— 右墙：门、柜子、公告栏 ——
  const doorHoles: Hole[] = [];
  const sl = slots(e);
  const plan = sl.map(() => rng.next());
  sl.forEach((c, i) => {
    const r = plan[i] as number;
    if (overlapsOpening(e, 'R', c - 0.8, c + 0.8)) return;
    if (r < 0.42) {
      const plate = look.dark ? null : (rng.next() < 0.5 ? ATLAS.plates[2] : ATLAS.plates[3]);
      doorHoles.push(sideDoor(stat, emi, e, 1, c + (rng.next() - 0.5) * 0.6, {
        leaf: look.doorLeaf, windowPane: look.doorPane, plate, open: look.doorOpen > 0 && rng.next() < 0.7 ? look.doorOpen : 0,
        frame: look.dark ? 0x101316 : SCHOOL.doorFrame,
      }));
    } else if (r < 0.62 && look.lockers) {
      lockerBank(stat, e, c, Math.min(e.period - 0.4, 2.4), look);
      contactShadow(floor, HW - 0.17, e.z(c), 0.34, Math.min(e.period - 0.4, 2.4), floorUV(e), 0x9aa2a6, look.floor, 0.16, 0.0015, chunkZ(e));
    }
    else if (r < 0.8 && !look.dark) {
      if (look.roster) wallPaper(stat, e, 1, c, 1.55, 0.42, 0.56, ATLAS.roster, (rng.next() - 0.5) * 0.05);
      else noticeBoard(stat, e, 1, c, Math.min(1.8, e.period - 0.6));
    } else if (r < 0.88 && !look.dark) hydrantBox(stat, e, 1, c);
  });
  sideWall(stat, e, 1, look.wall, [...holesR, ...doorHoles], HW, () => 0, e.s0 - e.back);
  for (const h of holesR) holeRevealSafe(stat, e, 1, h, look);
  if (look.roster) {
    // 值日表贴在门旁边（北向走廊的风把它吹得沙沙响）
    for (const h of doorHoles) wallPaper(stat, e, 1, Math.min(e.s1 - 0.3, h.s1 + 0.45), 1.5, 0.4, 0.54, ATLAS.roster, 0.03);
  }

  // —— 天花板、横梁、灯 ——
  ceilingQuad(stat, e, -HW, HW, H, look.ceiling);
  if (e.back > 0) ceilingBack(stat, e, -HW, HW, H, look.ceiling);
  for (let k = 0; ; k++) {
    const s = e.s0 + k * e.period * 2;
    if (s > e.s1 - 0.1) break;
    if (s < e.s0 + 0.05 && k > 0) continue;
    stat.box([0, H - 0.17, e.z(s + 0.15)], [2 * HW, 0.34, 0.3], look.dark ? 0x121619 : SCHOOL.beam, { faces: '-y+z-z', bottomShade: 1 });
  }
  if (look.lamps) tubes(emi, stat, e, lamps, { y: H - 0.12, every: 2, offset: 1 });
  else for (const s of stepsInBeats(e, 2)) stat.box([0, H - 0.1, e.z(s)], [0.2, 0.05, 1.2], 0x101316, { faces: '-y+x-x+z-z' });
  if (look.pipes) {
    stat.box([HW - 0.12, H - 0.32, e.z((e.s0 + e.s1) / 2)], [0.07, 0.07, e.L], SCHOOL.pipe, { faces: '-y-x+y' });
    stat.box([HW - 0.24, H - 0.26, e.z((e.s0 + e.s1) / 2)], [0.05, 0.05, e.L], 0x6c777c, { faces: '-y-x+y' });
  }

  // —— 开口（窗 / 墙镜的镜中房间，端墙镜）、门牌 ——
  mirrorRooms(stat, emi, e);
  endWalls(stat, e, look.wall, undefined, undefined, emi);
  dataPlates(stat, e);

  // —— 段首 / 段尾 ——
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, -HW, HW, H, 0, look.wall, true);
  if (e.tail && !ctx.hw?.next && !e.openings.some((o) => o.side === 'end')) crossWall(stat, e, e.segS1, -HW, HW, H, 0, look.wall, true);

  return finish(ctx, floor, stat, emi, lamps, look);
}

function stepsInBeats(e: Env, every: number): number[] {
  const out: number[] = [];
  const b0 = Math.ceil(((e.s0 + 0.3 - e.segS0) / e.stride - 1) / every - 1e-6);
  for (let k = b0; ; k++) { const s = e.segS0 + (k * every + 1) * e.stride; if (s >= e.s1 - 0.3) break; out.push(s); }
  return out;
}

function holeRevealSafe(stat: KitGeo, e: Env, side: -1 | 1, h: Hole, look: Look): void {
  // 开口的窗台 / 过梁用钢灰（镜框）；夜里更暗
  const c = look.dark ? 0x101316 : PAL.steel;
  const xw = side * HW, xi = xw + side * 0.14;
  const za = e.z(Math.max(h.s0, e.s0)), zb = e.z(Math.min(h.s1, e.s1));
  const [x0, x1] = side < 0 ? [xi, xw] : [xw, xi];
  stat.quad([x0, h.y0, za], [x1, h.y0, za], [x1, h.y0, zb], [x0, h.y0, zb], c);
  stat.quad([x0, h.y1, zb], [x1, h.y1, zb], [x1, h.y1, za], [x0, h.y1, za], c, null, [0.8, 0.8, 0.8, 0.8]);
  if (h.s0 >= e.s0 - 1e-6) stat.quad([x1, h.y0, za], [x0, h.y0, za], [x0, h.y1, za], [x1, h.y1, za], c);
  if (h.s1 <= e.s1 + 1e-6) stat.quad([x0, h.y0, zb], [x1, h.y0, zb], [x1, h.y1, zb], [x0, h.y1, zb], c);
}

/** 一排储物柜（贴右墙，深 0.34 m，柜门竖缝与通风孔）。 */
function lockerBank(g: KitGeo, e: Env, c: number, w: number, look: Look): void {
  const x = HW - 0.17, z = e.z(c), h = 1.8;
  const col = look.dark ? 0x2a3136 : SCHOOL.locker;
  g.box([x, h / 2, z], [0.34, h, w], col, { faces: '-x+y+z-z', bottomShade: 0.75 });
  const n = Math.max(2, Math.round(w / 0.4));
  const xf = HW - 0.341;
  for (let i = 1; i < n; i++) {
    const zz = z + w / 2 - (i * w) / n;
    g.quad([xf, 0.05, zz - 0.006], [xf, 0.05, zz + 0.006], [xf, h - 0.02, zz + 0.006], [xf, h - 0.02, zz - 0.006], SCHOOL.lockerDark);
  }
  g.quad([xf, 0.9, z + w / 2], [xf, 0.9, z - w / 2], [xf, 0.912, z - w / 2], [xf, 0.912, z + w / 2], SCHOOL.lockerDark);
  if (!e.low) for (let i = 0; i < n; i++) {
    const zz = z + w / 2 - ((i + 0.5) * w) / n;
    for (const y of [1.55, 0.65]) g.quad([xf - 0.001, y, zz + 0.08], [xf - 0.001, y, zz - 0.08], [xf - 0.001, y + 0.05, zz - 0.08], [xf - 0.001, y + 0.05, zz + 0.08], SCHOOL.lockerDark);
  }
}

function finish(_ctx: HwKitChunkContext, floor: KitGeo, stat: KitGeo, emi: KitGeo, lamps: LampSpec[], look: Look): KitChunk {
  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'terrazzo', params: { base: look.floorBase } }, hwGloss: look.gloss };
  const s = stat.build();
  const out: KitChunk = { floor: f, static: s, lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

const AMB: Record<string, AmbienceId> = { morning: 'reading', wet: 'room', mirrorEnd: 'room', labNorth: 'labWind', night: 'nightCorridor', recess: 'room', void: 'void' };
const REV: Record<string, ReverbId> = { void: 'void' };

export const corridorKit: EnvKit = {
  id: 'corridor', owner: 'WP3', variants: ['morning', 'wet', 'mirrorEnd', 'labNorth', 'night', 'recess', 'void'],
  build: (ctx) => buildCorridor(ctx as HwKitChunkContext, CORRIDOR_LOOKS[ctx.variant] ?? BASE),
  ambience: (v) => AMB[v] ?? 'room',
  reverb: (v) => REV[v] ?? 'corridor',
};

registerKit(corridorKit);
