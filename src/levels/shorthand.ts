// src/levels/shorthand.ts —— 行速记解析（DESIGN.md §4.0、§8.5）。CORE 写初版，之后归 WP1。
// 'B.L' 从左到右对应车道 −1、0、1；`.` 空，`L` 低矮，`H` 横档，`B` 挡道，`W` 水渍；也可以直接写 ObstacleKind 的三元组。
import type { Lane } from '../core/types';
import type { Cell, RowDef } from './schema';
import { OBSTACLES, type ObstacleKind } from './obstacles';

export const LANES: readonly Lane[] = [-1, 0, 1];
export type Sym = 'L' | 'H' | 'B' | 'W';
export const SYMBOLS: readonly Sym[] = ['L', 'H', 'B', 'W'];

export function isSym(c: string): c is Sym { return c === 'L' || c === 'H' || c === 'B' || c === 'W'; }
export function isKind(c: string): c is ObstacleKind { return Object.prototype.hasOwnProperty.call(OBSTACLES, c); }

/** 把行的车道部分解析成 3 个格子。非法输入抛错（校验器会报告）。 */
export function parseLanes(lanes: RowDef[1]): [Cell, Cell, Cell] {
  const cells: string[] = typeof lanes === 'string' ? Array.from(lanes) : [...lanes];
  if (cells.length !== 3) throw new Error(`row lanes must have 3 cells: ${JSON.stringify(lanes)}`);
  for (const c of cells) {
    if (c !== '.' && !isSym(c) && !isKind(c)) throw new Error(`unknown row cell "${c}" in ${JSON.stringify(lanes)}`);
  }
  return cells as [Cell, Cell, Cell];
}

/** 格子 → 车道。 */
export function laneOfIndex(i: number): Lane { return (i - 1) as Lane; }
