// src/render/sets/school/deskFeet.ts —— 静场「课桌下面」（DESIGN.md §4.1 1-4、§4.5 5-5，WP3）。
// 变体：teacher（1-4 英语老师：高跟鞋声走近后停住，深灰色的裙角悬在画面上方，「像一面降下一半的旗」；
//        4.6 s 早读结束，同学们起身走光）、math（5-5 数学课：同学们都在，数学老师站在讲台那边）。
// 镜头在桌下（WP5 的 deskFeet 机位 (0.3, 0.3, 1.35) → (−0.1, 0.32, −1.8)）：看见的是自己的课桌底、
// 一排排桌腿椅腿、同学们的小腿和鞋。主角在原点（后排靠窗），面朝 −z；左边是窗和暖气。
// 主角自己的腿由 WP5 的 actor 画（playerAnchor），这里不画。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { clamp, smoothstep } from '../../../core/math';
import { registerSet } from '../../../core/registry';
import type { SimSnapshot } from '../../../core/types';
import { KitGeo } from '../../geom';
import { chair, desk } from '../../kits/school/classroom';
import { radiator } from '../../kits/school/shell';
import { PAL } from '../../palette';
import { emissiveMesh, lambertMesh, schoolWallX, schoolWallZ, seatedLegs, setEnv, standingLegs } from './common';

const XW = -1.25;           // 窗墙
const XR = 3.6;             // 右墙
const ZB = 2.3;             // 后墙
const ZF = -8.6;            // 前墙（黑板）
const H = 3.3;
const AISLE_X = 1.2;        // 老师走的过道
const ROWS = [-1.75, -3.05, -4.35, -5.65, -6.95];
const COLS = [0, 0.62, 1.82, 2.44];

interface Built {
  root: THREE.Group; variant: string;
  seated: THREE.Mesh; leaving: THREE.Mesh | null;
  teacher: { group: THREE.Group; legL: THREE.Mesh; legR: THREE.Mesh } | null;
}
const built = new Map<string, Built>();
let lastVariant = 'teacher';

/** 英语老师：A 字裙（深灰 #3F4448）、深色丝袜的腿、高跟鞋。腿绕髋（0.9 m）摆动。 */
function teacher(ctx: ViewContext): Built['teacher'] {
  const body = new KitGeo();
  // 裙子：上窄下宽的六棱台，裙摆离地 0.55 m
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
    const g = new KitGeo();
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

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const e = setEnv(ctx, `deskFeet:${variant}`);
  const rng = e.rng;
  const root = new THREE.Group();
  const stat = new KitGeo(), emi = new KitGeo(), floorG = new KitGeo();
  // 地面：水磨石（贴图），范围覆盖整个教室
  const t = 1;
  floorG.quad([XW, 0, ZB], [XR, 0, ZB], [XR, 0, ZF], [XW, 0, ZF], 0xf2f4f4,
    [[XW + 0.5, -ZB / t], [XR + 0.5, -ZB / t], [XR + 0.5, -ZF / t], [XW + 0.5, -ZF / t]], [0.9, 0.9, 1, 1]);
  const floorGeom = floorG.build();
  ctx.mat.ensureChalkAttr(floorGeom);
  const floorMesh = new THREE.Mesh(floorGeom, ctx.mat.lambert({ vertexColors: true, map: ctx.tex.get('terrazzo', { base: PAL.terrazzo, repeat: 1 }), flat: true }));
  floorMesh.name = 'floor';
  // 墙：左窗墙（窗 + 暖气）、右墙、后墙、前墙与黑板
  const winZ = [[-0.2, 1.9], [-3.4, -1.3], [-6.6, -4.5]] as const;
  schoolWallX(stat, XW, -1, ZF, ZB, H);
  for (const [a, b] of winZ) {
    // 窗洞以墙面上一块发光的窗代替（静场只从一个角度看）
    emi.withSteady(1, () => emi.quad([XW + 0.012, 0.95, b], [XW + 0.012, 0.95, a], [XW + 0.012, 2.7, a], [XW + 0.012, 2.7, b], [PAL.windowBottom, PAL.windowBottom, PAL.windowTop, PAL.windowTop]));
    for (const z of [a + (b - a) / 3, a + (2 * (b - a)) / 3]) stat.box([XW + 0.03, 1.82, z], [0.04, 1.75, 0.05], 0x9aa4a7, { faces: '+x+z-z' });
    stat.box([XW + 0.1, 0.93, (a + b) / 2], [0.2, 0.04, b - a + 0.1], 0xc3c9c9, { faces: '+y+x-y' });
    radiator(stat, e, -1, -(a + b) / 2, Math.min(1.3, b - a - 0.3), XW);
  }
  schoolWallX(stat, XR, 1, ZF, ZB, H);
  schoolWallZ(stat, ZB - 0.001, XR, XW, H);         // 后墙（朝 −z：从 XR 到 XW）
  stat.quad([XW, 0, ZF], [XR, 0, ZF], [XR, H, ZF], [XW, H, ZF], PAL.wall, null, [0.75, 0.75, 1, 1]);
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
  // 同学：坐着的腿（每张椅子上一双）
  const seatedG = new KitGeo();
  for (const z of ROWS) for (const x of COLS) {
    if (rng.next() < 0.12) continue;
    seatedLegs(seatedG, x + (rng.next() - 0.5) * 0.06, z + 0.5, (rng.next() - 0.5) * 0.35 + (rng.next() < 0.2 ? 0.5 : 0),
      PAL.trousers, rng.next() < 0.4 ? 0x3a4148 : PAL.shoeTop, 0.08 + rng.next() * 0.05);
  }
  const seated = lambertMesh(ctx, seatedG, 'classmatesSeated');
  let leaving: THREE.Mesh | null = null;
  let teach: Built['teacher'] = null;
  if (variant === 'math') {
    // 数学老师：站在讲台那边（只看得见腿）
    standingLegs(stat, 0.9, ZF + 1.1, 0, 0x3a3f44, 0x2b3034);
  } else {
    // 早读结束时站起来往外走的同学（与坐着的那组互换）
    const lg = new KitGeo();
    for (let i = 0; i < 14; i++) standingLegs(lg, [1.2, -0.5, 3.1][i % 3] as number + (rng.next() - 0.5) * 0.3, -1.6 - i * 0.55 - rng.next() * 0.3, Math.PI + (rng.next() - 0.5) * 0.4);
    leaving = lambertMesh(ctx, lg, 'classmatesLeaving');
    leaving.visible = false;
    teach = teacher(ctx);
  }
  root.add(floorMesh, lambertMesh(ctx, stat, 'room'), emissiveMesh(ctx, emi, 'windows'), seated);
  if (leaving) root.add(leaving);
  if (teach) { root.add(teach.group); teach.group.visible = false; }
  built.set(variant, { root, variant, seated, leaving, teacher: teach });
  lastVariant = variant;
  return root;
}

