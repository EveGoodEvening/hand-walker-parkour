// src/render/npc/material.ts —— WP6 的材质补丁与几何构建器（DESIGN.md §5、§5.7、§8.4 ArchetypeFactory）。
//
// 「每个原型只有一个 InstancedMesh」（§8.10 WP6 验收 5），但一个原型要画好几种障碍（lowBox = 书包 / 书 / 报纸，
// bucket = 拖把桶 / 标志桶……），形状各不相同。做法：一个原型的几何体里并排放着每种障碍的「变体」，
// 每个顶点带 aHw.x = 变体号（−1 = 所有变体共用）；每个实例带 iHw.x = 要显示的变体号，
// 顶点着色器把不属于本实例变体的顶点收拢到一点（三角形退化，不光栅化）。仍然是 1 个 InstancedMesh、1 次 draw call。
//
// 另外两个逐顶点通道：
//   aHw.y 自发光（glow）：正值 × iHw.y 加进 totalEmissiveRadiance；−1 标记弱化上身（不发光）。
//   aHw.z 着色（tint）：1 = 顶点色乘 instanceColor（衣服颜色）；0 = 保持顶点色（鞋底、手、粉笔白线）。
//         three 默认把 instanceColor 乘到所有顶点上，粉笔白线就会被染色；这里只替换 color_vertex 里那一行。
//
// 补丁是「串接」的：先调用 WP3 LampField 补丁（MaterialsAPI.lambert 返回的材质自带的 onBeforeCompile），
// 再做本补丁；customProgramCacheKey 也串接，保证不和别的材质共用着色器程序。
// 弱化上身用圆滑顶点法线、去饱和色和少量雾色压低对比；保持不透明和深度写入，不做幽灵式透视。
import * as THREE from 'three';
import { GeoBuilder, type V3 } from '../../core/geo';

export const NPC_PROGRAM_KEY = 'hwNpcV2';
/** glow 通道的负值保留给弱化上身；可逐顶点或逐实例指定，不额外增加属性 / draw call。 */
export const SOFT_UPPER = -1;

/** r186 color_vertex 里被替换的那一行（单元测试会检查它还在）。 */
export const INSTANCE_COLOR_LINE = 'vColor.rgb *= instanceColor.rgb;';

const VERT_PARS = /* glsl */`
attribute vec3 aHw;
attribute vec2 iHw;
varying vec3 vHwGlow;
varying float vHwSoft;
`;

function colorVertexChunk(): string {
  const src = THREE.ShaderChunk.color_vertex;
  const body = src.includes(INSTANCE_COLOR_LINE)
    ? src.replace(INSTANCE_COLOR_LINE, 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aHw.z );')
    : src;
  return `${body}
	vHwSoft = clamp( max( -aHw.y, -iHw.y ), 0.0, 1.0 );
	vHwGlow = vec3( 0.0 );
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		vHwGlow = color.rgb * max( aHw.y, 0.0 ) * max( iHw.y, 0.0 );
		if ( vHwSoft > 0.5 ) {
			vec3 cloth = color.rgb;
			#ifdef USE_INSTANCING_COLOR
				cloth = instanceColor.rgb;
			#endif
			float gray = mix( dot( cloth, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.12, 0.55 );
			vColor.rgb = mix( vec3( gray ), cloth, 0.08 );
		}
	#endif
`;
}

const BEGIN_VERTEX = /* glsl */`#include <begin_vertex>
	if ( aHw.x >= 0.0 && abs( aHw.x - iHw.x ) > 0.5 ) transformed = vec3( 0.0 );
`;

export interface ShaderLike { vertexShader: string; fragmentShader: string }

