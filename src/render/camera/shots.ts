// src/render/camera/shots.ts —— 机位表（DESIGN.md §5.4、§8.4 ShotId）。WP5。
// 静场机位相对主角锚点（STILL_ORIGIN × StillSet.playerAnchor）：锚点 = 主角骨盆正下方的地面，主角朝 −z。
// 跑段机位（glanceLeft / turnBack / puddleDown / mirrorClose / follow）相对玩家，由 CameraRig 叠加在追尾机位上。
// 站立机位（standEye / trackSky）相对站立段里的玩家。
import type { SetId, ShotId } from '../../core/types';

export interface SetShot { pos: [number, number, number]; look: [number, number, number]; fov: number }

/** 静场机位（相对锚点）。 */
export const SET_SHOTS: Partial<Record<ShotId, SetShot>> = {
  // 1-4 / 5-5：镜头在课桌下，主角的小腿和鞋在前景，鞋尖指向课桌腿；英语老师的裙角悬在画面上方
  deskFeet: { pos: [0.06, 0.24, 0.12], look: [0, 0.1, -1.5], fov: 64 },
  // 2-3：窗口，双手撑在窗台边缘
  counter: { pos: [0.55, 0.95, 1.5], look: [0, 0.95, -0.9], fov: 55 },
  // 2-5：低机位对着干净的窗玻璃（窗在左侧）
  windowSeat: { pos: [0.55, 0.62, 0.9], look: [-1.6, 0.8, -0.8], fov: 60 },
  // 2-9：背靠实验桌腿，看黑板
  labBoard: { pos: [0.5, 0.55, 1.2], look: [0, 1.1, -2.6], fov: 60 },
  // 3-5：公交车，车窗在左侧
  busWindow: { pos: [0.45, 1.05, 0.75], look: [-1.5, 1.05, -0.4], fov: 58 },
  // 3-9：黑暗的客厅，自动爬行
  homeCrawl: { pos: [0.15, 0.62, 1.9], look: [0, 0.35, -2.5], fov: 62 },
  // 3-10：卫生间镜子
  bathroomMirror: { pos: [0.35, 1.25, 1.1], look: [0, 1.2, -1.4], fov: 55 },
  // 4-4：右手举到眼前（镜头在眼睛里）
  palmEye: { pos: [0.0, 1.02, -0.02], look: [0.04, 1.0, -0.6], fov: 50 },
  // 4-6：镜头下俯看水面
  waterDown: { pos: [0.0, 1.15, 0.2], look: [0, 0, -0.9], fov: 55 },
  // 4 章结尾 / 5-10：天花板上的裂缝（仰躺，镜头在眼睛里）
  ceilingCrack: { pos: [0, 0.34, 0.62], look: [0, 3, 0.5], fov: 60 },
  // 5-1：被子里的脚
  bedFeet: { pos: [0.25, 0.75, 0.9], look: [0, 0.35, -0.9], fov: 58 },
  // 5-9：医务室的床
  infirmaryBed: { pos: [0.9, 1.1, 0.4], look: [-0.2, 0.6, -0.3], fov: 58 },
};

/** 每个 set 的缺省机位（`camera` cue 可以覆盖）。键 = `${set}.${variant}` 或 `${set}`。 */
export const SET_DEFAULT_SHOT: Partial<Record<string, ShotId>> = {
  deskFeet: 'deskFeet', counter: 'counter', canteenWindow: 'windowSeat', labBoard: 'labBoard', bus: 'busWindow', home: 'homeCrawl',
  bathroom: 'bathroomMirror', palmEye: 'palmEye', water: 'waterDown', bedroom: 'bedFeet', 'bedroom.ceiling': 'ceilingCrack',
  infirmary: 'infirmaryBed', 'infirmary.ceiling': 'ceilingCrack', placeholder: 'deskFeet',
} satisfies Partial<Record<SetId | string, ShotId>>;

export const DEFAULT_SET_SHOT: SetShot = SET_SHOTS.deskFeet as SetShot;

/** 跑段中的临时机位偏移：yaw（弧度，正 = 向左），下俯（注视点下移，米），高度偏移。 */
export const RUN_SHOT_OFFSETS: Partial<Record<ShotId, { yaw: number; lookDy: number; dy: number; lookAhead?: number }>> = {
  glanceLeft: { yaw: 8 * Math.PI / 180, lookDy: 0, dy: 0 },
  mirrorClose: { yaw: 0, lookDy: 0, dy: 0 },
  puddleDown: { yaw: 0, lookDy: -1.25, dy: 0.35, lookAhead: 3.2 },
  turnBack: { yaw: Math.PI * 160 / 180, lookDy: 0, dy: 0 },
  follow: { yaw: 0, lookDy: 0, dy: 0 },
};

/** 站立段机位（§5.4）：(0, 1.62, +1.9) 注视 (0, 1.5, −8)；trackSky：摔倒后仰望天空。 */
export const STAND_SHOTS = {
  standEye: { pos: [0, 1.62, 1.9] as const, look: [0, 1.5, -8] as const },
  trackSky: { pos: [0.1, 0.32, 0.9] as const, look: [0.2, 3.2, -0.2] as const },
};

/** 追尾机位（§5.4）。 */
export const FOLLOW = {
  landscape: { k: 0.7, h: 0.92, back: 2.35, ly: 0.45, lz: -7, lookK: 0.42, hfov: 76, vMin: 50, vMax: 62 },
  portrait: { k: 0.6, h: 1.3, back: 3.8, ly: 0.3, lz: -6, lookK: 0.3, vMax: 80 },
} as const;
