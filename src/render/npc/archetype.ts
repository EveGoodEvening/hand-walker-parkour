// src/render/npc/archetype.ts —— 障碍原型的定义框架与对象池（DESIGN.md §2.5 剪影语言、§8.4 ArchetypeFactory、§8.5 obstacles.ts）。
//
// 每个原型（ArchetypeId）= 1 个 InstancedMesh。原型里每种障碍（ObstacleKind）是一个「变体」，按碰撞盒的真实尺寸建模：
//   原点在碰撞盒底面中心；x ∈ [−halfW, halfW]；z ∈ [−depth/2, +depth/2]，+z 是近端（s0 一侧，朝向玩家）。
//   视觉 ≈ 碰撞 ÷ 0.85（§8.5），但每个面最多外扩 5 cm（WP6 验收 4：线框与模型边缘偏差 ≤ 5 cm）。见 dimsOf()。
// 实例矩阵只做平移、旋转（碰倒、开门）和按实际长度的缩放；超长（len 覆盖）或跨多车道的障碍拆成多个实例平铺，
// 例如 14 拍长的储物柜 = 一排柜子，而不是一个被拉长的柜子。
//
// 剪影语言（§2.5）：low 扁宽 + 顶边一道粉笔白；bar 横杆 + 下面一道深缝（地上一条暗带）+ 杆底一条细白线；
// block 竖直的高剪影 + 竖棱描边；soft 反光；pickup 米白。粉笔线同时写 aChalk = 1（暗场由 LampField 点亮，R12）。
// legs（人腿、陈默）由 LegForest、crawler（梦里爬行的人）由 Crawlers 负责（§8.4 注释：legs 由 LegForest 负责；
// crawler 与背景里的爬行者是同一种人，共用同一套实例）。
import * as THREE from 'three';
import type { ArchetypeFactory, ArchetypeId, ArchetypePool, ViewContext } from '../../core/contracts';
import { LANE_WIDTH } from '../../core/constants';
import type { ChapterId, HitSeverity, KitId } from '../../core/types';
import { OBSTACLES, type ObstacleKind } from '../../levels/obstacles';
import type { CompiledObstacle } from '../../levels/schema';
import { InstPool } from './InstPool';
import { applyNpcPatch, PartBuilder } from './material';
import { obstacleState, type ObstacleState } from './simBridge';

/** 视觉尺寸（米）。ex / ez 是每侧外扩；top / bottom 是视觉上沿 / 下沿。 */
export interface Dims {
  halfW: number; y0: number; y1: number; depth: number;
  /** 视觉半宽 = halfW + ex。 */ vw: number;
  /** 视觉半深 = depth / 2 + ez。 */ vd: number;
  ex: number; ez: number; top: number; bottom: number;
}

/** 每个面最多外扩（米），WP6 验收 4。 */
export const MAX_EXPAND = 0.05;
/** 反光贴花（soft）的整体不透明度（逐顶点不透明度再乘上它）。 */
export const DECAL_OPACITY = 1;

/** 某种障碍的视觉尺寸（按碰撞 ÷ 0.85，每面最多外扩 5 cm）。 */
export function dimsOf(kind: ObstacleKind): Dims {
  const sp = OBSTACLES[kind];
  const k = 1 / 0.85 - 1;
  const ex = Math.min(MAX_EXPAND, sp.halfW * k);
  const ez = Math.min(MAX_EXPAND, (sp.depth * k) / 2);
  const h = sp.y1 - sp.y0;
  let top = sp.y1, bottom = sp.y0;
  if (sp.cls === 'low') top = sp.y1 + Math.min(MAX_EXPAND, sp.y1 * k);
  else if (sp.cls === 'bar') { top = sp.y1 + Math.min(0.04, h * k); bottom = sp.y0 - 0.02; }
  return { halfW: sp.halfW, y0: sp.y0, y1: sp.y1, depth: sp.depth, vw: sp.halfW + ex, vd: sp.depth / 2 + ez, ex, ez, top, bottom };
}

