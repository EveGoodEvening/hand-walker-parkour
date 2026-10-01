// src/render/kits/outside/lib/geo.ts —— WP4 的几何工具（kit 与 set 共用）。
// 在 CORE 的 GeoBuilder（core/geo.ts，冻结）之上加：
//   · 镜像绘制 mirrored()：镜中房间（§5.8「墙上开洞 + 镜中房间」）按镜面把真实房间再画一遍；
//     负行列式会让三角形反向，这里在 tri() 里交换顶点顺序，镜像后的面仍然朝外（否则会被背面剔除）。
//   · face()：按给定法线自动决定绕序的四边形；prism / blob / fan 等低多边形基本体。
// 全部是读章时一次性调用；游戏过程中不建几何体。
import * as THREE from 'three';
import { GeoBuilder, type V3 } from '../../../../core/geo';
import { hashString } from '../../../../core/hash';
import { createRng } from '../../../../core/rng';
import type { Rng } from '../../../../core/types';

export type { V3 };

const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();

export class OGeo extends GeoBuilder {
  /** 为 true 时交换 tri 的 b、c（镜像绘制期间）。 */
  flip = false;
  /** > 0 时 wallX / wallZ / flat 按这个边长细分（烘焙光照需要足够的顶点做渐变）。 */
  cell = 0;
  private inCell = false;
  /**
   * 发光体：之后写入的顶点的 aSteady（WP3 的 kit 约定，docs/contract-requests/WP3.md 2026-09-30）：
   * 1 = 不跟 LampField 明灭（窗、镜中的雾、远处的亮窗）；0 = 跟灯走（灯头、灯的倒影、栏杆灯）。没有 WP3 时这个属性没人读。
   */
  steadyValue = 0;
  readonly steady: number[] = [];

  override tri(a: V3, b: V3, c: V3, hex: number): this {
    if (!this.flip) { super.tri(a, b, c, hex); this.steady.push(this.steadyValue, this.steadyValue, this.steadyValue); return this; }
    super.tri(a, c, b, hex);
    this.steady.push(this.steadyValue, this.steadyValue, this.steadyValue);
    // 交换顶点后 GeoBuilder 按新绕序算出的法线指向背面；取反，镜像后的法线 = R·n
    const nor = this.nor, k = nor.length - 9;
    for (let i = k; i < nor.length; i++) nor[i] = -(nor[i] as number);
    return this;
  }

  /** 以 aSteady = v 执行 fn。 */
  withSteady(v: number, fn: () => void): this {
    const prev = this.steadyValue;
    this.steadyValue = v;
    try { fn(); } finally { this.steadyValue = prev; }
    return this;
  }

  /** 有非零 aSteady（或 o.steady）时多带一个 aSteady 属性。 */
  override build(o: { chalk?: boolean; skin?: boolean; steady?: boolean } = {}): THREE.BufferGeometry {
    const g = super.build(o);
    if (o.steady || this.steady.some((v) => v !== 0)) g.setAttribute('aSteady', new THREE.Float32BufferAttribute(this.steady, 1));
    return g;
  }

