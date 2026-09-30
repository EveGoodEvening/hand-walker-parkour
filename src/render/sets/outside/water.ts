// src/render/sets/outside/water.ts —— 4-6 水（DESIGN.md §4.4、§5.8 水洼模板；氛围 dreamGray）。
// 「广场突然到了尽头。不是墙，不是悬崖，是水。一大片灰色的水……水面很平，能映出整个天空。」
// 「水里有很多人。他们都在用手走路……但最中间的那个人不是趴着的。他站着」（中间站着的「我」是 WP5 的水洼替身）。
// 大水洼遮罩（§5.8）：地面不写深度先画（renderOrder floor）；水面遮罩写模板位 0x80（puddleMask）；水里倒着爬的人群
// 只在 0x80 里显示（puddleDouble，深度照常测试）；水面色调叠加层同样只在 0x80 里（puddleOverlay）。
// 「双手按进水里，水花溅起」：开场溅起的水花与一圈圈涟漪；「水面在 0.6 s 内碎开」：收到 waterBreak（或 id waterBreaks）
// 之后涟漪炸开、倒影沉下去、水面变暗。没有模板缓冲时（ctx.stencil = false）：只画叠加层，外加一个模糊的站立剪影。
// 坐标相对 STILL_ORIGIN：主角跪在水边（原点），水面 y = 0，从 z = 0.2 往前铺到雾里。draw call ≤ 6。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { RENDER_ORDER, STENCIL } from '../../../core/constants';
import type { GameEvents } from '../../../core/events';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { C, mix, shade } from '../../kits/outside/lib/colors';
import { OGeo, keyRng } from '../../kits/outside/lib/geo';
import { liveList } from './lib/live';
import { SetBuild, crawlerFigure } from './lib/setkit';

export const WATER_EDGE_Z = 0.2;
/** 水面范围 [x0, z0, x1, z1]（y = 0 平面，z0 < z1）。 */
export const WATER_RECT: readonly [number, number, number, number] = [-40, -60, 40, WATER_EDGE_Z];
const RINGS = 6, RING_SEG = 28;

interface WaterAnim {
  fx: THREE.Mesh; fxBase: Float32Array; overlay: THREE.MeshBasicMaterial; crowd: THREE.Mesh | null;
  breakAt: number | null; unsub: () => void; stencil: boolean;
}

