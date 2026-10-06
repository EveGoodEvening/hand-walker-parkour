// src/render/sets/school/deskFeet.ts —— 静场「课桌下面」（DESIGN.md §4.1 1-4、§4.5 5-5，WP3）。
// 变体：teacher（1-4 英语老师：高跟鞋声走近后停住，深灰色的裙角悬在画面上方，「像一面降下一半的旗」；
//        4.6 s 早读结束，同学们起身，「像退潮一样往外涌」）、math（5-5 数学课：同学们都在，数学老师站在讲台那边）。
// 镜头在桌下（WP5 的 deskFeet 机位 (0.3, 0.3, 1.35) → (−0.1, 0.32, −1.8)）：看见的是自己的课桌底、
// 一排排桌腿椅腿、同学们的小腿和鞋。主角在原点（后排靠窗），面朝 −z；左边是窗和暖气，右墙前端是前门。
// 主角自己的腿由 WP5 的 actor 画（playerAnchor），这里不画。
//
// 英语老师（附录 A-1：朝镜头来的东西必须慢）：从讲台那边沿中间过道走下来，步速 1.2 m/s（「每一步都踩得很实」），
// 最后 0.8 s 缓停在主角身边（3.0 s，「今天你值日」在 3.2 s）；前半程藏在一排排桌腿和同学的腿后面，靠声音走近。
// 停到 4.3 s，再接着往教室后面走（「经过我身边时，停了一下」），从画面右缘慢慢走出去，不回头穿过同学。
// 腿的摆动按走过的距离算（步长 0.55 m），不会滑行。
//
// 同学们（teacher 变体）：一个网格、一次 draw call，顶点着色器按 uCrowdT 逐人动画：
// 每人 0.5 s 从坐姿变成站姿（大腿从水平转到竖直），起身的同时侧身挪进过道，
// 沿过道走向前面，在讲台前横穿到前门，出门后往走廊里走，被墙挡住后收成一个点（不再画）。
// 同一列的人同时起身、同速行走，间距保持 1.3 m；中间过道两列错开半个间距（0.48 s）；三条过道在讲台前走三条平行线
// （单元测试按 crowdAt 逐帧检查任意两人、人与老师的间距）。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { clamp, smoothstep } from '../../../core/math';
import { registerSet } from '../../../core/registry';
import type { AtmosphereId, SimSnapshot } from '../../../core/types';
import { KitGeo } from '../../geom';
import { chair, desk } from '../../kits/school/classroom';
import { radiator } from '../../kits/school/shell';
import { PAL } from '../../palette';
import { emiGeo, emissiveMesh, lambertMesh, propGeo, schoolWallX, schoolWallZ, setEnv, setPropTone, setWallTone, standingLegs, wallX } from './common';

const XW = -1.25;           // 窗墙
const XR = 3.6;             // 右墙（走廊一侧）
const ZB = 2.3;             // 后墙
const ZF = -8.6;            // 前墙（黑板）
const H = 3.3;
const AISLE_X = 1.2;        // 中间过道（老师走的那条）
const ROWS = [-1.75, -3.05, -4.35, -5.65, -6.95];
const COLS = [0, 0.62, 1.82, 2.44];
/** 前门（右墙前端）：z 范围与门高。 */
const DOOR_Z0 = -8.3, DOOR_Z1 = -6.95, DOOR_H = 2.1;
/** 门外走廊：发光的对面墙在 x = CORR_X。 */
const CORR_X = 4.8;
const ATMO: Record<string, AtmosphereId> = { teacher: 'morning', math: 'overcast' };

// ——————————————————— 英语老师 ———————————————————

const T_STEP = 0.55;        // 步长
const T_ZFAR = -3.37, T_ZNEAR = -0.25, T_V = 1.2, T_T0 = 0, T_STOP = 3.0, T_DEC = 0.8;
const T_LEAVE = 4.3, T_ACC = 0.5, T_V2 = 1.05, T_ZGONE = 2.2;

