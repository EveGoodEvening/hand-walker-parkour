// src/levels/compile.ts —— ChapterDef → CompiledChapter（DESIGN.md §8.3「读章」、§8.5 编译规则）。CORE 写初版，WP1 补全。
// 站立段的按步事件（StepEventDef，没有 at）不进 CompiledSegment.events，Sim 直接读 def.events。
// 纯函数，Node 可测。同一章、同一种子 → 完全相同的产物（从检查点重来时布局不变）。
import { LANE_WIDTH, CORRIDOR_WIDTH } from '../core/constants';
import { clamp } from '../core/math';
import { createRng } from '../core/rng';
import type { Lane, Rng } from '../core/types';
import { OBSTACLES, type ObstacleKind } from './obstacles';
import { expandPattern } from './patterns';
import type {
  Behavior, ChapterDef, CompiledChapter, CompiledObstacle, CompiledSegment, CompiledSurface, CompiledWindow, EventBody,
  RowDef, RunSegmentDef, SegmentDef, SurfaceDef,
} from './schema';
import { isSym, LANES, laneOfIndex, parseLanes } from './shorthand';
import { symbolsFor } from './kitSymbols';

/** 「让一下」时不动的概率（§2.4 ask.ignoreChance）。compile 不依赖 sim/，这里写死同一个数，单元测试核对两者一致。 */
export const TUNING_ASK_IGNORE = 0.3;

/** 墙面位置（x = ±HALF_WALL），与占位 kit 一致。 */
export const HALF_WALL = CORRIDOR_WIDTH / 2;

/** 名义步频函数（§2.3）：恒定或段内线性渐变。 */
export function cadenceFns(c: number | readonly [number, number], beats: number) {
  const c0 = typeof c === 'number' ? c : c[0];
  const c1 = typeof c === 'number' ? c : c[1];
  const B = Math.max(1e-6, beats);
  const ramp = Math.abs(c1 - c0) > 1e-9;
  const cadenceAt = (b: number) => c0 + (c1 - c0) * clamp(b / B, 0, 1);
  const timeAt = (b: number) => {
    if (!ramp) return b / c0;
    const bb = clamp(b, 0, B);
    const t = (B / (c1 - c0)) * Math.log(cadenceAt(bb) / c0);
    return b > B ? t + (b - B) / c1 : b < 0 ? b / c0 : t;
  };
  const beatAt = (t: number) => {
    if (!ramp) return t * c0;
    const tEnd = (B / (c1 - c0)) * Math.log(c1 / c0);
    if (t >= tEnd) return B + (t - tEnd) * c1;
    if (t <= 0) return t * c0;
    return ((c0 * Math.exp((t * (c1 - c0)) / B) - c0) * B) / (c1 - c0);
  };
  return { c0, c1, cadenceAt, timeAt, beatAt };
}

function eventBody<T extends { at: number; id?: string }>(e: T): { at: number; id?: string; body: EventBody } {
  const { at, id, ...rest } = e as T & Record<string, unknown>;
  const out: { at: number; id?: string; body: EventBody } = { at, body: rest as unknown as EventBody };
  if (id !== undefined) out.id = id;
  return out;
}

function lanesOf(l: Lane | readonly Lane[] | 'all'): Lane[] {
  if (l === 'all') return [...LANES];
  if (Array.isArray(l)) return [...(l as readonly Lane[])].sort((a, b) => a - b);
  return [l as Lane];
}

function surfacePlane(sd: SurfaceDef, s0: number, floorY: number): [number, number, number, number] {
  switch (sd.side) {
    case 'L': return [1, 0, 0, HALF_WALL];
    case 'R': return [-1, 0, 0, HALF_WALL];
    case 'end': return [0, 0, 1, s0];
    case 'floor': return [0, 1, 0, -floorY];
  }
}

interface Ctx { nextId: number; seed: number }

function makeObstacle(ctx: Ctx, seg: { s0: number; stride: number }, kind: ObstacleKind, lanes: Lane[], beat: number,
  lenBeats: number | undefined, behavior: Behavior | undefined, params: Record<string, number | string> = {}): CompiledObstacle {
  const spec = OBSTACLES[kind];
  const s0 = seg.s0 + beat * seg.stride;
  const depth = lenBeats !== undefined ? lenBeats * seg.stride : spec.depth;
  return {
    id: ctx.nextId++, kind, cls: spec.cls, archetype: spec.archetype,
    lanes: spec.fullWidth ? [...LANES] : lanes, beat, s0, s1: s0 + depth, y0: spec.y0, y1: spec.y1, halfW: spec.halfW,
    behavior: behavior ?? { type: 'static' }, npc: spec.npc === true, params,
  };
}

function compileRows(ctx: Ctx, def: RunSegmentDef, seg: { s0: number; stride: number }, rng: Rng, out: CompiledObstacle[]): void {
  const rows: RowDef[] = [...(def.rows ?? [])];
  for (const p of def.patterns ?? []) rows.push(...expandPattern(p));
  rows.sort((a, b) => a[0] - b[0]);
  const syms = symbolsFor(def.kit, def.variant);
  // 每个符号一个轮换计数器，起点由 rng.sim 决定；同一行里多个同符号格子依次取下一个候选
  const counters = new Map<string, number>();
  for (const [beat, lanesRaw, lenBeats] of rows) {
    const cells = parseLanes(lanesRaw);
    const fullWidthDone = new Set<ObstacleKind>();
    cells.forEach((c, i) => {
      if (c === '.') return;
      let kind: ObstacleKind;
      if (isSym(c)) {
        const cands = syms[c];
        if (!cands || cands.length === 0) throw new Error(`segment ${def.id}: symbol ${c} has no kinds for ${def.kit}.${def.variant}`);
        let k = counters.get(c);
        if (k === undefined) k = rng.int(cands.length);
        kind = cands[k % cands.length] as ObstacleKind;
        counters.set(c, k + 1);
      } else {
        kind = c;
      }
      if (OBSTACLES[kind].fullWidth) {
        if (fullWidthDone.has(kind)) return;
        fullWidthDone.add(kind);
      }
      out.push(makeObstacle(ctx, seg, kind, [laneOfIndex(i)], beat, lenBeats, undefined));
    });
  }
}

