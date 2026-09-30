// src/render/textures/school.ts —— 校园程序纹理（DESIGN.md §5.9，WP3）。
// terrazzo（底色加两层值噪声；每平方米约 2900 颗 3–6 边形石子，半径 0.6–3.5 px（按 256 px/m 计，随边长缩放），
//   颜色按 35 / 30 / 15 / 12 / 8% 抽取；每 1 m 一道 2 px 铜条）、plaster（水渍、发丝裂纹）、
//   wainscot（离地 5–15 cm 处有黑色鞋踢痕，正好在主角视线高度）、ceiling、tile、chalkboard(text)（每个字按 ±0.8 px 偏移、
//   以 0.35 不透明度画 5 遍，再随机擦掉斑点；tremble 时最后一个字抖动，拖出一道粉笔灰）、doorPlate(text)、dutyRoster。
// 另有 schoolAtlas：chunk 的 static 几何体共用的一张贴图集（墙面灰度细节 + 门牌 + 值日表 + 告示 + 白色区），
// 一个 chunk 仍然只有 1 个 static 材质 = 1 次 draw call。布局见 ATLAS。
import { PAL } from '../palette';
import { CJK_FONT, ctx2d, gray, hex, makeCanvas, paintField, texRng, valueNoise, type Params, type TexGen } from './common';
import type { Rng } from '../../core/types';

type G = CanvasRenderingContext2D;

// ——————————————————— 画家：画进一块矩形区域 ———————————————————
function clipRect(g: G, x: number, y: number, w: number, h: number, fn: () => void): void {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); fn(); g.restore();
}

/** 不规则多边形的顶点（相对中心）。 */
function polygonPts(r: number, sides: number, rot: number, rng: Rng, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
    const rr = r * (0.7 + rng.next() * 0.45);
    out.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return out;
}
function fillPts(g: G, cx: number, cy: number, pts: readonly number[]): void {
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const x = cx + (pts[i] as number), y = cy + (pts[i + 1] as number);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
}

/** 水磨石石子的数量与半径（纯函数，测试用）：pxPerM = 纹理每米像素数。 */
export function terrazzoSpec(pxPerM: number): { count: number; rMin: number; rMax: number } {
  const k = pxPerM / 256;
  return { count: 2900, rMin: 0.6 * k, rMax: 3.5 * k };
}
/** 石子颜色的抽取比例：深 35%、中 30%、浅 15%、白 12%、暖 8%。 */
export const TERRAZZO_MIX: ReadonlyArray<[number, number]> = [
  [PAL.stoneDark, 0.35], [PAL.stoneMid, 0.30], [PAL.stoneLight, 0.15], [PAL.stoneWhite, 0.12], [PAL.stoneWarm, 0.08],
];
export function pickStone(u: number): number {
  let acc = 0;
  for (const [c, w] of TERRAZZO_MIX) { acc += w; if (u < acc) return c; }
  return PAL.stoneDark;
}

function mixc(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** 水磨石：一块 1 m × 1 m（size px），上沿与左沿各一道铜条，可平铺。 */
export const terrazzo: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('terrazzo', p);
  const base = Number(p.base ?? PAL.terrazzo);
  // 底色 + 两层值噪声（大块云斑 + 细颗粒）
  const f1 = valueNoise(size, size, 4, 2, rng), f2 = valueNoise(size, size, 32, 2, rng);
  const f = new Float32Array(size * size);
  for (let i = 0; i < f.length; i++) f[i] = 0.55 * (f1[i] as number) + 0.45 * (f2[i] as number);
  paintField(g, 0, 0, size, size, f, base, 0.9, 1.08);
  // 石子（边缘处在对侧再画一次，保证可平铺）
  const spec = terrazzoSpec(size);
  const n = Math.round(spec.count * Number(p.density ?? 1));
  const pts: number[] = [];
  const edge = spec.rMax * 1.6;
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    const r = spec.rMin + Math.pow(rng.next(), 1.6) * (spec.rMax - spec.rMin);
    const sides = 3 + rng.int(4), rot = rng.next() * Math.PI;
    g.fillStyle = hex(mixc(pickStone(rng.next()), base, 0.28), 0.8);
    polygonPts(r, sides, rot, rng, pts);
    const wx = x < edge ? size : x > size - edge ? -size : 0;
    const wy = y < edge ? size : y > size - edge ? -size : 0;
    fillPts(g, x, y, pts);
    if (wx) fillPts(g, x + wx, y, pts);
    if (wy) fillPts(g, x, y + wy, pts);
    if (wx && wy) fillPts(g, x + wx, y + wy, pts);
  }
  // 铜条：每 1 m 一道 2 px（按 512 px/m 计）
  const bw = Math.max(1, Math.round((2 * size) / 512));
  g.fillStyle = hex(PAL.brass); g.fillRect(0, 0, size, bw); g.fillRect(0, 0, bw, size);
  g.fillStyle = gray(0.2, 0.18); g.fillRect(0, bw, size, 1); g.fillRect(bw, 0, 1, size);
  return c;
};

