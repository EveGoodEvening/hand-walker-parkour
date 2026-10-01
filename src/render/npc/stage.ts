// src/render/npc/stage.ts —— 调试舞台（__game.ext.npcStage，只在 ?test=1 或 ?debug=… 下可用）。
// 第二到五章由 WP2 并行编写，WP6 截图时还没有这些数据；舞台用合成的障碍和人群在玩家前方搭一个场景，
// 走的是和正式数据完全相同的放置代码（ObstacleView），只是换了数据来源。不改模拟，不参与碰撞。
import type { KitId, Lane } from '../../core/types';
import { OBSTACLES, OBSTACLE_KINDS, type ObstacleKind } from '../../levels/obstacles';
import type { Behavior, CompiledObstacle, CompiledSegment, NpcGroupDef, RunSegmentDef } from '../../levels/schema';
import { expandSegment, type Decor, type GroupInfo } from './crowds';
import type { Stage } from './ObstacleView';

export const STAGE_NAMES = ['gallery-low', 'gallery-bar', 'gallery-block', 'gallery-soft', 'forest', 'stretch', 'specials', 'dream', 'night'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface Spec { kind: ObstacleKind; lane: Lane | Lane[] | 'all'; at: number; behavior?: Behavior; id?: string; len?: number; note?: string }

function segmentOf(s0: number, floorY: number, kit: KitId, groups: NpcGroupDef[]): CompiledSegment {
  const def = {
    id: 'stage', kind: 'run', kit, variant: 'default', atmosphere: 'morning', surface: 'terrazzo', beats: 80, stride: 1, cadence: 5,
    follower: { mode: 'hidden' }, npcs: groups,
  } as RunSegmentDef;
  return {
    def, index: -1, kind: 'run', s0, s1: s0 + 80, stride: 1,
    cadenceAt: () => 5, timeAt: (b) => b / 5, beatAt: (t) => t * 5, floorY: () => floorY,
    obstacles: [], surfaces: [], windows: [], npcGroups: groups, events: [], checkpoints: [0],
  };
}

function build(specs: Spec[], s0: number, idBase: number): CompiledObstacle[] {
  return specs.map((sp, i) => {
    const o = OBSTACLES[sp.kind];
    const lanes: Lane[] = o.fullWidth || sp.lane === 'all' ? [-1, 0, 1] : Array.isArray(sp.lane) ? [...sp.lane] : [sp.lane];
    const a = s0 + sp.at;
    const params: Record<string, string | number> = {};
    if (sp.id) params.itemId = sp.id;
    if (sp.note) params.note = sp.note;
    return {
      id: idBase + i, kind: sp.kind, cls: o.cls, archetype: o.archetype, lanes, beat: sp.at, s0: a, s1: a + (sp.len ?? o.depth),
      y0: o.y0, y1: o.y1, halfW: o.halfW, behavior: sp.behavior ?? { type: 'static' }, npc: o.npc === true, params,
    };
  });
}

/** 按类别排的画廊：每行左右两条车道各一种（中道被主角挡住），行距 2.6 m；整宽的横档单独一行。 */
function gallery(cls: 'low' | 'bar' | 'block' | 'soft', start = 2.4): Spec[] {
  const kinds = OBSTACLE_KINDS.filter((k) => (cls === 'soft' ? OBSTACLES[k].cls === 'soft' || OBSTACLES[k].cls === 'pickup' : OBSTACLES[k].cls === cls));
  const out: Spec[] = [];
  let at = start, col = 0;
  for (const k of kinds) {
    if (OBSTACLES[k].fullWidth) {
      if (col) { at += 2.6; col = 0; }
      out.push({ kind: k, lane: 'all', at });
      at += 2.6;
      continue;
    }
    const spec: Spec = { kind: k, lane: col ? 1 : -1, at };
    if (k === 'note') spec.note = 'n1-b';
    out.push(spec);
    col++;
    if (col === 2) { col = 0; at += k === 'car' ? 5 : 2.6; }
  }
  return out;
}

/** 舞台搭在测试章的走廊里（墙在 ±1.8）：路边的人一律用走廊的人群范围，否则广场、食堂的人群都在墙后面，看不见。 */
export const STAGE_BAND: readonly [number, number] = [1.54, 1.6];

export interface StageData { obstacles: CompiledObstacle[]; decor: Decor[]; groups: GroupInfo[]; segment: CompiledSegment; kit: KitId; follow: boolean }

/** 搭一个舞台。s0 = 玩家当前里程，floorY = 玩家脚下的地面高度。 */
export function makeStage(name: StageName, s0: number, floorY: number, seed = 7): StageData {
  let specs: Spec[] = [];
  let groups: NpcGroupDef[] = [];
  let kit: KitId = 'corridor';
  let follow = false;
  switch (name) {
    case 'gallery-low': specs = gallery('low'); follow = true; break;
    case 'gallery-bar': specs = gallery('bar'); follow = true; break;
    case 'gallery-block': specs = gallery('block'); follow = true; break;
    case 'gallery-soft': specs = gallery('soft'); follow = true; break;
    case 'forest':
      kit = 'canteen';
      groups = [
        { id: 'forestL', kind: 'standingCluster', from: 2, to: 40, side: 'both', density: 0.8, gaze: 'turnShoes' },
        { id: 'walk', kind: 'walkers', from: 0, to: 40, side: 'both', density: 0.6 },
        { id: 'seat', kind: 'seatedRow', from: 12, to: 30, side: 'R', density: 0.9 },
      ];
      specs = [
        { kind: 'legs', lane: 1, at: 6 },
        { kind: 'legs', lane: [-1, 0], at: 11, behavior: { type: 'shift', atBeat: 9, toLane: 1 } },
        { kind: 'longTable', lane: 1, at: 11 },
        { kind: 'legs', lane: [0, 1], at: 17, id: 'girls', behavior: { type: 'askable', ignore: false } },
        { kind: 'footOut', lane: -1, at: 17, behavior: { type: 'stretch', period: 2.4, phase: 0.3, outFrac: 0.5 } },
        { kind: 'chairBar', lane: -1, at: 22 },
        { kind: 'legs', lane: 0, at: 26, behavior: { type: 'walk', speed: 1.2 } },
        { kind: 'cart', lane: 1, at: 28 },
      ];
      break;
    case 'stretch':
      kit = 'classroom';
      groups = [{ id: 'class7', kind: 'seatedRow', from: 0, to: 30, side: 'both', density: 0.9, gaze: 'turnShoes' }];
      specs = [0, 1, 2, 3, 4].map((i) => ({ kind: 'footOut' as ObstacleKind, lane: ([-1, 1, -1, 1, 0] as Lane[])[i] as Lane, at: 4 + i * 3.2, behavior: { type: 'stretch' as const, period: 2.2, phase: i * 0.21, outFrac: 0.45 } }));
      break;
    case 'specials':
      kit = 'corridor';
      groups = [{ id: 'monitor', kind: 'walkers', from: 2, to: 2, side: 'L', density: 1 }];
      specs = [
        { kind: 'chenMo', lane: 0, at: 5, id: 'chenmo', behavior: { type: 'yield', atBeat: 4 } },
        { kind: 'footOut', lane: 0, at: 7, id: 'chenmoFoot' },
        { kind: 'legs', lane: -1, at: 10, id: 'directorZhou' },
        { kind: 'legs', lane: 1, at: 13, id: 'teacherMa' },
      ];
      break;
    case 'dream':
      kit = 'plaza';
      groups = [
        { id: 'ring', kind: 'onlookerRing', from: 0, to: 40, side: 'both', density: 0.9 },
        { id: 'imitators', kind: 'imitators', from: 4, to: 30, side: 'both', density: 0.6 },
        { id: 'stream', kind: 'crawlerStream', from: 0, to: 30, side: 'both', density: 0.5 },
      ];
      specs = [
        { kind: 'kneeler', lane: -1, at: 5 },
        { kind: 'kneeler', lane: 0, at: 9, id: 'dreamBoy', behavior: { type: 'fallInto', atBeat: 6 } },
        { kind: 'reach', lane: 1, at: 9 },
        { kind: 'crawler', lane: 1, at: 14, behavior: { type: 'walk', speed: 3 } },
        { kind: 'crawler', lane: -1, at: 18, behavior: { type: 'walk', speed: 3 } },
        { kind: 'legs', lane: 0, at: 20 },
      ];
      break;
    case 'night':
      kit = 'street';
      specs = [
        { kind: 'legs', lane: 0, at: 5, id: 'directorZhou' },
        { kind: 'barrierArm', lane: 'all', at: 9 },
        { kind: 'bollard', lane: -1, at: 13 }, { kind: 'bin', lane: 1, at: 13 },
        { kind: 'shutterHalf', lane: 0, at: 16 },
      ];
      break;
  }
  const segment = segmentOf(s0, floorY, kit, groups);
  segment.obstacles = build(specs, s0, 900000);
  const decor: Decor[] = [];
  const gi: GroupInfo[] = [];
  expandSegment(seed, segment, decor, gi, STAGE_BAND);
  decor.sort((a, b) => a.s - b.s);
  return { obstacles: segment.obstacles, decor, groups: gi, segment, kit, follow };
}

/** 用给定的障碍（和可选的人群）搭一个舞台（单元测试按障碍逐个检查画面用）。 */
export function customStage(specs: Spec[], s0: number, floorY: number, o: { kit?: KitId; groups?: NpcGroupDef[]; idBase?: number; seed?: number } = {}): StageData {
  const kit = o.kit ?? 'corridor';
  const groups = o.groups ?? [];
  const segment = segmentOf(s0, floorY, kit, groups);
  segment.obstacles = build(specs, s0, o.idBase ?? 900000);
  const decor: Decor[] = [];
  const gi: GroupInfo[] = [];
  expandSegment(o.seed ?? 7, segment, decor, gi, STAGE_BAND);
  decor.sort((a, b) => a.s - b.s);
  return { obstacles: segment.obstacles, decor, groups: gi, segment, kit, follow: false };
}

export function toStage(name: StageName, d: StageData, t0: number, s0: number, follow?: boolean): Stage {
  return { name, obstacles: d.obstacles, segment: d.segment, decor: d.decor, groups: d.groups, t0, follow: follow ?? d.follow, s0, kit: d.kit };
}
