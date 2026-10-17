// archetypes/armBar.ts —— 细横杆一族（bar，§2.5）：横放的拖把、校门横档、电子栏杆、车棚铁架、栏架、梦里伸出的手臂。
// 支撑物（立柱、桶、拖把头）都在车道外沿 |x| ≈ 半宽处，下面留出深缝。
// 电子栏杆的红灯（#B3322C）只在第三章出现（附录 A-9），沿着杆来回扫（「红光扫过」），用额外一个 barrierLamp 实例画。
// 伸出的手臂（reach）：两侧各跪着一个人（kneeler 原型的 reachL / reachR 变体），手臂横过车道，手在中间碰到一起。
// 两只手臂各是一个实例（reachArmL / reachArmR），从实际跪着的那个人的肩膀伸到车道中间：人跪在车道外沿还是车道缝上，
// 手臂的长度跟着变；「让一下」时人不动，手臂收回去。
import * as THREE from 'three';
import { LANE_WIDTH } from '../../../core/constants';
import { defineArchetype, type PlaceCtx, type ReachNeighbour } from '../archetype';
import { PART } from '../behaviors';
import { reducedPulse } from '../behaviors';
import type { PartBuilder } from '../material';
import { C } from '../colors';
import { barLine, slitShadow, stripedBar } from '../shapes';
import { KNEELER_CROWD } from './kneeler';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

/**
 * reach 两侧跪着的人离车道中心的距离：车道外沿（没有邻居）/ 车道缝上（旁边车道同一行也是 reach，两道共用一个人，= LANE_WIDTH / 2）/
 * 旁边车道是别的障碍（人腿、爬行者……）时再往自己这边收 5 cm，和旁边站着的人的腿隔开约 0.2 m（复审 npc-seated-5）。
 */
export const REACH_SIDE_X = 0.74, REACH_GAP_X = LANE_WIDTH / 2, REACH_BLOCK_X = LANE_WIDTH / 2 - 0.05;
/** 这一侧的邻居 → 跪着的人离车道中心的距离。 */
export const reachKneelX = (n: ReachNeighbour): number => (n === 'reach' ? REACH_GAP_X : n === 'block' ? REACH_BLOCK_X : REACH_SIDE_X);

/** reach 两侧跪着的人：肩膀（手臂的起点）离这个人的中心 0.15 m（躯干 0.34 宽），离地 0.49 m。 */
export const REACH_SHOULDER = 0.15;
/** 手臂几何体的参考长度（肩膀到车道中心，人跪在车道外沿时）；实例按实际长度沿 x 缩放。 */
const ARM_REF = REACH_SIDE_X - REACH_SHOULDER;
/** 「让一下」时手臂最多收回到原长的这个比例（收进肩膀前面，不穿过身体）。 */
const ARM_RETRACT_MIN = 0.15;

/**
 * 一只伸出的手臂（右侧跪着的人 s = +1 / 左侧 s = −1）：肩膀在原点，手指过车道中心一点点（x = −s · (ARM_REF + 0.005)）。
 * 手和手臂一起沿 x 缩放：跪在车道缝上时肩膀离中心 0.40 m，手宽 7 → 4.8 cm，仍读得出是手。
 */
function reachArm(b: PartBuilder, s: 1 | -1): void {
  const at = (x: number) => -s * (ARM_REF - x);
  // 线段只画前、后、顶三面（'+x-x+y' 按线段自己的坐标系）：两端藏在肩膀、手里，底面离地 0.4 m 以上，镜头永远在上面
  b.segment([0, 0.49, 0], [at(0.3), 0.46, 0], 0.08, 0.075, 0x9aa3a6, { faces: '+x-x+y' });
  b.segment([at(0.3), 0.46, 0], [at(0.07), 0.44, 0], 0.07, 0.065, 0x9aa3a6, { faces: '+x-x+y' });
  b.box([at(0.03), 0.435, 0], [0.07, 0.03, 0.08], C.skin, { faces: '+x-x+y+z-z' });
  b.with({ chalk: 1 }, () => b.segment([0, 0.455, 0.03], [at(0.08), 0.41, 0.03], 0.015, 0.01, C.chalkWhite, { faces: '+x-x+y' }));
}

