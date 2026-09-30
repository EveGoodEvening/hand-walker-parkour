// src/render/kits/school/stairs.ts —— 楼梯 kit（DESIGN.md §5.9、§4，WP3）。
// 变体：dayDown（2-1 午饭下楼）、nightDown（3-2 晚自习后数台阶）、stairwellUp（3-8 家属楼楼道，声控灯）、dawnDown（5-2 清晨下楼，灯迟疑）。
// 每拍一级台阶（踏面以拍中心为准，掌根正好落在踏面中间），踏面前沿一道深色防滑条 = 视觉节拍；
// 右侧扶手栏杆每拍一根，左墙上画出栏杆「一节一节」往后退的影子（「像某种被拆开的脊椎」）。
// 楼梯段的地面写深度（§5.8：楼梯段禁止放水洼）。墙裙、天花板都顺着坡度走。
import type { EnvKit, KitChunk, LampSpec } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { HwKitChunkContext } from '../../kitContext';
import { PAL, SCHOOL } from '../../palette';
import {
  CORRIDOR_WALL, DAY_WINDOW, HW, NIGHT_WINDOW, beatsIn, crossWall, dataPlates, geos, makeEnv, mirrorRooms, sideHoles, sideWall,
  stepsIn, type Hole, type WallStyle, type WindowStyle,
} from './shell';

interface Look {
  wall: WallStyle; floorBase: number; nose: number; rail: number; soffit: number;
  lampKind: 'tube' | 'bulb'; lampEvery: number; window: WindowStyle | null; residential: boolean;
}
const SCHOOL_WALL: WallStyle = { ...CORRIDOR_WALL, height: 3.0 };
const RES_WALL: WallStyle = { height: 2.9, baseboard: 0x2f3a3a, baseboardH: 0.08, wainscot: 0x4c5a58, wainscotTop: 1.2, rim: 0x3e4a48, wall: SCHOOL.peel };

const LOOKS: Record<string, Look> = {
  dayDown: { wall: SCHOOL_WALL, floorBase: PAL.terrazzo, nose: SCHOOL.stairNose, rail: SCHOOL.rail, soffit: PAL.ceiling, lampKind: 'tube', lampEvery: 4, window: DAY_WINDOW, residential: false },
  nightDown: { wall: SCHOOL_WALL, floorBase: PAL.terrazzo, nose: SCHOOL.stairNose, rail: SCHOOL.rail, soffit: 0x9aa2a4, lampKind: 'tube', lampEvery: 4, window: NIGHT_WINDOW, residential: false },
  stairwellUp: { wall: RES_WALL, floorBase: SCHOOL.concrete, nose: 0x4a5254, rail: 0x3a4246, soffit: 0x9aa0a0, lampKind: 'bulb', lampEvery: 5, window: null, residential: true },
  dawnDown: { wall: RES_WALL, floorBase: SCHOOL.concrete, nose: 0x4a5254, rail: 0x3a4246, soffit: 0xa3a9a9, lampKind: 'bulb', lampEvery: 5, window: { top: 0x9fb2c0, bottom: 0x7f909a, frame: 0x50606a, horizon: 0x5a6a74 }, residential: true },
};

