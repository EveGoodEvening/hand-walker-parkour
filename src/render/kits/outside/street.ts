// src/render/kits/outside/street.ts —— 街道 kit（DESIGN.md §4.3、§4.5、§5.9、§8.10 WP4）。
// 变体：schoolGate 校门与铁栅栏（3-3）；alley 湿柏油、车棚、坏了一半的路灯（3-4）；shopStreet 卷帘门与手掌涂鸦（3-6）；
//       compound 门卫室与会扫红光的电子栏杆（3-7）；dawn 梧桐、湿落叶、停着的汽车（5-3）。
// 位置相关的陈设按关卡数据摆：校门立柱跟着 gateBar 障碍；车棚跟着 shedRoof 环境声 / bikeRack 障碍；
// 涂鸦跟着 id 为 graffitiHand 的事件；门卫室跟着 barrierArm 障碍；公交站在段尾。数据里找不到时按 §4 的拍号回落。
// 暖色（§5.1）：第三章的路灯头与地上的「路灯碎金」、compound 的栏杆红灯；第五章（dawn）一律冷色，栏杆灯不亮。
// 电子栏杆的红光扫动由 weather/outdoor.ts 的 ViewSystem 画（1 次 draw call，只在附近时可见）。
import type { AmbienceId, ReverbId } from '../../../core/types';
import type { EnvKit, KitChunk, KitChunkContext } from '../../../core/contracts';
import { registerKit } from '../../../core/registry';
import type { CompiledSegment, EventBody } from '../../../levels/schema';
import { C, mix, shade } from './lib/colors';
import { keyRng } from './lib/geo';
import { ChunkWork, HALF, openingPanels, wallWithOpenings, type SideKey } from './lib/kit';
import { bike, facades, fenceAcross, fenceAlongS, lampReflection, parkedCar, streetLamp, tree } from './lib/props';

export const STREET_VARIANTS = ['schoolGate', 'alley', 'shopStreet', 'compound', 'dawn'] as const;
export type StreetVariant = (typeof STREET_VARIANTS)[number];

// ——————————————————— 关卡数据里的锚点（纯函数，单元测试也用）———————————————————

/** 某类障碍在段内的里程范围 [最小 s0, 最大 s1]；没有返回 null。 */
export function obstacleSpan(seg: CompiledSegment, kinds: readonly string[]): [number, number] | null {
  let a = Infinity, b = -Infinity;
  for (const o of seg.obstacles) if (kinds.includes(o.kind)) { a = Math.min(a, o.s0); b = Math.max(b, o.s1); }
  return a <= b ? [a, b] : null;
}
/** 某类障碍的全部起点（升序）。 */
export function obstacleStarts(seg: CompiledSegment, kind: string): number[] {
  return seg.obstacles.filter((o) => o.kind === kind).map((o) => o.s0).sort((x, y) => x - y);
}
/** 按 id 找事件的拍号（包括 stop / slow 时间线里的，按父事件的拍号计）。 */
export function eventBeat(seg: CompiledSegment, id: string): number | null {
  for (const e of seg.events) {
    if (e.id === id) return e.at;
    const tl = (e.body as { timeline?: Array<{ id?: string }> }).timeline;
    if (tl?.some((t) => t.id === id)) return e.at;
  }
  return null;
}
/** 环境声 amb 从哪一拍开始、到下一次 ambience 事件为止（拍）。 */
export function ambienceSpan(seg: CompiledSegment, amb: string): [number, number] | null {
  const evs = seg.events.filter((e) => e.body.type === 'ambience') as Array<{ at: number; body: Extract<EventBody, { type: 'ambience' }> }>;
  const i = evs.findIndex((e) => e.body.amb === amb);
  if (i < 0) return null;
  const a = evs[i] as { at: number };
  const next = evs[i + 1];
  const beats = (seg.s1 - seg.s0) / Math.max(1e-6, seg.stride);
  return [a.at, next ? next.at : beats];
}

/** 车棚的里程范围：shedRoof 环境声 → bikeRack 障碍 → §4.3 的 @40–80。 */
export function shedSpan(seg: CompiledSegment): [number, number] {
  const st = seg.stride;
  const amb = ambienceSpan(seg, 'shedRoof');
  if (amb) return [seg.s0 + amb[0] * st, seg.s0 + amb[1] * st];
  const racks = obstacleSpan(seg, ['bikeRack']);
  if (racks) return [racks[0] - 4, racks[1] + 4];
  return [seg.s0 + 40 * st, seg.s0 + 80 * st];
}
/** 涂鸦中心：id = graffitiHand 的事件 → §4.3 的 @64（@60–72）。 */
export function graffitiCenter(seg: CompiledSegment): number {
  const b = eventBeat(seg, 'graffitiHand');
  return seg.s0 + (b ?? 64) * seg.stride + 2 * seg.stride;
}
/** 校门：gateBar 障碍（§4.3 @36、@42）；返回 [第一道的 s, 最后一道的 s]。 */
export function gateSpan(seg: CompiledSegment): [number, number] {
  const g = obstacleStarts(seg, 'gateBar');
  if (g.length) return [g[0] as number, g[g.length - 1] as number];
  return [seg.s0 + 36 * seg.stride, seg.s0 + 42 * seg.stride];
}
/** 电子栏杆：barrierArm 障碍（3-7 @18、5-3 @10）。 */
export function barrierS(seg: CompiledSegment, fallbackBeat: number): number {
  const b = obstacleStarts(seg, 'barrierArm');
  return b.length ? (b[0] as number) : seg.s0 + fallbackBeat * seg.stride;
}

// ——————————————————— 公用：地面 ———————————————————