/** 匀速 v、最后 dec 秒匀减速到 0，总时长 T 走完的距离（t 从 0 计）。 */
function decelDist(t: number, v: number, T: number, dec: number): number {
  const tc = T - dec;
  if (t <= tc) return v * Math.max(0, t);
  const u = Math.min(t, T) - tc;
  return v * tc + v * u - (v / dec) * u * u * 0.5;
}
/** 从 0 匀加速 acc 秒到 v，之后匀速。 */
function accelDist(t: number, v: number, acc: number): number {
  if (t <= 0) return 0;
  if (t < acc) return (v / acc) * t * t * 0.5;
  return v * acc * 0.5 + v * (t - acc);
}

/**
 * 老师的位置与步态：0–3.0 s 沿中间过道从 z −3.37 走到主角身边 z −0.25（1.2 m/s，最后 0.8 s 缓停）；
 * 停到 4.3 s；然后加速到 1.05 m/s 继续往教室后面（+z）走，z > 2.2 后在镜头后面，不再画。
 * dist 是累计走过的距离（腿的相位按它算），speed 是当前速度（m/s）。dir 恒为 +1（脸朝 +z，朝着镜头那一侧走）。
 */
export function teacherPath(t: number): { z: number; speed: number; dist: number; walking: boolean; dir: 1; visible: boolean } {
  const approach = T_ZNEAR - T_ZFAR;
  if (t < T_STOP) {
    const d = decelDist(t - T_T0, T_V, T_STOP - T_T0, T_DEC);
    const tc = T_STOP - T_DEC;
    const speed = t <= tc ? T_V : T_V * (1 - (t - tc) / T_DEC);
    return { z: T_ZFAR + Math.min(d, approach), speed, dist: d, walking: speed > 0.05, dir: 1, visible: true };
  }
  if (t < T_LEAVE) return { z: T_ZNEAR, speed: 0, dist: approach, walking: false, dir: 1, visible: true };
  const d2 = accelDist(t - T_LEAVE, T_V2, T_ACC);
  const z = T_ZNEAR + d2;
  const speed = t - T_LEAVE < T_ACC ? (T_V2 * (t - T_LEAVE)) / T_ACC : T_V2;
  return { z, speed, dist: approach + d2, walking: true, dir: 1, visible: z < T_ZGONE };
}

/** 英语老师：A 字裙（深灰 #3F4448）、深色丝袜的腿、高跟鞋（鞋尖朝 −z；走向镜头时整个人转 180°）。腿绕髋（0.9 m）摆动。 */
function teacher(ctx: ViewContext, atmo: AtmosphereId): Built['teacher'] {
  const body = propGeo(atmo);
  // 裙子：上窄下宽的八棱台，裙摆离地 0.55 m
  const n = 8, yTop = 1.0, yHem = 0.55, rTop = 0.17, rHem = 0.26;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, r: number, y: number): [number, number, number] => [Math.cos(a) * r, y, -Math.sin(a) * r * 0.8];
    body.quad(p(a0, rHem, yHem), p(a1, rHem, yHem), p(a1, rTop, yTop), p(a0, rTop, yTop), 0x3f4448, null, [0.8, 0.8, 1, 1]);
    body.quad(p(a1, rHem, yHem), p(a0, rHem, yHem), p(a0, rHem * 0.96, yHem + 0.03), p(a1, rHem * 0.96, yHem + 0.03), 0x2f3438);  // 裙摆内沿
  }
  body.box([0, 1.08, 0], [0.34, 0.16, 0.22], 0x4a5055);     // 腰以上一点（画面外）
  const bodyMesh = lambertMesh(ctx, body, 'teacherSkirt');
  const leg = (dx: number) => {
    const g = propGeo(atmo);
    g.box([dx, 0.5, 0], [0.085, 0.8, 0.09], 0x565c62, { bottomShade: 0.85 });        // 深色丝袜
    g.box([dx, 0.06, -0.06], [0.08, 0.05, 0.2], 0x1e2226);                          // 鞋面
    g.box([dx, 0.035, 0.05], [0.03, 0.07, 0.03], 0x1e2226);                         // 细跟
    g.box([dx, 0.02, -0.12], [0.07, 0.04, 0.08], 0x1e2226);                         // 鞋尖
    const m = lambertMesh(ctx, g, `teacherLeg${dx < 0 ? 'L' : 'R'}`);
    m.geometry.translate(0, -0.9, 0);               // 以髋为轴
    m.position.set(0, 0.9, 0);
    return m;
  };
  const group = new THREE.Group();
  group.name = 'teacher';
  const legL = leg(-0.08), legR = leg(0.08);
  group.add(bodyMesh, legL, legR);
  return { group, legL, legR };
}

