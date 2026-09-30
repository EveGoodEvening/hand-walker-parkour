// src/render/perf.ts —— 性能统计与 `?debug=perf` 叠加层（DESIGN.md §8.8、§9.4）。CORE 写初版，之后归 WP3。
// renderer.info.autoReset = false，每帧 render 前手动 reset，render 后读 calls / triangles。
import type * as THREE from 'three';
import type { PerfStats } from '../core/contracts';
import type { SimSnapshot } from '../core/types';

export class PerfMeter {
  readonly stats: PerfStats = { fps: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, simMs: 0, frameMs: 0 };
  /** 自上次读取以来的峰值 draw call（e2e 用）。 */
  peakDrawCalls = 0;
  private frames = 0;
  private acc = 0;
  private el: HTMLElement | null = null;
  private lastText = 0;

  enableOverlay(root: HTMLElement): void {
    if (typeof document === 'undefined') return;
    const el = document.createElement('pre');
    el.className = 'hw-perf';
    el.style.cssText = 'position:absolute;left:6px;top:6px;margin:0;padding:4px 6px;font:11px/1.35 monospace;color:#dfe6ea;background:rgba(13,18,22,.6);pointer-events:none;z-index:50;white-space:pre';
    root.appendChild(el);
    this.el = el;
  }

  afterRender(renderer: THREE.WebGLRenderer, dt: number, frameMs: number): void {
    const info = renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
    this.stats.frameMs = frameMs;
    this.peakDrawCalls = Math.max(this.peakDrawCalls, info.render.calls);
    this.frames++; this.acc += dt;
    if (this.acc >= 0.5) { this.stats.fps = this.frames / this.acc; this.frames = 0; this.acc = 0; }
  }

  overlay(snap: SimSnapshot | null, now: number): void {
    if (!this.el || now - this.lastText < 250) return;
    this.lastText = now;
    const s = this.stats;
    const f = snap?.follower;
    this.el.textContent = `fps ${s.fps.toFixed(1)}  calls ${s.drawCalls}  tris ${s.triangles}\n`
      + `geo ${s.geometries}  tex ${s.textures}  frame ${s.frameMs.toFixed(1)}ms\n`
      + (snap ? `seg ${snap.segment} beat ${snap.segBeat.toFixed(1)}  steady ${snap.player.steady}/${snap.player.steadyMax}  lag ${(f?.lagBeats ?? 0).toFixed(2)} ${f?.mode ?? ''}` : '');
  }
}