/** 人行道地砖：接缝每拍一道（视觉节拍，§5.9），纵缝 0.5 m。只画 [sa, sb]（缺省整个 chunk）。 */
function paverFloor(w: ChunkWork, xa: number, xb: number, base: number, joint: number, vary: number, sa = w.s0, sb = w.s1): void {
  const rng = keyRng(w.segId, 'paver', Math.round(sa * 10), xa);
  const cell = w.q === 0 ? 1.0 : 0.5;
  const stride = w.ctx.stride;
  const s0 = w.ctx.seg.s0;
  const k0 = Math.floor((sa - s0) / stride);
  for (let k = k0; s0 + k * stride < sb; k++) {
    const a = Math.max(sa, s0 + k * stride), b = Math.min(sb, s0 + (k + 1) * stride);
    if (b - a < 1e-4) continue;
    for (let x = xa; x < xb - 1e-6; x += cell) {
      const x1 = Math.min(xb, x + cell);
      w.floor.flat(0, x, x1, w.z(a), w.z(b), mix(base, rng.next() < 0.5 ? shade(base, 1.12) : shade(base, 0.88), rng.next() * vary));
    }
    const sj = s0 + k * stride;
    if (sj >= sa - 1e-6 && sj < sb) { const zz = w.z(sj); w.floor.flat(0.001, xa, xb, zz + 0.015, zz - 0.015, joint); }
  }
  if (w.q > 0) for (let x = xa + 0.5; x < xb - 0.1; x += 0.5) w.floor.flat(0.001, x - 0.01, x + 0.01, w.z(sa), w.z(sb), joint);
}

/** 湿柏油：大块深浅斑 + 裂缝 + 井盖。 */
function asphaltFloor(w: ChunkWork, xa: number, xb: number, base: number, wet: number): void {
  const rng = keyRng(w.segId, 'asph', Math.round(w.s0 * 10));
  w.floor.flat(0, xa, xb, 0, -w.L, base);
  const n = 6 + w.q * 6;
  for (let i = 0; i < n; i++) {
    const cx = xa + rng.next() * (xb - xa), cs = rng.next() * w.L;
    const rw = 0.3 + rng.next() * 1.2, rl = 0.4 + rng.next() * 1.8;
    const col = rng.next() < 0.6 ? wet : shade(base, 1.1);
    const x0 = Math.max(xa, cx - rw), x1 = Math.min(xb, cx + rw);
    const z0 = Math.min(0, -cs + rl), z1 = Math.max(-w.L, -cs - rl);
    if (x1 > x0 && z0 > z1) w.floor.face([x0, 0.001, z0], [x1, 0.001, z0 - 0.1], [x1 - 0.1, 0.001, z1], [x0 + 0.05, 0.001, z1 + 0.08], col, [0, 1, 0]);
  }
  // 裂缝
  const cracks = 2 + w.q * 2;
  for (let i = 0; i < cracks; i++) {
    let x = xa + rng.next() * (xb - xa), s = rng.next() * w.L;
    for (let j = 0; j < 4; j++) {
      const nx = Math.max(xa, Math.min(xb, x + (rng.next() * 2 - 1) * 0.4)), ns = Math.min(w.L, s + 0.2 + rng.next() * 0.5);
      w.floor.segment([x, 0.002, -s], [nx, 0.002, -ns], 0.02, 0.001, shade(base, 0.6));
      x = nx; s = ns;
    }
  }
}

/** 路沿：浅色一条（地面层），外侧是低一点的路面（仍在地面层，不写深度）。 */
function curbAndRoad(w: ChunkWork, xCurb: number, roadTo: number, roadColor: number, curbColor: number, laneLine: number | null): void {
  w.floor.flat(0.001, xCurb, xCurb + 0.18, 0, -w.L, curbColor);
  w.floor.flat(-0.02, xCurb + 0.18, roadTo, 0, -w.L, roadColor);
  if (laneLine !== null) {
    // 路中间的虚线（冷白），每 6 m 一段 3 m
    w.grid(6, 0, (s) => {
      const z = w.z(s);
      w.floor.flat(-0.019, (xCurb + roadTo) / 2 - 0.06, (xCurb + roadTo) / 2 + 0.06, z, Math.max(-w.L, z - 3), laneLine);
    });
  }
}

/** 某侧开口所需的墙板（没有连续墙的一侧）。 */
function panelsIfAny(w: ChunkWork, side: SideKey, room: 'dark' | 'nightStreet', panel: number): void {
  if (w.openings(side).length) openingPanels(w, side, room, panel, shade(panel, 0.7));
}

// ——————————————————— 变体 ———————————————————

