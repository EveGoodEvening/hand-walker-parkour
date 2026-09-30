// src/levels/kitSymbols.ts —— 行速记符号 → 具体障碍（DESIGN.md §4.0、§8.5）。CORE 写初版，之后归 WP2。
// 同一行里多个候选时用 rng.sim 轮换（compile.ts）。
import type { KitId, SetId } from '../core/types';
import type { ObstacleKind } from './obstacles';

export const KIT_VARIANTS: Record<KitId, readonly string[]> = {
  classroom: ['morning', 'night'], corridor: ['morning', 'wet', 'mirrorEnd', 'labNorth', 'night', 'recess', 'void'],
  washroom: ['morning'], stairs: ['dayDown', 'nightDown', 'stairwellUp', 'dawnDown'], canteen: ['forest', 'tray', 'windowWall'],
  labRoom: ['default'], street: ['schoolGate', 'alley', 'shopStreet', 'compound', 'dawn'], plaza: ['bright', 'gray'],
  track: ['default'], placeholder: ['default'],
};
/**
 * 静场场景的变体（§4、§5.9）。WP2 的章节只用这里列出的；WP3 / WP4 的 StillSet.variants 应当覆盖它们。
 * deskFeet：teacher（1-4 英语老师）/ math（5-5 数学课）；bedroom：feet（5-1 被子里的脚）/ ceiling（第四章结尾卡的天花板）；
 * infirmary：bed（5-9 病床与枕边凹陷）/ ceiling（5-10 手形裂缝）。
 */
export const SET_VARIANTS: Record<SetId, readonly string[]> = {
  deskFeet: ['teacher', 'math'], counter: ['default'], canteenWindow: ['default'], labBoard: ['default'], bus: ['default'],
  home: ['default'], bathroom: ['default'], palmEye: ['default'], water: ['default'], bedroom: ['feet', 'ceiling'],
  infirmary: ['bed', 'ceiling'], placeholder: ['default'],
};
export type SymMap = Partial<Record<'L' | 'H' | 'B' | 'W', readonly ObstacleKind[]>>;
export const KIT_SYMBOLS: Record<string, SymMap> = {            // 键 = `${kit}.${variant}`，缺省用 `${kit}.*`
  'classroom.*':        { L: ['footOut', 'bag'], H: ['deskBar'], B: ['legs'], W: ['wet'] },
  'corridor.morning':   { L: ['bag', 'books'], H: ['longTable'], B: ['legs', 'cart', 'bin'], W: ['wet'] },
  'corridor.wet':       { L: ['mopBucket'], H: ['mopAcross'], B: ['cart', 'bin', 'legs'], W: ['wet'] },
  'corridor.mirrorEnd': { L: ['bag', 'books'], H: ['longTable'], B: ['legs', 'bin'], W: ['wet'] },
  'corridor.labNorth':  { L: ['pipe', 'books'], H: ['mopAcross'], B: ['cart', 'locker'], W: ['wet'] },
  'corridor.night':     { L: ['bag', 'mopBucket'], H: ['chairBar'], B: ['locker', 'pillar', 'bin'], W: ['wet'] },
  'corridor.recess':    { L: ['bag'], H: ['longTable'], B: ['legs'], W: ['wet'] },
  'corridor.void':      { L: ['mopBucket', 'bag', 'footOut'], H: ['chairBar', 'longTable'], B: ['legs', 'cart'], W: ['puddle'] },
  'washroom.*':         { L: ['mopBucket'], H: ['mopAcross'], B: ['legs'], W: ['wet'] },
  'stairs.*':           { L: ['bag', 'books', 'newspapers'], B: ['legs', 'stroller'], W: ['wet'] },
  'canteen.*':          { L: ['bag', 'footOut'], H: ['chairBar', 'longTable'], B: ['legs', 'cart'], W: ['wet'] },
  'labRoom.*':          { L: ['pipe'], H: ['labBench'], B: ['cart', 'locker'] },
  'street.schoolGate':  { L: ['curb'], H: ['gateBar'], B: ['legs', 'bollard'] },
  'street.alley':       { L: ['bikeDown', 'curb'], H: ['bikeRack'], B: ['bollard', 'bin'], W: ['puddle'] },
  'street.shopStreet':  { L: ['curb'], H: ['shutterHalf'], B: ['scooter', 'bin'], W: ['puddle'] },
  'street.compound':    { L: ['curb', 'newspapers'], H: ['barrierArm'], B: ['stroller'] },
  'street.dawn':        { L: ['curb'], H: ['barrierArm'], B: ['car', 'bollard', 'bin'], W: ['leaves'] },
  'plaza.*':            { L: ['kneeler'], H: ['reach'], B: ['legs', 'crawler'] },
  'track.*':            { L: ['cone', 'hurdleDown'], H: ['hurdle'], B: ['legs'] },
  // CORE 占位 kit：测试章用
  'placeholder.*':      { L: ['bag'], H: ['longTable'], B: ['bin'], W: ['wet'] },
};

/** 取某 kit 变体的符号表：先找 `${kit}.${variant}`，再找 `${kit}.*`，都没有时回落到占位表。 */
export function symbolsFor(kit: KitId, variant: string): SymMap {
  return KIT_SYMBOLS[`${kit}.${variant}`] ?? KIT_SYMBOLS[`${kit}.*`] ?? (KIT_SYMBOLS['placeholder.*'] as SymMap);
}
