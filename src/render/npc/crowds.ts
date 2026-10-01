// src/render/npc/crowds.ts —— 把 npcs 组（NpcGroupDef）展开成一个个路边的人（DESIGN.md §5.7、§8.5 NpcGroupDef）。纯数据，Node 可测。
// 读章时展开一次（确定性：rng 种子 = 章节种子 + 段 id + 组 id），之后每帧只按里程取用，不再分配。
// 路边的人都站在车道外：|x| ≥ 车道外沿 + 身体半宽，不会在画面上挡住任何一条车道（不参与碰撞）。
import { createRng } from '../../core/rng';
import type { KitId, NpcGroupKind } from '../../core/types';
import type { CompiledSegment, NpcGroupDef, RunSegmentDef } from '../../levels/schema';
import { crowdOfKit, lookFor, specialLook, specialOfGroup, type Look, type SpecialId } from './specials';

export type DecorKind = 'person' | 'kneeler' | 'crawler';
export type DecorPose = 'stand' | 'seat' | 'walk';

export interface Decor {
  kind: DecorKind; pose: DecorPose;
  s: number; x: number;
  /** 朝向（0 = 面朝 +z，即朝玩家来的方向）。 */
  yaw: number;
  /** 沿 s 的速度（m/s，正 = 与玩家同向）。 */
  speed: number;
  phase: number;
  group: number; seg: number;
  gaze: 'turnShoes' | 'center' | 'none';
  look: Look; special: SpecialId | null;
  side: -1 | 1;
}

export interface GroupInfo { def: NpcGroupDef; seg: number; kit: KitId; key: string }

/**
 * 各 kit 路边人群的横向范围 [内沿, 外沿]（米，取绝对值）：人的中心落在这个范围里。
 * 室内走廊墙在 ±1.8，人的身体半宽约 0.2：外沿 1.6，人不穿墙；内沿 1.54，人不伸进右道玩家碰撞盒（外沿 1.32）。
 */
export function bandOf(kit: KitId): [number, number] {
  switch (kit) {
    case 'canteen': return [1.54, 2.9];
    case 'street': return [1.58, 3.4];
    case 'plaza': return [2.3, 6.8];
    case 'track': return [1.7, 3.8];
    default: return [1.54, 1.6];
  }
}

const HALF_PI = Math.PI / 2;

