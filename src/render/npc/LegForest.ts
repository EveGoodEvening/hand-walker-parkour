// src/render/npc/LegForest.ts —— 腿的森林：实例化的人（DESIGN.md §5.7、§9.4）。
// 「椅子腿、人腿、桌腿，从四面八方围过来。我从这些柱子下面穿过，视线里只有膝盖和腰带。」
// 部件各一个 InstancedMesh，颜色走 instanceColor（衣服着色，鞋底 / 手 / 头发不着色）：
//   高画质：鞋、小腿、大腿、髋、躯干、头 = 6 次 draw call；中画质：鞋、小腿、大腿、髋、上身（躯干 + 头合并）= 5；
//   低画质：feet（鞋 + 合并的腿）、hipsLow（常见的几种髋）、special（周主任、班长、陈默）= 最多 3，不画躯干和头。
// 每个实例都要处理整个几何体的全部顶点（不属于它的变体收拢成退化三角形），renderer.info 也按全量计数。
// 低画质的 NPC 三角形预算只有 8k（§9.4），所以低画质把少见的特殊人物（夹克、作业本、陈默的上身）拆成单独的小几何体，
// 只在他们出现时才有实例；常见的人只付 hipsLow 那一点三角形（审查 r2：原来每个实例都带着 8 个变体，24 人 10.3k）。
// NPC 默认只建到腰带；躯干和头只在梦里、站立段显示（Person.upper）。陈默的上身（「全作唯一出现在你视线高度的头」）
// 是髋部件的一个变体（低画质在 special 里），所以低画质下也在。所有人都没有五官。
import * as THREE from 'three';
import type { QualityProfile, ViewContext } from '../../core/contracts';
import { InstPool } from './InstPool';
import { applyNpcPatch, PartBuilder } from './material';
import { C } from './colors';
import { HIPS, LEGV, type HipsVariant, type Look } from './specials';

/** 骨架尺寸（米）。站立时髋关节高 0.905，腰带在 1.03–1.07。 */
export const BODY = { thigh: 0.43, shin: 0.4, ankle: 0.075, stance: 0.115, belt: 0.14 } as const;
export const STAND_HIP = BODY.thigh + BODY.shin + BODY.ankle;

/** 每帧交给 LegForest 的一个人的姿势（复用同一个对象，不分配）。角度单位：弧度。 */
export interface Person {
  x: number; y: number; z: number;
  /** 朝向：0 = 面朝 +z（朝玩家 / 镜头）。 */
  yaw: number;
  hipH: number; stance: number;
  /** 髋角（大腿向前为正）、膝角（小腿向后屈为正）、腿绕竖轴的外展 / 转向、鞋尖额外转角。 */
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  legYawL: number; legYawR: number; footYawL: number; footYawR: number;
  /** 上身前倾（绕 x）、髋部侧倾（绕 z）、横向摆动、上下起伏、髋和上身绕竖轴的转向（凝视时跟着鞋尖转一点）。 */
  lean: number; roll: number; dx: number; bob: number; turn: number;
  look: Look;
  /** 是否画躯干和头（梦里、站立段）。 */
  upper: boolean;
  /** 鼓掌：0 不鼓掌，1 张开，2 合上。 */
  clap: 0 | 1 | 2;
  /** 自发光（烟头）。 */
  glow: number;
  /** 左腿伸直指向一个世界坐标的脚踝位置（陈默留在过道里的脚）；null = 正常姿势。 */
  targetL: THREE.Vector3 | null;
  /** 低画质的腿变体提示：'auto' 按角度选。 */
  seated: boolean; squat: boolean;
  /** 垂在身侧的前臂（障碍里的人；髋部件多一个实例，不增加 draw call）。 */
  arms: boolean;
}

export function newPerson(look: Look): Person {
  return {
    x: 0, y: 0, z: 0, yaw: 0, hipH: STAND_HIP, stance: BODY.stance,
    hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, legYawL: 0, legYawR: 0, footYawL: 0, footYawR: 0,
    lean: 0, roll: 0, dx: 0, bob: 0, turn: 0, look, upper: false, clap: 0, glow: 0, targetL: null, seated: false, squat: false, arms: false,
  };
}

// ——— 部件几何体 ———
// 三角形很省：每个实例都要处理几何体里全部变体的顶点（不属于它的收拢成退化三角形），renderer.info 也按全量计数。
// 所以部件尽量用单个盒子，变体只放必须不同的形状。
const W = 0xffffff, G1 = 0xdadada;

