// src/render/npc/ObstacleView.ts —— WP6 的画面系统：障碍原型池、腿的森林、梦里的爬行者、线框（DESIGN.md §5.7、§8.4、§8.7）。
// 画面只插值、不改模拟状态。障碍的运行时状态与碰撞共用 obstacleState（simBridge），所以门、伸出的脚、让开的陈默、
// 移动的人墙在画面上和碰撞完全一致。全部几何体在 init 时建好（容量固定）；读章只展开数据，游戏过程中不创建任何几何体。
//
// 事件（§8.7）：
//   hit    ：low 被碰倒（向前倒下）/ 人腿缩回；附近的鞋尖转向你；人群段里所有人静止 1 s（「安静的一秒」）。
//   ask    ：part → 0.5 s 后横移 0.6 m 让出一条缝；ignore → 不动。两种结果附近的鞋尖都会转过来。
//   note   ：地上那张纸不再画（重来时保留已拾取的状态）。
//   retry / 读章 / 跳转：清掉碰倒、凝视、静止等画面状态。
//   fall   ：模拟在失败后不再推进段内时间（门、伸出的脚停在碰撞的那一刻），画面的段内时间也停住，直到 retry。
// 段内时间：每段记下它在模拟时钟上的开始时刻（segment 事件 / onReset）。已经过去的段照常计时（路边的人、爬行的人、
// 门和脚在段界上不跳回原位），拍号取 +∞（让开的陈默、移动过的人墙保持最终状态）；还没到的段时间为 0、拍号 −1。
// cue：crowd（turnShoes / centerShoes / silent / applaud / crawlOvertake / normal），由 index.ts 注册。
// 越过的障碍（U6）：镜头在主角身后 2.8 m（§10.3），越过的障碍会在镜头和主角之间停留，形成横跨画面下部的暗条
// （3-4 静音段里整屏被挡）。障碍远端落到玩家身后 0.55 m（s1 < s − PASS_BEHIND）起，在 PASS_FADE（0.12）秒内
// 以底面中心为原点缩小到 0（之后不画）；回头（lookBack > 0）或镜头转向身后（turnBack 机位）时照常画，身后保留 14 m。
// 人墙（U6）：人群段（2-2、5-6，数据注释里的「人墙」）里站着的人（路边的组和人腿障碍）每个画质都画上身和没有五官的头
// （isWallSegment，读章时定）；梦里（plaza）的人中、高画质本来就有上身，低画质也画。
// 站立段（4-3、5-8）只显示紧挨着的前一个跑段（4-2、5-7）的组（§10.2）：这些组里站着的人只在站立段进行时画上身（每个画质；
// 按组和当前段的种类定，不按远近）。爬行的时候它们和别处一样只到腰带（5-7 是「排队同学的腿」，§4）；进站立段时镜头正在升起，
// 这些人在站立机位的身后（审查 r2 验收）。别处的路边的人、障碍，以及所有坐着的人、伸脚的人只到腰带。
import * as THREE from 'three';
import type { ArchetypeId, QualityProfile, ViewContext, ViewSystem } from '../../core/contracts';
import { LANE_WIDTH } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp01, easeInOutSine, lerp, smoothstep } from '../../core/math';
import { createRng } from '../../core/rng';
import type { AABB, AtmosphereId, ChapterId, CrowdOp, KitId, SimSnapshot } from '../../core/types';
import { urlParams } from '../../core/urlParams';
import { OBSTACLES } from '../../levels/obstacles';
import type { CompiledChapter, CompiledObstacle, CompiledSegment, RunSegmentDef } from '../../levels/schema';
import { ArchetypePoolImpl, createArchetypeMaterial, type ArchetypeDef, type PlaceCtx } from './archetype';
import {
  FOOT_CENTER, GAZE_MAX, GAZE_TOTAL, clapClosed, gazeAmount, gazeSince, hash01, idleSway, obstacleTwist, obstacleYaw, partOffset, shiftBlend, silenceClock,
  silenceLevel, tremble, walkPose, type ShiftBlend, type Sway, type Tremble, type WalkPose,
} from './behaviors';
import { CRAWL, Crawlers, type Crawler } from './Crawlers';
import { expandChapter, lowerBound, type Decor, type GroupInfo } from './crowds';
import { HitboxDebug } from './hitboxDebug';
import type { InstPool } from './InstPool';
import { BODY, LegForest, STAND_HIP, newPerson, type Person } from './LegForest';
import { KNEELER_BOY, KNEELER_CROWD } from './archetypes/kneeler';
import { footSeat } from './archetypes/footOut';
import { MAX_EXPAND } from './archetype';
import { obstacleState, type ObstacleState } from './simBridge';
import { HIPS, crowdOfKit, emberGlow, itemIdOf, lookFor, specialLook, specialOfObstacle, type Look, type SpecialId } from './specials';
import { OUTDOOR_KITS } from './tone';

const DEG = Math.PI / 180;
/**
 * 障碍里的人凝视时鞋尖最多转多少（鞋尖转 0.6 倍、腿转 0.4 倍）：鞋绕脚踝转，转太多鞋尖会从碰撞盒正面缩回、
 * 或从侧面伸出 5 cm 以外（验收 4）。路边的人不受这个限制。
 */
export const OBSTACLE_GAZE_MAX = 35 * DEG;
/**
 * 陈默的蹲姿：髋高、髋角、膝角（弧度）、膝盖外分、鞋尖外转、上身前倾，以及整个人沿 −s 后退的距离（让蹲姿的前后沿居中在碰撞盒里）。
 */
export const CHEN_SQUAT: { hipH: number; hip: number; knee: number; legYaw: number; footYaw: number; lean: number; back: number } = {
  hipH: 0.215, hip: 125 * DEG, knee: 140 * DEG, legYaw: 0.45, footYaw: 0.15, lean: 0.4, back: 0.147,
};
/** 走路的人凝视时鞋尖最多转多少（鞋尖转 0.6 倍，腿不转）。 */
export const WALK_GAZE_MAX = 50 * DEG;
/** 「进入 3 m」的凝视记录多久之后清掉（秒）：人早已在身后、被裁掉，不再遍历到。 */
const GAZE_MEMO_TTL = 20;
/** 越过的障碍：远端 s1 < 玩家 s − PASS_BEHIND（碰撞盒后沿之后 0.3 m）起，PASS_FADE 秒内缩为 0（U6）。 */
export const PASS_BEHIND = 0.55, PASS_FADE = 0.12;
/** 画身后多远的障碍和人（米）：平时 5，回头或镜头转向身后时 14。 */
export const BEHIND_FORWARD = 5, BEHIND_LOOK = 14;
/** 4-3「从两侧超过你」的爬行者最多持续多久（秒）；离开本段也清掉。 */
export const OVERTAKE_LIFE = 16;
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** 一段「凝视事件」：t 时刻以 (s, x) 为中心、半径 r 内的人把鞋尖转向玩家（hit / ask / crowd turnShoes）。 */
interface GazeEvent { t: number; s: number; x: number; r: number; group: number }

/** 调试用的「舞台」：用合成的障碍和人群替换本章数据（__game.ext.npcStage）。 */
export interface Stage {
  name: string;
  obstacles: CompiledObstacle[];
  segment: CompiledSegment;
  decor: Decor[];
  groups: GroupInfo[];
  t0: number;
  /** 舞台跟着玩家走（画廊）；false = 固定在放置时的里程（看凝视、伸脚）。 */
  follow: boolean;
  s0: number;
  kit: KitId;
}

export interface ObstacleViewStats { people: number; crawlers: number; instances: Record<string, number>; updateMs: number; drawMeshes: number }

export class ObstacleView implements ViewSystem {
  readonly id = 'npc';
  readonly owner = 'WP6' as const;
  readonly order = 20;
  ctx!: ViewContext;
  readonly pools = new Map<ArchetypeId, ArchetypePoolImpl>();
  readonly forest = new LegForest();
  readonly crawlers = new Crawlers();
  hitbox: HitboxDebug | null = null;
  private defs: ArchetypeDef[] = [];

