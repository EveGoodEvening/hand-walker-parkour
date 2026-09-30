// src/render/npc/ObstacleView.ts —— WP6 的画面系统：障碍原型池、腿的森林、梦里的爬行者、线框（DESIGN.md §5.7、§8.4、§8.7）。
// 画面只插值、不改模拟状态。障碍的运行时状态与碰撞共用 obstacleState（simBridge），所以门、伸出的脚、让开的陈默、
// 移动的人墙在画面上和碰撞完全一致。全部几何体在 init 时建好（容量固定）；读章只展开数据，游戏过程中不创建任何几何体。
//
// 事件（§8.7）：
//   hit    ：low 被碰倒（向前倒下）/ 人腿缩回；附近的鞋尖转向你；人群段里所有人静止 1 s（「安静的一秒」）。
//   ask    ：part → 0.5 s 后横移 0.6 m 让出一条缝；ignore → 不动。两种结果附近的鞋尖都会转过来。
//   note   ：地上那张纸不再画（重来时保留已拾取的状态）。
//   retry / 读章 / 跳转：清掉碰倒、凝视、静止等画面状态。
// cue：crowd（turnShoes / centerShoes / silent / applaud / crawlOvertake / normal），由 index.ts 注册。
import * as THREE from 'three';
import type { ArchetypeId, QualityProfile, ViewContext, ViewSystem } from '../../core/contracts';
import { LANE_WIDTH } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp01, easeInOutSine, lerp } from '../../core/math';
import { createRng } from '../../core/rng';
import type { AABB, ChapterId, CrowdOp, KitId, SimSnapshot } from '../../core/types';
import { urlParams } from '../../core/urlParams';
import { OBSTACLES } from '../../levels/obstacles';
import type { CompiledChapter, CompiledObstacle, CompiledSegment, RunSegmentDef } from '../../levels/schema';
import { ArchetypePoolImpl, createArchetypeMaterial, type ArchetypeDef, type PlaceCtx } from './archetype';
import {
  GAZE_MAX, GAZE_TOTAL, clapClosed, gazeAmount, gazeSince, idleSway, partOffset, shiftBlend, silenceClock, silenceLevel, tremble, walkPose,
  type WalkPose,
} from './behaviors';
import { CRAWL, Crawlers, type Crawler } from './Crawlers';
import { expandChapter, lowerBound, type Decor, type GroupInfo } from './crowds';
import { HitboxDebug } from './hitboxDebug';
import { BODY, LegForest, STAND_HIP, newPerson, type Person } from './LegForest';
import { KNEELER_BOY, KNEELER_CROWD } from './archetypes/kneeler';
import { obstacleState, type ObstacleState } from './simBridge';
import { crowdOfKit, emberGlow, itemIdOf, lookFor, specialLook, specialOfObstacle, type Look, type SpecialId } from './specials';

