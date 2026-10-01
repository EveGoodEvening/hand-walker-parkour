// src/audio/crowd.ts —— 人群的脚步「先轻后重」（DESIGN.md §6.1 npc 总线、§6.2「正常人脚步」、§5.7 walk / silent）。WP7。
// 「我认得那些脚步声……先轻后重」（第一章）：跑段里会走动的人（walkers、queue 两类 NPC 组，以及行为是 walk 的腿）
// 各挂一路颗粒，按 1.9 ± 0.1 步/s 播放预渲染的 stepPair（低优先级声部，声部满时直接放弃），走 npc 总线——
// 静音段、silence、失败、结尾卡都经总线的门掐掉。
//   步频：每个人自己的步频在 1.82–1.98 步/s 之间，每一步再抖 ±5%，夹在 1.8–2.0 步/s 内（间隔 0.50–0.556 s）。
//   随机 ±10%：轻 → 重的 80 ms 间隔（配方的 4 个变体各抽一次）与每步的增益（±10%，约 ±0.9 dB）。
//   远近：玩家（按段内拍号）离这群人的范围越远越轻，10 拍之外不发声；声像按 side（L 左 / R 右 / both 两侧）。
//   queue（排队的人）：不连续走，一阵 2–3 步，停 1.5–4 s。
//   「所有人静止 1 s」（crowd 'silent'、人群段绊倒）：这段时间里不排新的脚步。
import { OBSTACLES } from '../levels/obstacles';
import type { NpcGroupDef, SegmentDef } from '../levels/schema';
import { rr } from './recipes/common';

/** 播放一步（at：音频时刻；gainDb：相对配方电平；pan：−1..1）。 */
export type StepSink = (at: number, gainDb: number, pan: number) => void;

/** 玩家此刻的位置（由快照给出），用来按远近定电平。 */
export interface CrowdPos { beat: number; cadence: number; tSeg: number }

/** 会发出脚步声的 NPC 组类型（§5.7 的 walk 行为）。 */
export const WALKING_GROUPS: ReadonlySet<NpcGroupDef['kind']> = new Set(['walkers', 'queue']);
/** 10 拍之外听不见；范围之内满电平，之外线性降到 −18 dB。 */
export const FADE_BEATS = 10;
const FADE_DB = 18;
export const MIN_INTERVAL = 1 / 2.0;
export const MAX_INTERVAL = 1 / 1.8;

interface Walker {
  group: string;
  queue: boolean;
  from: number; to: number;
  /** walk 障碍：段内时刻 tSeg 时的拍位 = at + v·tSeg（v：拍/s，负 = 迎面）。 */
  move: { at: number; v: number } | null;
  rate: number;
  pan: number;
  baseDb: number;
  next: number;
  burst: number;
  foot: number;
}

export class CrowdSteps {
  private walkers: Walker[] = [];
  /** 组 id（'*' = 所有人）→ 静止到哪个音频时刻。 */
  private still = new Map<string, { from: number; until: number }>();
  private anchored = false;

  constructor(private readonly rng: () => number) {}

  get count(): number { return this.walkers.length; }

  /** 进入一段：按段里的 NPC 组和 walk 障碍建出各路脚步（不是跑段时清空）。 */
  setSegment(seg: SegmentDef | null): void {
    this.walkers = [];
    this.still.clear();
    this.anchored = false;
    if (!seg || seg.kind !== 'run') return;
    const rng = this.rng;
    (seg.npcs ?? []).forEach((g, gi) => {
      if (!WALKING_GROUPS.has(g.kind)) return;
      const queue = g.kind === 'queue';
      const d = Math.max(0, Math.min(1, g.density));
      const n = queue ? (d >= 0.5 ? 2 : 1) : Math.max(1, Math.min(3, Math.round(1 + 2 * d)));
      for (let i = 0; i < n; i++) {
        const sign = g.side === 'L' ? -1 : g.side === 'R' ? 1 : i % 2 ? 1 : -1;
        this.walkers.push({
          group: g.id ?? `#${gi}`, queue, from: g.from, to: g.to, move: null,
          rate: rr(rng, 1.82, 1.98), pan: sign * rr(rng, 0.3, 0.7), baseDb: queue ? -7 : (-3 - 3 * i),
          next: 0, burst: 0, foot: rng() < 0.5 ? 1 : -1,
        });
      }
    });
    for (const it of seg.items ?? []) {
      if (it.behavior?.type !== 'walk' || OBSTACLES[it.kind]?.archetype !== 'legs') continue;
      const lanes = it.lane === 'all' ? [0] : Array.isArray(it.lane) ? it.lane : [it.lane as number];
      const lane = lanes.reduce((a, b) => a + b, 0) / Math.max(1, lanes.length);
      this.walkers.push({
        group: it.id ?? 'walk', queue: false, from: it.at, to: it.at, move: { at: it.at, v: it.behavior.speed / Math.max(0.1, seg.stride) },
        rate: rr(rng, 1.82, 1.98), pan: lane * 0.45, baseDb: -2, next: 0, burst: 0, foot: 1,
      });
    }
  }

  /** 「所有人静止 1 s」：group 为 null 时是所有人。 */
  silence(group: string | null, from: number, until: number): void {
    this.still.set(group ?? '*', { from, until });
  }

  /** 重来 / 继续：从现在起重新排（不补发错过的步子）。 */
  restart(): void { this.anchored = false; }

  /**
   * 排程到 until（音频时刻）。mute：失败、静音段、结尾卡、不是跑段——不排新的步子（总线的门会掐掉已经排了的）。
   */
  advance(now: number, until: number, pos: CrowdPos, mute: boolean, emit: StepSink): void {
    if (!this.walkers.length) return;
    if (!this.anchored) {
      this.anchored = true;
      for (const w of this.walkers) { w.next = now + rr(this.rng, 0.05, 0.5); w.burst = 0; }
    }
    const all = this.still.get('*');
    for (const w of this.walkers) {
      if (w.next < now - 0.5) w.next = now + rr(this.rng, 0.02, 0.2);        // 暂停 / 掉帧之后：不补发
      const own = this.still.get(w.group);
      while (w.next < until) {
        const at = w.next;
        if (w.queue && w.burst <= 0) {
          // 排队：停一阵，再挪 2–3 步
          w.burst = 2 + (this.rng() < 0.5 ? 1 : 0);
          w.next = at + rr(this.rng, 1.5, 4);
          continue;
        }
        w.next = at + Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, (1 / w.rate) * rr(this.rng, 0.95, 1.05)));
        if (w.queue) w.burst--;
        w.foot = -w.foot;
        const frozen = (all && at >= all.from && at < all.until) || (own && at >= own.from && at < own.until);
        if (mute || frozen) continue;
        const dt = at - now;
        const beat = pos.beat + dt * pos.cadence;
        const where = w.move ? w.move.at + w.move.v * (pos.tSeg + dt) : null;
        const lo = where ?? w.from, hi = where ?? w.to;
        const d = beat < lo ? lo - beat : beat > hi ? beat - hi : 0;
        if (d > FADE_BEATS) continue;
        const gainDb = w.baseDb - (d / FADE_BEATS) * FADE_DB + 20 * Math.log10(rr(this.rng, 0.9, 1.1));
        emit(at, gainDb, Math.max(-1, Math.min(1, w.pan + w.foot * 0.04)));
      }
    }
  }
}
