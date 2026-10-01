// archetypes/curb.ts —— 路沿 / 地面管线 / 被碰倒的栏架（low，§2.5：扁宽，顶边一道粉笔白）。
import * as THREE from 'three';
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { chalkTop, stripedBar } from '../shapes';

const DEG = Math.PI / 180;

/**
 * 被碰倒、平躺在地上的栏架：条纹横板向后仰 HURDLE_DOWN.tilt，斜靠在折倒的框架上。
 * 框架（前后两根钢管 + 中间的底板）贴地铺满整个宽度，横板下面没有缝——立着的栏架（bar 的 hurdle）下面是一道空的深缝，
 * 两者在同一套田径场景里出现（kitSymbols track：L → hurdleDown，H → hurdle），操作相反，剪影必须一眼分开（审查 r2）。
 */
export const HURDLE_DOWN = { tilt: 55 * DEG, boardY: 0.185, boardZ: -0.005, boardH: 0.1, boardT: 0.025, baseH: 0.15, chalkY: 0.255 } as const;

export default defineArchetype({
  id: 'curb', material: 'lambert', cap: 48,
  variants: [
    {
      name: 'curb', kind: 'curb',
      build(b, d) {
        const w = 2 * d.vw, dep = 2 * d.vd;
        b.box([0, 0.085, 0], [w, 0.17, dep], C.concrete, { colors: { '+y': 0xa7adab, '+z': 0x7f8786 } });
        b.box([0, 0.18, 0], [w - 0.02, 0.02, dep - 0.05], 0x9aa1a0);
        for (const x of [-w / 4, w / 4]) b.box([x, 0.085, dep / 2 + 0.002], [0.012, 0.17, 0.004], C.terrazzoDark);
        chalkTop(b, d, { y: 0.19, w: w - 0.02, z: d.vd - 0.03 });
      },
    },
    {
      name: 'pipe', kind: 'pipe',
      build(b, d) {
        const x0 = -d.vw, x1 = d.vw;
        b.rodX(x0, x1, 0.075, 0.035, 0.075, 6, C.steel);
        b.rodX(x0, x1, 0.15, -0.045, 0.058, 6, 0x7e8f99);
        for (const x of [-0.42, 0.42]) {
          b.box([x, 0.1, -0.005], [0.05, 0.2, 0.2], C.deskLeg, { colors: { '+y': 0x6b7270 } });
        }
        chalkTop(b, d, { y: 0.212, w: x1 - x0, z: -0.045 });
      },
    },
    {
      name: 'hurdleDown', kind: 'hurdleDown',
      build(b, d) {
        const H = HURDLE_DOWN;
        const hw = d.vw - 0.02;
        // 折倒的框架：底板填满横板下面（不留缝），前后两根钢管横躺在地上
        b.box([0, H.baseH / 2, -0.01], [2 * hw - 0.04, H.baseH, 0.17], C.deskLeg, { faces: '+x-x+y+z-z', colors: { '+y': 0x6b7270, '+z': 0x737b7d } });
        for (const z of [d.vd - 0.04, -(d.vd - 0.04)]) b.rodX(-hw, hw, 0.035, z, 0.035, 6, C.steel);
        // 两端：放倒的立柱，从地面斜撑到横板两端
        for (const x of [-hw + 0.015, hw - 0.015]) b.segment([x, 0.0, d.vd - 0.03], [x, 0.2, -0.03], 0.03, 0.03, C.dark);
        // 条纹横板：向后仰，朝上露出条纹，下沿压在底板上
        const m = new THREE.Matrix4().makeTranslation(0, H.boardY, H.boardZ).multiply(new THREE.Matrix4().makeRotationX(-H.tilt));
        b.withMatrix(m, () => stripedBar(b, -hw, hw, 0, 0, H.boardH, H.boardT, 5, C.trackLine, C.dark));
        // 最高处（横板上沿）整条粉笔白
        chalkTop(b, d, { y: H.chalkY, w: 2 * hw, z: -0.045 });
      },
    },
  ],
});
