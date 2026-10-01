// src/render/sets/outside/water.ts —— 4-6 水（DESIGN.md §4.4、§5.8 水洼模板；氛围 dreamGray）。
// 「广场突然到了尽头。不是墙，不是悬崖，是水。一大片灰色的水……水面很平，能映出整个天空。」
// 「水里有很多人。他们都在用手走路……但最中间的那个人不是趴着的。他站着」（中间站着的「我」是 WP5 的水洼替身）。
// 大水洼遮罩（§5.8）：地面不写深度先画（renderOrder floor）；水面遮罩写模板位 0x80（puddleMask）；水里倒着爬的人群
// 只在 0x80 里显示（puddleDouble，深度照常测试）；水面色调叠加层同样只在 0x80 里（puddleOverlay）。
// 「双手按进水里，水花溅起」：开场溅起的水花与一圈圈涟漪；「水面在 0.6 s 内碎开」：收到 waterBreak（或 id waterBreaks）
// 之后涟漪炸开、倒影沉下去、水面变暗。没有模板缓冲时（ctx.stencil = false）：只画叠加层，外加一个模糊的站立剪影。
// 碎开的时刻按「静场时间」记，每一遍进 4-6 都从没碎开开始：段切换、重来、读章（同一章同一种子时 Game 不重建 View，set 实例会复用）
// 和静场时钟倒退时都清零。
// 坐标相对 STILL_ORIGIN：主角跪在水边（原点），水面 y = 0，从 z = 0.2 往前铺到雾里。draw call ≤ 6。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { RENDER_ORDER, STENCIL } from '../../../core/constants';
import type { GameEvents } from '../../../core/events';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { C, mix, shade } from '../../kits/outside/lib/colors';
import { OGeo, keyRng } from '../../kits/outside/lib/geo';
import { Tone } from '../../kits/outside/lib/tone';
import { liveList } from './lib/live';
import { stencilInside, stencilWrite } from './lib/mats';
import { SetBuild, crawlerFigure } from './lib/setkit';

export const WATER_EDGE_Z = 0.2;
/**
 * 水里站着的「我」（WP5 的替身，反射之前站的位置）与围着它爬的人群中心（修复轮 U5）。4-6 的镜头在主角眼睛里、
 * 从水边俯看（约 −60°）：倒影里站着的「我」在画面中间约 1/3 高，画面下沿是按进水里的双手，岸边的灰带出画。
 */
export const WATER_DOUBLE_Z = -0.6;
/** 双手按进水里的位置（相对 STILL_ORIGIN，与 WP5 handsInWater 的手一致）：开场的涟漪从这两点扩散。 */
export const WATER_HAND_X = 0.3, WATER_HAND_Z = -0.07;
/** 水面范围 [x0, z0, x1, z1]（y = 0 平面，z0 < z1）。 */
export const WATER_RECT: readonly [number, number, number, number] = [-40, -60, 40, WATER_EDGE_Z];
const RINGS = 4, RING_SEG = 28;

/** 碎开时倒影沉下去的深度（米，倒影在水面以下，往下移就是沉得更深）。 */
const SINK = 1.6;

interface WaterAnim {
  fx: THREE.Mesh; fxBase: Float32Array; overlay: THREE.MeshBasicMaterial; crowd: THREE.Mesh | null; stencil: boolean;
  /** 总线上收到、还没换算成静场时间的碎开 cue：模拟 tick 与 cue 所属的段。 */
  pending: { tick: number; segment: string } | null;
  /** 这一遍碎开的时刻（静场时间，秒）；null = 还没碎。 */
  breakAt: number | null;
  /** 预览（画廊）直接指定的碎开时刻，优先于 breakAt，不受总线事件影响。 */
  forced: number | null;
  /** 上一次 animate 的静场时间：倒退说明是新的一遍。 */
  lastT: number;
  sink: number;
  unsub: Array<() => void>;
}

const ANIMS = new WeakMap<THREE.Object3D, WaterAnim>();

/** 画廊用：直接指定碎开时刻（静场时间；null = 不碎）。不往总线上发 cue。 */
export function setWaterBreak(root: THREE.Object3D, at: number | null): void {
  const a = ANIMS.get(root);
  if (a) a.forced = at;
}

