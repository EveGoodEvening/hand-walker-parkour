// src/render/Renderer.ts —— WebGL 渲染器的创建与检测（DESIGN.md §5、§5.8、§9.4）。CORE 写初版，之后归 WP3。
// r186 的 WebGLRenderer 默认 stencil: false，必须显式传 stencil: true；启动时检查上下文是否真的有模板缓冲。
import * as THREE from 'three';
import type { QualityProfile } from '../core/contracts';

export interface RendererInfo { renderer: THREE.WebGLRenderer; stencil: boolean }

export function createRenderer(canvas: HTMLCanvasElement, q: QualityProfile): RendererInfo {
  const renderer = new THREE.WebGLRenderer({ canvas, stencil: true, antialias: q.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.info.autoReset = false;
  renderer.setPixelRatio(q.pixelRatio);
  let stencil = false;
  try { stencil = renderer.getContext().getContextAttributes()?.stencil === true; } catch { stencil = false; }
  return { renderer, stencil };
}

/** 按容器尺寸设置画布（CSS 尺寸不变，只改绘图缓冲）。 */
export function fitRenderer(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, w: number, h: number): void {
  renderer.setSize(Math.max(1, w), Math.max(1, h), false);
  camera.aspect = Math.max(1, w) / Math.max(1, h);
  camera.updateProjectionMatrix();
}