// ——————————————————— 同学们 ———————————————————

/** 一个同学的动画参数（与 CROWD_VERTEX 的顶点着色器一一对应；crowdAt 是它的 JS 版，测试用）。 */
export interface CrowdPerson {
  /** 起身前的位置（坐着时小腿所在处）。 */
  x0: number; z0: number;
  /** 过道的 x。 */
  xa: number;
  /** 讲台前横穿的那条线、门外走廊里走的 x。 */
  zc: number; xc: number;
  /** 开始起身的时刻、开始挪步的时刻、步速。 */
  ts: number; tw: number; v: number;
}
/** 出门后在走廊里再走的距离（之后不再画）；步长。 */
const CORRIDOR_RUN = 2.2, CROWD_STEP = 0.62;

/** 沿路径走过的距离（0.4 s 匀加速起步）。 */
function crowdDist(p: CrowdPerson, t: number): number {
  const u = t - p.tw;
  if (u <= 0) return 0;
  return u < 0.4 ? (p.v * u * u) / 0.8 : p.v * (u - 0.2);
}

/** 同学在 t 时刻的原点（脚下）与朝向、起身进度 k、是否已经走出去（与顶点着色器同一套公式）。 */
export function crowdAt(p: CrowdPerson, t: number): { x: number; z: number; heading: number; k: number; gone: boolean } {
  const k = smoothstep(p.ts, p.ts + 0.5, t);
  const d = crowdDist(p, t);
  const L1 = Math.abs(p.xa - p.x0), L2 = p.z0 - p.zc, L3 = p.xc - p.xa;
  let x: number, z: number;
  if (d < L1) { x = p.x0 + (p.xa - p.x0) * (d / Math.max(L1, 1e-3)); z = p.z0; }
  else if (d < L1 + L2) { x = p.xa; z = p.z0 - (d - L1); }
  else if (d < L1 + L2 + L3) { x = p.xa + (d - L1 - L2); z = p.zc; }
  else { x = p.xc; z = p.zc + (d - L1 - L2 - L3); }
  const c1 = L1 + L2, c2 = L1 + L2 + L3;
  const heading = -Math.PI / 2 * (smoothstep(c1 - 0.25, c1 + 0.25, d) + smoothstep(c2 - 0.25, c2 + 0.25, d));
  return { x, z, heading, k, gone: d > L1 + L2 + L3 + CORRIDOR_RUN };
}

const CROWD_PARS = /* glsl */`
attribute vec3 aStand;
attribute vec3 aSwing;
attribute vec4 aP0;   // x0, z0, xa, ts
attribute vec4 aP1;   // zc, xc, v, tw
uniform float uCrowdT;`;

const CROWD_VERTEX = /* glsl */`
  vec3 transformed;
  {
    float t = uCrowdT;
    float k = smoothstep(aP0.w, aP0.w + 0.5, t);
    vec3 lp = mix(position, aStand, k);
    float u = t - aP1.w;
    float d = u <= 0.0 ? 0.0 : (u < 0.4 ? aP1.z * u * u / 0.8 : aP1.z * (u - 0.2));
    float x0 = aP0.x, z0 = aP0.y, xa = aP0.z, zc = aP1.x, xc = aP1.y;
    float L1 = abs(xa - x0), L2 = z0 - zc, L3 = xc - xa;
    vec2 p; float amp;
    if (d < L1) { p = vec2(x0 + (xa - x0) * (d / max(L1, 1e-3)), z0); amp = 0.35; }
    else if (d < L1 + L2) { p = vec2(xa, z0 - (d - L1)); amp = 1.0; }
    else if (d < L1 + L2 + L3) { p = vec2(xa + (d - L1 - L2), zc); amp = 1.0; }
    else { p = vec2(xc, zc + (d - L1 - L2 - L3)); amp = 1.0; }
    float c1 = L1 + L2, c2 = L1 + L2 + L3;
    float th = -1.5707963 * (smoothstep(c1 - 0.25, c1 + 0.25, d) + smoothstep(c2 - 0.25, c2 + 0.25, d));
    float ph = d / ${CROWD_STEP.toFixed(2)} * 3.1415927 + x0 * 3.7 + z0 * 1.3;
    float sw = sin(ph) * amp * smoothstep(0.0, 0.25, d);
    lp += aSwing * sw;
    lp.y += abs(sw) * 0.012;
    float cs = cos(th), sn = sin(th);
    transformed = vec3(p.x + lp.x * cs + lp.z * sn, lp.y, p.y - lp.x * sn + lp.z * cs);
    if (d > L1 + L2 + L3 + ${CORRIDOR_RUN.toFixed(1)}) transformed = vec3(${CORR_X.toFixed(1)}, -1.0, z0);
  }`;

