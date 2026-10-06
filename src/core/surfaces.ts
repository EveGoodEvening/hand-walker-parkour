// src/core/surfaces.ts —— SurfaceIndex 实现（DESIGN.md §5.8、§8.4）。CORE 冻结。纯数据，来自编译后的关卡。
// 墙镜、窗、端墙镜、车镜需要在墙上留口（Opening）；水洼、黑板、门牌不留口。
import type { Opening, SurfaceIndex } from './contracts';
import type { CompiledChapter, CompiledSurface } from '../levels/schema';

const OPENING_KINDS = new Set<CompiledSurface['kind']>(['mirror', 'window', 'endMirror', 'carMirror']);

export class ChapterSurfaces implements SurfaceIndex {
  private all: CompiledSurface[] = [];
  private byId = new Map<string, CompiledSurface>();
  private openings: Opening[] = [];

  constructor(ch?: CompiledChapter) { if (ch) this.load(ch); }

  load(ch: CompiledChapter): void {
    this.all = ch.segments.flatMap((s) => s.surfaces);
    this.byId = new Map(this.all.map((s) => [s.id, s]));
    this.openings = this.all
      .filter((s) => OPENING_KINDS.has(s.kind) && (s.side === 'L' || s.side === 'R' || s.side === 'end'))
      .map((s) => ({
        side: s.side as 'L' | 'R' | 'end', s0: s.s0, s1: s.side === 'end' ? s.s0 : s.s1,
        y0: s.y?.[0] ?? 0.2, y1: s.y?.[1] ?? 1.8, surfaceId: s.id,
      }));
  }

  list(): readonly CompiledSurface[] { return this.all; }
  get(id: string): CompiledSurface | undefined { return this.byId.get(id); }
  /** 与 [s0, s1] 相交的开口（端墙镜按它所在的 s 判断）。 */
  openingsIn(s0: number, s1: number): readonly Opening[] {
    return this.openings.filter((o) => (o.side === 'end' ? o.s0 >= s0 && o.s0 <= s1 : o.s0 < s1 && o.s1 > s0));
  }
}
