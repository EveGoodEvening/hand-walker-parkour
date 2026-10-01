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
  /** 第三只手正穿过玻璃碰你的额头（forehead 手势开始后的秒数；没有时为 −1）。2-10 的侧面机位按它切。 */
  through: number;
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
  /** 主角的头心（世界坐标，本帧；Actor 写）。2-10 侧面机位按它和镜中替身的头取景。 */
  playerHead: new THREE.Vector3(),
  /**
   * 2-10 掌心贴掌心（0..1；Actor 写）：主角在 palmToGlass 里爬近端墙镜、掌心贴到玻璃上的程度。
   * 替身按它从「压缩的镜中深度」过渡到真正的镜像（离玻璃的距离 = 主角离玻璃的距离），两只手掌在玻璃两侧对上。
   * 手放下来之后（修复轮 U5 第三轮），停拍没结束时保持 1：镜子里的普通倒影仍是真正的镜像，爬姿的手不会从镜面里伸出来。
   */
  palmGlass: 0,
  /**
   * 镜中替身的第三只手正穿过镜面伸向你的额头（2-10；Doubles 在 cue 到达时写：doubleMod 的 forehead 手势开始时 true，
   * doubleEnd / 手收回 / 清场时 false）。按 cue 而不是按上一帧的画面写，无头测试跳着推进时也不会读到旧值。
   * Actor 让 palmToGlass 在这期间一直贴着玻璃；它变成 false 的那一刻手放下来（镜头同时切走）。
   */
  foreheadReach: false,
  /**
   * 镜头是不是普通的追尾机位（CameraRig 写，下一帧 Actor 读）：回头、停拍看替身、段内专门机位、摔倒时为 false。
   * 上半身淡出（readability.ts）只在追尾机位下爬行时用。
   */
  chaseCam: true,
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
