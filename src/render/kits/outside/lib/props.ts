// src/render/kits/outside/lib/props.ts —— 户外陈设（DESIGN.md §4.3–4.5、§5.9）：路灯、栅栏、楼、树、车、自行车、人群剪影。
// 全部写进 ChunkWork 的三个几何体之一；没有五官（附录 A-4），颜色只用冷色（暖色只有第三章的路灯碎金与栏杆红灯）。
import type { Rng } from '../../../../core/types';
import { C, mix, shade } from './colors';
import { type OGeo, type V3, keyRng } from './geo';
import type { ChunkWork } from './kit';

export interface LampOpts {
  /** 灯杆所在 x；灯头朝车道方向伸出 arm。 */
  x: number; h: number; arm: number;
  working: boolean; flicker: boolean;
  /** 灯头发光色：第三章 = 路灯碎金；其余 = 冷白。 */
  head: number;
  /** 湿地面上的倒影碎片（路灯碎金，§4.3「路灯倒在里面，碎成一块一块的金色」）。 */
  reflect: boolean;
}

/** 路灯：灯杆 + 横臂 + 灯头；亮着的灯头下沿是发光面，并登记 LampSpec（kind 'street'）。 */
export function streetLamp(w: ChunkWork, s: number, o: LampOpts): void {
  const z = w.z(s);
  const dir = o.x > 0 ? -1 : 1;
  const hx = o.x + dir * o.arm;
  const n = w.q === 0 ? 5 : 6;
  w.stat.prism(o.x, z, 0, o.h, 0.065, n, C.pole, null, 0.05);
  w.stat.box([o.x, 0.35, z], [0.2, 0.7, 0.2], shade(C.pole, 0.85));
  w.stat.segment([o.x, o.h - 0.05, z], [hx, o.h + 0.05, z], 0.06, 0.06, C.pole);
  w.stat.box([hx, o.h + 0.02, z], [0.5, 0.1, 0.24], shade(C.pole, 0.9), { faces: '+y+x-x+z-z' });
  if (o.working) {
    w.emi.flat(o.h - 0.035, hx - 0.22, hx + 0.22, z + 0.1, z - 0.1, o.head, false);
    w.emi.wallZ(z + 0.121, hx - 0.22, hx + 0.22, o.h - 0.03, o.h + 0.02, mix(o.head, 0xffffff, 0.15), 1);
    w.lamp(s, hx, o.h - 0.05, 'street', o.flicker);
    if (o.reflect) lampReflection(w, s, hx, o.head);
  } else {
    w.stat.flat(o.h - 0.035, hx - 0.22, hx + 0.22, z + 0.1, z - 0.1, C.lampDead, false);
  }
}

/** 湿地面上灯的倒影：从灯脚下朝镜头方向拉长、碎成一块一块（emissive，贴地 4 mm）。 */
export function lampReflection(w: ChunkWork, s: number, x: number, head: number): void {
  const rng = keyRng(w.segId, 'refl', Math.round(s * 100));
  const n = 7 + w.q * 5;
  for (let i = 0; i < n; i++) {
    const t = rng.next();
    const ds = -0.6 + t * 4.2;                         // 朝镜头（s 减小）拉长
    const spread = 0.12 + t * 0.35;
    const cx = x * (1 - t * 0.35) + (rng.next() * 2 - 1) * spread;
    const cs = s - ds;
    const len = 0.08 + rng.next() * 0.3, wid = 0.04 + rng.next() * 0.12;
    const k = (1 - t) * (0.55 + rng.next() * 0.3);
    const col = mix(C.asphalt, head, Math.max(0.15, k));
    const z = w.z(cs);
    const sk = (rng.next() * 2 - 1) * 0.04;
    w.emi.face([cx - wid, 0.004, z + len], [cx + wid, 0.004, z + len + sk], [cx + wid * 0.7, 0.004, z - len], [cx - wid * 0.8, 0.004, z - len - sk], col, [0, 1, 0]);
  }
}

/** 铁栅栏：竖杆 + 上下横杆（x 固定，沿 s）；step = 杆距。topSpikes 画尖顶。 */
export function fenceAlongS(w: ChunkWork, x: number, sa: number, sb: number, h: number, step: number, color: number, skip?: (s: number) => boolean): void {
  const r = w.clip(sa, sb);
  if (!r) return;
  const za = w.z(r[0]), zb = w.z(r[1]);
  w.stat.box([x, h - 0.08, (za + zb) / 2], [0.04, 0.04, za - zb], color);
  w.stat.box([x, 0.18, (za + zb) / 2], [0.04, 0.04, za - zb], color);
  const base = w.ctx.seg.s0;
  let k = Math.ceil((r[0] - base) / step);
  for (; base + k * step < r[1]; k++) {
    const s = base + k * step;
    if (skip?.(s)) continue;
    const z = w.z(s);
    w.stat.box([x, h / 2, z], [0.025, h, 0.025], color, { faces: '+x-x+z-z' });
  }
}