/**
 * 盒子：四个竖直面（±x、±z）都写 aChalk，上下两面不写。暗场里腿的剪影有一层很淡的粉笔光（R12），
 * 而且与朝向无关：背对、侧身的人朝镜头的那一面同样有粉笔。
 */
export const LEG_CHALK = 0.5;
function chalkBox(b: PartBuilder, c: [number, number, number], size: [number, number, number], hex: number, chalk: number, colors: Partial<Record<string, number>> = {}): void {
  b.with({ chalk: 0 }, () => b.box(c, size, hex, { faces: '+y-y', colors }));
  b.with({ chalk }, () => b.box(c, size, hex, { faces: '+x-x+z-z', colors }));
}

/**
 * 鞋：鞋面着色（instanceColor），浅色鞋底不着色。脚踝在原点，鞋尖朝 +z。
 * 鞋面的底面藏在鞋底里、鞋底的底面贴地（镜头永远在地面以上），都不画。
 */
function shoe(b: PartBuilder): void {
  b.with({ tint: 1 }, () => {
    b.with({ chalk: 0 }, () => b.box([0, -0.032, 0.055], [0.1, 0.066, 0.25], W, { faces: '+y', colors: { '+y': G1 } }));
    b.with({ chalk: LEG_CHALK }, () => b.box([0, -0.032, 0.055], [0.1, 0.066, 0.25], W, { faces: '+x-x+z-z' }));
  });
  b.box([0, -0.068, 0.055], [0.106, 0.014, 0.262], C.sole, { faces: '+x-x+z-z' });
}

function shoeGeo(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.variant(0, () => shoe(b));
  return b.build();
}

/** 小腿 / 大腿：关节在原点，向下 len。变体 0 普通裤腿，1 两侧白条（运动裤），2 光腿 / 丝袜（裙装，更细）。 */
function legSegGeo(len: number, w: number, d: number): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.variant(0, () => b.with({ tint: 1 }, () => chalkBox(b, [0, -len / 2, 0], [w, len, d], W, LEG_CHALK, { '-z': G1 })));
  b.variant(1, () => {
    b.with({ tint: 1 }, () => chalkBox(b, [0, -len / 2, 0], [w, len, d], W, LEG_CHALK, { '-z': G1 }));
    for (const s of [-1, 1]) b.box([s * (w / 2 + 0.002), -len / 2, 0], [0.004, len, 0.018], C.uniformStripe, { faces: s > 0 ? '+x' : '-x' });
  });
  b.variant(2, () => b.with({ tint: 1 }, () => chalkBox(b, [0, -len / 2, 0], [w * 0.72, len, d * 0.72], W, LEG_CHALK)));
  return b.build();
}

/** 低画质 feet 几何体的变体：鞋、合并的腿。 */
export const FEET = { shoe: 0, leg: 1 } as const;

/**
 * 低画质：鞋 + 合并的腿（小腿 + 大腿合成一根，从髋关节伸向脚踝，按正向运动学算出脚踝后指过去）共用一个几何体，
 * 省下一次 draw call 给 special。腿的上端藏在胯里、下端在脚踝（镜头在脚踝以上），上下两面不画。
 */
function feetGeo(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const L = BODY.thigh + BODY.shin;
  b.variant(FEET.shoe, () => shoe(b));
  b.variant(FEET.leg, () => b.with({ tint: 1, chalk: LEG_CHALK }, () => b.box([0, -L / 2, 0], [0.135, L, 0.14], W, { faces: '+x-x+z-z', colors: { '-z': G1 } })));
  return b.build();
}

/** 垂在身侧的两只手（短袖：前臂和手都是皮肤色，一个盒子）。 */
function arms(b: PartBuilder, skip?: 1 | -1): void {
  for (const s of [-1, 1]) if (skip !== s) b.box([s * 0.235, -0.04, 0.02], [0.062, 0.3, 0.07], C.skin, { colors: { '+y': G1 } });
}

/**
 * 障碍里的人垂在身侧的前臂（袖子着色 + 手）：外沿在 |x| = ARM.x + ARM.w / 2 ≈ 0.28，手垂到离地约 0.72 m。
 * 人腿障碍的碰撞盒半宽 0.26，人的腿和髋只有 ±0.2；手臂让剪影的外沿落在碰撞盒 ±5 cm 内（WP6 验收 4）。
 * 只给障碍里的人加（髋部件的一个额外实例），路边的人不加：走廊里路边那一条只有 0.48 m 宽，加了手臂会穿墙。
 */