const DEG = Math.PI / 180;
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
  private segStartT = 0;
  private knocked = new Map<number, number>();
  private taken = new Set<string>();
  private asks = new Map<number, { t: number; part: boolean }>();
  private gazeEvents: GazeEvent[] = [];
  private silences: number[] = [];
  private gazeMemo = new Map<number, number>();
  private decor: Decor[] = [];
  private groups: GroupInfo[] = [];
  private groupState: Array<{ gaze: Decor['gaze'] | null; applaud: number; overtake: number; overtakeS: number }> = [];
  private globalOp: { applaud: number; overtake: number; overtakeS: number } = { applaud: -1, overtake: -1, overtakeS: 0 };
  private chenFoot = new Map<number, CompiledObstacle>();   // chenMo 障碍 id → 他留在过道里的脚
  private chenFootIds = new Set<number>();
  private specials = new Map<number, SpecialId>();
  private looks = new Map<number, Look>();
  stage: Stage | null = null;
  private lastT = 0;
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
  private readonly fctx: FrameCtx = { s: 0, px: 0, t: 0, tAnim: 0, beat: 0, tSeg: 0, speed: 0, bps: 5, ahead: 40, behind: 5, hush: 0, stand: false };
  private readonly fallbackLook: Look = lookFor('student', 1, 'fallback');

  constructor(defs: ArchetypeDef[] = []) {
    this.defs = defs;
    this.pc = {
      o: null as unknown as CompiledObstacle, st: this.st, floorY: 0, tSeg: 0, beat: -1, t: 0, knockedAt: null,
      chapter: 'ch1', kit: 'placeholder', playerX: 0, playerS: 0, partX: 0, bps: 5,
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
    this.decor = decor;
    this.groups = groups;
    this.groupState = groups.map(() => ({ gaze: null, applaud: -1, overtake: -1, overtakeS: 0 }));
    this.specials.clear(); this.looks.clear(); this.chenFoot.clear(); this.chenFootIds.clear();
    for (const seg of ch.segments) this.indexSegment(seg, ch.seed);
    this.resetState();
    this.taken.clear();
  }

  /** 识别特殊 NPC、给人腿障碍定外观、把陈默和他的脚连起来。 */
  private indexSegment(seg: CompiledSegment, seed: number): void {
    if (seg.kind !== 'run') return;
    const def = seg.def as RunSegmentDef;
    const crowd = crowdOfKit(def.kit);
    for (const o of seg.obstacles) {
      const sp = specialOfObstacle(o, def.kit, def.variant);
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
    }
  }

  private resetState(): void {
    this.knocked.clear(); this.asks.clear(); this.gazeEvents = []; this.silences = []; this.gazeMemo.clear();
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
    if (stage) this.indexSegment(stage.segment, 7);
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    const t = snap.t;
    switch (e.type) {
      case 'segment':
        this.segStartT = t; this.segIndex = e.data.index;
        this.globalOp.applaud = -1;
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
      case 'retry': this.resetState(); break;
      default: break;
    }
  }

  onReset(snap: SimSnapshot): void {
    this.resetState();
    const seg = this.chapter?.segments[snap.segIndex];
    this.segIndex = snap.segIndex;
    // 读章或跳到检查点时模拟把 tSeg 设为 seg.timeAt(beat)
    this.segStartT = seg && seg.kind === 'run' ? snap.t - seg.timeAt(snap.segBeat) : snap.t;
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

  /** crowd cue（§8.7，WP6 唯一处理者）。group 为 NpcGroupDef.id；找不到或为 '*' 时作用于全部组。 */
  crowdOp(group: string, op: CrowdOp, snap: SimSnapshot): void {
    const t = snap.t;
    const groups = this.stage ? this.stage.groups : this.groups;
    const states = this.groupState;
    const idx = groups.map((g, i) => (g.key === group || g.def.id === group ? i : -1)).filter((i) => i >= 0);
    const targets = idx.length ? idx : groups.map((_, i) => i);
    const all = idx.length === 0;
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
    const tSeg = t - this.segStartT;
    const speed = Math.max(0, N.speed);
    const bps = next.segKind === 'run' ? Math.max(0.5, N.cadence || speed / Math.max(0.3, N.stride)) : 4.8;
    this.lastT = t;
    const fog = this.ctx.scene.fog as THREE.Fog | null;
    const fogFar = fog && 'far' in fog ? fog.far : 60;
    const ahead = Math.min(this.ctx.quality.chunksAhead * 12 + 6, fogFar + 4);
    const behind = N.lookBack > 0 ? 14 : 5;
    const tAnim = silenceClock(t, this.silences);
    const hush = silenceLevel(t, this.silences);
    const pc = this.pc;
    pc.t = t; pc.playerX = px; pc.playerS = s; pc.bps = bps;
    pc.chapter = this.stage ? 'stage' : (this.chapter?.def.id ?? 'ch1') as ChapterId;
    const ctx = this.fctx;
    ctx.s = s; ctx.px = px; ctx.t = t; ctx.tAnim = tAnim; ctx.beat = beat; ctx.tSeg = tSeg; ctx.speed = speed; ctx.bps = bps;
    ctx.ahead = ahead; ctx.behind = behind; ctx.hush = hush; ctx.stand = next.segKind === 'stand';

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
        const def = seg.def as RunSegmentDef;
        this.obstaclesOf(seg, seg.obstacles, ctx, cur, cur ? tSeg : 0, 0, def.kit, def.variant, cur ? beat : -1);
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
      const st = obstacleState(o, tSeg, cur ? beat : -1, this.st);
      const s0 = o.s0 + st.ds + shift, s1 = o.s1 + st.ds + shift;
      if (s0 > f.s + f.ahead || s1 < f.s - f.behind) continue;
      if (o.cls === 'pickup' && this.taken.has(String(o.params.note ?? ''))) continue;
      st.ds += shift;
      const floorY = seg.floorY(Math.min(Math.max(s0, seg.s0), seg.s1));
      pc.o = o; pc.floorY = floorY; pc.knockedAt = this.knocked.get(o.id) ?? null;
      const ask = this.asks.get(o.id);
      pc.partX = ask && ask.part ? this.partDir(o, st) * partOffset(f.t - ask.t) : 0;
      if (this.hitbox) this.hitbox.obstacle(o, st, floorY, this.box, pc.knockedAt !== null);
      if (this.chenFootIds.has(o.id)) continue;               // 陈默的脚由陈默自己画
      if (o.archetype === 'legs') { this.legsObstacle(o, st, seg, f, cur, kit, variant, floorY); continue; }
      if (o.archetype === 'crawler') { this.crawlerObstacle(o, st, f, tSeg, floorY); continue; }
      const pool = this.pools.get(o.archetype);
      if (!pool) continue;
      if (o.archetype === 'kneeler' && this.kneelerSpecial(pool, o, f)) continue;
      pool.placeEx(pc);
    }
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
      const tr = tremble(f.tAnim, o.id);
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
  private legsObstacle(o: CompiledObstacle, st: ObstacleState, seg: CompiledSegment, f: FrameCtx, cur: boolean, kit: KitId, variant: string, floorY: number): void {
    const look = this.looks.get(o.id) ?? this.fallbackLook;
    const sp = this.specials.get(o.id);
    const p = this.person;
    if (sp === 'chenMo') { this.chenMo(o, st, seg, f, cur, look, floorY); return; }
    const lanes = Math.max(1, Math.round((st.x1 - st.x0 - 2 * o.halfW) / LANE_WIDTH) + 1);
    const w = (st.x1 - st.x0) / lanes;
    const zc = -((o.s0 + o.s1) / 2 + st.ds);
    const b = o.behavior;
    // 人墙移动（shift）：1.2 s 前鞋尖先转过去，碰撞切换时平移
    let shiftTurn = 0, shiftDx = 0;
    if (b.type === 'shift' && cur) {
      const dt = (f.beat - b.atBeat) / f.bps;
      const bl = shiftBlend(dt, 0);
      obstacleState(o, f.tSeg, b.atBeat - 1, this.st2);
      const before = (this.st2.x0 + this.st2.x1) / 2;
      obstacleState(o, f.tSeg, b.atBeat + 1, this.st2);
      const after = (this.st2.x0 + this.st2.x1) / 2;
      const now = (st.x0 + st.x1) / 2;
      shiftDx = lerp(before, after, bl.move) - now;
      shiftTurn = bl.turn * Math.sign(after - before);
    }
    for (let i = 0; i < lanes; i++) {
      const cx = st.x0 + w * (i + 0.5) + shiftDx;
      this.resetPerson(p, look);
      // 让一下：单人往外侧让；多人从中间分开（「前面两个女生分开一条缝」）
      const part = this.pc.partX;
      const mid = (lanes - 1) / 2;
      p.x = cx + (lanes > 1 ? Math.abs(part) * (i < mid ? -1 : i > mid ? 1 : Math.sign(part)) : part);
      p.y = floorY; p.z = zc;
      const r = hash01(o.id * 31 + i * 7);
      if (b.type === 'walk') {
        p.yaw = b.speed > 0 ? Math.PI : 0;
        walkPose(Math.abs(b.speed) * f.tAnim + i * 0.3 + o.id, this.walk);
        this.applyWalk(p);
      } else {
        // 朝向（由 id 决定，不随时间变）：45% 朝玩家，25% 背对，30% 侧身
        const j = (hash01(o.id * 13 + i) - 0.5) * 0.6;
        p.yaw = sp ? 0 : r < 0.45 ? j : r < 0.7 ? Math.PI + j : (hash01(o.id * 17 + i) < 0.5 ? 1 : -1) * Math.PI / 2;
        this.applyIdle(p, f.tAnim, (o.id * 0.137 + i * 0.31) % 1);
      }
      if (shiftTurn !== 0) { const turn = shiftTurn * 70 * DEG; p.footYawL += turn; p.footYawR += turn; p.legYawL += turn * 0.3; p.legYawR += turn * 0.3; }
      this.applyGaze(p, o.id * 8 + i, (o.s0 + o.s1) / 2 + st.ds, f, 'turnShoes', -1);
      p.upper = look.upper || f.stand;
      if (sp === 'directorZhou') p.glow = emberGlow(f.t);
      this.forest.add(p);
    }
    void seg; void variant;
  }

  /** 陈默：蹲在过道里（头与你的视线齐平）→ 到点起身 → 让到一边，一只脚留在过道里（§4.1 1-2）。 */
  private chenMo(o: CompiledObstacle, st: ObstacleState, seg: CompiledSegment, f: FrameCtx, cur: boolean, look: Look, floorY: number): void {
    const p = this.person;
    this.resetPerson(p, look);
    const b = o.behavior;
    const at = b.type === 'yield' ? b.atBeat : Number.POSITIVE_INFINITY;
    const beat = cur ? f.beat : -1;
    // 起身：at − 2 → at − 0.8 拍；让开：at − 0.8 → at + 0.2 拍（画面先于碰撞，§2.5 先看见后碰到）
    const rise = clamp01((beat - (at - 2)) / 1.2);
    const step = clamp01((beat - (at - 0.8)) / 1.0);
    const cx = (o.lanes.reduce<number>((acc, l) => acc + l, 0) / Math.max(1, o.lanes.length)) * LANE_WIDTH;
    const zc = -((o.s0 + o.s1) / 2);
    const foot = this.chenFoot.get(o.id);
    const side = foot ? ((foot.lanes[0] ?? 0) > 0 ? -1 : 1) : cx > 0 ? -1 : 1;
    const fx = foot ? (foot.lanes[0] ?? 0) * LANE_WIDTH : cx;
    const fs = foot ? (foot.s0 + foot.s1) / 2 : (o.s0 + o.s1) / 2 + 2;
    const destX = fx + side * 0.56, destZ = -(fs + 0.3);
    const e = easeInOutSine(step);
    p.x = lerp(cx, destX, e); p.z = lerp(zc - 0.03, destZ, e); p.y = floorY;
    p.yaw = 0;
    const r = easeInOutSine(rise);
    p.hipH = lerp(0.3, STAND_HIP, r);
    p.hipL = p.hipR = lerp(110 * DEG, 0, r);
    p.kneeL = p.kneeR = lerp(145 * DEG, 0, r);
    p.legYawL = -lerp(0.35, 0.04, r); p.legYawR = lerp(0.35, 0.04, r);
    p.lean = lerp(0.45, 0, r);
    p.squat = rise < 0.5; p.seated = false;
    if (foot && step > 0.55) {
      // 留在过道里的脚：左腿伸直指向脚的位置（碰撞盒中心），鞋尖朝过道另一侧
      this.target.set(fx - side * 0.06, floorY + BODY.ankle, -fs);
      if (side > 0) { p.targetL = this.target; p.footYawL = -Math.PI / 2; }
      else { p.targetL = this.target; p.footYawL = Math.PI / 2; }
      p.stance = 0.12;
    }
    p.upper = true;
    if (rise >= 1) this.applyIdle(p, f.tAnim, 0.37);
    this.forest.add(p);
    void st; void seg;
  }

  private resetPerson(p: Person, look: Look): void {
    p.look = look; p.yaw = 0; p.hipH = STAND_HIP; p.stance = BODY.stance;
    p.hipL = p.hipR = p.kneeL = p.kneeR = 0; p.legYawL = p.legYawR = 0; p.footYawL = p.footYawR = 0;
    p.lean = 0; p.roll = 0; p.dx = 0; p.bob = 0; p.turn = 0; p.upper = false; p.clap = 0; p.glow = 0; p.targetL = null; p.seated = false; p.squat = false;
  }

  /** idle：重心左右换（「安静的一秒」里动画时钟 tAnim 不走，所以人就停住了）。 */
  private applyIdle(p: Person, t: number, phase: number): void {
    const s = idleSway(t, phase);
    p.dx = s.dx;
    p.roll = -s.dx * 0.8;
    if (s.side > 0) p.kneeR = s.knee; else p.kneeL = s.knee;
    p.footYawL = -6 * DEG; p.footYawR = 6 * DEG;
  }

  private applyWalk(p: Person): void {
    const w = this.walk;
    p.hipL = w.hipL; p.hipR = w.hipR; p.kneeL = w.kneeL; p.kneeR = w.kneeR; p.bob = w.bob;
  }

  /** 凝视：鞋尖在 0.4 s 内转向玩家，停 0.5 s，再转回（接近触发 / 受击 / 让一下 / crowd turnShoes）；center = 常驻朝走廊中央。 */
  private applyGaze(p: Person, key: number, sN: number, f: FrameCtx, mode: Decor['gaze'], group: number): void {
    const gs = group >= 0 ? this.groupState[group] : undefined;
    const m = gs?.gaze ?? mode;
    if (m === 'center') {
      // 鞋尖（和整个人）朝向走廊中央：x → 0
      const want = p.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      p.yaw = want + (p.yaw - want) * 0.15;
      p.footYawL = p.footYawR = 0;
      return;
    }
    let g = 0;
    const along = sN - f.s, dx = p.x - f.px;
    if (m === 'turnShoes') {
      let tt = this.gazeMemo.get(key);
      if (tt === undefined) {
        const since = gazeSince(along, dx, f.speed);
        if (since >= 0) { tt = f.t - since; this.gazeMemo.set(key, tt); }
      }
      if (tt !== undefined) g = gazeAmount(f.t - tt);
      if (tt !== undefined && along < -8) this.gazeMemo.delete(key);
    }
    for (const ev of this.gazeEvents) {
      if (ev.group >= 0 && ev.group !== group) continue;
      if (ev.group < 0 && Math.hypot(sN - ev.s, p.x - ev.x) > ev.r) continue;
      g = Math.max(g, gazeAmount(f.t - ev.t));
    }
    if (g <= 0) return;
    // 目标方向：从这个人指向玩家（世界坐标：+z = −s）
    const want = Math.atan2(f.px - p.x, -(f.s) - p.z);
    const rel = Math.max(-GAZE_MAX, Math.min(GAZE_MAX, wrapPi(want - p.yaw)));
    p.footYawL += rel * g * 0.6; p.footYawR += rel * g * 0.6;
    p.legYawL += rel * g * 0.4; p.legYawR += rel * g * 0.4;
    p.turn += rel * g * 0.25;
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
      const segT = this.stage ? f.t - this.stage.t0 : d.seg === this.segIndex ? f.tAnim - silenceClock(this.segStartT, this.silences) : 0;
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
        const tr = tremble(f.tAnim, i);
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
        const sw = idleSway(f.tAnim, d.phase);
        p.kneeL += sw.dx * 3; p.kneeR -= sw.dx * 3;
      } else this.applyIdle(p, f.tAnim, d.phase);
      this.applyGaze(p, -1 - i, sN, f, d.gaze, gi);
      const kit = groups[gi]?.kit;
      p.upper = d.look.upper || f.stand || kit === 'plaza';
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
  /** 人的动画时钟（「安静的一秒」里不走）。 */
  animClock(t: number): number { return silenceClock(t, this.silences); }
  /** 当前帧线框的全部顶点（测试用）。 */
  hitboxLines(): number[] { return this.hitbox ? this.hitbox.allPositions() : []; }
  /** 内部表的大小（测试用：长时间运行不增长）。 */
  internalSizes(): { gazeMemo: number; gazeEvents: number; knocked: number; asks: number; silences: number } {
    return { gazeMemo: this.gazeMemo.size, gazeEvents: this.gazeEvents.length, knocked: this.knocked.size, asks: this.asks.size, silences: this.silences.length };
  }
  get currentSegment(): number { return this.segIndex; }
  get obstacleSpec(): typeof OBSTACLES { return OBSTACLES; }
}

/** 确定性的 0..1 散列（热路径里不分配 rng 对象）。 */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

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

interface FrameCtx { s: number; px: number; t: number; tAnim: number; beat: number; tSeg: number; speed: number; bps: number; ahead: number; behind: number; hush: number; stand: boolean }

const _e = new THREE.Euler();