/** 横跨 x 方向的栅栏（平面 z 固定），xa → xb。 */
export function fenceAcross(g: OGeo, z: number, xa: number, xb: number, h: number, step: number, color: number): void {
  const cx = (xa + xb) / 2, len = Math.abs(xb - xa);
  g.box([cx, h - 0.08, z], [len, 0.04, 0.04], color);
  g.box([cx, 0.18, z], [len, 0.04, 0.04], color);
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 0; i <= n; i++) {
    const x = Math.min(xa, xb) + (len * i) / n;
    g.box([x, h / 2, z], [0.025, h, 0.025], color, { faces: '+x-x+z-z' });
    g.tri([x - 0.03, h, z], [x + 0.03, h, z], [x, h + 0.09, z], color);
  }
}

export interface FacadeOpts {
  /** 墙面所在 x（朝车道一面）；side = −1 左、+1 右。 */
  x: number; side: -1 | 1; depth: number;
  heights: readonly [number, number];
  unit: number; wall: readonly number[]; windowDark: number; windowLit: number; litChance: number;
  /** 一楼（0..groundTop）交给调用方画（卷帘门、墙裙）时设为 > 0。 */
  groundTop: number;
  skip?: (s: number) => boolean;
  roofEdge?: number;
}

/** 楼的立面：按开间（unit）切，每间高度随机；窗是凹进去的暗块，少数亮着冷光（emissive）。 */
export function facades(w: ChunkWork, key: string, o: FacadeOpts): void {
  const base = w.ctx.seg.s0;
  let k = Math.floor((w.s0 - base) / o.unit);
  const facing = (-o.side) as 1 | -1;
  for (; base + k * o.unit < w.s1; k++) {
    const ua = base + k * o.unit, ub = ua + o.unit;
    const r = w.clip(ua, ub);
    if (!r) continue;
    if (o.skip && (o.skip(r[0]) || o.skip(r[1]) || o.skip((r[0] + r[1]) / 2))) continue;
    const rng = keyRng(w.segId, key, k);
    const h = o.heights[0] + rng.next() * (o.heights[1] - o.heights[0]);
    const col = o.wall[rng.int(o.wall.length)] ?? C.wallNight;
    const za = w.z(r[0]), zb = w.z(r[1]);
    w.stat.wallX(o.x, za, zb, o.groundTop, h, col, facing);
    // 屋顶边与侧面（相邻开间高度不同时露出来的侧墙）
    w.stat.flat(h, Math.min(o.x, o.x + o.side * o.depth), Math.max(o.x, o.x + o.side * o.depth), za, zb, shade(col, 0.8), true);
    if (o.roofEdge !== undefined) w.stat.box([o.x - o.side * 0.05, h + 0.06, (za + zb) / 2], [0.12, 0.12, za - zb], o.roofEdge);
    if (Math.abs(r[0] - ua) < 1e-6) w.stat.wallZ(za, Math.min(o.x, o.x + o.side * o.depth), Math.max(o.x, o.x + o.side * o.depth), o.groundTop, h, shade(col, 0.85), 1);
    // 窗：每层 3 m，每间 2 扇
    const floors = Math.floor((h - Math.max(o.groundTop, 0.8)) / 3);
    for (let f = 0; f < floors; f++) {
      const y0 = Math.max(o.groundTop, 0.8) + 0.9 + f * 3;
      if (y0 + 1.3 > h - 0.2) break;
      for (let i = 0; i < 2; i++) {
        const sc = ua + o.unit * (0.28 + i * 0.44);
        if (sc < r[0] + 0.5 || sc > r[1] - 0.5) continue;
        const lit = rng.next() < o.litChance;
        const g = lit ? w.emi : w.stat;
        const zc = w.z(sc);
        g.wallX(o.x + facing * 0.012, zc + 0.55, zc - 0.55, y0, y0 + 1.3, lit ? o.windowLit : o.windowDark, facing);
        if (!lit) w.stat.wallX(o.x + facing * 0.018, zc + 0.02, zc - 0.02, y0, y0 + 1.3, shade(col, 0.7), facing);
      }
    }
  }
}

/** 一棵树：树干分成两三根枝，枝头各一团树冠（低多边形，扁一点、互相叠着，不像悬在空中的石头）。 */
export function tree(g: OGeo, x: number, z: number, rng: Rng, o: { trunk: number; trunk2: number; canopy: number; canopy2: number; h: number; q: number }): void {
  const th = o.h * (0.42 + rng.next() * 0.08);
  g.prism(x, z, 0, th, 0.14, o.q === 0 ? 5 : 6, o.trunk, null, 0.11);
  if (o.q > 0) g.box([x + 0.06, th * 0.45, z + 0.12], [0.1, th * 0.3, 0.02], o.trunk2, { faces: '+z' });
  const n = o.q === 0 ? 2 : 3;
  const tips: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.next() * 0.8, d = 0.7 + rng.next() * 0.5;
    const tip: [number, number, number] = [x + Math.cos(a) * d, th + 1.1 + rng.next() * 0.9, z + Math.sin(a) * d];
    g.segment([x, th - 0.1, z], tip, 0.09, 0.09, o.trunk);
    tips.push(tip);
  }
  tips.push([x, th + 1.9 + rng.next() * 0.5, z]);
  for (const t of tips) {
    const r = 1.2 + rng.next() * 0.6;
    g.blob([t[0], t[1] + 0.35, t[2]], [r * 1.15, r * 0.62, r * 1.15], o.canopy, rng, 0.22, 0, o.canopy2);
  }
}