function schoolGate(w: ChunkWork): void {
  const seg = w.ctx.seg;
  const [gA, gB] = gateSpan(seg);
  const gate0 = gA - 0.8, gate1 = gB + 0.8;
  const inside = (s: number) => s < gate0;
  const skipL = (s: number) => w.nearOpening('L', s), skipR = (s: number) => w.nearOpening('R', s);
  // —— 地面：校内水泥地（接缝每拍）→ 校门 → 校外湿柏油 ——
  const rIn = w.clip(w.s0, gate0), rOut = w.clip(gate0, w.s1);
  if (rIn) {
    paverFloor(w, -HALF, 2.4, C.concreteNight, C.paverJoint, 0.25, rIn[0], rIn[1]);
    w.floor.flat(0, -9, -HALF, w.z(rIn[0]), w.z(rIn[1]), shade(C.bushDark, 1.1));
    w.floor.flat(0, 2.4, 9, w.z(rIn[0]), w.z(rIn[1]), shade(C.concreteNight, 0.85));
  }
  if (rOut) {
    w.floor.flat(0, -HALF, 1.9, w.z(rOut[0]), w.z(rOut[1]), C.asphalt);
    w.floor.flat(0.001, 1.9, 2.08, w.z(rOut[0]), w.z(rOut[1]), C.curb);
    w.floor.flat(-0.02, 2.08, 11, w.z(rOut[0]), w.z(rOut[1]), C.asphaltWet);
    w.floor.flat(0, -9, -HALF, w.z(rOut[0]), w.z(rOut[1]), C.paver);
  }
  // —— 校内：两侧矮树丛 + 树；右侧一块告示栏 ——
  w.grid(6, 2, (s, k) => {
    if (!inside(s) || s > gate0 - 2) return;
    const rng = keyRng(w.segId, 'yard', k);
    if (!skipL(s)) {
      w.stat.box([-2.6, 0.35, w.z(s)], [1.2, 0.7, 5.4], mix(C.bush, C.bushDark, rng.next()), { faces: '+x+y+z-z' });
      if (k % 2 === 0) tree(w.stat, -4.2, w.z(s), rng, { trunk: C.iron, trunk2: C.pole, canopy: C.bushDark, canopy2: C.bush, h: 5.5, q: w.q });
    }
    if (!skipR(s)) w.stat.box([2.9, 0.3, w.z(s)], [1.0, 0.6, 5.4], mix(C.bush, C.bushDark, rng.next()), { faces: '-x+y+z-z' });
  });
  // 校内的灯
  w.grid(12, 5, (s, k) => {
    if (!inside(s) || s > gate0 - 3 || skipR(s)) return;
    streetLamp(w, s, { x: 2.35, h: 3.6, arm: 0.35, working: true, flicker: k % 3 === 1, head: C.lampGold, reflect: false });
  });
  // —— 校门：四根立柱、顶梁、打开的铁门（收在两侧）、沿校界的铁栅栏 ——
  for (const s of [gate0, gate1]) {
    if (!w.owns(s)) continue;
    const z = w.z(s);
    for (const sx of [-1, 1] as const) {
      w.stat.box([sx * 2.3, 1.45, z], [0.62, 2.9, 0.62], 0x3f484e);
      w.stat.box([sx * 2.3, 2.96, z], [0.74, 0.12, 0.74], 0x4a545a);
    }
  }
  if (w.owns(gate0)) {
    const z = w.z(gate0);
    w.stat.box([0, 3.35, z], [5.3, 0.5, 0.4], 0x353e44);
    w.stat.box([0, 3.35, z + 0.201], [4.2, 0.28, 0.01], 0x2a3136, { faces: '+z' });
    // 沿校界的栅栏（横向，出了立柱往两边去）
    fenceAcross(w.stat, z, -12, -2.62, 2.0, w.q === 0 ? 0.3 : 0.18, C.iron);
    fenceAcross(w.stat, z, 2.62, 12, 2.0, w.q === 0 ? 0.3 : 0.18, C.iron);
    // 收起来的电动门（在右侧立柱外）
    fenceAcross(w.stat, z - 0.3, 2.65, 6.2, 1.7, w.q === 0 ? 0.25 : 0.14, shade(C.iron, 1.2));
    // 栅栏的影子：一排被拉长的牙齿（光从门外的路灯来，影子朝镜头铺开；地面层，贴地 3 mm）
    const L = { x: 1.2, s: gB + 7 };
    const step = w.q === 0 ? 0.36 : 0.22;
    for (let x = -7; x <= 7.01; x += step) {
      const dx = x - L.x, ds = gate0 - L.s;
      const len = Math.hypot(dx, ds);
      const ux = dx / len, us = ds / len;
      const long = 3.2 + Math.abs(dx) * 0.25;
      const half = 0.05;
      const bx = x, bs = gate0;
      const tx = bx + ux * long, ts = bs + us * long;
      const nx = -us * half, ns = ux * half;
      w.floor.face([bx + nx, 0.003, w.z(bs + ns)], [bx - nx, 0.003, w.z(bs - ns)], [tx, 0.003, w.z(ts)], [tx, 0.003, w.z(ts)], 0x0f1417, [0, 1, 0]);
    }
  }
  // 门外：左侧校界栅栏沿路延伸；右侧路灯、路对面的楼
  if (rOut) {
    fenceAlongS(w, -2.45, Math.max(rOut[0], gate1 + 0.4), rOut[1], 2.0, w.q === 0 ? 0.3 : 0.18, C.iron, skipL);
    w.grid(14, 3, (s, k) => {
      if (s < gate1 + 2 || skipR(s)) return;
      streetLamp(w, s, { x: 2.3, h: 4.6, arm: 0.6, working: true, flicker: false, head: C.lampGold, reflect: true });
      void k;
    });
    facades(w, 'gateFar', { x: 11.5, side: 1, depth: 6, heights: [7, 16], unit: 7, wall: [C.wallNightDark, C.wallNight2], windowDark: C.windowDark,
      windowLit: C.windowLitCold, litChance: 0.12, groundTop: 0, skip: (s) => s < gate1 });
    // 门外第一盏灯的碎金（门下的湿地）
    if (w.owns(gB + 7)) lampReflection(w, gB + 7, 1.0, C.lampGold);
  }
  // 远处：校内的楼（暗）
  facades(w, 'gateBldL', { x: -8, side: -1, depth: 8, heights: [9, 14], unit: 10, wall: [C.wallNightDark], windowDark: C.windowDark,
    windowLit: C.windowLitCold, litChance: 0.05, groundTop: 0, skip: (s) => !inside(s) });
  panelsIfAny(w, 'L', 'dark', C.wallNight);
  panelsIfAny(w, 'R', 'nightStreet', C.wallNight);
}

