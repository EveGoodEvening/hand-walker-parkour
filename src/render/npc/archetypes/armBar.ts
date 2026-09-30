// archetypes/armBar.ts —— 细横杆一族（bar，§2.5）：横放的拖把、校门横档、电子栏杆、车棚铁架、栏架、梦里伸出的手臂。
// 支撑物（立柱、桶、拖把头）都在车道外沿 |x| ≈ 半宽处，下面留出深缝。
// 电子栏杆的红灯（#B3322C）只在第三章出现（附录 A-9），沿着杆来回扫（「红光扫过」），用额外一个 barrierLamp 实例画。
// 伸出的手臂（reach）：两侧各跪着一个人（kneeler 原型的 reachL / reachR 变体），手臂横过车道，手在中间碰到一起。
import * as THREE from 'three';
import { defineArchetype, type PlaceCtx } from '../archetype';
import { C } from '../colors';
import { barLine, slitShadow, stripedBar } from '../shapes';
import { KNEELER_CROWD } from './kneeler';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

/** 红灯沿杆的位置（−1..1），往返周期 2.4 s。 */
export function lampSweep(t: number): number {
  const u = (t / 2.4) % 1;
  return u < 0.5 ? -1 + 4 * u : 3 - 4 * u;
}

export default defineArchetype({
  id: 'armBar', material: 'lambert', cap: 40,
  variants: [
    {
      name: 'mopAcross', kind: 'mopAcross',
      build(b, d) {
        // 拖把杆横在 0.365–0.435，一端搭在倒扣的水桶上，另一端是竖着的拖把头
        b.rodX(-d.vw + 0.05, d.vw - 0.02, 0.4, 0, 0.035, 6, C.secondary);
        b.box([-(d.vw - 0.05), 0.2, 0], [0.09, 0.4, 0.11], 0xb7bdbb, { colors: { '+y': 0xc9cfcf } });
        b.prism([d.vw - 0.07, 0, 0], 0.07, 0.06, 0.365, 8, C.wainscotTop, { top: 0x3e5553 });
        barLine(b, d, { w: 2 * d.vw - 0.2, y: 0.357, z: 0.03 });
        slitShadow(b, 2 * d.vw - 0.2, 0.5);
      },
    },
    {
      name: 'gateBar', kind: 'gateBar',
      build(b, d) {
        // 校门的两道横档：下档 0.40–0.48（碰撞），上档 1.05 以上；两端立柱在墙边
        b.box([0, 0.44, 0], [2 * d.vw - 0.06, 0.08, 0.06], C.darker, { colors: { '+y': C.dark } });
        b.box([0, 1.08, 0], [2 * d.vw - 0.06, 0.06, 0.05], C.darker);
        for (const s of [-1, 1]) b.box([s * (d.vw - 0.035), 0.6, 0], [0.07, 1.2, 0.07], C.dark);
        barLine(b, d, { y: d.bottom + 0.02, w: 2 * d.vw - 0.1, z: 0.03 });
        slitShadow(b, 2 * d.vw - 0.2, 0.6);
      },
    },
    {
      name: 'barrierArm', kind: 'barrierArm',
      build(b, d) {
        // 电子栏杆：白灰相间的杆（0.42–0.50），+x 端是道闸机箱
        stripedBar(b, -d.vw + 0.02, d.vw - 0.14, 0.46, 0, 0.08, 0.05, 9, C.trackLine, C.lowSteady);
        b.box([d.vw - 0.08, 0.5, 0], [0.16, 1.0, 0.16], C.line, { colors: { '+y': C.lowSteady } });
        barLine(b, d, { y: d.bottom + 0.02, w: 2 * d.vw - 0.2, z: 0.026 });
        slitShadow(b, 2 * d.vw - 0.2, 0.6);
      },
    },
    {
      name: 'bikeRack', kind: 'bikeRack',
      build(b, d) {
        // 车棚铁架：下横档（碰撞下沿 0.38）、上横档、两端立柱、中间竖条
        const w = 2 * d.vw;
        b.box([0, 0.41, 0], [w - 0.04, 0.05, 0.04], C.deskLeg);
        b.box([0, 0.98, 0], [w - 0.04, 0.04, 0.04], C.deskLeg);
        for (const s of [-1, 1]) b.box([s * (d.vw - 0.02), 0.52, 0], [0.04, 1.04, 0.05], C.deskLeg);
        for (let i = -2; i <= 2; i++) b.box([i * 0.2, 0.7, 0], [0.02, 0.55, 0.02], 0x6b7270);
        b.segment([-(d.vw - 0.04), 0.43, 0], [d.vw - 0.04, 0.96, 0], 0.02, 0.02, 0x6b7270);
        barLine(b, d, { y: d.bottom + 0.02, w: w - 0.08, z: 0.025 });
        slitShadow(b, w - 0.1, 0.5);
      },
    },
    {
      name: 'hurdle', kind: 'hurdle',
      build(b, d) {
        // 最低档栏架：白黑相间的横板（0.42–0.50），两侧 L 形腿
        const hw = d.vw - 0.02;
        stripedBar(b, -hw, hw, 0.46, 0, 0.08, 0.03, 5, C.trackLine, C.dark);
        for (const s of [-1, 1]) {
          b.box([s * hw, 0.25, -0.01], [0.03, 0.5, 0.03], C.dark);
          b.box([s * hw, 0.015, 0], [0.035, 0.03, 2 * d.vd - 0.01], C.dark);
        }
        barLine(b, d, { y: d.bottom + 0.02, w: 2 * hw, z: 0.02 });
        slitShadow(b, 2 * hw - 0.1, 0.5);
      },
    },
    {
      name: 'reach', kind: 'reach',
      build(b, d) {
        // 两侧跪着的人伸进车道的手臂：肩在 |x| = 0.58（0.49 m 高），手在中间（0.44 m）碰到一起
        for (const s of [-1, 1]) {
          b.segment([s * (d.vw - 0.02), 0.49, 0], [s * 0.3, 0.46, 0], 0.08, 0.075, 0x9aa3a6);
          b.segment([s * 0.3, 0.46, 0], [s * 0.07, 0.44, 0], 0.07, 0.065, 0x9aa3a6);
          b.box([s * 0.03, 0.435, 0], [0.07, 0.03, 0.08], C.skin);
          b.with({ chalk: 1 }, () => b.segment([s * (d.vw - 0.02), 0.455, 0.03], [s * 0.08, 0.41, 0.03], 0.015, 0.01, C.chalkWhite));
        }
        slitShadow(b, 2 * d.vw - 0.2, 0.5);
      },
    },
    {
      name: 'barrierLamp',
      build(b) {
        b.with({ glow: 1 }, () => b.box([0, 0.515, 0], [0.16, 0.03, 0.055], C.barrierRed));
      },
    },
  ],
  place(p, c: PlaceCtx) {
    const o = c.o;
    if (o.kind === 'reach') {
      p.placeGeneric(c, { tile: false });
      // 两侧跪着的人（kneeler 原型）
      const cx = (c.st.x0 + c.st.x1) / 2 + c.partX;
      const zc = -(o.s0 + o.s1) / 2 - c.st.ds;
      for (const s of [-1, 1] as const) {
        _p.set(cx + s * 0.74, c.floorY, zc - 0.02);
        _q.identity();
        _m.compose(_p, _q, _s);
        c.side('kneeler', _m, s < 0 ? 'reachL' : 'reachR', 0, KNEELER_CROWD);
      }
      return true;
    }
    if (o.kind === 'barrierArm') {
      p.placeGeneric(c);
      if (c.chapter === 'ch3' || c.chapter === 'stage') {
        const cx = (c.st.x0 + c.st.x1) / 2;
        const half = (c.st.x1 - c.st.x0) / 2 - 0.3;
        _p.set(cx + lampSweep(c.t) * half, c.floorY, -(o.s0 + o.s1) / 2);
        _q.identity();
        _m.compose(_p, _q, _s);
        const pulse = 0.75 + 0.25 * Math.sin(c.t * Math.PI * 1.6);
        p.push(_m, p.variantIndex('barrierLamp'), 1.6 * pulse);
      }
      return true;
    }
    return false;
  },
});
