// archetypes/curb.ts —— 路沿 / 地面管线 / 放倒的栏架（low，§2.5：扁宽，顶边一道粉笔白）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { chalkTop, stripedBar } from '../shapes';

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
        // 向前倒下的栏架：横板离地 0.21–0.27，两侧立柱斜撑在地上
        const hw = d.vw - 0.02;
        stripedBar(b, -hw, hw, 0.24, 0, 0.06, 0.03, 5, C.trackLine, C.dark);
        for (const x of [-hw, hw]) {
          b.segment([x, 0.0, 0.09], [x, 0.24, -0.005], 0.03, 0.03, C.dark);
          b.box([x, 0.015, 0], [0.03, 0.03, 2 * d.vd - 0.01], C.dark);
        }
        chalkTop(b, d, { y: 0.28, w: 2 * hw, z: 0.02 });
      },
    },
  ],
});