  /** 把矩形 [a0, a1] × [b0, b1] 按 cell 切开，逐块调用 fn。 */
  private cells(a0: number, a1: number, b0: number, b1: number, fn: (a: number, b: number, c: number, d: number) => void): void {
    const na = Math.max(1, Math.ceil(Math.abs(a1 - a0) / this.cell - 1e-6)), nb = Math.max(1, Math.ceil(Math.abs(b1 - b0) / this.cell - 1e-6));
    this.inCell = true;
    try {
      for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
        fn(a0 + ((a1 - a0) * i) / na, a0 + ((a1 - a0) * (i + 1)) / na, b0 + ((b1 - b0) * j) / nb, b0 + ((b1 - b0) * (j + 1)) / nb);
      }
    } finally { this.inCell = false; }
  }

  /** 在反射矩阵 R 下执行 fn：R 的行列式为负，绕序自动翻转。 */
  mirrored(R: THREE.Matrix4, fn: () => void): this {
    this.flip = !this.flip;
    this.withMatrix(R, fn);
    this.flip = !this.flip;
    return this;
  }

  /** 四边形 a-b-c-d，绕序按法线 n 自动决定（n 指向「正面」）。 */
  face(a: V3, b: V3, c: V3, d: V3, hex: number, n: V3): this {
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac);
    if (_n.x * n[0] + _n.y * n[1] + _n.z * n[2] >= 0) this.quad(a, b, c, d, hex);
    else this.quad(a, d, c, b, hex);
    return this;
  }

  /** 竖直矩形（平面 x = x0），z ∈ [za, zb]，y ∈ [y0, y1]；facing = 法线方向 ±1。 */
  wallX(x0: number, za: number, zb: number, y0: number, y1: number, hex: number, facing: 1 | -1): this {
    if (y1 - y0 < 1e-5 || Math.abs(zb - za) < 1e-5) return this;
    if (this.cell > 0 && !this.inCell) { this.cells(za, zb, y0, y1, (a, b, c, d) => this.wallX(x0, a, b, c, d, hex, facing)); return this; }
    return this.face([x0, y0, za], [x0, y0, zb], [x0, y1, zb], [x0, y1, za], hex, [facing, 0, 0]);
  }

  /** 竖直矩形（平面 z = z0），x ∈ [xa, xb]，y ∈ [y0, y1]。 */
  wallZ(z0: number, xa: number, xb: number, y0: number, y1: number, hex: number, facing: 1 | -1): this {
    if (y1 - y0 < 1e-5 || Math.abs(xb - xa) < 1e-5) return this;
    if (this.cell > 0 && !this.inCell) { this.cells(xa, xb, y0, y1, (a, b, c, d) => this.wallZ(z0, a, b, c, d, hex, facing)); return this; }
    return this.face([xa, y0, z0], [xb, y0, z0], [xb, y1, z0], [xa, y1, z0], hex, [0, 0, facing]);
  }

  /** 水平矩形（平面 y = y0），x ∈ [xa, xb]，z ∈ [za, zb]；up = 朝上。 */
  flat(y0: number, xa: number, xb: number, za: number, zb: number, hex: number, up = true): this {
    if (Math.abs(xb - xa) < 1e-5 || Math.abs(zb - za) < 1e-5) return this;
    if (this.cell > 0 && !this.inCell) { this.cells(xa, xb, za, zb, (a, b, c, d) => this.flat(y0, a, b, c, d, hex, up)); return this; }
    return this.face([xa, y0, za], [xb, y0, za], [xb, y0, zb], [xa, y0, zb], hex, [0, up ? 1 : -1, 0]);
  }

  /** 竖直 n 棱柱（圆柱近似）；top 为顶盖颜色（null 不画）。 */
  prism(x: number, z: number, y0: number, y1: number, r: number, n: number, hex: number, top: number | null = null, rTop = r): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0: V3 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], p1: V3 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
      const q0: V3 = [x + Math.cos(a0) * rTop, y1, z + Math.sin(a0) * rTop], q1: V3 = [x + Math.cos(a1) * rTop, y1, z + Math.sin(a1) * rTop];
      const am = (a0 + a1) / 2;
      this.face(p0, p1, q1, q0, hex, [Math.cos(am), 0, Math.sin(am)]);
      if (top !== null) this.tri([x, y1, z], q1, q0, top);
    }
    return this;
  }

  /** 低多边形团块（二十面体按 rx/ry/rz 缩放，顶点按 jitter 抖动）。 */
  blob(c: V3, r: V3, hex: number, rng: Rng | null = null, jitter = 0, detail = 0, hex2: number | null = null): this {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    // 同一位置的顶点共享抖动，保证网格不开裂
    const cache = new Map<string, V3>();
    const pt = (i: number): V3 => {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const k = rng && jitter > 0 ? 1 + (rng.next() * 2 - 1) * jitter : 1;
      const v: V3 = [c[0] + x * r[0] * k, c[1] + y * r[1] * k, c[2] + z * r[2] * k];
      cache.set(key, v);
      return v;
    };
    for (let i = 0; i < pos.count; i += 3) {
      const col = hex2 !== null && rng && rng.next() < 0.4 ? hex2 : hex;
      this.tri(pt(i), pt(i + 1), pt(i + 2), col);
    }
    g.dispose();
    return this;
  }

  /** 凸多边形扇形（点按逆时针给出，n 为法线）。 */
  fan(pts: readonly V3[], hex: number, n: V3): this {
    const a = pts[0];
    if (!a) return this;
    for (let i = 1; i + 1 < pts.length; i++) {
      const b = pts[i] as V3, c = pts[i + 1] as V3;
      _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _n.crossVectors(_ab, _ac);
      if (_n.x * n[0] + _n.y * n[1] + _n.z * n[2] >= 0) this.tri(a, b, c, hex);
      else this.tri(a, c, b, hex);
    }
    return this;
  }

  /** 逐顶点颜色的三角形（光晕：中心亮、边缘黑）。不经过 matrix；flip 仍然生效。 */
  gtri(a: V3, b: V3, c: V3, ha: number, hb: number, hc: number): this {
    if (this.flip) { const t = b; b = c; c = t; const h = hb; hb = hc; hc = h; }
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac).normalize();
    for (const [p, h] of [[a, ha], [b, hb], [c, hc]] as const) {
      _col.setHex(h);
      this.pos.push(p[0], p[1], p[2]); this.nor.push(_n.x, _n.y, _n.z); this.col.push(_col.r, _col.g, _col.b);
      this.chalk.push(this.chalkValue); this.skin.push(this.bone); this.steady.push(this.steadyValue);
    }
    return this;
  }

  /** 逐顶点颜色的三角形，绕序按法线 n 自动决定（n 指向「正面」，FrontSide 材质只从这一侧看得见）。 */
  gtriN(a: V3, b: V3, c: V3, ha: number, hb: number, hc: number, n: V3): this {
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac);
    if (_n.x * n[0] + _n.y * n[1] + _n.z * n[2] >= 0) return this.gtri(a, b, c, ha, hb, hc);
    return this.gtri(a, c, b, ha, hc, hb);
  }

  /** 三角形数（非索引几何体）。 */
  get triangles(): number { return this.vertexCount / 3; }
}
const _col = new THREE.Color();

