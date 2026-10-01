// src/ui/hud/metronome.ts —— 节拍器的视图模型（DESIGN.md §2.6 模式表、§7.2 节拍器）。WP8。纯函数，快照测试覆盖六种模式。
// 自己：实心点 ●●●，每次落掌按 0 / 26 / 52 ms（三段触地事件）依次点亮 150 ms；亮度按稳度 100 / 80 / 60 / 40%，稳度 0 时轻微颤动。
// 它：空心点 ○○○，横向位移 = 相位差 × 72 px（§2.6 表：36 / 24 / 12 / 0 px），越近越清楚。
//   hidden / absent：不显示；behind / pressure：左下方；synced：与实心点重叠，受击后按 synced 相位差散开；
//   ahead：右上方，偏移量随领跑者距离变化（3–12 m → 12–48 px）；from = 'front'（2-10 结尾）也放右上方。
//   hud = 'shadow'（5-3 反向的影子）：深灰实心点。
// 掌心发烫：实心点泛白；发麻：实心点抖动（§7.2）。
import { HUD_PX_PER_BEAT } from '../../core/constants';
import type { FollowerSnap } from '../../core/types';

export const FLASH_SEC = 0.15;
/** 稳度 0..3 → 实心点亮度。 */
export const SELF_BRIGHTNESS = [0.4, 0.6, 0.8, 1] as const;
/** 稳度 0..3 → 空心点不透明度（越近越清楚，与 §2.6 的增益同向）。 */
export const FOLLOW_OPACITY = [0.9, 0.75, 0.6, 0.45] as const;
/** ahead：每米多少像素。 */
export const AHEAD_PX_PER_M = 4;

export interface MetroInput {
  t: number;
  steady: number;
  follower: FollowerSnap;
  flashSelf: readonly number[];
  flashFollow: readonly number[];
  metronome: boolean;           // 设置「节拍器」
  showFollower: boolean;        // hud cue：show / hide
  behindFaded: boolean;         // hud cue：followerFadeOutBehind（5-9 之后身后永远空）
  reducedMotion: boolean;
  palm: 'none' | 'heat' | 'numb';
}

export interface MetroView {
  selfVisible: boolean;
  selfOpacity: number;
  selfLit: [boolean, boolean, boolean];
  selfDx: number;
  selfDy: number;
  selfWhite: boolean;
  followVisible: boolean;
  followOpacity: number;
  followKind: 'hollow' | 'shadow';
  place: 'none' | 'behind' | 'overlap' | 'ahead';
  followDx: number;
  followDy: number;
  followLit: [boolean, boolean, boolean];
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v)));
const lit = (flash: readonly number[], t: number): [boolean, boolean, boolean] =>
  [0, 1, 2].map((i) => { const f = flash[i] ?? -1; return f >= 0 && t - f >= -1e-6 && t - f < FLASH_SEC; }) as [boolean, boolean, boolean];
const r1 = (v: number) => Math.round(v * 10) / 10 + 0;   // + 0：把 −0 变成 0

export function metronome(i: MetroInput): MetroView {
  const s = clampI(i.steady, 0, 3);
  const f = i.follower;
  const shake = !i.reducedMotion && (s === 0 || i.palm === 'numb');
  const amp = i.palm === 'numb' ? 2.5 : 1.5;
  const selfDx = shake ? r1(Math.sin(i.t * 41) * amp) : 0;
  const selfDy = shake && i.palm === 'numb' ? r1(Math.cos(i.t * 37) * amp * 0.6) : 0;
  let place: MetroView['place'] = 'none';
  let dx = 0, dy = 0;
  if (f.hud !== 'none' && f.mode !== 'hidden' && f.mode !== 'absent') {
    const lagPx = Math.abs(f.lagBeats) * HUD_PX_PER_BEAT;
    if (f.mode === 'ahead' || f.from === 'front' || f.lagBeats < 0) {
      place = 'ahead';
      const px = f.mode === 'ahead' && f.distance > 0 ? Math.min(12, Math.max(3, f.distance)) * AHEAD_PX_PER_M : Math.max(12, lagPx);
      dx = px; dy = -px * 0.35;
    } else if (f.mode === 'synced') {
      place = 'overlap';
      dx = -lagPx; dy = lagPx * 0.5;
    } else {
      place = 'behind';
      dx = -lagPx; dy = lagPx * 0.5;
    }
  }
  const followVisible = i.metronome && i.showFollower && place !== 'none' && !(i.behindFaded && place === 'behind');
  return {
    selfVisible: i.metronome,
    selfOpacity: SELF_BRIGHTNESS[s] as number,
    selfLit: i.palm === 'heat' ? [true, true, true] : lit(i.flashSelf, i.t),
    selfDx, selfDy,
    selfWhite: i.palm === 'heat',
    followVisible,
    followOpacity: followVisible ? (FOLLOW_OPACITY[s] as number) : 0,
    followKind: f.hud === 'shadow' ? 'shadow' : 'hollow',
    place,
    followDx: r1(dx), followDy: r1(dy),
    followLit: lit(i.flashFollow, i.t),
  };
}