  chapter: CompiledChapter | null = null;
  private segIndex = 0;
  /** 每段在模拟时钟上的开始时刻（NaN = 还没到 / 未知）。 */
  private segStart: number[] = [];
  /** 失败（fall）的时刻：模拟此后不再推进段内时间；null = 没有失败。 */
  private fallT: number | null = null;
  /** 陈默让开后站的位置（读章时按相邻车道的障碍算好）。 */
  private chenDest = new Map<number, ChenDest>();
  private knocked = new Map<number, number>();
  private taken = new Set<string>();
  private asks = new Map<number, { t: number; part: boolean }>();
  private gazeEvents: GazeEvent[] = [];
  private silences: number[] = [];
  private gazeMemo = new Map<number, number>();
  /** 越过的障碍：障碍 id → 远端越过 s − PASS_BEHIND 的时刻（模拟时钟，按速度往回推到真正越过的那一刻）。 */
  private passedAt = new Map<number, number>();
  /** 全部实例池（越过的障碍缩小时按放置前后的实例数找到它的实例）；init 之后填。 */
  private fadePools: InstPool[] = [];
  private fadeMarks: number[] = [];
  private decor: Decor[] = [];
  private groups: GroupInfo[] = [];
  /** 人墙段（U6）：段 → 这一段里站着的人（路边的组、人腿障碍）一直画上身（人群段 2-2、5-6）。读章时定。 */
  private wallSegs: boolean[] = [];
  /** 段 → 显示这一段的组的站立段下标（4-2 → 4-3、5-7 → 5-8；没有 = −1）。这一段里站着的人只在那个站立段进行时画上身。 */
  private standOf: number[] = [];
  /** 重来 / 读章之后的第一帧把衣服色调直接切到当前氛围（那时 World 已经按检查点重放过 atmosphere）。 */
  private toneSnap = true;
  private groupState: Array<{ gaze: Decor['gaze'] | null; applaud: number; overtake: number; overtakeS: number }> = [];
  private globalOp: { applaud: number; overtake: number; overtakeS: number } = { applaud: -1, overtake: -1, overtakeS: 0 };
  private chenFoot = new Map<number, CompiledObstacle>();   // chenMo 障碍 id → 他留在过道里的脚
  private chenFootIds = new Set<number>();
  private specials = new Map<number, SpecialId>();
  private looks = new Map<number, Look>();
  stage: Stage | null = null;
  private lastT = 0;
  private lastPrune = 0;
  /** 最近一帧的快照（调试扩展触发 crowd / ask / hit 时用）。 */
  lastSnap: SimSnapshot | null = null;
  readonly stats: ObstacleViewStats = { people: 0, crawlers: 0, instances: {}, updateMs: 0, drawMeshes: 0 };