/** 新的一遍（段切换、重来、读章）：清掉碎开状态。同一 tick 里先到的、属于新段的 cue 保留。 */
function resetPass(a: WaterAnim, tick: number, segment: string | null): void {
  if (a.pending && !(segment !== null && a.pending.tick === tick && a.pending.segment === segment)) a.pending = null;
  a.breakAt = null;
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
  // §5.1 是画面上的颜色：按 dreamGray 起点的光反推反照率（与 plaza kit 的 gray 变体一致，见 kits/outside/lib/tone.ts）
  const tone = Tone.of('dreamGray');
  tone.applyArrays(land.col, land.nor, land.pos, 'floor');
  const landMesh = b.lambert(land, 'shore', { depthWrite: false });
  landMesh.renderOrder = RENDER_ORDER.floor;
  // 水面遮罩：只写模板位 0x80
  const mg = new OGeo();
  mg.flat(0, x0, x1, z1, z0, 0xffffff, true);
  const mask = b.emissive(mg, 'waterMask', { colorWrite: false, depthWrite: false, stencil: stencilWrite(STENCIL.puddleBit) });
  mask.renderOrder = RENDER_ORDER.puddleMask;
  mask.visible = ctx.stencil;
  // 水里：很多人在爬（倒影，头朝向中间站着的那个人），只在模板区里
  let crowd: THREE.Mesh | null = null;
  if (ctx.stencil) {
    const cg = new OGeo();
    const rng = keyRng('water', 'crowd');
    const n = ctx.quality.tier === 'low' ? 14 : 26;
    const cx = 0, cz = WATER_DOUBLE_Z;
    // 围着中间站着的「我」爬的人（修复轮 U5）：缩小到 0.6、压暗，离得远一些；水面叠加层越远越浅，像隔着一层雾
    cg.mirrored(new THREE.Matrix4().makeScale(1, -1, 1), () => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.next() * 0.3, r = 1.3 + rng.next() * 3.0;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.8;
        if (z > WATER_EDGE_Z - 0.4) continue;
        const yaw = Math.atan2(-(cx - x), -(cz - z));
        const tone = rng.next();
        crawlerFigure(cg, x, z, yaw, mix(0x5c656c, 0x4c555c, tone), mix(C.skin, 0x7a8286, 0.75), 0.57, 0x454c52);
      }
    });
    tone.applyArrays(cg.col, cg.nor, cg.pos, 'static');
    crowd = b.lambert(cg, 'waterCrowd', { stencil: stencilInside(STENCIL.puddleBit) });
    crowd.renderOrder = RENDER_ORDER.puddleDouble;
  }
  // 水面色调叠加层（「一大片灰色的水」）：模板区里，不写深度
  // 近处深、远处浅（映着天）：沿 z 分几条渐变
  const og = new OGeo();
  const bands = [z1, -1, -4, -10, -25, z0];
  for (let i = 0; i + 1 < bands.length; i++) {
    const za = bands[i] as number, zb = bands[i + 1] as number;
    const ca = mix(shade(C.plazaWater, 0.85), C.plazaSky, i / (bands.length - 1) * 0.55), cb = mix(shade(C.plazaWater, 0.85), C.plazaSky, (i + 1) / (bands.length - 1) * 0.55);
    og.gtri([x0, 0.002, za], [x1, 0.002, za], [x1, 0.002, zb], ca, ca, cb);
    og.gtri([x0, 0.002, za], [x1, 0.002, zb], [x0, 0.002, zb], ca, cb, cb);
  }
  const overlay = b.glass(og, ctx.stencil ? 0.42 : 0.82, 'waterOverlay', null, ctx.stencil ? { stencil: stencilInside(STENCIL.puddleBit) } : {});
  const om = overlay.material as THREE.MeshBasicMaterial;
  overlay.renderOrder = RENDER_ORDER.puddleOverlay;
  // 没有模板：一个模糊的站立剪影（倒着，躺在水面上）
  if (!ctx.stencil) {
    const sg = new OGeo();
    const z = WATER_DOUBLE_Z;
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
  const anim: WaterAnim = { fx, fxBase: new Float32Array(posAttr.array as Float32Array), overlay: om, crowd, stencil: ctx.stencil,
    pending: null, breakAt: null, forced: null, lastT: 0, sink: 0, unsub: [] };
  ANIMS.set(b.root, anim);
  // 碎开：WP7 的 sfx waterBreak（或节拍 id waterBreaks）
  anim.unsub.push(ctx.bus.on('cue', (d: GameEvents['cue'], tick: number) => {
    const body = d.body as { type: string; sfx?: string };
    if ((body.type === 'sfx' && body.sfx === 'waterBreak') || d.id === 'waterBreaks') anim.pending = { tick, segment: d.segment };
  }));
  anim.unsub.push(ctx.bus.on('segment', (d, tick) => resetPass(anim, tick, d.id)));
  anim.unsub.push(ctx.bus.on('retry', (_d, tick) => resetPass(anim, tick, null)));
  anim.unsub.push(ctx.bus.on('chapter:start', (_d, tick) => resetPass(anim, tick, null)));
  liveList('water').add({ variant, root: b.root, update: (t, snap) => animate(anim, t, snap), dispose: () => { for (const u of anim.unsub) u(); anim.unsub.length = 0; } });
  animate(anim, 0, null);
  return b.root;
}

/** 一个环段的四个角（flat() 的顺序 a, b, c, d），每帧复用，不分配。 */
const QX = new Float64Array(4), QZ = new Float64Array(4);
/** flat() 写出的两个三角形：(a, b, c) (a, c, d)。 */
const QUAD = [0, 1, 2, 0, 2, 3] as const;

