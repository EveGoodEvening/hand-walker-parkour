// src/render/kits/placeholder.ts —— CORE 的占位 kit：盒子走廊（DESIGN.md §8.9-10）。CORE 冻结。
// 任何没注册的 kit 都回落到这里（registry.getKit）。按 seg.def.kit 换一套配色和少量陈设，让第一章在正式场景件合并前也看得过去：
//   corridor：水磨石地面 + 每拍一道铜条、墙裙、门、左侧的窗（发光）；classroom：两侧课桌；washroom：瓷砖墙、右侧隔间板、左侧洗手台。
// 灯管每 2 拍一盏（发光几何）。按 openings 在墙上留口，口后面放一个深 3.8 m 的暗色「镜中房间」（§5.8）。
// 几何体使用局部坐标（见 contracts.ts KitChunk）。3 个几何体 = ≤ 3 次 draw call。
import type { AmbienceId, KitId, ReverbId } from '../../core/types';
import type { EnvKit, KitChunk, KitChunkContext, LampSpec, Opening } from '../../core/contracts';
import { CORRIDOR_WIDTH, END_MIRROR_HALF_W } from '../../core/constants';
import { GeoBuilder, mixHex } from '../../core/geo';
import { registerKit } from '../../core/registry';

const HALF = CORRIDOR_WIDTH / 2;   // 1.8
const H = 3.0;
const ROOM_DEPTH = 3.8;

interface Style {
  floor: number; floorAlt: readonly number[]; strip: number; wall: number; wainscot: number; rim: number; ceiling: number;
  wainscotTop: number; doors: boolean; windowsL: boolean; desks: boolean; stalls: boolean; sinks: boolean; tile: boolean;
}
const CORRIDOR: Style = {
  floor: 0x8d9493, floorAlt: [0x6b7270, 0xb7bdbb, 0x9a9f9d, 0x7d8483], strip: 0xa7adab, wall: 0xc9cfcf, wainscot: 0x5f7f7a, rim: 0x4c6763,
  ceiling: 0xb9c0c1, wainscotTop: 1.1, doors: true, windowsL: true, desks: false, stalls: false, sinks: false, tile: false,
};
const STYLES: Partial<Record<KitId, Style>> = {
  corridor: CORRIDOR,
  classroom: { ...CORRIDOR, doors: false, windowsL: true, desks: true },
  washroom: { ...CORRIDOR, floor: 0xc8cfd0, floorAlt: [0xbfc6c7, 0xd5dbdc], strip: 0x9aa3a4, wall: 0xd5dbdc, wainscot: 0xc3cacb, rim: 0x9aa3a4,
    wainscotTop: 1.5, doors: false, windowsL: false, stalls: true, sinks: true, tile: true },
  labRoom: { ...CORRIDOR, wall: 0xb9c3c6, doors: false, desks: true },
  canteen: { ...CORRIDOR, floor: 0x9a9f9d, wall: 0xd0d4d2, doors: false, desks: true },
  stairs: { ...CORRIDOR, doors: false, windowsL: true },
  street: { ...CORRIDOR, floor: 0x3a4248, floorAlt: [0x333a3f, 0x40484e], strip: 0x50606a, wall: 0x50606a, wainscot: 0x3a464d, rim: 0x3a464d,
    ceiling: 0x1c2227, doors: false, windowsL: false },
  plaza: { ...CORRIDOR, floor: 0xc9cfd2, floorAlt: [0xbfc5c8, 0xd4d9db], strip: 0xb7bdbb, wall: 0xe4e8ea, wainscot: 0xc9cfd2, rim: 0xc9cfd2,
    ceiling: 0xe4e8ea, doors: false, windowsL: false },
  track: { ...CORRIDOR, floor: 0x7a4b44, floorAlt: [0x74463f, 0x80514a], strip: 0xcfd3d2, wall: 0x5e6b5a, wainscot: 0x5e6b5a, rim: 0x5e6b5a,
    ceiling: 0xcfd6da, doors: false, windowsL: false },
};