/** 对着色器源码施加变体 / 着色 / 自发光补丁。lit = Lambert（有 totalEmissiveRadiance）。返回是否全部命中。 */
export function patchNpcShader(sh: ShaderLike, lit: boolean): boolean {
  let ok = true;
  const rep = (src: string, find: string, to: string): string => {
    if (!src.includes(find)) { ok = false; return src; }
    return src.replace(find, to);
  };
  const softNormal = lit ? '\nvarying vec3 vHwSoftNormal;' : '';
  sh.vertexShader = rep(sh.vertexShader, '#include <color_pars_vertex>', `#include <color_pars_vertex>\n${VERT_PARS}${softNormal}`);
  sh.vertexShader = rep(sh.vertexShader, '#include <color_vertex>', colorVertexChunk());
  sh.vertexShader = rep(sh.vertexShader, '#include <begin_vertex>', BEGIN_VERTEX);
  sh.fragmentShader = rep(sh.fragmentShader, '#include <color_pars_fragment>', `#include <color_pars_fragment>\nvarying vec3 vHwGlow;\nvarying float vHwSoft;${softNormal}`);
  if (lit) {
    sh.vertexShader = rep(sh.vertexShader, '#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n\tvHwSoftNormal = transformedNormal;');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tif ( vHwSoft > 0.5 ) normal = normalize( vHwSoftNormal );');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vHwGlow;');
    sh.fragmentShader = rep(sh.fragmentShader, '#include <fog_fragment>', `#include <fog_fragment>
	#ifdef USE_FOG
		if ( vHwSoft > 0.5 ) {
			float softRim = 1.0 - abs( dot( normal, normalize( vViewPosition ) ) );
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 0.20 + 0.25 * softRim * softRim );
		}
	#endif`);
  }
  return ok;
}

/** 在材质上串接本补丁（保留原有的 onBeforeCompile，例如 WP3 的 LampField）。 */
export function applyNpcPatch<M extends THREE.Material>(mat: M, lit: boolean): M {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  const tag = `${NPC_PROGRAM_KEY}${lit ? 'L' : 'B'}`;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    patchNpcShader(sh, lit);
  };
  // 原型方法 customProgramCacheKey 默认返回 onBeforeCompile.toString()；这里固定一个前缀 + 本补丁标签
  const base = prevKey === THREE.Material.prototype.customProgramCacheKey ? '' : prevKey.call(mat);
  mat.customProgramCacheKey = () => `${base}|${tag}`;
  return mat;
}

/** 变体、自发光、着色、粉笔、不透明度（只有贴花用）的当前写入状态。 */
export interface PartState { variant: number; glow: number; tint: number; chalk: number; alpha: number }

/**
 * GeoBuilder 的包装：每加一个图元，把新顶点标上当前的 (variant, glow, tint)，粉笔值写进 aChalk。
 * 坐标约定（全 WP6）：x 横向，y 向上，z = −s（+z 朝向玩家 / 镜头一侧）。
 */
export class PartBuilder {
  readonly g = new GeoBuilder();
  private readonly hw: number[] = [];
  private readonly alpha: number[] = [];
  st: PartState = { variant: -1, glow: 0, tint: 0, chalk: 0, alpha: 1 };

  private sync(): void {
    const n = this.g.vertexCount;
    for (let i = this.hw.length / 3; i < n; i++) { this.hw.push(this.st.variant, this.st.glow, this.st.tint); this.alpha.push(this.st.alpha); }
  }

  /** 在给定状态下执行 fn（可嵌套），结束后恢复。 */
  with(o: Partial<PartState>, fn: () => void): this {
    this.sync();
    const prev = this.st;
    this.st = { ...prev, ...o };
    this.g.chalkValue = this.st.chalk;
    fn();
    this.sync();
    this.st = prev;
    this.g.chalkValue = prev.chalk;
    return this;
  }

  /** 变体 v（整数，≥ 0）。 */
  variant(v: number, fn: () => void): this { return this.with({ variant: v }, fn); }

  box(center: V3, size: V3, hex: number, opts: { faces?: string; colors?: Partial<Record<string, number>> } = {}): this {
    this.g.box(center, size, hex, opts); this.sync(); return this;
  }
  segment(a: V3, b: V3, w: number, h: number, hex: number, opts: { colors?: Partial<Record<string, number>> } = {}): this {
    this.g.segment(a, b, w, h, hex, opts); this.sync(); return this;
  }
  quad(a: V3, b: V3, c: V3, d: V3, hex: number): this { this.g.quad(a, b, c, d, hex); this.sync(); return this; }
  tri(a: V3, b: V3, c: V3, hex: number): this { this.g.tri(a, b, c, hex); this.sync(); return this; }
  /**
   * 逐顶点不透明度的三角形（贴花的淡出边缘）：三个顶点分别取 alphas[0..2]，光栅化时插值。
   * with({ alpha }) 只能给整个三角形一个值；外圈若按三角形交替取内外两个值，边缘会变成锯齿（审查 r2）。
   */
  triAlpha(a: V3, b: V3, c: V3, hex: number, alphas: readonly [number, number, number]): this {
    this.g.tri(a, b, c, hex);
    this.sync();
    const n = this.alpha.length;
    this.alpha[n - 3] = alphas[0]; this.alpha[n - 2] = alphas[1]; this.alpha[n - 1] = alphas[2];
    return this;
  }
  withMatrix(m: THREE.Matrix4, fn: () => void): this { this.g.withMatrix(m, fn); this.sync(); return this; }

