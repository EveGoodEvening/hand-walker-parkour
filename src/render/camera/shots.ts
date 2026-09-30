// src/render/camera/shots.ts —— 静场与特殊机位表（DESIGN.md §5.4、§8.4 ShotId）。CORE 写初版，之后归 WP5。
// set 机位的坐标相对 STILL_ORIGIN（core/constants.ts）；跑段机位（glanceLeft / turnBack / puddleDown / mirrorClose）
// 相对玩家，只描述偏移，由 CameraRig 叠加在追尾机位上。
import type { ShotId } from '../../core/types';

export interface SetShot { pos: [number, number, number]; look: [number, number, number]; fov: number }
/** 静场机位（占位 set 是「课桌下面」，所有 set 共用一个默认机位，WP5 按各 set 细化）。 */
export const SET_SHOTS: Partial<Record<ShotId, SetShot>> = {
  deskFeet: { pos: [0.3, 0.3, 1.35], look: [-0.1, 0.32, -1.8], fov: 62 },
  counter: { pos: [0, 1.1, 1.6], look: [0, 1.0, -1], fov: 55 },
  windowSeat: { pos: [0.2, 0.5, 1.2], look: [-1.5, 0.8, -1], fov: 60 },
  labBoard: { pos: [0, 0.5, 1.4], look: [0, 1.2, -3], fov: 60 },
  busWindow: { pos: [0.3, 1.1, 0.6], look: [-1.5, 1.1, -0.5], fov: 58 },
  homeCrawl: { pos: [0, 0.5, 1.8], look: [0, 0.3, -2], fov: 62 },
  bathroomMirror: { pos: [0, 1.2, 1.3], look: [0, 1.3, -1.5], fov: 55 },
  palmEye: { pos: [0, 0.8, 0.5], look: [0, 0.8, -0.5], fov: 45 },
  waterDown: { pos: [0, 1.2, 0.6], look: [0, 0, -0.4], fov: 55 },
  ceilingCrack: { pos: [0, 0.6, 0], look: [0, 3, -0.3], fov: 60 },
  bedFeet: { pos: [0, 0.9, 1.2], look: [0, 0.4, -1], fov: 58 },
  infirmaryBed: { pos: [0.6, 1.0, 1.0], look: [-0.5, 0.7, -1], fov: 58 },
  trackSky: { pos: [0, 0.3, 0], look: [0, 3, -1], fov: 70 },
  standEye: { pos: [0, 1.62, 1.9], look: [0, 1.5, -8], fov: 55 },
};
export const DEFAULT_SET_SHOT: SetShot = SET_SHOTS.deskFeet as SetShot;

/** 跑段中的临时机位偏移：yaw（弧度，正 = 向左）、下俯 pitch、持续期间的高度偏移。 */
export const RUN_SHOT_OFFSETS: Partial<Record<ShotId, { yaw: number; pitch: number; dy: number }>> = {
  glanceLeft: { yaw: 8 * Math.PI / 180, pitch: 0, dy: 0 },
  mirrorClose: { yaw: 14 * Math.PI / 180, pitch: 0, dy: 0 },
  puddleDown: { yaw: 0, pitch: -0.5, dy: 0.2 },
  turnBack: { yaw: Math.PI * 160 / 180, pitch: 0, dy: 0 },
  follow: { yaw: 0, pitch: 0, dy: 0 },
};
