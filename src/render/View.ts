// src/render/View.ts —— 画面汇总器（DESIGN.md §8.3、§8.4 ViewAPI）。CORE 写初版，之后归 WP3。
// 创建渲染器、场景、镜头与 ViewContext，按 order 调用所有已注册的 ViewSystem；渲染只插值，不改模拟状态。
import * as THREE from 'three';
import type { PerfStats, QualityProfile, ViewAPI, ViewContext, ViewSystem } from '../core/contracts';
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
import { createRenderer, fitRenderer } from './Renderer';
import { PerfMeter } from './perf';

export class View implements ViewAPI {
  renderer!: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 240);
  context!: ViewContext;
  private systems: ViewSystem[] = [];
  private readonly meter = new PerfMeter();
  private chapter: CompiledChapter | null = null;
  private readonly surfaces = new ChapterSurfaces();
  private canvas!: HTMLCanvasElement;
  private last: SimSnapshot | null = null;
  private lastRender = 0;

  async init(canvas: HTMLCanvasElement, bus: Bus, settings: Settings): Promise<void> {
    this.canvas = canvas;
    const p = urlParams();
    const tier: QualityTier = p.q ?? (settings.quality === 'auto' ? 'medium' : settings.quality);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const quality: QualityProfile = resolveQuality(tier, dpr);
    const { renderer, stencil } = createRenderer(canvas, quality);
    this.renderer = renderer;
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
    try { this.renderer.compile(this.scene, this.camera); } catch { /* 预编译失败不致命 */ }
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
    Object.assign(this.context.quality, q);
    this.renderer.setPixelRatio(q.pixelRatio);
    this.resize();
    for (const s of this.systems) s.setQuality?.(this.context.quality);
  }

  perf(): PerfStats { return { ...this.meter.stats }; }
  /** 自上次调用以来的峰值 draw call，调用后清零（e2e 用）。 */
  takePeakDrawCalls(): number { const v = this.meter.peakDrawCalls; this.meter.peakDrawCalls = 0; return v; }
}