function alley(w: ChunkWork): void {
  const seg = w.ctx.seg;
  const [shA, shB] = shedSpan(seg);
  const inShed = (s: number) => s > shA && s < shB;
  const skipR = (s: number) => w.nearOpening('R', s, 1.5);
  // 地面：湿柏油（全宽），两侧排水沟
  asphaltFloor(w, -HALF, 2.1, C.asphalt, C.asphaltWet);
  w.floor.flat(0.001, -HALF, -1.62, 0, -w.L, shade(C.asphaltWet, 0.8));
  w.floor.flat(0, 2.1, 7, 0, -w.L, shade(C.bushDark, 0.9));
  // 左：楼背面的墙（x = −HALF，按开口留洞），墙根发黑
  wallWithOpenings(w, 'L', w.s0, w.s1, 6.5, [[0, 0.9, shade(C.wallNight2, 0.75)], [0.9, 6.5, C.wallNight2]], 'dark');
  // 墙上：窗、落水管、空调外机、后门
  w.grid(5.5, 1.3, (s, k) => {
    if (w.nearOpening('L', s, 1.4)) return;
    const rng = keyRng(w.segId, 'alleyL', k);
    const z = w.z(s);
    const x = -HALF + 0.012;
    const kind = rng.int(4);
    if (kind === 0) {
      w.stat.wallX(x, z + 0.5, z - 0.5, 0, 2.05, 0x1b2226, 1);
      w.stat.wallX(x + 0.004, z + 0.6, z - 0.6, 2.05, 2.12, 0x3a444b, 1);
    } else {
      w.stat.wallX(x, z + 0.55, z - 0.55, 2.6, 3.7, C.windowDark, 1);
      for (let i = 0; i < 4; i++) w.stat.box([x + 0.03, 3.15, z + 0.45 - i * 0.3], [0.03, 1.1, 0.025], 0x2f383e);
    }
    if (rng.next() < 0.6) {
      // 空调外机（「雨水打在空调外机上」）
      w.stat.box([-HALF + 0.3, 3.1 + rng.next() * 1.4, z - 1.6], [0.55, 0.55, 0.8], 0x444e55);
      w.stat.box([-HALF + 0.58, 3.1, z - 1.6], [0.02, 0.4, 0.55], 0x2a3237, { faces: '+x' });
    }
    if (k % 2 === 0) w.stat.box([-HALF + 0.06, 3.25, z - 2.6], [0.1, 6.5, 0.1], 0x323b41);
  });
  // 右：矮墙 + 铁栅栏；车棚段换成车棚
  const r = w.clip(w.s0, w.s1);
  if (r) {
    const segs: Array<[number, number]> = [];
    let a = r[0];
    for (const [x0, x1] of [[shA, shB]] as Array<[number, number]>) {
      if (x1 <= a || x0 >= r[1]) continue;
      if (x0 > a) segs.push([a, x0]);
      a = Math.max(a, x1);
    }
    if (a < r[1]) segs.push([a, r[1]]);
    for (const [sa, sb] of segs) {
      const za = w.z(sa), zb = w.z(sb);
      if (!w.openings('R').length) {
        w.stat.wallX(2.1, za, zb, 0, 1.1, C.wallNight, -1);
        w.stat.flat(1.1, 2.1, 2.35, za, zb, shade(C.wallNight, 1.2), true);
        fenceAlongS(w, 2.2, sa, sb, 2.1, w.q === 0 ? 0.35 : 0.2, C.iron);
      }
    }
  }
  // 车棚：立柱、倾斜的铁皮顶（瓦楞条纹）、下面一排废弃的自行车
  const sr = w.clip(shA, shB);
  if (sr) {
    const za = w.z(sr[0]), zb = w.z(sr[1]);
    const x0 = 1.95, x1 = 5.4, y0 = 2.45, y1 = 2.1;
    // 顶（底面，从下面看得到）+ 前沿
    const strip = w.q === 0 ? 0.3 : w.q === 1 ? 0.2 : 0.12;
    let i = 0;
    for (let s = sr[0]; s < sr[1] - 1e-6; s += strip, i++) {
      const s1 = Math.min(sr[1], s + strip);
      const col = i % 2 === 0 ? C.tin : C.tin2;
      w.stat.face([x0, y0, w.z(s)], [x1, y1, w.z(s)], [x1, y1, w.z(s1)], [x0, y0, w.z(s1)], shade(col, 0.7), [0.1, -1, 0]);
      w.stat.face([x0, y0 + 0.03, w.z(s)], [x1, y1 + 0.03, w.z(s)], [x1, y1 + 0.03, w.z(s1)], [x0, y0 + 0.03, w.z(s1)], col, [-0.1, 1, 0]);
    }
    w.stat.wallX(x0 - 0.01, za, zb, y0 - 0.1, y0 + 0.04, 0x5a646a, -1);
    // 立柱
    w.grid(3, 0.5, (s) => {
      if (!(s > shA && s < shB)) return;
      w.stat.box([x0 + 0.05, y0 / 2, w.z(s)], [0.07, y0, 0.07], 0x3b444a);
      w.stat.box([x1 - 0.1, y1 / 2, w.z(s)], [0.07, y1, 0.07], 0x3b444a);
    });
    // 自行车
    w.grid(w.q === 0 ? 1.4 : 0.9, 0.3, (s, k) => {
      if (!(s > shA + 0.6 && s < shB - 0.6)) return;
      const rng = keyRng(w.segId, 'bike', k);
      if (rng.next() < 0.25) return;
      const col = mix(0x3a4349, 0x5b6468, rng.next());
      bike(w.stat, 2.7 + rng.next() * 0.3, w.z(s), col, -1, w.q === 0);
      if (w.q > 0 && rng.next() < 0.5) bike(w.stat, 3.9 + rng.next() * 0.4, w.z(s + 0.3), shade(col, 0.85), -1, true);
    });
    // 车棚后墙
    w.stat.wallX(x1 + 0.1, za, zb, 0, y1, 0x20282d, -1);
  }
  // 路灯：右侧，每 15 m 一盏，坏了一半（§4.3「路灯坏了一半」）；亮着的里每三盏有一盏会闪
  w.grid(15, 6, (s, k) => {
    if (skipR(s)) return;
    const working = k % 2 === 0;
    const inSh = inShed(s);
    streetLamp(w, s, { x: inSh ? 1.98 : 2.25, h: inSh ? 2.4 : 4.2, arm: inSh ? 0.2 : 0.55, working, flicker: working && k % 3 === 0,
      head: C.lampGold, reflect: true });
  });
  // 远处：矮墙外的树
  if (w.q > 0) w.grid(9, 4, (s, k) => {
    if (inShed(s) || skipR(s)) return;
    tree(w.stat, 5.5, w.z(s), keyRng(w.segId, 'alleyTree', k), { trunk: C.iron, trunk2: C.pole, canopy: C.bushDark, canopy2: C.bush, h: 6, q: w.q });
  });
  panelsIfAny(w, 'R', 'dark', C.wallNight);
}