  // 复用的临时对象
  private readonly pc: PlaceCtx;
  private readonly st: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  private readonly st2: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  private readonly person: Person = newPerson(lookFor('student', 1, 'tmp'));
  private readonly walk: WalkPose = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, bob: 0 };
  private readonly crawler: Crawler = { x: 0, y: 0, z: 0, yaw: 0, dist: 0, color: new THREE.Color(), phase: 0 };
  private readonly target = new THREE.Vector3();
  private readonly box: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly fctx: FrameCtx = { s: 0, px: 0, t: 0, tAnim: 0, beat: 0, tSeg: 0, speed: 0, bps: 5, ahead: 40, behind: BEHIND_FORWARD, hush: 0, reveal: 0, standSeg: -1 };
  private readonly fallbackLook: Look = lookFor('student', 1, 'fallback');
  private readonly sway: Sway = { dx: 0, knee: 0, side: 1 };
  private readonly trem: Tremble = { roll: 0, pitch: 0 };
  private readonly blend: ShiftBlend = { turn: 0, move: 0 };

  constructor(defs: ArchetypeDef[] = []) {
    this.defs = defs;
    this.pc = {
      o: null as unknown as CompiledObstacle, st: this.st, floorY: 0, tSeg: 0, beat: -1, t: 0, knockedAt: null,
      chapter: 'ch1', kit: 'placeholder', playerX: 0, playerS: 0, partX: 0, bps: 5, reducedFlicker: false,
      side: (id, m, variant, glow, color) => { const p = this.pools.get(id); if (p) p.push(m, p.variantIndex(variant), glow ?? 0, color); },
    };
  }

  setDefs(defs: ArchetypeDef[]): void { this.defs = defs; }

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    for (const d of this.defs) {
      if (this.pools.has(d.id) || d.delegate) continue;
      const mat = createArchetypeMaterial(ctx, d);
      const pool = new ArchetypePoolImpl(d, mat, d.cap);
      ctx.mat.ensureChalkAttr(pool.geo);
      ctx.scene.add(pool.pool.mesh);
      this.pools.set(d.id, pool);
    }
    this.forest.init(ctx);
    this.crawlers.init(ctx);
    this.fadePools = [...Array.from(this.pools.values(), (p) => p.pool), ...this.forest.instPools(), ...this.crawlers.instPools()];
    this.fadeMarks = this.fadePools.map(() => 0);
    if (urlParams().debug.has('hitbox')) this.enableHitbox(true);
  }

  enableHitbox(on: boolean): void {
    if (on && !this.hitbox) { this.hitbox = new HitboxDebug(); this.ctx.scene.add(this.hitbox.lines); }
    if (!on && this.hitbox) { this.ctx.scene.remove(this.hitbox.lines); this.hitbox.lines.geometry.dispose(); this.hitbox = null; }
  }

  setQuality(q: QualityProfile): void { this.forest.setQuality(q); this.crawlers.setQuality(q); }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    this.chapter = ch;
    const { decor, groups } = expandChapter(ch.seed, ch.segments);
    this.groups = groups;
    this.wallSegs = ch.segments.map((_, i) => isWallSegment(ch.segments, i));
    this.standOf = ch.segments.map((_, i) => standRevealOf(ch.segments, i));
    this.groupState = groups.map(() => ({ gaze: null, applaud: -1, overtake: -1, overtakeS: 0 }));
    this.specials.clear(); this.looks.clear(); this.chenFoot.clear(); this.chenFootIds.clear(); this.chenDest.clear();
    this.segStart = ch.segments.map(() => Number.NaN);
    for (const seg of ch.segments) this.indexSegment(seg, ch.seed, ch.def.id);
    this.decor = this.withoutSeatClash(decor, ch.segments.flatMap((sg) => sg.obstacles));
    this.resetState();
    this.taken.clear();
  }

  /**
   * 识别特殊 NPC、给人腿障碍定外观、把陈默和他的脚连起来。
   * 周主任（灰夹克 + 暖色的烟头）只在第三章（和调试舞台）出现：暖色只允许出现在第三章（附录 A-9），
   * 其他章节里 id 碰巧是 zhou / director 的人按普通人画。
   */
  private indexSegment(seg: CompiledSegment, seed: number, chapterId: string): void {
    if (seg.kind !== 'run') return;
    const def = seg.def as RunSegmentDef;
    const crowd = crowdOfKit(def.kit);
    for (const o of seg.obstacles) {
      let sp = specialOfObstacle(o, def.kit, def.variant);
      if (sp === 'directorZhou' && !zhouAllowed(chapterId)) sp = null;
      if (sp) this.specials.set(o.id, sp);
      if (o.archetype === 'legs') this.looks.set(o.id, sp ? specialLook(sp) : lookFor(crowd, seed, `obs:${o.id}`));
    }
    for (const o of seg.obstacles) {
      if (o.kind !== 'chenMo') continue;
      // 他的脚：同段里 id 含 chenmo 的 footOut；没有就取他身后同车道 4 m 内的第一只 footOut
      const byId = seg.obstacles.find((f) => f.kind === 'footOut' && (itemIdOf(f) ?? '').toLowerCase().includes('chenmo'));
      const near = seg.obstacles.find((f) => f.kind === 'footOut' && f.s0 >= o.s0 && f.s0 - o.s1 < 4 && f.lanes.some((l) => o.lanes.includes(l)));
      const foot = byId ?? near;
      if (foot) { this.chenFoot.set(o.id, foot); this.chenFootIds.add(foot.id); }
      this.chenDest.set(o.id, chenStepAside(o, foot ?? null, seg.obstacles, this.st2));
    }
  }

  /**
   * 伸脚的人坐在车道外沿自己的椅子上（archetypes/footOut.ts）。路边 seatedRow 里坐在同一个位置的人去掉，免得两个人、两把椅子叠在一起。
   */
  private withoutSeatClash(decor: Decor[], obstacles: readonly CompiledObstacle[]): Decor[] {
    const seats: Array<{ x: number; s: number }> = [];
    for (const o of obstacles) {
      if (o.kind !== 'footOut' || this.chenFootIds.has(o.id)) continue;
      obstacleState(o, 0, -1, this.st2);
      seats.push(footSeat(o, this.st2.x0, this.st2.x1));
    }
    if (seats.length === 0) return decor;
    return decor.filter((d) => d.kind !== 'person' || d.pose === 'walk' || !seats.some((q) => Math.abs(d.x - q.x) < 0.6 && Math.abs(d.s - q.s) < 0.9));
  }

  private resetState(): void {
    this.knocked.clear(); this.asks.clear(); this.gazeEvents = []; this.silences = []; this.gazeMemo.clear(); this.passedAt.clear();
    this.fallT = null;
    for (const g of this.groupState) { g.gaze = null; g.applaud = -1; g.overtake = -1; }
    this.globalOp.applaud = -1; this.globalOp.overtake = -1;
  }

  onSegment(seg: CompiledSegment): void { this.segIndex = seg.index; }

  /** 调试舞台：用合成数据替换本章的障碍和人群（null = 恢复）。 */
  setStage(stage: Stage | null): void {
    this.stage = stage;
    const groups = stage ? stage.groups : this.groups;
    this.groupState = groups.map(() => ({ gaze: null, applaud: -1, overtake: -1, overtakeS: 0 }));
    this.resetState();
    if (stage) {
      this.indexSegment(stage.segment, 7, 'stage');
      stage.decor = this.withoutSeatClash(stage.decor, stage.obstacles);
    }
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    const t = snap.t;
    switch (e.type) {
      case 'segment':
        this.segStart[e.data.index] = t; this.segIndex = e.data.index;
        this.globalOp.applaud = -1;
        // 「从两侧超过你」只属于发 cue 的那一段（4-3）：离开本段就收掉，免得被下一段更快的玩家反超
        if (this.globalOp.overtake >= 0 && this.globalOp.overtake < t) this.globalOp.overtake = -1;
        for (const g of this.groupState) if (g.overtake >= 0 && g.overtake < t) g.overtake = -1;
        break;
      case 'hit': {
        const o = this.findObstacle(e.data.obstacleId);
        if (o && (o.cls === 'low')) this.knocked.set(o.id, t);
        const p = snap.player;
        this.gazeEvents.push({ t, s: p.s, x: p.x, r: 5, group: -1 });
        if (e.data.crowd) this.silences.push(t);
        this.trimEvents(t);
        break;
      }
      case 'ask': {
        this.asks.set(e.data.targetId, { t, part: e.data.result === 'part' });
        const p = snap.player;
        // 「附近的鞋尖全转过来」
        this.gazeEvents.push({ t: t + 0.3, s: p.s, x: p.x, r: 6, group: -1 });
        this.trimEvents(t);
        break;
      }
      case 'note': this.taken.add(e.data.id); break;
      case 'fall': this.fallT = t; break;
      case 'retry': this.resetState(); break;
      default: break;
    }
  }

  onReset(snap: SimSnapshot): void {
    this.resetState();
    this.forest.tone.snap(this.atmosphereId(snap.segIndex));
    // 与 World 的 onReset 谁先谁后无关：下一帧再按那时的氛围（检查点重放过的 atmosphere）切一次
    this.toneSnap = true;
    const segs = this.chapter?.segments ?? [];
    const i0 = snap.segIndex;
    const seg = segs[i0];
    this.segIndex = i0;
    if (this.segStart.length !== segs.length) this.segStart = segs.map(() => Number.NaN);
    // 读章或跳到检查点时模拟把 tSeg 设为 seg.timeAt(beat)
    this.segStart[i0] = seg && seg.kind === 'run' ? snap.t - seg.timeAt(snap.segBeat) : snap.t;
    // 之前的段按名义时长往回推（静场、站立段的时长由玩家决定，按 0 计）；之后的段还没开始
    for (let i = i0 - 1; i >= 0; i--) {
      const sg = segs[i] as CompiledSegment;
      const dur = sg.kind === 'run' ? sg.timeAt((sg.def as RunSegmentDef).beats) : 0;
      this.segStart[i] = (this.segStart[i + 1] as number) - dur;
    }
    for (let i = i0 + 1; i < segs.length; i++) this.segStart[i] = Number.NaN;
  }

  /** 当前氛围：WP3 的 World 挂在 ctx 上的插值器目标（含 atmosphere cue）；没有时按段的数据。 */
  private atmosphereId(segIndex: number): AtmosphereId {
    return this.ctx?.atmosphere?.id ?? this.chapter?.segments[segIndex]?.def.atmosphere ?? 'morning';
  }

  /** 第 i 段此刻的段内时间（秒，模拟时钟 t）。还没开始的段为 0。 */
  private segTime(i: number, t: number): number {
    if (i > this.segIndex) return 0;
    const t0 = this.segStart[i];
    return t0 === undefined || Number.isNaN(t0) ? 0 : Math.max(0, t - t0);
  }
  /** 第 i 段的开始时刻（未知时取 t，即段内时间 0）。 */
  private segStartAt(i: number, t: number): number {
    const t0 = this.segStart[i];
    return t0 === undefined || Number.isNaN(t0) ? t : t0;
  }

  private trimEvents(t: number): void {
    this.gazeEvents = this.gazeEvents.filter((g) => t - g.t < GAZE_TOTAL + 1);
    if (this.silences.length > 8) this.silences.splice(0, this.silences.length - 8);
    if (this.knocked.size > 64) for (const [id, tk] of this.knocked) if (t - tk > 30) this.knocked.delete(id);
  }

  findObstacle(id: number): CompiledObstacle | undefined {
    if (this.stage) { const o = this.stage.obstacles.find((x) => x.id === id); if (o) return o; }
    for (const seg of this.chapter?.segments ?? []) { const o = seg.obstacles.find((x) => x.id === id); if (o) return o; }
    return undefined;
  }

  /**
   * crowd cue（§8.7，WP6 唯一处理者）。group 为 NpcGroupDef.id；'*'（或空）作用于本章全部组。
   * 找不到的组名不做任何事，只在控制台警告一次：数据里的拼写错误不应让整章人群一起转鞋尖或鼓掌。
   */
  crowdOp(group: string, op: CrowdOp, snap: SimSnapshot): void {
    const t = snap.t;
    const groups = this.stage ? this.stage.groups : this.groups;
    const states = this.groupState;
    const all = group === '*' || group === '';
    const idx = all ? [] : groups.map((g, i) => (g.key === group || g.def.id === group ? i : -1)).filter((i) => i >= 0);
    if (!all && idx.length === 0) { this.warnOnce(`npc: crowd cue 的组「${group}」不存在（op ${op}），已忽略；作用于全部组请写 '*'`); return; }
    const targets = all ? groups.map((_, i) => i) : idx;
    for (const i of targets) {
      const st = states[i] ?? (states[i] = { gaze: null, applaud: -1, overtake: -1, overtakeS: 0 });
      switch (op) {
        case 'turnShoes': st.gaze = 'turnShoes'; this.gazeEvents.push({ t, s: snap.player.s, x: snap.player.x, r: 60, group: i }); break;
        case 'centerShoes': st.gaze = 'center'; break;
        case 'silent': break;
        case 'applaud': st.applaud = t; break;
        case 'crawlOvertake': st.overtake = t; st.overtakeS = snap.player.s; break;
        case 'normal': st.gaze = null; st.applaud = -1; st.overtake = -1; break;
      }
    }
    if (op === 'silent') this.silences.push(t);
    if (all) {
      if (op === 'applaud') this.globalOp.applaud = t;
      if (op === 'crawlOvertake') { this.globalOp.overtake = t; this.globalOp.overtakeS = snap.player.s; }
      if (op === 'normal') { this.globalOp.applaud = -1; this.globalOp.overtake = -1; }
      if (op === 'turnShoes' && groups.length === 0) this.gazeEvents.push({ t, s: snap.player.s, x: snap.player.x, r: 60, group: -1 });
    }
  }

  private readonly warned = new Set<string>();
  /** 已警告过的消息（测试用）。 */
  get warnings(): readonly string[] { return [...this.warned]; }
  private warnOnce(msg: string): void {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    if (typeof console !== 'undefined') console.warn(msg);
  }

  // ——————————————————— 每帧 ———————————————————
  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, _dt = 0): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.lastSnap = next;
    for (const p of this.pools.values()) p.begin();
    this.forest.begin(); this.crawlers.begin(); this.hitbox?.begin();
    if (next.segKind !== 'still' && (this.chapter || this.stage)) this.fill(prev, next, alpha);
    for (const p of this.pools.values()) p.end();
    this.forest.end(); this.crawlers.end(); this.hitbox?.end();
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.stats.updateMs = t1 - t0;
    this.stats.people = this.forest.people;
    this.stats.crawlers = this.crawlers.count;
  }

  private fill(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
    const same = prev.segIndex === next.segIndex;
    const a = same ? alpha : 1;
    const P = prev.player, N = next.player;
    const s = lerp(P.s, N.s, a), px = lerp(P.x, N.x, a);
    const t = lerp(prev.t, next.t, a);
    const beat = same ? lerp(prev.segBeat, next.segBeat, a) : next.segBeat;
    // 障碍的段内时间与模拟一致：失败以后模拟不再推进 tSeg（门、伸出的脚停在那一刻），直到 retry
    const tObs = this.fallT !== null ? Math.min(t, this.fallT) : t;
    const tSeg = this.segTime(this.segIndex, tObs);
    const speed = Math.max(0, N.speed);
    const bps = next.segKind === 'run' ? Math.max(0.5, N.cadence || speed / Math.max(0.3, N.stride)) : 4.8;
    this.lastT = t;
    this.pruneGazeMemo(t);
    if (this.toneSnap) { this.forest.tone.snap(this.atmosphereId(next.segIndex)); this.toneSnap = false; }
    else this.forest.tone.update(this.atmosphereId(next.segIndex), t);
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    const fogFar = fog && 'far' in fog ? fog.far : 60;
    const ahead = Math.min(this.ctx.quality.chunksAhead * 12 + 6, fogFar + 4);
    // 身后的东西什么时候看得见：回头（lookBack 0..1）或镜头转向身后（turnBack 机位；读上一帧的镜头朝向）
    const reveal = Math.max(N.lookBack > 0 ? smoothstep(0, 0.35, N.lookBack) : 0, cameraBackness(this.ctx.camera));
    const behind = N.lookBack > 0 || reveal > 0 ? BEHIND_LOOK : BEHIND_FORWARD;
    const tAnim = silenceClock(t, this.silences);
    const hush = silenceLevel(t, this.silences);
    const pc = this.pc;
    pc.t = t; pc.playerX = px; pc.playerS = s; pc.bps = bps; pc.reducedFlicker = this.reducedFlicker;
    pc.chapter = this.stage ? 'stage' : (this.chapter?.def.id ?? 'ch1') as ChapterId;
    const ctx = this.fctx;
    ctx.s = s; ctx.px = px; ctx.t = t; ctx.tAnim = tAnim; ctx.beat = beat; ctx.tSeg = tSeg; ctx.speed = speed; ctx.bps = bps;
    ctx.ahead = ahead; ctx.behind = behind; ctx.hush = hush; ctx.reveal = reveal;
    ctx.standSeg = next.segKind === 'stand' ? next.segIndex : -1;

    // —— 障碍 ——
    if (this.stage) {
      const st = this.stage;
      const shift = st.follow ? s - st.s0 : 0;
      this.obstaclesOf(st.segment, st.obstacles, ctx, true, t - st.t0, shift, st.kit, 'default');
    } else if (this.chapter) {
      for (const seg of this.chapter.segments) {
        if (seg.kind !== 'run') continue;
        if (seg.s1 < s - behind - 80 || seg.s0 > s + ahead + 80) continue;
        const cur = seg.index === this.segIndex;
        const past = seg.index < this.segIndex;
        const def = seg.def as RunSegmentDef;
        // 已经过去的段：时间照常走，拍号 +∞（陈默已让开、人墙已移动）；还没到的段：时间 0、拍号 −1
        const tS = cur ? tSeg : this.segTime(seg.index, tObs);
        const bS = cur ? beat : past ? Number.POSITIVE_INFINITY : -1;
        this.obstaclesOf(seg, seg.obstacles, ctx, cur, tS, 0, def.kit, def.variant, bS);
      }
    }
    // —— 路边的人 ——
    this.decorPass(ctx);
    // —— 玩家的碰撞盒 ——
    if (this.hitbox && next.segKind === 'run') this.hitbox.box(N.hitbox, N.floorY, 0xffffff, 1);
  }

  private obstaclesOf(seg: CompiledSegment, list: readonly CompiledObstacle[], f: FrameCtx, cur: boolean, tSeg: number, shift: number, kit: KitId, variant: string, beatIn = -1): void {
    const pc = this.pc;
    const beat = this.stage ? (f.s - this.stage.segment.s0 - shift) / Math.max(0.3, seg.stride) : beatIn;
    pc.kit = kit; pc.tSeg = tSeg; pc.beat = beat;
    for (const o of list) {
      const st = obstacleState(o, tSeg, beat, this.st);
      const s0 = o.s0 + st.ds + shift, s1 = o.s1 + st.ds + shift;
      if (s0 > f.s + f.ahead || s1 < f.s - f.behind) continue;
      if (o.cls === 'pickup' && this.taken.has(String(o.params.note ?? ''))) continue;
      st.ds += shift;
      const floorY = seg.floorY(Math.min(Math.max(s0, seg.s0), seg.s1));
      pc.o = o; pc.floorY = floorY; pc.knockedAt = this.knocked.get(o.id) ?? null;
      if (this.hitbox) this.hitbox.obstacle(o, st, floorY, this.box, pc.knockedAt !== null);
      // 越过的障碍：缩小到 0 后不再画（回头时照常画）
      const k = this.passScale(o.id, s1, f);
      if (k <= 0) continue;
      if (k < 1) {
        this.markFade();
        this.placeObstacle(o, st, seg, f, cur, kit, variant, floorY, tSeg);
        this.applyFade(k, (st.x0 + st.x1) / 2, floorY, -(s0 + s1) / 2);
        continue;
      }
      this.placeObstacle(o, st, seg, f, cur, kit, variant, floorY, tSeg);
    }
  }

  /**
   * 越过的障碍的缩放：1 = 照常；远端越过 s − PASS_BEHIND 之后 PASS_FADE 秒内降到 0。越过的时刻按当前速度往回推，
   * 帧率低（无头 SwiftShader 每帧 0.1 s 以上）时也不会多停一帧。回头时取 reveal（身后看得见的程度）。
   */
  private passScale(id: number, s1: number, f: FrameCtx): number {
    const over = f.s - PASS_BEHIND - s1;
    if (over <= 0) { if (this.passedAt.size > 0) this.passedAt.delete(id); return 1; }
    let t0 = this.passedAt.get(id);
    if (t0 === undefined || t0 > f.t) { t0 = f.t - over / Math.max(0.5, f.speed); this.passedAt.set(id, t0); }
    const k = 1 - clamp01((f.t - t0) / PASS_FADE);
    return Math.max(k, f.reveal);
  }

  private markFade(): void { for (let i = 0; i < this.fadePools.length; i++) this.fadeMarks[i] = (this.fadePools[i] as InstPool).n; }
  private applyFade(k: number, x: number, y: number, z: number): void {
    for (let i = 0; i < this.fadePools.length; i++) (this.fadePools[i] as InstPool).scaleFrom(this.fadeMarks[i] as number, k, x, y, z);
  }

  /** 按原型把一个障碍放进对应的实例池（人腿 → 腿的森林，爬行者 → Crawlers，其余 → 原型池）。 */
  private placeObstacle(o: CompiledObstacle, st: ObstacleState, seg: CompiledSegment, f: FrameCtx, cur: boolean, kit: KitId, variant: string, floorY: number, tSeg: number): void {
    const pc = this.pc;
    const ask = this.asks.get(o.id);
    pc.partX = ask && ask.part ? this.partDir(o, st) * partOffset(f.t - ask.t) : 0;
    if (this.chenFootIds.has(o.id)) return;                 // 陈默的脚由陈默自己画
    if (o.archetype === 'legs') { this.legsObstacle(o, st, seg, f, cur, kit, variant, floorY); return; }
    if (o.archetype === 'crawler') { this.crawlerObstacle(o, st, f, tSeg, floorY); return; }
    const pool = this.pools.get(o.archetype);
    if (!pool) return;
    if (o.archetype === 'kneeler' && this.kneelerSpecial(pool, o, f)) return;
    pool.placeEx(pc);
  }

  /** 让开的方向：多车道时由各人自己决定（见 legsObstacle），单车道朝离中间远的一侧。 */
  private partDir(o: CompiledObstacle, st: ObstacleState): number {
    const c = (st.x0 + st.x1) / 2;
    if (Math.abs(c) > 0.3) return Math.sign(c);
    return this.pc.playerX > c ? -1 : 1;
  }

  // ——— 梦里摔进车道的男生（fallInto）、发抖的模仿者 ———
  private kneelerSpecial(pool: ArchetypePoolImpl, o: CompiledObstacle, f: FrameCtx): boolean {
    const pc = this.pc;
    const cx = (pc.st.x0 + pc.st.x1) / 2, zc = -((o.s0 + o.s1) / 2 + pc.st.ds);
    const boy = this.specials.get(o.id) === 'dreamBoy';
    const b = o.behavior;
    let x = cx, variant = 'kneel', roll = 0, pitch = 0;
    if (b.type === 'fallInto') {
      // 摔进车道：画面在碰撞生效前 0.45 s 开始倒（先看见、后碰到）；之前跪在车道旁边（≥ 1.2 s 可见）
      const lead = 0.45 * f.bps;
      const u = pc.beat < 0 ? 0 : clamp01((pc.beat - (b.atBeat - lead)) / lead);
      const side = cx >= 0 ? 1 : -1;
      x = lerp(cx + side * 0.78, cx, easeInOutSine(u));
      if (u >= 0.6) variant = 'fallen';
      else roll = -side * u * 0.9;
    } else if (pc.knockedAt !== null && f.t - pc.knockedAt > 0.15) {
      variant = 'fallen';
    } else {
      const tr = tremble(f.tAnim, o.id, this.trem);
      roll = tr.roll; pitch = tr.pitch;
    }
    this.m.makeRotationFromEuler(_e.set(pitch, 0, roll));
    this.m.setPosition(x, pc.floorY, zc);
    pool.push(this.m, pool.variantIndex(variant), 0, boy ? KNEELER_BOY : KNEELER_CROWD);
    return true;
  }

  // ——— 爬行者障碍 ———
  private crawlerObstacle(o: CompiledObstacle, st: ObstacleState, f: FrameCtx, tSeg: number, floorY: number): void {
    const c = this.crawler;
    const b = o.behavior;
    const sp = b.type === 'walk' ? b.speed : 0;
    c.x = (st.x0 + st.x1) / 2 + this.pc.partX;
    c.y = floorY;
    const zc = -((o.s0 + o.s1) / 2 + st.ds);
    c.yaw = sp < 0 ? Math.PI : 0;
    c.z = zc + (sp < 0 ? CRAWL.centerZ : -CRAWL.centerZ);
    c.dist = Math.abs(sp) * tSeg + o.id * 0.37;
    c.phase = 0;
    c.color.setHex(0x9aa3a6);
    this.crawlers.add(c, true);
  }

  // ——— 人腿障碍：一人一道；陈默；周主任；马老师 ———
  // 每个人站在车道中心（多车道的人墙：外侧两人的外沿正好落在碰撞盒的 x0 / x1 上），沿朝向后退 FOOT_CENTER 让鞋的前后沿居中；
  // 垂在身侧的前臂让剪影的横向外沿 ≈ 碰撞盒半宽（验收 4）。朝向只取几种不会让剪影比碰撞盒窄的角度（obstacleYaw）。
  private legsObstacle(o: CompiledObstacle, st: ObstacleState, seg: CompiledSegment, f: FrameCtx, cur: boolean, kit: KitId, variant: string, floorY: number): void {
    const look = this.looks.get(o.id) ?? this.fallbackLook;
    const sp = this.specials.get(o.id);
    const p = this.person;
    if (sp === 'chenMo') { this.chenMo(o, st, seg, f, cur, look, floorY); return; }
    const lanes = Math.max(1, Math.round((st.x1 - st.x0 - 2 * o.halfW) / LANE_WIDTH) + 1);
    const gap = lanes > 1 ? (st.x1 - st.x0 - 2 * o.halfW) / (lanes - 1) : 0;
    const zc = -((o.s0 + o.s1) / 2 + st.ds);
    const b = o.behavior;
    // 人墙移动（shift）：1.2 s 前鞋尖先转过去，碰撞切换时平移
    let shiftTurn = 0, shiftDx = 0;
    if (b.type === 'shift' && cur) {
      const dt = (f.beat - b.atBeat) / f.bps;
      const bl = shiftBlend(dt, 0, this.blend);
      obstacleState(o, f.tSeg, b.atBeat - 1, this.st2);
      const before = (this.st2.x0 + this.st2.x1) / 2;
      obstacleState(o, f.tSeg, b.atBeat + 1, this.st2);
      const after = (this.st2.x0 + this.st2.x1) / 2;
      const now = (st.x0 + st.x1) / 2;
      shiftDx = lerp(before, after, bl.move) - now;
      shiftTurn = bl.turn * Math.sign(after - before);
    }
    for (let i = 0; i < lanes; i++) {
      const cx = st.x0 + o.halfW + gap * i + shiftDx;
      this.resetPerson(p, look);
      // 让一下：单人往外侧让；多人从中间分开（「前面两个女生分开一条缝」）
      const part = this.pc.partX;
      const mid = (lanes - 1) / 2;
      p.x = cx + (lanes > 1 ? Math.abs(part) * (i < mid ? -1 : i > mid ? 1 : Math.sign(part)) : part);
      p.y = floorY; p.z = zc;
      p.arms = look.hips !== HIPS.jacket && look.hips !== HIPS.books && look.hips !== HIPS.fullUpper;
      if (b.type === 'walk') {
        p.yaw = b.speed > 0 ? Math.PI : 0;
        // 走路的人在「安静的一秒」里也不停：碰撞盒按段内时间继续移动，步态按走过的距离（= 碰撞盒的位移），画面和碰撞一起动
        walkPose(Math.abs(b.speed) * this.pc.tSeg + i * 0.3 + o.id, this.walk);
        this.applyWalk(p);
      } else {
        p.yaw = sp ? 0 : obstacleYaw(o.id, i);
        p.turn = sp ? 0 : obstacleTwist(o.id, i);
        this.applyIdle(p, f.tAnim, (o.id * 0.137 + i * 0.31) % 1);
      }
      // 鞋尖在脚踝前面：站着的人沿朝向后退，让鞋的前后沿居中（走路的人两只脚前后摆，本来就对称）
      if (b.type !== 'walk') { p.x -= Math.sin(p.yaw) * FOOT_CENTER; p.z -= Math.cos(p.yaw) * FOOT_CENTER; }
      if (shiftTurn !== 0) { const turn = shiftTurn * 70 * DEG; p.footYawL += turn; p.footYawR += turn; p.legYawL += turn * 0.3; p.legYawR += turn * 0.3; }
      // 障碍里的人只转鞋尖和腿（上身扭过去会让垂着的手伸出碰撞盒）
      this.applyGaze(p, o.id * 8 + i, (o.s0 + o.s1) / 2 + st.ds, f, 'turnShoes', -1, b.type === 'walk', OBSTACLE_GAZE_MAX, 0);
      // 人群段里的人腿障碍（2-2、5-6 的「两侧车道的人墙」）和路边的人一样画上身，梦里的人本来就有上身：每个画质都画（U6）。
      // 站立段要显示的那一段（5-7「排队同学的腿」）只在站立段进行时画；别处只到腰带
      p.wall = kit === 'plaza' || this.wallAt(seg.index, f);
      p.upper = look.upper || p.wall;
      p.outdoor = OUTDOOR_KITS.has(kit);
      if (p.upper && this.globalOp.applaud >= 0) p.clap = clapClosed(f.tAnim, hash01(o.id + i)) ? 2 : 1;
      if (sp === 'directorZhou') p.glow = emberGlow(f.t, this.reducedFlicker);
      this.forest.add(p);
    }
    void seg; void variant; void kit;
  }

  /**
   * 陈默：蹲在过道里（头与你的视线齐平）→ 到点起身 → 让到一边，一只脚留在过道里（§4.1 1-2）。
   * 蹲姿（CHEN_SQUAT）收在碰撞盒（0.70 宽 × 0.50 深 × 1.00 高）里：膝盖外分、上身前倾，整个人沿 −s 退 back 米让前后沿居中，
   * 头顶正好在碰撞盒上沿（≈ 1.0 m，和镜头一样高）。偏差 ≤ 5 cm 由 tests/unit/npc/archetypes.test.ts 检查。
   */
  private chenMo(o: CompiledObstacle, st: ObstacleState, seg: CompiledSegment, f: FrameCtx, cur: boolean, look: Look, floorY: number): void {
    const p = this.person;
    this.resetPerson(p, look);
    const b = o.behavior;
    const at = b.type === 'yield' ? b.atBeat : Number.POSITIVE_INFINITY;
    const beat = this.pc.beat;
    // 起身：at − 2.6 → at − 1.6 拍；让开：at − 1.6 → at − 0.6 拍。画面先于碰撞（先看见、后碰到）：
    // 他留在过道里的脚从 at − 1.3 拍起就在画面上，第一章按 1-2 的减速曲线算，离接触还有 ≥ 1.2 s（R4）。
    const rise = clamp01((beat - (at - 2.6)) / 1.0);
    const step = clamp01((beat - (at - 1.6)) / 1.0);
    const cx = (o.lanes.reduce<number>((acc, l) => acc + l, 0) / Math.max(1, o.lanes.length)) * LANE_WIDTH;
    const zc = -((o.s0 + o.s1) / 2);
    const foot = this.chenFoot.get(o.id);
    // 让到一边：相邻车道在那个位置有障碍（1-2 的储物柜）时只让到它的内沿以内，不钻进柜子里（审查 r2）
    const dest = this.chenDest.get(o.id) ?? chenStepAside(o, foot ?? null, [], this.st2);
    const { side, fx, fs } = dest;
    const destX = dest.x, destZ = -dest.s;
    const e = easeInOutSine(step);
    const r = easeInOutSine(rise);
    const S = CHEN_SQUAT;
    p.x = lerp(cx, destX, e); p.z = lerp(zc - S.back * (1 - r), destZ, e); p.y = floorY;
    p.yaw = 0;
    p.hipH = lerp(S.hipH, STAND_HIP, r);
    p.hipL = p.hipR = lerp(S.hip, 0, r);
    p.kneeL = p.kneeR = lerp(S.knee, 0, r);
    p.legYawL = -lerp(S.legYaw, 0.04, r); p.legYawR = lerp(S.legYaw, 0.04, r);
    p.footYawL = -S.footYaw * (1 - r); p.footYawR = S.footYaw * (1 - r);
    p.lean = lerp(S.lean, 0, r);
    p.squat = rise < 0.5; p.seated = false;
    if (foot && step > 0.3) {
      // 留在过道里的脚：左腿伸直指向脚的位置（碰撞盒中心），鞋尖朝过道另一侧
      this.target.set(fx - side * 0.06, floorY + BODY.ankle, -fs);
      if (side > 0) { p.targetL = this.target; p.footYawL = -Math.PI / 2; }
      else { p.targetL = this.target; p.footYawL = Math.PI / 2; }
      p.stance = 0.12;
    }
    p.upper = true;
    if (rise >= 1) this.applyIdle(p, f.tAnim, 0.37);
    this.forest.add(p);
    void st; void seg; void cur;
  }

  /**
   * 第 seg 段里站着的人这一帧画不画上身（U6）：人群段一直画；站立段要显示的组所在的段（4-2、5-7）只在那个站立段进行时画。
   * 只看段和当前段的种类，与玩家远近、画面上还有谁无关。调试舞台不算。
   */
  private wallAt(seg: number, f: FrameCtx): boolean {
    if (this.stage || seg < 0) return false;
    return this.wallSegs[seg] === true || (f.standSeg >= 0 && this.standOf[seg] === f.standSeg);
  }

  private resetPerson(p: Person, look: Look): void {
    p.look = look; p.yaw = 0; p.hipH = STAND_HIP; p.stance = BODY.stance;
    p.hipL = p.hipR = p.kneeL = p.kneeR = 0; p.legYawL = p.legYawR = 0; p.footYawL = p.footYawR = 0;
    p.lean = 0; p.roll = 0; p.dx = 0; p.bob = 0; p.turn = 0; p.upper = false; p.wall = false; p.outdoor = false; p.clap = 0; p.glow = 0; p.targetL = null; p.seated = false; p.squat = false;
    p.arms = false;
  }

  /** idle：重心左右换（「安静的一秒」里动画时钟 tAnim 不走，所以人就停住了）。 */
  private applyIdle(p: Person, t: number, phase: number): void {
    const s = idleSway(t, phase, this.sway);
    p.dx = s.dx;
    p.roll = -s.dx * 0.8;
    if (s.side > 0) p.kneeR = s.knee; else p.kneeL = s.knee;
    p.footYawL = -6 * DEG; p.footYawR = 6 * DEG;
  }

  private applyWalk(p: Person): void {
    const w = this.walk;
    p.hipL = w.hipL; p.hipR = w.hipR; p.kneeL = w.kneeL; p.kneeR = w.kneeR; p.bob = w.bob;
  }

  /**
   * 凝视：鞋尖在 0.4 s 内转向玩家，停 0.5 s，再转回（接近触发 / 受击 / 让一下 / crowd turnShoes）。
   * center = 常驻朝走廊中央（站着、坐着的人整个转过去；走路的人不转，否则会横着走）；受击、让一下的凝视照样叠加上去。
   */
  private applyGaze(p: Person, key: number, sN: number, f: FrameCtx, mode: Decor['gaze'], group: number, walking = false, maxRel = GAZE_MAX, turnK = 0.25): void {
    const gs = group >= 0 ? this.groupState[group] : undefined;
    const m = gs?.gaze ?? mode;
    if (m === 'center' && !walking) {
      // 鞋尖（和整个人）朝向走廊中央：x → 0
      const want = p.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      p.yaw = want + (p.yaw - want) * 0.15;
      p.footYawL = p.footYawR = 0;
    }
    let g = 0;
    if (m === 'turnShoes') {
      let tt = this.gazeMemo.get(key);
      if (tt === undefined) {
        const since = gazeSince(sN - f.s, p.x - f.px, f.speed);
        if (since >= 0) { tt = f.t - since; this.gazeMemo.set(key, tt); }
      }
      if (tt !== undefined) g = gazeAmount(f.t - tt);
    }
    for (const ev of this.gazeEvents) {
      if (ev.group >= 0 && ev.group !== group) continue;
      if (ev.group < 0 && Math.hypot(sN - ev.s, p.x - ev.x) > ev.r) continue;
      g = Math.max(g, gazeAmount(f.t - ev.t));
    }
    if (g <= 0) return;
    // 目标方向：从这个人指向玩家（世界坐标：+z = −s）
    const want = Math.atan2(f.px - p.x, -(f.s) - p.z);
    // 走路的人只转鞋尖（最多 WALK_GAZE_MAX），腿不跟着转：腿一转，前后摆的腿就变成横着摆（螃蟹步），
    // 靠墙走的人脚会踩进墙里（审查 r2）
    const lim = walking ? Math.min(maxRel, WALK_GAZE_MAX) : maxRel;
    const rel = Math.max(-lim, Math.min(lim, wrapPi(want - p.yaw)));
    p.footYawL += rel * g * 0.6; p.footYawR += rel * g * 0.6;
    if (!walking) { p.legYawL += rel * g * 0.4; p.legYawR += rel * g * 0.4; }
    p.turn += rel * g * turnK;
  }

  /** 清掉过期的凝视记录（每 2 s 一次；记录只在人第一次进入 3 m 时写入）。 */
  private pruneGazeMemo(t: number): void {
    if (t - this.lastPrune < 2 && t >= this.lastPrune) return;
    this.lastPrune = t;
    for (const [k, tt] of this.gazeMemo) if (t - tt > GAZE_MEMO_TTL || tt > t) this.gazeMemo.delete(k);
    for (const [k, tt] of this.passedAt) if (t - tt > GAZE_MEMO_TTL || tt > t) this.passedAt.delete(k);
  }

  // ——— 路边的人、模仿者、爬行的人 ———
  private decorPass(f: FrameCtx): void {
    const list = this.stage ? this.stage.decor : this.decor;
    const shift = this.stage && this.stage.follow ? f.s - this.stage.s0 : 0;
    const npcMax = this.ctx.quality.npcMax;
    const i0 = lowerBound(list, f.s - shift - f.behind - 60);
    const p = this.person, c = this.crawler;
    const groups = this.stage ? this.stage.groups : this.groups;
    for (let i = i0; i < list.length; i++) {
      const d = list[i] as Decor;
      if (d.s + shift > f.s + f.ahead + 60) break;
      // 路边走路的人按动画时钟走（「安静的一秒」里和腿一起停）
      // 已经过去的段照常计时（段界上不跳回出生点）；还没到的段为 0
      const segT = this.stage ? f.tAnim - silenceClock(this.stage.t0, this.silences)
        : d.seg <= this.segIndex ? f.tAnim - silenceClock(this.segStartAt(d.seg, f.t), this.silences) : 0;
      const sN = d.s + shift + d.speed * Math.max(0, segT);
      if (sN > f.s + f.ahead || sN < f.s - f.behind) continue;
      const floorY = this.floorAt(sN);
      const gi = d.group;
      const gs = this.groupState[gi];
      if (d.kind === 'crawler') {
        c.x = d.x; c.y = floorY; c.z = -sN; c.yaw = d.speed >= 0 ? 0 : Math.PI;
        c.dist = Math.abs(d.speed) * Math.max(0, segT) + d.phase * 3; c.phase = d.phase;
        c.color.setHex(d.look.shirt);
        this.crawlers.add(c);
        continue;
      }
      if (d.kind === 'kneeler') {
        const pool = this.pools.get('kneeler');
        if (!pool) continue;
        const tr = tremble(f.tAnim, i, this.trem);
        this.m.makeRotationFromEuler(_e.set(tr.pitch, d.yaw, tr.roll));
        this.m.setPosition(d.x, floorY, -sN);
        pool.push(this.m, pool.variantIndex('kneel'), 0, KNEELER_CROWD);
        continue;
      }
      if (this.forest.people >= npcMax) continue;
      this.resetPerson(p, d.look);
      p.x = d.x; p.y = floorY; p.z = -sN; p.yaw = d.yaw;
      if (d.pose === 'walk') { walkPose(Math.abs(d.speed) * Math.max(0, segT) + d.phase * 2, this.walk); this.applyWalk(p); }
      else if (d.pose === 'seat') {
        // 椅子（chairBar 原型的 seat 变体）
        const chairs = this.pools.get('chairBar');
        if (chairs) { this.m.makeRotationY(d.yaw); this.m.setPosition(d.x, floorY, -sN); chairs.push(this.m, chairs.variantIndex('seat')); }
        p.hipH = 0.46; p.hipL = p.hipR = 90 * DEG; p.kneeL = p.kneeR = 90 * DEG; p.seated = true;
        p.legYawL = -0.08; p.legYawR = 0.08; p.stance = 0.11;
        const sw = idleSway(f.tAnim, d.phase, this.sway);
        p.kneeL += sw.dx * 3; p.kneeR -= sw.dx * 3;
      } else this.applyIdle(p, f.tAnim, d.phase);
      this.applyGaze(p, -1 - i, sN, f, d.gaze, gi, d.pose === 'walk');
      const kit = groups[gi]?.kit;
      // 人墙（U6）：按组所在的段和当前段的种类决定（梦里的人一律算），坐着的人不算（与别处坐着的人、伸脚的人一样只到腰带）
      p.wall = d.pose !== 'seat' && (kit === 'plaza' || this.wallAt(groups[gi]?.seg ?? -1, f));
      p.upper = d.look.upper || kit === 'plaza' || p.wall;
      p.outdoor = kit !== undefined && OUTDOOR_KITS.has(kit);
      const applaud = (gs && gs.applaud >= 0) || this.globalOp.applaud >= 0;
      if (applaud && p.upper) p.clap = clapClosed(f.tAnim, d.phase) ? 2 : 1;
      this.forest.add(p);
    }
    this.overtake(f);
  }

  /** 4-3：「随后爬行的人从两侧超过你」——从身后两侧爬上来，越过玩家，消失在前方的雾里。 */
  private overtake(f: FrameCtx): void {
    let t0 = this.globalOp.overtake, s0 = this.globalOp.overtakeS;
    for (const g of this.groupState) if (g.overtake >= 0 && g.overtake > t0) { t0 = g.overtake; s0 = g.overtakeS; }
    if (t0 < 0) return;
    const dt = f.t - t0;
    if (dt > OVERTAKE_LIFE) return;
    const c = this.crawler;
    const n = Math.min(this.crawlers.max, OVERTAKE.length);
    for (let i = 0; i < n; i++) {
      const k = OVERTAKE[i] as OvertakeCrawler;
      const sN = s0 - 6 - k.back + k.v * Math.max(0, dt - k.delay);
      if (sN > f.s + f.ahead || sN < f.s - f.behind) continue;
      c.x = k.x; c.y = this.floorAt(sN); c.z = -sN; c.yaw = 0;
      c.dist = k.v * dt + k.phase * 2; c.phase = k.phase;
      c.color.setHex(k.color);
      this.crawlers.add(c);
    }
  }

  private floorAt(s: number): number {
    if (this.stage) return this.stage.segment.floorY(s);
    const ch = this.chapter;
    if (!ch) return 0;
    for (const seg of ch.segments) if (seg.kind === 'run' && s >= seg.s0 && s <= seg.s1) return seg.floorY(s);
    const last = ch.segments[this.segIndex];
    return last ? last.floorY(s) : 0;
  }

  /** 当前所有可见的 InstancedMesh 数（≈ 本系统的 draw call）。 */
  visibleMeshes(): number {
    let n = 0;
    for (const p of this.pools.values()) if (p.pool.mesh.visible) n++;
    for (const m of this.forest.meshes) if (m.visible) n++;
    for (const m of this.crawlers.meshes) if (m.visible) n++;
    return n;
  }

  get time(): number { return this.lastT; }
  /** 设置「减少闪烁」是否打开（ctx.settings 由 Game 持有，设置界面改了立即生效）。 */
  get reducedFlicker(): boolean { return this.ctx?.settings?.reducedFlicker === true; }
  /** 人的动画时钟（「安静的一秒」里不走）。 */
  animClock(t: number): number { return silenceClock(t, this.silences); }
  /** 当前帧线框的全部顶点（测试用）。 */
  hitboxLines(): number[] { return this.hitbox ? this.hitbox.allPositions() : []; }
  /** 内部表的大小（测试用：长时间运行不增长）。 */
  internalSizes(): { gazeMemo: number; gazeEvents: number; knocked: number; asks: number; silences: number; passed: number } {
    return { gazeMemo: this.gazeMemo.size, gazeEvents: this.gazeEvents.length, knocked: this.knocked.size, asks: this.asks.size, silences: this.silences.length, passed: this.passedAt.size };
  }
  get currentSegment(): number { return this.segIndex; }
  get obstacleSpec(): typeof OBSTACLES { return OBSTACLES; }
}

