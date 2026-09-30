// src/sim/Drift.ts —— 腿偏移与「掰正」（DESIGN.md §3「腿偏移」、§2.4 drift、§2.8 R9）。WP1。只在第五章，全作 4 次。
// 预警 0.6 s（鞋尖转动，PlayerSnap.drift 从 0 转到 ±1）；预警期间按反方向键（或反向滑动）= 掰正，留在原车道；
// 否则预警结束时被迫向偏移那一侧换一条道（已经在最边上就不动）。预警期间按同方向键是普通换道。
// 状态平铺在 PlayerState 上，Sim 与 Solver 共用。
import type { Lane } from '../core/types';
import { clampLane, type PlayerState } from './Player';
import { TUNING } from './tuning';

const DR = TUNING.drift;
/** 偏移结束后鞋尖回正的速度（每秒）。 */
const RELAX_PER_SEC = 1 / 0.3;

export type DriftOutcome = 'moved' | null;

export function driftStart(p: PlayerState, dir: -1 | 1): void {
  p.drPhase = 1; p.drT = 0; p.drDir = dir;
}

/** 预警期间的反方向输入：掰正。返回是否掰正了（true 时这次按键不再作为换道）。 */
export function driftCounter(p: PlayerState, inputDir: -1 | 1): boolean {
  if (p.drPhase !== 1 || inputDir !== -p.drDir) return false;
  p.drPhase = 0; p.drT = 0;
  return true;
}

/** 被迫换道的目标车道（最边上时为 null）。 */
export function driftTarget(p: PlayerState): Lane | null {
  const base = p.laneQueue ?? p.laneTarget;
  return clampLane(base + p.drDir);
}

/** 推进一个 tick；预警结束时执行被迫换道并返回 'moved'。wet = 当前在软障碍上（换道 0.22 s）。 */
export function driftUpdate(p: PlayerState, dt: number, wet: boolean): DriftOutcome {
  if (p.drPhase === 1) {
    p.drT += dt;
    p.drift = p.drDir * Math.min(1, p.drT / DR.warn);
    if (p.drT >= DR.warn - 1e-9) {
      p.drPhase = 0; p.drT = 0;
      if (driftTarget(p) !== null) p.laneInput(p.drDir, wet);
      return 'moved';
    }
    return null;
  }
  if (p.drift !== 0) {
    const m = RELAX_PER_SEC * dt;
    p.drift = Math.abs(p.drift) <= m ? 0 : p.drift - Math.sign(p.drift) * m;
  }
  return null;
}
