// src/render/sets/outside/lib/setkit.ts —— WP4 静场 set 的公共工具（DESIGN.md §5、§5.8、§5.9、§8.4 StillSet）。
// 材质只经 ViewContext.mat（WP3 的 MaterialsAPI；合并前用 CORE 桩）创建：Lambert（顶点色、平面着色）与 Basic。
// 每个 set ≤ 12 次 draw call（§8.10 WP4 验收 1）；这里每加一个 mesh 就是一次 draw call，count 字段记账，单元测试核对。
import * as THREE from 'three';
import type { ViewContext } from '../../../../core/contracts';
import { registerOutdoorTextures, type TexParams } from '../../../textures/outdoor';
import { C, mix, shade } from '../../../kits/outside/lib/colors';
import { type OGeo, type TexGeo, type V3 } from '../../../kits/outside/lib/geo';

export class SetBuild {
  readonly root = new THREE.Group();
  constructor(readonly ctx: ViewContext, name: string) {
    this.root.name = name;
    registerOutdoorTextures(ctx.tex);
  }

  private add(mesh: THREE.Mesh, name: string, order?: number): THREE.Mesh {
    mesh.name = name;
    if (order !== undefined) mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    return mesh;
  }

  /** 顶点色 Lambert（静态陈设）。 */
  lambert(g: OGeo, name = 'static'): THREE.Mesh {
    const geo = g.build();
    this.ctx.mat.ensureChalkAttr(geo);
    return this.add(new THREE.Mesh(geo, this.ctx.mat.lambert({ vertexColors: true, flat: true })), name);
  }
  /** 烘焙了光照的顶点色 Basic（暗场景：bakeLights 之后用它；不受半球光影响，雾照常）。 */
  baked(g: OGeo, name = 'baked'): THREE.Mesh {
    const geo = g.build();
    this.ctx.mat.ensureChalkAttr(geo);
    const m = this.ctx.mat.basic({ color: 0xffffff });
    m.vertexColors = true;
    return this.add(new THREE.Mesh(geo, m), name);
  }
  /** 贴纹理的 Basic（暗场景里烘焙过顶点色的贴图面：天花板、广告、座椅面料）。 */
  texturedBasic(g: TexGeo | THREE.BufferGeometry, tex: string, p: TexParams = {}, name = tex, repeat = false): THREE.Mesh {
    const geo = g instanceof THREE.BufferGeometry ? g : g.build();
    const m = this.ctx.mat.basic({ color: 0xffffff, map: this.texture(tex, p, repeat) });
    m.vertexColors = true;
    return this.add(new THREE.Mesh(geo, m), name);
  }
  /** 顶点色 Basic（发光体：灯、亮着的屏幕、窗光）。 */
  emissive(g: OGeo, name = 'emissive'): THREE.Mesh {
    const geo = g.build();
    const m = this.ctx.mat.basic({ color: 0xffffff });
    m.vertexColors = true;
    return this.add(new THREE.Mesh(geo, m), name);
  }
  /** 加法混合的光晕（顶点色：中心亮、边缘黑），不写深度。 */
  glow(g: OGeo, name = 'glow', opacity = 1): THREE.Mesh {
    const geo = g.build();
    const m = this.ctx.mat.basic({ color: 0xffffff, additive: true, transparent: true, opacity });
    m.vertexColors = true;
    m.depthWrite = false;
    return this.add(new THREE.Mesh(geo, m), name, 12);
  }
  /** 半透明（玻璃、水汽、水面）。 */
  glass(g: OGeo | TexGeo, opacity: number, name = 'glass', map: THREE.Texture | null = null): THREE.Mesh {
    const geo = g.build();
    const o: { color: number; transparent: boolean; opacity: number; map?: THREE.Texture } = { color: 0xffffff, transparent: true, opacity };
    if (map) o.map = map;
    const m = this.ctx.mat.basic(o);
    m.vertexColors = true;
    m.depthWrite = false;
    return this.add(new THREE.Mesh(geo, m), name, 10);
  }
  /** 贴纹理的 Lambert（广告、面料、床单、天花板裂缝、掌心）。 */
  textured(g: TexGeo | THREE.BufferGeometry, tex: string, p: TexParams = {}, name = tex, repeat = false): THREE.Mesh {
    const geo = g instanceof THREE.BufferGeometry ? g : g.build();
    const map = this.texture(tex, p, repeat);
    const m = this.ctx.mat.lambert({ vertexColors: true, map, flat: true });
    return this.add(new THREE.Mesh(geo, m), name);
  }
  texture(id: string, p: TexParams = {}, repeat = false): THREE.Texture {
    const t = this.ctx.tex.get(id, p);
    if (repeat && t.wrapS !== THREE.RepeatWrapping) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
    return t;
  }
  /** 统计 draw call：可见的 Mesh / Line / Points 各算一次。 */
  static drawCalls(o: THREE.Object3D): number {
    let n = 0;
    o.traverseVisible((c) => { if ((c as THREE.Mesh).isMesh || (c as THREE.Line).isLine || (c as THREE.Points).isPoints) n++; });
    return n;
  }
}

