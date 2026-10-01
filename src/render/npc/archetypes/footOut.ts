// archetypes/footOut.ts —— 伸进过道的脚（low，§3「腿的森林」、D11、附录 A-5）。
// 「有人把腿往过道里伸了伸。不是成心的，只是习惯。」——它早就伸在那里，或者按那个人自己的节律伸缩（stretch），
// 与玩家是否靠近无关；伸出 / 收回的画面只取决于段内时间和数据给的 period / phase（behaviors.stretchVisual）。
//
// 画的是一个完整的人（只到腰带，和所有 NPC 一样）：他侧身坐在车道外沿的一把椅子上，面朝过道，两条腿并排伸直横过车道，
// 鞋跟着地、鞋尖翘起。碰撞盒（0.60 宽 × 0.30 深 × 0.16 高）里只有两条小腿和鞋：小腿低低地贴着地面（车道范围内不高于
// 碰撞上沿 + 5 cm），膝盖在车道外沿，大腿斜着抬到椅面。两条腿并排正好填满碰撞盒的 0.30 深度。
// 人坐在哪一侧：左道的人坐在 −x 侧、右道坐在 +x 侧；中道按 id 奇偶选一侧，椅子落在两条车道之间的空当里
// （椅子和人的外沿 ≤ 0.86 m，不伸进相邻车道玩家碰撞盒的 0.88 m）。
// 收回：人在椅子上转过身，两条腿绕髋部转 80°，朝 +s（教室前方）伸着，离开车道。被碰到（hit）也会缩回去。
// 两个变体：seated（人：两条腿 + 胯，收回时整体转动；U6：腰带只有侧面是黑的，上面是校服下摆）、chair（椅子，不动）。
// 坐着的人只建到腰带（「视线里只有膝盖和腰带」，与路边坐着的人一样）。实例坐标系：+x 指向坐着的人；
// side = −1 时整个实例绕 y 转 180°（几何体关于 z = 0 对称，所以等于左右镜像，三角形绕向不变）。
import * as THREE from 'three';
import { defineArchetype, knockProgress, type PlaceCtx } from '../archetype';
import { stretchVisual } from '../behaviors';
import { C } from '../colors';
import type { PartBuilder } from '../material';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _t = new THREE.Matrix4(), _r = new THREE.Matrix4();

/** 髋关节（两髋的中点）相对碰撞盒中心的位置：x 朝坐着的人那一侧。两髋在 z = ±FOOT_HIP.half。 */
export const FOOT_HIP = { x: 0.72, y: 0.46, half: 0.1 } as const;
/** 椅子中心（相对碰撞盒中心，x 朝坐着的人）。椅子朝 −x，椅背在 +x 一侧，外沿 x ≈ 0.86。 */
export const FOOT_CHAIR_X = 0.66;
/** 膝盖：车道范围（|x| ≤ 碰撞半宽 + 5 cm）以外，离地 0.14。 */
const KNEE = { x: 0.42, y: 0.14 } as const;
/** 脚踝：离地 0.075；鞋尖翘起，伸到 x ≈ −0.30（碰撞盒外沿）。 */
const ANKLE = { x: -0.08, y: 0.075 } as const;
/** 收回时整个人绕髋部转多少（弧度）。 */
export const FOOT_RETRACT_YAW = 1.4;

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
  const lane = o.lanes[0] ?? 0;
  if (lane < 0) return -1;
  if (lane > 0) return 1;
  return o.id % 2 === 0 ? 1 : -1;
}

/** 坐着的那个人（髋部）在世界坐标里的横向位置与里程（ObstacleView 用它把同一位置的路边坐着的人去掉，免得叠成两个）。 */
export function footSeat(o: PlaceCtx['o'], x0: number, x1: number): { x: number; s: number; side: 1 | -1 } {
  const side = footSide(o);
  return { x: (x0 + x1) / 2 + side * FOOT_HIP.x, s: (o.s0 + o.s1) / 2, side };
}

