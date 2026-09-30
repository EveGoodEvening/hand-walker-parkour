// src/render/kits/school/labRoom.ts —— 化学实验室 kit（DESIGN.md §5.9、§4.2 2-8，WP3）。
// 变体：default。「实验桌的金属腿在我头顶上方形成一片灰色的森林」：两侧是黑台面的长实验台，钢架腿一排排，
// 台上试剂架、水槽、铜色（冷灰处理）的水龙头；左墙北向小窗（冷、暗）；右墙玻璃门药品柜。
// 车道里的实验台横档（labBench）是 WP6 的障碍；这里画的都在车道以外。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { KitGeo } from '../../geom';
import type { HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import { ATLAS } from '../../textures/school';
import {
  CORRIDOR_WALL, NORTH_WINDOW, beatsIn, ceilingBack, chunkZ, contactShadow, floorUV, ceilingQuad, crossWall, dataPlates, flatFloor, geos, makeEnv, mirrorRooms,
  sideHoles, sideWall, stepsIn, wallPaper, windowPane, type Env, type Hole, type WallStyle,
} from './shell';

const H = 3.4;
const ROOM = 4.8;
const WALL: WallStyle = { ...CORRIDOR_WALL, height: H, wall: 0xc3ccd0, wainscot: 0x6e8288, rim: 0x5a6c72 };

/** 一张长实验台（沿 s 方向），黑台面、钢架腿、台下横撑；中间一排试剂架与瓶子。 */
export function bench(g: KitGeo, e: Env, x: number, s: number, len: number): void {
  const z = e.z(s), lo = e.low;
  g.box([x, 0.88, z], [0.9, 0.05, len], SCHOOL.labBench, { faces: lo ? '+y-y+x-x' : '+y-y+x-x+z-z' });
  g.box([x, 0.84, z], [0.86, 0.04, len - 0.04], SCHOOL.labBenchTop, { faces: '-y' });
  const legs = Math.max(2, Math.round(len / 0.9));
  for (let i = 0; i <= legs; i++) {
    const zz = z + len / 2 - (i * len) / legs - (i === 0 ? 0.04 : i === legs ? -0.04 : 0);
    for (const dx of [-0.4, 0.4]) g.box([x + dx, 0.42, zz], [0.04, 0.84, 0.04], 0x7c878c, { faces: lo ? '+x-x+z' : '+x-x+z-z' });
    g.box([x, 0.14, zz], [0.8, 0.035, 0.035], 0x6c777c, { faces: '+y+z' });
  }
  // 试剂架
  g.box([x, 1.12, z], [0.18, 0.02, len - 0.3], 0x8a979e, { faces: '+y+x-x' });
  if (!lo) {
    for (const zz of [len / 2 - 0.3, -len / 2 + 0.3]) g.box([x, 1.0, z + zz], [0.04, 0.24, 0.04], 0x8a979e, { faces: '+x-x+z' });
    const rng = e.rng;
    const n = Math.floor(len / 0.3);
    for (let i = 0; i < n; i++) {
      if (rng.next() < 0.4) continue;
      const zz = z + len / 2 - 0.25 - i * 0.3;
      g.prism([x + (rng.next() - 0.5) * 0.08, 1.13, zz], 0.035, 0.12 + rng.next() * 0.08, 5, rng.next() < 0.5 ? 0xb9c6cf : 0x8e9ca3);
    }
  }
  // 台端的水槽与龙头
  g.box([x, 0.915, z - len / 2 + 0.35], [0.36, 0.02, 0.4], 0x3a4246, { faces: '+y' });
  g.segment([x + 0.2, 0.9, z - len / 2 + 0.2], [x + 0.2, 1.15, z - len / 2 + 0.2], 0.025, 0.025, PAL.steel);
}

export function stool(g: KitGeo, e: Env, x: number, z: number): void {
  g.prism([x, 0.62, z], 0.14, 0.03, e.low ? 5 : 7, SCHOOL.stool);
  g.box([x, 0.31, z], [0.03, 0.62, 0.03], 0x6c777c, { faces: '+x-x+z' });
  if (!e.low) g.prism([x, 0.0, z], 0.16, 0.02, 5, 0x5b6468, { top: true });
}

export function buildLabRoom(ctx: HwKitChunkContext): KitChunk {
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos();
  const lamps: LampSpec[] = [];
  const rng = e.rng;
  const from = e.s0 - e.back;

  flatFloor(floor, e, { color: 0xffffff, x0: -ROOM, x1: ROOM, tex: 1.2, beatV: false });
  const fuv = floorUV(e, 1.2, false);

  // —— 实验台：两侧各两列，每列一张台长 period − 0.6 ——
  for (const s of stepsIn(e, e.period, e.period / 2, 0.2)) {
    for (const x of [-3.9, -2.35, 2.35, 3.9]) {
      if (rng.next() < 0.05) continue;
      bench(stat, e, x, s, e.period - 0.6);
      contactShadow(floor, x, e.z(s), 0.95, e.period - 0.5, fuv, 0xb0b8ba, 0xffffff, 0.2, 0.0015, chunkZ(e));
      for (const dz of [-0.8, 0, 0.8]) if (rng.next() < 0.7) stool(stat, e, x + (x < 0 ? 0.62 : -0.62), e.z(s) + dz + (rng.next() - 0.5) * 0.2);
    }
  }

  // —— 左墙：北向小窗（高、冷、暗）——
  const holesL: Hole[] = sideHoles(e, 'L');
  const wins: Hole[] = [];
  for (let s = e.s0 + e.period / 2; s < e.s1 - 0.3; s += e.period) {
    const w = e.period - 1.2;
    if (s + w / 2 > e.s1 + 1e-6) continue;
    wins.push({ s0: s - w / 2, s1: s + w / 2, y0: 1.5, y1: 3.0 });
  }
  sideWall(stat, e, -1, WALL, [...holesL, ...wins], -ROOM, () => 0, from, e.s1);
  for (const h of wins) {
    windowPane(emi, stat, e, -1, h, NORTH_WINDOW, 0.9, -ROOM);
    lamps.push({ s: (h.s0 + h.s1) / 2, x: -3.5, y: 2.2, kind: 'window', flickerable: false });
  }
  // —— 右墙：玻璃门药品柜，周期表海报 ——
  sideWall(stat, e, 1, WALL, sideHoles(e, 'R'), ROOM, () => 0, from, e.s1);
  for (const s of stepsIn(e, e.period, e.period / 2, 0.5)) {
    if (rng.next() < 0.65) {
      const w = e.period - 1.0, z = e.z(s);
      stat.box([ROOM - 0.22, 1.1, z], [0.44, 2.2, w], 0x6f7a7e, { faces: '-x+y+z-z', bottomShade: 0.7 });
      emi.withSteady(1, () => emi.quad([ROOM - 0.445, 1.25, z - w / 2 + 0.08], [ROOM - 0.445, 1.25, z + w / 2 - 0.08], [ROOM - 0.445, 2.05, z + w / 2 - 0.08], [ROOM - 0.445, 2.05, z - w / 2 + 0.08], 0x2a3439));
      for (let i = 0; i < 6; i++) stat.prism([ROOM - 0.3, 1.26 + (i % 2) * 0.42, z - w / 2 + 0.3 + (i / 6) * (w - 0.5)], 0.04, 0.16, 5, 0x9fb0b8);
    } else wallPaper(stat, e, 1, s, 1.9, 1.0, 0.7, ATLAS.poster, 0, ROOM);
  }

  // —— 天花板与灯（沿 s 两列）——
  ceilingQuad(stat, e, -ROOM, ROOM, H, 0xb3bcc0);
  if (e.back > 0) ceilingBack(stat, e, -ROOM, ROOM, H, 0xb3bcc0);
  for (const s of beatsIn(e, 2, 1, 0.3)) {
    const z = e.z(s);
    for (const x of [-1.6, 1.6]) {
      stat.box([x, H - 0.1, z], [0.2, 0.035, 1.25], 0x8a979e, { faces: '-y+x-x+z-z' });
      emi.box([x, H - 0.14, z], [0.075, 0.045, 1.15], PAL.tube, { faces: '-y+x-x+z-z' });
    }
    lamps.push({ s, x: 0, y: H - 0.14, kind: 'tube', flickerable: true });
  }
  // 通风管（沿右侧）
  stat.box([ROOM - 0.5, H - 0.35, e.z((e.s0 + e.s1) / 2)], [0.35, 0.35, e.L], 0x9aa3a4, { faces: '-y-x+y' });

  mirrorRooms(stat, emi, e);
  dataPlates(stat, e);
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, -ROOM, ROOM, H, 0, WALL, true);
  else if (e.head && ctx.hw?.prev?.kit !== 'labRoom') crossWall(stat, e, e.segS0, -ROOM, ROOM, H, 2.5, WALL);
  if (e.tail && ctx.hw?.next?.kit !== 'labRoom') {
    crossWall(stat, e, e.segS1, -ROOM, ROOM, H, ctx.hw?.next ? 2.5 : 0, WALL, !ctx.hw?.next);
    // 前面的黑板（左半）
    const zf = e.z(e.segS1) + 0.03;
    if (e.segS1 <= e.s1 + 1e-6) {
      const r = ATLAS.board;
      stat.quad([-4.4, 1.0, zf], [-2.0, 1.0, zf], [-2.0, 2.2, zf], [-4.4, 2.2, zf], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    }
  }

  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'tile', params: { n: 2, tile: 0xb9c0c1, grout: 0x7f8b90 } }, hwGloss: 0.2 };
  const out: KitChunk = { floor: f, static: stat.build(), lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

export const labRoomKit: EnvKit = {
  id: 'labRoom', owner: 'WP3', variants: ['default'],
  build: (ctx) => buildLabRoom(ctx as HwKitChunkContext),
  ambience: () => 'labWind',
  reverb: () => 'classroom',
};

registerKit(labRoomKit);
