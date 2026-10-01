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
  // 2-5：低机位（0.32 m，修复轮 U5）在主角左后方、窗与他之间，对着干净的窗玻璃：窗里的「我」正面坐着、腿垂到地上，
  // 第三只手的掌心贴在玻璃上；主角自己在画面右边缘之外
  windowSeat: { pos: [-0.1, 0.32, 1.0], look: [-1.05, 0.6, -0.25], fov: 55 },
  // 2-9：背靠实验桌腿，看黑板（右边的实验台挪到 x = 1.5，黑板整块露出来；修复轮 U5）
  labBoard: { pos: [0.62, 0.55, 1.2], look: [0, 1.1, -2.6], fov: 60 },
  // 3-5：公交车，车窗在左侧。从过道上方越过主角的头看车窗（修复轮 U5：以前与头同高，车窗里的「我」有一半被他挡住）
  busWindow: { pos: [0.35, 1.6, 0.9], look: [-1.5, 1.0, -0.6], fov: 55 },
  // 3-9：黑暗的客厅，自动爬行
  homeCrawl: { pos: [0.15, 0.62, 1.9], look: [0, 0.35, -2.5], fov: 62 },
  // 3-10：卫生间镜子。从主角右后方斜着看镜子（修复轮 U5）：镜中的「我」不在他的后脑勺后面
  bathroomMirror: { pos: [0.85, 1.5, 0.6], look: [-0.25, 1.35, -0.87], fov: 62 },
  // 4-4：右手举到眼前（镜头在眼睛里）
  palmEye: { pos: [0.0, 1.02, -0.02], look: [0.04, 1.0, -0.6], fov: 50 },
  // 4-6：趴在水边、从他眼睛里俯看水面（约 −56°；修复轮 U5）：倒影里站着的「我」在画面中间，下沿伸进来按在水里的双手，
  // 岸边的灰带出画（以前从 1.15 m 高、岸上看下去，水里的人群像一堆盒子，岸是画面底部的一条灰带）
  waterDown: { pos: [0.0, 0.62, -0.47], look: [0, 0, -0.9], fov: 58 },
  // 4 章结尾 / 5-10：天花板上的裂缝（仰躺，镜头在眼睛里）
  ceilingCrack: { pos: [0, 0.34, 0.62], look: [0, 3, 0.5], fov: 60 },
  // 5-1：被子里的脚
  bedFeet: { pos: [0.25, 0.75, 0.9], look: [0, 0.35, -0.9], fov: 58 },
  // 5-9：医务室的床，从床边看躺着的自己（锚点转了 180°：头在枕头上，见 infirmary.ts）；7.0 s 起推到枕边的凹陷（SET_SHOT_LATE）
  infirmaryBed: { pos: [-1.0, 0.45, 0.2], look: [-0.2, 0.0, 0.6], fov: 55 },
};

/**
 * 同一个静场机位被第二次切到时用的另一个角度（修复轮 U5）：3-10 回头之后（10.4 s）「最后一眼」从门口拍，
 * 镜中站在倒影身后的人和搭在肩上的手在主角的右边。
 */
export const SET_SHOT_RETURN: Partial<Record<ShotId, SetShot>> = {
  bathroomMirror: { pos: [1.0, 1.45, 1.3], look: [-0.3, 1.3, -0.87], fov: 55 },
};

/** 静场里过了某个时刻慢慢推到的近景（修复轮 U5）：5-9 推到枕边的凹陷，从床边平视枕头，主角的身体退出画面。 */
export const SET_SHOT_LATE: Partial<Record<ShotId, { after: number; blend: number; shot: SetShot }>> = {
  infirmaryBed: { after: 7.0, blend: 1.2, shot: { pos: [-0.8, 0.2, 0.45], look: [-0.42, -0.02, 0.66], fov: 50 } },
};

/** 每个 set 的缺省机位（`camera` cue 可以覆盖）。键 = `${set}.${variant}` 或 `${set}`。 */
export const SET_DEFAULT_SHOT: Partial<Record<string, ShotId>> = {
  deskFeet: 'deskFeet', counter: 'counter', canteenWindow: 'windowSeat', labBoard: 'labBoard', bus: 'busWindow', home: 'homeCrawl',
  bathroom: 'bathroomMirror', palmEye: 'palmEye', water: 'waterDown', bedroom: 'bedFeet', 'bedroom.ceiling': 'ceilingCrack',
  infirmary: 'infirmaryBed', 'infirmary.ceiling': 'ceilingCrack', placeholder: 'deskFeet',
} satisfies Partial<Record<SetId | string, ShotId>>;

export const DEFAULT_SET_SHOT: SetShot = SET_SHOTS.deskFeet as SetShot;

