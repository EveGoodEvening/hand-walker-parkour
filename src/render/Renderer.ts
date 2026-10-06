// src/render/Renderer.ts —— WebGL 渲染器的创建与检测（DESIGN.md §5、§5.8、§9.4，WP3）。
// r186 的 WebGLRenderer 默认 stencil: false，必须显式传 stencil: true；启动时检查上下文是否真的有模板缓冲。
// 色调映射 NeutralToneMapping（曝光 1.0），输出 SRGBColorSpace；像素比按档位（高画质取 min(dpr, 1.5)）。
// antialias 是上下文属性，只在创建时生效：之后切到高画质不会补开抗锯齿（自动档位先用中档，所以通常没有 AA）。
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
