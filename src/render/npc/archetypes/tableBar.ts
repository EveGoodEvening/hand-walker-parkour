// archetypes/tableBar.ts —— 报名长桌 / 课桌 / 实验台（bar，§2.5：横杆，下面一道深缝，杆底一条细白线）。
// 碰撞只管「杆」那一段（y0..y1）；桌腿都在车道外沿（|x| ≈ 半宽），伏低的玩家从桌腿之间钻过去，桌腿不挡路。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { barLine, slitShadow } from '../shapes';

export default defineArchetype({
  id: 'tableBar', material: 'lambert', cap: 48,
  variants: [
    {
      name: 'longTable', kind: 'longTable',
      build(b, d) {
        const w = 2 * d.vw, dep = 2 * d.vd;
        // 桌面、垂到 0.38 的桌布（前、两侧）、四条桌腿、桌面上的一摞报名表
        b.box([0, 0.78, 0], [w, 0.04, dep], C.deskTop, { colors: { '+y': 0xb9b4a8 } });
        b.box([0, 0.585, d.vd - 0.012], [w, 0.39, 0.024], C.wainscot, { colors: { '+z': 0x5a7873 } });
        for (const s of [-1, 1]) b.box([s * (d.vw - 0.012), 0.585, 0], [0.024, 0.39, dep - 0.02], C.wainscot);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * (d.vw - 0.05), 0.19, sz * (d.vd - 0.06)], [0.04, 0.38, 0.04], C.deskLeg);
        b.box([0.18, 0.815, 0.05], [0.24, 0.03, 0.18], C.paper);
        b.box([-0.2, 0.81, -0.1], [0.2, 0.02, 0.26], 0xd8dcda);
        barLine(b, d, { y: d.bottom + 0.005 });
        slitShadow(b, w - 0.1, dep);
      },
    },
    {
      name: 'deskBar', kind: 'deskBar',
      build(b, d) {
        const w = 2 * d.vw, dep = 2 * d.vd;
        // 课桌：桌面、桌肚；碰撞是桌肚下面那块横板（0.38–0.46）
        b.box([0, 0.735, 0], [w, 0.03, dep], C.deskTop, { colors: { '+y': 0xb9b4a8 } });
        b.box([0, 0.62, 0], [w - 0.06, 0.2, dep - 0.04], 0x8f8a7e, { colors: { '+z': 0x7d786d } });
        b.box([0, 0.415, 0], [w - 0.03, 0.07, dep - 0.02], 0x6b6f6a, { colors: { '+y': 0x7b7f7a } });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * (d.vw - 0.02), 0.36, sz * (d.vd - 0.02)], [0.035, 0.72, 0.035], C.deskLeg);
        barLine(b, d, { y: d.bottom + 0.005 });
        slitShadow(b, w - 0.06, dep);
      },
    },
    {
      name: 'labBench', kind: 'labBench',
      build(b, d) {
        const w = 2 * d.vw, dep = 2 * d.vd;
        // 实验台：黑色台面、浅灰柜体（0.40–0.90）、柜门缝、台面上的水龙头；下面是踢脚空档和四条短腿
        b.box([0, 0.92, 0], [w, 0.04, dep], C.darker, { colors: { '+y': C.dark } });
        b.box([0, 0.65, 0], [w - 0.04, 0.5, dep - 0.06], C.terrazzoLight, { colors: { '+z': 0xa7adab } });
        for (const x of [-w / 6, w / 6]) b.box([x, 0.65, d.vd - 0.028], [0.01, 0.46, 0.006], C.terrazzoDark);
        for (const x of [-0.12, 0.12]) b.box([x, 0.62, d.vd - 0.026], [0.05, 0.012, 0.01], C.steel);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([sx * (d.vw - 0.05), 0.2, sz * (d.vd - 0.06)], [0.05, 0.4, 0.05], C.deskLeg);
        for (const x of [-0.25, 0.25]) {
          b.segment([x, 0.94, -0.3], [x, 1.08, -0.3], 0.025, 0.025, C.steel);
          b.segment([x, 1.08, -0.3], [x, 1.08, -0.22], 0.02, 0.02, C.steel);
        }
        barLine(b, d, { y: d.bottom + 0.005 });
        slitShadow(b, w - 0.1, dep);
      },
    },
  ],
});