/** 老师的位置：1.2–2.8 s 从前面走到桌边，停到 4.4 s，再走回去（6.0 s 走出画面）。 */
export function teacherPath(t: number): { z: number; walking: boolean; dir: -1 | 1; visible: boolean } {
  const zFar = -7.6, zNear = -0.25;
  if (t < 0.9) return { z: zFar, walking: false, dir: 1, visible: false };
  if (t < 2.8) { const k = smoothstep(0.9, 2.8, t); return { z: zFar + (zNear - zFar) * k, walking: k < 0.97, dir: 1, visible: true }; }
  if (t < 4.4) return { z: zNear, walking: false, dir: 1, visible: true };
  if (t < 6.4) { const k = smoothstep(4.4, 6.4, t); return { z: zNear + (zFar - zNear) * k, walking: k < 0.97, dir: -1, visible: true }; }
  return { z: zFar, walking: false, dir: -1, visible: false };
}

function update(t: number, snap: SimSnapshot): void {
  const b = built.get(snap.still?.variant ?? lastVariant) ?? built.get(lastVariant);
  if (!b) return;
  if (b.teacher) {
    const p = teacherPath(t);
    const g = b.teacher.group;
    g.visible = p.visible;
    g.position.set(AISLE_X, 0, p.z);
    g.rotation.y = p.dir > 0 ? 0 : Math.PI;
    const sw = p.walking ? Math.sin(t * Math.PI * 2 * 1.9 / 2) * 0.32 : 0;
    b.teacher.legL.rotation.x = sw; b.teacher.legR.rotation.x = -sw;
    g.position.y = p.walking ? Math.abs(Math.cos(t * Math.PI * 1.9)) * 0.012 : 0;
  }
  if (b.leaving) {
    // 4.6 s 早读结束：坐着的同学一起起身，往前门走
    const up = t >= 4.7;
    b.seated.visible = !up;
    b.leaving.visible = up && t < 7.5;
    b.leaving.position.z = -clamp((t - 4.7) / 2.4, 0, 1) * 6;
  } else b.seated.visible = true;
}

export const deskFeetSet: StillSet = {
  id: 'deskFeet', owner: 'WP3', variants: ['teacher', 'math'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.05),
  update,
};

registerSet(deskFeetSet);
