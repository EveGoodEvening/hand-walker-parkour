// archetypes/bikeDown.ts —— 倒地的自行车（low，§2.5）。横躺在车道上：两个平放的轮圈、车架、翘起的车把。
import { defineArchetype, type Dims } from '../archetype';
import { C } from '../colors';
import type { PartBuilder } from '../material';

function wheel(b: PartBuilder, cx: number, cz: number, r: number, y: number): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    b.segment([cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], 0.04, 0.035, C.hair);
  }
  b.segment([cx - r * 0.9, y + 0.005, cz], [cx + r * 0.9, y + 0.005, cz], 0.01, 0.01, C.steel);
  b.segment([cx, y + 0.005, cz - r * 0.9], [cx, y + 0.005, cz + r * 0.9], 0.01, 0.01, C.steel);
}

export default defineArchetype({
  id: 'bikeDown', material: 'lambert', cap: 16,
  variants: [
    {
      name: 'bikeDown', kind: 'bikeDown',
      build(b: PartBuilder, d: Dims) {
        void d.top;
        const r = 0.24;
        wheel(b, -d.vw + r + 0.02, 0.03, r, 0.03);
        wheel(b, d.vw - r - 0.02, -0.03, r, 0.05);
        const frame = C.line;
        // 车架：上管、下管、立管（整体略微翘起），鞋垫、车把
        b.segment([-0.3, 0.08, 0.03], [0.1, 0.14, 0.0], 0.035, 0.035, frame);
        b.segment([-0.3, 0.08, 0.03], [0.05, 0.06, -0.08], 0.035, 0.035, frame);
        b.segment([0.1, 0.14, 0.0], [0.3, 0.1, -0.03], 0.035, 0.035, frame);
        b.segment([0.05, 0.06, -0.08], [0.1, 0.14, 0.0], 0.03, 0.03, frame);
        b.box([-0.12, 0.2, 0.06], [0.22, 0.05, 0.1], C.shoe, { colors: { '+y': 0x3a3f43 } });
        b.segment([-0.12, 0.2, 0.06], [-0.05, 0.1, 0.0], 0.025, 0.025, frame);
        b.segment([0.28, 0.1, -0.02], [0.3, 0.3, 0.1], 0.03, 0.03, frame);
        b.segment([0.3, 0.3, 0.1], [0.3, 0.31, -0.18], 0.028, 0.028, C.steel);
        b.box([0.3, 0.315, 0.14], [0.035, 0.035, 0.08], C.hair);
        // 顶边的粉笔白：车把上沿、鞍座上沿、上管上沿
        b.with({ chalk: 1 }, () => {
          b.segment([0.3, 0.33, 0.1], [0.3, 0.335, -0.18], 0.01, 0.008, C.chalkWhite);
          b.box([-0.12, 0.228, 0.06], [0.22, 0.008, 0.012], C.chalkWhite);
          b.segment([-0.3, 0.1, 0.03], [0.1, 0.16, 0.0], 0.012, 0.01, C.chalkWhite);
        });
      },
    },
  ],
});
