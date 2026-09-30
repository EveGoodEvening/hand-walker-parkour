// src/render/textures/outdoor.ts —— WP4 户外纹理（DESIGN.md §5.9 表：asphaltWet、graffitiHand、adRunner、trackRubber、plazaTile、
// ceilingCrack（形状：河 / 手）、palmEye（4 帧眨眼）、bedSheet、skyGradient、busInterior）。
// 每个生成器是纯函数：(size, params) → RGBA 像素（Node 里可测，确定性）；registerOutdoorTextures() 把它们包成 canvas
// 注册进 TextureBank（WP3 实现，CORE 桩回落）。读章时按需生成一次（TextureBank 负责缓存），低画质边长减半由 bank 的 size 决定。
// 颜色：冷色或近乎无彩；皮肤、掌纹取 §5.1 的色值；没有文字、没有暖色。
import type { TextureBank } from '../../core/contracts';

export type TexParams = Readonly<Record<string, string | number>>;
export interface Img { w: number; h: number; data: Uint8ClampedArray }

// ——————————————————— 小工具 ———————————————————

function img(w: number, h: number): Img { return { w, h, data: new Uint8ClampedArray(w * h * 4) }; }
const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function put(im: Img, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const i = (y * im.w + x) * 4;
  im.data[i] = r; im.data[i + 1] = g; im.data[i + 2] = b; im.data[i + 3] = a;
}
function blend(im: Img, x: number, y: number, c: readonly [number, number, number], t: number): void {
  if (t <= 0 || x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4;
  const k = clamp01(t);
  im.data[i] = lerp(im.data[i] as number, c[0], k);
  im.data[i + 1] = lerp(im.data[i + 1] as number, c[1], k);
  im.data[i + 2] = lerp(im.data[i + 2] as number, c[2], k);
}

/** 整数哈希 → [0, 1)。 */
function h2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** 周期为 period 的值噪声（可平铺）。 */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const w = (v: number) => ((v % period) + period) % period;
  const a = h2(w(xi), w(yi), seed), b = h2(w(xi + 1), w(yi), seed), c = h2(w(xi), w(yi + 1), seed), d = h2(w(xi + 1), w(yi + 1), seed);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
function fbm(x: number, y: number, period: number, seed: number, oct = 4): number {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, period * f, seed + i * 17); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}
/** 点到线段的距离。 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function fill(im: Img, hex: number, a = 255): void {
  const [r, g, b] = rgb(hex);
  for (let i = 0; i < im.w * im.h; i++) { im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = a; }
}
/** 在 (px, py) 周围画一条折线的抗锯齿描边。 */
function strokePolyline(im: Img, pts: ReadonlyArray<readonly [number, number]>, width: number, c: readonly [number, number, number], alpha = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i] as readonly [number, number], [bx, by] = pts[i + 1] as readonly [number, number];
    const r = width / 2 + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(im.w - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(im.h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = segDist(x + 0.5, y + 0.5, ax, ay, bx, by);
      const cov = clamp01(width / 2 + 0.5 - d);
      if (cov > 0) blend(im, x, y, c, cov * alpha);
    }
  }
}

// ——————————————————— 生成器 ———————————————————

/** 湿柏油：深色底、骨料颗粒、成片的积水反光（可平铺）。 */
export function genAsphaltWet(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const base = rgb(0x1c2227), wet = rgb(0x2a3a44), dark = rgb(0x11161a);
  const P = 8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * P, v = (y / size) * P;
    const n = fbm(u, v, P, 11);
    const w = sstep(0.55, 0.68, fbm(u * 0.5, v * 0.5, P / 2, 29));
    const g = h2(x, y, 3);
    let r = base[0], gg = base[1], b = base[2];
    const k = (n - 0.5) * 18 + (g < 0.08 ? 16 : g > 0.93 ? -10 : 0);
    r += k; gg += k; b += k;
    r = lerp(r, wet[0], w * 0.7); gg = lerp(gg, wet[1], w * 0.7); b = lerp(b, wet[2], w * 0.7);
    if (g > 0.985) { r = dark[0]; gg = dark[1]; b = dark[2]; }
    put(im, x, y, r, gg, b);
  }
  return im;
}