/** 关于平面 x = x0 的反射矩阵。 */
export function reflectX(x0: number): THREE.Matrix4 { return new THREE.Matrix4().set(-1, 0, 0, 2 * x0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); }
/** 关于平面 z = z0 的反射矩阵。 */
export function reflectZ(z0: number): THREE.Matrix4 { return new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 2 * z0, 0, 0, 0, 1); }
/** 平移 + 绕 y 旋转。 */
export function placeY(x: number, y: number, z: number, yaw = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
}

/** 由若干键得到确定性的随机数（与 chunk 边界无关：同一个元素在哪个 chunk 里建都一样）。 */
export function keyRng(...keys: Array<string | number>): Rng {
  return createRng(hashString(keys.join('|')));
}

/** 非索引几何体的三角形数。 */
export function triCount(g: THREE.BufferGeometry | undefined): number {
  if (!g) return 0;
  const idx = g.getIndex();
  if (idx) return idx.count / 3;
  return (g.getAttribute('position')?.count ?? 0) / 3;
}

/**
 * 带 UV 的几何体（set 里贴纹理的面：广告、座椅面料、床单、天花板裂缝、掌心）。只有 position / normal / uv / color。
 * quad 的 UV 按 a-b-c-d 的顺序给出；颜色是乘在纹理上的 sRGB 十六进制（缺省白）。
 */
export class TexGeo {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  private readonly c = new THREE.Color();
  tri(a: V3, b: V3, c: V3, ua: readonly [number, number], ub: readonly [number, number], uc: readonly [number, number], hex = 0xffffff): this {
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_ab, _ac).normalize();
    this.c.setHex(hex);
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as const) {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(_n.x, _n.y, _n.z); this.uv.push(u[0], u[1]); this.col.push(this.c.r, this.c.g, this.c.b);
    }
    return this;
  }
  quad(a: V3, b: V3, c: V3, d: V3, ua: readonly [number, number], ub: readonly [number, number], uc: readonly [number, number], ud: readonly [number, number], hex = 0xffffff): this {
    this.tri(a, b, c, ua, ub, uc, hex);
    this.tri(a, c, d, ua, uc, ud, hex);
    return this;
  }
  get vertexCount(): number { return this.pos.length / 3; }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * 可变形的网格面（被子、床单上的凹陷）：nx × nz 个格子，y 由 height(x, z) 给出；返回几何体和一个重算高度的函数
 * （只改 position 属性，不建新几何体）。UV 按 x、z 的比例铺。
 */