function styleFor(ctx: KitChunkContext): Style {
  const kit = (ctx.seg.def as { kit?: KitId }).kit ?? 'corridor';
  return STYLES[kit] ?? CORRIDOR;
}

/** 在一侧墙面上画 [sa, sb] × [ya, yb] 这块（按墙裙分色）。side −1 = 左墙（x = −HALF，朝 +x），+1 = 右墙。 */
function wallPiece(g: GeoBuilder, st: Style, side: -1 | 1, za: number, zb: number, ya: number, yb: number): void {
  if (yb <= ya + 1e-4 || Math.abs(zb - za) < 1e-4) return;
  const x = side * HALF;
  const bands: Array<[number, number, number]> = [
    [0, st.wainscotTop, st.wainscot], [st.wainscotTop, st.wainscotTop + 0.05, st.rim], [st.wainscotTop + 0.05, H, st.wall],
  ];
  for (const [b0, b1, c] of bands) {
    const y0 = Math.max(ya, b0), y1 = Math.min(yb, b1);
    if (y1 <= y0) continue;
    // 左墙法线 +x：从 +z 看过去逆时针 → (x, y0, za) (x, y0, zb) (x, y1, zb) (x, y1, za)，za > zb（z = −s，越远越小）
    if (side < 0) g.quad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], c);
    else g.quad([x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb], c);
  }
}

/** 开口后面的镜中房间（只画朝向开口的内表面）。 */
function mirrorRoom(g: GeoBuilder, emissive: GeoBuilder, side: -1 | 1, za: number, zb: number, o: Opening, backdrop: string | undefined): void {
  const xw = side * HALF, xb = side * (HALF + ROOM_DEPTH);
  const dark = 0x1a2328, darker = 0x121a1f;
  const bright = backdrop === 'evening' || backdrop === 'playground';
  // 背墙
  if (bright) {
    const top = 0xdce6ec, bottom = 0xa9b8c2;
    if (side < 0) emissive.quad([xb, 0, za], [xb, 0, zb], [xb, H, zb], [xb, H, za], mixHex(bottom, top, 0.5));
    else emissive.quad([xb, 0, zb], [xb, 0, za], [xb, H, za], [xb, H, zb], mixHex(bottom, top, 0.5));
  } else if (side < 0) g.quad([xb, 0, za], [xb, 0, zb], [xb, H, zb], [xb, H, za], darker);
  else g.quad([xb, 0, zb], [xb, 0, za], [xb, H, za], [xb, H, zb], darker);
  // 地面与天花板
  const [xa0, xa1] = side < 0 ? [xb, xw] : [xw, xb];
  g.quad([xa0, 0.001, za], [xa1, 0.001, za], [xa1, 0.001, zb], [xa0, 0.001, zb], dark);
  g.quad([xa0, H, zb], [xa1, H, zb], [xa1, H, za], [xa0, H, za], dark);
  // 两个侧面
  g.quad([xa0, 0, zb], [xa1, 0, zb], [xa1, H, zb], [xa0, H, zb], dark);   // 远端，朝 +z
  g.quad([xa1, 0, za], [xa0, 0, za], [xa0, H, za], [xa1, H, za], dark);   // 近端，朝 −z
  // 开口的上下沿（墙厚）
  void o;
}

