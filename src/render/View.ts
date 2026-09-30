// src/render/View.ts —— 画面汇总器（DESIGN.md §8.3、§8.4 ViewAPI，WP3）。
// 创建渲染器、场景、镜头与 ViewContext，按 order 调用所有已注册的 ViewSystem；渲染只插值，不改模拟状态。
// 读章与画质切换之后做一次「预热」：把全部纹理上传、把场景里每个网格在 1×1 视口里画一遍（上传几何体、编译着色器），
// 所以游戏过程中 renderer.info.memory 的几何体数和纹理数保持不变（§8.10 WP3 验收 3）。
// 调试预览（?test / ?debug）：World 在远处单独建一段 kit 或显示一个 set，View 用固定的预览镜头覆盖 CameraRig。
import * as THREE from 'three';
import type { PerfStats, QualityProfile, ViewAPI, ViewContext, ViewSystem } from '../core/contracts';
import { DEG, clamp } from '../core/math';
import type { Bus, GameEvent } from '../core/events';
import { FlatLampField, FlatMaterials, FlatTextureBank } from '../core/fallbacks';
import { resolveQuality } from '../core/quality';
import { getMaterialsFactory, getRigFactory, getSolver, getViewSystems } from '../core/registry';
import { createRng } from '../core/rng';
import type { Settings } from '../core/settings';
import { ChapterSurfaces } from '../core/surfaces';
import type { QualityTier, SimSnapshot } from '../core/types';
import { urlParams } from '../core/urlParams';
import type { CompiledChapter } from '../levels/schema';
import { world } from './ChunkStreamer';
import { createRenderer, fitRenderer } from './Renderer';
import { PerfMeter } from './perf';
import { HwTextureBank } from './textureBank';

export interface PreviewCamera { pos: THREE.Vector3; look: THREE.Vector3; fov: number | null }

