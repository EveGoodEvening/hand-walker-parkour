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

/**
 * 主角材质的四个透明度分组（着色器按 skinIndex 取）：0 = 骨盆与腿，1 = 手（掌、指节、指腹），2 = 手臂（肩、上臂、前臂），
 * 3 = 躯干、头与其余（第三只手、道具）。上半身淡出 = (1, 1, a, a)；镜头在眼睛里的静场（4-6 看水）只留手臂和手 = (0, 1, 1, 0)。
 */
export const BONE_GROUP: Readonly<Partial<Record<BoneName, 0 | 1 | 2>>> = {
  root: 0, pelvis: 0, thighL: 0, shinL: 0, footL: 0, thighR: 0, shinR: 0, footR: 0,
  palmL: 1, knuckleL: 1, padL: 1, palmR: 1, knuckleR: 1, padR: 1,
  shoulderL: 2, upperArmL: 2, foreArmL: 2, shoulderR: 2, upperArmR: 2, foreArmR: 2,
};
export function boneGroup(i: number): number {
  const name = (Object.keys(BONE_INDEX) as BoneName[]).find((k) => BONE_INDEX[k] === i);
  return name ? (BONE_GROUP[name] ?? 3) : 3;
}

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
 * 给主角的 Lambert 加按分组的透明度（BONE_GROUP）：顶点着色器按 skinIndex（刚性蒙皮，每个顶点只属于一根骨骼）取分组，
 * 片元的 alpha 乘上 u.value 里对应的分量；alpha < 0.01 时 discard（不写深度，藏起来的部分不挡后面的东西）。
 * 与 WP3 的 LampField 补丁串联（先调原来的 onBeforeCompile，customProgramCacheKey 串接）。
 * 材质一直是 transparent（切换 transparent 会换着色器变体）；全部为 1 时画面与不透明完全相同。
 */
export function patchGroupAlpha(mat: THREE.MeshLambertMaterial, u: { value: THREE.Vector4 }): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const g0 = Object.entries(BONE_GROUP).filter(([, g]) => g === 0).map(([b]) => BONE_INDEX[b as BoneName]);
  const g1 = Object.entries(BONE_GROUP).filter(([, g]) => g === 1).map(([b]) => BONE_INDEX[b as BoneName]);
  const g2 = Object.entries(BONE_GROUP).filter(([, g]) => g === 2).map(([b]) => BONE_INDEX[b as BoneName]);
  const any = (ids: number[]) => ids.map((i) => `abs(wp5Bi - ${i.toFixed(1)}) < 0.5`).join(' || ');
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uWp5Group = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uWp5Group;\nvarying float vWp5Alpha;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_SKINNING
    float wp5Bi = skinIndex.x;
    vWp5Alpha = (${any(g0)}) ? uWp5Group.x : (${any(g1)}) ? uWp5Group.y : (${any(g2)}) ? uWp5Group.z : uWp5Group.w;
  #else
    vWp5Alpha = 1.0;
  #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWp5Alpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vWp5Alpha;\n  if (diffuseColor.a < 0.01) discard;');
  };
  mat.customProgramCacheKey = () => `${prevKey()}|wp5group`;
  mat.transparent = true;
  mat.depthWrite = true;
  return mat;
}
