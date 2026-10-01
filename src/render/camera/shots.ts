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
  // 2-9：背靠实验桌腿坐着，看黑板（修复轮 B3 第三轮：这是 5.2 s 转过来之后的机位，之前是 STILL_TURN_BACK.labBoard 的低头看影子）。修复轮 U5 第二轮：镜头在他左后方的低处、越过他的左肩看黑板，右手边的实验台（x = 1.05，
  // 钢架腿就在他身旁，「背靠着实验桌的桌腿」）在画面右侧，挡不住黑板；他在画面右边、不和黑板重叠。第一轮把实验台挪到 x = 1.5，桌腿离他 1.1 m
  labBoard: { pos: [-0.55, 0.45, 0.9], look: [0.15, 1.25, -2.6], fov: 60 },
  // 3-5：公交车，车窗在左侧。从过道上方越过主角的头看车窗（修复轮 U5：以前与头同高，车窗里的「我」有一半被他挡住）
  busWindow: { pos: [0.35, 1.6, 0.9], look: [-1.5, 1.0, -0.6], fov: 55 },
  // 3-9：黑暗的客厅，自动爬行
  homeCrawl: { pos: [0.15, 0.62, 1.9], look: [0, 0.35, -2.5], fov: 62 },
  // 3-10：卫生间镜子。从主角右后方斜着看镜子（修复轮 U5）：镜中的「我」不在他的后脑勺后面
  bathroomMirror: { pos: [0.85, 1.5, 0.6], look: [-0.25, 1.35, -0.87], fov: 62 },
  // 4-4：右手举到眼前（镜头在眼睛里）
  palmEye: { pos: [0.0, 1.02, -0.02], look: [0.04, 1.0, -0.6], fov: 50 },
  // 4-6：跪在水边、从他眼睛里斜着往下看水面（约 −36°，修复轮 U5 第二轮）：倒影里站着的「我」（离他 2.65 m、离岸 2.3 m，water.ts）倒着立在
  // 画面中间，低头看着镜头（Doubles 的 STILL_DOUBLE_LOOK），脸在中间偏下；四周是缩小、压暗的爬行人群；下沿伸进来按在水里的双手和手边的涟漪，岸出画。
  // 以前约 −56°、替身就在镜头下方 0.7 m：只看得见鞋底和腿，头藏在肩膀后面
  waterDown: { pos: [0.0, 0.85, 0.0], look: [0, -0.02, -1.2], fov: 50 },
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
  bathroomMirror: { pos: [0.95, 1.7, 1.0], look: [-0.28, 1.32, -0.87], fov: 45 },
};

/**
 * 静场里过了某个时刻慢慢推到的近景（修复轮 U5）：5-9 推到枕边的凹陷，主角的身体退出画面。
 * 修复轮 U5 第二轮：推得更近、视角收窄到 40°（以前 52°，8.6 s 时他的头、肩和手臂还占着画面左上的四分之一）。
 */
export const SET_SHOT_LATE: Partial<Record<ShotId, { after: number; blend: number; shot: SetShot }>> = {
  infirmaryBed: { after: 7.0, blend: 1.2, shot: { pos: [-0.9, 0.55, 0.6], look: [-0.5, -0.02, 0.75], fov: 40 } },
};

/**
 * 静场里的回头（`camera` cue turnBack：2-9 5.2 s「它多了一只手」指着的方向、3-10 5.4 s「回头：什么也没有」）。修复轮 B3：
 * 以前静场只认 SET_SHOTS，turnBack 被丢掉，镜头一直停在原来的静场机位上。修复轮 B3 第三轮：两处都是「我慢慢地转过……」，
 * 转身用掉 cue 的整段 seconds（2-9 0.8 s、3-10 1.0 s，easeInOutSine），不再是 0.3 s 的甩镜；时刻按段数据算（静场时间的纯函数，
 * CameraRig.onSegment），跳到静场中间（goto）也对。
 * 镜头位置直线平移；朝向按 turn 的方向（+1 向左、−1 向右，按镜头自己的朝向）绕竖直轴转，俯仰、注视距离、视角线性插值。
 * pos / look 相对锚点（主角朝 −z）。「减少晃动」时直接切。
 *   reveal（labBoard，2-9）：这里的机位是转之前的：镜头在他左后方的高处低头看他和地上的影子（「我低头看着自己的影子」），
 *     影子的第三只手从 4.4 s 伸出来指向黑板（actors/PlanarShadow.ts 的 POINT_BACK），黑板在画面外；5.2 s 起顺着那只手
 *     慢慢抬头、转到 SET_SHOTS.labBoard（越过左肩看黑板）并停在那里，6.0 s 的粉笔字就是转过来看见的。WP3 的 set 把黑板放在
 *     主角正前方，所以「转向身后的黑板」只能按镜头算（DESIGN §10.4 建议条目）。以前反过来：开场就看着空黑板，5.2 s 顺着
 *     指向右后方的手转过去，身后空无一物，0.2 s 后甩回来，字在镜头转回来时写出。
 *   hold（bathroomMirror，3-10）：这里的机位是转过去之后的：从他右后方转过去看身后的门和门旁边滴水的毛巾（「只有我背后的卫生间门，
 *     和门旁边墙上挂着的一条毛巾」），一直停到下一次静场机位切换（10.4 s 关门前最后一眼）。「你想让我站起来？」「站起来之后呢？」
 *     是对着门问的（「我慢慢地转过身。门还是那扇门。」）。以前 1.0 s 后转回空镜子。
 * 没有专门机位的静场：原地向左转 160°，TURN_RAMP 秒转过去、到 cue 结束前 TURN_RAMP 秒转回来（与跑段的 turnBack 同速）。
 */