/** 一条伸直的腿（z = 髋的横向位置）：大腿从髋斜着落到膝盖，小腿低低地横过车道，鞋跟着地、鞋尖翘起朝 −x。 */
function leg(b: PartBuilder, z: number): void {
  const pants = C.trousers;
  const zk = z * 0.9, za = z * 0.85;
  const SHIN_H = 0.1;
  // segment(a, b, 宽, 高)：宽沿 z，高朝上
  b.segment([FOOT_HIP.x, FOOT_HIP.y, z], [KNEE.x, KNEE.y, zk], 0.13, 0.12, pants, { colors: { '+y': 0x33466a } });
  b.segment([KNEE.x, KNEE.y, zk], [ANKLE.x, ANKLE.y, za], 0.105, SHIN_H, pants, { colors: { '+y': 0x33466a } });
  // 小腿顶面上的一道白（裤侧白条），就是 low 的「顶边一道粉笔白」
  const topAt = (x: number) => ANKLE.y + ((x - ANKLE.x) / (KNEE.x - ANKLE.x)) * (KNEE.y - ANKLE.y) + SHIN_H / 2 + 0.003;
  const x0 = ANKLE.x + 0.04, x1 = KNEE.x - 0.05;
  b.with({ chalk: 1 }, () => b.segment([x0, topAt(x0), (za + zk) / 2], [x1, topAt(x1), (za + zk) / 2], 0.02, 0.006, C.uniformStripe));
  // 袜口与鞋：鞋跟着地，鞋尖翘起朝 −x；鞋底浅色
  b.box([ANKLE.x + 0.02, ANKLE.y, za], [0.07, 0.06, 0.085], 0xd9dee3);
  b.segment([ANKLE.x + 0.02, 0.035, za], [ANKLE.x - 0.2, 0.13, za], 0.1, 0.075, C.shoe, { colors: { '-y': C.sole } });
}

/** 胯部与腰带：腰带只有四个侧面是黑的，上面 12 cm 校服下摆（U6：以前腰带顶面是黑的，像带盖的桶）。 */
function pelvis(b: PartBuilder): void {
  b.box([FOOT_HIP.x + 0.02, FOOT_HIP.y + 0.03, 0], [0.2, 0.16, 0.38], C.trousers, { faces: '+x-x+z-z-y' });
  b.box([FOOT_HIP.x + 0.02, FOOT_HIP.y + 0.125, 0], [0.208, 0.04, 0.39], C.hair, { faces: '+x-x+z-z' });
  b.box([FOOT_HIP.x + 0.02, FOOT_HIP.y + 0.205, 0], [0.19, 0.12, 0.37], C.uniform, { faces: '+x-x+z-z+y' });
}

/** 椅子：朝 −x（人面朝过道），椅背在 +x 一侧。 */
function chair(b: PartBuilder): void {
  const cx = FOOT_CHAIR_X;
  b.box([cx, 0.425, 0], [0.38, 0.03, 0.4], C.deskTop, { colors: { '+y': 0xb9b4a8 } });
  for (const z of [-0.17, 0.17]) {
    for (const x of [-0.16, 0.16]) b.box([cx + x, 0.205, z], [0.025, 0.41, 0.025], C.deskLeg);
    b.box([cx + 0.18, 0.66, z], [0.025, 0.44, 0.025], C.deskLeg);
  }
  b.box([cx + 0.18, 0.78, 0], [0.02, 0.14, 0.38], C.deskTop);
}

export default defineArchetype({
  id: 'footOut', material: 'lambert', cap: 48, tileS: false, tileX: false,
  variants: [
    {
      name: 'seated', kind: 'footOut',
      build(b, d) {
        void d;
        for (const z of [-FOOT_HIP.half, FOOT_HIP.half]) leg(b, z);
        pelvis(b);
      },
    },
    { name: 'chair', build: chair },
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
    p.push(_m, p.variantIndex('chair'), 0);
    if (e < 1) {
      // 在椅子上转过身：两条腿绕髋部转向 +s（世界 −z）
      const yaw = (side > 0 ? -1 : 1) * (1 - e) * FOOT_RETRACT_YAW;
      _t.makeTranslation(FOOT_HIP.x, 0, 0);
      _r.makeRotationY(yaw);
      _m.multiply(_t).multiply(_r).multiply(_t.makeTranslation(-FOOT_HIP.x, 0, 0));
    }
    p.push(_m, 0, 0);
    return true;
  },
});