/**
 * 一个人的腿（双腿：小腿、大腿、鞋，外加胯）：坐姿 / 站姿 / 迈步姿三个累积器按同样的顺序写入同样的盒子，
 * 只是变换不同，所以顶点一一对应（站姿与迈步姿只用位置）。坐姿在人的原点坐标系里转 rotSeat；站姿朝 −z。
 */
function personLegs(seat: KitGeo, stand: KitGeo, stride: KitGeo, rotSeat: number, pants: number, shoe: number, spread: number): void {
  const M = THREE.Matrix4;
  const rs = new M().makeRotationY(rotSeat);
  const at = (x: number, y: number, z: number) => new M().makeTranslation(x, y, z);
  const rx = (a: number) => new M().makeRotationX(a);
  const swing = 0.32;
  for (const dx of [-spread, spread]) {
    const sx = dx;
    // 迈步：绕髋（y 0.95）转 ±swing，左腿向前（−z）、右腿向后
    const hip = (a: number) => at(sx, 0.95, 0).multiply(rx(a)).multiply(at(-sx, -0.95, 0));
    const a = dx < 0 ? swing : -swing;
    const parts: Array<[THREE.Matrix4, THREE.Matrix4, [number, number, number], number, boolean]> = [
      // [坐姿变换, 站姿变换, 尺寸, 颜色, 是否带鞋底色]
      [at(dx, 0.23, -0.1), at(sx, 0.29, 0), [0.11, 0.42, 0.11], pants, false],                                     // 小腿
      [at(dx, 0.47, 0.1), at(sx, 0.72, 0).multiply(rx(Math.PI / 2)), [0.12, 0.12, 0.44], pants, false],            // 大腿
      [at(dx, 0.045, -0.17), at(sx, 0.045, -0.07), [0.1, 0.08, 0.26], shoe, true],                                  // 鞋
    ];
    for (const [ms, mt, size, col, sole] of parts) {
      const o = { colors: sole ? { '+z': PAL.shoeSole } : undefined, bottomShade: sole ? 1 : 0.8 };
      seat.withMatrix(rs.clone().multiply(ms), () => seat.box([0, 0, 0], size, col, o));
      stand.withMatrix(mt, () => stand.box([0, 0, 0], size, col, o));
      stride.withMatrix(hip(a).multiply(mt), () => stride.box([0, 0, 0], size, col, o));
    }
  }
  // 胯（坐着时在椅面上、大腿后端；站着时在腰带的高度）
  seat.withMatrix(rs.clone().multiply(at(0, 0.5, 0.3)), () => seat.box([0, 0, 0], [0.34, 0.08, 0.16], 0x1e2226));
  stand.withMatrix(at(0, 0.99, 0), () => stand.box([0, 0, 0], [0.34, 0.08, 0.16], 0x1e2226));
  stride.withMatrix(at(0, 0.99, 0), () => stride.box([0, 0, 0], [0.34, 0.08, 0.16], 0x1e2226));
}

