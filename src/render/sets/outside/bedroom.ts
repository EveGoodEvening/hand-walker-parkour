// src/render/sets/outside/bedroom.ts —— 卧室（DESIGN.md §4.4 结尾卡、§4.5 5-1；氛围 homeDark）。
// 变体 feet（5-1）：「我的脚在被子里动了一下。」「右脚先起，脚掌贴床，脚跟下压，膝盖弓起。站立姿势的半成品。」
//   「它们没听。」→ ↓ 按住 2.5 s：脚在你手下轻轻挣动 → 「过了几秒，它终于放松。」（不是「按不住」，AGENTS.md Lessons）。
//   被子是一张可变形的网格（bedSheet 纹理），膝盖的起伏按静场时间和快照里的输入状态算（update 是纯函数，不建几何体）。
// 变体 ceiling（第四章结尾卡）：躺着往上看，天花板上那条裂缝「从墙角爬到吊灯的位置」（ceilingCrack，河）。
// 天还没亮：窗帘缝里漏进来一线冷光（第五章不许暖色）。坐标相对 STILL_ORIGIN。draw call：房间 1、发光 1、光晕 1、被子 1、天花板 1 = 5。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { C } from '../../kits/outside/lib/colors';
import { OGeo, TexGeo, bakeGeometry, bakeLights, heightGrid, type BakeLight } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, glowDisc, roomShell } from './lib/setkit';

const X0 = -2.2, X1 = 2.2, Z0 = -3.2, Z1 = 2.4, H = 2.7;
const BED = { x0: -0.58, x1: 0.58, zHead: 1.95, zFoot: -0.72, top: 0.5 };
const KNEE_Z = 0.25, LEG_X = 0.13;
/** 烘焙光源：窗帘缝里漏进来的一线冷光（天还没亮），外加床头一点点反光。 */
export const BED_LIGHTS: readonly BakeLight[] = [
  { p: [X0 + 0.25, 1.5, -0.9], color: 0x6f8594, intensity: 1.5, radius: 3.8 },
  { p: [0, 1.4, 0.4], color: 0x1e272e, intensity: 0.7, radius: 2.6 },
];
const BED_AMBIENT = 0x0e1317;

/** 膝盖抬起的高度（米）：右、左。prompt / held 来自快照（静场输入），relaxAt = 输入完成的时刻（之后慢慢放平）。 */
export function kneeHeights(t: number, prompt: string | null, held: number, relaxAt: number | null, holdSec = 2.5): { r: number; l: number } {
  if (relaxAt !== null && t >= relaxAt) {
    const k = Math.max(0, 1 - (t - relaxAt) / 1.2);
    return { r: 0.1 * k * k, l: 0 };
  }
  if (prompt === 'hold' || prompt === 'fist') {
    const p = Math.min(1, held / holdSec);
    // 在手下轻轻挣动（像一条鱼在网里），越按越弱
    return { r: 0.22 - 0.12 * p + 0.025 * (1 - p) * Math.sin(t * 17), l: 0.03 * (1 - p) * Math.max(0, Math.sin(t * 5)) };
  }
  if (t < 0.3) return { r: 0, l: 0 };
  // 右脚先起、保持、落下；左脚跟着一遍；右脚又来（周期 2.4 s）
  const p = (t - 0.3) % 2.4;
  const rise = (a: number, b: number, c: number, d: number) => (p < a ? 0 : p < b ? (p - a) / (b - a) : p < c ? 1 : p < d ? 1 - (p - c) / (d - c) : 0);
  const e = (v: number) => v * v * (3 - 2 * v);
  return { r: 0.26 * e(rise(0, 0.45, 1.0, 1.3)), l: 0.24 * e(rise(1.25, 1.65, 2.0, 2.35)) };
}