/** 放置时的上下文（ObstacleView 每帧填写，复用同一个对象）。 */
export interface PlaceCtx {
  o: CompiledObstacle;
  st: ObstacleState;
  floorY: number;
  /** 段内时间（秒）与玩家段内拍号；非当前段时为 0 / −1。 */
  tSeg: number; beat: number;
  /** 模拟时钟（秒）。 */
  t: number;
  /** 被碰倒的时刻（模拟时钟），没碰过为 null。 */
  knockedAt: number | null;
  chapter: ChapterId | 'stage';
  kit: KitId;
  /** 玩家横向位置与里程。 */
  playerX: number; playerS: number;
  /** 画面对「让一下」的反应：让开的横移量（米，带符号）。 */
  partX: number;
  /** 当前步频（拍 / 秒），把「秒」换成「拍」用。 */
  bps: number;
  /** 往另一个原型池里放一个附属实例（例如 reach 两侧跪着的人）。 */
  side(id: ArchetypeId, m: THREE.Matrix4, variant: string, glow?: number): void;
}

export interface VariantDef {
  name: string;
  /** 这种障碍默认用这个变体；缺省 = 仅供自定义放置选用。 */
  kind?: ObstacleKind;
  build(b: PartBuilder, d: Dims): void;
}

export interface ArchetypeDef {
  id: ArchetypeId;
  material: 'lambert' | 'decal';
  cap: number;
  variants: VariantDef[];
  /** 超长 / 多车道时是否拆成多个实例平铺（缺省 true）。 */
  tileS?: boolean; tileX?: boolean;
  /** 由其他系统负责（legs → LegForest，crawler → Crawlers）：不建自己的 InstancedMesh。 */
  delegate?: 'forest' | 'crawlers';
  /** 自定义放置（开门、伸脚、红灯……）；返回 false 表示走通用放置。 */
  place?(p: ArchetypePoolImpl, c: PlaceCtx): boolean;
}

export function defineArchetype(d: ArchetypeDef): ArchetypeDef { return d; }

const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

/** 碰倒：绕远端底棱向前倒下（0.3 s）。返回 0..1。 */
export function knockProgress(knockedAt: number | null, t: number): number {
  if (knockedAt === null) return 0;
  const u = Math.min(1, Math.max(0, (t - knockedAt) / 0.3));
  return 1 - (1 - u) * (1 - u);
}

/** 平铺的最多实例数（超长的储物柜、长桌）。 */
export const MAX_TILES = 12;

/** 一个原型的对象池：实现契约 ArchetypePool，外加 begin / end / 扩展放置。 */
export class ArchetypePoolImpl implements ArchetypePool {
  readonly pool: InstPool;
  readonly def: ArchetypeDef;
  readonly geo: THREE.BufferGeometry;
  private readonly byKind = new Map<string, number>();
  private readonly byName = new Map<string, number>();
  /** 本帧第 slot 个 place() 对应的障碍（hit(slot) 用）。 */
  private readonly slots: CompiledObstacle[] = [];
  /** hit(slot) 记录的碰倒（契约接口；ObstacleView 用自己的碰倒表）。 */
  readonly knocks = new Map<number, number>();
  private readonly pc: PlaceCtx;

  constructor(def: ArchetypeDef, mat: THREE.Material, cap: number) {
    this.def = def;
    const b = new PartBuilder();
    const fallbackKind = def.variants.find((x) => x.kind)?.kind ?? 'bag';
    def.variants.forEach((v, i) => {
      const d = dimsOf(v.kind ?? fallbackKind);
      b.variant(i, () => v.build(b, d));
      if (v.kind && !this.byKind.has(v.kind)) this.byKind.set(v.kind, i);
      this.byName.set(v.name, i);
    });
    this.geo = b.build();
    this.pool = new InstPool(`archetype:${def.id}`, this.geo, mat, cap, def.material === 'decal' ? { renderOrder: -15 } : {});
    this.pc = {
      o: null as unknown as CompiledObstacle, st: { active: true, ds: 0, x0: 0, x1: 0, amount: 1 }, floorY: 0, tSeg: 0, beat: -1, t: 0,
      knockedAt: null, chapter: 'ch1', kit: 'placeholder', playerX: 0, playerS: 0, partX: 0, bps: 5, side: () => { /* 独立使用时没有附属实例 */ },
    };
  }

  get object(): THREE.Object3D { return this.pool.mesh; }

  variantIndex(name: string): number { return this.byName.get(name) ?? -1; }
  variantOf(kind: ObstacleKind): number { return this.byKind.get(kind) ?? 0; }
  get variantNames(): string[] { return this.def.variants.map((v) => v.name); }

  begin(): void { this.pool.begin(); this.slots.length = 0; }
  end(): void { this.pool.end(); }