export interface StillTurnShot extends SetShot { turn: 1 | -1; mode: 'reveal' | 'hold' }
export const STILL_TURN_BACK: Partial<Record<ShotId, StillTurnShot>> = {
  labBoard: { mode: 'reveal', pos: [-0.55, 1.7, 0.8], look: [0.45, 0, -0.7], fov: 45, turn: 1 },
  bathroomMirror: { mode: 'hold', pos: [0.5, 1.45, 0.6], look: [-0.25, 1.35, 1.65], fov: 66, turn: 1 },
};
/** 静场 turnBack 的缺省：原地向左转（弧度）。转过去、转回来各用多少秒。 */
export const STILL_TURN_DEFAULT_YAW = Math.PI * 160 / 180;
export const TURN_RAMP = 0.3;

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
 * 跑段里某一拍区间的专门追尾机位（修复轮 U5）。5-3 @30–@212：反向的影子从身后追来（第二个影子在身后 follower.distance 处），
 * 默认机位看不到身后 2 m；拉高拉远、看向前方 2 m 的地面，自己的影子（前右方）和追来的影子都在画面里。
 * 修复轮 U5 第二轮：一直保持到 @212 的公交站（以前到 @140，「我开始跑。」之后追来的影子还在，却在画面外）。
 * 这一段的必需障碍在这个机位下照样按 occlusion 的规则可读（上半身淡出照常；tests/unit/actors/occlusion.test.ts）。
 * pos / look 相对玩家（x 跟随车道：pos.x = k·x + dx，look.x = lookK·x + lx）；fov 为竖直视角（横屏），竖屏 ×1.3、≤ 80°。
 */
export interface SegmentShot { from: number; to: number; dx: number; h: number; back: number; lx: number; ly: number; lz: number; fov: number; blend: number }
export const SEGMENT_SHOTS: Readonly<Record<string, SegmentShot>> = {
  '5-3': { from: 30, to: 212, dx: 0.4, h: 1.8, back: 3.8, lx: 0, ly: 0, lz: -2, fov: 60, blend: 1.0 },
};

/**
 * 停拍里第三只手穿过玻璃碰你的额头（2-10「掌心贴掌心」之后，forehead 手势开始起到替身消失）：切到侧面机位（修复轮 U5）。
 * 第三轮：手势开始后 0–4.0 s（2 s 伸出、碰到额头之后的停留）；实际结束在 doubleEnd 撤掉第三只手的那一帧（5.2 s），镜头直接切回追尾。
 * 追尾机位从你身后看，镜中替身正好在你后脑勺后面。修复轮 U5 第二轮：pos / look 相对「接触点」——你的头心与镜中它的头心的中点
 * （世界坐标轴，−z 是前方，接触点差不多就在玻璃上）：镜头在你右前方的走廊里斜着看玻璃，你的头、它的头、穿过玻璃的手都在画面里。
 * 以前相对你的根，镜头在你头的前面，你的头一直在画面外，指尖停在半空。
 */
export const THROUGH_GLASS_SHOT = { pos: [1.3, 0.15, 0.9] as const, look: [0, -0.05, 0] as const, fov: 55, from: 0, to: 4.0 };

/** 停拍里看水洼里的倒影（3-4）：镜头在主角前方 far 米、离地 h 米，回头看主角前方 lookAhead 米处的水面（lookY 低于地面一点）。 */
export const PUDDLE_GAZE = { far: 2.4, h: 0.8, lookAhead: 0.9, lookY: -0.2 } as const;
