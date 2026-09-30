// src/render/textures/common.ts —— 通用程序纹理（DESIGN.md §5.9，WP3）。读章时生成一次（CanvasTexture），低画质边长减半。
// noise、chalkNoise、note（空白 / 简笔画 / 折叠 / 背面字）、dirtyGlass、crackLine、lampStreak、lightPool、ring、blobShadow。
// 另外导出给 school.ts / outdoor 使用的画布工具：确定性随机、可平铺的值噪声、灰度写入。
// 所有生成器在没有 document 的环境（Node 单元测试）里不会被调用；getContext 返回 null 时画布保持空白也不抛错。
import { createRng } from '../../core/rng';
import type { Rng } from '../../core/types';

export type Params = Readonly<Record<string, string | number>>;
export type TexGen = (size: number, p: Params) => HTMLCanvasElement;

/** canvas 中文字体栈（§5.9）；无头环境里显示成方块也可以。 */
export const CJK_FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return c.getContext('2d'); } catch { return null; }
}
export function hex(h: number, a = 1): string {
  const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
export function gray(v: number, a = 1): string {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return a >= 1 ? `rgb(${c},${c},${c})` : `rgba(${c},${c},${c},${a.toFixed(3)})`;
}
export function texRng(id: string, p: Params = {}): Rng { return createRng(0x5eed, `${id}:${JSON.stringify(p)}`); }

/**
 * 可平铺的值噪声（周期 period 格），返回 w×h 的 Float32Array（0..1）。octaves 层叠加，每层频率 ×2、幅度 ×0.5。
 */
export function valueNoise(w: number, h: number, period: number, octaves: number, rng: Rng): Float32Array {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const out = new Float32Array(w * h);
  let amp = 1, total = 0, per = Math.max(1, Math.round(period));
  for (let o = 0; o < octaves; o++) {
    const grid = new Float32Array(per * per);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * per, y0 = Math.floor(gy), fy = gy - y0, y1 = (y0 + 1) % per;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * per, x0 = Math.floor(gx), fx = gx - x0, x1 = (x0 + 1) % per;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % per) * per + (x0 % per)] as number, b = grid[(y0 % per) * per + x1] as number;
        const c = grid[y1 * per + (x0 % per)] as number, d = grid[y1 * per + x1] as number;
        const v = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
        out[y * w + x] = (out[y * w + x] as number) + v * amp;
      }
    }
    total += amp; amp *= 0.5; per *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

/** 把灰度场写进画布的一块区域：v → 颜色 base 乘 (lo + (hi − lo) × v)。 */
export function paintField(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, field: Float32Array,
  base: number, lo: number, hi: number): void {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const img = g.createImageData(w, h);
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  for (let i = 0; i < w * h; i++) {
    const k = lo + (hi - lo) * (field[i] as number);
    img.data[i * 4] = Math.min(255, br * k); img.data[i * 4 + 1] = Math.min(255, bg * k); img.data[i * 4 + 2] = Math.min(255, bb * k); img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, Math.round(x0), Math.round(y0));
}

