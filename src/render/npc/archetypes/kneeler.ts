// archetypes/kneeler.ts —— 梦里跪着模仿的人（low，§4.4 4-1 / 4-2）。没有五官：脸朝地，只看得见头顶和后脑。
// 变体：kneel（跪伏，身体在发抖）、fallen（摔倒侧躺）、reachL / reachR（伸出手臂拦路的人：跪在车道缝里，身体前倾；
// 伸进车道的那只手臂属于 armBar 的 reach 变体）、reachBoth（相邻两条车道的手臂从同一个人身上伸出来）。
// 每个实例只画本帧用到的变体（ranges：跪伏排最前，人群里几乎全是它）。衣服用 instanceColor 着色：人群是梦里的浅灰，
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

function head(b: PartBuilder, c: [number, number, number], faceDir: '-z' | '-y' | '+z'): void {
  // 头：脸那一面朝地 / 朝前（空白的皮肤，没有五官），其余面都是头发
  const colors: Partial<Record<string, number>> = { [faceDir]: C.skin };
  b.box(c, [0.15, 0.15, 0.16], C.hair, { colors });
}

/** 一只手（皮肤色），平放在地上：底面贴地，不画。 */
function hand(b: PartBuilder, c: [number, number, number]): void {
  b.box(c, [0.075, 0.03, 0.07], C.skin, { faces: '+x-x+y+z-z' });
}

/**
 * 跪伏（伏在地上叩头）：膝盖跪地、小腿平放向后、臀部坐在脚跟上，背朝上微微拱起，额头贴近地面，
 * 两肘撑开、前臂平放在头的两侧。玩家多半从背后看：看见的是两只鞋底、坐在脚跟上的臀部和弓着的背（审查 npc-seated-3：
 * 以前没有大腿，盆骨悬在小腿上 9.5 cm，两臂斜撑到地上，背后看像一张四条腿的矮桌）。
 * 碰撞盒 0.64 × 0.60 × 0.35：两肘在 |x| ≈ 0.30，鞋跟到手指 z ∈ [−0.33, 0.31]，粉笔线在背上最高处（0.36）。
 */
function kneel(b: PartBuilder): void {
  b.with({ tint: 1 }, () => {
    for (const x of [-0.085, 0.085]) {
      // 小腿平放（膝盖在 z ≈ −0.02，脚背到 +0.26）；大腿从膝盖斜向后上到坐在脚跟上的臀部
      b.box([x, 0.04, 0.12], [0.11, 0.08, 0.28], PANTS, { faces: '+x-x+y+z-z' });
      b.segment([x, 0.075, -0.01], [x, 0.16, 0.15], 0.13, 0.12, PANTS);
    }
    b.box([0, 0.175, 0.17], [0.3, 0.15, 0.17], PANTS, { faces: '+x-x+y+z-z' });
    b.segment([0, 0.27, 0.13], [0, 0.28, -0.12], 0.36, 0.15, SHIRT);
    for (const s of [-1, 1]) {
      // 上臂从肩膀撑开到地上的肘，前臂平放着收回到头的两侧
      b.segment([s * 0.17, 0.27, -0.09], [s * 0.26, 0.05, -0.13], 0.075, 0.07, SHIRT);
      b.segment([s * 0.26, 0.035, -0.13], [s * 0.16, 0.03, -0.26], 0.075, 0.055, SHIRT, { faces: '+x-x+y+z-z' });
    }
  });
  // 鞋：脚背贴地，鞋底朝后（玩家从背后看见两只鞋底）
  for (const x of [-0.085, 0.085]) b.box([x, 0.045, 0.285], [0.1, 0.07, 0.05], C.shoe, { faces: '+x-x+y+z-z', colors: { '+z': C.sole } });
  b.with({ chalk: 1 }, () => {
    for (const x of [-0.16, 0.16]) b.segment([x, 0.351, 0.13], [x, 0.361, -0.12], 0.02, 0.012, C.chalkWhite, { faces: '+x-x+y+z-z' });
  });
  head(b, [0, 0.095, -0.22], '-y');
  for (const s of [-1, 1]) hand(b, [s * 0.15, 0.015, -0.29]);
}

/**
 * 摔倒侧躺（4-2「他跪进中道，摔倒，躺在那里」，以及被碰倒的人）：向右侧躺，身体沿 x 横在车道上，脸和胸口朝 +z（朝玩家），
 * 膝盖收到胸前，一只手臂顺着爬的方向伸在地上。侧躺时肩宽变成高度：躯干 0.20 厚、0.28 高，最高处 ≈ 0.29。
 * 头、躯干、腿之间留 2–3 cm 的断开，亮场（广场没有粉笔描边）也能读出头、身子、腿（审查 npc-seated-4）。
 */
