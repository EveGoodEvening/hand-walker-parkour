// src/render/actors/readability.ts —— 本车道障碍的可读性（修复轮 U5，DESIGN.md §2.8 R4、§5.4）。WP5。纯函数，Node 可测。
// 横屏追尾机位在主角身后、略高于他：本车道 1–7 m 的低矮障碍正好落在他的头和肩膀后面（第一课 1-1 的伸脚就看不见）。
// 机位抬高、拉远之后（camera/shots.ts 的 FOLLOW.landscape）还剩约 5 m 的盲区，所以本车道前方有必需障碍（low / bar）时，
// 主角的上半身（躯干、头、手臂）淡到 40%：障碍从他身体里透出来。下半身（骨盆、腿）和着地的手不淡，「用手爬」照样读得出。
// 单元测试 tests/unit/actors/occlusion.test.ts 按这套规则检查全部章节的每个 low / bar 障碍。
import type * as THREE from 'three';
import type { BoneName } from '../../core/rig';
import { BONE_INDEX } from '../../core/rig';
import type { CompiledObstacle } from '../../levels/schema';

export const UPPER_FADE = {
  /** 淡出后上半身的不透明度。 */
  alpha: 0.4,
  /** 淡入、淡出用时（秒，按模拟时钟）。 */
  inSec: 0.25, outSec: 0.4,
  /** 触发距离：障碍近沿离主角碰撞盒前沿 ≤ max(minAhead, aheadSec × 速度) 米。 */
  minAhead: 8, aheadSec: 1.5,
  /** 主角碰撞盒前沿在根前方多少米（越过障碍 0.3 m 之后不再算）。 */
  front: 0.45, behind: 0.3,
} as const;

/** 不淡的骨骼：下半身与着地的手。 */
export const OPAQUE_BONES: readonly BoneName[] = ['root', 'pelvis', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'palmL', 'knuckleL', 'padL', 'palmR', 'knuckleR', 'padR'];
export const OPAQUE_BONE_INDICES: readonly number[] = OPAQUE_BONES.map((b) => BONE_INDEX[b]);

/** 前方是否有需要看清的本车道障碍（lanes：主角现在的车道与目标车道）。 */
export function upperFadeWanted(obstacles: readonly CompiledObstacle[], s: number, laneA: number, laneB: number, speed: number): boolean {
  const reach = Math.max(UPPER_FADE.minAhead, UPPER_FADE.aheadSec * Math.max(0, speed));
  const front = s + UPPER_FADE.front;
  for (const o of obstacles) {
    if (o.cls !== 'low' && o.cls !== 'bar') continue;
    const d = o.s0 - front;
    if (d > reach || o.s1 < front - UPPER_FADE.behind) continue;
    const ls = o.lanes as readonly number[];
    if (ls.includes(laneA) || ls.includes(laneB)) return true;
  }
  return false;
}

/** 淡出权重（0 = 不淡，1 = 完全淡到 alpha）按模拟时间推进。 */
export function stepUpperFade(w: number, want: boolean, dt: number): number {
  const d = Math.max(0, dt);
  return want ? Math.min(1, w + d / UPPER_FADE.inSec) : Math.max(0, w - d / UPPER_FADE.outSec);
}

/** 上半身的不透明度。 */
export function upperAlpha(w: number): number { return 1 - (1 - UPPER_FADE.alpha) * Math.min(1, Math.max(0, w)); }

/**
 * 给主角的 Lambert 加「上半身按 uniform 淡出」：顶点着色器按 skinIndex（刚性蒙皮，每个顶点只属于一根骨骼）判断是否属于
 * OPAQUE_BONES，片元的 alpha 乘上它。与 WP3 的 LampField 补丁串联（先调原来的 onBeforeCompile，customProgramCacheKey 串接）。
 * 材质要一直是 transparent（切换 transparent 会换着色器变体）；不淡时 alpha = 1，画面与不透明完全相同。
 */
export function patchUpperFade(mat: THREE.MeshLambertMaterial, u: { value: number }): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const cond = OPAQUE_BONE_INDICES.map((i) => `abs(wp5Bi - ${i.toFixed(1)}) < 0.5`).join(' || ');
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uWp5Upper = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWp5Upper;\nvarying float vWp5Alpha;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_SKINNING
    float wp5Bi = skinIndex.x;
    vWp5Alpha = (${cond}) ? 1.0 : uWp5Upper;
  #else
    vWp5Alpha = 1.0;
  #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWp5Alpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vWp5Alpha;');
  };
  mat.customProgramCacheKey = () => `${prevKey()}|wp5upper`;
  mat.transparent = true;
  mat.depthWrite = true;
  return mat;
}