/** 陈默让开后的站位：脚所在车道的中心 fx、脚的里程 fs、让开的方向 side、站位 (x, s)。 */
export interface ChenDest { x: number; s: number; side: 1 | -1; fx: number; fs: number }
/**
 * 陈默让开的距离：横向最多 aside；站在脚后面 back（沿 +s）；身体（含垂着的手臂、重心摆动）半宽 half；离相邻障碍的视觉内沿留 margin。
 */
export const CHEN_STEP = { aside: 0.56, back: 0.3, half: 0.33, margin: 0.02, reach: 0.35 } as const;

/**
 * 陈默让到哪里（§4.1 1-2「他让开了，一只脚还留在过道里」）。默认让到脚所在车道的一侧 0.56 m；
 * 那一侧在他站的位置（s ± reach）有障碍时，只让到障碍视觉内沿（碰撞盒 − 5 cm）再留 2 cm 以内，不钻进储物柜里。
 * 两侧都有障碍（1-2 的储物柜夹出中道）时取空间更大的一侧，默认一侧优先。
 */
export function chenStepAside(o: CompiledObstacle, foot: CompiledObstacle | null, list: readonly CompiledObstacle[], st: ObstacleState): ChenDest {
  const cx = (o.lanes.reduce<number>((acc, l) => acc + l, 0) / Math.max(1, o.lanes.length)) * LANE_WIDTH;
  const fx = foot ? (foot.lanes[0] ?? 0) * LANE_WIDTH : cx;
  const fs = foot ? (foot.s0 + foot.s1) / 2 : (o.s0 + o.s1) / 2 + 2;
  const s = fs + CHEN_STEP.back;
  const pref: 1 | -1 = foot ? ((foot.lanes[0] ?? 0) > 0 ? -1 : 1) : cx > 0 ? -1 : 1;
  const room = (side: 1 | -1): number => {
    let lim: number = CHEN_STEP.aside;
    for (const q of list) {
      if (q.id === o.id || (foot && q.id === foot.id) || q.cls === 'soft' || q.cls === 'pickup') continue;
      if (q.s1 < s - CHEN_STEP.reach || q.s0 > s + CHEN_STEP.reach) continue;
      obstacleState(q, 0, Number.POSITIVE_INFINITY, st);
      const pad = MAX_EXPAND + CHEN_STEP.margin + CHEN_STEP.half;
      if (side > 0 && st.x0 > fx) lim = Math.min(lim, st.x0 - pad - fx);
      if (side < 0 && st.x1 < fx) lim = Math.min(lim, fx - st.x1 - pad);
    }
    return Math.max(0, lim);
  };
  const r0 = room(pref), r1 = room(pref === 1 ? -1 : 1);
  const side: 1 | -1 = r0 >= CHEN_STEP.aside || r0 >= r1 ? pref : (pref === 1 ? -1 : 1);
  return { x: fx + side * (side === pref ? r0 : r1), s, side, fx, fs };
}