/** 被子的高度场：腿的两道隆起 + 膝盖 + 两侧垂下 + 床尾垂下。 */
function blanketHeight(x: number, z: number, r: number, l: number): number {
  let y = BED.top + 0.07;
  const ax = Math.abs(x);
  // 两侧垂到床沿以下
  if (ax > 0.5) y -= (ax - 0.5) * 2.2;
  // 床尾
  if (z < -0.6) y -= (-0.6 - z) * 2.5;
  // 腿：两道低低的隆起
  if (z < 1.1 && z > -0.55) for (const lx of [-LEG_X, LEG_X]) y += 0.045 * Math.exp(-((x - lx) ** 2) / 0.006);
  // 脚尖
  for (const lx of [-LEG_X, LEG_X]) y += 0.06 * Math.exp(-((x - lx) ** 2) / 0.004 - ((z + 0.42) ** 2) / 0.006);
  // 膝盖（右 = +x）
  y += r * Math.exp(-((x - LEG_X) ** 2) / 0.03 - ((z - KNEE_Z) ** 2) / 0.09);
  y += l * Math.exp(-((x + LEG_X) ** 2) / 0.03 - ((z - KNEE_Z) ** 2) / 0.09);
  return y;
}

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.bedroom.${variant}`);
  const g = new OGeo();
  g.cell = ctx.quality.tier === 'low' ? 0.6 : 0.35;
  roomShell(g, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H, floor: 0x3a444b, ceiling: null, wall: 0x56626a, wainscot: { h: 0.08, color: 0x2a3237 } });
  g.cell = 0;
  for (let x = X0 + 0.16; x < X1; x += 0.16) g.flat(0.001, x - 0.004, x + 0.004, Z1, Z0, 0x151b1f);
  // 床：床架、床垫、床头板、枕头
  g.box([0, 0.2, (BED.zHead + BED.zFoot) / 2], [BED.x1 - BED.x0 + 0.08, 0.4, BED.zHead - BED.zFoot + 0.05], 0x2a3237);
  g.box([0, 0.46, (BED.zHead + BED.zFoot) / 2], [BED.x1 - BED.x0, 0.1, BED.zHead - BED.zFoot], 0x5b6770);
  g.box([0, 0.72, BED.zHead + 0.04], [BED.x1 - BED.x0 + 0.12, 0.9, 0.06], 0x262e33);
  g.box([0, 0.58, 1.62], [0.62, 0.12, 0.36], 0x77848c);
  // 窗（左墙）：窗帘几乎拉上，中间一道缝
  g.wallX(X0 + 0.01, -0.1, -1.7, 0.85, 0.92, 0x39434a, 1);
  g.box([X0 + 0.12, 1.5, -0.5], [0.12, 1.8, 0.75], 0x232b31);
  g.box([X0 + 0.12, 1.5, -1.33], [0.12, 1.8, 0.8], 0x20282d);
  g.box([X0 + 0.06, 2.45, -0.9], [0.06, 0.05, 2.0], 0x39434a);
  // 衣柜、书桌、椅子（远处）
  g.box([1.75, 1.0, -2.6], [0.9, 2.0, 1.1], 0x252d32);
  g.box([1.305, 1.0, -2.6], [0.01, 1.9, 0.02], 0x151a1e, { faces: '-x' });
  g.box([-0.6, 0.74, -2.9], [1.2, 0.04, 0.55], 0x2c353a);
  for (const dx of [-0.55, 0.55]) g.box([-0.6 + dx, 0.37, -2.9], [0.04, 0.74, 0.5], 0x22292e);
  g.box([-0.6, 0.45, -2.35], [0.42, 0.04, 0.42], 0x2a3237);
  g.box([-0.6, 0.72, -2.15], [0.42, 0.5, 0.04], 0x2a3237);
  // 吊灯（关着）：裂缝一直延伸到这里
  g.segment([0.5, H, -0.6], [0.5, H - 0.4, -0.6], 0.02, 0.02, 0x2a3136);
  g.prism(0.5, -0.6, H - 0.6, H - 0.4, 0.28, 8, 0x353f46, null, 0.1);
  bakeLights(g, BED_LIGHTS, BED_AMBIENT);
  b.baked(g, 'room');
  // 发光：窗帘缝（冷）
  const e = new OGeo();
  e.wallX(X0 + 0.19, -0.86, -0.94, 0.7, 2.35, 0x6f8594, 1);
  b.emissive(e);
  const gl = new OGeo();
  glowDisc(gl, [X0 + 0.9, 0.004, -0.9], 1.0, 0x141b20, 16, [0, 1, 0], 0.35);
  b.glow(gl, 'curtainGap');
  // 被子（变形网格）
  const q = ctx.quality.tier === 'low' ? 1 : 2;
  const grid = heightGrid(BED.x0 - 0.1, BED.x1 + 0.1, BED.zFoot - 0.12, 1.3, 10 * q, 14 * q, 0.6, (x, z) => blanketHeight(x, z, 0, 0));
  bakeGeometry(grid.geometry, BED_LIGHTS, BED_AMBIENT);
  b.texturedBasic(grid.geometry, 'bedSheet', {}, 'blanket', true);
  // 天花板 + 裂缝（河）：ceiling 变体照得更清楚
  const tg = new TexGeo();
  const tint = variant === 'ceiling' ? 0xffffff : 0xb0b0b0;
  const cx0 = -1.8, cx1 = 2.0, cz0 = -2.2, cz1 = 1.6, cell = 0.4;
  for (let x = cx0; x < cx1 - 1e-6; x += cell) for (let z = cz0; z < cz1 - 1e-6; z += cell) {
    const x1 = Math.min(cx1, x + cell), z1 = Math.min(cz1, z + cell);
    const u = (q: number) => (q - cx0) / (cx1 - cx0), v = (q: number) => (q - cz0) / (cz1 - cz0);
    tg.quad([x, H, z1], [x, H, z], [x1, H, z], [x1, H, z1], [u(x), v(z1)], [u(x), v(z)], [u(x1), v(z)], [u(x1), v(z1)], tint);
  }
  // ceiling 变体：躺着往上看，天花板被窗帘缝的光照得更清楚一点
  bakeLights(tg, variant === 'ceiling' ? [...BED_LIGHTS, { p: [0.2, 1.2, -0.4], color: 0x3a4a55, intensity: 1.0, radius: 3.2 }] : BED_LIGHTS, BED_AMBIENT);
  b.texturedBasic(tg, 'ceilingCrack', { shape: 'river' }, 'ceiling');
  let relaxAt: number | null = null, sawPrompt = false, lastR = -1, lastL = -1;
  const update = (t: number, snap: SimSnapshot | null) => {
    const st = snap?.still ?? null;
    const prompt = st?.prompt ?? null;
    if (prompt === 'hold' || prompt === 'fist') sawPrompt = true;
    else if (sawPrompt && relaxAt === null) relaxAt = t;
    if (t < 0.05) { relaxAt = null; sawPrompt = false; }
    const { r, l } = variant === 'ceiling' ? { r: 0, l: 0 } : kneeHeights(t, prompt, st?.held ?? 0, relaxAt);
    if (Math.abs(r - lastR) < 1e-4 && Math.abs(l - lastL) < 1e-4) return;
    lastR = r; lastL = l;
    grid.update((x, z) => blanketHeight(x, z, r, l));
  };
  update(0, null);
  liveList('bedroom').add({ variant, root: b.root, update });
  return b.root;
}

export const bedroomSet: StillSet = {
  id: 'bedroom', owner: 'WP4', variants: ['feet', 'ceiling'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, BED.top, 0.55),
  update: (t, snap) => liveList('bedroom').update(snap.still?.t ?? t, snap),
};

registerSet(bedroomSet);
