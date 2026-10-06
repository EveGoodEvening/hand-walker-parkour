// src/core/geo.ts —— 画面侧的几何工具（CORE 冻结）。只给 render/** 用；模拟代码不得 import 本文件（它依赖 three）。
// GeoBuilder：累积三角形（位置、法线、顶点色、可选 aChalk、可选 skinIndex），最后生成一个非索引 BufferGeometry。
// 颜色参数是 sRGB 十六进制；写入顶点色前转换到线性空间（three 的 ColorManagement 默认开启）。
import * as THREE from 'three';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export type V3 = readonly [number, number, number];

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly chalk: number[] = [];
  readonly skin: number[] = [];
  /** 当前写入的骨骼下标（刚性蒙皮用）。 */
  bone = 0;
  /** 当前写入的 aChalk 值。 */
  chalkValue = 0;
  /** 可选：对每个顶点先施加的变换。 */
  matrix: THREE.Matrix4 | null = null;

  get vertexCount(): number { return this.pos.length / 3; }

  private push(p: THREE.Vector3, n: THREE.Vector3, color: THREE.Color): void {
    if (this.matrix) { p.applyMatrix4(this.matrix); n.transformDirection(this.matrix); }
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(color.r, color.g, color.b);
    this.chalk.push(this.chalkValue);
    this.skin.push(this.bone);
  }

  /** 三角形（逆时针为正面）。 */
  tri(a: V3, b: V3, c: V3, hex: number): this {
    _c.setHex(hex);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = new THREE.Vector3().crossVectors(_a, _b).normalize();
    for (const p of [a, b, c]) this.push(_v.set(p[0], p[1], p[2]), _n.copy(n), _c);
    return this;
  }

  /** 四边形 a-b-c-d（逆时针为正面）。 */
  quad(a: V3, b: V3, c: V3, d: V3, hex: number): this {
    this.tri(a, b, c, hex);
    this.tri(a, c, d, hex);
    return this;
  }

  /**
   * 轴对齐盒：center 与 size；faces 可只画部分面（'+x','-x','+y','-y','+z','-z'）。
   * colors 可给每个面单独的颜色。
   */
  box(center: V3, size: V3, hex: number, opts: { faces?: string; colors?: Partial<Record<string, number>> } = {}): this {
    const [cx, cy, cz] = center; const [sx, sy, sz] = size;
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const want = (f: string) => !opts.faces || opts.faces.includes(f);
    const col = (f: string) => opts.colors?.[f] ?? hex;
    if (want('+x')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col('+x'));
    if (want('-x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col('-x'));
    if (want('+y')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col('+y'));
    if (want('-y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col('-y'));
    if (want('+z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col('+z'));
    if (want('-z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col('-z'));
    return this;
  }

  /** 沿线段 a→b 的长方体（截面 w × h，h 方向尽量朝上）。 */
  segment(a: V3, b: V3, w: number, h: number, hex: number, opts: { colors?: Partial<Record<string, number>> } = {}): this {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    if (len < 1e-6) return this;
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    const prev = this.matrix;
    this.matrix = prev ? prev.clone().multiply(m) : m;
    this.box([0, 0, 0], [w, h, len], hex, opts);
    this.matrix = prev;
    return this;
  }

  /** 在变换 m 下执行 fn（可嵌套）。 */
  withMatrix(m: THREE.Matrix4, fn: () => void): this {
    const prev = this.matrix;
    this.matrix = prev ? prev.clone().multiply(m) : m.clone();
    fn();
    this.matrix = prev;
    return this;
  }

  build(o: { chalk?: boolean; skin?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (o.chalk !== false) g.setAttribute('aChalk', new THREE.Float32BufferAttribute(this.chalk, 1));
    if (o.skin) {
      const n = this.skin.length;
      const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { idx[i * 4] = this.skin[i] as number; w[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** sRGB 十六进制 → 线性 THREE.Color。 */
export function linearColor(hex: number): THREE.Color { return new THREE.Color().setHex(hex); }

/** 两个颜色按 t 混合（sRGB 十六进制）。 */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
