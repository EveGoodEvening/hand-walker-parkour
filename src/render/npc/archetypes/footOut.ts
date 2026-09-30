// archetypes/footOut.ts —— 伸进过道的脚（low，§3「腿的森林」、D11、附录 A-5）。
// 「有人把腿往过道里伸了伸。不是成心的，只是习惯。」——它早就伸在那里，或者按那个人自己的节律伸缩（stretch），
// 与玩家是否靠近无关；伸出 / 收回的画面只取决于段内时间和数据给的 period / phase（behaviors.stretchVisual）。
// 建模：鞋尖朝 −x，鞋跟着地、鞋尖翘起；小腿低低地横过车道（车道范围内不高于碰撞上沿 + 3 cm），膝盖和大腿在车道外沿
// 抬到坐在那里的人的椅面上。放在哪条车道：左道的人坐在 −x 侧、右道坐在 +x 侧；中道按 id 奇偶选一侧。
// 收回：整条腿绕髋部转 80°，脚收到自己座位前面（朝 −s），离开车道。被碰到（hit）也会缩回去。
import * as THREE from 'three';
import { defineArchetype, knockProgress, type PlaceCtx } from '../archetype';
import { stretchVisual } from '../behaviors';
import { C } from '../colors';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _t = new THREE.Matrix4(), _r = new THREE.Matrix4();

/** 髋部（椅面）位置：相对碰撞盒中心，x 朝坐着的人那一侧。 */
export const FOOT_HIP = { x: 0.8, y: 0.44 } as const;

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

export default defineArchetype({
  id: 'footOut', material: 'lambert', cap: 24, tileS: false, tileX: false,
  variants: [
    {
      name: 'seated', kind: 'footOut',
      build(b, d) {
        void d;
        const pants = C.trousers;
        // 鞋：鞋跟着地，鞋尖翘起朝 −x；鞋底浅色
        b.segment([-0.06, 0.035, 0], [-0.28, 0.13, 0], 0.1, 0.075, C.shoe, { colors: { '-y': C.sole, '-z': 0x3a3f43 } });
        b.box([-0.05, 0.075, 0], [0.07, 0.06, 0.085], 0xd9dee3);
        // 小腿（校服裤）低低地横过车道，裤侧白条就是「顶边一道粉笔白」
        b.segment([-0.04, 0.085, 0], [0.6, 0.18, 0], 0.11, 0.09, pants, { colors: { '+y': 0x33466a } });
        b.with({ chalk: 1 }, () => b.segment([-0.02, 0.132, 0.0], [0.33, 0.185, 0.0], 0.018, 0.008, C.uniformStripe));
        // 膝盖 → 大腿，抬到椅面
        b.segment([0.6, 0.18, 0], [FOOT_HIP.x, FOOT_HIP.y, 0], 0.13, 0.12, pants);
        // 椅面边缘与一条椅腿（坐着的人在车道外）
        b.box([FOOT_HIP.x + 0.06, FOOT_HIP.y - 0.02, 0], [0.16, 0.04, 0.36], C.deskTop, { colors: { '+y': 0xb9b4a8 } });
        for (const z of [-0.15, 0.15]) b.box([FOOT_HIP.x + 0.12, (FOOT_HIP.y - 0.04) / 2, z], [0.03, FOOT_HIP.y - 0.04, 0.03], C.deskLeg);
      },
    },
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
    if (e < 1) {
      // 绕髋部转：脚收到座位前面（世界 −z 方向，即 +s）
      const yaw = (side > 0 ? -1 : 1) * (1 - e) * 1.4;
      _t.makeTranslation(FOOT_HIP.x, 0, 0);
      _r.makeRotationY(yaw);
      _m.multiply(_t).multiply(_r).multiply(_t.makeTranslation(-FOOT_HIP.x, 0, 0));
      // 收回时膝盖略抬
      _m.multiply(_r.makeTranslation(0, 0.03 * (1 - e), 0));
    }
    p.push(_m, 0, 0);
    return true;
  },
});
