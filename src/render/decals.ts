// src/render/decals.ts —— 地面贴花（DESIGN.md §5.3，WP3）：一个 InstancedMesh，1 次 draw call。
// 承担「水银河」灯带倒影、路灯光池、掌光环、水洼涟漪环、低画质的圆形暗斑影子。
// 混合用预乘 alpha 的 (ONE, ONE_MINUS_SRC_ALPHA)：亮的贴花输出 (rgb, 0) = 加法；暗斑输出 (0, a) = 按 a 压暗。
// 所以加法与压暗能在同一次 draw call 里完成。depthWrite: false，renderOrder = RENDER_ORDER.floorDecal。
// 灯带倒影按对应灯管自身的亮度（LampField 的 G 通道）明灭；全部贴花随线性雾淡出。运行时不分配。
import * as THREE from 'three';
import { RENDER_ORDER } from '../core/constants';
import type { LampFieldUniforms } from '../core/contracts';
import { blobShadow, ctx2d, lampStreak, lightPool, makeCanvas, ring } from './textures/common';

export const DECAL = { streak: 0, pool: 1, ring: 2, blob: 3 } as const;
export type DecalKind = keyof typeof DECAL;
const NO_LAMP = -1e5;

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aDecal;
varying vec2 vUv;
varying vec4 vDecal;
varying vec3 vTint;
void main() {
  vUv = uv;
  vDecal = aDecal;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform sampler2D uLampField;
uniform float uLampBase, uLampScale;
varying vec2 vUv;
varying vec4 vDecal;
varying vec3 vTint;
void main() {
  float cell = vDecal.x;
  vec2 off = vec2(mod(cell, 2.0), 1.0 - floor(cell / 2.0)) * 0.5;
  float m = texture2D(uAtlas, off + clamp(vUv, 0.01, 0.99) * 0.5).a;
  float lamp = vDecal.w > ${NO_LAMP.toFixed(1)} ? texture2D(uLampField, vec2((vDecal.w - uLampBase) * uLampScale, 0.5)).g : 1.0;
  float a = m * vDecal.y * lamp;
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  if (vDecal.z > 0.5) gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  else gl_FragColor = vec4(vTint * a, 0.0);
}`;

/** 2 × 2 贴花图集：左上 streak、右上 pool、左下 ring、右下 blob（只用 alpha）。 */
export function decalAtlasCanvas(size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size); const g = ctx2d(c); if (!g) return c;
  const h = size / 2;
  g.drawImage(lampStreak(h, {}), 0, 0);
  g.drawImage(lightPool(h, {}), h, 0);
  g.drawImage(ring(h, {}), 0, h);
  g.drawImage(blobShadow(h, {}), h, h);
  return c;
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Decals {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly atlas: THREE.Texture;
  private n = 0;

  constructor(lamp: LampFieldUniforms, readonly capacity = 192, atlasSize = 128) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);                         // 平躺在 XZ 平面；uv 的 v 沿 −z
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDecal', this.attr);
    this.atlas = typeof document !== 'undefined'
      ? new THREE.CanvasTexture(decalAtlasCanvas(atlasSize))
      : new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.atlas.name = 'hw:decalAtlas';
    this.atlas.needsUpdate = true;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uLampBase: { value: 0 }, uLampScale: { value: 1 } }]);
    uniforms.uAtlas = { value: this.atlas };
    uniforms.uLampField = lamp.uLampField; uniforms.uLampBase = lamp.uLampBase; uniforms.uLampScale = lamp.uLampScale;
    this.material = new THREE.ShaderMaterial({
      name: 'hw:decals', vertexShader: VERT, fragmentShader: FRAG, uniforms, fog: true,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.name = 'hw:decals';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER.floorDecal;
    this.mesh.count = 0;
  }

  begin(): void { this.n = 0; }

  /**
   * 加一个贴花：地面上 (x, y, −s) 处，宽 w（x 向）、长 l（s 向）、绕 y 转 rot。
   * color 为显示空间的 sRGB 十六进制；intensity 为亮度（或压暗程度）；lampS 给出时按那盏灯的自身亮度明灭。
   */
  add(kind: DecalKind, x: number, y: number, s: number, w: number, l: number, color: number, intensity: number, lampS: number | null = null, rot = 0): boolean {
    if (this.n >= this.capacity || intensity <= 0.002) return false;
    const i = this.n++;
    _p.set(x, y, -s); _q.setFromAxisAngle(UP, rot); _s.set(w, 1, l);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    _c.setHex(color, THREE.NoColorSpace);
    this.mesh.setColorAt(i, _c);
    const a = this.attr.array as Float32Array;
    a[i * 4] = DECAL[kind]; a[i * 4 + 1] = intensity; a[i * 4 + 2] = kind === 'blob' ? 1 : 0; a[i * 4 + 3] = lampS ?? NO_LAMP;
    return true;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.attr.needsUpdate = true;
    }
  }

  get count(): number { return this.n; }
  get texture(): THREE.Texture { return this.atlas; }
}
