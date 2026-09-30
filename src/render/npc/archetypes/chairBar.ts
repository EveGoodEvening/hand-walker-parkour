// archetypes/chairBar.ts —— 椅子横档 / 倒扣的椅子（bar，§2.5）。一排并起来的椅面横在车道上，椅腿只在外侧两端，
// 下面是深缝；远端是椅背（高于横档，不影响伏低）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { barLine, slitShadow } from '../shapes';

export default defineArchetype({
  id: 'chairBar', material: 'lambert', cap: 32,
  variants: [
    {
      name: 'chairBar', kind: 'chairBar',
      build(b, d) {
        const w = 2 * d.vw, dep = 2 * d.vd;
        b.box([0, 0.445, 0], [w, 0.05, dep - 0.02], C.deskTop, { colors: { '+y': 0xb9b4a8, '-y': 0x8f8a7e } });
        b.box([0, 0.395, d.vd - 0.02], [w, 0.04, 0.03], C.deskLeg);
        b.box([0, 0.395, -(d.vd - 0.02)], [w, 0.04, 0.03], C.deskLeg);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) b.box([sx * (d.vw - 0.03), 0.19, sz * (d.vd - 0.03)], [0.03, 0.38, 0.03], C.deskLeg);
          b.box([sx * (d.vw - 0.03), 0.66, -(d.vd - 0.02)], [0.03, 0.38, 0.03], C.deskLeg);
        }
        b.box([0, 0.78, -(d.vd - 0.02)], [w - 0.06, 0.13, 0.025], C.deskTop, { colors: { '+z': 0x9a9588 } });
        // 中缝：两把椅子并在一起
        b.box([0, 0.472, 0], [0.012, 0.006, dep - 0.04], 0x7d786d);
        barLine(b, d, { y: d.bottom + 0.005 });
        slitShadow(b, w - 0.06, dep);
      },
    },
  ],
});
