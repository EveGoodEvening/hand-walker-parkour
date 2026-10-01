// src/render/npc/InstPool.ts —— 预分配的实例池（DESIGN.md §5.7、§8.9 读章规则）。
// 一个 InstPool = 一个 InstancedMesh（1 次 draw call）。容量在 init 时定死，运行时只写矩阵、变体、颜色；
// 每帧 begin() → push()… → end()，实例按帧重新紧凑排列；count = 0 时 visible = false（不产生 draw call）。
import * as THREE from 'three';
import { instanceHw } from './material';

export class InstPool {
  readonly mesh: THREE.InstancedMesh;
  readonly cap: number;
  private readonly hw: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute | null;
  n = 0;
  /** 本帧因容量不足被丢掉的实例数（测试与 perf 叠加层用）。 */
  dropped = 0;

  constructor(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, o: { color?: boolean; renderOrder?: number } = {}) {
    this.cap = cap;
    this.hw = instanceHw(geo, cap);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (o.color) {
      const c = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      c.setUsage(THREE.DynamicDrawUsage);
      this.mesh.instanceColor = c;
      this.colors = c;
    } else this.colors = null;
  }

  begin(): void { this.n = 0; this.dropped = 0; }

  /** 追加一个实例；返回下标，满了返回 −1。 */
  push(m: THREE.Matrix4, variant = 0, glow = 0, color?: THREE.Color): number {
    if (this.n >= this.cap) { this.dropped++; return -1; }
    const i = this.n++;
    m.toArray(this.mesh.instanceMatrix.array as Float32Array, i * 16);
    const h = this.hw.array as Float32Array;
    h[i * 2] = variant; h[i * 2 + 1] = glow;
    if (this.colors) {
      const c = this.colors.array as Float32Array;
      if (color) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; } else { c[i * 3] = 1; c[i * 3 + 1] = 1; c[i * 3 + 2] = 1; }
    }
    return i;
  }

  /** 读回第 i 个实例的矩阵（测试与线框用）。 */
  matrixAt(i: number, out: THREE.Matrix4): THREE.Matrix4 { return out.fromArray(this.mesh.instanceMatrix.array as Float32Array, i * 16); }
  variantAt(i: number): number { return (this.hw.array as Float32Array)[i * 2] ?? 0; }
  glowAt(i: number): number { return (this.hw.array as Float32Array)[i * 2 + 1] ?? 0; }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
    this.hw.clearUpdateRanges(); this.hw.addUpdateRange(0, n * 2); this.hw.needsUpdate = true;
    if (this.colors) { this.colors.clearUpdateRanges(); this.colors.addUpdateRange(0, n * 3); this.colors.needsUpdate = true; }
  }

  /** 隐藏（静场、读章前）。 */
  clear(): void { this.begin(); this.end(); }
}