/** 周主任（暖色的烟头）只允许出现在第三章和调试舞台（附录 A-9）。 */
export function zhouAllowed(chapterId: string): boolean { return chapterId === 'ch3' || chapterId === 'stage'; }

/** 4-3 超过你的爬行者：读章前一次算好（位置、速度、延迟、颜色）。 */
interface OvertakeCrawler { x: number; v: number; back: number; delay: number; phase: number; color: number }
const OVERTAKE: OvertakeCrawler[] = (() => {
  const rng = createRng(4301, 'overtake');
  const out: OvertakeCrawler[] = [];
  for (let i = 0; i < 40; i++) {
    out.push({ x: (i % 2 ? 1 : -1) * rng.range(1.4, 3.2), v: rng.range(2.2, 3.6), back: rng.range(0, 14), delay: rng.range(0, 1.5), phase: rng.next(), color: rng.pick([0x9aa3a6, 0xb7bdbb, 0x8a9396]) });
  }
  return out;
})();

interface FrameCtx {
  s: number; px: number; t: number; tAnim: number; beat: number; tSeg: number; speed: number; bps: number; ahead: number; behind: number; hush: number;
  /** 身后看得见的程度（0..1）：回头或镜头转向身后时越过的障碍照常画。 */
  reveal: number;
  /** 当前的站立段下标（不在站立段 = −1）：只有这时它要显示的组（前一个跑段的组）画上身。 */
  standSeg: number;
}