/** 展开一个段里的全部组。band 覆盖 kit 的人群范围（调试舞台搭在测试章 ±1.8 的走廊里，用走廊的范围，人才看得见）。 */
export function expandSegment(seed: number, seg: Pick<CompiledSegment, 'index' | 's0' | 'stride' | 'npcGroups' | 'def'>, out: Decor[], groups: GroupInfo[], band?: readonly [number, number]): void {
  const def = seg.def as RunSegmentDef;
  const kit = def.kit ?? 'placeholder';
  const crowd = crowdOfKit(kit);
  const [b0, b1] = band ?? bandOf(kit);
  seg.npcGroups.forEach((g, gi) => {
    const key = g.id ?? `${g.kind}#${gi}`;
    const group = groups.length;
    groups.push({ def: g, seg: seg.index, kit, key });
    const rng = createRng(seed, `npc:${def.id}:${key}`);
    const sides: Array<-1 | 1> = g.side === 'both' ? [-1, 1] : g.side === 'L' ? [-1] : [1];
    const sp = specialOfGroup(g);
    const gaze: Decor['gaze'] = g.gaze === 'turnShoes' ? 'turnShoes' : g.gaze === 'center' ? 'center' : 'none';
    const sAt = (b: number) => seg.s0 + b * seg.stride;
    const push = (d: Omit<Decor, 'group' | 'seg' | 'gaze' | 'special' | 'look'> & { look?: Look }): void => {
      out.push({ ...d, group, seg: seg.index, gaze, special: sp, look: d.look ?? (sp ? specialLook(sp) : lookFor(crowd, seed, `${def.id}:${key}:${out.length}`)) });
    };
    if (sp === 'monitor') {
      // 班长：一个人，抱着作业本，同向走远（「先轻后重」的脚步声渐远）
      const side = sides[0] ?? 1;
      push({ kind: 'person', pose: 'walk', s: sAt(g.from), x: side * Math.min(b1, b0 + 0.06), yaw: Math.PI, speed: 1.35, phase: rng.next(), side });
      return;
    }
    const kind: NpcGroupKind = g.kind;
    const dens = Math.max(0, Math.min(1, g.density));
    for (const side of sides) {
      const inner = b0 + 0.02, outer = b1;
      const lane = (x: number) => side * x;
      switch (kind) {
        case 'seatedRow': case 'classmates': {
          const seated = kind === 'seatedRow';
          const step = seated ? 1.25 : 0.8;
          for (let b = g.from; b <= g.to + 1e-6; b += step / seg.stride) {
            if (rng.next() > dens) continue;
            const x = Math.min(outer, seated ? inner + 0.02 : rng.range(inner + 0.05, Math.max(inner + 0.1, Math.min(outer, inner + 1.4))));
            const yaw = seated ? Math.PI + rng.range(-0.2, 0.2) + (rng.next() < 0.3 ? -side * 0.5 : 0) : -side * HALF_PI + rng.range(-0.3, 0.3);
            push({ kind: 'person', pose: seated ? 'seat' : 'stand', s: sAt(b) + rng.range(-0.15, 0.15), x: lane(x), yaw, speed: 0, phase: rng.next(), side });
          }
          break;
        }
        case 'standingCluster': {
          for (let b = g.from; b <= g.to + 1e-6; b += 2.1 / seg.stride) {
            if (rng.next() > dens) continue;
            const n = 1 + rng.int(3);
            const cs = sAt(b) + rng.range(-0.3, 0.3);
            for (let i = 0; i < n; i++) {
              const x = Math.min(outer, inner + 0.04 + rng.range(0, 0.12) + (outer > 2 ? rng.range(0, outer - inner - 0.2) : 0));
              const s = cs + (i - (n - 1) / 2) * 0.62;
              // 围成一小圈：彼此相对；单人时面朝走廊或背对
              const yaw = n > 1 ? (i % 2 ? 0 : Math.PI) + rng.range(-0.5, 0.5) : -side * HALF_PI + rng.range(-0.7, 0.7);
              push({ kind: 'person', pose: 'stand', s, x: lane(x), yaw, speed: 0, phase: rng.next(), side });
            }
          }
          break;
        }
        case 'walkers': {
          for (let b = g.from; b <= g.to + 1e-6; b += 2.6 / seg.stride) {
            if (rng.next() > dens) continue;
            const dir = rng.next() < 0.5 ? 1 : -1;
            const speed = dir * rng.range(0.9, 1.5);
            const x = rng.range(inner + 0.02, Math.max(inner + 0.02, Math.min(outer, inner + 0.5)));
            push({ kind: 'person', pose: 'walk', s: sAt(b), x: lane(x), yaw: speed > 0 ? Math.PI : 0, speed, phase: rng.next(), side });
          }
          break;
        }
        case 'queue': {
          for (let b = g.from; b <= g.to + 1e-6; b += 0.65 / seg.stride) {
            if (rng.next() > dens) continue;
            push({ kind: 'person', pose: 'stand', s: sAt(b), x: lane(Math.min(outer, inner + 0.02 + rng.range(0, 0.06))), yaw: Math.PI + rng.range(-0.15, 0.15), speed: 0, phase: rng.next(), side });
          }
          break;
        }
        case 'lineSides': {
          for (let b = g.from; b <= g.to + 1e-6; b += 0.56 / seg.stride) {
            if (rng.next() > dens) continue;
            push({ kind: 'person', pose: 'stand', s: sAt(b), x: lane(Math.min(outer, inner + 0.03 + rng.range(0, 0.05))), yaw: -side * HALF_PI + rng.range(-0.35, 0.35), speed: 0, phase: rng.next(), side });
          }
          break;
        }
        case 'onlookerRing': {
          // 围观的人排成弧：每 9 m 一段弧，弧心朝车道
          for (let b = g.from; b <= g.to + 1e-6; b += 0.7 / seg.stride) {
            if (rng.next() > dens) continue;
            const s = sAt(b);
            const u = ((s - sAt(g.from)) % 9) / 9;
            const arc = inner + (outer - inner) * 0.55 * (1 - Math.sin(u * Math.PI));
            for (let row = 0; row < 2; row++) {
              if (row === 1 && rng.next() > 0.6) continue;
              const x = Math.max(inner, Math.min(outer, arc + row * 0.7 + rng.range(-0.1, 0.1)));
              push({ kind: 'person', pose: 'stand', s: s + rng.range(-0.2, 0.2), x: lane(x), yaw: -side * HALF_PI + rng.range(-0.4, 0.4), speed: 0, phase: rng.next(), side });
            }
          }
          break;
        }
        case 'imitators': {
          for (let b = g.from; b <= g.to + 1e-6; b += 1.2 / seg.stride) {
            if (rng.next() > dens) continue;
            push({ kind: 'kneeler', pose: 'stand', s: sAt(b) + rng.range(-0.3, 0.3), x: lane(rng.range(inner + 0.2, outer)), yaw: rng.range(-0.4, 0.4), speed: 0, phase: rng.next(), side });
          }
          break;
        }
        case 'crawlerStream': {
          for (let b = g.from; b <= g.to + 1e-6; b += 1.6 / seg.stride) {
            if (rng.next() > dens) continue;
            push({ kind: 'crawler', pose: 'walk', s: sAt(b), x: lane(rng.range(inner + 0.2, outer)), yaw: 0, speed: rng.range(1.8, 3.6), phase: rng.next(), side });
          }
          break;
        }
      }
    }
  });
}

/** 展开一整章（只处理跑段；静场和站立段没有 npcs）。结果按 s 排序。 */
export function expandChapter(seed: number, segments: ReadonlyArray<Pick<CompiledSegment, 'index' | 's0' | 'stride' | 'npcGroups' | 'def' | 'kind'>>): { decor: Decor[]; groups: GroupInfo[] } {
  const decor: Decor[] = [];
  const groups: GroupInfo[] = [];
  for (const seg of segments) if (seg.kind === 'run') expandSegment(seed, seg, decor, groups);
  decor.sort((a, b) => a.s - b.s);
  return { decor, groups };
}

/** 二分：第一个 s ≥ s0 的下标。 */
export function lowerBound(decor: readonly Decor[], s0: number): number {
  let lo = 0, hi = decor.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((decor[m] as Decor).s < s0) lo = m + 1; else hi = m; }
  return lo;
}
