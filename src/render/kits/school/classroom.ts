// src/render/kits/school/classroom.ts —— 教室 kit（DESIGN.md §5.9、§4.1 1-1，WP3）。
// 变体：morning（晨光从左侧大窗进来）、night（窗外全黑，只有灯管）。
// 玩家沿中间过道爬行（三条车道都在过道里），两侧是一排排课桌椅（腿的森林的一部分；坐着的同学由 WP6 画）。
// 右墙：后黑板、公告栏；左墙：大窗、蓝灰窗帘、窗下暖气。段尾（下一段不是教室时）：前墙在段尾前 3.4 m，
// 中间一个走廊截面大小的门洞，门洞后是一小段门厅（墙回到 ±1.8，关卡的门牌「高二（7）班」挂在这里）。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { KitGeo } from '../../geom';
import { markSchoolAtlas, type HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import { ATLAS } from '../../textures/school';
import {
  CORRIDOR_WALL, DAY_WINDOW, HW, NIGHT_LIFT, NIGHT_WINDOW, beatsIn, brassStrips, chunkZ, contactShadow, floorUV, ceilingBack, ceilingQuad, crossWall, dataPlates, flatFloor, geos,
  makeEnv, mirrorRooms, noticeBoard, radiator, sideHoles, sideWall, stepsIn, wallPaper, windowPane, type Env, type Hole, type WallStyle, type WindowStyle,
} from './shell';

const ROOM = 4.6;          // 教室半宽
const H = 3.3;
const VESTIBULE = 3.4;     // 门厅长度
const DAY_WALL: WallStyle = { ...CORRIDOR_WALL, height: H };
const NIGHT_WALL: WallStyle = { ...DAY_WALL, lift: NIGHT_LIFT };

interface Look { windows: WindowStyle; curtain: number; night: boolean }
const LOOKS: Record<string, Look> = {
  morning: { windows: DAY_WINDOW, curtain: 0x50606a, night: false },
  night: { windows: NIGHT_WINDOW, curtain: 0x2a3136, night: true },
};

/** 一张课桌（桌面、桌肚、四条腿、脚踏横档），面朝 −z；low 时省掉看不见的面。 */
export function desk(g: KitGeo, e: Env, x: number, z: number, books: number, bag: boolean): void {
  const lo = e.low;
  g.box([x, 0.76, z], [0.6, 0.03, 0.44], PAL.deskTop, { faces: lo ? '+y+z-y' : '+y+z-y+x-x-z' });
  g.box([x, 0.66, z - 0.02], [0.56, 0.14, 0.38], 0x4a5357, { faces: lo ? '+z-y' : '+z-y+x-x' });
  const lf = lo ? '+z+x-x' : '+z+x-x-z';
  for (const dx of [-0.27, 0.27]) for (const dz of [-0.19, 0.19]) g.box([x + dx, 0.37, z + dz], [0.028, 0.74, 0.028], PAL.deskLeg, { faces: lf });
  if (!lo) g.box([x, 0.1, z + 0.19], [0.54, 0.025, 0.025], PAL.deskLeg, { faces: '+z+y' });
  // 摞高的书
  let y = 0.775;
  for (let i = 0; i < books; i++) {
    const h = 0.03 + (i % 3) * 0.012;
    const c = [0xd9dee3, 0x9fb0b8, 0xb7bdbb, 0x7e8a8f][(((i + Math.round(x * 7)) % 4) + 4) % 4] as number;
    g.box([x + 0.12 - (i % 2) * 0.03, y + h / 2, z - 0.05 + (i % 2) * 0.02], [0.22, h, 0.28], c, { faces: '+y+z+x-x' });
    y += h;
  }
  if (bag) g.box([x - 0.33, 0.55, z + 0.1], [0.06, 0.3, 0.26], PAL.bag, { faces: '+z+x-x+y', bottomShade: 0.8 });
}

/** 椅子：在课桌后方（+z 一侧），座面、靠背、四条腿。 */
export function chair(g: KitGeo, e: Env, x: number, z: number, pushed: number): void {
  const zc = z + 0.42 + pushed;
  g.box([x, 0.44, zc], [0.38, 0.025, 0.36], 0x8f9a9c, { faces: e.low ? '+y+z' : '+y+z-y' });
  g.box([x, 0.82, zc + 0.17], [0.38, 0.22, 0.02], 0x8f9a9c, { faces: '+z-z' });
  const lf = e.low ? '+z+x' : '+z+x-x';
  for (const dx of [-0.17, 0.17]) {
    g.box([x + dx, 0.22, zc - 0.16], [0.022, 0.44, 0.022], PAL.deskLeg, { faces: lf });
    g.box([x + dx, 0.47, zc + 0.17], [0.022, 0.94, 0.022], PAL.deskLeg, { faces: lf });
  }
}

export function buildClassroom(ctx: HwKitChunkContext, look: Look): KitChunk {
  const WALL = look.night ? NIGHT_WALL : DAY_WALL;
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos(WALL.lift ?? 1);
  const lamps: LampSpec[] = [];
  const rng = e.rng;
  const hw = ctx.hw;
  const hasVestibule = !!hw && !e.generic && hw.next?.kit !== 'classroom';
  const frontS = hasVestibule ? e.segS1 - VESTIBULE : e.segS1 + 100;
  const roomEnd = Math.min(e.s1, frontS);
  const roomFrom = e.s0 - e.back;

  // —— 地面（整间教室宽）——
  flatFloor(floor, e, { color: 0xf2f4f4, x0: -ROOM, x1: ROOM });
  const fuv = floorUV(e);
  brassStrips(stat, e, PAL.brass, -HW, HW);

  // —— 课桌椅：每行约 1.33 m（整除 chunk），两侧各两对同桌（车道外沿 1.32 m 以外）——
  if (roomEnd > e.s0 + 0.5) {
    const rows = stepsIn(e, e.period / Math.max(1, Math.round(e.period / 1.33)), 0.7, 0.25);
    for (const s of rows) {
      if (s > roomEnd - 0.9) continue;
      const z = e.z(s);
      for (const side of [-1, 1] as const) {
        for (const x of e.low ? [1.78, 2.42, 3.5] : [1.78, 2.42, 3.5, 4.12]) {
          if (rng.next() < 0.06) continue;
          const xx = side * x + (rng.next() - 0.5) * 0.05;
          desk(stat, e, xx, z + (rng.next() - 0.5) * 0.06, rng.next() < 0.55 ? 1 + rng.int(4) : 0, rng.next() < 0.3);
          chair(stat, e, xx + (rng.next() - 0.5) * 0.06, z, rng.next() * 0.12);
          contactShadow(floor, xx, z + 0.18, 0.56, 0.85, fuv, 0xb4bcbe, 0xf2f4f4, 0.14, 0.0015, chunkZ(e));
        }
      }
    }
  }

  // —— 左墙：大窗、窗帘、暖气 ——
  const winHoles: Hole[] = [];
  for (let s = e.s0 + e.period / 2; s < roomEnd - 0.5; s += e.period) {
    const w = e.period - 0.8;
    if (s - w / 2 < roomFrom || s + w / 2 > roomEnd) continue;
    winHoles.push({ s0: s - w / 2, s1: s + w / 2, y0: 0.9, y1: 2.95 });
  }
  const lWall = (holes: Hole[], a: number, b: number) => sideWall(stat, e, -1, WALL, holes, -ROOM, () => 0, a, b);
  const rWall = (holes: Hole[], a: number, b: number) => sideWall(stat, e, 1, WALL, holes, ROOM, () => 0, a, b);
  if (roomEnd > roomFrom) { lWall(winHoles, roomFrom, roomEnd); }
  for (const h of winHoles) {
    windowPane(emi, stat, e, -1, h, look.windows, 1.1, -ROOM);
    radiator(stat, e, -1, (h.s0 + h.s1) / 2, 1.2, -ROOM);
    // 窗帘：在窗两侧收成一束（蓝灰）
    for (const [sEdge, dir] of [[h.s0, 1], [h.s1, -1]] as const) {
      stat.box([-ROOM + 0.12, 1.95, e.z(sEdge + dir * 0.18)], [0.1, 2.1, 0.34], look.curtain, { faces: '+x+z-z', bottomShade: 0.8 });
    }
    stat.box([-ROOM + 0.06, h.y0 - 0.02, e.z((h.s0 + h.s1) / 2)], [0.2, 0.04, h.s1 - h.s0 + 0.1], 0xc3c9c9, { faces: '+y+x' });
    if (!look.night) lamps.push({ s: (h.s0 + h.s1) / 2, x: -2.5, y: 2, kind: 'window', flickerable: false });
  }
  // 右墙：后黑板（段首）、公告栏
  if (roomEnd > roomFrom) rWall([], roomFrom, roomEnd);
  for (const s of stepsIn(e, e.period * 2, e.period, 0.8)) {
    if (s > roomEnd - 1.2) continue;
    if (rng.next() < 0.6) noticeBoard(stat, e, 1, s, 1.6, ROOM);
  }
  if (e.head) {
    // 后黑板（黑板报）：贴在右墙靠段首处
    const s = e.segS0 + 1.6;
    if (s < roomEnd) {
      const x = ROOM - 0.02, za = e.z(s - 1.4), zb = e.z(s + 1.4);
      stat.box([x, 1.55, (za + zb) / 2], [0.04, 1.3, 2.9], 0x5b6468, { faces: '-x+y-y+z-z' });
      const r = ATLAS.board;
      stat.quad([x - 0.021, 0.95, zb], [x - 0.021, 0.95, za], [x - 0.021, 2.15, za], [x - 0.021, 2.15, zb], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    }
  }
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, -ROOM, ROOM, H, 0, WALL, true);
  else if (e.head && hw && hw.prev?.kit !== 'classroom') crossWall(stat, e, e.segS0, -ROOM, ROOM, H, 2.5, WALL);

  // —— 天花板与灯：灯管横着挂，每 2 拍一排（三支）——
  if (roomEnd > e.s0) ceilingQuadRange(stat, e, -ROOM, ROOM, H, roomFrom, roomEnd);
  if (e.back > 0) ceilingBack(stat, e, -ROOM, ROOM, H, PAL.ceiling);
  for (const s of beatsIn(e, 2, 1, 0.3)) {
    if (s > roomEnd - 0.3) continue;
    const z = e.z(s);
    for (const x of [-2.6, 0, 2.6]) {
      stat.box([x, H - 0.1, z], [1.3, 0.035, 0.2], SCHOOL.pipe, { faces: '-y+z-z+x-x' });
      emi.box([x, H - 0.14, z], [1.2, 0.045, 0.075], PAL.tube, { faces: '-y+z-z+x-x' });
    }
    lamps.push({ s, x: 0, y: H - 0.14, kind: 'tube', flickerable: true });
  }

  // —— 前墙与门厅（段尾）——
  if (hasVestibule && frontS < e.s1 + 1e-6 && frontS > e.s0 - VESTIBULE) {
    if (frontS >= e.s0 - 1e-6) {
      crossWall(stat, e, frontS, -ROOM, ROOM, H, 2.5, WALL);
      // 前黑板（左）与讲台（右）
      const zf = e.z(frontS) + 0.025;
      stat.box([-3.1, 1.6, zf], [2.4, 1.25, 0.05], 0x4a5357, { faces: '+z+y-y+x-x' });
      const r = ATLAS.board;
      stat.quad([-4.2, 1.02, zf + 0.026], [-2.0, 1.02, zf + 0.026], [-2.0, 2.18, zf + 0.026], [-4.2, 2.18, zf + 0.026], 0xffffff, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
      stat.box([-3.1, 0.95, zf + 0.06], [2.3, 0.03, 0.1], 0x8a979e, { faces: '+y+z' });
      stat.box([3.1, 0.5, zf + 0.5], [1.4, 1.0, 0.7], 0x6f7a7e, { faces: '+z+y-x+x', bottomShade: 0.75 });
    }
    // 门厅：墙回到 ±1.8，一小段天花板
    const a = Math.max(e.s0, frontS), b = e.s1;
    if (b > a + 0.01) {
      sideWall(stat, e, -1, WALL, [], -HW, () => 0, a, b);
      sideWall(stat, e, 1, WALL, [], HW, () => 0, a, b);
      ceilingQuadRange(stat, e, -HW, HW, 3.1, a, b);
    }
  }
  if (e.tail && !hw?.next) crossWall(stat, e, e.segS1, -ROOM, ROOM, H, 0, WALL, true);

  // —— 开口、门牌 ——
  // 教室里的侧墙开口（少见）：在 ±1.8 处立一小段隔墙承托镜子
  for (const side of ['L', 'R'] as const) {
    for (const h of sideHoles(e, side)) {
      const sd: -1 | 1 = side === 'L' ? -1 : 1;
      sideWall(stat, e, sd, WALL, [h], sd * HW, () => 0, Math.max(e.s0, h.s0 - 0.4), Math.min(e.s1, h.s1 + 0.4));
    }
  }
  mirrorRooms(stat, emi, e);
  dataPlates(stat, e);
  if (e.head) wallPaper(stat, e, 1, e.segS0 + 3.6, 1.55, 0.3, 0.42, ATLAS.roster, 0.02, ROOM);

  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'terrazzo', params: { base: PAL.terrazzo } }, hwGloss: 0.18 };
  const out: KitChunk = { floor: f, static: markSchoolAtlas(stat.build()), lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

/** 一段 [a, b] 的天花板（贴图集 ceiling）。 */
function ceilingQuadRange(g: KitGeo, e: Env, x0: number, x1: number, y: number, a: number, b: number): void {
  const sub: Env = { ...e, s0: Math.max(e.s0, a), s1: Math.min(e.s1, b) };
  if (sub.s1 <= sub.s0 + 1e-3) return;
  ceilingQuad(g, { ...sub, z: e.z }, x0, x1, y, PAL.ceiling);
}

export const classroomKit: EnvKit = {
  id: 'classroom', owner: 'WP3', variants: ['morning', 'night'],
  build: (ctx) => buildClassroom(ctx as HwKitChunkContext, LOOKS[ctx.variant] ?? (LOOKS.morning as Look)),
  ambience: (v) => (v === 'night' ? 'nightCorridor' : 'reading'),
  reverb: () => 'classroom',
};

registerKit(classroomKit);