function shopStreet(w: ChunkWork): void {
  const seg = w.ctx.seg;
  const gc = graffitiCenter(seg);
  const skipR = (s: number) => w.nearOpening('R', s, 1.5);
  // 地面：人行道地砖 + 路沿 + 湿马路 + 对面人行道
  paverFloor(w, -HALF, 1.92, C.paver, C.paverJoint, 0.3);
  curbAndRoad(w, 1.92, 9.2, C.asphaltWet, C.curb, 0x59646b);
  w.floor.flat(-0.02, 9.2, 11.5, 0, -w.L, C.paver);
  // 左：一排关门的店铺（x = −HALF）：卷帘门、门楣、招牌（没有字）、楼上的窗
  const unit = 4.4;
  const shutterTop = 2.7;
  const band = w.q === 0 ? 0.22 : 0.11;
  wallWithOpenings(w, 'L', w.s0, w.s1, 3.95, [[shutterTop, 3.05, 0x2c353b], [3.05, 3.95, C.signDark]], 'nightStreet');
  const base = seg.s0;
  let k = Math.floor((w.s0 - base) / unit);
  for (; base + k * unit < w.s1; k++) {
    const ua = base + k * unit, ub = ua + unit;
    const r = w.clip(ua, ub);
    if (!r) continue;
    const rng = keyRng(w.segId, 'shop', k);
    const x = -HALF;
    // 卷帘门：横向瓦楞条（开口处不画）
    for (let y = 0, i = 0; y < shutterTop - 1e-6; y += band, i++) {
      const y1 = Math.min(shutterTop, y + band);
      let a = r[0];
      const holes = w.openings('L').filter((o) => o.s1 > r[0] && o.s0 < r[1] && y1 > o.y0 && y < o.y1).sort((p, q) => p.s0 - q.s0);
      for (const o of holes) {
        if (o.s0 > a) w.stat.wallX(x + 0.01, w.z(a), w.z(o.s0), y, y1, i % 2 === 0 ? C.shutter : C.shutter2, 1);
        a = Math.max(a, o.s1);
      }
      if (a < r[1]) w.stat.wallX(x + 0.01, w.z(a), w.z(r[1]), y, y1, i % 2 === 0 ? C.shutter : C.shutter2, 1);
    }
    // 开间之间的柱子、卷帘盒
    if (w.owns(ua) && !w.nearOpening('L', ua, 0.3)) w.stat.box([x + 0.06, 1.95, w.z(ua)], [0.14, 3.9, 0.36], 0x333c42);
    w.stat.box([x + 0.12, 2.84, w.z((r[0] + r[1]) / 2)], [0.22, 0.26, r[1] - r[0]], 0x384147, { faces: '+x+y-y' });
    // 招牌：一块比墙亮一点的灰板
    if (rng.next() < 0.8) w.stat.box([x + 0.08, 3.45, w.z((r[0] + r[1]) / 2)], [0.06, 0.62, (r[1] - r[0]) * 0.9], mix(C.signDark, 0x4a555c, rng.next()), { faces: '+x+y-y' });
    // 卷帘门上的锁
    if (w.owns(ua + unit / 2)) w.stat.box([x + 0.03, 0.3, w.z(ua + unit / 2)], [0.04, 0.12, 0.18], 0x5b6468);
  }
  // 楼上
  facades(w, 'shopUp', { x: -HALF, side: -1, depth: 8, heights: [8, 15], unit, wall: [C.wallNight, C.wallNight2], windowDark: C.windowDark,
    windowLit: C.windowLitCold, litChance: 0.08, groundTop: 3.95 });
  // 涂鸦：卷帘门上一只巨大的手掌，五指朝下（§4.3 @60–72「五根手指朝着地面，像要撑住什么」）
  if (w.owns(gc)) graffitiHand(w, gc);
  // 右：路灯（每 14 m）、路边停的电动车
  w.grid(14, 5, (s) => {
    if (skipR(s)) return;
    streetLamp(w, s, { x: 2.3, h: 4.8, arm: 0.7, working: true, flicker: false, head: C.lampGold, reflect: true });
  });
  if (w.q > 0) w.grid(8, 2.5, (s, k2) => {
    if (skipR(s)) return;
    const rng = keyRng(w.segId, 'scoot', k2);
    if (rng.next() < 0.5) return;
    const z = w.z(s), x = 2.75;
    w.stat.box([x, 0.45, z], [0.35, 0.35, 1.3], mix(0x3a4349, 0x4b555c, rng.next()));
    w.stat.box([x, 0.85, z - 0.5], [0.3, 0.5, 0.12], 0x2a3237);
    w.stat.box([x, 0.2, z - 0.55], [0.1, 0.4, 0.4], 0x15191c);
    w.stat.box([x, 0.2, z + 0.55], [0.1, 0.4, 0.4], 0x15191c);
  });
  // 路对面的店（暗）与楼
  facades(w, 'shopFar', { x: 11.5, side: 1, depth: 8, heights: [9, 18], unit: 6.5, wall: [C.wallNightDark, C.wallNight2], windowDark: C.windowDark,
    windowLit: C.windowLitCold, litChance: 0.1, groundTop: 0 });
  panelsIfAny(w, 'R', 'nightStreet', C.wallNight);
}