/** 径向柔和圆（白色，alpha 从中心到边缘衰减）。 */
function softDisc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner: number, color: string, alpha: number): void {
  const grd = g.createRadialGradient(cx, cy, r * inner, cx, cy, r);
  grd.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`));
  grd.addColorStop(1, color.replace('rgb(', 'rgba(').replace(')', ',0)'));
  g.fillStyle = grd;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
}

// ——————————————————— 生成器 ———————————————————
/** 可平铺的灰度值噪声（均值约 0.5）。 */
export const noise: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const f = valueNoise(size, size, Number(p.period ?? 8), 4, texRng('noise', p));
  paintField(g, 0, 0, size, size, f, 0xffffff, 0.25, 1);
  return c;
};

/** 粉笔灰颗粒：透明底上的白色细颗粒（粉笔描边、黑板字的质感）。 */
export const chalkNoise: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('chalkNoise', p);
  const n = Math.round(size * size * 0.06);
  for (let i = 0; i < n; i++) {
    g.fillStyle = gray(0.85 + rng.next() * 0.15, 0.15 + rng.next() * 0.5);
    const r = 0.4 + rng.next() * 1.2 * (size / 256);
    g.fillRect(rng.next() * size, rng.next() * size, r, r);
  }
  return c;
};

/**
 * 纸条：face = blank | doodle | folded | back。doodle 画手掌和脚掌的简笔画；back 用 p.text 写一行铅笔小字（被汗晕开一点）。
 * 纸条是全作唯一略带暖意的白 #E6E1D6。
 */
export const note: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('note', p);
  const face = String(p.face ?? 'blank');
  g.fillStyle = hex(0xe6e1d6); g.fillRect(0, 0, size, size);
  // 纸纹与揉皱
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = gray(0.55, 0.05 + rng.next() * 0.05); g.lineWidth = 1 + rng.next() * 2;
    g.beginPath(); const x = rng.next() * size, y = rng.next() * size; g.moveTo(x, y);
    g.lineTo(x + (rng.next() - 0.5) * size * 0.6, y + (rng.next() - 0.5) * size * 0.6); g.stroke();
  }
  // 起毛的边
  g.strokeStyle = gray(0.7, 0.35); g.lineWidth = size * 0.01; g.strokeRect(size * 0.01, size * 0.01, size * 0.98, size * 0.98);
  if (face === 'folded') {
    g.strokeStyle = gray(0.5, 0.35); g.lineWidth = size * 0.008;
    g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke();
  }
  if (face === 'doodle') {
    g.strokeStyle = hex(0x3a464d, 0.8); g.lineWidth = size * 0.012; g.lineCap = 'round';
    // 手掌（五指朝下）与脚掌
    const hand = (cx: number, cy: number, s: number) => {
      g.beginPath(); g.ellipse(cx, cy, s * 0.5, s * 0.6, 0, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 5; k++) { const a = Math.PI * (0.25 + k * 0.125); g.beginPath(); g.moveTo(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.5); g.lineTo(cx + Math.cos(a) * s * 1.05, cy + Math.sin(a) * s * 1.1); g.stroke(); }
    };
    hand(size * 0.3, size * 0.38, size * 0.12);
    g.beginPath(); g.ellipse(size * 0.68, size * 0.4, size * 0.08, size * 0.17, 0.2, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(size * (0.62 + k * 0.03), size * 0.2 - Math.abs(k - 1) * size * 0.01, size * 0.012, 0, Math.PI * 2); g.stroke(); }
    if (p.text) { g.fillStyle = hex(0x3a464d, 0.85); g.font = `${Math.round(size * 0.09)}px ${CJK_FONT}`; g.textAlign = 'center'; g.fillText(String(p.text), size * 0.5, size * 0.82); }
  }
  if (face === 'back' && p.text) {
    g.save(); g.filter = 'blur(0.6px)';
    g.fillStyle = hex(0x50606a, 0.75); g.font = `${Math.round(size * 0.07)}px ${CJK_FONT}`; g.textAlign = 'center';
    g.fillText(String(p.text), size * 0.5, size * 0.55); g.restore();
  }
  return c;
};

/** 擦不干净的玻璃：透明底上的污痕、擦拭弧线、指印（白色，alpha 低）。 */
export const dirtyGlass: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('dirtyGlass', p);
  for (let i = 0; i < 14; i++) softDisc(g, rng.next() * size, rng.next() * size, size * (0.08 + rng.next() * 0.2), 0, 'rgb(230,236,238)', 0.05 + rng.next() * 0.08);
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = gray(0.92, 0.05 + rng.next() * 0.06); g.lineWidth = size * (0.02 + rng.next() * 0.05);
    const cx = rng.next() * size, cy = rng.next() * size, r = size * (0.15 + rng.next() * 0.3);
    g.beginPath(); g.arc(cx, cy, r, rng.next() * 6, rng.next() * 6 + 1.2); g.stroke();
  }
  for (let i = 0; i < 5; i++) softDisc(g, rng.next() * size, rng.next() * size, size * 0.025, 0.4, 'rgb(240,244,246)', 0.12);
  return c;
};

/** 碎角镜的裂纹（透明底，白色细线从一角放射出去）。 */
export const crackLine: TexGen = (size, p) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const rng = texRng('crackLine', p);
  const ox = size * 0.92, oy = size * 0.08;
  g.strokeStyle = gray(0.95, 0.7); g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    let x = ox, y = oy; const a0 = Math.PI * (0.55 + rng.next() * 0.45);
    g.lineWidth = Math.max(1, size * 0.004); g.beginPath(); g.moveTo(x, y);
    const n = 4 + rng.int(4);
    for (let i = 0; i < n; i++) { const a = a0 + (rng.next() - 0.5) * 0.5; const l = size * (0.05 + rng.next() * 0.12); x += Math.cos(a) * l; y -= Math.sin(a) * l * -1; g.lineTo(x, y); }
    g.stroke();
  }
  return c;
};

/** 灯管在湿地面上的倒影（贴花：竖长条，中间亮，两端和边缘柔和）。 */
export const lampStreak: TexGen = (size) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const a = Math.exp(-u * u * 9) * Math.pow(Math.max(0, 1 - v * v), 1.5);
    const i = (y * size + x) * 4; img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
};

/** 光池（路灯下、声控灯下的柔和圆）。 */
export const lightPool: TexGen = (size) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  softDisc(g, size / 2, size / 2, size / 2, 0, 'rgb(255,255,255)', 1);
  return c;
};

/** 细环（掌光环、水洼涟漪）。 */
export const ring: TexGen = (size) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const r = Math.sqrt(u * u + v * v);
    const a = Math.exp(-((r - 0.82) * (r - 0.82)) / 0.004) + 0.15 * Math.max(0, 1 - r);
    const i = (y * size + x) * 4; img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
};

/** 圆形暗斑影子（低画质的贴花影子）。 */
export const blobShadow: TexGen = (size) => {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  softDisc(g, size / 2, size / 2, size / 2, 0.35, 'rgb(255,255,255)', 1);
  return c;
};

export const COMMON_TEXTURES: Record<string, TexGen> = { noise, chalkNoise, note, dirtyGlass, crackLine, lampStreak, lightPool, ring, blobShadow };