export const ARM = { x: 0.247, w: 0.064, top: 0.115, wrist: -0.1, hand: -0.185 } as const;
function hangingArms(b: PartBuilder): void {
  for (const s of [-1, 1]) {
    b.with({ tint: 1 }, () => chalkBox(b, [s * ARM.x, (ARM.top + ARM.wrist) / 2, 0], [ARM.w, ARM.top - ARM.wrist, 0.082], W, LEG_CHALK, { '+y': G1 }));
    b.with({ chalk: LEG_CHALK }, () => b.box([s * ARM.x, (ARM.wrist + ARM.hand) / 2, 0.004], [ARM.w - 0.008, ARM.wrist - ARM.hand, 0.07], C.skin, { faces: '+x-x+z-z-y' }));
  }
}

/** 胯部：下沿在髋关节下 5 cm（离地 0.855 m，高于玩家碰撞盒的最高 0.85 m），大腿的上端从下面插进来。腰带的底面藏在胯里，不画。 */
function pelvis(b: PartBuilder): void {
  b.with({ tint: 1 }, () => b.box([0, 0.03, 0], [0.4, 0.16, 0.23], W, { colors: { '+y': G1 }, faces: '+x-x+z-z-y' }));
  b.box([0, 0.125, 0], [0.41, 0.04, 0.238], C.hair, { faces: '+x-x+z-z+y' });
}

function headAt(b: PartBuilder, y: number, long = false): void {
  // 头：前面是空白的皮肤（没有五官），顶上和后面是头发
  b.box([0, y + 0.15, 0.01], [0.17, 0.24, 0.18], C.skin, { colors: { '+y': C.hair, '-z': C.hair } });
  b.box([0, y + (long ? 0.14 : 0.22), -0.075], [0.18, long ? 0.26 : 0.12, 0.05], C.hair, { faces: '+x-x-z+y+z' });
}

/** 陈默的上身：躯干高度、脖子（头底）高度（相对髋关节）。 */
export const CHEN_UPPER = { torso: 0.42, neck: 0.56 } as const;

/** 髋部件的一个变体（HIPS 编号）。 */
function hipsPart(b: PartBuilder, id: HipsVariant): void {
  switch (id) {
    case HIPS.trousers: case HIPS.noHands:
      // 普通人只到腰带：「视线里只有膝盖和腰带」
      pelvis(b); break;
    case HIPS.skirt:
      b.with({ tint: 1 }, () => b.box([0, -0.13, 0], [0.44, 0.52, 0.28], W, { colors: { '+y': G1 } }));
      b.box([0, 0.125, 0], [0.41, 0.035, 0.238], C.hair, { faces: '+x-x+z-z+y' });
      break;
    case HIPS.jacket:
      // 周主任：灰夹克下摆到大腿中部；右手在身侧夹着烟，烟头一明一灭（glow）
      b.with({ tint: 1 }, () => b.box([0, -0.02, 0], [0.44, 0.46, 0.27], W, { colors: { '+y': G1 } }));
      // 夹烟的手抬在腰带高度（离地 0.86 m 以上），烟头不伸出碰撞盒正面 5 cm 以外
      arms(b, 1);
      b.segment([0.25, 0.1, 0.0], [0.265, -0.05, 0.08], 0.062, 0.062, C.skin);
      b.segment([0.265, -0.045, 0.1], [0.275, -0.03, 0.17], 0.013, 0.013, 0xe4e8e4);
      b.with({ glow: 1 }, () => b.box([0.275, -0.028, 0.178], [0.022, 0.022, 0.022], C.cigarette));
      break;
    case HIPS.books:
      // 班长：双手在身前抱着一摞作业本（只看得见本子的下沿）
      pelvis(b);
      for (const s of [-1, 1]) b.segment([s * 0.21, 0.1, 0.02], [s * 0.14, 0.02, 0.2], 0.06, 0.06, C.skin);
      b.box([0, 0.05, 0.22], [0.46, 0.1, 0.3], 0xd9dee3, { colors: { '+z': 0x9fb2c0, '-y': 0x9fb2c0 } });
      break;
    case HIPS.fullUpper:
      // 陈默：完整的上身（校服、没有五官的头）。躯干比普通人短一点（蹲着时头顶正好在碰撞盒上沿，头和镜头一样高）
      pelvis(b);
      b.box([0, CHEN_UPPER.torso / 2 + 0.14, 0], [0.4, CHEN_UPPER.torso, 0.22], C.uniform, { colors: { '+y': 0x2b4466 } });
      for (const s of [-1, 1]) b.segment([s * 0.24, CHEN_UPPER.neck - 0.04, 0], [s * 0.26, 0.08, 0.05], 0.08, 0.08, C.uniform);
      for (const s of [-1, 1]) b.box([s * 0.26, 0.03, 0.06], [0.05, 0.1, 0.08], C.skin);
      headAt(b, CHEN_UPPER.neck);
      break;
    case HIPS.trackPants:
      pelvis(b);
      for (const s of [-1, 1]) b.box([s * 0.202, 0.0, 0], [0.004, 0.18, 0.03], C.uniformStripe, { faces: s > 0 ? '+x' : '-x' });
      break;
    case HIPS.arms:
      hangingArms(b); break;
  }
}

