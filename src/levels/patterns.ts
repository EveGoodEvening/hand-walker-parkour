// src/levels/patterns.ts —— 谱面模式展开（DESIGN.md §8.5 编译规则）。CORE 写初版，之后归 WP1。
// tripleVault = 同一车道 3 个低矮，间隔 gap（缺省 4）；zigzag = B.B / .B. / B.B，间隔 gap；
// lowBar = .L. 后接 .H.；forestGate = BBH / H.B / B.B；wetWeave = WWB / B..。mirror: true 时左右翻转。
import type { Lane } from '../core/types';
import type { PatternUse, RowDef } from './schema';

function mirrorStr(s: string): string { return Array.from(s).reverse().join(''); }
function laneStr(lane: Lane, sym: string): string {
  const a = ['.', '.', '.']; a[lane + 1] = sym; return a.join('');
}

export function expandPattern(p: PatternUse): RowDef[] {
  const gap = p.gap ?? 4;
  const lane: Lane = p.lane ?? 0;
  let rows: Array<[number, string]>;
  switch (p.pattern) {
    case 'tripleVault': rows = [0, 1, 2].map((k) => [p.at + k * gap, laneStr(lane, 'L')]); break;
    case 'zigzag': rows = [[p.at, 'B.B'], [p.at + gap, '.B.'], [p.at + 2 * gap, 'B.B']]; break;
    case 'lowBar': rows = [[p.at, laneStr(lane, 'L')], [p.at + gap, laneStr(lane, 'H')]]; break;
    case 'forestGate': rows = [[p.at, 'BBH'], [p.at + gap, 'H.B'], [p.at + 2 * gap, 'B.B']]; break;
    case 'wetWeave': rows = [[p.at, 'WWB'], [p.at + gap, 'B..']]; break;
    default: {
      const never: never = p.pattern;
      throw new Error(`unknown pattern ${String(never)}`);
    }
  }
  return rows.map(([b, s]) => [b, p.mirror ? mirrorStr(s) : s] as RowDef);
}