export function buildStairs(ctx: HwKitChunkContext, look: Look): KitChunk {
  const e = makeEnv(ctx);
  const { floor, stat, emi } = geos();
  const lamps: LampSpec[] = [];
  const rng = e.rng;
  const st = e.stride;
  // 坡线（踏面前沿连线）：floorY 本身就是线性的
  const base = (s: number) => e.fy(s);
  const rise = Math.abs(e.fy(e.s0 + st) - e.fy(e.s0));
  const up = e.fy(e.s0 + st) > e.fy(e.s0);

  // —— 踏面与踢面：拍 k 的踏面覆盖 [k − 0.5, k + 0.5] 拍，高度 = 坡线在 k 处的值 ——
  const k0 = Math.floor((e.s0 - e.back - e.segS0) / st + 0.5), k1 = Math.ceil((e.s1 - e.segS0) / st - 0.5);
  for (let k = k0; k <= k1; k++) {
    const sc = e.segS0 + k * st;
    const a = Math.max(e.s0 - e.back, sc - st / 2), b = Math.min(e.s1, sc + st / 2);
    if (b <= a + 1e-5) continue;
    const y = base(Math.min(Math.max(sc, e.segS0), e.segS1));
    const za = e.z(a), zb = e.z(b);
    const va = (a - e.s0) / st, vb = (b - e.s0) / st;
    floor.quad([-HW, y, za], [HW, y, za], [HW, y, zb], [-HW, y, zb], 0xffffff, [[-1.3, va], [2.3, va], [2.3, vb], [-1.3, vb]], [0.7, 0.7, 1, 1]);
    // 踢面（在 sc + st/2 处，连到下一级）
    const sn = sc + st / 2;
    if (sn <= e.s1 + 1e-6 && sn >= e.s0 - e.back) {
      const yn = base(Math.min(Math.max(sn + st / 2, e.segS0), e.segS1));
      const zn = e.z(sn);
      if (up) floor.quad([-HW, y, zn], [HW, y, zn], [HW, yn, zn], [-HW, yn, zn], 0xe0e4e4, [[-1.3, vb], [2.3, vb], [2.3, vb + 0.2], [-1.3, vb + 0.2]], [0.75, 0.75, 0.9, 0.9]);
      else floor.quad([HW, yn, zn], [-HW, yn, zn], [-HW, y, zn], [HW, y, zn], 0xc9cfcf, [[2.3, vb], [-1.3, vb], [-1.3, vb + 0.2], [2.3, vb + 0.2]], [0.6, 0.6, 0.8, 0.8]);
      // 防滑条：踏面前沿（视觉节拍）
      const zs = e.z(sn - 0.07);
      stat.quad([-HW, y + 0.003, zs], [HW, y + 0.003, zs], [HW, y + 0.003, zn], [-HW, y + 0.003, zn], look.nose);
    }
  }

  // —— 墙：顺坡 ——
  const holesL: Hole[] = sideHoles(e, 'L'), holesR: Hole[] = sideHoles(e, 'R');
  const winHoles: Hole[] = [];
  if (look.window && !look.residential) {
    for (const s of stepsIn(e, e.period * 2, e.period, 0.5)) winHoles.push({ s0: s - 0.9, s1: s + 0.9, y0: 1.3, y1: 2.5 });
  }
  const wallBase = (s: number) => base(s) - (up ? 0 : rise);
  sideWall(stat, e, -1, { ...look.wall, height: look.wall.height + rise }, [...holesL, ...winHoles.map((h) => ({ ...h, y0: h.y0 + rise, y1: h.y1 + rise }))], -HW, wallBase, e.s0 - e.back, e.s1);
  sideWall(stat, e, 1, { ...look.wall, height: look.wall.height + rise }, holesR, HW, wallBase, e.s0 - e.back, e.s1);
  for (const h of winHoles) {
    // 楼梯间的窗（贴左墙，随坡度摆在中间高度）
    const sm = (h.s0 + h.s1) / 2, yb = base(sm);
    const zz0 = e.z(h.s0), zz1 = e.z(h.s1);
    const xg = -HW - 0.14;
    const w = look.window as WindowStyle;
    emi.withSteady(1, () => emi.quad([xg, yb + 1.3, zz0], [xg, yb + 1.3, zz1], [xg, yb + 2.5, zz1], [xg, yb + 2.5, zz0], [w.bottom, w.bottom, w.top, w.top]));
    stat.box([-HW - 0.07, yb + 1.9, (zz0 + zz1) / 2], [0.14, 1.24, 0.05], w.frame, { faces: '+x+z-z' });
  }

  // —— 右侧扶手：栏杆每拍一根 ——
  const xr = HW - 0.3;
  for (const s of beatsIn(e, 1, 0, 0)) {
    const y = base(s), z = e.z(s);
    stat.box([xr, y + 0.45, z], [0.022, 0.9, 0.022], look.rail, { faces: '-x+z-z' });
    // 左墙上的栏杆影子：一格一格往后退（假影子，暗色竖条贴墙）
    const zs = e.z(s + 0.18);
    const ys = y + 0.25;
    stat.quad([-HW + 0.004, ys, zs + 0.03], [-HW + 0.004, ys, zs - 0.03], [-HW + 0.004, ys + 1.0, zs - 0.12], [-HW + 0.004, ys + 1.0, zs - 0.06], 0x3a464d, null, [0.9, 0.9, 1, 1]);
  }
  // 扶手（顺坡的一根方管）
  const ya = base(e.s0 - e.back) + 0.92, yb2 = base(e.s1) + 0.92;
  stat.segment([xr, ya, e.z(e.s0 - e.back)], [xr, yb2, e.z(e.s1)], 0.06, 0.05, look.residential ? 0x2f3a3a : 0x5b6468);
  // 扶手外侧：楼梯井（暗），右墙退到 HW
  // —— 天花板（楼板底面，顺坡）与灯 ——
  const soffit = look.wall.height;
  const z0 = e.z(e.s0 - e.back), z1 = e.z(e.s1);
  stat.quad([-HW, base(e.s0 - e.back) + soffit, z0], [-HW, base(e.s1) + soffit, z1], [HW, base(e.s1) + soffit, z1], [HW, base(e.s0 - e.back) + soffit, z0], look.soffit, null, [0.7, 0.7, 0.7, 0.7]);
  for (const s of beatsIn(e, look.lampEvery, 1, 0.2)) {
    const y = base(s), z = e.z(s);
    if (look.lampKind === 'tube') {
      stat.box([0, y + soffit - 0.03, z], [0.2, 0.04, 1.2], SCHOOL.pipe, { faces: '-y+x-x+z-z' });
      emi.box([0, y + soffit - 0.07, z], [0.075, 0.045, 1.1], PAL.tube, { faces: '-y+x-x+z-z' });
      lamps.push({ s, x: 0, y: y + soffit - 0.07, kind: 'tube', flickerable: true });
    } else {
      // 家属楼：墙上的灯座 + 灯泡（声控）
      stat.box([-HW + 0.05, y + 2.25, z], [0.1, 0.12, 0.12], 0x6f7a7e, { faces: '+x-y+y+z-z' });
      emi.box([-HW + 0.13, y + 2.18, z], [0.07, 0.09, 0.07], 0xe6ebee, { faces: '+x-y+z-z' });
      lamps.push({ s, x: -HW + 0.13, y: y + 2.18, kind: 'bulb', flickerable: true });
      // 电表箱、小广告
      if (rng.next() < 0.5) stat.box([-HW + 0.06, y + 1.6, e.z(s + st * 1.5)], [0.1, 0.5, 0.36], 0x5b6468, { faces: '+x+y-y+z-z', bottomShade: 0.85 });
      if (rng.next() < 0.6) {
        const ss = s + st * (2.5 + rng.next()), yy = base(ss) + 0.8 + rng.next() * 0.8;
        stat.quad([-HW + 0.006, yy, e.z(ss - 0.08)], [-HW + 0.006, yy, e.z(ss + 0.08)], [-HW + 0.006, yy + 0.22, e.z(ss + 0.08)], [-HW + 0.006, yy + 0.22, e.z(ss - 0.08)], 0xdfe3e2, null, [0.9, 0.9, 1, 1]);
      }
    }
  }

  mirrorRooms(stat, emi, e);
  dataPlates(stat, e);
  if (e.back > 0) crossWall(stat, e, e.segS0 - e.back, -HW, HW, look.wall.height, 0, look.wall, true);
  if (e.tail && !ctx.hw?.next) crossWall(stat, e, e.segS1, -HW, HW, look.wall.height, 0, look.wall, true);

  const f = floor.build();
  f.userData = { hwFloorMap: { id: 'terrazzo', params: { base: look.floorBase, density: look.residential ? 0.3 : 1 } }, hwDepthWrite: true, hwGloss: look.residential ? 0 : 0.12 };
  const out: KitChunk = { floor: f, static: stat.build(), lamps };
  if (emi.vertexCount) out.emissive = emi.build({ steady: true, uv: false });
  return out;
}

export const stairsKit: EnvKit = {
  id: 'stairs', owner: 'WP3', variants: ['dayDown', 'nightDown', 'stairwellUp', 'dawnDown'],
  build: (ctx) => buildStairs(ctx as HwKitChunkContext, LOOKS[ctx.variant] ?? (LOOKS.dayDown as Look)),
  ambience: (v) => (v === 'nightDown' ? 'nightCorridor' : v === 'stairwellUp' ? 'home' : v === 'dawnDown' ? 'dawnStreet' : 'room'),
  reverb: () => 'stairwell',
};

registerKit(stairsKit);
