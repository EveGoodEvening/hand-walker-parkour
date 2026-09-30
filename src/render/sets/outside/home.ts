// src/render/sets/outside/home.ts —— 3-9 十二掌：黑暗的客厅（DESIGN.md §4.3；氛围 homeDark）。
// 「我没有开灯。在黑暗里，我反而更熟悉自己的家。」「门口的拖鞋位置、厨房水槽里的碗、客厅里没有关的电视屏幕」
// 「客厅到卫生间的距离是十二步——不，十二掌。」—— 镜头在身后贴地（homeCrawl），前方尽头是卫生间的门；
// 左边沙发、右墙上没关的电视（冷色的光，轻微明灭）、窗上有雨，天花板上一条从墙角延伸到吊灯的裂缝（ceilingCrack，河）。
// 坐标相对 STILL_ORIGIN，主角在原点朝 −z 爬。draw call：房间 1、发光 1、光晕 1、天花板 1 = 4。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import { C, shade } from '../../kits/outside/lib/colors';
import { OGeo, TexGeo, bakeLights, keyRng, type BakeLight } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, glowDisc, roomShell } from './lib/setkit';

const X0 = -2.7, X1 = 2.7, Z0 = -5.6, Z1 = 2.6, H = 2.7;
/** 烘焙光源：没关的电视（冷蓝）、窗外的夜色、卫生间门缝下一线更暗的光。 */
export const HOME_LIGHTS: readonly BakeLight[] = [
  { p: [2.4, 1.2, -1.4], color: 0x7f98a8, intensity: 1.4, radius: 4.6 },
  { p: [-2.5, 1.6, -3.3], color: 0x3a4a55, intensity: 0.9, radius: 3.2 },
  { p: [0, 0.05, -5.4], color: 0x2c3a44, intensity: 0.8, radius: 1.6 },
];
const HOME_AMBIENT = 0x0d1216;

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.home.${variant}`);
  const g = new OGeo();
  g.cell = ctx.quality.tier === 'low' ? 0.6 : 0.35;
  roomShell(g, { x0: X0, x1: X1, z0: Z0, z1: Z1, h: H, floor: 0x3a444b, ceiling: null, wall: 0x56626a, wainscot: { h: 0.1, color: 0x2a3237 } });
  g.cell = 0;
  // 地板的木条缝（每 0.18 m，沿 z）
  for (let x = X0 + 0.18; x < X1; x += 0.18) g.flat(0.001, x - 0.004, x + 0.004, Z1, Z0, 0x161c20);
  // 卫生间的门（尽头，关着）：门框 + 门板 + 门把
  g.box([0, 1.02, Z0 + 0.03], [0.96, 2.04, 0.04], 0x2d363c, { faces: '+z' });
  g.box([0, 2.08, Z0 + 0.04], [1.08, 0.08, 0.06], 0x39434a, { faces: '+z-y' });
  for (const x of [-0.52, 0.52]) g.box([x, 1.04, Z0 + 0.04], [0.06, 2.08, 0.06], 0x39434a, { faces: '+z+x-x' });
  g.box([0.36, 1.0, Z0 + 0.07], [0.12, 0.03, 0.04], 0x5b6468);
  // 沙发（左）：座、靠背、扶手
  g.box([-2.2, 0.22, -0.8], [0.9, 0.44, 2.2], C.sofa);
  g.box([-2.55, 0.62, -0.8], [0.25, 0.8, 2.2], shade(C.sofa, 0.9));
  g.box([-2.2, 0.5, 0.36], [0.9, 0.56, 0.2], shade(C.sofa, 1.1));
  g.box([-2.2, 0.5, -1.96], [0.9, 0.56, 0.2], shade(C.sofa, 1.1));
  g.box([-2.1, 0.5, -0.4], [0.5, 0.14, 0.5], 0x2f3940);    // 靠垫
  // 茶几（低，左中）
  g.box([-1.1, 0.4, -1.0], [0.9, 0.05, 0.55], 0x2a3237);
  for (const [dx, dz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]] as const) g.box([-1.1 + dx, 0.2, -1.0 + dz], [0.04, 0.4, 0.04], 0x20272c);
  g.box([-1.25, 0.46, -1.05], [0.2, 0.07, 0.2], 0x3a444b);     // 一只杯子
  // 电视柜 + 电视（右墙）
  g.box([2.45, 0.25, -1.4], [0.45, 0.5, 1.8], 0x22292e);
  g.box([2.62, 1.2, -1.4], [0.06, 0.72, 1.24], 0x101418, { faces: '-x+y-y+z-z' });
  // 门口的拖鞋（身后）、落地灯（关着）
  for (const dx of [-0.6, -0.4]) g.box([dx, 0.03, 2.2], [0.12, 0.06, 0.28], 0x303a41);
  g.prism(2.3, 1.2, 0, 1.5, 0.02, 5, 0x2a3136);
  g.prism(2.3, 1.2, 1.5, 1.8, 0.2, 6, 0x353f46, 0x2a3136, 0.12);
  // 左墙上的窗（外面在下雨，冷色的微光）
  g.wallX(X0 + 0.01, -2.6, -4.0, 0.9, 1.0, 0x39434a, 1);
  g.wallX(X0 + 0.01, -2.6, -4.0, 2.1, 2.2, 0x39434a, 1);
  g.box([X0 + 0.12, 1.55, -2.5], [0.2, 1.8, 0.35], 0x1f262b);         // 窗帘（拉开一半）
  // 吊灯（关着）：裂缝一直延伸到这里
  g.segment([0.4, H, -1.8], [0.4, H - 0.5, -1.8], 0.02, 0.02, 0x2a3136);
  g.prism(0.4, -1.8, H - 0.72, H - 0.5, 0.3, 8, 0x353f46, null, 0.12);
  bakeLights(g, HOME_LIGHTS, HOME_AMBIENT);
  b.baked(g, 'room');
  // 发光：没关的电视（冷蓝白，没有画面）、窗
  const e = new OGeo();
  e.wallX(2.585, -0.84, -1.96, 0.88, 1.52, 0x5d7382, -1);
  e.wallZ(Z0 + 0.06, -0.46, 0.46, 0.0, 0.012, 0x2c3a44, 1);
  e.wallX(X0 + 0.012, -2.62, -3.98, 1.0, 2.1, 0x2b3942, 1);
  b.emissive(e);
  // 光晕：电视照在地上、茶几上、沙发上；窗光在地上；窗上的雨痕
  const gl = new OGeo();
  glowDisc(gl, [2.55, 1.2, -1.4], 1.0, 0x1c262d, 16, [-1, 0, 0]);
  const rng = keyRng('home', 'rain');
  for (let i = 0; i < 22; i++) {
    const z = -2.65 - rng.next() * 1.3, y = 1.1 + rng.next() * 0.8, l = 0.06 + rng.next() * 0.2;
    gl.wallX(X0 + 0.02, z + 0.004, z - 0.004, y, y + l, 0x2e3c46, 1);
  }
  const glow = b.glow(gl, 'tvLight');
  // 天花板 + 裂缝（河）
  const tg = new TexGeo();
  // 朝下（从房间里看）：a → d → c → b
  const cell = 0.45;
  for (let x = X0; x < X1 - 1e-6; x += cell) for (let z = Z0; z < Z1 - 1e-6; z += cell) {
    const x1 = Math.min(X1, x + cell), z1 = Math.min(Z1, z + cell);
    const u = (q: number) => (q - X0) / (X1 - X0), v = (q: number) => ((q - Z0) / (Z1 - Z0)) * 1.6;
    tg.quad([x, H, z1], [x, H, z], [x1, H, z], [x1, H, z1], [u(x), v(z1)], [u(x), v(z)], [u(x1), v(z)], [u(x1), v(z1)], 0xffffff);
  }
  bakeLights(tg, HOME_LIGHTS, HOME_AMBIENT);
  b.texturedBasic(tg, 'ceilingCrack', { shape: 'river' }, 'ceiling');
  const glowMat = glow.material as THREE.MeshBasicMaterial;
  liveList('home').add({ variant, root: b.root, update: (t) => { glowMat.opacity = tvFlicker(t); } });
  return b.root;
}

/** 电视的冷光轻微明灭（< 1 Hz 的缓慢起伏，不是闪烁）。 */
export function tvFlicker(t: number): number {
  return 0.82 + 0.1 * Math.sin(t * 2.1) + 0.06 * Math.sin(t * 5.3 + 1.2);
}

export const homeSet: StillSet = {
  id: 'home', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4(),
  update: (t, snap) => liveList('home').update(snap.still?.t ?? t, snap),
};

registerSet(homeSet);