/** 编译一章。seed 缺省 = def.seed。 */
export function compile(def: ChapterDef, seed?: number): CompiledChapter {
  const chapterSeed = (seed ?? def.seed) >>> 0;
  const ctx: Ctx = { nextId: 1, seed: chapterSeed };
  const segments: CompiledSegment[] = [];
  let s = 0;
  let floorBase = 0;
  def.segments.forEach((sd: SegmentDef, index) => {
    if (sd.kind === 'run') {
      const stride = sd.stride;
      const s0 = s, s1 = s + sd.beats * stride;
      const fb = floorBase;
      const stairs = sd.stairs;
      const floorY = (ss: number) => {
        if (!stairs) return fb;
        const b = clamp((ss - s0) / stride, 0, sd.beats);
        return fb + (stairs.dir === 'up' ? 1 : -1) * stairs.risePerBeat * b;
      };
      const cf = cadenceFns(sd.cadence, sd.beats);
      const rng = createRng(chapterSeed, `${sd.id}:symbols`);
      const obstacles: CompiledObstacle[] = [];
      const segGeo = { s0, stride };
      compileRows(ctx, sd, segGeo, rng, obstacles);
      const askRng = createRng(chapterSeed, `${sd.id}:ask`);
      for (const it of sd.items ?? []) {
        const params: Record<string, number | string> = it.id ? { itemId: it.id } : {};
        // 「让一下」：ignore 为 'seeded' 时由章种子决定这个人会不会不动（约 30%，§3），编译期定下来，Sim 与求解器读同一个值
        if (it.behavior?.type === 'askable' && it.behavior.ignore === 'seeded') params.askIgnore = askRng.next() < TUNING_ASK_IGNORE ? 1 : 0;
        const o = makeObstacle(ctx, segGeo, it.kind, lanesOf(it.lane), it.at, it.len, it.behavior, params);
        obstacles.push(o);
      }
      for (const n of sd.notes ?? []) {
        obstacles.push(makeObstacle(ctx, segGeo, 'note', [n.lane], n.at, undefined, undefined, { note: n.note }));
      }
      obstacles.sort((a, b) => a.s0 - b.s0 || a.id - b.id);
      const surfaces: CompiledSurface[] = (sd.surfaces ?? []).map((su) => {
        const ss0 = s0 + su.from * stride;
        const ss1 = Math.max(ss0 + 0.01, s0 + su.to * stride);
        return { ...su, s0: ss0, s1: ss1, plane: surfacePlane(su, ss0, floorY(ss0)) };
      });
      const windows: CompiledWindow[] = (sd.windows ?? []).map((w) => ({ ...w, s0: s0 + w.from * stride, s1: s0 + w.to * stride }));
      const events = (sd.events ?? []).map(eventBody).sort((a, b) => a.at - b.at);
      const checkpoints = Array.from(new Set([0, ...(sd.checkpoints ?? [])])).sort((a, b) => a - b);
      segments.push({
        def: sd, index, kind: 'run', s0, s1, stride,
        cadenceAt: cf.cadenceAt, timeAt: cf.timeAt, beatAt: cf.beatAt, floorY,
        obstacles, surfaces, windows, npcGroups: [...(sd.npcs ?? [])], events, checkpoints,
      });
      s = s1;
      floorBase = floorY(s1);
    } else {
      const fb = floorBase;
      const events = (sd.events as Array<{ at: number; id?: string } & Record<string, unknown>>)
        .filter((e) => typeof e.at === 'number')
        .map((e) => eventBody(e as { at: number; id?: string }))
        .sort((a, b) => a.at - b.at);
      segments.push({
        def: sd, index, kind: sd.kind, s0: s, s1: s, stride: 1,
        cadenceAt: () => 0, timeAt: (b) => b, beatAt: (t) => t, floorY: () => fb,
        obstacles: [], surfaces: [], windows: [], npcGroups: [], events, checkpoints: [0],
      });
    }
  });
  return { def, segments, length: s, seed: chapterSeed };
}

/** 横向范围：障碍覆盖的 x 区间（未计行为偏移）。 */
export function obstacleX(o: CompiledObstacle): [number, number] {
  if (OBSTACLES[o.kind].fullWidth) return [-o.halfW, o.halfW];
  const ls = o.lanes;
  let lo = 1, hi = -1;
  for (let i = 0; i < ls.length; i++) { const l = ls[i] as number; if (l < lo) lo = l; if (l > hi) hi = l; }
  return [lo * LANE_WIDTH - o.halfW, hi * LANE_WIDTH + o.halfW];
}

/** 按 id 找段。 */
export function segmentById(ch: CompiledChapter, id: string): CompiledSegment | undefined {
  return ch.segments.find((sg) => sg.def.id === id);
}
