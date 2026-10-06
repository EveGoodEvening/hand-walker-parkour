// archetypes/cart.ts —— 清洁车 / 器材推车、婴儿车（block，§2.5：竖直的高剪影，近端竖棱描边）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { blockEdges } from '../shapes';

export default defineArchetype({
  id: 'cart', material: 'lambert', cap: 24,
  variants: [
    {
      name: 'cart', kind: 'cart',
      build(b, d) {
        const hx = d.vw - 0.02, hz = d.vd - 0.02;
        // 四根立柱、三层隔板、隔板上的桶和箱子、一侧挂的黑袋子、后部推把、四个小轮
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * hx, 0.52, sz * hz], [0.03, 0.92, 0.03], C.deskLeg);
        for (const y of [0.12, 0.52, 0.92]) b.box([0, y, 0], [2 * hx, 0.03, 2 * hz], 0x7e8f99, { colors: { '+y': 0x8d9ca5 } });
        b.prism([-0.14, 0.135, 0.1], 0.13, 0.15, 0.3, 8, C.wainscotTop, { top: 0x9fb2c0 });
        b.box([0.16, 0.25, -0.1], [0.24, 0.24, 0.4], 0x9aa3a4, { colors: { '+y': 0xb7bdbb } });
        b.box([0.12, 0.68, 0.05], [0.3, 0.3, 0.3], C.grout, { colors: { '+y': 0xb7bdbb } });
        b.box([-0.15, 0.62, -0.15], [0.2, 0.18, 0.3], 0x5b6468);
        b.box([hx - 0.05, 0.62, -0.05], [0.05, 0.5, 0.36], C.darker);
        b.box([0, 0.99, -hz], [2 * hx, 0.03, 0.03], C.steel);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * (hx - 0.03), 0.04, sz * (hz - 0.04)], [0.04, 0.08, 0.08], C.hair);
        blockEdges(b, d.vw - 0.01, d.vd - 0.01, 1.0);
      },
    },
    {
      name: 'stroller', kind: 'stroller',
      build(b, d) {
        const hx = d.vw - 0.03;
        // 婴儿车：座兜、车篷、底篮、车架、推把、四个轮子
        b.box([0, 0.55, 0.04], [2 * hx - 0.06, 0.34, 0.46], C.line, { colors: { '+y': 0x46515c } });
        b.segment([0, 0.7, -0.08], [0, 0.95, -0.2], 2 * hx - 0.04, 0.22, C.shoe);
        b.box([0, 0.2, 0.0], [2 * hx - 0.1, 0.1, 0.4], 0x46515c);
        for (const s of [-1, 1]) {
          b.segment([s * hx, 0.08, 0.3], [s * hx, 0.45, 0.1], 0.025, 0.025, C.steel);
          b.segment([s * hx, 0.08, -0.3], [s * hx, 0.98, -0.36], 0.025, 0.025, C.steel);
          for (const z of [-0.3, 0.3]) b.box([s * hx, 0.09, z], [0.045, 0.18, 0.18], C.hair);
        }
        b.box([0, 0.98, -0.36], [2 * hx, 0.03, 0.03], C.hair);
        blockEdges(b, d.vw - 0.01, d.vd - 0.01, 1.0);
      },
    },
  ],
});