/** 卷帘门上的手掌涂鸦：透明底，冷白喷漆，五指朝下，边缘毛糙，指尖下面有流挂。 */
export function genGraffitiHand(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const paint = rgb(0xc3ccd0);
  const S = size;
  const palm = { cx: 0.5, cy: 0.3, rx: 0.3, ry: 0.17 };
  const fingers = [[-0.22, 0.34], [-0.075, 0.4], [0.075, 0.39], [0.21, 0.32]] as const;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // 掌：椭圆
    let d = Math.hypot((u - palm.cx) / palm.rx, (v - palm.cy) / palm.ry) - 1;
    d *= palm.ry;
    // 手指：从掌的下沿朝下（v 增大）
    for (const [dx, len] of fingers) {
      const fx = palm.cx + dx;
      d = Math.min(d, segDist(u, v, fx, palm.cy + 0.08, fx, palm.cy + 0.08 + len) - 0.045);
    }
    // 拇指：斜向右下
    d = Math.min(d, segDist(u, v, palm.cx + 0.26, palm.cy + 0.02, palm.cx + 0.42, palm.cy + 0.3) - 0.04);
    // 喷漆的毛边
    const fuzz = (h2(x, y, 7) - 0.5) * 0.012 + (vnoise(u * 40, v * 40, 40, 5) - 0.5) * 0.01;
    const cov = sstep(0.006, -0.004, d + fuzz);
    // 流挂
    let drip = 0;
    for (const [dx, len] of fingers) {
      const fx = palm.cx + dx + 0.01;
      const tip = palm.cy + 0.08 + len;
      if (Math.abs(u - fx) < 0.006 && v > tip && v < tip + 0.06 + h2(Math.round(dx * 100), 1, 3) * 0.08) drip = 0.8;
    }
    const a = Math.max(cov, drip) * (0.85 + h2(x, y, 9) * 0.15);
    put(im, x, y, paint[0], paint[1], paint[2], Math.round(a * 255));
  }
  return im;
}

