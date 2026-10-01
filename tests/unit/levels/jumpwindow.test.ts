// tests/unit/levels/jumpwindow.test.ts —— R15-jump 撑跃窗口（评审 U2，先报 warning）：小步幅、慢步频时滞空被夹在 0.72 s，
// 越过障碍要的时间却按速度变长，窗口会缩到 0（3-2 的拖把桶）。
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../../src/core/constants';
import { compile } from '../../../src/levels/compile';
import { OBSTACLES } from '../../../src/levels/obstacles';
import type { ChapterDef } from '../../../src/levels/schema';
import { JUMP_WINDOW_MIN, jumpWindows, validateChapter } from '../../../src/levels/validate';
import { jumpDuration } from '../../../src/sim/Player';
import { solver } from '../../../src/sim/Solver';
import { TUNING } from '../../../src/sim/tuning';
import { chapter, Driver, runSeg } from '../sim/fixtures';

const bucket = (stride: number, cadence: number): ChapterDef => chapter([runSeg({
  id: 'j', beats: 40, stride, cadence, rows: [[20, ['.', 'mopBucket', '.']]], events: [{ at: 2, type: 'hint', hint: 'jump' }],
})]);
const r15 = (def: ChapterDef) => validateChapter(def, solver).issues.filter((i) => i.rule === 'R15-jump');

describe('R15-jump：撑跃窗口 < 0.16 s 报 warning', () => {
  it('0.6 步幅、3.0 掌/s（1.8 m/s）的中道拖把桶：怎么跳都越不过，报 warning（不是 error）', () => {
    const is = r15(bucket(0.6, 3.0));
    expect(is.length).toBe(1);
    expect(is[0]!.level).toBe('warn');
    expect(is[0]!.msg).toContain('mopBucket @20');
    expect(is[0]!.msg).toContain('no jump timing');
    expect(jumpWindows(compile(bucket(0.6, 3.0)).segments[0]!)[0]!.window).toBe(0);
  });
  it('同样的拖把桶在 1.0 步幅、4.8 掌/s 下不报；窗口与解析值一致', () => {
    expect(r15(bucket(1.0, 4.8))).toEqual([]);
    const w = jumpWindows(compile(bucket(1.0, 4.8)).segments[0]!)[0]!.window;
    // 滞空中盒底高过桶顶的时长 − 玩家盒（0.5 m）扫过桶（0.36 m）的时长
    const spec = OBSTACLES.mopBucket;
    const air = jumpDuration(4.8);
    const analytic = air * Math.sqrt(1 - spec.y1 / TUNING.jump.peak) - (spec.depth + TUNING.hitbox.sFront + TUNING.hitbox.sBack) / 4.8;
    expect(Math.abs(w - analytic)).toBeLessThanOrEqual(2 * TICK_DT + 1e-9);
    expect(w).toBeGreaterThan(JUMP_WINDOW_MIN);
  });
  it('与 Sim 逐 tick 一致：枚举起跳 tick，实际不受击的起跳次数 × TICK_DT = 窗口', () => {
    for (const [stride, cad] of [[1.0, 4.8], [0.6, 4.6], [1.1, 5.4]] as Array<[number, number]>) {
      const def = bucket(stride, cad);
      const seg = compile(def).segments[0]!;
      const o = seg.obstacles.find((q) => q.kind === 'mopBucket')!;
      const w = jumpWindows(seg).find((r) => r.o.id === o.id)!.window;
      // 起跳 tick 的范围：接触前 1 s 以内
      const contact = Math.round(seg.timeAt((o.s0 - TUNING.hitbox.sFront - seg.s0) / seg.stride) / TICK_DT);
      let clear = 0;
      for (let m = contact - 120; m < contact; m++) {
        const d = new Driver(def);
        d.step(m);
        d.tap('up');
        d.until(() => d.snap.player.s > o.s1 + 1, 120 * 20);
        if (!d.of('hit').some((h) => h.data.obstacleId === o.id)) clear++;
      }
      expect(Math.abs(clear * TICK_DT - w), `stride ${stride}, ${cad} palms/s`).toBeLessThanOrEqual(TICK_DT + 1e-9);
    }
  });
});