/** 红灯最亮时的自发光强度。 */
export const LAMP_PEAK = 1.6;
/** 红灯的明暗：0.8 Hz 脉动（0.5 → 1 倍峰值）；「减少闪烁」时 0.5 Hz 平滑明暗、最低 0.4 倍峰值（§7.3）。 */
export function lampGlow(t: number, reducedFlicker: boolean): number {
  return LAMP_PEAK * (reducedFlicker ? reducedPulse(t) : 0.75 + 0.25 * Math.sin(t * Math.PI * 1.6));
}

/** 红灯沿杆的位置（−1..1），往返周期 2.4 s。 */
export function lampSweep(t: number): number {
  const u = (t / 2.4) % 1;
  return u < 0.5 ? -1 + 4 * u : 3 - 4 * u;
}

export default defineArchetype({
  id: 'armBar', material: 'lambert', cap: 56,
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
        // 两侧的人都跪在车道外沿时的样子（独立放置、静态检查用）：肩在 |x| = 0.59（0.49 m 高），手在中间（0.44 m）碰到一起。
        // 游戏里不画这个变体：ObstacleView 放的是下面的深缝（reachSlit）加两个按实际跪的位置伸出来的手臂实例
        for (const s of [-1, 1] as const) b.withMatrix(new THREE.Matrix4().makeTranslation(s * ARM_REF, 0, 0), () => reachArm(b, s));
        slitShadow(b, 2 * d.vw - 0.2, 0.5);
      },
    },
    { name: 'reachSlit', build: (b, d) => slitShadow(b, 2 * d.vw - 0.2, 0.5) },
    { name: 'reachArmL', build: (b) => reachArm(b, -1) },
    { name: 'reachArmR', build: (b) => reachArm(b, 1) },
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
      // 两侧跪着的人（kneeler 原型）。旁边车道同一行也是伸出的手臂时，两条手臂从车道缝里同一个人身上伸出来
      // （reachBoth，由车道号小的那一个画）；旁边是别的障碍（人腿……）时，这个人跪在车道缝里侧（±0.50），身体收在
      // ±0.17 以内，离旁边那个人的腿还有约 0.2 m。以前一律跪在 ±0.74：三道 reach 时两两背靠背，
      // 手臂穿过对方的身体；挨着人腿时压进那个人的腿和手里（审查 npc-seated-5）。
      // 「让一下」时人不挪（整个障碍横移会把人推进旁边车道、和共用的人对不上），只把手臂收回去（复审）。
      const cx = (c.st.x0 + c.st.x1) / 2;
      const zc = -(o.s0 + o.s1) / 2 - c.st.ds;
      const nb = c.reachNb;
      const keep = 1 - (1 - ARM_RETRACT_MIN) * Math.min(1, Math.abs(c.partX) / PART.dist);
      _q.identity();
      _p.set(cx, c.floorY, zc);
      _s.set(keep, 1, 1);
      p.push(_m.compose(_p, _q, _s), p.variantIndex('reachSlit'));
      for (const s of [-1, 1] as const) {
        const n = nb ? (s < 0 ? nb.l : nb.r) : null;
        const kx = reachKneelX(n);
        // 手臂：从这一侧那个人的肩膀伸到车道中心
        _p.set(cx + s * (kx - REACH_SHOULDER), c.floorY, zc);
        _s.set(((kx - REACH_SHOULDER) / ARM_REF) * keep, 1, 1);
        p.push(_m.compose(_p, _q, _s), p.variantIndex(s < 0 ? 'reachArmL' : 'reachArmR'));
        if (n === 'reach' && s < 0) continue;
        _p.set(cx + s * kx, c.floorY, zc - 0.02);
        _s.set(1, 1, 1);
        c.side('kneeler', _m.compose(_p, _q, _s), n === 'reach' ? 'reachBoth' : s < 0 ? 'reachL' : 'reachR', 0, KNEELER_CROWD);
      }
      _s.set(1, 1, 1);
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
        p.push(_m, p.variantIndex('barrierLamp'), lampGlow(c.t, c.reducedFlicker));
      }
      return true;
    }
    return false;
  },
});