/** 中、高画质：一个几何体放全部变体，变体号 = HIPS 编号（noHands 与 trousers 相同，不再单独建）。 */
function hipsGeo(): THREE.BufferGeometry {
  const b = new PartBuilder();
  for (const id of Object.values(HIPS)) if (id !== HIPS.noHands) b.variant(id, () => hipsPart(b, id));
  return b.build();
}

/** 低画质的常见髋部（hipsLow 的变体按这个顺序编号）。 */
export const HIPS_LOW: readonly HipsVariant[] = [HIPS.trousers, HIPS.skirt, HIPS.trackPants, HIPS.arms];
/** 低画质的特殊人物（special 的变体按这个顺序编号）：周主任、班长、陈默。 */
export const HIPS_SPECIAL: readonly HipsVariant[] = [HIPS.jacket, HIPS.books, HIPS.fullUpper];

function listGeo(ids: readonly HipsVariant[]): THREE.BufferGeometry {
  const b = new PartBuilder();
  ids.forEach((id, i) => b.variant(i, () => hipsPart(b, id)));
  return b.build();
}

/** 低画质：HIPS 编号 → [是否在 special 里, 变体号]。 */
const LOW_SLOT: Array<readonly [boolean, number]> = [];
for (const id of Object.values(HIPS)) {
  const k = id === HIPS.noHands ? HIPS.trousers : id;
  const i = HIPS_SPECIAL.indexOf(k);
  LOW_SLOT[id] = i >= 0 ? [true, i] as const : [false, Math.max(0, HIPS_LOW.indexOf(k))] as const;
}
const LOW_ARMS = HIPS_LOW.indexOf(HIPS.arms);

function torsoGeo(withHead: boolean): THREE.BufferGeometry {
  const b = new PartBuilder();
  for (const clap of [0, 1, 2] as const) {
    b.variant(clap, () => {
      b.with({ tint: 1 }, () => b.box([0, 0.4, 0], [0.4, 0.52, 0.22], W, { colors: { '+y': G1 } }));
      for (const s of [-1, 1]) {
        if (clap === 0) {
          b.with({ tint: 1 }, () => b.segment([s * 0.235, 0.63, 0], [s * 0.25, 0.14, 0.03], 0.08, 0.08, G1));
        } else {
          // 鼓掌：前臂举到胸前，1 = 张开，2 = 合上（「两臂在胸前开合」）
          const hx = clap === 1 ? 0.13 : 0.035;
          b.with({ tint: 1 }, () => b.segment([s * 0.235, 0.63, 0], [s * hx, 0.5, 0.28], 0.08, 0.08, G1));
          b.box([s * hx, 0.52, 0.3], [0.045, 0.1, 0.09], C.skin);
        }
      }
      if (withHead) headAt(b, 0.66);
    });
  }
  return b.build();
}

function headGeo(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.variant(0, () => headAt(b, 0.66));
  b.variant(1, () => headAt(b, 0.66, true));
  return b.build();
}

export type PartId = 'shoe' | 'shin' | 'thigh' | 'hips' | 'torso' | 'head' | 'upper' | 'feet' | 'hipsLow' | 'special';
/** 左右两侧（热路径里不每帧新建数组）。 */
const SIDES = [-1, 1] as const;