  /** 契约接口：按段内时间 t 放置（非 ObstacleView 的独立用法；测试也用它）。 */
  place(slot: number, o: CompiledObstacle, t: number): void {
    const c = this.pc;
    c.o = o; obstacleState(o, t, Number.POSITIVE_INFINITY, c.st); c.floorY = 0; c.tSeg = t; c.beat = -1; c.t = t;
    c.knockedAt = this.knocks.get(o.id) ?? null; c.partX = 0;
    this.slots[slot] = o;
    this.placeEx(c);
  }
  hit(slot: number, _sev: HitSeverity): void { const o = this.slots[slot]; if (o && o.cls === 'low') this.knocks.set(o.id, this.pc.t); }
  hide(slot: number): void { if (slot < this.slots.length) this.slots.length = slot; }

  /** 扩展放置：ObstacleView 用。 */
  placeEx(c: PlaceCtx): void {
    if (this.def.place && this.def.place(this, c)) return;
    this.placeGeneric(c);
  }

  /**
   * 通用放置：横向覆盖 st.x0..x1，纵向 s0..s1（加上 walk 偏移），按名义尺寸平铺；low 被碰倒时向前倒下。
   */
  placeGeneric(c: PlaceCtx, o: { variant?: number; yaw?: number; glow?: number; lift?: number; tile?: boolean } = {}): void {
    const ob = c.o;
    const sp = OBSTACLES[ob.kind];
    const variant = o.variant ?? this.variantOf(ob.kind);
    const nomW = 2 * sp.halfW, nomD = sp.depth;
    const x0 = c.st.x0 + c.partX, x1 = c.st.x1 + c.partX;
    const s0 = ob.s0 + c.st.ds, s1 = ob.s1 + c.st.ds;
    const W = x1 - x0, D = s1 - s0;
    const tile = o.tile !== false;
    const nx = !tile || this.def.tileX === false || sp.fullWidth ? 1 : Math.max(1, Math.round((W - nomW) / LANE_WIDTH) + 1);
    const ns = !tile || this.def.tileS === false ? 1 : Math.min(MAX_TILES, Math.max(1, Math.round(D / nomD)));
    const tw = W / nx, td = D / ns;
    const kp = sp.cls === 'low' ? knockProgress(c.knockedAt, c.t) : 0;
    for (let ix = 0; ix < nx; ix++) {
      for (let is = 0; is < ns; is++) {
        const cx = x0 + tw * (ix + 0.5);
        const cs = s0 + td * (is + 0.5);
        _p.set(cx, c.floorY + (o.lift ?? 0), -cs);
        _q.setFromEuler(_e.set(0, o.yaw ?? 0, 0));
        _s.set(tw / nomW, 1, td / nomD);
        _m.compose(_p, _q, _s);
        if (kp > 0) {
          // 绕远端（−z）底棱向前倒下 80°，并向前滑一点
          const hd = nomD / 2;
          _t.makeTranslation(0, 0, -hd - 0.15 * kp);
          _r.makeRotationX(-1.4 * kp);
          _m.multiply(_t).multiply(_r).multiply(_t.makeTranslation(0, 0, hd));
        }
        this.pool.push(_m, variant, o.glow ?? 0);
      }
    }
  }

  /** 直接压入一个矩阵（自定义放置用）。 */
  push(m: THREE.Matrix4, variant: number, glow = 0): void { this.pool.push(m, variant, glow); }
}

/** 原型池的材质：Lambert（顶点色 + WP3 的 LampField + 本包补丁）；soft 用反光贴花（Basic、透明、随 LampField 明暗）。 */
export function createArchetypeMaterial(ctx: Pick<ViewContext, 'mat'>, def: ArchetypeDef): THREE.Material {
  if (def.material === 'decal') {
    const m = ctx.mat.basic({ color: 0xffffff, transparent: true, opacity: DECAL_OPACITY, lampLit: true });
    m.vertexColors = true;
    m.transparent = true;
    m.depthWrite = false;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    return applyNpcPatch(m, false);
  }
  return applyNpcPatch(ctx.mat.lambert({ vertexColors: true, flat: true }), true);
}

/** 由定义生成契约里的工厂（registerArchetype 用）。 */
export function factoryOf(def: ArchetypeDef): ArchetypeFactory & { def: ArchetypeDef } {
  return {
    id: def.id, def,
    create: (ctx: ViewContext, capacity: number) => {
      const pool = new ArchetypePoolImpl(def, createArchetypeMaterial(ctx, def), capacity || def.cap);
      ctx.mat.ensureChalkAttr(pool.geo);
      return pool;
    },
  };
}

/** 车道中心 x。 */
export const laneX = (l: number): number => l * LANE_WIDTH;
