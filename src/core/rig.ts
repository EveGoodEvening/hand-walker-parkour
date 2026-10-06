// src/core/rig.ts —— 骨骼表与 Pose 格式（DESIGN.md §5.5、§8.4）。CORE 冻结：WP5 实现网格，但不得改这里。
// 29 根骨骼，顺序即 skinIndex；主角、倒影、影子、领跑者共用这一份骨骼表（刚性蒙皮，每顶点 weight = 1）。

export const BONES = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'palmL', 'knuckleL', 'padL',
  'shoulderR', 'upperArmR', 'foreArmR', 'palmR', 'knuckleR', 'padR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'arm3Upper', 'arm3Fore', 'arm3Hand', 'propHead', 'propBack',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;          // 29

/** 骨骼名 → 下标。 */
export const BONE_INDEX: Readonly<Record<BoneName, number>> = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

/** 父骨骼（-1 = 无父）。rigBuild 与 PoseHistory 都按这张表组装层级。 */
export const BONE_PARENT: Readonly<Record<BoneName, BoneName | null>> = {
  root: null, pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', palmL: 'foreArmL', knuckleL: 'palmL', padL: 'knuckleL',
  shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', palmR: 'foreArmR', knuckleR: 'palmR', padR: 'knuckleR',
  thighL: 'pelvis', shinL: 'thighL', footL: 'shinL', thighR: 'pelvis', shinR: 'thighR', footR: 'shinR',
  arm3Upper: 'chest', arm3Fore: 'arm3Upper', arm3Hand: 'arm3Fore', propHead: 'head', propBack: 'chest',
};

/**
 * 姿态：q 为 BONE_COUNT×4 个局部四元数（x, y, z, w）；root 为 [x, y, s, yaw, pitch, roll]
 * （世界坐标 z = −s，§2.3）；thirdHand 为第三只手伸出程度 0..1。
 */
export interface Pose { q: Float32Array /* BONE_COUNT×4 局部四元数 */; root: Float32Array /* x, y, s, yaw, pitch, roll */; thirdHand: number }
export function createPose(): Pose {
  const q = new Float32Array(BONE_COUNT * 4);
  for (let i = 0; i < BONE_COUNT; i++) q[i * 4 + 3] = 1;
  return { q, root: new Float32Array(6), thirdHand: 0 };
}
/** 复制姿态（不分配）。 */
export function copyPose(dst: Pose, src: Pose): Pose {
  dst.q.set(src.q); dst.root.set(src.root); dst.thirdHand = src.thirdHand;
  return dst;
}
