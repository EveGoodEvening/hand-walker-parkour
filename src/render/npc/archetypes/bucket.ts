// archetypes/bucket.ts —— 拖把桶 / 标志桶（low，§2.5：扁宽，顶边一道粉笔白）。
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { chalkTop } from '../shapes';

export default defineArchetype({
  id: 'bucket', material: 'lambert', cap: 32,
  variants: [
    {
      name: 'mopBucket', kind: 'mopBucket',
      build(b, d) {
        // 桶身（上宽下窄）、桶沿、水面、后部的拧水器、搭在前沿上的拖把头
        b.prism([0, 0, 0.01], 0.165, 0.2, 0.3, 8, C.wainscotTop, { top: 0x9fb2c0, bottom: null });
        b.prism([0, 0.3, 0.01], 0.205, 0.205, 0.025, 8, 0x3e5553, { top: 0x3e5553 });
        b.box([0, 0.35, -0.1], [0.28, 0.08, 0.1], C.deskLeg, { colors: { '+y': 0x6b7270 } });
        b.box([0, 0.375, -0.1], [0.3, 0.02, 0.02], C.steel);
        for (let i = 0; i < 5; i++) {
          const x = -0.1 + i * 0.05;
          b.segment([x, 0.33, 0.14], [x + 0.01 * (i % 2), 0.12 + 0.02 * (i % 3), 0.2], 0.035, 0.02, 0xb7bdbb);
        }
        chalkTop(b, d, { y: 0.335, w: 0.26, z: 0.2 });
      },
    },
    {
      name: 'cone', kind: 'cone',
      build(b, d) {
        // 标志桶：方底座 + 三段圆台（浅 / 深 / 浅），顶尖一圈粉笔白
        b.box([0, 0.012, 0], [2 * d.vw - 0.02, 0.024, 2 * d.vd - 0.02], C.trackLine, { colors: { '+y': 0xb7bdbb } });
        b.prism([0, 0.024, 0], 0.125, 0.09, 0.12, 8, C.trackLine, { top: C.trackLine });
        b.prism([0, 0.144, 0], 0.09, 0.062, 0.08, 8, C.dark, { top: C.dark });
        b.prism([0, 0.224, 0], 0.062, 0.03, 0.12, 8, C.trackLine, { top: C.trackLine });
        b.with({ chalk: 1 }, () => b.prism([0, 0.344, 0], 0.03, 0.012, 0.044, 8, C.chalkWhite, { top: C.chalkWhite }));
      },
    },
  ],
});