export class View implements ViewAPI {
  renderer!: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 240);
  context!: ViewContext;
  stencil = false;
  private systems: ViewSystem[] = [];
  private readonly meter = new PerfMeter();
  private chapter: CompiledChapter | null = null;
  private readonly surfaces = new ChapterSurfaces();
  private canvas!: HTMLCanvasElement;
  private last: SimSnapshot | null = null;
  private lastRender = 0;
  /** 预览镜头（调试）：非 null 时在所有系统之后覆盖镜头。 */
  previewCam: PreviewCamera | null = null;
  /** 预热次数（测试用）。 */
  warmups = 0;

  async init(canvas: HTMLCanvasElement, bus: Bus, settings: Settings): Promise<void> {
    this.canvas = canvas;
    const p = urlParams();
    const tier: QualityTier = p.q ?? (settings.quality === 'auto' ? 'medium' : settings.quality);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const quality: QualityProfile = resolveQuality(tier, dpr);
    const { renderer, stencil } = createRenderer(canvas, quality);
    this.renderer = renderer;
    this.stencil = stencil;
    this.scene.name = 'hw:scene';
    const overlayRoot = (typeof document !== 'undefined' && document.getElementById('overlay')) || (canvas.parentElement as HTMLElement);
    const solver = getSolver();
    if (!solver) throw new Error('View.init: no solver registered');
    const base = {
      renderer, scene: this.scene, camera: this.camera, overlayRoot, bus, settings, quality,
      rngFx: createRng(p.seed ?? 1, 'fx'), stencil, surfaces: this.surfaces, solver,
    };
    const mf = getMaterialsFactory();
    const m = mf ? mf(base) : { mat: new FlatMaterials(), lamps: new FlatLampField(), tex: new FlatTextureBank(quality.texSize) };
    const ctx = { ...base, ...m, rig: null } as unknown as ViewContext;
    const rf = getRigFactory();
    if (!rf) throw new Error('View.init: no rig factory registered');
    ctx.rig = rf(ctx);
    this.context = ctx;
    this.scene.add(this.camera);
    this.systems = getViewSystems();
    for (const s of this.systems) await s.init(ctx);
    this.resize();
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.resize());
    if (p.debug.has('perf')) this.meter.enableOverlay(overlayRoot);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || this.canvas.width || 640;
    const h = this.canvas.clientHeight || this.canvas.height || 360;
    fitRenderer(this.renderer, this.camera, w, h);
  }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    this.chapter = ch;
    this.surfaces.load(ch);
    for (const s of this.systems) if (s.loadChapter) await s.loadChapter(ch);
    this.warmUp();
  }

  /**
   * 预热：上传全部纹理（TextureBank 生成过的 + 世界自己的），并把场景里的每个网格在 1×1 视口里画一遍
   * （临时打开 visible、关掉视锥剔除），上传几何体、编译着色器。之后立即恢复原状。
   */
  warmUp(): void {
    const r = this.renderer;
    const tex = this.context.tex;
    const texs: THREE.Texture[] = [...(tex instanceof HwTextureBank ? tex.all() : []), ...world.ownTextures()];
    for (const t of texs) { try { r.initTexture(t); } catch { /* 个别纹理上传失败不致命 */ } }
    const saved: Array<[THREE.Object3D, boolean, boolean]> = [];
    this.scene.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    const size = r.getSize(new THREE.Vector2());
    try {
      r.setViewport(0, 0, 1, 1);
      r.render(this.scene, this.camera);
    } catch (err) {
      console.warn('[view] warm-up render failed', err);
    } finally {
      r.setViewport(0, 0, size.x, size.y);
      for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
      r.info.reset();
    }
    this.warmups++;
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    if (e.type === 'segment' && this.chapter) {
      const seg = this.chapter.segments[e.data.index];
      if (seg) for (const s of this.systems) s.onSegment?.(seg);
    }
    for (const s of this.systems) s.onEvent?.(e, snap);
  }

  onReset(snap: SimSnapshot): void {
    if (this.chapter) {
      const seg = this.chapter.segments[snap.segIndex];
      if (seg) for (const s of this.systems) s.onSegment?.(seg);
    }
    for (const s of this.systems) s.onReset?.(snap);
    this.last = snap;
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    this.last = next;
    // 画布尺寸可能被 CSS 改变（竖屏 / 横屏切换）
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (Math.abs(w / h - this.camera.aspect) > 1e-3)) this.resize();
    for (const s of this.systems) s.frame(prev, next, alpha, dt);
    const pc = this.previewCam;
    if (pc) {
      const cam = this.camera;
      cam.position.copy(pc.pos); cam.up.set(0, 1, 0); cam.lookAt(pc.look);
      const aspect = cam.aspect || 16 / 9;
      const fov = pc.fov ?? (aspect < 1 ? Math.min(80, vFromH(76, aspect)) : clamp(vFromH(76, aspect), 50, 62));
      if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
    }
  }

  render(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this.lastRender ? (t1 - this.lastRender) / 1000 : 0;
    this.lastRender = t1;
    this.meter.afterRender(this.renderer, dt, t1 - t0);
    this.meter.overlay(this.last, t1);
  }

  setQuality(t: QualityTier): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const q = resolveQuality(t, dpr);
    const before = this.context.quality.tier;
    Object.assign(this.context.quality, q);
    this.renderer.setPixelRatio(q.pixelRatio);
    this.resize();
    for (const s of this.systems) s.setQuality?.(this.context.quality);
    if (before !== q.tier) this.warmUp();
  }

  perf(): PerfStats { return { ...this.meter.stats }; }
  /** 自上次调用以来的峰值 draw call，调用后清零（e2e 用）。 */
  takePeakDrawCalls(): number { const v = this.meter.peakDrawCalls; this.meter.peakDrawCalls = 0; return v; }

  /** 调试：渲染一帧并读回画布上一块区域（归一化坐标，y 向下）的平均亮度（0..1，Rec.709）。 */
  luma(x0 = 0, y0 = 0, x1 = 1, y1 = 1): number {
    const r = this.renderer;
    r.info.reset();
    r.render(this.scene, this.camera);
    const gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = Math.floor(clamp(x0, 0, 1) * W), py = Math.floor((1 - clamp(y1, 0, 1)) * H);
    const pw = Math.max(1, Math.floor((clamp(x1, 0, 1) - clamp(x0, 0, 1)) * W)), ph = Math.max(1, Math.floor((clamp(y1, 0, 1) - clamp(y0, 0, 1)) * H));
    const buf = new Uint8Array(pw * ph * 4);
    gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0;
    for (let i = 0; i < pw * ph; i++) sum += (0.2126 * (buf[i * 4] as number) + 0.7152 * (buf[i * 4 + 1] as number) + 0.0722 * (buf[i * 4 + 2] as number)) / 255;
    return sum / (pw * ph);
  }
}

function vFromH(hDeg: number, aspect: number): number { return (2 * Math.atan(Math.tan((hDeg * DEG) / 2) / aspect)) / DEG; }