const _root = new THREE.Matrix4(), _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _b = new THREE.Matrix4();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color(), _col2 = new THREE.Color(), _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const TIGHTS = 0x2a3136;

export class LegForest {
  readonly group = new THREE.Group();
  private parts = new Map<PartId, InstPool>();
  /** 各部件（init 之后；热路径里不查 Map）。 */
  private p!: Record<PartId, InstPool>;
  private tier: QualityProfile['tier'] = 'low';
  /** 本帧画了多少人（不含被容量截掉的）。 */
  people = 0;
  private hadTarget = false;
  private readonly targetSeen = new THREE.Vector3();
  /** 本帧是否画过伸向目标的腿（陈默的脚）；有则把脚踝位置写进 out（测试用）。 */
  lastTargetL(out: THREE.Vector3): boolean { if (this.hadTarget) out.copy(this.targetSeen); return this.hadTarget; }

  constructor() { this.group.name = 'legForest'; }

  init(ctx: ViewContext, cap = 160): void {
    const mat = () => applyNpcPatch(ctx.mat.lambert({ vertexColors: true, flat: true }), true);
    const add = (id: PartId, geo: THREE.BufferGeometry, n: number) => {
      ctx.mat.ensureChalkAttr(geo);
      const p = new InstPool(`npc:${id}`, geo, mat(), n, { color: true });
      this.parts.set(id, p);
      this.group.add(p.mesh);
    };
    add('shoe', shoeGeo(), cap * 2);
    add('shin', legSegGeo(BODY.shin, 0.115, 0.12), cap * 2);
    add('thigh', legSegGeo(BODY.thigh, 0.15, 0.16), cap * 2);
    add('hips', hipsGeo(), cap);
    add('torso', torsoGeo(false), cap);
    add('head', headGeo(), cap);
    add('upper', torsoGeo(true), cap);
    add('feet', feetGeo(), cap * 4);
    add('hipsLow', listGeo(HIPS_LOW), cap);
    add('special', listGeo(HIPS_SPECIAL), 16);
    this.p = {
      shoe: this.pool('shoe'), shin: this.pool('shin'), thigh: this.pool('thigh'), hips: this.pool('hips'), torso: this.pool('torso'),
      head: this.pool('head'), upper: this.pool('upper'), feet: this.pool('feet'), hipsLow: this.pool('hipsLow'), special: this.pool('special'),
    };
    ctx.scene.add(this.group);
    this.setQuality(ctx.quality);
  }

  setQuality(q: QualityProfile): void { this.tier = q.tier; }

  /** 各部件（测试与 perf 用）。 */
  pool(id: PartId): InstPool { return this.parts.get(id) as InstPool; }
  /** 全部部件的实例池（越过的障碍缩小消失时用）。 */
  instPools(): InstPool[] { return Array.from(this.parts.values()); }
  get meshes(): THREE.InstancedMesh[] { return Array.from(this.parts.values(), (p) => p.mesh); }

  begin(): void { this.people = 0; this.hadTarget = false; for (const p of this.parts.values()) p.begin(); }
  end(): void { for (const p of this.parts.values()) p.end(); }

