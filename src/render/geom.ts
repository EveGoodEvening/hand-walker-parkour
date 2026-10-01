// src/render/geom.ts —— WP3 的几何累积器（DESIGN.md §5.9：chunk 最多 3 个合并几何体）。
// 与 core/geo.ts 的 GeoBuilder 相比：每个顶点可以有自己的颜色（假 AO 渐变）、有 uv（校园贴图集），不写法线
// （材质一律 flatShading，法线由屏幕空间导数求得，省 12 B/顶点），可选 aSteady（发光体里不跟灯走的部分，如窗）。
// 颜色参数是 sRGB 十六进制（写入前转换到线性空间，THREE.Color.setHex），或者直接给线性 RGB（墙面的受光补偿，见 wallTone.ts，可以 > 1）。
import * as THREE from 'three';

export type V3 = readonly [number, number, number];
export type UV = readonly [number, number];
/** 顶点色：sRGB 十六进制，或线性 RGB。 */
export type Col = number | readonly [number, number, number];
/** 贴图集里的矩形（uv，v 向上）：[u0, v0, u1, v1]。 */
export type Rect = readonly [number, number, number, number];

const _c = new THREE.Color();
const _v = new THREE.Vector3();

export interface BoxOpts {
  /** 只画这些面：'+x','-x','+y','-y','+z','-z' 的任意组合。 */
  faces?: string;
  /** 每个面单独的颜色。 */
  colors?: Partial<Record<string, number>>;
  /** 每个面贴图集矩形（整面映射到矩形）；缺省用白色区。 */
  rects?: Partial<Record<string, Rect>>;
  /** 底面到顶面的明暗（假 AO）：侧面下沿颜色乘 bottomShade（缺省 1）。 */
  bottomShade?: number;
}

