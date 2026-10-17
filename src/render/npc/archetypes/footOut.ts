// archetypes/footOut.ts —— 伸进过道的脚（low，§3「腿的森林」、D11、附录 A-5）。
// 「有人把腿往过道里伸了伸。不是成心的，只是习惯。」——它早就伸在那里，或者按那个人自己的节律伸缩（stretch），
// 与玩家是否靠近无关；伸出 / 收回的画面只取决于段内时间和数据给的 period / phase（behaviors.stretchVisual）。
//
// 画的是一个完整的人（清晰的腿、弱化的上身轮廓）：他坐在车道外沿的地上，两手撑在身边的地面上，两条腿并排伸直横过车道，
// 鞋跟着地、鞋尖翘起，正好填满碰撞盒的 0.30 深度。腿按腿的森林的骨长（大腿 0.43、小腿 0.40）由髋到脚踝解两骨 IK，
// 膝盖在髋—踝连线上方一点（微屈），不会反折；整条腿在车道上方都不高于碰撞上沿 + 5 cm（WP6 验收 4）。
// 为什么不坐椅子：从 0.44 m 的椅面伸直的腿，车道中心约 0.27 m 高、车道近端约 0.45 m，离碰撞上沿（0.16）差 11–29 cm；
// 要让小腿贴着碰撞上沿，只能把膝盖压到离地 0.14 m（反折约 40°），加上上身之后像一个人坐着、腿瘫在地上被拖着。
// 而且每个伸脚的人都自带一把椅子，中道的椅子孤零零立在过道当中、走廊里的人群当中，像摆出来的道具。
// 人坐在哪一侧：左道的人坐在 −x 侧、右道坐在 +x 侧；中道按 id 奇偶选一侧，人落在两条车道之间的空当里
// （外沿 ≤ 0.86 m，不伸进相邻车道玩家碰撞盒的 0.88 m；伸出、收回的每一刻都是）。
// 收回：两条腿绕髋部转 80°，朝 +s（前方）伸着，离开车道；上身随髋部扭一点（0.3 rad）并坐直，不整体转 80°
// （整体转会让躯干和手臂伸进相邻车道）。被碰到（hit）也会缩回去。
// 三个变体：legs（两条腿，收回时绕髋转）、body（胯、腰带、上身轮廓和撑地的两臂）、bodyFull（同 body，上身完整着色，人群段用）。每个人两个实例，都画全部顶点（这个池不按变体裁 drawRange）。
// 实例坐标系：+x 指向坐着的人；side = −1 时整个实例绕 y 转 180°（几何体关于 z = 0 对称，所以等于左右镜像，三角形绕向不变）。
import * as THREE from 'three';
import { defineArchetype, knockProgress, type PlaceCtx } from '../archetype';
import { stretchVisual } from '../behaviors';
import { C } from '../colors';
import { BODY } from '../LegForest';
import { SOFT_UPPER, type PartBuilder } from '../material';
import { upperBox } from '../upperBody';
import { footOutSide } from '../../kits/school/seats';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _b = new THREE.Matrix4();

/** 坐法：髋关节（两髋的中点，相对碰撞盒中心，x 朝坐着的人）、胯底高度、伸腿时上身后仰与收腿时上身扭转（弧度）、上身轴心的 x。 */
export interface FootPose { readonly x: number; readonly y: number; readonly half: number; readonly bottom: number; readonly recline: number; readonly twist: number; readonly bodyX: number }
/** 坐在地上：髋离地 0.11，胯贴地；上身后仰约 4.5°（再多头和背就伸出 0.86），收腿时扭 0.3 rad。 */
export const FOOT_HIP: FootPose = { x: 0.675, y: 0.11, half: 0.1, bottom: 0.005, recline: 0.08, twist: 0.3, bodyX: 0.665 };
/** 脚踝：离地 0.075；鞋跟着地，鞋尖翘起，伸到 x ≈ −0.30（碰撞盒外沿）。 */
export const FOOT_ANKLE = { x: -0.15, y: 0.075 } as const;
/** 收回时两条腿绕髋部转多少（弧度）。 */
export const FOOT_RETRACT_YAW = 1.4;

