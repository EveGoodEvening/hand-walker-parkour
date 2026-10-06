// src/core/urlParams.ts —— URL 参数（DESIGN.md §8.8）。CORE 冻结。
// ?test=1&seed=42&q=low&mute=1&ch=ch3&seg=3-4&beat=60&autopilot=perfect&nocards=1&unlock=1&rf=1&rm=1&assist=1&debug=perf|hitbox
import type { ChapterId, QualityTier } from './types';

export interface UrlParams {
  /** rAF 只渲染、不推进模拟；由 step/advance 推进。 */
  test: boolean;
  seed: number | null;
  q: QualityTier | null;
  /** 不创建 AudioContext，只记录 cue。 */
  mute: boolean;
  ch: ChapterId | null;
  seg: string | null;
  beat: number | null;
  autopilot: 'off' | 'perfect' | 'human' | null;
  /** 跳过开场卡和结尾卡。 */
  nocards: boolean;
  unlock: boolean;
  /** 减少闪烁。 */
  rf: boolean;
  /** 减少晃动。 */
  rm: boolean;
  assist: boolean;
  /** debug=perf|hitbox（可用逗号或竖线分隔多个）。 */
  debug: ReadonlySet<string>;
  /** test 或 debug 任一存在时，__game 的可变方法可用（§8.8）。 */
  debugEnabled: boolean;
}

const CH: readonly ChapterId[] = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'test'];

export function parseUrlParams(search: string): UrlParams {
  const u = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const flag = (k: string) => { const v = u.get(k); return v !== null && v !== '0' && v !== 'false'; };
  const num = (k: string) => { const v = u.get(k); if (v === null || v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const q = u.get('q');
  const ch = u.get('ch');
  const ap = u.get('autopilot');
  const debugRaw = u.get('debug');
  const debug = new Set((debugRaw ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean));
  const test = flag('test');
  return {
    test,
    seed: num('seed'),
    q: q === 'low' || q === 'medium' || q === 'high' ? q : null,
    mute: flag('mute'),
    ch: ch && (CH as readonly string[]).includes(ch) ? (ch as ChapterId) : null,
    seg: u.get('seg'),
    beat: num('beat'),
    autopilot: ap === 'off' || ap === 'perfect' || ap === 'human' ? ap : null,
    nocards: flag('nocards'),
    unlock: flag('unlock'),
    rf: flag('rf'),
    rm: flag('rm'),
    assist: flag('assist'),
    debug,
    debugEnabled: test || debugRaw !== null,
  };
}

let cached: UrlParams | null = null;
/** 当前页面的参数（Node 环境下为全默认）。 */
export function urlParams(): UrlParams {
  if (cached) return cached;
  const loc = (globalThis as { location?: { search: string } }).location;
  cached = parseUrlParams(loc?.search ?? '');
  return cached;
}
