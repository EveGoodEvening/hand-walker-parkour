// src/render/actors/shared.ts —— WP5 包内共享状态（主角当前姿态、调试开关、镜头焦点）。WP5。
// 只在 src/render/actors/** 与 src/render/camera/** 之间共享，不对外。
import * as THREE from 'three';
import { createPose, type Pose } from '../../core/rig';

export type PoseTestName = 'crawl' | 'jump' | 'duck' | 'twitch' | 'stand' | 'thirdHand' | 'shadowThreeHands';

export interface CameraFocus {
  /** 焦点（世界坐标，通常是替身的头）。 */
  point: THREE.Vector3;
  /** 焦点所在反光面的类型（决定推近方式）。 */
  kind: 'side' | 'end' | 'floor' | 'world';
  /** 可见程度 0..1（淡入淡出）。 */
  weight: number;
}

export const WP5 = {
  /** 主角当前（本帧）姿态。 */
  playerPose: createPose() as Pose,
  /** 主角是否可见（跑段 / 站立段 / 静场里显示）。 */
  playerVisible: false,
  /** 主角的根在世界里的位置（静场里 = 锚点）。 */
  playerRoot: new THREE.Vector3(),
  /** 静场里主角的锚点矩阵（世界）。 */
  stillAnchor: new THREE.Matrix4(),
  /** poseTest（§8.8）当前冻结的姿势；null = 正常。 */
  poseTest: null as PoseTestName | null,
  /** 强制关闭模板（降级路径测试，?nostencil=1 或 __game.ext.wp5NoStencil(true)）。 */
  forceNoStencil: false,
  /** 调试机位（__game.ext.wp5Cam）：世界坐标。 */
  debugCam: null as { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null,
  /** 镜头焦点（停拍时看向镜中替身等）。 */
  focus: null as CameraFocus | null,
  /** 主角的「行走相位」读数（测试用）：左右手腕的世界坐标。 */
  debug: { wristL: new THREE.Vector3(), wristR: new THREE.Vector3() },
};

/** 读 URL 里 WP5 自己的参数（CORE 的 urlParams 冻结，这里单独解析）。 */
export function wp5Params(): { noStencil: boolean } {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const v = q?.get('nostencil');
    return { noStencil: v !== null && v !== undefined && v !== '0' && v !== 'false' };
  } catch { return { noStencil: false }; }
}