/**
 * 跑段中的临时机位偏移：yaw（弧度，正 = 向左），下俯（注视点下移，米），高度偏移。pan = true 时镜头原地转头（不绕玩家转），
 * 同时横移 dx 米、前移 −dz 米；minSec：至少保持这么久（cue 的 seconds 更短时按它）。
 * 修复轮 U5：glanceLeft（1-3「倒影晚半拍抬头」）原地向左转 20°、朝镜子横移 0.4 m 并前推 0.8 m、至少 1.2 s。以前绕玩家转 8°，
 * 镜头反而离镜子更远，替身的头只有 3–4 px，还被洗手台挡住。
 */
export const RUN_SHOT_OFFSETS: Partial<Record<ShotId, { yaw: number; lookDy: number; dy: number; lookAhead?: number; pan?: boolean; dx?: number; dz?: number; minSec?: number }>> = {
  glanceLeft: { yaw: 20 * Math.PI / 180, lookDy: -0.1, dy: 0, pan: true, dx: -0.4, dz: -0.8, minSec: 1.2 },
  mirrorClose: { yaw: 0, lookDy: 0, dy: 0 },
  puddleDown: { yaw: 0, lookDy: -1.25, dy: 0.35, lookAhead: 3.2 },
  turnBack: { yaw: Math.PI * 160 / 180, lookDy: 0, dy: 0 },
  follow: { yaw: 0, lookDy: 0, dy: 0 },
};

/**
 * 站立段机位（§5.4）：(0, 1.62, +1.9) 注视 (0, 1.5, −8)；trackSky：摔倒后从髋部看向抬起、发抖的脚，后面是灰白的天
 * （修复轮 U5：以前从脚后方仰拍，画面里只有天）。
 */
export const STAND_SHOTS = {
  standEye: { pos: [0, 1.62, 1.9] as const, look: [0, 1.5, -8] as const },
  trackSky: { pos: [0.3, 0.25, -0.1] as const, look: [-0.1, 0.9, -0.8] as const },
};

/**
 * 追尾机位（§5.4）。横屏（修复轮 U5，偏离 §5.4 的 (0.7·x, 0.92, +2.35) 注视 (·, 0.45, −7)）：抬高到 1.15 m、拉远到 2.8 m、
 * 注视点压到 0.20 m，本车道前方的障碍从主角头顶上方露出来；剩下约 5 m 的盲区由上半身淡出补上（actors/readability.ts，
 * 单元测试 occlusion.test.ts 检查全部章节）。竖屏不动。
 */
export const FOLLOW = {
  landscape: { k: 0.7, h: 1.15, back: 2.8, ly: 0.2, lz: -7, lookK: 0.42, hfov: 76, vMin: 50, vMax: 62 },
  portrait: { k: 0.6, h: 1.3, back: 3.8, ly: 0.3, lz: -6, lookK: 0.3, vMax: 80 },
} as const;

/**
 * 跑段里某一拍区间的专门追尾机位（修复轮 U5）。5-3 @30–@140：反向的影子从身后追来（第二个影子在身后 follower.distance 处），
 * 默认机位看不到身后 2 m；拉高拉远、看向前方 2 m 的地面，自己的影子（前右方）和追来的影子都在画面里。
 * pos / look 相对玩家（x 跟随车道：pos.x = k·x + dx，look.x = lookK·x + lx）；fov 为竖直视角（横屏），竖屏 ×1.3、≤ 80°。
 */
export interface SegmentShot { from: number; to: number; dx: number; h: number; back: number; lx: number; ly: number; lz: number; fov: number; blend: number }
export const SEGMENT_SHOTS: Readonly<Record<string, SegmentShot>> = {
  '5-3': { from: 30, to: 140, dx: 0.4, h: 1.8, back: 3.8, lx: 0, ly: 0, lz: -2, fov: 60, blend: 1.0 },
};

/**
 * 停拍里第三只手穿过玻璃碰你的额头（2-10「掌心贴掌心」之后，forehead 手势开始起 2.2 s）：切到侧面机位（修复轮 U5）。
 * 追尾机位从你身后看，镜中替身正好在你后脑勺后面。pos / look 相对玩家的根（世界坐标轴，−z 是前方）。
 */
export const THROUGH_GLASS_SHOT = { pos: [1.1, 1.1, -0.2] as const, look: [-0.2, 0.95, -1.3] as const, fov: 55, from: 0, to: 2.2 };

/** 停拍里看水洼里的倒影（3-4）：镜头在主角前方 far 米、离地 h 米，回头看主角前方 lookAhead 米处的水面（lookY 低于地面一点）。 */
export const PUDDLE_GAZE = { far: 2.4, h: 0.8, lookAhead: 0.9, lookY: -0.2 } as const;