/** 卷帘门上的手掌涂鸦：掌心 + 五指朝下 + 拇指，冷白色喷漆，边缘有流挂。画在 x = −HALF 的墙面上。 */
function graffitiHand(w: ChunkWork, sc: number): void {
  const x = -HALF + 0.016;
  const paint = 0xc3ccd0, paint2 = 0xaab4b9;
  const n: [number, number, number] = [1, 0, 0];
  const P = (s: number, y: number): [number, number, number] => [x, y, w.z(s)];
  // 掌心：圆角的宽块（s 方向 4.2 m，y 1.35–2.55）
  const pw = 2.1, py0 = 1.35, py1 = 2.55;
  const palm: Array<[number, number, number]> = [];
  const segs = 14;
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI + (i / segs) * Math.PI;           // 上半圆角
    palm.push(P(sc + Math.cos(a) * pw, py1 - 0.35 + Math.abs(Math.sin(a)) * 0.35 + (i === 0 || i === segs ? -0.35 : 0)));
  }
  palm.push(P(sc + pw, py0));
  palm.push(P(sc - pw, py0));
  w.stat.fan(palm, paint, n);
  // 四指 + 小指：朝下，指尖接近地面
  const fingers = [
    { ds: -1.6, len: 1.05, wd: 0.26 }, { ds: -0.62, len: 1.22, wd: 0.3 }, { ds: 0.38, len: 1.18, wd: 0.3 }, { ds: 1.32, len: 1.0, wd: 0.27 },
  ];
  for (const f of fingers) {
    const s0 = sc + f.ds;
    const yb = py0 - f.len;
    w.stat.fan([P(s0 - f.wd, py0 + 0.05), P(s0 + f.wd, py0 + 0.05), P(s0 + f.wd * 0.85, yb + 0.12), P(s0, yb), P(s0 - f.wd * 0.85, yb + 0.12)], paint, n);
    // 指节的横纹
    w.stat.fan([P(s0 - f.wd * 0.8, py0 - f.len * 0.45 + 0.03), P(s0 + f.wd * 0.8, py0 - f.len * 0.45 + 0.03), P(s0 + f.wd * 0.8, py0 - f.len * 0.45 - 0.03), P(s0 - f.wd * 0.8, py0 - f.len * 0.45 - 0.03)], paint2, n);
    // 流挂
    w.stat.fan([P(s0 + 0.06, yb + 0.05), P(s0 + 0.1, yb + 0.05), P(s0 + 0.09, yb - 0.35), P(s0 + 0.07, yb - 0.35)], paint2, n);
  }
  // 拇指：从掌的一侧斜着伸向地面
  w.stat.fan([P(sc + pw - 0.05, py0 + 0.55), P(sc + pw + 0.25, py0 + 0.3), P(sc + pw + 0.75, py0 - 0.55), P(sc + pw + 0.5, py0 - 0.7), P(sc + pw - 0.2, py0 + 0.05)], paint, n);
  // 掌根的纹路
  w.stat.fan([P(sc - 1.2, 1.9), P(sc + 0.9, 2.05), P(sc + 0.9, 1.99), P(sc - 1.2, 1.84)], paint2, n);
}

/** 小区门口：门卫室（亮着冷光，没人）、栏杆机箱与灯、两侧门柱。red = 是否亮红灯（只在第三章）。 */
function compoundGate(w: ChunkWork, sBar: number, red: boolean, dawn: boolean): void {
  const wall = dawn ? C.dawnWall : C.wallNight;
  // 门卫室（左侧，栏杆之前）
  const bA = sBar - 5.2, bB = sBar - 1.6;
  if (w.owns((bA + bB) / 2) && !w.nearOpening('L', (bA + bB) / 2, 3)) {
    const za = w.z(bA), zb = w.z(bB), zc = (za + zb) / 2;
    w.stat.box([-3.9, 1.3, zc], [2.4, 2.6, bB - bA], wall);
    w.stat.box([-3.9, 2.7, zc], [2.8, 0.18, bB - bA + 0.5], shade(wall, 0.8));
    // 朝车道的大窗：第三章亮着冷光（「门卫室里亮着灯，但没人」），清晨暗着
    const win = dawn ? C.dawnWindow : C.boothLit;
    (dawn ? w.stat : w.emi).wallX(-2.69, zc + 1.2, zc - 1.2, 1.0, 2.1, win, 1);
    w.stat.wallX(-2.685, zc + 0.03, zc - 0.03, 1.0, 2.1, shade(wall, 0.6), 1);
    w.stat.wallZ(za + 0.001, -5.1, -2.7, 0, 2.1, shade(wall, 0.8), 1);
    if (!dawn) w.lamp((bA + bB) / 2, -3.2, 2.0, 'window', false);
  }
  // 门柱
  if (w.owns(sBar - 1.0)) {
    const z = w.z(sBar - 1.0);
    for (const sx of [-1, 1] as const) {
      w.stat.box([sx * 2.35, 1.3, z], [0.5, 2.6, 0.5], shade(wall, 1.1));
      w.stat.box([sx * 2.35, 2.66, z], [0.6, 0.12, 0.6], shade(wall, 0.85));
    }
    fenceAcross(w.stat, z, 2.65, 9, 1.8, w.q === 0 ? 0.3 : 0.16, dawn ? 0x3e474d : C.iron);
  }
  // 栏杆机箱（栏杆臂本身是障碍，由 WP6 画）+ 顶上的灯
  if (w.owns(sBar)) {
    const z = w.z(sBar);
    w.stat.box([-2.05, 0.5, z], [0.34, 1.0, 0.3], dawn ? 0x7d878d : 0x55606a);
    w.stat.box([-2.05, 0.75, z + 0.151], [0.3, 0.08, 0.005], dawn ? 0x3e474d : 0x2a3136, { faces: '+z' });
    if (red) {
      w.emi.box([-2.05, 1.06, z], [0.12, 0.1, 0.12], C.barrierRed, { faces: '+y+x-x+z-z' });
      w.lamp(sBar, -2.05, 1.1, 'bulb', false);
    } else {
      w.stat.box([-2.05, 1.06, z], [0.12, 0.1, 0.12], 0x3a4349, { faces: '+y+x-x+z-z' });
    }
  }
}