/** 水面碎开的程度（0..1）：从 breakAt 起 0.6 s（§4.4 4-6「水面在 0.6 s 内碎开」）。 */
export function breakProgress(t: number, breakAt: number | null): number {
  if (breakAt === null || t < breakAt) return 0;
  return Math.min(1, (t - breakAt) / 0.6);
}

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.water.${variant}`);
  const [x0, z0, x1, z1] = WATER_RECT;
  // 岸：广场的地面（不写深度、最先画），到水边为止
  const land = new OGeo();
  land.flat(0, -60, 60, 4, WATER_EDGE_Z, mix(C.plaza, 0xa9b0b3, 0.35), true);
  for (let x = -9; x <= 9; x += 1.5) land.flat(0.001, x - 0.01, x + 0.01, 4, WATER_EDGE_Z, shade(C.plazaSeam, 0.9), true);
  land.flat(0.001, -60, 60, WATER_EDGE_Z + 0.06, WATER_EDGE_Z, shade(C.plaza, 0.7), true);
  const landMesh = b.lambert(land, 'shore');
  (landMesh.material as THREE.Material).depthWrite = false;
  landMesh.renderOrder = RENDER_ORDER.floor;
  // 水面遮罩：只写模板位 0x80
  const mg = new OGeo();
  mg.flat(0, x0, x1, z1, z0, 0xffffff, true);
  const mask = b.emissive(mg, 'waterMask');
  const mm = mask.material as THREE.MeshBasicMaterial;
  mm.colorWrite = false; mm.depthWrite = false;
  mm.stencilWrite = true; mm.stencilRef = STENCIL.puddleBit; mm.stencilWriteMask = STENCIL.puddleBit;
  mm.stencilFunc = THREE.AlwaysStencilFunc; mm.stencilZPass = THREE.ReplaceStencilOp;
  mask.renderOrder = RENDER_ORDER.puddleMask;
  mask.visible = ctx.stencil;
  // 水里：很多人在爬（倒影，头朝向中间站着的那个人），只在模板区里
  let crowd: THREE.Mesh | null = null;
  if (ctx.stencil) {
    const cg = new OGeo();
    const rng = keyRng('water', 'crowd');
    const n = ctx.quality.tier === 'low' ? 14 : 26;
    const cx = 0, cz = -1.9;
    cg.mirrored(new THREE.Matrix4().makeScale(1, -1, 1), () => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.next() * 0.3, r = 1.6 + rng.next() * 3.5;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.8;
        if (z > WATER_EDGE_Z - 0.4) continue;
        const yaw = Math.atan2(-(cx - x), -(cz - z));
        const tone = rng.next();
        crawlerFigure(cg, x, z, yaw, mix(0x4a5c78, 0x3e4a5c, tone), mix(C.skin, 0x8a8f94, 0.5), 0.95);
      }
    });
    crowd = b.lambert(cg, 'waterCrowd');
    const cm = crowd.material as THREE.MeshLambertMaterial;
    cm.stencilWrite = true; cm.stencilRef = STENCIL.puddleBit; cm.stencilFuncMask = STENCIL.puddleBit; cm.stencilWriteMask = 0;
    cm.stencilFunc = THREE.EqualStencilFunc;
    crowd.renderOrder = RENDER_ORDER.puddleDouble;
  }
  // 水面色调叠加层（「一大片灰色的水」）：模板区里，不写深度
  const og = new OGeo();
  og.flat(0.002, x0, x1, z1, z0, C.plazaWater, true);
  const overlay = b.glass(og, ctx.stencil ? 0.42 : 0.82, 'waterOverlay');
  const om = overlay.material as THREE.MeshBasicMaterial;
  if (ctx.stencil) {
    om.stencilWrite = true; om.stencilRef = STENCIL.puddleBit; om.stencilFuncMask = STENCIL.puddleBit; om.stencilWriteMask = 0;
    om.stencilFunc = THREE.EqualStencilFunc;
  }
  overlay.renderOrder = RENDER_ORDER.puddleOverlay;
  // 没有模板：一个模糊的站立剪影（倒着，躺在水面上）
  if (!ctx.stencil) {
    const sg = new OGeo();
    const z = -1.9;
    for (let i = 0; i < 4; i++) {
      const w = 0.24 + i * 0.07;
      sg.flat(0.003 + i * 0.0005, -w, w, z - 0.02 * i, z - 1.7 - 0.05 * i, 0x2a3136, true);
    }
    b.glass(sg, 0.18, 'blurSilhouette');
  }
  // 水花与涟漪（加法）：RINGS 个圈 + 一些水滴，顶点每帧按时间重算（不建几何体）
  const fg = new OGeo();
  // 每个环段 2 个三角形（6 个顶点），位置在 animate() 里按时间写
  for (let r = 0; r < RINGS * RING_SEG; r++) {
    fg.gtri([0, 0, 0], [1, 0, 0], [0, 0, 1], 0, 0, 0);
    fg.gtri([0, 0, 0], [1, 0, 0], [0, 0, 1], 0, 0, 0);
  }
  const drops = 16;
  for (let i = 0; i < drops; i++) fg.box([0, 0, 0], [0.02, 0.02, 0.02], 0x000000);
  const fx = b.glow(fg, 'splash');
  fx.frustumCulled = false;
  const posAttr = fx.geometry.getAttribute('position') as THREE.BufferAttribute;
  const colAttr = fx.geometry.getAttribute('color') as THREE.BufferAttribute;
  // 颜色：圈是冷白，水滴更亮一点
  for (let i = 0; i < colAttr.count; i++) colAttr.setXYZ(i, 0.35, 0.4, 0.43);
  colAttr.needsUpdate = true;
  const anim: WaterAnim = { fx, fxBase: new Float32Array(posAttr.array as Float32Array), overlay: om, crowd, breakAt: null, unsub: () => {}, stencil: ctx.stencil };
  // 碎开：WP7 的 sfx waterBreak（或节拍 id waterBreaks）
  anim.unsub = ctx.bus.on('cue', (d: GameEvents['cue'], tick: number) => {
    const body = d.body as { type: string; sfx?: string };
    if ((body.type === 'sfx' && body.sfx === 'waterBreak') || d.id === 'waterBreaks') anim.breakAt = tick / 120;
  });
  liveList('water').add({ variant, root: b.root, update: (t, snap) => animate(anim, t, snap), dispose: () => anim.unsub() });
  animate(anim, 0, null);
  return b.root;
}

function animate(a: WaterAnim, t: number, snap: SimSnapshot | null): void {
  // 碎开的时刻：总线上的 cue（模拟时间）换算到静场时间
  let br: number | null = null;
  if (a.breakAt !== null && snap && snap.still) br = snap.still.t - (snap.t - a.breakAt);
  const k = breakProgress(t, br);
  const p = a.fx.geometry.getAttribute('position') as THREE.BufferAttribute;
  const c = a.fx.geometry.getAttribute('color') as THREE.BufferAttribute;
  const arr = p.array as Float32Array;
  let v = 0;
  // 涟漪：从双手按下的两点（±0.18, z −0.25）扩散；碎开时从中间炸开、更多更快
  for (let r = 0; r < RINGS; r++) {
    const burst = k > 0;
    const ph = burst ? Math.min(1, k * (1 + r * 0.3)) : ((t * 0.45 + r / RINGS) % 1);
    const cx = burst ? 0 : (r % 2 === 0 ? -0.18 : 0.18), cz = burst ? -1.9 : -0.25;
    const R = burst ? 0.2 + ph * (2 + r * 0.8) : 0.05 + ph * 1.6;
    const wdt = 0.006 + ph * 0.012;
    const bright = (burst ? 1 - ph * 0.6 : 1 - ph) * (t < 0.2 && !burst ? t / 0.2 : 1);
    for (let i = 0; i < RING_SEG; i++) {
      const a0 = (i / RING_SEG) * Math.PI * 2, a1 = ((i + 1) / RING_SEG) * Math.PI * 2;
      const pts: Array<[number, number]> = [
        [cx + Math.cos(a0) * (R - wdt), cz + Math.sin(a0) * (R - wdt) * 0.8], [cx + Math.cos(a1) * (R - wdt), cz + Math.sin(a1) * (R - wdt) * 0.8],
        [cx + Math.cos(a1) * (R + wdt), cz + Math.sin(a1) * (R + wdt) * 0.8], [cx + Math.cos(a0) * (R + wdt), cz + Math.sin(a0) * (R + wdt) * 0.8],
      ];
      // flat() 写出的两个三角形：(a, b, c) (a, c, d) —— 按同样的顺序填
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const q = pts[idx] as [number, number];
        arr[v * 3] = q[0]; arr[v * 3 + 1] = 0.004; arr[v * 3 + 2] = q[1];
        c.setXYZ(v, 0.07 * bright, 0.08 * bright, 0.09 * bright);
        v++;
      }
    }
  }
  // 水滴：开场 1.2 s 内从手边溅起再落下
  const nDrops = (p.count - v) / 36;
  for (let i = 0; i < nDrops; i++) {
    const rr = ((i * 0.618) % 1), ang = rr * Math.PI * 2;
    const life = Math.min(1, t / 1.2);
    const vx = Math.cos(ang) * (0.4 + rr * 0.5), vz = Math.sin(ang) * 0.3 - 0.2, vy = 1.4 + rr * 0.8;
    const tt = life * 0.7;
    const x = (i % 2 === 0 ? -0.18 : 0.18) + vx * tt, z = -0.25 + vz * tt, y = Math.max(0, vy * tt - 4.9 * tt * tt);
    const vis = life < 1 && y > 0 ? 1 : 0;
    for (let j = 0; j < 36; j++) {
      const base = (v + j) * 3;
      arr[base] = (a.fxBase[base] as number) * vis + x;
      arr[base + 1] = (a.fxBase[base + 1] as number) * vis + y + (vis ? 0 : -5);
      arr[base + 2] = (a.fxBase[base + 2] as number) * vis + z;
      c.setXYZ(v + j, 0.25 * vis, 0.28 * vis, 0.3 * vis);
    }
    v += 36;
  }
  p.needsUpdate = true; c.needsUpdate = true;
  // 碎开：水面变暗、倒影沉下去
  a.overlay.opacity = (a.stencil ? 0.42 : 0.82) + (0.93 - (a.stencil ? 0.42 : 0.82)) * k;
  if (a.crowd) a.crowd.visible = k < 0.5;
}

export const waterSet: StillSet = {
  id: 'water', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.55),
  surfaces: () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rect = [-6, -8, 6, WATER_EDGE_Z] as [number, number, number, number];
    return ['water', 'puddle', 'waterSurface'].map((id) => ({ id, plane: plane.clone(), rect }));
  },
  update: (t, snap) => liveList('water').update(snap.still?.t ?? t, snap),
};

registerSet(waterSet);
