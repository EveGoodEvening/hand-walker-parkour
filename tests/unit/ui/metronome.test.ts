// tests/unit/ui/metronome.test.ts —— 节拍器在六种追随者模式下的快照（DESIGN.md §2.6、§7.2；§8.10 WP8 验收 7）。
// 快照覆盖：hidden / absent / behind / pressure（空心点与 5-3 的影子实心点）/ synced / ahead，每种都跑稳度 0–3（pressure 0–2），
// 外加 from = 'front'、followerFadeOutBehind、节拍器关闭、掌心发烫 / 发麻、闪点时序。另有逐条的显式断言，快照只是防回归。
import { describe, expect, it } from 'vitest';
import { AHEAD_DISTANCE, LAG_BEATS } from '../../../src/core/constants';
import type { FollowerMode, FollowerSnap } from '../../../src/core/types';
import { FLASH_SEC, metronome, type MetroInput } from '../../../src/ui/hud/metronome';
import { follower } from './helpers';

function lagOf(mode: FollowerMode, s: number): number {
  if (mode === 'behind') return LAG_BEATS.behind[s] as number;
  if (mode === 'pressure') return LAG_BEATS.pressure[s] as number;
  if (mode === 'synced') return LAG_BEATS.synced[s] as number;
  if (mode === 'ahead') return -0.25;
  return 0;
}
function fsnap(mode: FollowerMode, s: number, p: Partial<FollowerSnap> = {}): FollowerSnap {
  const hud = mode === 'hidden' || mode === 'absent' ? 'none' : 'dots';
  return follower({ mode, hud, voice: hud === 'none' ? 'none' : 'echo', from: mode === 'ahead' ? 'front' : 'behind', lagBeats: lagOf(mode, s),
    distance: mode === 'ahead' ? AHEAD_DISTANCE[s] as number : mode === 'pressure' ? 0.5 + s * 0.75 : 0, ...p });
}
function input(mode: FollowerMode, s: number, p: Partial<MetroInput> = {}, fp: Partial<FollowerSnap> = {}): MetroInput {
  return { t: 10, steady: s, follower: fsnap(mode, s, fp), flashSelf: [-1, -1, -1], flashFollow: [-1, -1, -1], metronome: true,
    showFollower: true, behindFaded: false, reducedMotion: true, palm: 'none', ...p };
}

describe('六种模式', () => {
  const modes: FollowerMode[] = ['hidden', 'absent', 'behind', 'pressure', 'synced', 'ahead'];
  for (const mode of modes) {
    it(`${mode}：稳度 0–3 的视图快照`, () => {
      const max = mode === 'pressure' ? 2 : 3;
      const views = Array.from({ length: max + 1 }, (_, s) => metronome(input(mode, s)));
      expect(views).toMatchSnapshot();
    });
  }
  it('hidden / absent：只有实心点，亮度按稳度 40 / 60 / 80 / 100%', () => {
    for (const m of ['hidden', 'absent'] as const) {
      const v = [0, 1, 2, 3].map((s) => metronome(input(m, s)));
      expect(v.map((x) => x.followVisible)).toEqual([false, false, false, false]);
      expect(v.map((x) => x.selfOpacity)).toEqual([0.4, 0.6, 0.8, 1]);
    }
  });
  it('behind：空心点在左下方，位移 = 相位差 × 72 px（36 / 24 / 12 / 0），越近越清楚', () => {
    const v = [3, 2, 1, 0].map((s) => metronome(input('behind', s)));
    expect(v.map((x) => x.place)).toEqual(['behind', 'behind', 'behind', 'behind']);
    expect(v.map((x) => Math.abs(x.followDx))).toEqual([36, 23.8, 12.2, 0]);
    expect(v.every((x) => x.followDy >= 0)).toBe(true);
    expect(v[3]!.followOpacity).toBeGreaterThan(v[0]!.followOpacity);
  });
  it('pressure：3-6 是空心点；5-3（hud = shadow）是深灰实心点', () => {
    expect(metronome(input('pressure', 2)).followKind).toBe('hollow');
    const sh = metronome(input('pressure', 2, {}, { hud: 'shadow' }));
    expect(sh.followKind).toBe('shadow'); expect(sh.followVisible).toBe(true);
  });
  it('synced：稳度满时与实心点重叠，稳度越低越散', () => {
    const v = [3, 2, 1, 0].map((s) => metronome(input('synced', s)));
    expect(v[0]).toMatchObject({ place: 'overlap', followDx: 0, followDy: 0 });
    expect(Math.abs(v[3]!.followDx)).toBeGreaterThan(Math.abs(v[1]!.followDx));
  });
  it('ahead：空心点在右上方，偏移量随距离变化（3 m 最近，12 m 最远）', () => {
    const v = [3, 2, 1, 0].map((s) => metronome(input('ahead', s)));
    expect(v.map((x) => x.place)).toEqual(['ahead', 'ahead', 'ahead', 'ahead']);
    expect(v.map((x) => x.followDx)).toEqual([12, 24, 36, 48]);
    expect(v.every((x) => x.followDy < 0)).toBe(true);
  });
});

describe('其余状态', () => {
  it('2-10 结尾 from = front：behind 模式的空心点也放到右上方', () => {
    expect(metronome(input('behind', 3, {}, { from: 'front' })).place).toBe('ahead');
  });
  it('followerFadeOutBehind（5-9）之后身后的空心点不再出现；hud hide 同理', () => {
    expect(metronome(input('behind', 3, { behindFaded: true })).followVisible).toBe(false);
    expect(metronome(input('ahead', 3, { behindFaded: true })).followVisible).toBe(true);
    expect(metronome(input('behind', 3, { showFollower: false })).followVisible).toBe(false);
  });
  it('设置里隐藏节拍器：实心点、空心点都不显示', () => {
    const v = metronome(input('behind', 2, { metronome: false }));
    expect(v.selfVisible).toBe(false); expect(v.followVisible).toBe(false); expect(v.followOpacity).toBe(0);
  });
  it('闪点：0 / 26 / 52 ms 依次点亮，各亮 150 ms', () => {
    const base = input('behind', 3, { flashSelf: [10, 10.026, 10.052], flashFollow: [9.8, -1, -1] });
    expect(metronome({ ...base, t: 10.01 }).selfLit).toEqual([true, false, false]);
    expect(metronome({ ...base, t: 10.06 }).selfLit).toEqual([true, true, true]);
    expect(metronome({ ...base, t: 10 + FLASH_SEC + 0.01 }).selfLit).toEqual([false, true, true]);
    expect(metronome({ ...base, t: 10.2 }).selfLit).toEqual([false, false, true]);
    expect(metronome({ ...base, t: 10.01 }).followLit).toEqual([false, false, false]);
  });
  it('稳度 0 时实心点轻微颤动（减少晃动时不颤）；掌心发烫泛白、发麻抖动', () => {
    const shake = [0.1, 0.2, 0.3].map((t) => metronome(input('behind', 0, { t, reducedMotion: false })).selfDx);
    expect(shake.some((x) => x !== 0)).toBe(true);
    expect(metronome(input('behind', 0, { reducedMotion: true })).selfDx).toBe(0);
    expect(metronome(input('behind', 3, { palm: 'heat' }))).toMatchObject({ selfWhite: true, selfLit: [true, true, true] });
    const numb = [0.1, 0.2, 0.3].map((t) => metronome(input('behind', 3, { t, palm: 'numb', reducedMotion: false })));
    expect(numb.some((x) => x.selfDx !== 0 || x.selfDy !== 0)).toBe(true);
  });
});