/** 地板上的一圈光（加法：中心 color，边缘黑）。 */
export function glowDisc(g: OGeo, c: V3, r: number, color: number, n = 16, normal: V3 = [0, 1, 0], squash = 1): void {
  const up = Math.abs(normal[1]) > 0.5;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number): V3 => up
      ? [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r * squash]
      : Math.abs(normal[0]) > 0.5 ? [c[0], c[1] + Math.sin(a) * r * squash, c[2] + Math.cos(a) * r] : [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * squash, c[2]];
    // 中心亮、边缘黑（加法混合下黑 = 不加光）；绕序按法线
    const A = p(a0), B = p(a1);
    const cross = [(A[1] - c[1]) * (B[2] - c[2]) - (A[2] - c[2]) * (B[1] - c[1]), (A[2] - c[2]) * (B[0] - c[0]) - (A[0] - c[0]) * (B[2] - c[2]),
      (A[0] - c[0]) * (B[1] - c[1]) - (A[1] - c[1]) * (B[0] - c[0])] as const;
    if (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] >= 0) g.gtri(c, A, B, color, 0, 0);
    else g.gtri(c, B, A, color, 0, 0);
  }
}

/** 一个房间的内表面（地、顶、四墙），墙裙可选；holes: 在某面墙上留的洞（由调用方补边）。 */
export interface RoomSpec {
  x0: number; x1: number; z0: number; z1: number; h: number;
  floor: number; ceiling: number | null; wall: number; wainscot?: { h: number; color: number };
}
export function roomShell(g: OGeo, r: RoomSpec, skip: { north?: boolean; south?: boolean; west?: boolean; east?: boolean } = {}): void {
  g.flat(0, r.x0, r.x1, r.z1, r.z0, r.floor, true);
  if (r.ceiling !== null) g.flat(r.h, r.x0, r.x1, r.z1, r.z0, r.ceiling, false);
  const band = (fn: (y0: number, y1: number, c: number) => void) => {
    if (r.wainscot) { fn(0, r.wainscot.h, r.wainscot.color); fn(r.wainscot.h, r.h, r.wall); } else fn(0, r.h, r.wall);
  };
  if (!skip.north) band((y0, y1, c) => g.wallZ(r.z0, r.x0, r.x1, y0, y1, c, 1));     // z0 = 远端墙（−z），朝 +z
  if (!skip.south) band((y0, y1, c) => g.wallZ(r.z1, r.x0, r.x1, y0, y1, shade(c, 0.95), -1));
  if (!skip.west) band((y0, y1, c) => g.wallX(r.x0, r.z0, r.z1, y0, y1, shade(c, 0.92), 1));
  if (!skip.east) band((y0, y1, c) => g.wallX(r.x1, r.z0, r.z1, y0, y1, shade(c, 0.9), -1));
}

/** 墙上的瓷砖缝（竖、横两组细条），画在平面 x = x0 或 z = z0 上。 */
export function tileLinesZ(g: OGeo, z0: number, xa: number, xb: number, y0: number, y1: number, step: number, color: number, facing: 1 | -1): void {
  for (let x = xa + step; x < xb - 1e-6; x += step) g.wallZ(z0 + facing * 0.002, x - 0.006, x + 0.006, y0, y1, color, facing);
  for (let y = y0 + step; y < y1 - 1e-6; y += step) g.wallZ(z0 + facing * 0.002, xa, xb, y - 0.006, y + 0.006, color, facing);
}
export function tileLinesX(g: OGeo, x0: number, za: number, zb: number, y0: number, y1: number, step: number, color: number, facing: 1 | -1): void {
  const lo = Math.min(za, zb), hi = Math.max(za, zb);
  for (let z = lo + step; z < hi - 1e-6; z += step) g.wallX(x0 + facing * 0.002, z + 0.006, z - 0.006, y0, y1, color, facing);
  for (let y = y0 + step; y < y1 - 1e-6; y += step) g.wallX(x0 + facing * 0.002, hi, lo, y - 0.006, y + 0.006, color, facing);
}

/** 爬行的人（倒影里用；没有五官）：躯干、头、两臂撑地、腿拖在后面。yaw：头朝向（0 = −z）。 */
export function crawlerFigure(g: OGeo, x: number, z: number, yaw: number, body: number, skin: number, s = 1): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (lx: number, ly: number, lz: number): V3 => [x + (lx * c + lz * sn) * s, ly * s, z + (-lx * sn + lz * c) * s];
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: number) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    g.face(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), col, [0, 1, 0]);
    g.face(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), shade(col, 0.9), [sn, 0, c]);
    g.face(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), shade(col, 0.9), [-sn, 0, -c]);
    g.face(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), shade(col, 0.85), [c, 0, -sn]);
    g.face(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), shade(col, 0.85), [-c, 0, sn]);
    g.face(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), shade(col, 0.7), [0, -1, 0]);
  };
  box(0, 0.42, 0.05, 0.34, 0.2, 0.55, body);                 // 躯干（前倾）
  box(0, 0.36, 0.52, 0.28, 0.16, 0.5, shade(body, 0.85));    // 腰腿
  box(0, 0.12, 0.95, 0.26, 0.1, 0.5, C.pants);               // 拖在后面的腿
  box(0, 0.58, -0.33, 0.18, 0.2, 0.2, mix(skin, C.hair, 0.6)); // 头
  box(-0.2, 0.22, -0.2, 0.07, 0.44, 0.07, shade(body, 0.8));  // 手臂撑地
  box(0.2, 0.22, -0.2, 0.07, 0.44, 0.07, shade(body, 0.8));
  box(-0.2, 0.015, -0.24, 0.09, 0.03, 0.1, skin);
  box(0.2, 0.015, -0.24, 0.09, 0.03, 0.1, skin);
}