/** 翘了边的运动鞋广告：冷色底，跑步的人剪影（鞋底离地、双腿弯曲、像刚要起飞），右下角翘起露出纸背。没有字。 */
export function genAdRunner(size: number, _p: TexParams = {}): Img {
  const W = size, H = Math.round(size * 1.4);
  const im = img(W, H);
  const top = rgb(0xb8c6cf), bot = rgb(0x8398a5), fig = rgb(0x26343d), sole = rgb(0xe6ebee), back = rgb(0xc9d0d4), stain = rgb(0x6d808c);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H;
    const n = (fbm(x / W * 6, y / H * 6, 6, 21) - 0.5) * 14;
    put(im, x, y, lerp(top[0], bot[0], t) + n, lerp(top[1], bot[1], t) + n, lerp(top[2], bot[2], t) + n);
  }
  // 跑步的人：胶囊拼出的剪影（单位：W）
  const cap: Array<[number, number, number, number, number]> = [
    [0.52, 0.26, 0.47, 0.5, 0.055],     // 躯干（前倾）
    [0.47, 0.5, 0.62, 0.66, 0.045],     // 前大腿
    [0.62, 0.66, 0.56, 0.84, 0.038],    // 前小腿（弯）
    [0.47, 0.5, 0.36, 0.64, 0.045],     // 后大腿
    [0.36, 0.64, 0.22, 0.6, 0.036],     // 后小腿（向后上抬）
    [0.52, 0.3, 0.64, 0.42, 0.03],      // 前臂
    [0.64, 0.42, 0.72, 0.34, 0.026],
    [0.5, 0.31, 0.38, 0.4, 0.03],       // 后臂
    [0.38, 0.4, 0.33, 0.3, 0.026],
  ];
  const head = { x: 0.55, y: 0.19, r: 0.05 };
  const shoes: Array<[number, number, number, number]> = [[0.53, 0.86, 0.63, 0.87], [0.17, 0.585, 0.25, 0.63]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    let d = Math.hypot(u - head.x, v - head.y) - head.r;
    for (const [ax, ay, bx, by, r] of cap) d = Math.min(d, segDist(u, v, ax, ay, bx, by) - r);
    let s = Infinity;
    for (const [ax, ay, bx, by] of shoes) s = Math.min(s, segDist(u, v, ax, ay, bx, by) - 0.022);
    const px = 1 / W;
    const cf = sstep(px, -px, d), cs = sstep(px, -px, s);
    if (cf > 0) blend(im, x, y, fig, cf);
    if (cs > 0) blend(im, x, y, sole, cs);
    // 地面线：鞋离开地面
    if (Math.abs(v - 0.9) < 0.004) blend(im, x, y, fig, 0.35);
  }
  // 水渍：边缘发深
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = Math.min(x / W, 1 - x / W, y / H, 1 - y / H);
    const k = sstep(0.12, 0.0, e) * (0.3 + fbm(x / W * 5, y / H * 5, 5, 44) * 0.4);
    blend(im, x, y, stain, k * 0.6);
  }
  // 右下角翘起：露出纸背和一道阴影；左上角也翘一点
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = W - x, dy = H - y;
    if (dx + dy < W * 0.2) { put(im, x, y, back[0], back[1], back[2], 255); if (dx + dy > W * 0.19) blend(im, x, y, [40, 48, 54], 0.6); }
    if (x + y < W * 0.07) put(im, x, y, back[0], back[1], back[2], 255);
  }
  return im;
}

/** 塑胶跑道：红褐底 + 橡胶颗粒；左右两边各一条白线（横向平铺时每 1.1 m 一条线）。 */
export function genTrackRubber(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const base = rgb(0x7a4b44), line = rgb(0xcfd3d2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const g = h2(x, y, 13);
    const n = (fbm(x / size * 8, y / size * 8, 8, 5) - 0.5) * 12;
    const k = n + (g < 0.12 ? -14 : g > 0.9 ? 12 : 0);
    put(im, x, y, base[0] + k, base[1] + k * 0.7, base[2] + k * 0.7);
    const u = x / size;
    if (u < 0.022 || u > 0.978) blend(im, x, y, line, 0.92 - (g - 0.5) * 0.1);
  }
  return im;
}

/** 梦中广场的地砖：发白的浅灰，2×2 块，细缝，打磨过的微光（可平铺）。 */
export function genPlazaTile(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const base = rgb(0xc9cfd2), seam = rgb(0xb9c0c3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * 2, v = (y / size) * 2;
    const tile = (Math.floor(u) + Math.floor(v)) % 2;
    const n = (fbm(u * 3, v * 3, 6, 71) - 0.5) * 6 + tile * 3;
    const fu = u - Math.floor(u), fv = v - Math.floor(v);
    const sd = Math.min(fu, 1 - fu, fv, 1 - fv);
    put(im, x, y, base[0] + n, base[1] + n, base[2] + n);
    blend(im, x, y, seam, sstep(0.012, 0.004, sd));
  }
  return im;
}

