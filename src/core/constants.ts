// src/core/constants.ts —— 全局常量（DESIGN.md §2.3、§2.6、§5.8、§8.4、§8.7、§9.4）。CORE 冻结。
import type { EventBody } from '../levels/schema';
import type { WpId } from './types';

export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;
export const LANE_WIDTH = 1.1;
/** 走廊的视觉宽度（§2.3）。 */
export const CORRIDOR_WIDTH = 3.6;
export const CHUNK_LEN = 12;
/** 绘制顺序（§5.8 表）。 */
export const RENDER_ORDER = { backdrop: -30, floor: -20, puddleMask: -19, puddleDouble: -18, puddleOverlay: -17,
  planarShadow: -16, floorDecal: -15, opaque: 0, glass: 10, rain: 11, fx: 12 } as const;
/** 模板位约定（§5.8）：水洼 0x80，平面影子低 7 位。 */
export const STENCIL = { puddleBit: 0x80, shadowMask: 0x7f } as const;
/** 稳度 → 相位差（拍），下标 = 稳度（§2.6）。 */
export const LAG_BEATS = { behind: [0, 0.17, 0.33, 0.5, 0.5], pressure: [0, 0.17, 0.33], synced: [0.38, 0.25, 0.12, 0, 0] } as const;
/** ahead 模式：稳度 → 领跑者在前方的距离（米），下标 = 稳度（§2.6）。 */
export const AHEAD_DISTANCE = [12, 9, 6, 3, 3] as const;
/** ahead 模式的相位（拍，负 = 在前）（§2.6）。 */
export const AHEAD_LAG = -0.25;
/** 追随者五通道混音参数，下标 = 稳度（behind / pressure）（§2.6）。 */
export const FOLLOWER_MIX = [
  { gainDb: -7,  lowpass: 8000, panWidth: 0,    reverb: 0.20, vignette: 0.6 },
  { gainDb: -10, lowpass: 5500, panWidth: 0.10, reverb: 0.30, vignette: 0.4 },
  { gainDb: -14, lowpass: 3500, panWidth: 0.20, reverb: 0.45, vignette: 0.2 },
  { gainDb: -18, lowpass: 2000, panWidth: 0.35, reverb: 0.60, vignette: 0.0 },
] as const;
/** 追随者档位之间的滑变时间（秒，§2.6）。 */
export const FOLLOWER_SLIDE = 0.3;
/** HUD 空心点位移 = 相位差 × 72 px（§7.2）。 */
export const HUD_PX_PER_BEAT = 72;
/** 字幕：每行 ≤ 24 字，最多 2 行；停留 = 字数 × 90 ms + 800 ms（§7.2、R14）。 */
export const TEXT = { maxChars: 24, maxLines: 2, msPerChar: 90, baseMs: 800 } as const;
export const LIMITS = { stillMaxSec: 15, nonRunMaxRatio: 0.25, notesPerChapter: 3, peakDbfs: -8, anomalyAttackMs: 150, flickerMaxHz: 3 } as const;
/** draw call / 三角形预算（§9.4）。 */
export const BUDGET = { low: { drawCalls: 50, triangles: 60_000 }, medium: { drawCalls: 80, triangles: 120_000 }, high: { drawCalls: 110, triangles: 200_000 } } as const;
/** 两次必需动作的最小间隔（秒），按章（§2.8；test 章取第一章的值）。 */
export const MIN_ACTION_GAP = { ch1: 0.9, ch2: 0.75, ch3: 0.65, ch4: 0.6, ch5: 0.6, test: 0.9 } as const;

/**
 * 表现类 cue 的唯一处理者（§8.7）。'sim' = 模拟自己处理（快照里体现）；其余由对应包 registerCueHandler。
 * 'beat' 归 CORE：写入 beatsFired。
 */
export const CUE_OWNER: Record<EventBody['type'], 'sim' | WpId> = {
  follower: 'sim', twitch: 'sim', drift: 'sim', slow: 'sim', stop: 'sim', autoCrawl: 'sim', cadence: 'sim', noteGet: 'sim',
  leader: 'sim', hush: 'sim', flip: 'sim', end: 'sim',
  text: 'WP8', hint: 'WP8', count: 'WP8', noteOpen: 'WP8', hud: 'WP8', overlay: 'WP8',
  double: 'WP5', doubleMod: 'WP5', doubleEnd: 'WP5', shadow: 'WP5', memory: 'WP5', actor: 'WP5', camera: 'WP5',
  board: 'WP3', lights: 'WP3', atmosphere: 'WP3', fog: 'WP3',
  rain: 'WP4',
  crowd: 'WP6',
  bell: 'WP7', sfx: 'WP7', ambience: 'WP7', silence: 'WP7',
  beat: 'CORE',
};
/** 是否为模拟类事件（Sim 自己处理，不作为 cue 分发）。 */
export function isSimCue(type: EventBody['type']): boolean { return CUE_OWNER[type] === 'sim'; }
