// archetypes/kneeler.ts —— 梦里跪着模仿的人（low，§4.4 4-1 / 4-2）。没有五官：脸朝地，只看得见头顶和后脑。
// 变体：kneel（跪伏，身体在发抖）、fallen（摔倒侧躺）、reachL / reachR（伸出手臂拦路的人：跪在车道缝里，身体前倾；
// 伸进车道的那只手臂属于 armBar 的 reach 变体）。衣服用 instanceColor 着色：人群是梦里的浅灰，
// 4-2 那个男生更浅、更干净（「裤脚很干净，鞋也很干净」）。
// 校服两侧的白条沿着背脊最高处，正好是 low 的「顶边一道粉笔白」。
import * as THREE from 'three';
import { defineArchetype } from '../archetype';
import { C } from '../colors';
import type { PartBuilder } from '../material';

const SHIRT = 0xffffff, PANTS = 0xc8c8c8;

/** 梦里人群 / 男生的衣服颜色（instanceColor）。 */
export const KNEELER_CROWD = new THREE.Color(0x8e979b);
export const KNEELER_BOY = new THREE.Color(0xd2d7da);

function head(b: PartBuilder, c: [number, number, number], faceDir: '-z' | '-y' | '+x'): void {
  // 头：脸那一面朝地 / 朝前（空白的皮肤，没有五官），其余面都是头发
  const colors: Partial<Record<string, number>> = { [faceDir]: C.skin };
  b.box(c, [0.15, 0.15, 0.16], C.hair, { colors });
}

function kneel(b: PartBuilder): void {
  b.with({ tint: 1 }, () => {
    for (const x of [-0.12, 0.12]) b.box([x, 0.045, 0.16], [0.1, 0.09, 0.28], PANTS);
    b.box([0, 0.25, 0.1], [0.36, 0.13, 0.2], PANTS);
    b.segment([0, 0.28, 0.06], [0, 0.22, -0.18], 0.4, 0.14, SHIRT);
    for (const s of [-1, 1]) b.segment([s * 0.22, 0.23, -0.14], [s * 0.28, 0.03, -0.26], 0.07, 0.065, SHIRT);
  });
  for (const x of [-0.12, 0.12]) b.box([x, 0.06, 0.3], [0.09, 0.1, 0.05], C.shoe, { colors: { '+z': C.sole } });
  b.with({ chalk: 1 }, () => {
    for (const x of [-0.17, 0.17]) b.segment([x, 0.355, 0.06], [x, 0.295, -0.18], 0.02, 0.012, C.chalkWhite);
  });
  head(b, [0, 0.12, -0.24], '-y');
  for (const s of [-1, 1]) b.box([s * 0.28, 0.02, -0.29], [0.075, 0.03, 0.07], C.skin);
}

function fallen(b: PartBuilder): void {
  // 侧躺蜷着：头在 −x，躯干沿 x 侧卧，膝盖向 +z 弯
  head(b, [-0.29, 0.1, -0.04], '+x');
  b.with({ tint: 1 }, () => {
    b.segment([-0.2, 0.15, -0.02], [0.1, 0.15, 0.0], 0.34, 0.26, SHIRT);
    b.box([0.16, 0.13, 0.02], [0.14, 0.24, 0.3], PANTS);
    b.segment([0.16, 0.1, 0.08], [0.28, 0.1, 0.24], 0.2, 0.1, PANTS);
    b.segment([0.28, 0.1, 0.24], [0.08, 0.1, 0.28], 0.18, 0.09, PANTS);
    b.segment([-0.14, 0.05, 0.12], [-0.3, 0.03, 0.22], 0.07, 0.06, SHIRT);
  });
  b.box([0.03, 0.1, 0.28], [0.1, 0.16, 0.06], C.shoe, { colors: { '-x': C.sole } });
  b.with({ chalk: 1 }, () => b.segment([-0.2, 0.3, -0.02], [0.1, 0.3, 0.0], 0.02, 0.012, C.chalkWhite));
}

function reachSide(b: PartBuilder, outer: 1 | -1): void {
  // 跪坐、身体前倾（朝 −z），肩高 0.49；内侧手臂属于 armBar.reach；外侧手臂垂到地上
  b.with({ tint: 1 }, () => {
    for (const x of [-0.1, 0.1]) b.box([x, 0.045, 0.22], [0.1, 0.09, 0.3], PANTS);
    b.box([0, 0.24, 0.2], [0.32, 0.16, 0.2], PANTS);
    b.segment([0, 0.3, 0.14], [0, 0.46, -0.02], 0.34, 0.16, SHIRT);
    b.segment([outer * 0.17, 0.47, 0.0], [outer * 0.2, 0.06, -0.08], 0.07, 0.065, SHIRT);
  });
  for (const x of [-0.1, 0.1]) b.box([x, 0.06, 0.37], [0.09, 0.1, 0.05], C.shoe, { colors: { '+z': C.sole } });
  b.with({ chalk: 1 }, () => {
    for (const x of [-0.15, 0.15]) b.segment([x, 0.38, 0.14], [x, 0.54, -0.02], 0.02, 0.012, C.chalkWhite);
  });
  head(b, [0, 0.55, -0.1], '-z');
  b.box([outer * 0.2, 0.02, -0.1], [0.075, 0.03, 0.07], C.skin);
}

export default defineArchetype({
  id: 'kneeler', material: 'lambert', cap: 48, color: true,
  variants: [
    { name: 'kneel', kind: 'kneeler', build: (b) => kneel(b) },
    { name: 'fallen', build: (b) => fallen(b) },
    { name: 'reachL', build: (b) => reachSide(b, -1) },
    { name: 'reachR', build: (b) => reachSide(b, 1) },
  ],
});