/** 天花板上的裂缝。shape = 'river'（从墙角蜿蜒到吊灯，像一条安静的河）或 'hand'（像一只张开的手，五根手指朝着你）。 */
export function genCeilingCrack(size: number, p: TexParams = {}): Img {
  const im = img(size, size);
  const shape = p.shape === 'hand' ? 'hand' : 'river';
  const base = rgb(0xb9c0c1), crack = rgb(0x3e4546), halo = rgb(0x8f989a);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (fbm(x / size * 5, y / size * 5, 5, 3) - 0.5) * 10 + (h2(x, y, 2) - 0.5) * 5;
    put(im, x, y, base[0] + n, base[1] + n, base[2] + n);
  }
  const S = size;
  const rnd = (i: number) => h2(i, 0, shape === 'hand' ? 91 : 57);
  const wobble = (pts: Array<[number, number]>, amp: number, seed: number) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i] as [number, number], [bx, by] = pts[i + 1] as [number, number];
      const n = 6;
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const nx = -(by - ay), ny = bx - ax, l = Math.hypot(nx, ny) || 1;
        const o = (h2(i * 7 + j, seed, 5) - 0.5) * amp;
        out.push([lerp(ax, bx, t) + (nx / l) * o, lerp(ay, by, t) + (ny / l) * o]);
      }
    }
    out.push(pts[pts.length - 1] as [number, number]);
    return out;
  };
  const draw = (pts: Array<[number, number]>, wd: number, seed: number) => {
    const px = wobble(pts.map(([u, v]) => [u * S, v * S] as [number, number]), S * 0.018, seed);
    strokePolyline(im, px, wd * S * 2.4, halo, 0.35);
    strokePolyline(im, px, wd * S, crack, 0.95);
  };
  if (shape === 'river') {
    const main: Array<[number, number]> = [[0.02, 0.05], [0.18, 0.2], [0.26, 0.38], [0.44, 0.44], [0.55, 0.6], [0.72, 0.68], [0.9, 0.9]];
    draw(main, 0.006, 1);
    for (let i = 0; i < 5; i++) {
      const a = main[1 + i] as [number, number];
      const ang = rnd(i) * Math.PI * 2;
      draw([a, [a[0] + Math.cos(ang) * 0.1, a[1] + Math.sin(ang) * 0.1]], 0.0028, 10 + i);
    }
  } else {
    // 掌根在下，五根手指朝上（天花板正对着躺着的人：「五根手指朝着我的方向」）
    const c: [number, number] = [0.5, 0.62];
    draw([[0.5, 0.95], [0.48, 0.8], c], 0.007, 1);
    const tips: Array<[number, number]> = [[0.2, 0.46], [0.33, 0.2], [0.5, 0.12], [0.66, 0.2], [0.8, 0.38]];
    tips.forEach((t, i) => {
      const mid: [number, number] = [lerp(c[0], t[0], 0.45) + (rnd(i) - 0.5) * 0.03, lerp(c[1], t[1], 0.45)];
      draw([c, mid, t], 0.0045 - i * 0.0002, 20 + i);
    });
  }
  return im;
}