/** 每列同学走哪条过道、讲台前走哪条横线、门外走廊里走的 x、什么时候起身。 */
const COL_PLAN: Array<{ xa: number; zc: number; xc: number; t0: number }> = [
  { xa: -0.68, zc: -8.0, xc: 4.4, t0: 4.75 },      // x 0：左边（靠窗）的过道
  { xa: AISLE_X, zc: -7.6, xc: 4.05, t0: 5.43 },     // x 0.62：中间过道，比 x 1.82 那列晚半个间距
  { xa: AISLE_X, zc: -7.6, xc: 4.05, t0: 4.95 },     // x 1.82：中间过道
  { xa: 3.16, zc: -7.2, xc: 3.85, t0: 4.85 },       // x 2.44：右边（靠门）的过道
];
const CROWD_V = 1.35;

/** 同学们的座位与动画参数（rng 决定空座、腿的朝向、鞋色；math 变体 ts = ∞，一直坐着）。 */
function crowdPeople(rng: { next(): number }, leave: boolean): Array<CrowdPerson & { rot: number; shoe: number; spread: number }> {
  const out: Array<CrowdPerson & { rot: number; shoe: number; spread: number }> = [];
  for (const z of ROWS) for (let c = 0; c < COLS.length; c++) {
    const x = COLS[c] as number, plan = COL_PLAN[c] as (typeof COL_PLAN)[number];
    if (rng.next() < 0.12) continue;
    const x0 = x + (rng.next() - 0.5) * 0.06, z0 = z + 0.36;
    const rot = (rng.next() - 0.5) * 0.35 + (rng.next() < 0.2 ? 0.5 : 0);
    const shoe = rng.next() < 0.4 ? 0x3a4148 : PAL.shoeTop;
    const spread = 0.08 + rng.next() * 0.05;
    // 起身的 0.5 s 里已经开始往过道挪（不然站起来的腿会穿过椅面）；同一列同时开始挪步，间距不变
    const jitter = rng.next() * 0.1;
    out.push({ x0, z0, xa: plan.xa, zc: plan.zc, xc: plan.xc, ts: leave ? plan.t0 + jitter : 1e6, tw: leave ? plan.t0 + 0.2 : 1e6, v: CROWD_V, rot, shoe, spread });
  }
  return out;
}