function animate(a: WaterAnim, t: number, snap: SimSnapshot | null): void {
  // 静场时钟倒退：新的一遍
  if (t + 1e-6 < a.lastT) a.breakAt = null;
  a.lastT = t;
  // 总线上的 cue（模拟时间）换算成静场时间。上一遍留下的 cue 已经被段切换 / 重来 / 读章事件清掉了
  if (a.pending && snap && snap.still) {
    a.breakAt = t - (snap.t - a.pending.tick / 120);
    a.pending = null;
  }
  const k = breakProgress(t, a.forced ?? a.breakAt);
  const p = a.fx.geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = a.fx.geometry.getAttribute('color') as THREE.BufferAttribute;
  const arr = p.array as Float32Array;
  let v = 0;
  // 涟漪：从双手按下的两点（±0.18, z −0.25）扩散；碎开时从中间炸开、更多更快
  const burst = k > 0;
  for (let r = 0; r < RINGS; r++) {
    const ph = burst ? Math.min(1, k * (1 + r * 0.3)) : ((t * 0.45 + r / RINGS) % 1);
    const cx = burst ? 0 : (r % 2 === 0 ? -WATER_HAND_X : WATER_HAND_X), cz = burst ? WATER_DOUBLE_Z : WATER_HAND_Z;
    const R = burst ? 0.2 + ph * (2 + r * 0.8) : 0.05 + ph * 1.6;
    const wdt = 0.006 + ph * 0.012;
    const ri = R - wdt, ro = R + wdt;
    // 双手按进水里的那几秒有涟漪，之后水面重新变平（「水面很平」）；碎开时再炸开
    const settle = burst ? 1 : Math.max(0, 1 - Math.max(0, t - 1.5) / 1.5);
    const bright = (burst ? 1 - ph * 0.6 : 1 - ph) * (t < 0.2 && !burst ? t / 0.2 : 1) * settle;
    for (let i = 0; i < RING_SEG; i++) {
      const a0 = (i / RING_SEG) * Math.PI * 2, a1 = ((i + 1) / RING_SEG) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      QX[0] = cx + c0 * ri; QZ[0] = cz + s0 * ri * 0.8;
      QX[1] = cx + c1 * ri; QZ[1] = cz + s1 * ri * 0.8;
      QX[2] = cx + c1 * ro; QZ[2] = cz + s1 * ro * 0.8;
      QX[3] = cx + c0 * ro; QZ[3] = cz + s0 * ro * 0.8;
      for (let j = 0; j < 6; j++) {
        const q = QUAD[j] as number;
        arr[v * 3] = QX[q] as number; arr[v * 3 + 1] = 0.004; arr[v * 3 + 2] = QZ[q] as number;
        col.setXYZ(v, 0.07 * bright, 0.08 * bright, 0.09 * bright);
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
    const x = (i % 2 === 0 ? -WATER_HAND_X : WATER_HAND_X) + vx * tt, z = WATER_HAND_Z + vz * tt, y = Math.max(0, vy * tt - 4.9 * tt * tt);
    const vis = life < 1 && y > 0 ? 1 : 0;
    for (let j = 0; j < 36; j++) {
      const base = (v + j) * 3;
      arr[base] = (a.fxBase[base] as number) * vis + x;
      arr[base + 1] = (a.fxBase[base + 1] as number) * vis + y + (vis ? 0 : -5);
      arr[base + 2] = (a.fxBase[base + 2] as number) * vis + z;
      col.setXYZ(v + j, 0.25 * vis, 0.28 * vis, 0.3 * vis);
    }
    v += 36;
  }
  p.needsUpdate = true; col.needsUpdate = true;
  // 碎开：水面变暗、倒影沉下去（往水下移，沉到底就不画了）
  a.overlay.opacity = (a.stencil ? 0.42 : 0.82) + (0.93 - (a.stencil ? 0.42 : 0.82)) * k;
  if (a.crowd) {
    const sink = k * k * SINK;
    if (sink !== a.sink) { a.sink = sink; a.crowd.position.y = 0 - sink; a.crowd.updateMatrix(); }
    a.crowd.visible = k < 1;
  }
}

export const waterSet: StillSet = {
  id: 'water', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.55),
  surfaces: () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rect = [-6, -8, 6, WATER_EDGE_Z] as [number, number, number, number];
    // at：水里站着的「我」在爬行的人群中间（与上面 crowd 的中心一致：WATER_DOUBLE_Z）
    return ['water', 'puddle', 'waterSurface'].map((id) => ({ id, plane: plane.clone(), rect, at: [0, 0, WATER_DOUBLE_Z] as [number, number, number] }));
  },
  update: (t, snap) => liveList('water').update(snap.still?.t ?? t, snap),
};

registerSet(waterSet);
