// src/sim/Ask.ts —— 「让一下」（DESIGN.md §3「让一下」、§2.4 ask、§5.7 part / ignore、§8.7）。WP1。
// 只在人群段（crowd: true）里、前方 6 m 内有可请求的人（behavior 'askable'）时可用；段里写了 ask 窗口时还必须在窗口内。
// 按 E（或情境按钮）：前方 6 m 内所有还没被请求过的人一起回应——0.5 s 后靠边分开（此后不再碰撞），
// 或者不动（ignore: true，或 'seeded' 时由编译期的种子决定，约 30%，见 compile.ts 的 params.askIgnore）。每段最多 2 次。
// 纯函数部分（谁可以被请求、谁会不动）Sim 与 Solver 共用。
import type { CompiledObstacle, CompiledSegment, RunSegmentDef } from '../levels/schema';
import { TUNING } from './tuning';

const A = TUNING.ask;

/** 这个障碍是不是「可请求的人」。 */
export function isAskable(o: CompiledObstacle): boolean { return o.behavior.type === 'askable'; }

/** 请求时这个人会不会不动（确定性：ignore 字段，或编译期写入的 params.askIgnore）。 */
export function askIgnores(o: CompiledObstacle): boolean {
  const b = o.behavior;
  if (b.type !== 'askable') return true;
  if (b.ignore === true) return true;
  if (b.ignore === false) return false;
  return Number(o.params.askIgnore ?? 0) === 1;
}

/** 段内是否处在可以开口的窗口里（段里没有 ask 窗口时恒为 true）。 */
export function inAskWindow(seg: CompiledSegment, beat: number): boolean {
  const wins = seg.windows.filter((w) => w.type === 'ask');
  if (wins.length === 0) return true;
  return wins.some((w) => beat >= w.from - 1e-9 && beat <= w.to + 1e-9);
}

/** 此刻可以被请求的人（前方 range 米内、尚未被请求过）。s 为玩家里程。 */
export function askTargets(seg: CompiledSegment, s: number, beat: number, asked: ReadonlySet<number> | readonly number[], out: CompiledObstacle[] = []): CompiledObstacle[] {
  out.length = 0;
  if (seg.kind !== 'run' || (seg.def as RunSegmentDef).crowd !== true) return out;
  if (!inAskWindow(seg, beat)) return out;
  const has = (id: number) => (Array.isArray(asked) ? (asked as readonly number[]).includes(id) : (asked as ReadonlySet<number>).has(id));
  for (const o of seg.obstacles) {
    if (o.s0 > s + A.range) break;
    if (!isAskable(o) || o.s1 < s || has(o.id)) continue;
    out.push(o);
  }
  return out;
}

/** Sim 里的「让一下」运行时（每段重置）。 */
export class AskRuntime {
  used = 0;
  readonly asked = new Set<number>();
  /** 障碍 id → 段内时刻（秒）：从这个时刻起它已经让开，不再碰撞。 */
  readonly partAt = new Map<number, number>();
  private tmp: CompiledObstacle[] = [];

  reset(): void { this.used = 0; this.asked.clear(); this.partAt.clear(); }

  available(seg: CompiledSegment, s: number, beat: number): boolean {
    if (this.used >= A.perSegment) return false;
    return askTargets(seg, s, beat, this.asked, this.tmp).length > 0;
  }

  /** 开口：返回每个被请求的人的结果。tSeg 为段内时刻。 */
  ask(seg: CompiledSegment, s: number, beat: number, tSeg: number): Array<{ id: number; result: 'part' | 'ignore' }> {
    if (!this.available(seg, s, beat)) return [];
    this.used++;
    const out: Array<{ id: number; result: 'part' | 'ignore' }> = [];
    for (const o of askTargets(seg, s, beat, this.asked, this.tmp)) {
      this.asked.add(o.id);
      const ignore = askIgnores(o);
      if (!ignore) this.partAt.set(o.id, tSeg + A.delay);
      out.push({ id: o.id, result: ignore ? 'ignore' : 'part' });
    }
    return out;
  }

  /** 这个障碍此刻（段内时刻 tSeg）是否已经让开。 */
  parted(id: number, tSeg: number): boolean {
    const t = this.partAt.get(id);
    return t !== undefined && tSeg >= t - 1e-9;
  }
}