export function heightGrid(x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, uvScale: number,
  height: (x: number, z: number) => number): { geometry: THREE.BufferGeometry; update: (h: (x: number, z: number) => number) => void } {
  const vx = nx + 1, vz = nz + 1;
  const pos = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2), col = new Float32Array(vx * vz * 3).fill(1);
  const xs: number[] = [], zs: number[] = [];
  for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    const k = j * vx + i;
    xs[k] = x; zs[k] = z;
    pos[k * 3] = x; pos[k * 3 + 1] = height(x, z); pos[k * 3 + 2] = z;
    uv[k * 2] = (x - x0) / uvScale; uv[k * 2 + 1] = (z - z0) / uvScale;
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
    // 朝上：z0 < z1 时 (a, c, b) 逆时针
    if (z1 > z0 === x1 > x0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const update = (h: (x: number, z: number) => number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < vx * vz; k++) p.setY(k, h(xs[k] as number, zs[k] as number));
    p.needsUpdate = true;
  };
  return { geometry: g, update };
}

export interface BakeLight { p: V3; color: number; intensity: number; radius: number }
const _lc = new THREE.Color();

/**
 * 把点光源「烘」进顶点色（暗场景的 set 用 Basic 材质 + 烘焙顶点色：半球光只有 0.15–0.2，Lambert 会是一片黑；
 * 灯、电视、窗帘缝这些光源又不能用常驻 PointLight，§5 总则）。只处理 [from, to) 这段顶点：镜中房间用镜像后的灯单独烘。
 * 光照 = ambient + Σ 强度 × 颜色 × 衰减(1 − (d/r)²)² × 半 Lambert(0.3 + 0.7·max(0, n·l))。颜色在线性空间相乘。
 */
export function bakeLights(g: { pos: number[]; nor: number[]; col: number[]; vertexCount: number }, lights: readonly BakeLight[], ambient: number, from = 0, to = g.vertexCount): void {
  bakeArrays(g.pos, g.nor, g.col, lights, ambient, from, to);
}

/** 同上，作用在 BufferGeometry 的 position / normal / color 属性上（可变形网格：被子、床单）。 */
export function bakeGeometry(geo: THREE.BufferGeometry, lights: readonly BakeLight[], ambient: number): void {
  const p = geo.getAttribute('position') as THREE.BufferAttribute, n = geo.getAttribute('normal') as THREE.BufferAttribute, c = geo.getAttribute('color') as THREE.BufferAttribute;
  bakeArrays(p.array as ArrayLike<number>, n.array as ArrayLike<number>, c.array as unknown as number[], lights, ambient, 0, p.count);
  c.needsUpdate = true;
}

function bakeArrays(pos: ArrayLike<number>, nor: ArrayLike<number>, col: { [i: number]: number }, lights: readonly BakeLight[], ambient: number, from: number, to: number): void {
  const L = lights.map((l) => { _lc.setHex(l.color); return { x: l.p[0], y: l.p[1], z: l.p[2], r: _lc.r * l.intensity, g: _lc.g * l.intensity, b: _lc.b * l.intensity, rad: l.radius }; });
  _lc.setHex(ambient);
  const ar = _lc.r, ag = _lc.g, ab = _lc.b;
  for (let v = from; v < to; v++) {
    const px = pos[v * 3] as number, py = pos[v * 3 + 1] as number, pz = pos[v * 3 + 2] as number;
    const nx = nor[v * 3] as number, ny = nor[v * 3 + 1] as number, nz = nor[v * 3 + 2] as number;
    let r = ar, gg = ag, b = ab;
    for (const l of L) {
      const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
      const d = Math.hypot(dx, dy, dz);
      if (d >= l.rad) continue;
      const q = 1 - (d / l.rad) ** 2, f = q * q;
      const ndl = d > 1e-6 ? (nx * dx + ny * dy + nz * dz) / d : 1;
      const k = f * (0.3 + 0.7 * Math.max(0, ndl));
      r += l.r * k; gg += l.g * k; b += l.b * k;
    }
    col[v * 3] = (col[v * 3] as number) * r;
    col[v * 3 + 1] = (col[v * 3 + 1] as number) * gg;
    col[v * 3 + 2] = (col[v * 3 + 2] as number) * b;
  }
}

/** 反射一组烘焙光源（镜中房间用）。 */
export function mirrorLights(lights: readonly BakeLight[], R: THREE.Matrix4): BakeLight[] {
  const v = new THREE.Vector3();
  return lights.map((l) => { v.set(l.p[0], l.p[1], l.p[2]).applyMatrix4(R); return { ...l, p: [v.x, v.y, v.z] as V3 }; });
}