/** 掌心里的眼睛：4 帧（睁、半闭、闭、半闭）横排。皮肤、掌纹、掌根茧用 §5.1 的色值；眼白偏冷。 */
export function genPalmEye(size: number, _p: TexParams = {}): Img {
  const F = Math.max(64, Math.round(size / 2));
  const im = img(F * 4, F);
  const skin = rgb(0xc9b8a6), crease = rgb(0x8c8279), callus = rgb(0x9b8f82), white = rgb(0xd3d8d6), iris = rgb(0x3a4046), pupil = rgb(0x0d1216), lid = rgb(0xb8a896);
  const opens = [1, 0.5, 0, 0.5];
  // 掌纹（归一化坐标，y 向下）：生命线（弧）、智慧线、感情线
  const life: Array<[number, number]> = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (0.62 + (i / 16) * 0.55); life.push([0.66 + Math.cos(a) * 0.36, 0.28 + Math.sin(a) * 0.62]); }
  const head: Array<[number, number]> = [[0.3, 0.36], [0.45, 0.43], [0.6, 0.47], [0.8, 0.52]];
  const heart: Array<[number, number]> = [[0.26, 0.24], [0.45, 0.22], [0.62, 0.26], [0.84, 0.28]];
  const eye = { x: 0.43, y: 0.43 };            // 生命线与智慧线交叉处
  for (let f = 0; f < 4; f++) {
    const open = opens[f] as number;
    const ox = f * F;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      const u = x / F, v = y / F;
      const n = (fbm(u * 6, v * 6, 6, 19) - 0.5) * 10 + (h2(x, y, 4) - 0.5) * 4;
      let r = skin[0] + n, g = skin[1] + n, b = skin[2] + n;
      const heel = sstep(0.72, 0.98, v) * 0.7;
      r = lerp(r, callus[0], heel); g = lerp(g, callus[1], heel); b = lerp(b, callus[2], heel);
      put(im, ox + x, y, r, g, b);
    }
    const toPx = (pts: Array<[number, number]>) => pts.map(([u, v]) => [ox + u * F, v * F] as [number, number]);
    strokePolyline(im, toPx(life), F * 0.012, crease, 0.9);
    strokePolyline(im, toPx(head), F * 0.011, crease, 0.9);
    strokePolyline(im, toPx(heart), F * 0.01, crease, 0.8);
    // 细纹
    for (let i = 0; i < 12; i++) {
      const a = h2(i, f, 8) * Math.PI, x0 = 0.2 + h2(i, 1, 8) * 0.6, y0 = 0.15 + h2(i, 2, 8) * 0.7, l = 0.04 + h2(i, 3, 8) * 0.06;
      strokePolyline(im, toPx([[x0, y0], [x0 + Math.cos(a) * l, y0 + Math.sin(a) * l]]), F * 0.004, crease, 0.35);
    }
    // 眼睛：杏仁形；眨眼时上眼睑往下盖（open 1 → 0），下眼睑不动
    const ew = 0.13;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      const u = (x / F - eye.x) / ew, v = (y / F - eye.y);          // v < 0 在上
      const edge = (1 - u * u);
      if (edge <= 0) continue;
      const half = Math.sqrt(edge) * 0.075;
      const inLid = Math.abs(v) < half + 0.012;
      if (inLid) blend(im, ox + x, y, lid, sstep(half + 0.012, half, Math.abs(v)) * 0.55);
      if (open <= 0) continue;
      const top = -half + 2 * half * (1 - open);                     // 上眼睑的位置
      const cov = Math.min(sstep(half + 0.004, half - 0.004, v), sstep(top - 0.004, top + 0.004, v));
      if (cov <= 0) continue;
      const d = Math.hypot(x / F - eye.x, y / F - eye.y);
      let c = white;
      if (d < 0.045) c = iris;
      if (d < 0.02) c = pupil;
      blend(im, ox + x, y, c, cov);
      if (d > 0.028 && d < 0.034 && x / F < eye.x && y / F < eye.y) blend(im, ox + x, y, [226, 232, 236], cov * 0.6);
      // 上眼睑的边
      if (open < 1 && Math.abs(v - top) < 0.006) blend(im, ox + x, y, crease, 0.7);
    }
    // 闭眼：一条线
    if (open === 0) strokePolyline(im, toPx([[eye.x - ew, eye.y], [eye.x, eye.y + 0.01], [eye.x + ew, eye.y]]), F * 0.01, crease, 0.9);
  }
  return im;
}

/** 床单：冷白偏灰，柔和的褶皱与细织纹（可平铺）。 */
export function genBedSheet(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const base = rgb(0xc9d0d6);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const fold = Math.sin((u * 3 + fbm(u * 2, v * 2, 2, 5) * 1.5) * Math.PI * 2) * 0.5 + 0.5;
    const n = (fbm(u * 4, v * 4, 4, 9) - 0.5) * 10 - fold * 12 + ((x + y) % 3 === 0 ? -2 : 0);
    put(im, x, y, base[0] + n, base[1] + n, base[2] + n * 0.9);
  }
  return im;
}