/** 人群段（crowd: true，2-2、5-6）：绊倒触发「安静的一秒」的那几段，两侧车道的人墙在这里。 */
export function isCrowdSegment(seg: Pick<CompiledSegment, 'kind' | 'def'>): boolean {
  return seg.kind === 'run' && (seg.def as RunSegmentDef).crowd === true;
}

/**
 * 人墙段（U6）：人群段（2-2、5-6）。这些段里站着的人（路边的组和人腿障碍）每个画质都画上身和没有五官的头，
 * 从出现到消失都一样：不按离玩家的远近（r1 在近处 6–7.5 m 内从腰里长出来，像是冲着你来的）。
 */
export function isWallSegment(segments: ReadonlyArray<Pick<CompiledSegment, 'kind' | 'def'>>, i: number): boolean {
  const seg = segments[i];
  return !!seg && isCrowdSegment(seg);
}

/**
 * 显示第 i 段的组的站立段（U6）：站立段只显示紧挨着的前一个跑段的组（§10.2），所以 4-2 → 4-3、5-7 → 5-8；没有 = −1。
 * 这一段里站着的人只在那个站立段进行时画上身（§5.4「世界突然『正常』了」、§5.7「躯干和头只在站立段……显示」）；
 * 爬行经过时只到腰带（5-7 是「排队同学的腿」）。审查 r2：以前整段都画，站立段就没有什么可「突然正常」的了。
 * 5-8 第一帧的镜头还在追尾的位置，画面里的人在这一帧长出上身：界面在 5-7 → 5-8 用黑场切盖住（ui/hud/overlays.ts 的 segmentCut，修复轮 B3 r2）。
 */
