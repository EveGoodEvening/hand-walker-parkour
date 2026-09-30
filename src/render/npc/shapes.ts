// src/render/npc/shapes.ts —— 剪影语言的公共构件（DESIGN.md §2.5、§5.3 aChalk、R12）。
//   low   ：顶边一道粉笔白（chalkTop）
//   bar   ：杆底一条细白线（barLine）+ 下面一道深缝（slitShadow：地上一条暗带，让缝「读」起来是深的）
//   block ：竖棱描边（blockEdges：近端两条竖棱 + 顶棱，暗场由 LampField 的 uChalk 点亮）
import { C } from './colors';
import type { Dims } from './archetype';
import type { PartBuilder } from './material';

/** low：近端顶边一道粉笔白（aChalk = 1）。y 为顶面高度，缺省 d.top。 */
export function chalkTop(b: PartBuilder, d: Dims, o: { y?: number; w?: number; z?: number } = {}): void {
  const y = o.y ?? d.top;
  const w = o.w ?? 2 * d.vw - 0.02;
  const z = o.z ?? d.vd - 0.012;
  b.with({ chalk: 1 }, () => b.box([0, y - 0.016, z], [w, 0.032, 0.034], C.chalkWhite));
}

/** bar：近端下沿一条细白线（aChalk = 1）。 */
export function barLine(b: PartBuilder, d: Dims, o: { z?: number; w?: number; y?: number } = {}): void {
  const y = o.y ?? d.bottom;
  b.with({ chalk: 1 }, () => b.box([0, y + 0.012, o.z ?? d.vd - 0.012], [o.w ?? 2 * d.vw, 0.024, 0.024], C.chalkWhite));
}

/** bar：杆下地面的暗带（深缝）。 */
export function slitShadow(b: PartBuilder, w: number, depth: number, z = 0): void {
  b.quad([-w / 2, 0.004, z + depth / 2], [w / 2, 0.004, z + depth / 2], [w / 2, 0.004, z - depth / 2], [-w / 2, 0.004, z - depth / 2], 0x262d33);
}

/** block：近端两条竖棱 + 近端顶棱（竖棱 aChalk = 1，顶棱 0.6）。 */
export function blockEdges(b: PartBuilder, halfX: number, halfZ: number, h: number, o: { y0?: number; far?: boolean } = {}): void {
  const y0 = o.y0 ?? 0;
  b.with({ chalk: 1 }, () => {
    for (const x of [-halfX, halfX]) {
      b.box([x, (y0 + h) / 2, halfZ], [0.02, h - y0, 0.02], C.secondary);
      if (o.far) b.box([x, (y0 + h) / 2, -halfZ], [0.02, h - y0, 0.02], C.secondary);
    }
  });
  b.with({ chalk: 0.6 }, () => b.box([0, h - 0.01, halfZ], [2 * halfX, 0.02, 0.02], C.chalkLine));
}

/** 竖直圆柱体上的两条近端竖向描边（圆桶、路桩用）。 */
export function roundEdges(b: PartBuilder, r: number, h: number, zScale = 1): void {
  b.with({ chalk: 1 }, () => {
    for (const a of [Math.PI * 0.3, Math.PI * 0.7]) {
      b.box([Math.cos(a) * r, h / 2, Math.sin(a) * r * zScale], [0.018, h, 0.018], C.secondary);
    }
  });
}

/** 横向条纹杆（栏架、电子栏杆）：沿 x 从 x0 到 x1，n 段交替两色。 */
export function stripedBar(b: PartBuilder, x0: number, x1: number, y: number, z: number, h: number, dz: number, n: number, c0: number, c1: number): void {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) b.box([x0 + w * (i + 0.5), y, z], [w, h, dz], i % 2 ? c1 : c0);
}