  /** 竖直的 n 棱柱（近似圆柱 / 圆台）：底面中心 c，底半径 r0，顶半径 r1，高 h。 */
  prism(c: V3, r0: number, r1: number, h: number, n: number, hex: number, opts: { top?: number; bottom?: number | null; rot?: number } = {}): this {
    const [cx, cy, cz] = c;
    const rot = opts.rot ?? Math.PI / n;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; pts.push([Math.cos(a), Math.sin(a)]); }
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i] as [number, number];
      const [bx, bz] = pts[(i + 1) % n] as [number, number];
      this.g.quad([cx + bx * r0, cy, cz + bz * r0], [cx + ax * r0, cy, cz + az * r0], [cx + ax * r1, cy + h, cz + az * r1], [cx + bx * r1, cy + h, cz + bz * r1], hex);
      if (opts.top !== undefined || r1 > 1e-4) this.g.tri([cx, cy + h, cz], [cx + bx * r1, cy + h, cz + bz * r1], [cx + ax * r1, cy + h, cz + az * r1], opts.top ?? hex);
      if (opts.bottom !== null && opts.bottom !== undefined) this.g.tri([cx, cy, cz], [cx + ax * r0, cy, cz + az * r0], [cx + bx * r0, cy, cz + bz * r0], opts.bottom);
    }
    this.sync();
    return this;
  }

  /** 横躺的 n 棱柱：轴沿 x（从 x0 到 x1），轴心在 (y, z)，半径 r。 */
  rodX(x0: number, x1: number, y: number, z: number, r: number, n: number, hex: number): this {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + Math.PI / n, a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
      const y0 = y + Math.sin(a0) * r, z0 = z + Math.cos(a0) * r, y1 = y + Math.sin(a1) * r, z1 = z + Math.cos(a1) * r;
      this.g.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], hex);
    }
    this.sync();
    return this;
  }

  get vertexCount(): number { return this.g.vertexCount; }

  build(): THREE.BufferGeometry {
    this.sync();
    const geo = this.g.build({ chalk: true });
    geo.setAttribute('aHw', new THREE.Float32BufferAttribute(this.hw, 3));
    if (this.alpha.some((a) => a < 1)) {
      // 逐顶点不透明度：颜色改成 RGBA（three 据此定义 USE_COLOR_ALPHA）
      const rgb = geo.getAttribute('color');
      const rgba = new Float32Array(rgb.count * 4);
      for (let i = 0; i < rgb.count; i++) {
        rgba[i * 4] = rgb.getX(i); rgba[i * 4 + 1] = rgb.getY(i); rgba[i * 4 + 2] = rgb.getZ(i); rgba[i * 4 + 3] = this.alpha[i] ?? 1;
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
    }
    return geo;
  }
}

/** 每实例的 iHw（变体、自发光）属性；挂在几何体上。 */
export function instanceHw(geo: THREE.BufferGeometry, cap: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iHw', a);
  return a;
}

/**
 * 读取某个变体的包围盒（Node 可用，单元测试用）：只统计 aHw.x ∈ {−1, v} 的顶点。
 * includeCommon = false 时只统计该变体自己的顶点。
 */
export function variantBounds(geo: THREE.BufferGeometry, v: number, includeCommon = true): THREE.Box3 {
  const pos = geo.getAttribute('position');
  const hw = geo.getAttribute('aHw');
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const vi = hw.getX(i);
    if (!(vi === v || (includeCommon && vi < 0))) continue;
    box.expandByPoint(p.set(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return box;
}

/** 某变体的三角形数（含共用部分）。 */
export function variantTriangles(geo: THREE.BufferGeometry, v: number): number {
  const hw = geo.getAttribute('aHw');
  let n = 0;
  for (let i = 0; i < hw.count; i += 3) { const vi = hw.getX(i); if (vi === v || vi < 0) n++; }
  return n;
}