function compound(w: ChunkWork): void {
  const seg = w.ctx.seg;
  const sBar = barrierS(seg, 18);
  const endS = seg.s1;
  const skipL = (s: number) => w.nearOpening('L', s, 1.5), skipR = (s: number) => w.nearOpening('R', s, 1.5);
  // 地面：车道柏油，两侧人行道，栏杆后面是小区里的水泥路
  asphaltFloor(w, -HALF, 1.9, C.asphalt, C.asphaltWet);
  w.floor.flat(0.001, 1.9, 2.1, 0, -w.L, C.curb);
  w.floor.flat(0.001, -2.0, -HALF, 0, -w.L, C.curb);
  paverFloor(w, 2.1, 5.5, C.paver, C.paverJoint, 0.3);
  w.floor.flat(0, -9, -2.0, 0, -w.L, C.paver);
  w.floor.flat(0, 5.5, 12, 0, -w.L, shade(C.bushDark, 1.1));
  compoundGate(w, sBar, true, false);
  // 栏杆之后：两侧的住宅楼、灌木、路灯
  facades(w, 'cmpL', { x: -6.5, side: -1, depth: 10, heights: [15, 21], unit: 9, wall: [C.wallNight, C.wallNightDark], windowDark: C.windowDark,
    windowLit: C.windowLitCold, litChance: 0.14, groundTop: 0, skip: (s) => s < sBar + 3 || skipL(s) });
  facades(w, 'cmpR', { x: 8, side: 1, depth: 10, heights: [15, 21], unit: 9, wall: [C.wallNightDark, C.wallNight2], windowDark: C.windowDark,
    windowLit: C.windowLitCold, litChance: 0.12, groundTop: 0, skip: (s) => s < sBar + 3 || skipR(s) });
  w.grid(4, 1, (s, k) => {
    if (s < sBar + 2 || s > endS - 6) return;
    const rng = keyRng(w.segId, 'cmpBush', k);
    if (!skipL(s)) w.stat.box([-3.1, 0.4, w.z(s)], [1.4, 0.8, 3.4], mix(C.bush, C.bushDark, rng.next()), { faces: '+x+y+z-z' });
    if (!skipR(s)) w.stat.box([3.4, 0.4, w.z(s)], [1.4, 0.8, 3.4], mix(C.bush, C.bushDark, rng.next()), { faces: '-x+y+z-z' });
  });
  w.grid(11, 7, (s) => {
    if (s < sBar + 2 || skipR(s)) return;
    streetLamp(w, s, { x: 2.35, h: 3.8, arm: 0.35, working: true, flicker: false, head: C.lampGold, reflect: true });
  });
  // 段尾：单元门（通向 3-8 楼道），门上一盏暗暗的冷灯
  if (w.owns(endS - 2.5)) {
    const z = w.z(endS - 0.5);
    w.stat.wallZ(z, -6, -1.1, 0, 3.4, C.wallNight, 1);
    w.stat.wallZ(z, 1.1, 6, 0, 3.4, C.wallNight, 1);
    w.stat.wallZ(z, -1.1, 1.1, 2.3, 3.4, C.wallNight, 1);
    w.stat.wallZ(z - 0.6, -1.1, 1.1, 0, 2.3, 0x0d1216, 1);
    w.stat.wallX(-1.1, z, z - 0.6, 0, 2.3, 0x1c2328, 1);
    w.stat.wallX(1.1, z, z - 0.6, 0, 2.3, 0x1c2328, -1);
    w.stat.box([0, 2.4, z + 0.3], [2.6, 0.08, 0.6], 0x3a444b);
    w.emi.flat(2.355, -0.25, 0.25, z + 0.2, z + 0.05, 0x9fb2c0, false);
    w.lamp(endS - 0.5, 0, 2.35, 'bulb', true);
  }
  panelsIfAny(w, 'L', 'dark', C.wallNight);
  panelsIfAny(w, 'R', 'dark', C.wallNight);
}

