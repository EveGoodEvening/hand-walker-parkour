// src/levels/obstacles.ts —— 障碍数值表（DESIGN.md §2.5、§8.5）。CORE 冻结。碰撞数值是契约。
// 视觉尺寸 ≈ 碰撞盒 ÷ 0.85。halfW 是横向半宽；y0..y1 是竖直范围；depth 是沿 s 的深度（米）。
import type { ArchetypeId } from '../core/contracts';
import type { ObstacleClass } from '../core/types';

export type ObstacleKind =
  | 'footOut' | 'bag' | 'books' | 'mopBucket' | 'curb' | 'pipe' | 'bikeDown' | 'cone' | 'hurdleDown' | 'kneeler' | 'newspapers'
  | 'longTable' | 'deskBar' | 'chairBar' | 'labBench' | 'mopAcross' | 'gateBar' | 'barrierArm' | 'bikeRack' | 'shutterHalf' | 'hurdle' | 'reach'
  | 'legs' | 'chenMo' | 'cart' | 'bin' | 'pillar' | 'locker' | 'scooter' | 'car' | 'bollard' | 'stroller' | 'stallDoor' | 'crawler'
  | 'wet' | 'puddle' | 'leaves'
  | 'note';
export interface ObstacleSpec { cls: ObstacleClass; halfW: number; y0: number; y1: number; depth: number; archetype: ArchetypeId; fullWidth?: true; npc?: true; leavesWet?: number }
const S = (cls: ObstacleClass, halfW: number, y0: number, y1: number, depth: number, archetype: ArchetypeId, x: Partial<ObstacleSpec> = {}): ObstacleSpec => ({ cls, halfW, y0, y1, depth, archetype, ...x });
export const OBSTACLES: Record<ObstacleKind, ObstacleSpec> = {
  // low：撑跃或换道；碰到只算「绊」
  footOut:    S('low', 0.30, 0, 0.16, 0.30, 'footOut', { npc: true }),
  bag:        S('low', 0.20, 0, 0.28, 0.30, 'lowBox'),
  books:      S('low', 0.22, 0, 0.25, 0.28, 'lowBox'),
  mopBucket:  S('low', 0.20, 0, 0.35, 0.36, 'bucket', { leavesWet: 3 }),
  curb:       S('low', 0.55, 0, 0.18, 0.30, 'curb'),
  pipe:       S('low', 0.55, 0, 0.20, 0.20, 'curb'),
  bikeDown:   S('low', 0.50, 0, 0.32, 0.60, 'bikeDown'),
  cone:       S('low', 0.14, 0, 0.34, 0.26, 'bucket'),
  hurdleDown: S('low', 0.50, 0, 0.25, 0.20, 'curb'),
  kneeler:    S('low', 0.32, 0, 0.35, 0.60, 'kneeler', { npc: true }),
  newspapers: S('low', 0.25, 0, 0.22, 0.35, 'lowBox'),
  // bar：伏低或换道；下沿 ≥ 0.36
  longTable:  S('bar', 0.52, 0.40, 0.76, 0.80, 'tableBar'),
  deskBar:    S('bar', 0.45, 0.38, 0.46, 0.35, 'tableBar'),
  chairBar:   S('bar', 0.45, 0.38, 0.48, 0.40, 'chairBar'),
  labBench:   S('bar', 0.55, 0.40, 0.90, 1.20, 'tableBar'),
  mopAcross:  S('bar', 0.55, 0.36, 0.44, 0.10, 'armBar'),
  gateBar:    S('bar', 1.65, 0.40, 0.48, 0.08, 'armBar', { fullWidth: true }),
  barrierArm: S('bar', 1.65, 0.42, 0.50, 0.08, 'armBar', { fullWidth: true }),
  bikeRack:   S('bar', 0.55, 0.38, 1.00, 0.10, 'armBar'),
  shutterHalf:S('bar', 0.55, 0.40, 2.40, 0.10, 'shutter'),
  hurdle:     S('bar', 0.50, 0.42, 0.50, 0.10, 'armBar'),
  reach:      S('bar', 0.55, 0.40, 0.48, 0.12, 'armBar', { npc: true }),
  // block：只能换道
  legs:       S('block', 0.26, 0, 1.70, 0.30, 'legs', { npc: true }),
  chenMo:     S('block', 0.35, 0, 1.00, 0.50, 'legs', { npc: true }),
  cart:       S('block', 0.40, 0, 1.00, 0.90, 'cart'),
  bin:        S('block', 0.25, 0, 0.95, 0.40, 'column'),
  pillar:     S('block', 0.30, 0, 3.00, 0.40, 'column'),
  locker:     S('block', 0.40, 0, 1.80, 0.45, 'column'),
  scooter:    S('block', 0.30, 0, 1.05, 1.40, 'vehicle'),
  car:        S('block', 0.55, 0, 1.40, 4.00, 'vehicle'),
  bollard:    S('block', 0.12, 0, 0.90, 0.12, 'column'),
  stroller:   S('block', 0.30, 0, 1.00, 0.75, 'cart'),
  stallDoor:  S('block', 0.45, 0, 1.80, 0.06, 'stallDoor'),
  crawler:    S('block', 0.30, 0, 0.55, 1.10, 'crawler', { npc: true }),   // 例外：梦中移动的人，剪影靠动作识别
  // soft / pickup
  wet:        S('soft', 0.55, 0, 0, 1.00, 'floorDecal'),
  puddle:     S('soft', 0.45, 0, 0, 1.40, 'floorDecal'),
  leaves:     S('soft', 0.55, 0, 0, 1.00, 'floorDecal'),
  note:       S('pickup', 0.15, 0, 0.05, 0.20, 'note'),
};

/** 全部障碍种类（按表顺序）。 */
export const OBSTACLE_KINDS = Object.keys(OBSTACLES) as ObstacleKind[];
/** 视觉尺寸系数：视觉 ≈ 碰撞 ÷ 0.85（§8.5）。 */
export const VISUAL_SCALE = 1 / 0.85;
