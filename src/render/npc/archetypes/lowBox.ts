// archetypes/lowBox.ts —— 书包 / 书 / 报纸堆（low，§2.5：扁宽，顶边一道粉笔白）。
import * as THREE from 'three';
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { chalkTop } from '../shapes';

const rotY = (a: number) => new THREE.Matrix4().makeRotationY(a);

export default defineArchetype({
  id: 'lowBox', material: 'lambert', cap: 64,
  variants: [
    {
      name: 'bag', kind: 'bag',
      build(b, d) {
        const w = 2 * d.vw - 0.02, dep = 2 * d.vd - 0.03;
        // 平放的书包：包身、顶部圆鼓、前袋、两条背带
        b.box([0, 0.14, 0], [w, 0.28, dep], C.bag, { colors: { '+y': 0x4a5560, '+z': 0x37414a } });
        b.box([0, 0.295, -0.01], [w - 0.06, 0.03, dep - 0.06], 0x46515c);
        b.box([0, 0.1, dep / 2 + 0.012], [w * 0.62, 0.13, 0.024], 0x343d46, { colors: { '+y': 0x2a3136 } });
        b.box([0, 0.17, dep / 2 + 0.026], [w * 0.5, 0.012, 0.006], 0x5b6468);
        for (const x of [-0.08, 0.08]) b.box([x, 0.315, 0], [0.04, 0.01, dep - 0.02], 0x2a3136);
        chalkTop(b, d, { y: d.top - 0.005, w: w - 0.06, z: d.vd - 0.04 });
      },
    },
    {
      name: 'books', kind: 'books',
      build(b, d) {
        const cols = [0x2f4a6d, 0x8a979e, 0x5b6468, 0x3c4650, 0x9fb2c0];
        const n = 5, h = 0.25 / n;
        for (let i = 0; i < n; i++) {
          const a = (i % 2 ? 1 : -1) * 0.05 * ((i * 7) % 3);
          const w = 2 * d.vw - 0.05 - (i % 3) * 0.02, dep = 2 * d.vd - 0.05 - ((i + 1) % 2) * 0.02;
          b.withMatrix(rotY(a), () => {
            b.box([0, h * (i + 0.5), 0], [w, h - 0.004, dep], cols[i % cols.length] as number, { colors: { '+z': i % 2 ? 0xd9dee3 : 0x33404a, '-x': 0xd9dee3 } });
          });
        }
        b.box([0, 0.255, 0], [2 * d.vw - 0.08, 0.012, 2 * d.vd - 0.07], 0x9aa3a4);
        chalkTop(b, d, { y: d.top - 0.02, w: 2 * d.vw - 0.08, z: d.vd - 0.04 });
      },
    },
    {
      name: 'newspapers', kind: 'newspapers',
      build(b, d) {
        const cols = [0xb7bdbb, 0x9aa3a4, 0xc9cfcf, 0xa7adab];
        const n = 4, h = 0.22 / n;
        for (let i = 0; i < n; i++) {
          const a = (i % 2 ? 1 : -1) * 0.04;
          b.withMatrix(rotY(a), () => b.box([0, h * (i + 0.5), 0], [2 * d.vw - 0.06, h - 0.006, 2 * d.vd - 0.06], cols[i] as number, { colors: { '+z': 0xd8dcda } }));
        }
        // 捆扎的绳子
        b.box([0, 0.224, 0], [0.012, 0.008, 2 * d.vd - 0.05], 0x3e4546);
        b.box([0, 0.224, 0], [2 * d.vw - 0.05, 0.008, 0.012], 0x3e4546);
        for (const x of [-(d.vw - 0.03), d.vw - 0.03]) b.box([x, 0.11, 0], [0.008, 0.22, 0.012], 0x3e4546);
        chalkTop(b, d, { y: d.top - 0.025, w: 2 * d.vw - 0.08, z: d.vd - 0.04 });
      },
    },
  ],
});