/** 墙面灰泥（灰度，均值略低于 1）：大面积的斑驳、上沿的水渍（带深色水线）、几道发丝裂纹。可横向平铺。 */
function paintPlaster(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  const f = valueNoise(w, h, 6, 3, rng);
  paintField(g, x0, y0, w, h, f, 0xffffff, 0.9, 1.0);
  clipRect(g, x0, y0, w, h, () => {
    // 水渍：从上沿往下洇，外圈一道深色水线
    for (let i = 0; i < 3; i++) {
      const cx = x0 + rng.next() * w, cy = y0 + rng.next() * h * 0.25, rw = w * (0.05 + rng.next() * 0.08), rh = h * (0.2 + rng.next() * 0.35);
      for (const dx of [0, cx - x0 < rw ? w : cx - x0 > w - rw ? -w : 0]) {
        g.fillStyle = gray(0.8, 0.07); g.beginPath(); g.ellipse(cx + dx, cy, rw, rh, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = gray(0.62, 0.1); g.lineWidth = Math.max(1, w / 500); g.stroke();
      }
    }
    // 发丝裂纹
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      let x = x0 + rng.next() * w, y = y0 + rng.next() * h;
      g.strokeStyle = gray(0.45, 0.35); g.lineWidth = Math.max(0.6, w / 900);
      g.beginPath(); g.moveTo(x, y);
      const n = 5 + rng.int(6);
      for (let k = 0; k < n; k++) { x += (rng.next() - 0.3) * w * 0.03; y += (rng.next() - 0.5) * h * 0.08; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

/** 墙裙（灰度）：滚筒刷的竖纹，离地 5–15 cm 处的黑色鞋踢痕，偶尔掉漆。区域下沿 = 地面，高 hM 米。 */
function paintWainscot(g: G, x0: number, y0: number, w: number, h: number, hM: number, rng: Rng): void {
  const f = valueNoise(w, h, 10, 2, rng);
  paintField(g, x0, y0, w, h, f, 0xffffff, 0.92, 1.0);
  const yAt = (m: number) => y0 + h - (m / hM) * h;
  clipRect(g, x0, y0, w, h, () => {
    // 竖向滚筒纹
    for (let i = 0; i < 60; i++) { g.fillStyle = gray(rng.next() < 0.5 ? 0.9 : 1, 0.05); g.fillRect(x0 + rng.next() * w, y0, Math.max(1, w / 300), h); }
    // 鞋踢痕：离地 5–15 cm
    for (let i = 0; i < 26; i++) {
      const cx = x0 + rng.next() * w, cy = yAt(0.05 + rng.next() * 0.1);
      const len = w * (0.006 + rng.next() * 0.02), th = Math.max(1, h * (0.004 + rng.next() * 0.01));
      g.fillStyle = gray(0.08 + rng.next() * 0.15, 0.2 + rng.next() * 0.35);
      g.beginPath(); g.ellipse(cx, cy, len, th, (rng.next() - 0.5) * 0.35, 0, Math.PI * 2); g.fill();
    }
    // 掉漆的小点（露出底下的浅色）
    for (let i = 0; i < 10; i++) { g.fillStyle = gray(1, 0.35); g.beginPath(); g.arc(x0 + rng.next() * w, yAt(0.1 + rng.next() * 0.8), Math.max(1, w / 500), 0, Math.PI * 2); g.fill(); }
    // 最下沿略暗（与地面交界的积灰）
    const grd = g.createLinearGradient(0, yAt(0.06), 0, yAt(0));
    grd.addColorStop(0, gray(0, 0)); grd.addColorStop(1, gray(0, 0.22));
    g.fillStyle = grd; g.fillRect(x0, yAt(0.06), w, h * (0.06 / hM) + 1);
  });
}

function paintCeiling(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  const f = valueNoise(w, h, 5, 2, rng);
  paintField(g, x0, y0, w, h, f, 0xffffff, 0.9, 1.0);
  clipRect(g, x0, y0, w, h, () => {
    g.strokeStyle = gray(0.7, 0.35); g.lineWidth = Math.max(1, w / 500);
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(x0 + (i / 5) * w, y0); g.lineTo(x0 + (i / 5) * w, y0 + h); g.stroke(); }
    for (let i = 0; i < 2; i++) { g.fillStyle = gray(0.8, 0.2); g.beginPath(); g.ellipse(x0 + rng.next() * w, y0 + rng.next() * h, w * 0.05, h * 0.2, rng.next(), 0, Math.PI * 2); g.fill(); }
  });
}

function paintTile(g: G, x0: number, y0: number, w: number, h: number, n: number, rng: Rng, tileHex: number = PAL.tile, groutHex: number = PAL.grout): void {
  g.fillStyle = hex(groutHex); g.fillRect(x0, y0, w, h);
  const gw = Math.max(1, Math.round(w / n * 0.06));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = 0.95 + rng.next() * 0.07;
    const r = ((tileHex >> 16) & 255) * k, gg = ((tileHex >> 8) & 255) * k, b = (tileHex & 255) * k;
    g.fillStyle = `rgb(${Math.min(255, r) | 0},${Math.min(255, gg) | 0},${Math.min(255, b) | 0})`;
    const x = x0 + (i * w) / n + gw / 2, y = y0 + (j * h) / n + gw / 2;
    g.fillRect(x, y, w / n - gw, h / n - gw);
    // 釉面高光一角
    g.fillStyle = gray(1, 0.08); g.fillRect(x, y, (w / n - gw) * 0.5, (h / n - gw) * 0.12);
  }
}

function paintPlate(g: G, x0: number, y0: number, w: number, h: number, text: string): void {
  g.fillStyle = hex(0xdfe6ea); g.fillRect(x0, y0, w, h);
  g.strokeStyle = hex(0x8a979e); g.lineWidth = Math.max(1, h * 0.06); g.strokeRect(x0 + h * 0.08, y0 + h * 0.08, w - h * 0.16, h - h * 0.16);
  if (!text) return;
  g.fillStyle = hex(0x2a3136); g.font = `bold ${Math.round(h * 0.56)}px ${CJK_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x0 + w / 2, y0 + h * 0.54, w * 0.9);
}

function paintRoster(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  g.fillStyle = hex(0xdfe3e2); g.fillRect(x0, y0, w, h);
  g.fillStyle = hex(0x3a464d); g.font = `bold ${Math.round(h * 0.07)}px ${CJK_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('值日表', x0 + w / 2, y0 + h * 0.08);
  const gx0 = x0 + w * 0.06, gy0 = y0 + h * 0.16, gw = w * 0.88, gh = h * 0.78;
  g.strokeStyle = hex(0x50606a, 0.8); g.lineWidth = Math.max(1, w / 150);
  for (let i = 0; i <= 5; i++) { g.beginPath(); g.moveTo(gx0 + (i / 5) * gw, gy0); g.lineTo(gx0 + (i / 5) * gw, gy0 + gh); g.stroke(); }
  for (let j = 0; j <= 8; j++) { g.beginPath(); g.moveTo(gx0, gy0 + (j / 8) * gh); g.lineTo(gx0 + gw, gy0 + (j / 8) * gh); g.stroke(); }
  // 手写的名字（只画笔画，不写真名）
  g.strokeStyle = hex(0x2f4a6d, 0.7); g.lineWidth = Math.max(1, w / 220);
  for (let i = 0; i < 5; i++) for (let j = 1; j < 8; j++) {
    if (rng.next() < 0.25) continue;
    const cx = gx0 + ((i + 0.5) / 5) * gw, cy = gy0 + ((j + 0.5) / 8) * gh;
    g.beginPath(); g.moveTo(cx - gw * 0.06, cy);
    for (let k = 0; k < 5; k++) g.lineTo(cx - gw * 0.06 + (k + 1) * gw * 0.024, cy + (rng.next() - 0.5) * gh * 0.05);
    g.stroke();
  }
  // 翘起的一角、四枚图钉的影子
  g.fillStyle = gray(0.3, 0.25);
  for (const [a, b] of [[0.04, 0.03], [0.96, 0.03], [0.04, 0.97], [0.96, 0.97]] as const) { g.beginPath(); g.arc(x0 + a * w, y0 + b * h, Math.max(1, w * 0.015), 0, Math.PI * 2); g.fill(); }
}

function paintNotice(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  g.fillStyle = hex(0xdfe3e2); g.fillRect(x0, y0, w, h);
  g.fillStyle = hex(0x50606a, 0.8); g.fillRect(x0 + w * 0.1, y0 + h * 0.07, w * 0.8, h * 0.06);
  g.strokeStyle = hex(0x50606a, 0.45); g.lineWidth = Math.max(1, h / 160);
  for (let j = 0; j < 12; j++) {
    const y = y0 + h * (0.2 + j * 0.055), l = w * (0.55 + rng.next() * 0.3);
    g.beginPath(); g.moveTo(x0 + w * 0.1, y); g.lineTo(x0 + w * 0.1 + l, y); g.stroke();
  }
  g.fillStyle = gray(0.3, 0.3); g.beginPath(); g.arc(x0 + w * 0.5, y0 + h * 0.03, Math.max(1, w * 0.02), 0, Math.PI * 2); g.fill();
}

function paintPoster(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  const grd = g.createLinearGradient(0, y0, 0, y0 + h);
  grd.addColorStop(0, hex(0x9fc3d6)); grd.addColorStop(1, hex(0x50606a));
  g.fillStyle = grd; g.fillRect(x0, y0, w, h);
  // 抽象的跑步剪影（不写字）：几道斜线
  g.strokeStyle = gray(0.92, 0.65); g.lineWidth = Math.max(1, w * 0.035); g.lineCap = 'round';
  for (let i = 0; i < 4; i++) { const y = y0 + h * (0.35 + i * 0.1); g.beginPath(); g.moveTo(x0 + w * (0.15 + rng.next() * 0.1), y); g.lineTo(x0 + w * (0.7 + rng.next() * 0.15), y - h * 0.06); g.stroke(); }
  g.fillStyle = gray(0.92, 0.7); g.fillRect(x0 + w * 0.12, y0 + h * 0.82, w * 0.76, h * 0.05);
}

/** 教室黑板（区域版）：底色与擦过的粉笔雾。 */
function paintBoardHaze(g: G, x0: number, y0: number, w: number, h: number, rng: Rng): void {
  g.fillStyle = hex(PAL.blackboard); g.fillRect(x0, y0, w, h);
  clipRect(g, x0, y0, w, h, () => {
    g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      g.strokeStyle = gray(0.9, 0.03 + rng.next() * 0.05); g.lineWidth = h * (0.08 + rng.next() * 0.2);
      const cx = x0 + rng.next() * w, cy = y0 + rng.next() * h;
      g.beginPath(); g.arc(cx, cy, w * (0.05 + rng.next() * 0.15), rng.next() * 6, rng.next() * 6 + 1.5); g.stroke();
    }
  });
}

// ——————————————————— 独立纹理 ———————————————————
export const plaster: TexGen = (size, p) => { const c = makeCanvas(size, size / 2); const g = ctx2d(c); if (g) paintPlaster(g, 0, 0, size, size / 2, texRng('plaster', p)); return c; };
export const wainscot: TexGen = (size, p) => { const c = makeCanvas(size, size / 4); const g = ctx2d(c); if (g) paintWainscot(g, 0, 0, size, size / 4, 1.1, texRng('wainscot', p)); return c; };
export const ceiling: TexGen = (size, p) => { const c = makeCanvas(size, size / 2); const g = ctx2d(c); if (g) paintCeiling(g, 0, 0, size, size / 2, texRng('ceiling', p)); return c; };
/** 瓷砖：p.n 块 × p.n 块（缺省 4，即 0.3 m 一块时覆盖 1.2 m），p.tile / p.grout 可换色。 */
export const tile: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c);
  if (g) paintTile(g, 0, 0, size, size, Number(p.n ?? 4), texRng('tile', p), Number(p.tile ?? PAL.tile), Number(p.grout ?? PAL.grout));
  return c;
};
/** 门牌（4:1）。 */
export const doorPlate: TexGen = (size, p) => { const c = makeCanvas(size, size / 4); const g = ctx2d(c); if (g) paintPlate(g, 0, 0, size, size / 4, String(p.text ?? '')); return c; };
export const dutyRoster: TexGen = (size, p) => { const c = makeCanvas(size * 0.75, size); const g = ctx2d(c); if (g) paintRoster(g, 0, 0, size * 0.75, size, texRng('dutyRoster', p)); return c; };

/**
 * 黑板（2:1）：底色、擦过的粉笔雾；text 的每个字按 ±0.8 px 偏移、0.35 不透明度画 5 遍，再随机擦掉斑点；
 * tremble = 1 时最后一个字抖动，从尾端拖出一道细长的粉笔灰。p.text 为空时只有擦过的雾。
 */
export const chalkboard: TexGen = (size, p) => {
  const w = size, h = size / 2;
  const c = makeCanvas(w, h); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('chalkboard', p);
  paintBoardHaze(g, 0, 0, w, h, rng);
  paintChalkText(g, w, h, size, p, rng, false);
  return c;
};

/** 只有粉笔字的透明层（Board 叠在擦过的黑板上，写 / 擦按 uniform 显隐）。 */
export const chalkText: TexGen = (size, p) => {
  const c = makeCanvas(size, size / 2); const g = ctx2d(c); if (!g) return c;
  paintChalkText(g, size, size / 2, size, p, texRng('chalkboard', p), true);
  return c;
};

function paintChalkText(g: G, w: number, h: number, size: number, p: Params, rng: Rng, transparent: boolean): void {
  const text = String(p.text ?? '');
  if (!text) return;
  const chars = Array.from(text);
  const fs = Math.min(h * 0.2, (w * 0.86) / Math.max(4, chars.length));
  g.font = `${Math.round(fs)}px ${CJK_FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  const k = size / 512;
  const x0 = (w - fs * chars.length) / 2, y = h * 0.45;
  const tremble = Number(p.tremble ?? 0) > 0;
  chars.forEach((ch, i) => {
    const last = i === chars.length - 1 && tremble;
    for (let pass = 0; pass < 5; pass++) {
      const dx = (rng.next() - 0.5) * 1.6 * k, dy = (rng.next() - 0.5) * 1.6 * k;
      g.fillStyle = hex(PAL.chalkText, 0.35);
      if (last) {
        g.save(); g.translate(x0 + i * fs + fs / 2, y); g.rotate((rng.next() - 0.5) * 0.12);
        g.fillText(ch, -fs / 2 + dx + Math.sin(pass * 2.1) * 1.5 * k, dy + Math.cos(pass * 1.7) * 1.5 * k); g.restore();
      } else g.fillText(ch, x0 + i * fs + dx, y + dy);
    }
  });
  // 随机擦掉的斑点
  g.save();
  if (transparent) g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    g.fillStyle = transparent ? 'rgba(0,0,0,0.55)' : hex(PAL.blackboard, 0.55);
    g.beginPath(); g.arc(x0 + rng.next() * fs * chars.length, y + (rng.next() - 0.5) * fs, (0.6 + rng.next() * 1.4) * k, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  if (tremble) {
    // 粉笔灰从最后一个字的尾端洒下来，拖出一道细长的白痕
    const tx = x0 + chars.length * fs - fs * 0.2, ty = y + fs * 0.35;
    for (let i = 0; i < 140; i++) {
      const u = rng.next();
      g.fillStyle = hex(PAL.chalkText, 0.5 * (1 - u));
      g.fillRect(tx + u * fs * 0.9 + (rng.next() - 0.5) * 2 * k, ty + u * h * 0.28 + (rng.next() - 0.5) * 3 * k, 1.2 * k, 1.2 * k);
    }
    g.strokeStyle = hex(PAL.chalkText, 0.35); g.lineWidth = 1.5 * k;
    g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + fs * 0.5, ty + h * 0.12, tx + fs * 0.9, ty + h * 0.28); g.stroke();
  }
}

// ——————————————————— 校园贴图集（chunk static 共用） ———————————————————
/** 贴图集布局：16 × 16 个单位（每单位 size/16 px），矩形用 uv（v 向上）。 */
const U = (x0: number, y0: number, x1: number, y1: number) => [x0 / 16, 1 - y1 / 16, x1 / 16, 1 - y0 / 16] as const;
export const ATLAS = {
  /** 灰泥：3.2 m × 1.6 m 的墙面灰度细节。 */
  plaster: U(0, 0, 10, 5),
  /** 墙裙：3.2 m 宽，下沿 = 地面，高 1.1 m。 */
  wainscot: U(0, 5, 10, 8),
  /** 天花板：3.2 m × 0.96 m。 */
  ceiling: U(0, 8, 10, 11),
  /** 墙面瓷砖：0.9 m × 0.9 m，6 × 6 块。 */
  tile: U(10, 0, 16, 6),
  /** 门牌（4 个，4:1）：0、1 给关卡数据里的门牌，2、3 是通用班牌。 */
  plates: [U(10, 6, 16, 7.5), U(10, 7.5, 16, 9), U(10, 9, 16, 10.5), U(10, 10.5, 16, 12)] as const,
  roster: U(0, 11, 4, 16),
  notice: U(4, 11, 7, 16),
  board: U(7, 11, 13, 14),
  poster: U(10, 14, 13, 16),
  white: U(13, 12, 16, 16),
} as const;
export const ATLAS_WHITE_UV: readonly [number, number] = [(ATLAS.white[0] + ATLAS.white[2]) / 2, (ATLAS.white[1] + ATLAS.white[3]) / 2];
/** 墙面贴图的平铺周期（米）。 */
export const WALL_PERIOD = 3.2;
/** 通用班牌上的字（不含 7 班：7 班只在关卡数据里出现）。 */
export const GENERIC_PLATES = ['高二（6）班', '高二（8）班'] as const;

/** p.plates = 'a|b'：关卡数据里的门牌文字（最多 2 个）。 */
export const schoolAtlas: TexGen = (size, p) => { const c = makeCanvas(size, size); paintSchoolAtlas(c, p); return c; };

/** 在已有画布上重画贴图集（World 读章时换门牌文字用，不新建纹理）。 */
export function paintSchoolAtlas(c: HTMLCanvasElement, p: Params): void {
  const g = ctx2d(c); if (!g) return;
  const size = c.width;
  const rng = texRng('schoolAtlas', {});
  const u = size / 16;
  const R = (r: readonly [number, number, number, number]) => [r[0] * size, (1 - r[3]) * size, (r[2] - r[0]) * size, (r[3] - r[1]) * size] as const;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  { const [x, y, w, h] = R(ATLAS.plaster); paintPlaster(g, x, y, w, h, rng); }
  { const [x, y, w, h] = R(ATLAS.wainscot); paintWainscot(g, x, y, w, h, 1.1, rng); }
  { const [x, y, w, h] = R(ATLAS.ceiling); paintCeiling(g, x, y, w, h, rng); }
  { const [x, y, w, h] = R(ATLAS.tile); paintTile(g, x, y, w, h, 6, rng, 0xf4f6f6, 0xb9c0c1); }
  const texts = String(p.plates ?? '').split('|').filter(Boolean).slice(0, 2);
  const plates = [texts[0] ?? '', texts[1] ?? '', GENERIC_PLATES[0], GENERIC_PLATES[1]];
  ATLAS.plates.forEach((r, i) => { const [x, y, w, h] = R(r); paintPlate(g, x + 1, y + 1, w - 2, h - 2, plates[i] ?? ''); });
  { const [x, y, w, h] = R(ATLAS.roster); paintRoster(g, x + u * 0.1, y + u * 0.1, w - u * 0.2, h - u * 0.2, rng); }
  { const [x, y, w, h] = R(ATLAS.notice); paintNotice(g, x + u * 0.1, y + u * 0.1, w - u * 0.2, h - u * 0.2, rng); }
  { const [x, y, w, h] = R(ATLAS.board); paintBoardHaze(g, x, y, w, h, rng); }
  { const [x, y, w, h] = R(ATLAS.poster); paintPoster(g, x + u * 0.1, y + u * 0.1, w - u * 0.2, h - u * 0.2, rng); }
  { const [x, y, w, h] = R(ATLAS.white); g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h); }
}

export const SCHOOL_TEXTURES: Record<string, TexGen> = {
  terrazzo, plaster, wainscot, ceiling, tile, chalkboard, chalkText, doorPlate, dutyRoster, schoolAtlas,
};
/** 需要重复平铺的纹理 id。 */
export const TILEABLE = new Set(['terrazzo', 'plaster', 'wainscot', 'ceiling', 'tile', 'noise', 'chalkNoise']);
export type { Params };