export function standRevealOf(segments: ReadonlyArray<Pick<CompiledSegment, 'kind'>>, i: number): number {
  return segments[i]?.kind === 'run' && segments[i + 1]?.kind === 'stand' ? i + 1 : -1;
}

/** 人墙的组：组所在的段是人墙段（一直画上身）。 */
export function isWallGroup(g: Pick<GroupInfo, 'seg'>, segments: ReadonlyArray<Pick<CompiledSegment, 'kind' | 'def'>>): boolean {
  return isWallSegment(segments, g.seg);
}

/** 站立段要显示的组：组所在的段紧挨着一个站立段（只在那个站立段进行时画上身）。 */
export function isStandGroup(g: Pick<GroupInfo, 'seg'>, segments: ReadonlyArray<Pick<CompiledSegment, 'kind'>>): boolean {
  return standRevealOf(segments, g.seg) >= 0;
}

/**
 * 镜头转向身后的程度（0..1）：按镜头的水平朝向，偏航 32° 以内为 0，80° 以上为 1（turnBack 机位、回头）。
 * 读的是上一帧渲染时的 matrixWorld（CameraRig 在本系统之后更新），差一帧没有关系。
 */
export function cameraBackness(cam: THREE.Camera | null | undefined): number {
  if (!cam) return 0;
  const e = cam.matrixWorld.elements;
  const fx = -(e[8] as number), fz = -(e[10] as number);
  const h = Math.hypot(fx, fz);
  if (h < 1e-6) return 0;
  const cosYaw = -fz / h;                              // 朝前（−z）= 1
  return 1 - smoothstep(0.17, 0.85, cosYaw);
}

const _e = new THREE.Euler();