  /** 画一个人。 */
  add(p: Person): void {
    this.people++;
    const P = this.p;
    const low = this.tier === 'low';
    _q.setFromAxisAngle(_v.set(0, 1, 0), p.yaw);
    _root.compose(_w.set(p.x, p.y, p.z), _q, _one);
    const look = p.look;
    _col.setHex(look.legs === LEGV.bare ? TIGHTS : look.pants);
    _col2.setHex(look.shoes);
    const legV = low ? 0 : look.legs;
    for (const s of SIDES) {
      const hip = s < 0 ? p.hipL : p.hipR, knee = s < 0 ? p.kneeL : p.kneeR;
      const legYaw = s < 0 ? p.legYawL : p.legYawR, footYaw = s < 0 ? p.footYawL : p.footYawR;
      // 髋关节（世界坐标）
      _a.makeTranslation(p.dx + s * p.stance, p.hipH + p.bob, 0).premultiply(_root);
      const target = s < 0 ? p.targetL : null;
      if (target) {
        _v.copy(target);
        this.hadTarget = true; this.targetSeen.copy(target);
      } else {
        // 正向运动学：大腿（髋角）→ 小腿（膝角）→ 脚踝
        _a.multiply(_b.makeRotationY(legYaw));
        _m.copy(_a).multiply(_b.makeRotationX(-hip));
        if (!low) P.thigh.push(_m, legV, 0, _col);
        _m.multiply(_b.makeTranslation(0, -BODY.thigh, 0)).multiply(_b.makeRotationX(knee));
        if (!low) P.shin.push(_m, legV, 0, _col);
        _v.set(0, -BODY.shin, 0).applyMatrix4(_m);
      }
      if (target || low) {
        // 一根直腿从髋关节指向脚踝（低画质的合并腿；或陈默伸进过道的那条腿）
        _w.setFromMatrixPosition(_a);
        _d.copy(_v).sub(_w);
        const len = _d.length();
        _q.setFromUnitVectors(DOWN, _d.normalize());
        const k = Math.min(1.25, Math.max(0.3, len / (BODY.thigh + BODY.shin)));
        _m.compose(_w, _q, _one).multiply(_b.makeScale(1, k, 1));
        if (low) P.feet.push(_m, FEET.leg, 0, _col);
        else {
          P.thigh.push(_m, legV, 0, _col);
          _m.multiply(_b.makeTranslation(0, -BODY.thigh, 0));
          P.shin.push(_m, legV, 0, _col);
        }
      }
      // 鞋：放平，只转向（鞋尖 = 凝视）
      _q.setFromAxisAngle(_w.set(0, 1, 0), p.yaw + legYaw + footYaw);
      _m.compose(_v, _q, _one);
      if (low) P.feet.push(_m, FEET.shoe, 0, _col2);
      else P.shoe.push(_m, 0, 0, _col2);
    }
    // 髋（以及陈默的上身、周主任的烟头、班长的作业本）
    _a.makeTranslation(p.dx, p.hipH + p.bob, 0).premultiply(_root);
    if (p.turn !== 0) _a.multiply(_b.makeRotationY(p.turn));
    _a.multiply(_b.makeRotationZ(p.roll)).multiply(_m.makeRotationX(p.lean));
    const upperOn = p.upper && !low;
    const hipsHex = look.hips === HIPS.jacket || look.legs === LEGV.bare ? look.shirt : look.pants;
    // 鼓掌时前臂举在胸前（躯干部件），不再垂在身侧
    const armsOn = p.arms && !(upperOn && p.clap > 0);
    if (low) {
      const [sp, v] = LOW_SLOT[look.hips] ?? [false, 0];
      (sp ? P.special : P.hipsLow).push(_a, v, p.glow, _col.setHex(hipsHex));
      if (armsOn) P.hipsLow.push(_a, LOW_ARMS, 0, _col.setHex(look.shirt));
      return;
    }
    P.hips.push(_a, look.hips === HIPS.noHands ? HIPS.trousers : look.hips, p.glow, _col.setHex(hipsHex));
    if (armsOn) P.hips.push(_a, HIPS.arms, 0, _col.setHex(look.shirt));
    if (upperOn && look.hips !== HIPS.fullUpper) {
      _col.setHex(look.shirt);
      if (this.tier === 'high') {
        P.torso.push(_a, p.clap, 0, _col);
        P.head.push(_a, look.hair, 0, _col);
      } else P.upper.push(_a, p.clap, 0, _col);
    }
  }

  /** 本帧画出来的 NPC 三角形（按 renderer.info 的算法：几何体全部三角形 × 实例数；§9.4 低画质 ≤ 8k）。 */
  triangles(): number {
    let n = 0;
    for (const p of this.parts.values()) if (p.n > 0) n += (p.mesh.geometry.getAttribute('position').count / 3) * p.n;
    return n;
  }

  /** 鞋的实例（测试用：低画质下鞋和腿在同一个 feet 部件里）。 */
  shoes(): { pool: InstPool; variant: number } { return this.tier === 'low' ? { pool: this.p.feet, variant: FEET.shoe } : { pool: this.p.shoe, variant: 0 }; }
  /** 髋部件（测试用：低画质下普通人在 hipsLow 里、特殊人物在 special 里）。 */
  hipsPools(): InstPool[] { return this.tier === 'low' ? [this.p.hipsLow, this.p.special] : [this.p.hips]; }

  /** 各部件本帧的实例数（测试用）。 */
  counts(): Record<PartId, number> {
    const o = {} as Record<PartId, number>;
    for (const [k, p] of this.parts) o[k] = p.n;
    return o;
  }

  clear(): void { this.begin(); this.end(); }
}