export function buildPlaceholderChunk(ctx: KitChunkContext): KitChunk {
  const st = styleFor(ctx);
  const floor = new GeoBuilder();
  const stat = new GeoBuilder();
  const emi = new GeoBuilder();
  const lamps: LampSpec[] = [];
  const L = ctx.s1 - ctx.s0;
  const z = (s: number) => -(s - ctx.s0);
  const rng = ctx.rng;
  const segS0 = ctx.seg.s0;
  const stride = ctx.stride > 0 ? ctx.stride : 1;

  // —— 地面：0.6 × 0.5 m 的格子，颜色轻微抖动（水磨石 / 瓷砖）——
  const cellX = st.tile ? 0.45 : 0.6, cellS = st.tile ? 0.45 : 0.5;
  for (let s = 0; s < L - 1e-6; s += cellS) {
    const s1 = Math.min(L, s + cellS);
    for (let x = -HALF; x < HALF - 1e-6; x += cellX) {
      const x1 = Math.min(HALF, x + cellX);
      const alt = st.floorAlt[rng.int(st.floorAlt.length)] ?? st.floor;
      const c = mixHex(st.floor, alt, st.tile ? 0.25 : 0.18 + rng.next() * 0.12);
      floor.quad([x, 0, -s], [x1, 0, -s], [x1, 0, -s1], [x, 0, -s1], c);
    }
  }
  // 铜条 / 灰缝：每拍一道（视觉节拍，§5.9）
  const k0 = Math.ceil((ctx.s0 - segS0) / stride - 1e-6);
  for (let k = k0; segS0 + k * stride < ctx.s1 - 1e-6; k++) {
    const zz = z(segS0 + k * stride);
    floor.quad([-HALF, 0.002, zz + 0.012], [HALF, 0.002, zz + 0.012], [HALF, 0.002, zz - 0.012], [-HALF, 0.002, zz - 0.012], st.strip);
  }

  // —— 墙（留口）——
  for (const side of [-1, 1] as const) {
    const sideKey = side < 0 ? 'L' : 'R';
    const ops = ctx.openings.filter((o) => o.side === sideKey).map((o) => ({ ...o, a: Math.max(ctx.s0, o.s0), b: Math.min(ctx.s1, o.s1) })).filter((o) => o.b > o.a);
    const cuts = new Set<number>([ctx.s0, ctx.s1]);
    for (const o of ops) { cuts.add(o.a); cuts.add(o.b); }
    const xs = Array.from(cuts).sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i] as number, b = xs[i + 1] as number;
      const mid = (a + b) / 2;
      const o = ops.find((q) => mid > q.a && mid < q.b);
      if (!o) wallPiece(stat, st, side, z(a), z(b), 0, H);
      else {
        wallPiece(stat, st, side, z(a), z(b), 0, o.y0);
        wallPiece(stat, st, side, z(a), z(b), o.y1, H);
        const surf = (ctx.seg.surfaces ?? []).find((q) => q.id === o.surfaceId);
        mirrorRoom(stat, emi, side, z(a), z(b), o, surf?.backdrop);
        // 开口的上下窗台（墙厚 0.12）
        const xw = side * HALF, xi = side * (HALF + 0.12);
        const [x0, x1] = side < 0 ? [xi, xw] : [xw, xi];
        stat.quad([x0, o.y0, z(a)], [x1, o.y0, z(a)], [x1, o.y0, z(b)], [x0, o.y0, z(b)], 0x9aa3a4);
        stat.quad([x0, o.y1, z(b)], [x1, o.y1, z(b)], [x1, o.y1, z(a)], [x0, o.y1, z(a)], 0x9aa3a4);
      }
    }
  }
  // 端墙开口（端墙镜）
  for (const o of ctx.openings.filter((q) => q.side === 'end' && q.s0 >= ctx.s0 - 1e-6 && q.s0 <= ctx.s1 + 1e-6)) {
    const ze = z(o.s0);
    const hx = END_MIRROR_HALF_W;
    const c = st.wall;
    stat.quad([-HALF, 0, ze], [-hx, 0, ze], [-hx, H, ze], [-HALF, H, ze], c);
    stat.quad([hx, 0, ze], [HALF, 0, ze], [HALF, H, ze], [hx, H, ze], c);
    stat.quad([-hx, 0, ze], [hx, 0, ze], [hx, o.y0, ze], [-hx, o.y0, ze], st.wainscot);
    stat.quad([-hx, o.y1, ze], [hx, o.y1, ze], [hx, H, ze], [-hx, H, ze], c);
    // 镜框：只画四条边（lead 集成，WP5 契约申请；以前是一整块实心面，把开口和镜中替身全挡住了）
    const fw = 0.04, fy = (o.y0 + o.y1) / 2, fh = o.y1 - o.y0 + 2 * fw;
    stat.box([0, o.y1 + fw / 2, ze + 0.02], [2 * hx + 2 * fw, fw, 0.02], 0x9ba5a9, { faces: '+z' });
    stat.box([0, o.y0 - fw / 2, ze + 0.02], [2 * hx + 2 * fw, fw, 0.02], 0x9ba5a9, { faces: '+z' });
    stat.box([-hx - fw / 2, fy, ze + 0.02], [fw, fh, 0.02], 0x9ba5a9, { faces: '+z' });
    stat.box([hx + fw / 2, fy, ze + 0.02], [fw, fh, 0.02], 0x9ba5a9, { faces: '+z' });
    // 镜中房间（端墙后方）
    const zb = ze - ROOM_DEPTH;
    stat.quad([-hx, 0.001, ze], [hx, 0.001, ze], [hx, 0.001, zb], [-hx, 0.001, zb], 0x1a2328);
    stat.quad([-hx, 0, zb], [hx, 0, zb], [hx, H, zb], [-hx, H, zb], 0x121a1f);
    stat.quad([-hx, 0, ze], [-hx, 0, zb], [-hx, H, zb], [-hx, H, ze], 0x1a2328);
    stat.quad([hx, 0, zb], [hx, 0, ze], [hx, H, ze], [hx, H, zb], 0x1a2328);
    stat.quad([-hx, H, zb], [hx, H, zb], [hx, H, ze], [-hx, H, ze], 0x1a2328);
  }
  // 天花板
  stat.quad([-HALF, H, -L], [HALF, H, -L], [HALF, H, 0], [-HALF, H, 0], st.ceiling);

  // —— 陈设 ——
  const inOpening = (sideKey: 'L' | 'R', s: number, pad = 0.6) => ctx.openings.some((o) => o.side === sideKey && s > o.s0 - pad && s < o.s1 + pad);
  if (st.doors) {
    // 每 7 m 一扇门，左右交替；避开开口
    for (let s = Math.ceil(ctx.s0 / 7) * 7 + 2; s < ctx.s1 - 0.6; s += 7) {
      const side: -1 | 1 = Math.round(s / 7) % 2 === 0 ? -1 : 1;
      if (inOpening(side < 0 ? 'L' : 'R', s, 1.2)) continue;
      const x = side * (HALF - 0.012);
      const za = z(s - 0.45), zb = z(s + 0.45);
      if (side < 0) {
        stat.quad([x, 0, za], [x, 0, zb], [x, 2.1, zb], [x, 2.1, za], 0x3e4546);
        stat.quad([x + 0.002, 2.1, za + 0.06], [x + 0.002, 2.1, zb - 0.06], [x + 0.002, 2.18, zb - 0.06], [x + 0.002, 2.18, za + 0.06], 0x9ba5a9);
      } else {
        stat.quad([x, 0, zb], [x, 0, za], [x, 2.1, za], [x, 2.1, zb], 0x3e4546);
        stat.quad([x - 0.002, 2.1, zb - 0.06], [x - 0.002, 2.1, za + 0.06], [x - 0.002, 2.18, za + 0.06], [x - 0.002, 2.18, zb - 0.06], 0x9ba5a9);
      }
    }
  }
  if (st.windowsL) {
    // 左墙上方的窗：发光（§5「发光的东西只有灯管和窗」）
    for (let s = Math.ceil(ctx.s0 / 3.2) * 3.2 + 0.6; s < ctx.s1 - 0.4; s += 3.2) {
      if (inOpening('L', s, 1.2)) continue;
      const x = -HALF + 0.012;
      const za = z(s - 0.7), zb = z(s + 0.7);
      emi.quad([x, 1.55, za], [x, 1.55, zb], [x, 2.55, zb], [x, 2.55, za], 0xc4d1d8);
      stat.quad([x + 0.004, 2.02, za], [x + 0.004, 2.02, zb], [x + 0.004, 2.06, zb], [x + 0.004, 2.06, za], 0x9ba5a9);
    }
  }
  if (st.desks) {
    // 两侧课桌（桌面 0.72 m，腿细长）——低机位里只看得见桌腿
    for (let s = Math.ceil(ctx.s0 / 1.3) * 1.3 + 0.3; s < ctx.s1 - 0.3; s += 1.3) {
      for (const side of [-1, 1] as const) {
        const cx = side * 1.6;
        stat.box([cx, 0.73, z(s)], [0.4, 0.03, 0.5], 0xa8a294);
        for (const dx of [-0.17, 0.17]) for (const dz of [-0.21, 0.21]) stat.box([cx + dx, 0.36, z(s) + dz], [0.03, 0.72, 0.03], 0x5b6468);
      }
    }
  }
  if (st.stalls) {
    // 右侧隔间板（每 1.2 m 一块）
    for (let s = Math.ceil(ctx.s0 / 1.2) * 1.2; s < ctx.s1; s += 1.2) {
      stat.box([HALF - 0.2, 1.05, z(s)], [0.4, 1.8, 0.035], 0x9aa3a4);
    }
  }
  if (st.sinks) {
    for (let s = Math.ceil(ctx.s0 / 1.6) * 1.6 + 0.8; s < ctx.s1 - 0.4; s += 1.6) {
      stat.box([-HALF + 0.2, 0.82, z(s)], [0.38, 0.14, 0.5], 0xe6ebee);
      stat.box([-HALF + 0.1, 0.4, z(s)], [0.12, 0.8, 0.12], 0x9ba5a9);
    }
  }

  // —— 灯管：每 2 拍一盏（发光几何 + LampSpec）——
  const lampStep = 2 * stride;
  const j0 = Math.ceil((ctx.s0 - segS0) / lampStep - 1e-6);
  for (let j = j0; segS0 + j * lampStep < ctx.s1 - 1e-6; j++) {
    const s = segS0 + j * lampStep + stride * 0.5;
    if (s >= ctx.s1) break;
    emi.box([0, H - 0.05, z(s)], [0.13, 0.035, 1.15], 0xeef6ff, { faces: '-y+x-x+z-z' });
    stat.box([0, H - 0.015, z(s)], [0.2, 0.03, 1.25], 0x9ba5a9, { faces: '-y' });
    lamps.push({ s, x: 0, y: H - 0.05, kind: 'tube', flickerable: true });
  }

  const f = floor.build();
  const s = stat.build();
  const e = emi.vertexCount ? emi.build() : undefined;
  ctx.mat.ensureChalkAttr(f); ctx.mat.ensureChalkAttr(s); if (e) ctx.mat.ensureChalkAttr(e);
  return e ? { floor: f, static: s, emissive: e, lamps } : { floor: f, static: s, lamps };
}

const AMB: Partial<Record<KitId, AmbienceId>> = { classroom: 'reading', corridor: 'room', washroom: 'room', canteen: 'canteen', labRoom: 'labWind', street: 'rainStreet', plaza: 'dream', track: 'field' };
const REV: Partial<Record<KitId, ReverbId>> = { classroom: 'classroom', corridor: 'corridor', washroom: 'washroom', stairs: 'stairwell', canteen: 'canteen', labRoom: 'classroom', street: 'street', plaza: 'plaza', track: 'street' };

export const placeholderKit: EnvKit = {
  id: 'placeholder', owner: 'CORE', variants: ['default'],
  build: buildPlaceholderChunk,
  ambience: () => 'room',
  reverb: () => 'corridor',
};
/** 按 kit id 推断环境声 / 混响（占位用）。 */
export function placeholderAmbience(kit: KitId): AmbienceId { return AMB[kit] ?? 'room'; }
export function placeholderReverb(kit: KitId): ReverbId { return REV[kit] ?? 'corridor'; }

registerKit(placeholderKit);