export class KitGeo {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly chalk: number[] = [];
  readonly steady: number[] = [];
  /** 之后写入的顶点的 aChalk 值（障碍顶边 = 1）。 */
  chalkValue = 0;
  /** 之后写入的顶点的 aSteady 值（发光体：1 = 不跟灯走）。 */
  steadyValue = 0;
  /** 可选：顶点变换（行列式为负时自动翻转三角形绕向，镜像的东西正面仍朝外）。 */
  matrix: THREE.Matrix4 | null = null;
  /**
   * 可选：十六进制颜色写入前的变换（道具的暗色受光补偿，wallTone.ts 的 propTone / kitPropTone）。
   * 只作用于十六进制；直接给的线性 RGB（墙面补偿）原样写入。
   */
  tone: ((hex: number) => Col) | null = null;
  private flip = false;
  /** 没给 uv 时用的坐标（贴图集的白色区中心）。 */
  constructor(readonly whiteUV: UV = [0.9, 0.12]) {}

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.pos.length / 9; }

  private vert(p: V3, hex: Col, shade: number, uv: UV | null): void {
    _v.set(p[0], p[1], p[2]);
    if (this.matrix) _v.applyMatrix4(this.matrix);
    this.pos.push(_v.x, _v.y, _v.z);
    const c = typeof hex === 'number' && this.tone ? this.tone(hex) : hex;
    if (typeof c === 'number') _c.setHex(c);
    else { _c.r = c[0]; _c.g = c[1]; _c.b = c[2]; }
    this.col.push(_c.r * shade, _c.g * shade, _c.b * shade);
    const w = uv ?? this.whiteUV;
    this.uv.push(w[0], w[1]);
    this.chalk.push(this.chalkValue);
    this.steady.push(this.steadyValue);
  }

  /** 三角形（逆时针为正面）。 */
  tri(a: V3, b: V3, c: V3, hex: number): this {
    if (this.flip) { this.vert(a, hex, 1, null); this.vert(c, hex, 1, null); this.vert(b, hex, 1, null); }
    else { this.vert(a, hex, 1, null); this.vert(b, hex, 1, null); this.vert(c, hex, 1, null); }
    return this;
  }

  /**
   * 四边形 a-b-c-d（逆时针为正面）。colors 可以是单色或 4 个顶点各自的颜色；shades 为 4 个顶点的明暗倍率。
   * uvs 为 4 个顶点的 uv（缺省白色区）。
   */
  quad(a: V3, b: V3, c: V3, d: V3, colors: Col | readonly [Col, Col, Col, Col],
    uvs: readonly [UV, UV, UV, UV] | null = null, shades: readonly [number, number, number, number] | null = null): this {
    const one = typeof colors === 'number' || colors.length === 3;
    const ca = (one ? colors : colors[0]) as Col;
    const cb = (one ? colors : colors[1]) as Col;
    const cc = (one ? colors : colors[2]) as Col;
    const cd = (one ? colors : colors[3]) as Col;
    const sa = shades?.[0] ?? 1, sb = shades?.[1] ?? 1, sc = shades?.[2] ?? 1, sd = shades?.[3] ?? 1;
    const ua = uvs?.[0] ?? null, ub = uvs?.[1] ?? null, uc = uvs?.[2] ?? null, ud = uvs?.[3] ?? null;
    if (this.flip) {
      this.vert(a, ca, sa, ua); this.vert(c, cc, sc, uc); this.vert(b, cb, sb, ub);
      this.vert(a, ca, sa, ua); this.vert(d, cd, sd, ud); this.vert(c, cc, sc, uc);
    } else {
      this.vert(a, ca, sa, ua); this.vert(b, cb, sb, ub); this.vert(c, cc, sc, uc);
      this.vert(a, ca, sa, ua); this.vert(c, cc, sc, uc); this.vert(d, cd, sd, ud);
    }
    return this;
  }

  /** 四边形整面映射到贴图集矩形 r：a→(u0,v0)、b→(u1,v0)、c→(u1,v1)、d→(u0,v1)。 */
  quadRect(a: V3, b: V3, c: V3, d: V3, hex: Col, r: Rect, shades: readonly [number, number, number, number] | null = null): this {
    return this.quad(a, b, c, d, hex, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], shades);
  }

  /** 轴对齐盒。 */
  box(center: V3, size: V3, hex: number, o: BoxOpts = {}): this {
    const [cx, cy, cz] = center; const [sx, sy, sz] = size;
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const want = (f: string) => !o.faces || o.faces.includes(f);
    const col = (f: string) => o.colors?.[f] ?? hex;
    const bs = o.bottomShade ?? 1;
    const side: readonly [number, number, number, number] = [bs, bs, 1, 1];
    const put = (f: string, a: V3, b: V3, c: V3, d: V3, shades: readonly [number, number, number, number] | null) => {
      const r = o.rects?.[f];
      if (r) this.quadRect(a, b, c, d, col(f), r, shades);
      else this.quad(a, b, c, d, col(f), null, shades);
    };
    if (want('+x')) put('+x', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    if (want('-x')) put('-x', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    if (want('+y')) put('+y', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], null);
    if (want('-y')) put('-y', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], null);
    if (want('+z')) put('+z', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side);
    if (want('-z')) put('-z', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side);
    return this;
  }

  /** 沿线段 a→b 的方柱（截面 w × h，h 方向尽量朝上）。 */
  segment(a: V3, b: V3, w: number, h: number, hex: number, o: BoxOpts = {}): this {
    const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
    const len = va.distanceTo(vb);
    if (len < 1e-6) return this;
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.withMatrix(m, () => this.box([0, 0, 0], [w, h, len], hex, o));
  }

  /** 竖直的低多边形柱（sides 边），底面中心 base，高 h。只画侧面与顶面。 */
  prism(base: V3, r: number, h: number, sides: number, hex: number, o: { top?: boolean; rot?: number; topHex?: number; bottomShade?: number } = {}): this {
    const [cx, cy, cz] = base;
    const rot = o.rot ?? 0;
    const bs = o.bottomShade ?? 1;
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz - Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz - Math.sin(a1) * r;
      this.quad([x0, cy, z0], [x1, cy, z1], [x1, cy + h, z1], [x0, cy + h, z0], hex, null, [bs, bs, 1, 1]);
      if (o.top !== false) this.tri([cx, cy + h, cz], [x0, cy + h, z0], [x1, cy + h, z1], o.topHex ?? hex);
    }
    return this;
  }

  /** 在变换 m 下执行 fn（可嵌套）。 */
  withMatrix(m: THREE.Matrix4, fn: () => void): this {
    const prev = this.matrix, prevFlip = this.flip;
    this.matrix = prev ? prev.clone().multiply(m) : m.clone();
    this.flip = this.matrix.determinant() < 0;
    fn();
    this.matrix = prev; this.flip = prevFlip;
    return this;
  }

  /** 以粉笔值 v 执行 fn。 */
  withChalk(v: number, fn: () => void): this { const p = this.chalkValue; this.chalkValue = v; fn(); this.chalkValue = p; return this; }
  /** 以颜色变换 t 执行 fn（null = 不变换，例如镜中房间、窗口里调好的暖色）。 */
  withTone(t: ((hex: number) => Col) | null, fn: () => void): this { const p = this.tone; this.tone = t; fn(); this.tone = p; return this; }
  /** 以 aSteady 值 v 执行 fn。 */
  withSteady(v: number, fn: () => void): this { const p = this.steadyValue; this.steadyValue = v; fn(); this.steadyValue = p; return this; }

  /** 追加另一个累积器的全部顶点。 */
  append(o: KitGeo): this {
    this.pos.push(...o.pos); this.col.push(...o.col); this.uv.push(...o.uv); this.chalk.push(...o.chalk); this.steady.push(...o.steady);
    return this;
  }

  /** 生成非索引 BufferGeometry：position、color、uv、aChalk（可选 aSteady）。 */
  build(o: { steady?: boolean; uv?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (o.uv !== false) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aChalk', new THREE.Float32BufferAttribute(this.chalk, 1));
    if (o.steady) g.setAttribute('aSteady', new THREE.Float32BufferAttribute(this.steady, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** 贴图集矩形的子区间：u 方向取 [a, b]（0..1），v 方向取 [c, d]（0..1）。 */
export function subRect(r: Rect, a: number, b: number, c = 0, d = 1): Rect {
  const w = r[2] - r[0], h = r[3] - r[1];
  return [r[0] + w * a, r[1] + h * c, r[0] + w * b, r[1] + h * d];
}