/** 停着的车（剪影，不是障碍）：车身 + 车顶 + 深色车窗 + 轮子。朝向沿 s。 */
export function parkedCar(g: OGeo, x: number, z: number, body: number, glass: number): void {
  g.box([x, 0.55, z], [1.7, 0.7, 4.1], body, { faces: '+y+x-x+z-z' });
  g.box([x, 1.12, z + 0.2], [1.5, 0.46, 2.1], shade(body, 0.95), { faces: '+y+x-x+z-z' });
  g.wallX(x - 0.755, z + 1.2, z - 0.8, 0.95, 1.3, glass, -1);
  g.wallX(x + 0.755, z + 1.2, z - 0.8, 0.95, 1.3, glass, 1);
  g.wallZ(z + 1.26, x - 0.7, x + 0.7, 0.95, 1.3, glass, 1);
  g.wallZ(z + 2.06, x - 0.8, x + 0.8, 0.4, 0.62, shade(body, 0.7), 1);
  for (const dx of [-0.78, 0.78]) for (const dz of [-1.35, 1.35]) g.box([x + dx, 0.3, z + dz], [0.2, 0.6, 0.6], 0x15191c, { faces: '+x-x+z-z+y' });
}

/** 旧自行车（侧面朝车道）：两个八边形轮圈 + 车架 + 车把。 */
export function bike(g: OGeo, x: number, z: number, color: number, facing: 1 | -1, lowDetail: boolean): void {
  const r = 0.33, y = 0.34;
  for (const dz of [-0.52, 0.52]) {
    const zc = z + dz;
    const n = lowDetail ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number, rr: number): V3 => [x, y + Math.sin(a) * rr, zc + Math.cos(a) * rr];
      g.face(p(a0, r), p(a1, r), p(a1, r - 0.04), p(a0, r - 0.04), color, [facing, 0, 0]);
    }
  }
  g.segment([x, y, z - 0.52], [x, 0.62, z + 0.05], 0.03, 0.03, color);
  g.segment([x, 0.62, z + 0.05], [x, y, z + 0.52], 0.03, 0.03, color);
  g.segment([x, 0.64, z - 0.3], [x, 0.64, z + 0.2], 0.03, 0.03, color);
  g.segment([x, 0.64, z - 0.35], [x, 0.9, z - 0.42], 0.025, 0.025, color);
  g.box([x, 0.92, z - 0.42], [0.42, 0.025, 0.025], color);
  g.box([x, 0.7, z + 0.22], [0.1, 0.03, 0.2], 0x1b2024);
}

/** 站着的人（剪影，没有五官，§5.7「所有人都没有五官」）：腿、躯干、头、手臂。朝向 yaw（面向 −z 为 0）。 */
export function standingFigure(g: OGeo, x: number, z: number, yaw: number, rng: Rng, o: { body: number; legs: number; head: number; detail: 0 | 1 | 2; armsUp?: boolean }): void {
  const h = 1.6 + rng.next() * 0.2;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * sn, ly, z - lx * sn + lz * c];
  const boxL = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: number) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    g.face(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, [sn, 0, c]);
    g.face(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), col, [-sn, 0, -c]);
    g.face(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), shade(col, 0.92), [c, 0, -sn]);
    g.face(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), shade(col, 0.92), [-c, 0, sn]);
    g.face(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), shade(col, 1.05), [0, 1, 0]);
  };
  const legH = h * 0.47;
  if (o.detail === 0) boxL(0, legH / 2, 0, 0.3, legH, 0.18, o.legs);
  else { boxL(-0.085, legH / 2, 0, 0.13, legH, 0.16, o.legs); boxL(0.085, legH / 2, 0, 0.13, legH, 0.16, o.legs); }
  const torsoH = h * 0.33;
  boxL(0, legH + torsoH / 2, 0, 0.38, torsoH, 0.22, o.body);
  boxL(0, legH + torsoH + 0.13, 0, 0.19, 0.24, 0.21, o.head);
  if (o.detail >= 1) {
    const up = o.armsUp === true;
    boxL(-0.235, legH + torsoH - (up ? 0.12 : 0.28), up ? -0.12 : 0, 0.08, up ? 0.3 : 0.56, 0.09, shade(o.body, 0.9));
    boxL(0.235, legH + torsoH - (up ? 0.12 : 0.28), up ? -0.12 : 0, 0.08, up ? 0.3 : 0.56, 0.09, shade(o.body, 0.9));
  }
}
