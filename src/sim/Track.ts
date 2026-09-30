// src/sim/Track.ts —— 障碍的运行时状态与流入流出（DESIGN.md §2.5、§8.5 Behavior、§8.9-5）。CORE 编写，归 WP1。
// 行为：static / walk / swing / yield / stretch / shift（fallInto、askable 先按 static 处理，WP1 补全）。
// 所有行为只取决于段内时间 tSeg 和玩家段内拍号（yield / shift / fallInto 按「到点」触发），
// 与玩家横向位置无关（§5.7：伸进过道的脚「不是成心的，只是习惯」）。
import { LANE_WIDTH } from '../core/constants';
import type { Lane } from '../core/types';
import { obstacleX } from '../levels/compile';
import type { CompiledObstacle } from '../levels/schema';

/** 某一时刻障碍的实际状态（碰撞与画面共用）。 */
export interface ObstacleState {
  /** false = 此刻不参与碰撞（门荡开、腿收回、陈默已让开、还没摔进来）。 */
  active: boolean;
  /** 沿 s 的偏移（walk）。 */
  ds: number;
  /** 横向范围。 */
  x0: number; x1: number;
  /** 0..1：门荡进车道的程度 / 腿伸出的程度（画面用）。 */
  amount: number;
}

const frac = (v: number) => v - Math.floor(v);

/** 摆门：open = 0 贴墙，1 完全荡进车道；open > 0.5 时参与碰撞。 */
export function swingOpen(period: number, phase: number, tSeg: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * frac(tSeg / period + phase));
}

export function obstacleState(o: CompiledObstacle, tSeg: number, playerBeat: number, out: ObstacleState): ObstacleState {
  const [x0, x1] = obstacleX(o);
  out.active = true; out.ds = 0; out.x0 = x0; out.x1 = x1; out.amount = 1;
  const b = o.behavior;
  switch (b.type) {
    case 'static': case 'askable': break;
    case 'walk': out.ds = b.speed * tSeg; break;
    case 'swing': {
      const open = swingOpen(b.period, b.phase, tSeg);
      out.amount = open;
      out.active = open > 0.5;
      break;
    }
    case 'stretch': {
      const ph = frac(tSeg / b.period + b.phase);
      out.active = ph < b.outFrac;
      out.amount = out.active ? 1 : 0;
      break;
    }
    case 'yield':
      if (playerBeat >= b.atBeat) { out.active = false; out.amount = 0; }
      break;
    case 'fallInto':
      if (playerBeat < b.atBeat) { out.active = false; out.amount = 0; }
      break;
    case 'shift':
      if (playerBeat >= b.atBeat) {
        const lanes = o.lanes;
        const w = (Math.max(...lanes) - Math.min(...lanes)) * LANE_WIDTH;
        const c = b.toLane * LANE_WIDTH;
        out.x0 = c - w / 2 - o.halfW; out.x1 = c + w / 2 + o.halfW;
      }
      break;
  }
  return out;
}

/** 障碍在此刻覆盖的车道（按横向范围与车道中心 ±0.22 相交判断）。 */
export function lanesCovered(st: ObstacleState): Lane[] {
  const out: Lane[] = [];
  for (const l of [-1, 0, 1] as Lane[]) {
    const c = l * LANE_WIDTH;
    if (st.x0 < c + 0.22 && st.x1 > c - 0.22) out.push(l);
  }
  return out;
}

/**
 * 章内障碍的运行时：已碰倒 / 已拾取的集合，以及按 s 排序的流式游标。
 * 只保存可变部分；障碍本身是编译产物（只读）。
 */
export class TrackRuntime {
  readonly knocked = new Set<number>();
  readonly taken = new Set<number>();
  readonly nearMissed = new Set<number>();

  reset(): void { this.knocked.clear(); this.nearMissed.clear(); }

  /** s 附近（[s − back, s + ahead]）的障碍；列表已按 s0 排序。 */
  near(list: readonly CompiledObstacle[], s: number, back: number, ahead: number, out: CompiledObstacle[]): CompiledObstacle[] {
    out.length = 0;
    for (const o of list) {
      if (o.s0 > s + ahead + 40) break; // walk 障碍可能向后移动，留余量
      if (o.s1 + 40 < s - back) continue;
      out.push(o);
    }
    return out;
  }
}