/** 同学们的网格：坐姿是 position，站姿 aStand、迈步差 aSwing、逐人参数 aP0 / aP1；顶点着色器做全部动画。 */
function crowdMesh(ctx: ViewContext, people: ReturnType<typeof crowdPeople>, atmo: AtmosphereId, uT: { value: number }): THREE.Mesh {
  const seat = new KitGeo(), stand = new KitGeo(), stride = new KitGeo();
  seat.tone = setPropTone(atmo);
  const p0: number[] = [], p1: number[] = [];
  for (const p of people) {
    const n0 = seat.vertexCount;
    personLegs(seat, stand, stride, p.rot, PAL.trousers, p.shoe, p.spread);
    for (let i = n0; i < seat.vertexCount; i++) { p0.push(p.x0, p.z0, p.xa, p.ts); p1.push(p.zc, p.xc, p.v, p.tw); }
  }
  const geom = seat.build({ uv: false });
  const sw = new Float32Array(stand.pos.length);
  for (let i = 0; i < sw.length; i++) sw[i] = (stride.pos[i] as number) - (stand.pos[i] as number);
  geom.setAttribute('aStand', new THREE.Float32BufferAttribute(stand.pos, 3));
  geom.setAttribute('aSwing', new THREE.BufferAttribute(sw, 3));
  geom.setAttribute('aP0', new THREE.Float32BufferAttribute(p0, 4));
  geom.setAttribute('aP1', new THREE.Float32BufferAttribute(p1, 4));
  ctx.mat.ensureChalkAttr(geom);
  const mat = ctx.mat.lambert({ vertexColors: true, flat: true });
  const base = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.uCrowdT = uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${CROWD_PARS}`).replace('#include <begin_vertex>', CROWD_VERTEX);
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => `${key}|hwCrowd`;
  const m = new THREE.Mesh(geom, mat);
  m.name = 'classmates';
  m.frustumCulled = false;            // 顶点着色器把人挪出了包围球
  return m;
}

// ——————————————————— set ———————————————————

interface Built {
  root: THREE.Group; variant: string;
  crowd: THREE.Mesh; crowdT: { value: number }; people: CrowdPerson[];
  teacher: { group: THREE.Group; legL: THREE.Mesh; legR: THREE.Mesh } | null;
}
const built = new Map<string, Built>();
let lastVariant = 'teacher';

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const atmo = ATMO[variant] ?? 'morning';
  const e = setEnv(ctx, `deskFeet:${variant}`);
  const rng = e.rng;
  const root = new THREE.Group();
  const stat = propGeo(atmo), emi = emiGeo(), floorG = new KitGeo();
  // 地面：水磨石（贴图），范围覆盖整个教室
  const t = 1;
  floorG.quad([XW, 0, ZB], [XR, 0, ZB], [XR, 0, ZF], [XW, 0, ZF], 0xf2f4f4,
    [[XW + 0.5, -ZB / t], [XR + 0.5, -ZB / t], [XR + 0.5, -ZF / t], [XW + 0.5, -ZF / t]], [0.9, 0.9, 1, 1]);
  const floorGeom = floorG.build();
  ctx.mat.ensureChalkAttr(floorGeom);
  const floorMesh = new THREE.Mesh(floorGeom, ctx.mat.lambert({ vertexColors: true, map: ctx.tex.get('terrazzo', { base: PAL.terrazzo, polish: 1, repeat: 1 }), flat: true }));
  floorMesh.name = 'floor';
  // 墙：左窗墙（窗 + 暖气）、右墙（前端是前门）、后墙、前墙与黑板
  const winZ = [[-0.2, 1.9], [-3.4, -1.3], [-6.6, -4.5]] as const;
  schoolWallX(stat, XW, -1, ZF, ZB, H, PAL.wall, PAL.wainscot, atmo);
  for (const [a, b] of winZ) {
    // 窗洞以墙面上一块发光的窗代替（静场只从一个角度看）
    emi.withSteady(1, () => emi.quad([XW + 0.012, 0.95, b], [XW + 0.012, 0.95, a], [XW + 0.012, 2.7, a], [XW + 0.012, 2.7, b], [PAL.windowBottom, PAL.windowBottom, PAL.windowTop, PAL.windowTop]));
    for (const z of [a + (b - a) / 3, a + (2 * (b - a)) / 3]) stat.box([XW + 0.03, 1.82, z], [0.04, 1.75, 0.05], 0x9aa4a7, { faces: '+x+z-z' });
    stat.box([XW + 0.1, 0.93, (a + b) / 2], [0.2, 0.04, b - a + 0.1], 0xc3c9c9, { faces: '+y+x-y' });
    radiator(stat, e, -1, -(a + b) / 2, Math.min(1.3, b - a - 0.3), XW);
  }
  schoolWallX(stat, XR, 1, DOOR_Z1, ZB, H, PAL.wall, PAL.wainscot, atmo);
  schoolWallX(stat, XR, 1, ZF, DOOR_Z0, H, PAL.wall, PAL.wainscot, atmo);
  wallX(stat, XR, 1, DOOR_Z0, DOOR_Z1, DOOR_H, H, setWallTone(PAL.wall, DOOR_H, H, atmo));
  // 前门：门套，门开着；门外是亮着的走廊（地面 + 发光的对面墙），走出去的同学在这里被墙挡住
  for (const z of [DOOR_Z0, DOOR_Z1]) stat.box([XR - 0.01, DOOR_H / 2, z], [0.12, DOOR_H, 0.06], 0x6b7477, { faces: '-x+z-z' });
  stat.box([XR - 0.01, DOOR_H + 0.03, (DOOR_Z0 + DOOR_Z1) / 2], [0.12, 0.06, DOOR_Z1 - DOOR_Z0 + 0.06], 0x6b7477, { faces: '-x-y' });
  stat.quad([XR, 0, DOOR_Z1 + 1.6], [CORR_X, 0, DOOR_Z1 + 1.6], [CORR_X, 0, DOOR_Z0 - 1.2], [XR, 0, DOOR_Z0 - 1.2], 0xb4bbbc, null, [0.8, 1, 1, 0.8]);
  emi.withSteady(1, () => emi.quad([CORR_X, 0, DOOR_Z1 + 1.6], [CORR_X, 0, DOOR_Z0 - 1.2], [CORR_X, 2.6, DOOR_Z0 - 1.2], [CORR_X, 2.6, DOOR_Z1 + 1.6],
    [0x8f9a9c, 0x8f9a9c, 0xc9d1d4, 0xc9d1d4]));
  schoolWallZ(stat, ZB - 0.001, XR, XW, H, PAL.wall, PAL.wainscot, atmo);         // 后墙（朝 −z：从 XR 到 XW）
  stat.quad([XW, 0, ZF], [XR, 0, ZF], [XR, H, ZF], [XW, H, ZF], setWallTone(PAL.wall, 0, H, atmo), null, [0.75, 0.75, 1, 1]);
  stat.box([-0.1, 1.55, ZF + 0.03], [3.2, 1.2, 0.04], PAL.blackboard, { faces: '+z' });
  stat.quad([XW, H, ZB], [XR, H, ZB], [XR, H, ZF], [XW, H, ZF], PAL.ceiling, null, [0.7, 0.7, 0.7, 0.7]);
  // 自己的课桌（头顶那一块桌底）与同桌空着的桌子
  desk(stat, e, 0, -0.45, 0, false);
  desk(stat, e, 0.62, -0.45, 2, false);          // 同桌的座位空着，椅子推进桌下
  chair(stat, e, 0.62, -0.62, -0.02);
  // 前面几排的桌椅
  for (const z of ROWS) for (const x of COLS) {
    desk(stat, e, x, z, rng.next() < 0.5 ? 1 + rng.int(3) : 0, rng.next() < 0.3);
    chair(stat, e, x + (rng.next() - 0.5) * 0.05, z, rng.next() * 0.1);
  }
  // 同学们（坐着；teacher 变体 4.75 s 起一列一列起身往外走）
  const people = crowdPeople(rng, variant !== 'math');
  const crowdT = { value: 0 };
  const crowd = crowdMesh(ctx, people, atmo, crowdT);
  let teach: Built['teacher'] = null;
  if (variant === 'math') {
    // 数学老师：站在讲台那边，面朝全班（只看得见腿）
    standingLegs(stat, 0.9, ZF + 1.1, Math.PI, 0x3a3f44, 0x2b3034);
  } else {
    teach = teacher(ctx, atmo);
  }
  root.add(floorMesh, lambertMesh(ctx, stat, 'room'), emissiveMesh(ctx, emi, 'windows'), crowd);
  if (teach) { root.add(teach.group); teach.group.visible = false; }
  built.set(variant, { root, variant, crowd, crowdT, people, teacher: teach });
  lastVariant = variant;
  return root;
}

function update(t: number, snap: SimSnapshot): void {
  const b = built.get(snap.still?.variant ?? lastVariant) ?? built.get(lastVariant);
  if (!b) return;
  b.crowdT.value = t;
  if (b.teacher) {
    const p = teacherPath(t);
    const g = b.teacher.group;
    g.visible = p.visible;
    g.position.set(AISLE_X, 0, p.z);
    g.rotation.y = Math.PI;                         // 鞋尖朝 +z：朝主角（镜头那一侧）走
    // 步态按走过的距离：每 T_STEP 米半个周期；幅度随速度（缓停时步子变小，停下时并拢）
    const amp = 0.3 * clamp(p.speed / T_V, 0, 1);
    const ph = (p.dist / T_STEP) * Math.PI;
    const sw = Math.sin(ph) * amp;
    b.teacher.legL.rotation.x = sw; b.teacher.legR.rotation.x = -sw;
    g.position.y = Math.abs(Math.sin(ph)) * 0.012 * clamp(p.speed / T_V, 0, 1);
  }
}

export const deskFeetSet: StillSet = {
  id: 'deskFeet', owner: 'WP3', variants: ['teacher', 'math'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.05),
  update,
};

/** 测试用：某个变体建好的同学动画参数。 */
export function deskFeetPeople(variant: string): readonly CrowdPerson[] { return built.get(variant)?.people ?? []; }

registerSet(deskFeetSet);
