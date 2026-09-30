// archetypes/floorDecal.ts —— 水渍 / 水洼 / 湿落叶（soft，§2.5：反光）。贴地、透明、不写深度，亮度随 LampField（lampLit）。
// 形状是不规则的多边形，边缘用逐顶点不透明度淡出。水洼的倒影由 WP5 的反光面负责，这里只是地上的那一摊水。
import { createRng } from '../../../core/rng';
import { defineArchetype, type Dims } from '../archetype';
import type { PartBuilder } from '../material';

const Y = 0.005;

/** 不规则的一摊：中心 → 内圈（a1）→ 外圈（a2，淡出）。 */
function blob(b: PartBuilder, d: Dims, seed: number, center: number, rim: number, a0: number, a1: number, a2: number, k1 = 0.78): void {
  const rng = createRng(seed, 'blob');
  const n = 14;
  const rs: number[] = [];
  for (let i = 0; i < n; i++) rs.push(0.82 + 0.18 * rng.next());
  const pt = (i: number, k: number): [number, number, number] => {
    const a = (i / n) * Math.PI * 2;
    const r = (rs[i % n] as number) * k;
    return [Math.cos(a) * d.vw * r, Y, Math.sin(a) * d.vd * r];
  };
  for (let i = 0; i < n; i++) {
    b.with({ alpha: a0 }, () => b.tri([0, Y, 0], pt(i + 1, k1), pt(i, k1), center));
  }
  // 外圈：内点 a1、外点 a2（逐顶点插值 → 边缘淡出）
  for (let i = 0; i < n; i++) {
    const p0 = pt(i, k1), p1 = pt(i + 1, k1), q0 = pt(i, 1), q1 = pt(i + 1, 1);
    b.with({ alpha: a1 }, () => b.tri(p0, p1, q1, rim));
    b.with({ alpha: a2 }, () => b.tri(p0, q1, q0, rim));
  }
}

export default defineArchetype({
  id: 'floorDecal', material: 'decal', cap: 48,
  variants: [
    {
      name: 'wet', kind: 'wet',
      build(b, d) {
        blob(b, d, 11, 0xc9d6de, 0xb5c4cc, 0.42, 0.36, 0.0);
        // 两道拖把拖过的亮痕
        for (const z of [-0.18, 0.16]) b.with({ alpha: 0.35 }, () => b.quad([-d.vw * 0.7, Y + 0.001, z + 0.03], [d.vw * 0.7, Y + 0.001, z + 0.02], [d.vw * 0.7, Y + 0.001, z - 0.02], [-d.vw * 0.7, Y + 0.001, z - 0.01], 0xeef6ff));
      },
    },
    {
      name: 'puddle', kind: 'puddle',
      build(b, d) {
        blob(b, d, 23, 0x22323b, 0x9fb2c0, 0.72, 0.5, 0.05, 0.84);
      },
    },
    {
      name: 'leaves', kind: 'leaves',
      build(b, d) {
        blob(b, d, 37, 0x5d6b73, 0x5d6b73, 0.22, 0.16, 0.0);
        const rng = createRng(41, 'leaves');
        const cols = [0x4e5a48, 0x6a675c, 0x5e6b5a, 0x3e4a3a, 0x77756a];
        for (let i = 0; i < 16; i++) {
          const x = rng.range(-0.8, 0.8) * d.vw, z = rng.range(-0.8, 0.8) * d.vd;
          const a = rng.range(0, Math.PI), l = rng.range(0.07, 0.11), w = l * 0.45;
          const ca = Math.cos(a), sa = Math.sin(a);
          const y = Y + 0.002 + i * 0.0002;
          const p = (u: number, v: number): [number, number, number] => [x + ca * u - sa * v, y, z + sa * u + ca * v];
          b.with({ alpha: 0.95 }, () => b.quad(p(-l, 0), p(0, w), p(l, 0), p(0, -w), cols[i % cols.length] as number));
        }
      },
    },
  ],
});
