// src/audio/follower.ts —— 追随者的声音映射（DESIGN.md §2.6、§6.2「追随者」一行、D5）。WP7。纯函数，Node 可测。
// 追随者的逼近用六个通道同时表达：相位差（模拟负责）、增益、低通、声像宽度、混响（这里）、HUD 与暗角（WP8）。
// behind / pressure 直接查 FOLLOWER_MIX；synced（第四章）不随稳度变亮，改为 −10 dB 的加厚齐奏，越低越散；
// ahead（第五章）声像在前、偏亮、随距离变轻；3-2 楼梯的 lagOverride = 1 拍：「从上方传来」，闷、湿。
// 相对自己的掌声：总增益 = 表里的 gainDb（追随者库本身已经低 6 dB，总线再补回 6 dB）。
import { FOLLOWER_MIX } from '../core/constants';
import type { FollowerSnap } from '../core/types';
import type { FollowerMix } from './mixer';
import { FOLLOWER_BASE_DB } from './recipes/palm';

export const SILENT_MIX: FollowerMix = { audible: false, gainDb: -120, lowpass: 2000, panWidth: 0, reverb: 0 };

/** 追随者的混音参数。steady = 当前稳度（离散 0–3）。 */
export function followerMix(f: FollowerSnap, steady: number): FollowerMix {
  if (f.voice === 'none' || f.mode === 'hidden' || f.mode === 'absent') return SILENT_MIX;
  const s = Math.max(0, Math.min(3, Math.floor(steady)));
  const comp = -FOLLOWER_BASE_DB;
  if (f.mode === 'ahead') {
    const d = Math.max(3, f.distance || 3);
    return { audible: true, gainDb: -10 - 20 * Math.log10(d / 3) + comp, lowpass: 9000, panWidth: 0.05, reverb: 0.15 + 0.02 * (d - 3) };
  }
  if (f.mode === 'synced') {
    return { audible: true, gainDb: -10 + comp, lowpass: 5500, panWidth: [0.3, 0.2, 0.1, 0][s] as number, reverb: 0.3 };
  }
  // behind / pressure
  if (f.lagBeats >= 0.75) {
    // 3-2：「但比我慢一拍」，声音从上方传来，带楼道混响
    return { audible: true, gainDb: -12 + comp, lowpass: 3000, panWidth: 0, reverb: 0.75 };
  }
  const row = FOLLOWER_MIX[s] as (typeof FOLLOWER_MIX)[number];
  const m: FollowerMix = { audible: true, gainDb: row.gainDb + comp, lowpass: row.lowpass, panWidth: row.panWidth, reverb: row.reverb };
  if (f.from === 'front') { m.lowpass = Math.min(9000, m.lowpass * 1.5); m.panWidth *= 0.5; }   // 2-10「走廊尽头传来脚步声」
  return m;
}

export function mixKey(m: FollowerMix): string {
  return m.audible ? `${m.gainDb.toFixed(2)}|${m.lowpass.toFixed(0)}|${m.panWidth.toFixed(3)}|${m.reverb.toFixed(3)}` : 'off';
}
