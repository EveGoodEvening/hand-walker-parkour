// archetypes/shutter.ts —— 半开的卷帘门（bar，§2.5；3-6 卷帘门街）。瓦楞门板停在离地 0.40 m，下面一道深缝，
// 底梁一条细白线；两侧导轨落地（在车道外沿）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { barLine, slitShadow } from '../shapes';

export default defineArchetype({
  id: 'shutter', material: 'lambert', cap: 16,
  variants: [
    {
      name: 'shutterHalf', kind: 'shutterHalf',
      build(b, d) {
        const w = 2 * d.vw;
        const y0 = 0.42, y1 = 2.42;
        b.box([0, (y0 + y1) / 2, 0], [w - 0.06, y1 - y0, 0.03], C.terrazzoMid, { colors: { '+z': 0x737a78 } });
        // 瓦楞：横向凸条（只画看得见的面）
        for (let y = y0 + 0.12; y < y1 - 0.05; y += 0.2) b.box([0, y, 0.02], [w - 0.07, 0.05, 0.012], 0x7f8684, { faces: '+z+y-y' });
        // 底梁与拉手
        b.box([0, 0.415, 0.005], [w - 0.05, 0.05, 0.06], C.terrazzoDark, { colors: { '+y': 0x4a5152 } });
        b.box([0, 0.47, 0.04], [0.16, 0.025, 0.02], C.steel);
        for (const s of [-1, 1]) b.box([s * (d.vw - 0.015), 1.2, 0], [0.03, 2.4, 2 * d.vd - 0.02], C.line);
        barLine(b, d, { y: d.bottom + 0.012, w: w - 0.08, z: 0.034 });
        slitShadow(b, w - 0.1, 0.6);
      },
    },
  ],
});