function dawn(w: ChunkWork): void {
  const seg = w.ctx.seg;
  const sBar = barrierS(seg, 10);
  const endS = seg.s1;
  const stopA = endS - 9, stopB = endS - 3;
  const skipR = (s: number) => w.nearOpening('R', s, 2.2);
  // 地面：人行道（清晨偏亮的冷灰）、路沿、湿马路；地上散着湿落叶（装饰，不在车道正中堆积）
  paverFloor(w, -HALF, 1.95, C.dawnPaver, C.dawnPaverJoint, 0.25);
  curbAndRoad(w, 1.95, 9, C.dawnRoad, C.dawnCurb, 0x8a969d);
  w.floor.flat(-0.02, 9, 12, 0, -w.L, C.dawnPaver);
  const lrng = keyRng(w.segId, 'leaves', Math.round(w.s0 * 10));
  const nl = 18 + w.q * 18;
  for (let i = 0; i < nl; i++) {
    const s = w.s0 + lrng.next() * w.L;
    const edge = lrng.next() < 0.7;
    const x = edge ? (lrng.next() < 0.5 ? -HALF + lrng.next() * 0.5 : 1.3 + lrng.next() * 1.4) : -1.4 + lrng.next() * 2.8;
    const a = lrng.next() * Math.PI, r = 0.06 + lrng.next() * 0.07;
    const z = w.z(s);
    const col = mix(C.leaf, C.leafWet, lrng.next());
    w.floor.fan([[x + Math.cos(a) * r * 1.6, 0.002, z + Math.sin(a) * r * 1.6], [x + Math.cos(a + 1.6) * r, 0.002, z + Math.sin(a + 1.6) * r],
      [x - Math.cos(a) * r * 1.6, 0.002, z - Math.sin(a) * r * 1.6], [x + Math.cos(a - 1.6) * r, 0.002, z + Math.sin(a - 1.6) * r]], col, [0, 1, 0]);
  }
  compoundGate(w, sBar, false, true);
  // 左：临街的店（卷帘门还关着），楼上的窗
  wallWithOpenings(w, 'L', Math.max(w.s0, sBar + 4), w.s1, 3.6, [[0, 2.7, C.dawnWall2], [2.7, 3.6, shade(C.dawnWall2, 0.8)]], 'dark');
  if (sBar + 4 > w.s0) {
    const r = w.clip(w.s0, sBar + 4);
    if (r) w.floor.flat(0, -9, -HALF, w.z(r[0]), w.z(r[1]), C.dawnPaver);
  }
  facades(w, 'dawnUp', { x: -HALF, side: -1, depth: 8, heights: [9, 14], unit: 5, wall: [C.dawnWall, shade(C.dawnWall, 0.9)], windowDark: C.dawnWindow,
    windowLit: 0xb8c6cf, litChance: 0.04, groundTop: 3.6, skip: (s) => s < sBar + 4 });
  w.grid(5, 0.5, (s) => {
    if (s < sBar + 4 || w.nearOpening('L', s, 0.8)) return;
    const z = w.z(s);
    for (let y = 0.2; y < 2.7; y += w.q === 0 ? 0.45 : 0.22) w.stat.wallX(-HALF + 0.01, z - 0.3, z - 4.7, y, y + 0.03, shade(C.dawnWall2, 0.85), 1);
    w.stat.box([-HALF + 0.06, 1.35, z], [0.12, 2.7, 0.3], shade(C.dawnWall, 0.8));
  });
  // 右：梧桐（每 7 m）、停着的汽车、路灯（冷色，还亮着）
  w.grid(7, 3, (s, k) => {
    if (s < sBar + 3 || skipR(s) || (s > stopA - 1 && s < stopB + 1)) return;
    const rng = keyRng(w.segId, 'plane', k);
    tree(w.stat, 2.55, w.z(s), rng, { trunk: C.trunk, trunk2: C.trunkPale, canopy: C.canopy, canopy2: C.canopy2, h: 7.5, q: w.q });
    w.floor.flat(0.002, 2.25, 2.85, w.z(s) + 0.3, w.z(s) - 0.3, shade(C.dawnPaver, 0.75));
  });
  w.grid(9, 6.5, (s, k) => {
    if (s < sBar + 5 || skipR(s) || s > stopA - 4) return;
    const rng = keyRng(w.segId, 'car', k);
    if (rng.next() < 0.3) return;
    parkedCar(w.stat, 3.35, w.z(s), mix(C.car, C.car2, rng.next()), C.carGlass);
  });
  w.grid(16, 11, (s) => {
    if (s < sBar + 3 || skipR(s)) return;
    streetLamp(w, s, { x: 2.3, h: 4.8, arm: 0.6, working: true, flicker: false, head: C.dawnLamp, reflect: false });
  });
  // 公交站（段尾，§4.5 @212「公交站：停」）：顶棚、立柱、站牌、长椅
  if (w.owns((stopA + stopB) / 2)) {
    const za = w.z(stopA), zb = w.z(stopB), zc = (za + zb) / 2;
    w.stat.box([3.1, 2.55, zc], [1.9, 0.1, stopB - stopA], 0x6d7880);
    w.stat.box([3.95, 1.3, zc], [0.05, 2.5, stopB - stopA], 0x55616a, { faces: '-x' });
    for (const zz of [za - 0.2, zb + 0.2]) w.stat.box([3.95, 1.27, zz], [0.08, 2.55, 0.08], 0x55616a);
    w.stat.box([3.5, 0.45, zc], [0.4, 0.05, 2.4], 0x5b6468);
    // 站牌（立在路沿上，没有字）
    w.stat.box([2.15, 1.3, za + 0.5], [0.07, 2.6, 0.07], 0x5b6468);
    w.stat.box([2.15, 2.35, za + 0.5], [0.06, 0.6, 0.45], 0x8d9aa1);
  }
  // 路对面：楼（剪影，逆光）
  facades(w, 'dawnFar', { x: 12, side: 1, depth: 8, heights: [10, 20], unit: 7, wall: [0x4b565e, 0x434e56], windowDark: 0x39444c,
    windowLit: 0xb8c6cf, litChance: 0.03, groundTop: 0 });
  panelsIfAny(w, 'R', 'dark', C.dawnWall);
}

// ——————————————————— kit ———————————————————

export function buildStreetChunk(ctx: KitChunkContext): KitChunk {
  const w = new ChunkWork(ctx);
  switch (ctx.variant as StreetVariant) {
    case 'schoolGate': schoolGate(w); break;
    case 'shopStreet': shopStreet(w); break;
    case 'compound': compound(w); break;
    case 'dawn': dawn(w); break;
    case 'alley': default: alley(w); break;
  }
  return w.finish();
}

const AMB: Record<StreetVariant, AmbienceId> = { schoolGate: 'rainStreet', alley: 'rainStreet', shopStreet: 'rainStreet', compound: 'rainStreet', dawn: 'dawnStreet' };

export const streetKit: EnvKit & { isSpecial(seg: CompiledSegment, s0: number, s1: number): boolean } = {
  id: 'street', owner: 'WP4', variants: STREET_VARIANTS,
  build: buildStreetChunk,
  ambience: (v) => AMB[v as StreetVariant] ?? 'rainStreet',
  reverb: (): ReverbId => 'street',
  /** 这一段 chunk 是否含按数据摆放的陈设（校门、车棚、涂鸦、门卫室、公交站）：这种 chunk 不能当通用变体复用。 */
  isSpecial(seg, s0, s1) {
    const v = (seg.def as { variant?: string }).variant;
    const hit = (a: number, b: number) => a < s1 + 6 && b > s0 - 6;
    if (v === 'schoolGate') { const [a, b] = gateSpan(seg); return hit(a - 8, b + 8); }
    if (v === 'alley') { const [a, b] = shedSpan(seg); return hit(a, b); }
    if (v === 'shopStreet') { const c = graffitiCenter(seg); return hit(c - 3, c + 3); }
    if (v === 'compound') { const b = barrierS(seg, 18); return hit(b - 6, b + 1) || hit(seg.s1 - 3, seg.s1); }
    if (v === 'dawn') { const b = barrierS(seg, 10); return hit(b - 6, b + 4) || hit(seg.s1 - 10, seg.s1); }
    return false;
  },
};

registerKit(streetKit);
