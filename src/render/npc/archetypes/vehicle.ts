// archetypes/vehicle.ts —— 电动车 / 停着的汽车（block，§2.5）。沿 s 停放；汽车占 4 拍长（5-3）。
// 冷色：尾灯不用红色（暖色只允许出现在第三章的指定位置，附录 A-9）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { blockEdges } from '../shapes';

export default defineArchetype({
  id: 'vehicle', material: 'lambert', cap: 16, tileS: false,
  variants: [
    {
      name: 'scooter', kind: 'scooter',
      build(b, d) {
        const hz = d.vd - 0.04;
        b.box([0, 0.34, 0.02], [0.3, 0.14, 2 * hz - 0.3], C.line, { colors: { '+y': 0x46515c } });
        b.box([0, 0.5, -hz + 0.22], [0.26, 0.45, 0.14], C.line);
        b.box([0, 0.86, -hz + 0.2], [0.12, 0.34, 0.1], C.dark);
        b.box([0, 1.02, -hz + 0.2], [2 * d.vw - 0.04, 0.035, 0.04], C.hair);
        b.box([0, 0.66, 0.22], [0.26, 0.1, 0.52], C.hair, { colors: { '+y': 0x2b3034 } });
        b.box([0, 0.5, 0.26], [0.28, 0.2, 0.62], C.line);
        b.box([0, 0.54, hz - 0.04], [0.3, 0.2, 0.08], C.dark);
        for (const z of [-hz + 0.2, hz - 0.2]) b.box([0, 0.2, z], [0.08, 0.4, 0.4], C.hair, { colors: { '+x': 0x2b3034, '-x': 0x2b3034 } });
        b.box([0, 0.72, hz - 0.02], [0.16, 0.05, 0.02], C.lowSteady);
        // 描边沿着真实轮廓：车尾两条竖棱 + 车把
        blockEdges(b, 0.15, hz - 0.01, 0.64, { y0: 0.26 });
        b.with({ chalk: 1 }, () => b.box([0, 1.045, -hz + 0.2], [2 * d.vw - 0.06, 0.012, 0.012], C.secondary));
      },
    },
    {
      name: 'car', kind: 'car',
      build(b, d) {
        const hx = d.vw - 0.01, hz = d.vd - 0.03;
        b.box([0, 0.47, 0], [2 * hx, 0.56, 2 * hz], C.line, { colors: { '+y': 0x46515c } });
        b.box([0, 1.05, -0.15], [2 * hx - 0.08, 0.6, 2.1], C.line, { colors: { '+x': C.puddle, '-x': C.puddle, '+z': C.puddle, '-z': C.puddle, '+y': 0x46515c } });
        b.segment([0, 0.75, 0.9], [0, 1.2, 0.72], 2 * hx - 0.1, 0.06, C.puddle);
        b.segment([0, 0.75, -1.3], [0, 1.2, -1.08], 2 * hx - 0.1, 0.06, C.puddle);
        for (const s of [-1, 1]) for (const z of [-1.3, 1.3]) b.box([s * (hx - 0.05), 0.31, z], [0.1, 0.62, 0.62], C.hair);
        b.box([0, 0.3, hz + 0.01], [2 * hx, 0.14, 0.04], C.dark);
        for (const s of [-1, 1]) b.box([s * (hx - 0.14), 0.62, hz + 0.012], [0.2, 0.07, 0.02], C.lowSteady);
        // 描边沿着真实轮廓：车尾（0.2–0.75）+ 车厢近端（0.75–1.35）
        blockEdges(b, hx, hz, 0.75, { y0: 0.2 });
        b.with({ chalk: 1 }, () => {
          for (const s of [-1, 1]) b.box([s * (hx - 0.05), 1.05, 0.9], [0.02, 0.6, 0.02], C.secondary);
          b.box([0, 1.35, 0.9], [2 * hx - 0.1, 0.02, 0.02], C.chalkLine);
        });
      },
    },
  ],
});
