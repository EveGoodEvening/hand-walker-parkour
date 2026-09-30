// archetypes/kneeler.ts —— 梦里跪着模仿的人（low，§4.4 4-1 / 4-2）。没有五官：脸朝地，只看得见头顶和后脑。
// 变体：kneel（跪伏，身体在发抖）、fallen（摔倒侧躺）、boyKneel / boyFallen（「裤脚很干净，鞋也很干净」的男生，4-2 fallInto）、
//       reachL / reachR（伸出手臂拦路的人：跪在车道缝里，身体前倾；伸进车道的那只手臂属于 armBar 的 reach 变体）。
// 校服两侧的白条沿着背脊最高处，正好是 low 的「顶边一道粉笔白」。
import { defineArchetype, type Dims } from '../archetype';
import { C } from '../colors';
import type { PartBuilder } from '../material';

interface Palette { pants: number; shirt: number; shoe: number; sole: number }
const CROWD: Palette = { pants: 0x7e878b, shirt: 0x9aa3a6, shoe: 0x5b6468, sole: 0xcfd4d6 };
const BOY: Palette = { pants: 0xaeb4b7, shirt: 0xc3c8cb, shoe: 0xe4e8ea, sole: 0xeef1f2 };

function head(b: PartBuilder, c: [number, number, number], faceDir: '-z' | '-y' | '+x' | '-x'): void {
  // 头：皮肤色的块，脸那一面朝地 / 朝前，其余面都是头发（没有五官）
  const hair = C.hair;
  const colors: Partial<Record<string, number>> = { '+y': hair, '-y': hair, '+z': hair, '-z': hair, '+x': hair, '-x': hair };
  colors[faceDir] = C.skin;
  b.box(c, [0.15, 0.15, 0.16], hair, { colors });
}

function kneel(b: PartBuilder, p: Palette): void {
  for (const x of [-0.11, 0.11]) {
    b.box([x, 0.045, 0.16], [0.1, 0.09, 0.28], p.pants, { colors: { '+y': 0x8a9396 } });
    b.box([x, 0.06, 0.3], [0.09, 0.1, 0.05], p.shoe, { colors: { '+z': p.sole } });
  }
  b.box([0, 0.26, 0.1], [0.34, 0.13, 0.2], p.pants);
  b.segment([0, 0.29, 0.06], [0, 0.22, -0.18], 0.36, 0.14, p.shirt);
  b.with({ chalk: 1 }, () => {
    for (const x of [-0.15, 0.15]) b.segment([x, 0.365, 0.06], [x, 0.295, -0.18], 0.02, 0.012, C.chalkWhite);
  });
  head(b, [0, 0.12, -0.25], '-y');
  for (const s of [-1, 1]) {
    b.segment([s * 0.19, 0.2, -0.14], [s * 0.2, 0.05, -0.22], 0.07, 0.065, p.shirt);
    b.segment([s * 0.2, 0.05, -0.22], [s * 0.19, 0.03, -0.29], 0.065, 0.055, p.shirt);
    b.box([s * 0.19, 0.02, -0.31], [0.075, 0.03, 0.06], C.skin);
  }
}

function fallen(b: PartBuilder, p: Palette): void {
  // 侧躺蜷着：头在 −x，躯干沿 x 侧卧，膝盖向 +z 弯
  head(b, [-0.29, 0.1, -0.04], '+x');
  b.segment([-0.2, 0.15, -0.02], [0.1, 0.15, 0.0], 0.34, 0.26, p.shirt, { colors: { '+y': 0xa8b0b3 } });
  b.with({ chalk: 1 }, () => b.segment([-0.2, 0.3, -0.02], [0.1, 0.3, 0.0], 0.02, 0.012, C.chalkWhite));
  b.box([0.16, 0.13, 0.02], [0.14, 0.24, 0.3], p.pants);
  for (const [y, dz] of [[0.07, 0.0], [0.2, 0.04]] as Array<[number, number]>) {
    b.segment([0.16, y, 0.06 + dz], [0.28, y, 0.24], 0.1, 0.1, p.pants);
    b.segment([0.28, y, 0.24], [0.08, y, 0.28], 0.09, 0.09, p.pants);
    b.box([0.02, y, 0.28], [0.1, 0.08, 0.06], p.shoe, { colors: { '-x': p.sole } });
  }
  b.segment([-0.14, 0.05, 0.12], [-0.3, 0.03, 0.22], 0.07, 0.06, p.shirt);
  b.box([-0.33, 0.02, 0.24], [0.07, 0.03, 0.06], C.skin);
}

function reachSide(b: PartBuilder, outer: 1 | -1): void {
  // 跪坐、身体前倾（朝 −z），肩高 0.49；内侧手臂属于 armBar.reach；外侧手臂垂到地上
  const p = CROWD;
  for (const x of [-0.1, 0.1]) {
    b.box([x, 0.045, 0.22], [0.1, 0.09, 0.3], p.pants);
    b.box([x, 0.06, 0.37], [0.09, 0.1, 0.05], p.shoe, { colors: { '+z': p.sole } });
  }
  b.box([0, 0.24, 0.2], [0.32, 0.16, 0.2], p.pants);
  b.segment([0, 0.3, 0.14], [0, 0.46, -0.02], 0.34, 0.16, p.shirt);
  b.with({ chalk: 1 }, () => {
    for (const x of [-0.15, 0.15]) b.segment([x, 0.38, 0.14], [x, 0.54, -0.02], 0.02, 0.012, C.chalkWhite);
  });
  head(b, [0, 0.55, -0.1], '-z');
  b.segment([outer * 0.17, 0.47, 0.0], [outer * 0.2, 0.06, -0.08], 0.07, 0.065, p.shirt);
  b.box([outer * 0.2, 0.02, -0.1], [0.075, 0.03, 0.07], C.skin);
}

export default defineArchetype({
  id: 'kneeler', material: 'lambert', cap: 48,
  variants: [
    { name: 'kneel', kind: 'kneeler', build: (b: PartBuilder, _d: Dims) => kneel(b, CROWD) },
    { name: 'fallen', build: (b) => fallen(b, CROWD) },
    { name: 'boyKneel', build: (b) => kneel(b, BOY) },
    { name: 'boyFallen', build: (b) => fallen(b, BOY) },
    { name: 'reachL', build: (b) => reachSide(b, -1) },
    { name: 'reachR', build: (b) => reachSide(b, 1) },
  ],
});
