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

/** 裤子比衬衫暗一档（乘 instanceColor 之后约 0.72 倍）：伏着、躺着时腰在哪里要看得出来。 */
const SHIRT = 0xffffff, PANTS = 0xb8b8b8;

/** 梦里人群 / 男生的衣服颜色（instanceColor）。 */
export const KNEELER_CROWD = new THREE.Color(0x8e979b);
export const KNEELER_BOY = new THREE.Color(0xd2d7da);

function head(b: PartBuilder, c: [number, number, number], faceDir: '-z' | '-y' | '+z', onFloor = false): void {
  // 头：脸那一面朝地 / 朝前（空白的皮肤，没有五官），其余面都是头发。贴地的头不画底面
  const colors: Partial<Record<string, number>> = { [faceDir]: C.skin };
  b.box(c, [0.15, 0.15, 0.16], C.hair, onFloor ? { colors, faces: '+x-x+y+z-z' } : { colors });
}

/** 一只手（皮肤色），平放在地上：底面贴地，不画。 */
function hand(b: PartBuilder, c: [number, number, number]): void {
  b.box(c, [0.075, 0.03, 0.07], C.skin, { faces: '+x-x+y+z-z' });
}

/**
 * 跪伏（伏在地上叩头）：膝盖跪地、小腿平放向后、臀部坐在脚跟上，背从臀部拱起、再向前低下去，额头贴地，
 * 两肘贴着膝盖前面着地、前臂平放、两手在额头前面。玩家多半从背后看：看见的是两只鞋底、坐在脚跟上的臀部和拱起的背
 * （审查 npc-seated-3：以前没有大腿，盆骨悬在小腿上 9.5 cm，两臂斜撑到地上，背后看像一张四条腿的矮桌）。
 * 侧面要读得出头、背、大腿（复审）：背分成腰、上背两段拱起来；头低在肩膀前下方，前面只有手、没有挡着它的手臂；
 * 大腿从膝盖斜着坐到脚跟上，裤子比衬衫暗一档，腰上分得开。
 * 碰撞盒 0.64 × 0.60 × 0.35：两肘在 |x| ≈ 0.28，鞋跟到手指 z ∈ [−0.34, 0.31]，粉笔线在背上最高处（0.36）。
 */
function kneel(b: PartBuilder): void {
  b.with({ tint: 1 }, () => {
    for (const x of [-0.085, 0.085]) {
      // 小腿平放（膝盖在 z ≈ −0.04，脚背到 +0.26）；大腿从膝盖斜向后上到坐在脚跟上的臀部
      b.box([x, 0.04, 0.11], [0.11, 0.08, 0.3], PANTS, { faces: '+x-x+y+z-z' });
      b.segment([x, 0.07, -0.06], [x, 0.17, 0.15], 0.125, 0.12, PANTS, { faces: '+x-x+y+z-z' });
    }
    b.box([0, 0.19, 0.17], [0.3, 0.15, 0.15], PANTS, { faces: '+x-x+y+z-z' });
    // 背：腰从臀部向前上拱，上背向前低下去到肩膀
    b.segment([0, 0.25, 0.17], [0, 0.29, 0.0], 0.33, 0.13, SHIRT, { faces: '+x-x+y+z-z' });
    b.segment([0, 0.29, 0.03], [0, 0.2, -0.17], 0.36, 0.14, SHIRT, { faces: '+x-x+y+z-z' });
    for (const s of [-1, 1]) {
      // 上臂从肩膀落到膝盖前面、身体两侧的肘，前臂平放着往前收，两手在额头前面
      b.segment([s * 0.16, 0.2, -0.1], [s * 0.24, 0.035, -0.07], 0.075, 0.07, SHIRT, { faces: '+x-x+y+z-z' });
      b.segment([s * 0.24, 0.028, -0.06], [s * 0.12, 0.025, -0.28], 0.07, 0.05, SHIRT, { faces: '+x-x+y+z-z' });
    }
  });
  // 鞋：脚背贴地，鞋底朝后（玩家从背后看见两只鞋底）
  for (const x of [-0.085, 0.085]) b.box([x, 0.045, 0.285], [0.1, 0.07, 0.05], C.shoe, { faces: '+x-x+y+z-z', colors: { '+z': C.sole } });
  b.with({ chalk: 1 }, () => {
    // 粉笔线沿着拱起来的背脊（上背那一段的最高处）
    for (const x of [-0.165, 0.165]) b.segment([x, 0.358, 0.04], [x, 0.272, -0.16], 0.02, 0.012, C.chalkWhite, { faces: '+x-x+y+z-z' });
  });
  // 头：额头贴地，后脑朝后上（脖子藏在上背的前端里）
  head(b, [0, 0.085, -0.23], '-y', true);
  for (const s of [-1, 1]) hand(b, [s * 0.1, 0.015, -0.305]);
}

