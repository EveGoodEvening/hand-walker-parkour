// archetypes/column.ts —— 垃圾桶 / 柱子 / 储物柜 / 路桩（block，§2.5：竖直的高剪影）。
// 储物柜的柜门朝车道中央：放在左侧车道时门朝 +x，右侧朝 −x（ObstacleView 按车道选择朝向）。超长的一排柜子平铺成多个实例。
import * as THREE from 'three';
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import { blockEdges, roundEdges } from '../shapes';

export default defineArchetype({
  id: 'column', material: 'lambert', cap: 96,
  variants: [
    {
      name: 'bin', kind: 'bin',
      build(b) {
        b.prism([0, 0, 0], 0.2, 0.225, 0.86, 8, C.wainscotTop);
        b.prism([0, 0.86, 0], 0.235, 0.235, 0.05, 8, 0x3e5553, { top: 0x46605c });
        b.prism([0, 0.91, 0], 0.12, 0.08, 0.04, 8, 0x3e5553);
        b.prism([0, 0.3, 0], 0.212, 0.214, 0.06, 8, 0x5a7873);
        roundEdges(b, 0.215, 0.86);
      },
    },
    {
      name: 'pillar', kind: 'pillar',
      build(b, d) {
        const hx = d.vw - 0.012, hz = d.vd - 0.012;
        b.box([0, 1.5, 0], [2 * hx, 3.0, 2 * hz], C.wall, { colors: { '+z': 0xbfc5c5 } });
        b.box([0, 0.5, 0], [2 * hx + 0.01, 1.0, 2 * hz + 0.01], C.wainscot, { faces: '+x-x+z-z' });
        b.box([0, 1.01, 0], [2 * hx + 0.02, 0.03, 2 * hz + 0.02], C.wainscotTop, { faces: '+x-x+z-z+y' });
        blockEdges(b, hx, hz, 3.0);
      },
    },
    {
      name: 'locker', kind: 'locker',
      build(b, d) {
        // 一格储物柜（沿 s 两扇门）；门面在 ±x 两侧都画（放在哪一侧都朝向车道）
        const hx = d.vw - 0.015, hz = d.vd - 0.005;
        b.box([0, 0.9, 0], [2 * hx, 1.8, 2 * hz], 0x7e8f99, { colors: { '+y': 0x8d9ca5, '+z': 0x72838c } });
        for (const s of [-1, 1]) {
          b.box([s * (hx + 0.002), 0.95, 0], [0.004, 1.6, 0.012], C.line);
          for (const z of [-hz / 2, hz / 2]) {
            b.box([s * (hx + 0.004), 1.45, z], [0.006, 0.12, 0.14], 0x5b6468);
            b.box([s * (hx + 0.006), 0.95, z + (z > 0 ? -0.08 : 0.08)], [0.01, 0.1, 0.02], C.steel);
          }
        }
        b.box([0, 0.05, 0], [2 * hx + 0.01, 0.1, 2 * hz + 0.01], C.dark, { faces: '+x-x+z' });
        blockEdges(b, hx + 0.005, hz, 1.8);
      },
    },
    {
      name: 'bollard', kind: 'bollard',
      build(b, d) {
        // 路桩：扁圆柱（按碰撞盒 0.24 × 0.12 压扁），反光环，圆顶
        const zs = Math.min(1, d.vd / d.vw);
        b.withMatrix(new THREE.Matrix4().makeScale(1, 1, zs), () => {
          b.prism([0, 0, 0], d.vw, d.vw - 0.01, 0.84, 8, C.dark);
          b.prism([0, 0.62, 0], d.vw + 0.004, d.vw + 0.004, 0.07, 8, C.sole);
          b.prism([0, 0.84, 0], d.vw - 0.01, 0.03, 0.07, 8, C.line);
        });
        roundEdges(b, d.vw, 0.84, zs);
      },
    },
  ],
});