/** 膝盖（x, y）：大腿 BODY.thigh、小腿 BODY.shin 的两骨 IK，膝盖在髋—踝连线上方（朝上屈）；够不着时伸直。 */
export function footKnee(hip: Pick<FootPose, 'x' | 'y'>): { x: number; y: number } {
  const dx = FOOT_ANKLE.x - hip.x, dy = FOOT_ANKLE.y - hip.y;
  const d = Math.hypot(dx, dy), a = BODY.thigh, c = BODY.shin;
  const ux = dx / d, uy = dy / d;
  if (d >= a + c) return { x: hip.x + ux * a, y: hip.y + uy * a };
  const along = (a * a - c * c + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  // 连线朝 −x 落下；法线 (−uy, ux) 或 (uy, −ux) 里取 y 为正的一个
  const nx = ux < 0 ? uy : -uy, ny = ux < 0 ? -ux : ux;
  return { x: hip.x + ux * along + nx * h, y: hip.y + uy * along + ny * h };
}

/** footOut 伸出的程度（0 = 收回，1 = 伸在车道里）：stretch 行为按自己的节律；被碰倒后 0.3 s 内缩回。 */
export function footExtension(c: Pick<PlaceCtx, 'o' | 'tSeg' | 'knockedAt' | 't'>): number {
  const b = c.o.behavior;
  let e = b.type === 'stretch' ? stretchVisual(c.tSeg, b.period, b.phase, b.outFrac) : 1;
  const k = knockProgress(c.knockedAt, c.t);
  if (k > 0) e = Math.min(e, 1 - k);
  return e;
}

/** 坐着的人在哪一侧（+1 = +x）。 */
export function footSide(o: PlaceCtx['o']): 1 | -1 {
  // 规则放在 kits/school/seats.ts：教室 kit 在伸脚的人坐的那一行同侧不摆课桌椅，两边要一致
  return footOutSide(o.lanes, o.id);
}

/** 坐着的那个人（髋部）在世界坐标里的横向位置与里程（ObstacleView 用它把同一位置的路边坐着的人去掉，免得叠成两个）。 */
export function footSeat(o: PlaceCtx['o'], x0: number, x1: number): { x: number; s: number; side: 1 | -1 } {
  const side = footSide(o);
  return { x: (x0 + x1) / 2 + side * FOOT_HIP.x, s: (o.s0 + o.s1) / 2, side };
}

const _a = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _xa = new THREE.Vector3(), _ya = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/**
 * 沿 a→c 的长方体（截面宽 w 沿横向、高 h 朝上），在它的局部坐标系（y 朝上、z 沿长度）里执行 extra。
 * GeoBuilder.segment 用最短旋转对齐，斜放时截面会绕长轴歪；这里用 makeBasis 让「高」始终朝上，顶面的粉笔条才是平的。
 */
function limb(b: PartBuilder, a: readonly number[], c: readonly number[], w: number, h: number, hex: number, opts: { colors?: Partial<Record<string, number>>; soft?: boolean } = {}, extra?: (len: number) => void): void {
  _a.fromArray(a); _c.fromArray(c);
  const len = _a.distanceTo(_c);
  _d.copy(_a).sub(_c).normalize();                         // 局部 +z：从 c 指回 a
  _xa.crossVectors(_up, _d).normalize();
  _ya.crossVectors(_d, _xa);
  const m = new THREE.Matrix4().makeBasis(_xa, _ya, _d).setPosition(_a.add(_c).multiplyScalar(0.5));
  b.withMatrix(m, () => {
    if (opts.soft) upperBox(b, [0, 0, 0], [w, h, len], hex, { faces: '+x-x+y-y-z' });
    else b.box([0, 0, 0], [w, h, len], hex, opts.colors ? { colors: opts.colors } : {});
    extra?.(len);
  });
}

/** 两条伸直的腿：从地上的髋几乎平着横过车道，膝盖微微拱起，鞋跟着地、鞋尖翘起朝 −x。 */
function legs(b: PartBuilder, hip: FootPose): void {
  const pants = C.trousers, top = { '+y': 0x33466a };
  const knee = footKnee(hip), A = FOOT_ANKLE;
  const SHIN_H = 0.1;
  for (const z of [-hip.half, hip.half]) {
    const zk = z * 0.9, za = z * 0.85;
    limb(b, [hip.x, hip.y, z], [knee.x, knee.y, zk], 0.13, 0.12, pants, { colors: top });
    // 小腿顶面上的一道白（裤侧白条），就是 low 的「顶边一道粉笔白」
    limb(b, [knee.x, knee.y, zk], [A.x, A.y, za], 0.105, SHIN_H, pants, { colors: top }, (len) => {
      b.with({ chalk: 1 }, () => b.box([0, SHIN_H / 2 + 0.003, 0.02], [0.02, 0.006, len * 0.8], C.uniformStripe));
    });
    // 袜口与鞋：鞋跟着地，鞋尖翘起朝 −x；鞋底浅色
    b.box([A.x + 0.02, A.y, za], [0.07, 0.06, 0.085], 0xd9dee3);
    limb(b, [A.x + 0.03, 0.04, za], [A.x - 0.11, 0.15, za], 0.1, 0.075, C.shoe, { colors: { '-y': C.sole } });
  }
}

/**
 * 胯部、腰带与上身轮廓（原点在地面，髋在 hip）：腰带只有四个侧面是黑的，上面 12 cm 校服下摆（U6：以前腰带顶面是黑的，像带盖的桶）。
 * 上身是 lowUpperBody 的躯干和头（同样的尺寸和圆滑法线），两臂不垂着，从肩斜着撑到身边的地面上（坐在地上的人这样坐才稳）。
 */
function body(b: PartBuilder, hip: FootPose, full = false): void {
  const x = hip.x + 0.01, top = hip.y + 0.105;
  b.box([x, (hip.bottom + top) / 2, 0], [0.2, top - hip.bottom, 0.38], C.trousers, { faces: '+x-x+z-z-y' });
  b.box([x, hip.y + 0.125, 0], [0.208, 0.04, 0.39], C.hair, { faces: '+x-x+z-z' });
  b.box([x, hip.y + 0.205, 0], [0.19, 0.12, 0.37], C.uniform, { faces: '+x-x+z-z+y' });
  if (full) {
    // 人群段（PlaceCtx.wall）：同样的轮廓，完整着色——校服、肤色的脸、黑头发（脸朝 −x，后脑勺在 +x），不标 SOFT_UPPER
    upperBox(b, [x, hip.y + 0.4, 0], [0.22, 0.52, 0.4], C.uniform, { faces: '+x-x+z-z+y' });
    for (const z of [-0.24, 0.24]) limb(b, [x - 0.02, hip.y + 0.62, z], [x + 0.06, 0.015, z * 1.12], 0.08, 0.075, C.uniform);
    upperBox(b, [x - 0.01, hip.y + 0.81, 0], [0.18, 0.24, 0.17], C.skin, { colors: { '+y': C.hair, '+x': C.hair } });
    return;
  }
  b.with({ glow: SOFT_UPPER }, () => {
    b.with({ tint: 1 }, () => {
      // 躯干：lowUpperBody 的 0.40 宽 × 0.52 高 × 0.22 厚（宽沿 z）
      upperBox(b, [x, hip.y + 0.4, 0], [0.22, 0.52, 0.4], C.uniform, { faces: '+x-x+z-z+y' });
      // 两臂：肩在躯干两侧，手掌落在髋外侧、略靠后的地面上
      for (const z of [-0.24, 0.24]) limb(b, [x - 0.02, hip.y + 0.62, z], [x + 0.06, 0.015, z * 1.12], 0.08, 0.075, C.uniform, { soft: true });
    });
    upperBox(b, [x - 0.01, hip.y + 0.81, 0], [0.18, 0.24, 0.17], C.uniform);
  });
}

/**
 * 上身的矩阵：在 base 上先绕髋部横轴后仰（伸腿时 recline，收腿时坐直），再绕上身竖轴扭向腿的方向（收腿时 twist）。
 * yaw 与腿同号，取腿转角的 twist / FOOT_RETRACT_YAW。
 */
export function footBodyMatrix(base: THREE.Matrix4, hip: FootPose, e: number, legYaw: number, out: THREE.Matrix4): THREE.Matrix4 {
  out.copy(base);
  if (legYaw !== 0) {
    out.multiply(_t.makeTranslation(hip.bodyX, 0, 0)).multiply(_r.makeRotationY(legYaw * (hip.twist / FOOT_RETRACT_YAW))).multiply(_t.makeTranslation(-hip.bodyX, 0, 0));
  }
  out.multiply(_t.makeTranslation(hip.x, hip.y, 0)).multiply(_r.makeRotationZ(-hip.recline * e)).multiply(_t.makeTranslation(-hip.x, -hip.y, 0));
  return out;
}

/** 腿的矩阵：在 base 上绕髋部竖轴转 legYaw（收腿）。 */
export function footLegMatrix(base: THREE.Matrix4, hip: FootPose, legYaw: number, out: THREE.Matrix4): THREE.Matrix4 {
  out.copy(base);
  if (legYaw !== 0) out.multiply(_t.makeTranslation(hip.x, 0, 0)).multiply(_r.makeRotationY(legYaw)).multiply(_t.makeTranslation(-hip.x, 0, 0));
  return out;
}

export default defineArchetype({
  id: 'footOut', material: 'lambert', cap: 48, tileS: false, tileX: false,
  variants: [
    { name: 'legs', kind: 'footOut', build: (b) => legs(b, FOOT_HIP) },
    { name: 'body', build: (b) => body(b, FOOT_HIP) },
    // 人群段 2-2、5-6 里路边的人都完整着色，伸脚的人也跟着（不做食堂里唯一一个灰的人）；由 PlaceCtx.wall 选
    { name: 'bodyFull', build: (b) => body(b, FOOT_HIP, true) },
  ],
  place(p, c: PlaceCtx) {
    const o = c.o;
    const side = footSide(o);
    const e = footExtension(c);
    const cx = (c.st.x0 + c.st.x1) / 2 + c.partX;
    const cs = (o.s0 + o.s1) / 2 + c.st.ds;
    // 实例坐标系：+x 指向坐着的人。side = −1 时整体绕 y 转 180°。
    _p.set(cx, c.floorY, -cs);
    _q.setFromEuler(_e.set(0, side > 0 ? 0 : Math.PI, 0));
    _m.compose(_p, _q, _s);
    // 收腿：两条腿绕髋部转向 +s（世界 −z）
    const yaw = e < 1 ? (side > 0 ? -1 : 1) * (1 - e) * FOOT_RETRACT_YAW : 0;
    p.push(footBodyMatrix(_m, FOOT_HIP, e, yaw, _b), p.variantIndex(c.wall ? 'bodyFull' : 'body'), 0);
    p.push(footLegMatrix(_m, FOOT_HIP, yaw, _b), p.variantIndex('legs'), 0);
    return true;
  },
});
