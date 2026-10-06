// src/render/npc/hitboxDebug.ts —— `?debug=hitbox`：用线框画出所有碰撞盒（DESIGN.md §8.8、WP6 验收 4）。
// 一个预分配的 LineSegments（1 次 draw call，只在调试时存在）。每帧写入：
//   障碍的外层盒（按类别着色：low 绿、bar 黄、block 红、soft 蓝、pickup 米白；此刻不参与碰撞的画暗）、
//   bar / block 的内层盒（横向缩到 85%，虚一点的颜色，§2.5 / §10.1），以及玩家的碰撞盒（白）。
// 盒子数据与模拟完全相同：obstacleState（sim/Track.ts）+ obstacleBox 的规则（x0..x1、y0..y1、s0 + ds .. s1 + ds）。
import * as THREE from 'three';
import type { AABB, ObstacleClass } from '../../core/types';
import type { CompiledObstacle } from '../../levels/schema';
import type { ObstacleState } from './simBridge';

/** 与 sim/tuning.ts 的 hitbox.lethalShrink 相同（§2.4）。 */
export const LETHAL_SHRINK = 0.85;

const CLASS_COLOR: Record<ObstacleClass, number> = { low: 0x6fdc8c, bar: 0xf2c14e, block: 0xef6f6c, soft: 0x6fc3ef, pickup: 0xe6e1d6 };

/** 障碍此刻的碰撞盒（与 sim/Collision.ts obstacleBox 相同；y 相对地面）。 */
export function obstacleAABB(o: CompiledObstacle, st: ObstacleState, out: AABB): AABB {
  out.x0 = st.x0; out.x1 = st.x1; out.y0 = o.y0; out.y1 = o.y1; out.s0 = o.s0 + st.ds; out.s1 = o.s1 + st.ds;
  return out;
}

export class HitboxDebug {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private n = 0;
  readonly cap: number;
  private readonly c = new THREE.Color();

  constructor(cap = 256) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 24 * 3);
    this.col = new Float32Array(cap * 24 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, fog: false, toneMapped: false });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.name = 'debug:hitbox';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 12;
  }

  begin(): void { this.n = 0; }

  /** 画一个盒子（世界坐标：y 已加上地面高度，z = −s）。 */
  box(b: AABB, floorY: number, hex: number, k = 1): void {
    if (this.n >= this.cap) return;
    const x0 = b.x0, x1 = b.x1, y0 = b.y0 + floorY, y1 = b.y1 + floorY, z0 = -b.s1, z1 = -b.s0;
    const P: Array<[number, number, number]> = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    this.c.setHex(hex).multiplyScalar(k);
    let o = this.n * 72;
    for (const i of E) {
      const p = P[i] as [number, number, number];
      this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
      this.col[o] = this.c.r; this.col[o + 1] = this.c.g; this.col[o + 2] = this.c.b;
      o += 3;
    }
    this.n++;
  }

  /** 画一个障碍：外层盒 + （bar / block）内层盒。 */
  obstacle(o: CompiledObstacle, st: ObstacleState, floorY: number, tmp: AABB, knocked = false): void {
    obstacleAABB(o, st, tmp);
    const hex = CLASS_COLOR[o.cls];
    const live = st.active && !knocked;                 // 被碰倒的 low 不再参与碰撞（sim 的 knocked 表）
    this.box(tmp, floorY, hex, live ? 1 : 0.35);
    if (live && (o.cls === 'bar' || o.cls === 'block')) {
      const c = (tmp.x0 + tmp.x1) / 2, h = ((tmp.x1 - tmp.x0) / 2) * LETHAL_SHRINK;
      tmp.x0 = c - h; tmp.x1 = c + h;
      this.box(tmp, floorY, hex, 0.55);
    }
  }

  end(): void {
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n * 24);
    const p = g.getAttribute('position') as THREE.BufferAttribute, c = g.getAttribute('color') as THREE.BufferAttribute;
    p.clearUpdateRanges(); p.addUpdateRange(0, this.n * 72); p.needsUpdate = true;
    c.clearUpdateRanges(); c.addUpdateRange(0, this.n * 72); c.needsUpdate = true;
    this.lines.visible = this.n > 0;
  }

  get count(): number { return this.n; }
  /** 本帧全部线段端点（测试用）。 */
  allPositions(): number[] { return Array.from(this.pos.subarray(0, this.n * 72)); }
  /** 第 i 个盒子的 8 个角（测试用）。 */
  corners(i: number): number[] { return Array.from(this.pos.subarray(i * 72, i * 72 + 72)); }
}