function fallen(b: PartBuilder): void {
  head(b, [-0.3, 0.09, -0.08], '+z');
  b.with({ tint: 1 }, () => {
    b.segment([-0.2, 0.14, -0.07], [0.08, 0.14, 0.0], 0.2, 0.28, SHIRT, { faces: '+x-x+y+z-z' });
    b.box([0.155, 0.1, 0.02], [0.15, 0.2, 0.2], PANTS, { faces: '+x-x+y+z-z' });
    // 两条腿叠在一起：大腿收向胸前（+z），小腿折回去
    b.segment([0.15, 0.08, 0.09], [0.0, 0.08, 0.25], 0.13, 0.16, PANTS, { faces: '+x-x+y+z-z' });
    b.segment([0.0, 0.065, 0.26], [0.2, 0.06, 0.3], 0.1, 0.13, PANTS, { faces: '+x-x+y+z-z' });
    // 伸出去的手臂：从肩膀顺着地面伸过头顶
    b.segment([-0.17, 0.05, 0.04], [-0.31, 0.03, 0.12], 0.07, 0.06, SHIRT, { faces: '+x-x+y+z-z' });
  });
  b.box([0.25, 0.06, 0.31], [0.07, 0.12, 0.1], C.shoe, { faces: '+x-x+y+z-z', colors: { '+x': C.sole } });
  hand(b, [-0.345, 0.015, 0.14]);
  b.with({ chalk: 1 }, () => b.segment([-0.2, 0.285, -0.07], [0.08, 0.285, 0.0], 0.02, 0.012, C.chalkWhite, { faces: '+x-x+y+z-z' }));
}

/**
 * 伸出手臂拦路的人：跪坐（臀部坐在脚跟上，大腿平放）、身体前倾（朝 −z），肩高 0.47；伸进车道的手臂属于 armBar.reach。
 * outer = 外侧那只手（±1）撑在膝盖前面的地上；0 = 两只手都伸进车道（reachBoth：两条车道的手臂在同一个人身上，armBar 负责画）。
 * 外侧的手收在身体宽度以内（|x| ≤ 0.17），跪在车道缝里也不碰旁边车道的人（审查 npc-seated-5）。
 */
function reachSide(b: PartBuilder, outer: 1 | -1 | 0): void {
  b.with({ tint: 1 }, () => {
    for (const x of [-0.1, 0.1]) {
      b.box([x, 0.04, 0.22], [0.1, 0.08, 0.3], PANTS, { faces: '+x-x+y+z-z' });
      b.segment([x, 0.12, 0.06], [x, 0.15, 0.24], 0.12, 0.1, PANTS);
    }
    b.box([0, 0.17, 0.27], [0.3, 0.16, 0.16], PANTS, { faces: '+x-x+y+z-z' });
    b.segment([0, 0.22, 0.22], [0, 0.46, -0.02], 0.34, 0.16, SHIRT);
    if (outer !== 0) b.segment([outer * 0.15, 0.45, -0.04], [outer * 0.13, 0.06, -0.15], 0.07, 0.065, SHIRT);
  });
  for (const x of [-0.1, 0.1]) b.box([x, 0.05, 0.37], [0.09, 0.08, 0.05], C.shoe, { faces: '+x-x+y+z-z', colors: { '+z': C.sole } });
  b.with({ chalk: 1 }, () => {
    // 背脊最高处：躯干中线沿法线（0, 0.74, 0.68）抬高半个厚度
    for (const x of [-0.15, 0.15]) b.segment([x, 0.28, 0.274], [x, 0.52, 0.034], 0.02, 0.012, C.chalkWhite, { faces: '+x-x+y+z-z' });
  });
  head(b, [0, 0.55, -0.1], '-z');
  if (outer !== 0) hand(b, [outer * 0.13, 0.015, -0.18]);
}

export default defineArchetype({
  id: 'kneeler', material: 'lambert', cap: 48, color: true, ranges: true,
  variants: [
    { name: 'kneel', kind: 'kneeler', build: (b) => kneel(b) },
    { name: 'fallen', build: (b) => fallen(b) },
    { name: 'reachL', build: (b) => reachSide(b, -1) },
    { name: 'reachR', build: (b) => reachSide(b, 1) },
    { name: 'reachBoth', build: (b) => reachSide(b, 0) },
  ],
});
