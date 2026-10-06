// src/core/settings.ts —— 设置（DESIGN.md §7.3、§8.4）。CORE 实现，接口冻结。
// 所有 localStorage 读写都包在 try/catch 里；失败时用默认值照常运行（§7.3）。
import type { QualityTier } from './types';

export interface Settings {
  quality: 'auto' | QualityTier; master: number; sfx: number; ambience: number;
  reducedFlicker: boolean; reducedMotion: boolean; subtitleSize: 'normal' | 'large'; metronome: boolean; hints: boolean;
  assist: boolean; swipe: 'low' | 'mid' | 'high'; vibrate: boolean; autoRetry: boolean; outlines: boolean;
}

/** §7.3 的默认值。 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  quality: 'auto', master: 80, sfx: 90, ambience: 70,
  reducedFlicker: false, reducedMotion: false, subtitleSize: 'normal', metronome: true, hints: true,
  assist: false, swipe: 'mid', vibrate: true, autoRetry: false, outlines: false,
});

/** 滑动阈值（px）：低 / 中 / 高 = 32 / 24 / 16（§2.2）。 */
export const SWIPE_PX: Readonly<Record<Settings['swipe'], number>> = { low: 32, mid: 24, high: 16 };

/** 把任意对象清洗成合法 Settings（未知键丢弃，类型不对的键回落默认值）。 */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = (k: 'master' | 'sfx' | 'ambience') => { const v = r[k]; if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(100, v)); };
  const bool = (k: 'reducedFlicker' | 'reducedMotion' | 'metronome' | 'hints' | 'assist' | 'vibrate' | 'autoRetry' | 'outlines') => { const v = r[k]; if (typeof v === 'boolean') out[k] = v; };
  num('master'); num('sfx'); num('ambience');
  bool('reducedFlicker'); bool('reducedMotion'); bool('metronome'); bool('hints'); bool('assist'); bool('vibrate'); bool('autoRetry'); bool('outlines');
  if (r.quality === 'auto' || r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') out.quality = r.quality;
  if (r.subtitleSize === 'normal' || r.subtitleSize === 'large') out.subtitleSize = r.subtitleSize;
  if (r.swipe === 'low' || r.swipe === 'mid' || r.swipe === 'high') out.swipe = r.swipe;
  return out;
}
