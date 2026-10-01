// src/ui/hud/ink.ts —— 亮底墨色模式（U4）。WP8。
// 白色字幕只靠阴影衬底，在亮场景里对比度只有 1.0–2.0:1（梦里的广场、阴天、日光灯、白瓷砖厕所）。
// 这些场景里 #ui 挂上 hw-ink-dark：字幕、低语、章名、暂停键、节拍点改用墨色配浅色光晕（styles.css）。暗场景保持粉笔白。
import type { AtmosphereId, ChapterId } from '../../core/types';
import { getChapter } from '../../levels/chapters/index';

export const INK_CLASS = 'hw-ink-dark';

/** 亮的氛围预设（§5.2：梦、梦里变灰、阴天、日光灯）。 */
export const INK_ATMOSPHERES: ReadonlySet<AtmosphereId> = new Set<AtmosphereId>(['dream', 'dreamGray', 'overcast', 'fluorescent']);
/** 暗的氛围预设：场景再白也不切墨色。 */
export const DARK_ATMOSPHERES: ReadonlySet<AtmosphereId> = new Set<AtmosphereId>(['nightIndoor', 'rainNight', 'busNight', 'homeDark', 'voidDark']);
/** 氛围本身不算亮、但满屏白瓷砖 / 白墙的场景：1-3 早晨的厕所（washroom）、5-9 / 5-10 医务室（infirmary）。 */
export const INK_KITS: ReadonlySet<string> = new Set(['washroom']);
export const INK_SETS: ReadonlySet<string> = new Set(['infirmary']);

/** 氛围（加上跑段的 kit / 静场的 set）→ 是否用墨色。 */
export function inkFor(atmosphere: AtmosphereId, place: { kit?: string | undefined; set?: string | undefined } = {}): boolean {
  if (INK_ATMOSPHERES.has(atmosphere)) return true;
  if (DARK_ATMOSPHERES.has(atmosphere)) return false;
  return (!!place.kit && INK_KITS.has(place.kit)) || (!!place.set && INK_SETS.has(place.set));
}

/** 某章某段：按段定义的氛围与场景；atmosphere cue 改过本段的氛围时传 override。找不到段时为 false。 */
export function inkForSegment(ch: ChapterId, segment: string, override?: AtmosphereId | null): boolean {
  const def = getChapter(ch)?.segments.find((s) => s.id === segment);
  if (!def) return false;
  const d = def as { kit?: string; set?: string };
  return inkFor(override ?? def.atmosphere, { kit: d.kit, set: d.set });
}