/**
 * 天空：灰度（与雾色相乘；地平线处 = 1 就与背景无缝）。u = 方位（0.5 = 正前方 −z），v = 仰角（0 地平线 → 1 天顶）。
 * kind：'night' 越往上越暗；'dusk' 越往上越灰（第四章「越来越深的灰」）；'dawn' 正前方地平线上一片更亮的光（光从前方来）。
 */
export function genSkyGradient(size: number, p: TexParams = {}): Img {
  const kind = String(p.kind ?? 'night');
  const W = Math.max(16, Math.round(size / 2)), H = Math.max(16, Math.round(size / 2));
  const im = img(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1), v = 1 - y / (H - 1);     // 画布第 0 行是天顶
    let k: number;
    if (kind === 'dawn') {
      const az = Math.cos((u - 0.5) * Math.PI * 2);      // 1 = 正前方
      const glow = Math.pow(clamp01(az), 3) * Math.exp(-v * 5);
      k = 0.8 * (1 - 0.15 * sstep(0, 1, v)) + glow * 0.2;
    } else if (kind === 'dusk') {
      k = 1 - 0.2 * sstep(0, 0.9, v);
    } else {
      k = 1 - 0.45 * sstep(0, 0.8, v) + (vnoise(u * 12, v * 4, 12, 3) - 0.5) * 0.03;
    }
    // 纹理按 sRGB 采样（TextureBank 统一设 SRGBColorSpace）：写入 k 的 sRGB 编码，着色器里取到的就是线性的 k
    const c = Math.round(lin2srgb(clamp01(k)) * 255);
    put(im, x, y, c, c, c);
  }
  return im;
}
function lin2srgb(v: number): number { return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

/** 公交车座椅面料：深蓝灰，斜向小花纹，磨损的地方发白（可平铺）。 */
export function genBusInterior(size: number, _p: TexParams = {}): Img {
  const im = img(size, size);
  const base = rgb(0x2a3844), dash = rgb(0x3d5060), worn = rgb(0x55636d);
  const cell = Math.max(4, Math.round(size / 16));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (h2(x, y, 23) - 0.5) * 8;
    put(im, x, y, base[0] + n, base[1] + n, base[2] + n);
    const cx = x % cell, cy = y % cell;
    if (Math.abs(cx - cy) < cell * 0.12 && cx > cell * 0.25 && cx < cell * 0.75) blend(im, x, y, dash, 0.85);
    const w = sstep(0.62, 0.8, fbm(x / size * 3, y / size * 3, 3, 31));
    blend(im, x, y, worn, w * 0.35);
  }
  return im;
}

/** 全部户外纹理：id → 生成器。 */
export const OUTDOOR_TEXTURES: Readonly<Record<string, (size: number, p: TexParams) => Img>> = {
  asphaltWet: genAsphaltWet, graffitiHand: genGraffitiHand, adRunner: genAdRunner, trackRubber: genTrackRubber, plazaTile: genPlazaTile,
  ceilingCrack: genCeilingCrack, palmEye: genPalmEye, bedSheet: genBedSheet, skyGradient: genSkyGradient, busInterior: genBusInterior,
};

/** 像素 → canvas（浏览器里；Node 没有 document 时抛错，TextureBank 桩在 Node 里不会调用生成器）。 */
export function toCanvas(im: Img): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = im.w; c.height = im.h;
  const g = c.getContext('2d');
  if (g) g.putImageData(new ImageData(new Uint8ClampedArray(im.data), im.w, im.h), 0, 0);
  return c;
}

const registered = new WeakSet<TextureBank>();
/** 把户外纹理注册进 TextureBank（幂等：同一个 bank 只注册一次）。 */
export function registerOutdoorTextures(bank: TextureBank): void {
  if (registered.has(bank)) return;
  registered.add(bank);
  for (const [id, gen] of Object.entries(OUTDOOR_TEXTURES)) bank.register(id, (size, p) => toCanvas(gen(size, p)));
}