/**
 * 摔倒侧躺（4-2「他跪进中道，摔倒，躺在那里」，以及被碰倒的人）：向右侧躺，身体沿 x 横在车道上，背朝玩家（+z），
 * 脸朝前（−z），膝盖收向前面，压在下面的那只手臂顺着地面伸过头顶。侧躺时肩宽变成高度：胸口 0.27 高、腰 0.21 高、20 cm 厚。
 * 从追尾机位看是一条横着的背：一头是黑发的后脑，中间衬衫收到腰、接着裤子，另一头是两只鞋底；头、身子、腿之间
 * 留 2–3 cm 的断开，亮场（广场没有粉笔描边）也读得出（审查 npc-seated-4）。最高处 ≈ 0.28。
 */
function fallen(b: PartBuilder): void {
  // 后脑朝玩家：头发朝 +z，脸朝前
  head(b, [-0.3, 0.085, -0.01], '-z', true);
  b.with({ tint: 1 }, () => {
    b.segment([-0.205, 0.14, 0.0], [-0.04, 0.14, 0.0], 0.2, 0.27, SHIRT, { faces: '+x-x+y+z-z' });
    b.segment([-0.05, 0.12, 0.0], [0.07, 0.12, 0.0], 0.18, 0.22, SHIRT, { faces: '+x-x+y+z-z' });
    b.box([0.14, 0.105, -0.01], [0.13, 0.21, 0.2], PANTS, { faces: '+x-x+y+z-z' });
    // 两条腿叠在一起：大腿收向前面（−z），小腿折回去，脚在臀部后面一点
    b.segment([0.15, 0.08, -0.05], [0.25, 0.08, -0.23], 0.13, 0.16, PANTS, { faces: '+x-x+y+z-z' });
    b.segment([0.27, 0.07, -0.23], [0.32, 0.065, -0.02], 0.1, 0.13, PANTS, { faces: '+x-x+y+z-z' });
    // 压在下面的手臂：从肩膀顺着地面伸过头顶；上面的手臂垂在胸前，手撑在地上
    b.segment([-0.19, 0.04, -0.06], [-0.32, 0.03, -0.12], 0.07, 0.06, SHIRT, { faces: '+x-x+y+z-z' });
    b.segment([-0.15, 0.24, -0.08], [-0.1, 0.05, -0.17], 0.07, 0.065, SHIRT, { faces: '+x-x+y+z-z' });
  });
  b.box([0.33, 0.06, 0.04], [0.1, 0.12, 0.07], C.shoe, { faces: '+x-x+y+z-z', colors: { '+z': C.sole } });
  hand(b, [-0.34, 0.015, -0.14]);
  hand(b, [-0.09, 0.015, -0.2]);
  b.with({ chalk: 1 }, () => b.segment([-0.2, 0.278, 0.06], [-0.04, 0.278, 0.06], 0.02, 0.012, C.chalkWhite, { faces: '+x-x+y+z-z' }));
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
