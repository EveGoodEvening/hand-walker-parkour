// archetypes/stallDoor.ts —— 最后一格坏锁的隔间门（block，§4.1 1-3：以 1.8 s 周期荡进右道）。
// 门轴在车道外沿；open = 0 时门贴着隔间墙（沿 s），open = 1 时横在车道里。碰撞在 open > 0.5（45°）时生效，
// 画面上门在 30° 左右就已经伸进车道一半——先看见、后碰到。门下沿离地 0.1 m（爬不过去）。
import * as THREE from 'three';
import { LANE_WIDTH } from '../../../core/constants';
import { defineArchetype, type PlaceCtx } from '../archetype';
import { C } from '../colors';
import { blockEdges } from '../shapes';
import { swingOpen } from '../simBridge';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _t = new THREE.Matrix4();

/** 门板宽度 = 碰撞宽度 + 两侧各 5 cm。 */
export const DOOR_WIDTH = 2 * (0.45 + 0.05);

/** 门的开合角（弧度，0 = 贴墙，π/2 = 横在车道里）。与 sim 的 swingOpen 同一个函数。 */
export function doorAngle(o: PlaceCtx['o'], tSeg: number): number {
  const b = o.behavior;
  const open = b.type === 'swing' ? swingOpen(b.period, b.phase, tSeg) : 1;
  return open * Math.PI / 2;
}

export default defineArchetype({
  id: 'stallDoor', material: 'lambert', cap: 8, tileS: false, tileX: false,
  variants: [
    {
      name: 'stallDoor', kind: 'stallDoor',
      build(b) {
        // 以「打开、横在车道里」的姿态建模：门板沿 x，中心在原点
        const w = DOOR_WIDTH;
        b.box([0, 0.95, 0], [w, 1.7, 0.04], 0x9aa3a4, { colors: { '+z': 0xa9b1b2, '-z': 0x8f989a } });
        b.box([0, 1.55, 0.022], [w - 0.1, 0.012, 0.004], C.grout);
        b.box([0, 0.35, 0.022], [w - 0.1, 0.012, 0.004], C.grout);
        // 坏掉的插销（门的自由端，−x）
        b.box([-w / 2 + 0.06, 0.95, 0.03], [0.06, 0.03, 0.02], C.steel);
        b.box([-w / 2 + 0.1, 0.9, 0.03], [0.02, 0.07, 0.015], C.deskLeg);
        blockEdges(b, w / 2, 0.02, 1.8, { y0: 0.1, far: true });
        b.with({ chalk: 1 }, () => b.box([0, 0.11, 0.025], [w, 0.02, 0.01], C.secondary));
      },
    },
  ],
  place(p, c: PlaceCtx) {
    const o = c.o;
    const lane = o.lanes[0] ?? 1;
    const side = lane === -1 ? -1 : 1;                 // 门轴在车道的外沿（左道在 −x，其余在 +x）
    const hingeX = lane * LANE_WIDTH + side * DOOR_WIDTH / 2;
    const ang = doorAngle(o, c.tSeg);
    // 门板以中心建模：先把门轴移到原点，再绕 y 旋转，再放到门轴位置
    const closedYaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    const yaw = closedYaw * (1 - ang / (Math.PI / 2));
    _p.set(hingeX, c.floorY, -(o.s0 + 0.03));
    _q.setFromEuler(_e.set(0, yaw, 0));
    _m.compose(_p, _q, _s);
    _m.multiply(_t.makeTranslation(-side * DOOR_WIDTH / 2, 0, 0));
    p.push(_m, 0, 0);
    return true;
  },
});
