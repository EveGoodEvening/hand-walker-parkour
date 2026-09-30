// src/render/kits/school/washroom.ts —— 厕所 kit（DESIGN.md §5.9、§4.1 1-3、§4.5 5-4，WP3）。
// 变体：morning（1-3 早晨；5-4 用同一个变体配 overcast 氛围）。
// 地面小方砖（湿，反光较强）；墙面下半截白瓷砖、上半截灰泥；天花板低（2.8 m）。
// 左墙：洗手池一排（挂墙的白瓷盆 + 水龙头），关卡数据里的镜子在这面墙上开洞（镜中房间）；没有镜子的地方是小便池。
// 右墙：一排隔间（隔板 + 门），门大多向里开着；「最后一格坏锁的门」是 WP6 的障碍，画面上不重复画。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { KitGeo } from '../../geom';
import type { HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import {
  CORRIDOR_WALL, HW, ceilingBack, ceilingQuad, crossWall, dataPlates, endWalls, flatFloor, floorBlob, geos, makeEnv, mirrorRooms, sideHoles,
  sideWall, stepsIn, tubes, type Env, type Hole, type WallStyle,
} from './shell';

const H = 2.8;
const STALL_DEPTH = 1.35;
const WALL: WallStyle = { ...CORRIDOR_WALL, height: H, tileTop: 1.62, tileColor: 0xe6ebee, wall: 0xc3cacb, rim: 0x9aa3a4 };

function sink(g: KitGeo, e: Env, s: number): void {
  const z = e.z(s), x = -HW + 0.24;
  g.box([x, 0.8, z], [0.42, 0.14, 0.5], SCHOOL.porcelain, { faces: '+x+y-y+z-z', bottomShade: 0.85 });
  g.box([x + 0.02, 0.875, z], [0.3, 0.01, 0.36], 0xb9c3c6, { faces: '+y' });           // 盆里的阴影
  g.box([-HW + 0.06, 0.95, z], [0.05, 0.06, 0.06], PAL.steel, { faces: '+x+y+z-z' });   // 龙头
  g.box([-HW + 0.12, 0.93, z], [0.1, 0.02, 0.02], PAL.steel, { faces: '+y-y+z-z+x' });
  if (!e.low) g.box([-HW + 0.1, 0.4, z], [0.04, 0.72, 0.04], PAL.steel, { faces: '+x+z-z' }); // 下水管
}

function urinal(g: KitGeo, e: Env, s: number): void {
  const z = e.z(s), x = -HW + 0.17;
  g.box([x, 0.75, z], [0.3, 0.7, 0.4], SCHOOL.porcelain, { faces: '+x+y-y+z-z', bottomShade: 0.9 });
  g.box([x + 0.09, 0.7, z], [0.13, 0.5, 0.3], 0xb9c3c6, { faces: '+x' });
}

/** 右侧一格隔间：前板（门）在 x = HW，隔板伸向 x = HW + STALL_DEPTH，隔间里有后墙与蹲坑。 */
function stall(g: KitGeo, e: Env, s: number, w: number, open: number): void {
  const za = e.z(s - w / 2), zb = e.z(s + w / 2);
  const xb = HW + STALL_DEPTH;
  // 隔板（在 s − w/2 处，离地 0.15 到 1.95）
  g.box([HW + STALL_DEPTH / 2, 1.05, za], [STALL_DEPTH, 1.8, 0.03], SCHOOL.stall, { faces: '-x+z-z', bottomShade: 0.85 });
  g.box([HW + 0.02, 1.05, za], [0.05, 1.8, 0.05], SCHOOL.stallDark, { faces: '-x+z-z' });
  // 门：绕 s + w/2 处的铰链向隔间里开 open × 80°
  const ang = open * (80 * Math.PI / 180);
  const hx = HW, hz = zb;
  const ex = hx + Math.sin(ang) * (w - 0.06), ez = hz + Math.cos(ang) * (w - 0.06);
  g.quad([ex, 0.15, ez], [hx, 0.15, hz], [hx, 1.95, hz], [ex, 1.95, ez], SCHOOL.stallDark, null, [0.8, 0.8, 1, 1]);
  g.quad([hx, 0.15, hz], [ex, 0.15, ez], [ex, 1.95, ez], [hx, 1.95, hz], SCHOOL.stall, null, [0.8, 0.8, 1, 1]);
  // 隔间内：地、后墙、蹲坑
  // 隔间里的地与后墙（彼此多搭 5 cm，接缝处不漏背景色）
  g.quad([HW - 0.05, 0.001, za + 0.05], [xb + 0.05, 0.001, za + 0.05], [xb + 0.05, 0.001, zb - 0.05], [HW - 0.05, 0.001, zb - 0.05], 0xb9c1c2);
  g.quad([xb, -0.06, zb - 0.05], [xb, -0.06, za + 0.05], [xb, H, za + 0.05], [xb, H, zb - 0.05], 0xd5dbdc, null, [0.7, 0.7, 0.9, 0.9]);
  g.box([HW + STALL_DEPTH * 0.6, 0.01, (za + zb) / 2], [0.36, 0.02, 0.26], 0x8a979e, { faces: '+y' });
  if (!e.low) g.box([xb - 0.1, 1.9, (za + zb) / 2], [0.2, 0.35, 0.22], SCHOOL.porcelain, { faces: '-x+y-y+z-z' }); // 水箱
  // 隔板顶上的横梁（连到下一格）
  g.box([HW + 0.02, 1.97, (za + zb) / 2], [0.05, 0.04, w], SCHOOL.stallDark, { faces: '-x+y-y' });
}

export function buildWashroom(ctx: HwKitChunkContext): KitChunk {
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos();
  const lamps: LampSpec[] = [];
  const rng = e.rng;

  // 地面：0.3 m 小方砖（纹理 4 × 4 块 = 1.2 m），湿，反光
  flatFloor(floor, e, { color: 0xffffff, tex: 1.2, beatV: false });
  for (let i = 0; i < 3; i++) floorBlob(floor, e, (rng.next() - 0.5) * 2.6, e.s0 + 1 + rng.next() * (e.L - 2), 0.4 + rng.next() * 0.6, 0.8 + rng.next() * 1.8, 0xa9b4ba, rng.next(), 0xffffff);
  for (const s of stepsIn(e, e.period * 2, e.period, 0.5)) stat.box([0, 0.003, e.z(s)], [0.16, 0.004, 0.16], 0x6e7c82, { faces: '+y' }); // 地漏

  // 左墙：洗手池（镜子下面也有）、小便池（没有镜子的地方）
  const holesL: Hole[] = sideHoles(e, 'L');
  sideWall(stat, e, -1, WALL, holesL, -HW, () => 0, e.s0 - e.back, e.s1);
  const mirrorAt = (s: number) => holesL.some((h) => s > h.s0 - 0.3 && s < h.s1 + 0.3);
  for (const s of stepsIn(e, e.period / 2, e.period / 4, 0.4)) {
    if (mirrorAt(s)) sink(stat, e, s);
    else if (rng.next() < 0.5) urinal(stat, e, s);
  }
  for (const h of holesL) {
    // 镜框：一圈窄不锈钢
    const za = e.z(Math.max(h.s0, e.s0)), zb = e.z(Math.min(h.s1, e.s1));
    stat.box([-HW + 0.01, h.y0 - 0.015, (za + zb) / 2], [0.03, 0.03, za - zb], PAL.steel, { faces: '+x+y' });
    stat.box([-HW + 0.01, h.y1 + 0.015, (za + zb) / 2], [0.03, 0.03, za - zb], PAL.steel, { faces: '+x-y' });
    if (h.s0 >= e.s0) stat.box([-HW + 0.01, (h.y0 + h.y1) / 2, za], [0.03, h.y1 - h.y0, 0.03], PAL.steel, { faces: '+x+z-z' });
    if (h.s1 <= e.s1) stat.box([-HW + 0.01, (h.y0 + h.y1) / 2, zb], [0.03, h.y1 - h.y0, 0.03], PAL.steel, { faces: '+x+z-z' });
  }

  // 右墙：隔间（段首、段尾 2 m 留白墙）
  const holesR = sideHoles(e, 'R');
  const stallW = e.period / Math.max(1, Math.round(e.period / 1.2));
  const stallFrom = e.segS0 + 2, stallTo = e.segS1 - 2;
  const plain: Array<[number, number]> = [];
  let cursor = e.s0 - e.back;
  for (let s = e.s0 + stallW / 2; s < e.s1; s += stallW) {
    const a = s - stallW / 2, b = s + stallW / 2;
    if (a < stallFrom || b > stallTo || holesR.some((h) => h.s0 < b && h.s1 > a) || b > e.s1 + 1e-6) continue;
    if (a > cursor) plain.push([cursor, a]);
    stall(stat, e, s, stallW, rng.next() < 0.75 ? 0.35 + rng.next() * 0.6 : 0.05);
    cursor = b;
  }
  if (cursor < e.s1) plain.push([cursor, e.s1]);
  for (const [a, b] of plain) sideWall(stat, e, 1, WALL, holesR, HW, () => 0, a, b);

  // 天花板、灯、通风口
  ceilingQuad(stat, e, -HW, HW, H, 0xc3cacb);
  // 隔间上方的天花板（到隔间后墙）
  const zA = e.z(e.s0), zB = e.z(e.s1);
  stat.quad([HW, H, zA], [HW, H, zB], [HW + STALL_DEPTH, H, zB], [HW + STALL_DEPTH, H, zA], 0xc3cacb, null, [0.7, 0.7, 0.6, 0.6]);
  if (e.back > 0) ceilingBack(stat, e, -HW, HW, H, 0xc3cacb);
  tubes(emi, stat, e, lamps, { y: H - 0.08, every: 2, offset: 1 });
  for (const s of stepsIn(e, e.period * 2, e.period * 1.5, 0.5)) stat.box([-0.9, H - 0.01, e.z(s)], [0.4, 0.02, 0.4], 0x8a979e, { faces: '-y' });

  mirrorRooms(stat, emi, e);
  endWalls(stat, e, WALL, undefined, undefined, emi);
  dataPlates(stat, e);
  // 段首：从走廊拐进来，门框 + 门上方的墙（走廊比这里高）；章首：身后一面实墙
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, -HW, HW, 3.2, 0, WALL, true);
  else if (e.head && ctx.hw?.prev?.kit !== 'washroom') crossWall(stat, e, e.segS0, -HW, HW, 3.2, 2.3, WALL);
  if (e.tail && ctx.hw?.next?.kit !== 'washroom') crossWall(stat, e, e.segS1, -HW, HW, 3.2, ctx.hw?.next ? 2.3 : 0, WALL, !ctx.hw?.next);

  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'tile', params: { n: 4, tile: 0xd5dbdc, grout: 0x9aa3a4 } }, hwGloss: 0.55 };
  const out: KitChunk = { floor: f, static: stat.build(), lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

export const washroomKit: EnvKit = {
  id: 'washroom', owner: 'WP3', variants: ['morning'],
  build: (ctx) => buildWashroom(ctx as HwKitChunkContext),
  ambience: () => 'room',
  reverb: () => 'washroom',
};

registerKit(washroomKit);
