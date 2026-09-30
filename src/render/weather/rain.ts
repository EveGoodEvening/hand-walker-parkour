// src/render/weather/rain.ts —— 雨（DESIGN.md §5.9「雨」、§9.4、§4.3 3-3 @52）。
// 一个 LineSegments + 自定义 ShaderMaterial = 1 次 draw call：y = mod(y0 − t·speed, H)，雨丝锚在世界坐标里，
// 落在一个跟随镜头的盒子里（按盒子尺寸取模环绕），雾在着色器里手算。线段数按档位 250 / 600 / 1200：
// 一次分配 1200 条，换档只改 drawRange（游戏过程中不建几何体）。强度 < 1 时，按每条线的随机数把多余的线移出裁剪空间。
// 颜色是冷的（第三章雨夜只允许三种暖色：路灯碎金、烟头、栏杆红光，雨不在其中）。
import * as THREE from 'three';
import { RENDER_ORDER } from '../../core/constants';
import type { CompiledChapter } from '../../levels/schema';

export const RAIN_MAX_LINES = 1200;
export const RAIN_COLOR = 0x9fc3d6;
/** 盒子尺寸（米）：宽、高、深；中心在镜头前方 BOX_AHEAD 米。 */
export const RAIN_BOX = { w: 16, h: 11, d: 30 } as const;
export const RAIN_BOX_AHEAD = 10;

/** 雨的强度时间线：cue 在 seconds 秒内线性变到 intensity（按模拟时间，重试和截图都确定）。 */
export class RainLevel {
  private from = 0;
  private to = 0;
  private t0 = 0;
  private dur = 0;
  cue(intensity: number, seconds: number, t: number): void {
    this.from = this.at(t);
    this.to = Math.max(0, Math.min(1, intensity));
    this.t0 = t;
    this.dur = Math.max(0, seconds);
  }
  snap(v: number): void { this.from = this.to = Math.max(0, Math.min(1, v)); this.dur = 0; }
  at(t: number): number {
    if (this.dur <= 0 || t >= this.t0 + this.dur) return this.to;
    if (t <= this.t0) return this.from;
    return this.from + (this.to - this.from) * ((t - this.t0) / this.dur);
  }
  get target(): number { return this.to; }
}

interface RainCueRef { at: number; body: { type: string; intensity?: number; timeline?: Array<{ type: string; intensity?: number }> } }

/**
 * 从关卡数据推算某处（段下标、段内拍号 / 秒）的雨强（重来、goto、中途读章时用；跳过的 cue 不会再发）。
 * 取该处之前最后一个 rain cue 的终值；stop / slow 时间线里的按父事件的时刻计。
 */
export function rainAt(ch: CompiledChapter | null, segIndex: number, segBeat: number): number {
  if (!ch) return 0;
  let v = 0;
  for (let i = 0; i <= segIndex && i < ch.segments.length; i++) {
    const seg = ch.segments[i];
    if (!seg) continue;
    for (const e of seg.events as ReadonlyArray<RainCueRef>) {
      if (i === segIndex && e.at > segBeat + 1e-6) break;
      if (e.body.type === 'rain' && typeof e.body.intensity === 'number') v = e.body.intensity;
      for (const t of e.body.timeline ?? []) if (t.type === 'rain' && typeof t.intensity === 'number') v = t.intensity;
    }
  }
  return Math.max(0, Math.min(1, v));
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSpeed;
uniform float uLen;
uniform vec2 uWind;
attribute float aEnd;
attribute float aRand;
varying float vAlpha;
varying float vDepth;
void main() {
  if (aRand >= uLevel) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vDepth = 0.0; return; }
  float sp = uSpeed * (0.8 + 0.4 * fract(aRand * 7.13));
  float fall = uTime * sp;
  vec3 lo = uCenter - 0.5 * uBox;
  vec3 p;
  p.y = lo.y + mod(position.y - fall - lo.y, uBox.y);
  p.x = lo.x + mod(position.x + uWind.x * fall - lo.x, uBox.x);
  p.z = lo.z + mod(position.z + uWind.y * fall - lo.z, uBox.z);
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
  p += dir * (uLen * aEnd);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vDepth = -mv.z;
  vAlpha = mix(0.3, 1.0, aEnd);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
varying float vAlpha;
varying float vDepth;
void main() {
  float f = smoothstep(uFogNear, uFogFar, vDepth);
  float nearFade = smoothstep(0.35, 1.6, vDepth);
  vec3 c = mix(uColor, uFogColor, f);
  gl_FragColor = vec4(c, uOpacity * vAlpha * (1.0 - f) * nearFade);
  #include <colorspace_fragment>
}`;

/** 雨丝的几何体：RAIN_MAX_LINES 条线段，每条两个顶点（aEnd = 0 上端，1 下端），位置在盒子里均匀分布（确定性）。 */
export function createRainGeometry(): THREE.BufferGeometry {
  const n = RAIN_MAX_LINES;
  const pos = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2), rnd = new Float32Array(n * 2);
  let seed = 0x9e3779b9;
  const next = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) {
    const x = next() * 1000, y = next() * 1000, z = next() * 1000;
    // aRand 用分层抽样：前 k 条线的 aRand 均匀覆盖 [0, 1)，不同档位（drawRange 截断）下强度与可见比例都一致
    const r = ((i * 0.6180339887) % 1 + next() * 0.001) % 1;
    for (let j = 0; j < 2; j++) {
      const v = i * 2 + j;
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      end[v] = j; rnd[v] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const _fwd = new THREE.Vector3();

export class RainField {
  readonly object: THREE.LineSegments;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.BufferGeometry;
  private lines = 0;

  constructor(lines: number) {
    this.geometry = createRainGeometry();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uLevel: { value: 0 }, uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(RAIN_BOX.w, RAIN_BOX.h, RAIN_BOX.d) }, uSpeed: { value: 8.5 }, uLen: { value: 0.42 },
        uWind: { value: new THREE.Vector2(0.06, 0.03) },
        uColor: { value: new THREE.Color(RAIN_COLOR) }, uFogColor: { value: new THREE.Color(0x0e1419) },
        uFogNear: { value: 4 }, uFogFar: { value: 26 }, uOpacity: { value: 0.5 },
      },
      transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
    });
    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.name = 'wp4.rain';
    this.object.frustumCulled = false;
    this.object.renderOrder = RENDER_ORDER.rain;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
    this.setLines(lines);
  }

  /** 档位切换：只改 drawRange（每条线 2 个顶点）。 */
  setLines(n: number): void {
    this.lines = Math.max(0, Math.min(RAIN_MAX_LINES, Math.round(n)));
    this.geometry.setDrawRange(0, this.lines * 2);
  }
  get lineCount(): number { return this.lines; }

  /** 每帧：强度、时间、盒子中心（镜头前方）、雾。 */
  update(level: number, time: number, camera: THREE.Camera, fog: THREE.Fog | null): void {
    const u = this.material.uniforms as Record<string, THREE.IUniform>;
    (u.uLevel as THREE.IUniform).value = level;
    (u.uTime as THREE.IUniform).value = time % 3600;
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize().multiplyScalar(RAIN_BOX_AHEAD);
    ((u.uCenter as THREE.IUniform).value as THREE.Vector3).copy(camera.position).add(_fwd);
    if (fog) {
      ((u.uFogColor as THREE.IUniform).value as THREE.Color).copy(fog.color);
      (u.uFogNear as THREE.IUniform).value = fog.near;
      (u.uFogFar as THREE.IUniform).value = Math.max(fog.near + 0.5, fog.far);
    }
    this.object.visible = level > 0.001 && this.lines > 0;
  }
}
