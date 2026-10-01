// src/render/actors/rigBuild.ts —— 主角模型：基本体 + 刚性蒙皮，1 次 draw call（DESIGN.md §5.5、§8.4 RigFactory）。WP5。
// 所有部件用 Box / Capsule / Cylinder / Icosahedron 生成，按骨骼的静止位置摆好，每个顶点 skinIndex = 所属骨骼、weight = 1，
// 颜色烘进顶点色，合并成一个 SkinnedMesh，配一个 Lambert（vertexColors + flatShading）。倒影、影子、领跑者、站着的「我」
// 共用这一份几何体，各自有独立的 Skeleton。三角形：高 ≤ 2.5k，低 ≤ 1.2k（胶囊径向段数、二十面体细分按画质档位）。
//
// 静止姿势（骨骼局部旋转全为单位四元数）是「站直、双臂下垂」：角色空间前方 −z、上 +y、原点在地面。
// 髋部在 0.34 m（爬姿的高度），所以站立类姿势要把根抬高 STAND_LIFT。手的静止朝向是「平贴地面、四指朝前」，
// 这样 IK 只需要给出手在角色空间里的朝向（§5.6：掌根 → 指节 → 指腹）。
//
// 附录 A-4：没有面孔，只有两个小方块做眼睛，没有嘴。
import * as THREE from 'three';
import { propHex } from '../wallTone';
import type { PoseHistoryAPI, QualityProfile, RigFactory, RigHandle, ViewContext } from '../../core/contracts';
import { GeoBuilder, type V3 } from '../../core/geo';
import { BONE_COUNT, BONE_INDEX, BONE_PARENT, BONES, type BoneName, type Pose } from '../../core/rig';
import type { AtmosphereId, QualityTier } from '../../core/types';
import { Tone } from '../kits/outside/lib/tone';
import { PoseHistory } from './PoseHistory';

/** 骨段长度（米）。IK 用。 */
export const SEG = { upperArm: 0.29, foreArm: 0.26, thigh: 0.38, shin: 0.36, arm3: 0.3, palm: 0.09, knuckle: 0.045 } as const;
/** 站立时根要抬高多少，髋部才到 0.84 m（大腿 + 小腿 + 踝高）。 */
export const STAND_LIFT = 0.5;
/** 手腕到掌底的距离（腕目标 = 地面 + 这个值）。 */
export const PALM_DROP = 0.026;
/** 踝到鞋底的距离。 */
export const ANKLE_H = 0.09;

/** 静止姿势下各骨骼关节在角色空间里的位置（绝对坐标）。 */
export const REST: Readonly<Record<BoneName, V3>> = (() => {
  const P: V3 = [0, 0.34, 0.26];
  const add = (a: V3, d: V3): V3 => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
  const spine = add(P, [0, 0.08, 0]);
  const chest = add(spine, [0, 0.2, 0]);
  const neck = add(chest, [0, 0.24, 0]);
  const head = add(neck, [0, 0.07, 0]);
  const shL = add(chest, [-0.06, 0.2, 0]), shR = add(chest, [0.06, 0.2, 0]);
  const uaL = add(shL, [-0.13, 0, 0]), uaR = add(shR, [0.13, 0, 0]);
  const faL = add(uaL, [0, -SEG.upperArm, 0]), faR = add(uaR, [0, -SEG.upperArm, 0]);
  const pL = add(faL, [0, -SEG.foreArm, 0]), pR = add(faR, [0, -SEG.foreArm, 0]);
  const kL = add(pL, [0, 0, -SEG.palm]), kR = add(pR, [0, 0, -SEG.palm]);
  const dL = add(kL, [0, 0, -SEG.knuckle]), dR = add(kR, [0, 0, -SEG.knuckle]);
  const tL = add(P, [-0.09, -0.02, 0]), tR = add(P, [0.09, -0.02, 0]);
  const sL = add(tL, [0, -SEG.thigh, 0]), sR = add(tR, [0, -SEG.thigh, 0]);
  const fL = add(sL, [0, -SEG.shin, 0]), fR = add(sR, [0, -SEG.shin, 0]);
  const a3u = add(chest, [0, 0.14, -0.1]);
  const a3f = add(a3u, [0, 0, -SEG.arm3]);
  const a3h = add(a3f, [0, 0, -SEG.arm3]);
  return {
    root: [0, 0, 0], pelvis: P, spine, chest, neck, head,
    shoulderL: shL, upperArmL: uaL, foreArmL: faL, palmL: pL, knuckleL: kL, padL: dL,
    shoulderR: shR, upperArmR: uaR, foreArmR: faR, palmR: pR, knuckleR: kR, padR: dR,
    thighL: tL, shinL: sL, footL: fL, thighR: tR, shinR: sR, footR: fR,
    arm3Upper: a3u, arm3Fore: a3f, arm3Hand: a3h, propHead: add(head, [0, 0.215, 0]), propBack: add(chest, [0, 0.04, 0.2]),
  };
})();

/** 各骨骼相对父骨骼的静止偏移（局部坐标 = 父骨骼坐标系，静止时父骨骼旋转为单位）。 */
export const REST_OFFSET: Readonly<Record<BoneName, V3>> = Object.fromEntries(BONES.map((n) => {
  const p = BONE_PARENT[n];
  const me = REST[n];
  if (!p) return [n, me];
  const pp = REST[p];
  return [n, [me[0] - pp[0], me[1] - pp[1], me[2] - pp[2]] as V3];
})) as Record<BoneName, V3>;

/** 色板（§5.1）。 */
export const RIG_COLORS = {
  uniform: 0x2f4a6d, stripe: 0xd9dee3, pants: 0x2a3a52, skin: 0xc9b8a6, callus: 0x9b8f82, lines: 0x8c8279, hair: 0x1e2226,
  // 鞋底（修复轮 U5）：以前是 §5.5 的 #CFD4D6，两块浅色鞋底是画面里最抢眼的东西；改成暗灰，画面上约 #5E6366
  eye: 0x2a2f33, shoe: 0x2b3034, sole: 0x5e6366, third: 0xe6ebee, steel: 0x9ba5a9, bag: 0x3c4650, knuckle: 0xbba997, bowl: 0xdde2e4,
} as const;
/** lead 集成：深色衣物按 §5.1「画面上的颜色」反推（WP3 的 propHex）；眼睛等测试用到的颜色不动。 */
const TONED: ReadonlySet<string> = new Set(['uniform', 'pants', 'hair', 'shoe', 'bag', 'sole']);
const C = Object.fromEntries(Object.entries(RIG_COLORS).map(([k, v]) => [k, TONED.has(k) ? propHex(v) : v])) as Record<keyof typeof RIG_COLORS, number>;
/** 写进顶点色的颜色（深色衣物、鞋底已按早晨的受光补偿）。测试与户外的颜色倍率用它找顶点。 */
export function rigColor(k: keyof typeof RIG_COLORS): number { return C[k]; }

/**
 * 户外氛围（修复轮 U5，triage F11 的主角部分）：早晨的补偿在阴天、黎明、梦里不够，校服和裤子成了饱和的深蓝甚至近黑。
 * 这些氛围下按 WP4 户外 kit 同一套模拟（kits/outside/lib/tone.ts，只读）把 §5.1 的色板反推成反照率，参考朝向是追尾镜头
 * 主要看到的背与背顶（法线朝后上方）：那些面在画面上就是色板色。其余氛围维持早晨的补偿（与改动前相同）。
 */
export const OUTDOOR_ATMOS: ReadonlySet<AtmosphereId> = new Set<AtmosphereId>(['overcast', 'dawn', 'dream', 'dreamGray']);
export const FIGURE_TONE_NORMAL: readonly [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
/** 需要随氛围重新补偿的衣物。 */
export type TonedCloth = 'uniform' | 'pants';
const _tc = new THREE.Color();
/** 某个氛围下校服 / 裤子的顶点色（线性反照率）。 */
export function clothAlbedo(key: TonedCloth, atmo: AtmosphereId): [number, number, number] {
  if (!OUTDOOR_ATMOS.has(atmo)) { _tc.setHex(C[key]); return [_tc.r, _tc.g, _tc.b]; }
  _tc.setHex(RIG_COLORS[key]);
  const a = Tone.of(atmo).albedo([_tc.r, _tc.g, _tc.b], FIGURE_TONE_NORMAL);
  return [a[0], a[1], a[2]];
}

/** 画质 → 基本体细分。 */
export interface RigDetail { radial: number; cap: number; ico: 0 | 1 }
export function rigDetail(q: Pick<QualityProfile, 'capsuleSegments' | 'icoDetail'>): RigDetail {
  const radial = Math.max(4, Math.min(8, q.capsuleSegments));
  return { radial, cap: radial >= 8 ? 2 : 1, ico: q.icoDetail };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** 把一个 three 基本体（任意索引）按矩阵 m 写进 GeoBuilder（平面法线，顶点色 hex，可按顶点抖动）。 */
function addPrim(g: GeoBuilder, geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number,
  jitter?: (p: THREE.Vector3) => void): void {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i); _b.fromBufferAttribute(pos, i + 1); _c.fromBufferAttribute(pos, i + 2);
    if (jitter) { jitter(_a); jitter(_b); jitter(_c); }
    _a.applyMatrix4(m); _b.applyMatrix4(m); _c.applyMatrix4(m);
    // 去掉退化三角形（胶囊极点）
    const ab = _v.subVectors(_b, _a), ac = new THREE.Vector3().subVectors(_c, _a);
    if (ab.cross(ac).lengthSq() < 1e-14) continue;
    g.tri([_a.x, _a.y, _a.z], [_b.x, _b.y, _b.z], [_c.x, _c.y, _c.z], hex);
  }
  if (src !== geo) src.dispose();
  geo.dispose();
}

/** 沿 a→b 的胶囊（total = 总长，含两端半球）。 */
function capsule(g: GeoBuilder, d: RigDetail, a: V3, b: V3, r: number, total: number, hex: number): void {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va).normalize();
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, dir);
  _m.compose(mid, _q, new THREE.Vector3(1, 1, 1));
  addPrim(g, new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), d.cap, d.radial, 1), _m.clone(), hex);
}

/** 沿 a→b 的圆柱（开口或封口）。 */
function cylinder(g: GeoBuilder, d: RigDetail, a: V3, b: V3, r: number, hex: number, open = false): void {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const dir = vb.clone().sub(va).normalize();
  _q.setFromUnitVectors(_up, dir);
  _m.compose(va.clone().add(vb).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
  addPrim(g, new THREE.CylinderGeometry(r, r, len, Math.max(5, d.radial), 1, open), _m.clone(), hex);
}

/** 可复现的位置哈希抖动（同一位置的重复顶点得到同一偏移，不会裂开）。 */
function hashJitter(amount: number): (p: THREE.Vector3) => void {
  return (p) => {
    const h = (x: number) => { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); };
    const k = p.x * 12.9898 + p.y * 78.233 + p.z * 37.719;
    p.x += (h(k) - 0.5) * 2 * amount; p.y += (h(k + 1.7) - 0.5) * 2 * amount; p.z += (h(k + 3.1) - 0.5) * 2 * amount;
  };
}

/**
 * 眼睛（§5.5 的两个小方块）：中心在头骨关节的 (±x, +dy, +dz) 处（静止姿势），边长 size。
 * Doubles 的 tintLambert 按它在顶点着色器里把某个替身的眼睛放大（4-6 水里站着的「我」，修复轮 U5 第三轮）。
 */
export const EYE_BOX = { x: 0.036, dy: 0.1, dz: -0.11, size: 0.012 } as const;

/**
 * 生成主角几何体（静止姿势，绝对坐标）。d 为细分级别。
 * 返回的几何体含 position / normal / color / aChalk / skinIndex / skinWeight。
 */
export function buildRigGeometry(d: RigDetail): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const at = (b: BoneName): V3 => { g.bone = BONE_INDEX[b]; return REST[b]; };
  const P = at('pelvis');
  // —— 躯干 ——
  g.box([0, P[1] + 0.02, P[2]], [0.3, 0.16, 0.2], C.pants);
  const sp = at('spine');
  g.box([0, sp[1] + 0.1, sp[2]], [0.32, 0.2, 0.22], C.uniform);
  for (const sx of [-1, 1]) g.box([sx * 0.163, sp[1] + 0.1, sp[2]], [0.008, 0.2, 0.05], C.stripe);        // 两侧白条
  const ch = at('chest');
  g.box([0, ch[1] + 0.11, ch[2]], [0.34, 0.22, 0.26], C.uniform);
  for (const sx of [-1, 1]) g.box([sx * 0.173, ch[1] + 0.11, ch[2]], [0.008, 0.22, 0.06], C.stripe);
  g.box([0, ch[1] + 0.225, ch[2] + 0.01], [0.2, 0.02, 0.2], C.uniform);                                      // 肩线
  // —— 颈 / 头 / 头发 / 眼（没有嘴）——
  const nk = at('neck');
  cylinder(g, d, [0, nk[1] - 0.01, nk[2]], [0, nk[1] + 0.08, nk[2]], 0.045, C.skin);
  const hd = at('head');
  {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(hd[0], hd[1] + 0.095, hd[2]), new THREE.Quaternion(), new THREE.Vector3(1, 1.1, 1.05));
    addPrim(g, new THREE.IcosahedronGeometry(0.105, d.ico), m, C.skin);
    const mh = new THREE.Matrix4().compose(new THREE.Vector3(hd[0], hd[1] + 0.125, hd[2] + 0.028), new THREE.Quaternion(), new THREE.Vector3(1.02, 0.98, 1.0));
    addPrim(g, new THREE.IcosahedronGeometry(0.112, d.ico), mh, C.hair, hashJitter(0.01));
    for (const sx of [-1, 1]) g.box([hd[0] + sx * EYE_BOX.x, hd[1] + EYE_BOX.dy, hd[2] + EYE_BOX.dz], [EYE_BOX.size, EYE_BOX.size, EYE_BOX.size], C.eye);   // §5.5：2 个 0.012 小方块
  }
  // —— 手臂 ——
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const sh = at(`shoulder${side}`);
    g.box([sh[0] + sx * 0.085, sh[1] - 0.02, sh[2]], [0.13, 0.1, 0.12], C.uniform);
    const ua = at(`upperArm${side}`), fa = REST[`foreArm${side}`];
    capsule(g, d, ua, fa, 0.045, SEG.upperArm + 0.06, C.uniform);
    const fa2 = at(`foreArm${side}`), wr = REST[`palm${side}`];
    capsule(g, d, fa2, [wr[0], wr[1] + 0.02, wr[2]], 0.038, SEG.foreArm + 0.04, C.uniform);
    cylinder(g, d, [wr[0], wr[1] + 0.045, wr[2]], [wr[0], wr[1] + 0.02, wr[2]], 0.041, C.stripe, true);   // 袖口一圈白
    // 手：掌 / 指节排 / 指腹排（§5.5「手分三段，正好对应掌根、指节、指腹三个触地点」）
    const pm = at(`palm${side}`);
    g.box([pm[0], pm[1] - 0.012, pm[2] - 0.06], [0.085, 0.028, 0.06], C.skin, { colors: { '-y': C.lines } });
    g.box([pm[0], pm[1] - 0.012, pm[2] - 0.015], [0.086, 0.03, 0.03], C.skin, { colors: { '-y': C.callus, '+z': C.callus } });   // 掌根茧
    g.box([pm[0] - sx * 0.052, pm[1] - 0.014, pm[2] - 0.045], [0.022, 0.02, 0.05], C.skin);                                       // 拇指（内侧）
    const kn = at(`knuckle${side}`);
    g.box([kn[0], kn[1] - 0.011, kn[2] - 0.0225], [0.085, 0.024, 0.045], C.knuckle, { colors: { '-y': C.lines } });
    const pd = at(`pad${side}`);
    g.box([pd[0], pd[1] - 0.01, pd[2] - 0.0225], [0.08, 0.02, 0.045], C.skin);
  }
  // —— 腿（行李）——
  for (const side of ['L', 'R'] as const) {
    const th = at(`thigh${side}`), sn = REST[`shin${side}`];
    capsule(g, d, th, sn, 0.065, SEG.thigh + 0.08, C.pants);
    const sn2 = at(`shin${side}`), ft = REST[`foot${side}`];
    capsule(g, d, sn2, ft, 0.05, SEG.shin + 0.05, C.pants);
    const f = at(`foot${side}`);
    // 鞋面 + 鞋底（静止时鞋尖朝 −z，鞋底朝下）；鞋底暗灰（修复轮 U5，取代 §5.4「朝向镜头的浅色鞋底」）
    g.box([f[0], f[1] - 0.04, f[2] - 0.06], [0.095, 0.07, 0.25], C.shoe);
    g.box([f[0], f[1] - 0.0825, f[2] - 0.06], [0.1, 0.02, 0.255], C.sole);
  }
  // —— 第三只手（不用时整条缩放为 0）：上臂、前臂 Capsule r 0.028 l 0.30，没有袖子；手指是正常的 1.3 倍长，分两节 ——
  {
    const u = at('arm3Upper'), f = REST.arm3Fore;
    capsule(g, d, u, f, 0.028, SEG.arm3 + 0.04, C.third);
    const f2 = at('arm3Fore'), h = REST.arm3Hand;
    capsule(g, d, f2, h, 0.026, SEG.arm3 + 0.03, C.third);
    const hh = at('arm3Hand');
    g.box([hh[0], hh[1], hh[2] - 0.04], [0.07, 0.02, 0.08], C.third);
    for (let i = 0; i < 4; i++) {
      const fx = hh[0] - 0.026 + i * 0.0173;
      const l1 = 0.062 - Math.abs(i - 1.5) * 0.006, l2 = 0.054 - Math.abs(i - 1.5) * 0.005;
      g.box([fx, hh[1], hh[2] - 0.08 - l1 / 2], [0.013, 0.013, l1], C.third);
      g.box([fx, hh[1] + 0.004, hh[2] - 0.08 - l1], [0.016, 0.016, 0.016], C.third);                                   // 指节突出
      g.box([fx, hh[1] - 0.004, hh[2] - 0.08 - l1 - l2 / 2], [0.012, 0.012, l2], C.third);
    }
    g.box([hh[0] + 0.045, hh[1], hh[2] - 0.035], [0.014, 0.014, 0.06], C.third);                                         // 拇指
  }
  // —— 道具（不用时缩放为 0）：餐盘 + 2 只碗 / 书包 ——
  {
    const ph = at('propHead');
    g.box([ph[0], ph[1], ph[2]], [0.36, 0.02, 0.26], C.steel);
    for (const bx of [-0.08, 0.08]) cylinder(g, d, [ph[0] + bx, ph[1] + 0.01, ph[2]], [ph[0] + bx, ph[1] + 0.055, ph[2]], 0.055, C.bowl);
    const pb = at('propBack');
    g.box([pb[0], pb[1], pb[2]], [0.28, 0.34, 0.12], C.bag);
  }
  return g.build({ skin: true });
}

/** 几何体的三角形数。 */
export function triangleCount(geo: THREE.BufferGeometry): number {
  const n = geo.index ? geo.index.count : (geo.getAttribute('position') as THREE.BufferAttribute).count;
  return Math.floor(n / 3);
}

/**
 * 一个角色：root（容器，替身把反射矩阵放在它的父节点上）→ pivot（姿态根变换）→ 骨骼；mesh 挂在 root 下。
 * detached = true（平面影子）：mesh 用 DetachedBindMode、bindMatrix = I，matrixWorld 由调用方写入投影矩阵（§5.8）。
 */
export class Rig implements RigHandle {
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  readonly bones: THREE.Bone[];
  private third = -1;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly role: 'player' | 'double' | 'shadow' | 'leader', detached = false) {
    this.bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    BONES.forEach((n, i) => {
      const p = BONE_PARENT[n];
      const off = REST_OFFSET[n];
      const bone = this.bones[i] as THREE.Bone;
      bone.position.set(off[0], off[1], off[2]);
      if (p) (this.bones[BONE_INDEX[p]] as THREE.Bone).add(bone);
    });
    this.root.name = `rig:${role}`;
    this.root.add(this.pivot);
    this.pivot.add(this.bones[0] as THREE.Bone);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    if (detached) {
      this.mesh.bindMode = THREE.DetachedBindMode;
      this.mesh.bind(this.skeleton, new THREE.Matrix4());
      this.mesh.matrixAutoUpdate = false;
      this.mesh.matrixWorldAutoUpdate = false;
    } else {
      this.mesh.bind(this.skeleton, new THREE.Matrix4());
    }
    this.setThirdHand(0);
    this.setProps({ head: 'none', back: 'none' });
  }
  apply(p: Pose): void {
    const q = p.q;
    for (let i = 0; i < BONE_COUNT; i++) {
      (this.bones[i] as THREE.Bone).quaternion.set(q[i * 4] as number, q[i * 4 + 1] as number, q[i * 4 + 2] as number, q[i * 4 + 3] as number);
    }
    const r = p.root;
    this.pivot.position.set(r[0] as number, r[1] as number, -(r[2] as number));
    this.pivot.rotation.set(r[4] as number, r[3] as number, r[5] as number, 'YXZ');
    this.setThirdHand(p.thirdHand);
  }
  setThirdHand(extend: number): void {
    const k = Math.max(0, Math.min(1, extend));
    if (Math.abs(k - this.third) < 1e-5) return;
    this.third = k;
    (this.bones[BONE_INDEX.arm3Upper] as THREE.Bone).scale.setScalar(k < 1e-3 ? 1e-4 : k);
  }
  setProps(p: { head?: 'none' | 'tray' | 'bag'; back?: 'none' | 'bag' }): void {
    if (p.head !== undefined) (this.bones[BONE_INDEX.propHead] as THREE.Bone).scale.setScalar(p.head === 'none' ? 1e-4 : 1);
    if (p.back !== undefined) (this.bones[BONE_INDEX.propBack] as THREE.Bone).scale.setScalar(p.back === 'none' ? 1e-4 : 1);
  }
  setGeometry(g: THREE.BufferGeometry): void { this.mesh.geometry = g; }
}

/** 角色材质：主角 / 替身共用 Lambert；影子 Basic #0B0F12 0.38（§5.1）。 */
export interface RigMaterials { body: THREE.MeshLambertMaterial; shadow: THREE.MeshBasicMaterial }

/** 正式 RigFactory：几何体按画质档位建一次、所有角色共用；切换画质时换几何体，不新建角色。 */
export class ActorRigFactory implements RigFactory {
  readonly history: PoseHistoryAPI & PoseHistory = new PoseHistory(1024);
  readonly mats: RigMaterials;
  private readonly geos = new Map<QualityTier, THREE.BufferGeometry>();
  private readonly rigs: Rig[] = [];
  private tier: QualityTier;
  /** 当前氛围（衣物颜色按它补偿）。 */
  private atmo: AtmosphereId = 'morning';
  /** 每个几何体里校服、裤子顶点的下标（建好时记一次）。 */
  private readonly cloth = new Map<THREE.BufferGeometry, Record<TonedCloth, Uint32Array>>();
  constructor(private readonly ctx: ViewContext) {
    this.tier = ctx.quality.tier;
    const body = ctx.mat.lambert({ vertexColors: true, flat: true });
    body.name = 'rigBody';
    const shadow = ctx.mat.basic({ color: 0x0b0f12, transparent: true, opacity: 0.38 });
    shadow.name = 'rigShadow';
    shadow.depthWrite = false;
    shadow.side = THREE.FrontSide;   // 与 PlanarShadow 一致：压扁的闭合网格只画朝上的一层（没有模板时也不会压暗两次）
    this.mats = { body, shadow };
  }
  geometry(tier: QualityTier = this.tier): THREE.BufferGeometry {
    let g = this.geos.get(tier);
    if (!g) {
      g = buildRigGeometry(rigDetail(this.ctx.quality.tier === tier ? this.ctx.quality : { capsuleSegments: tier === 'low' ? 5 : tier === 'medium' ? 6 : 8, icoDetail: tier === 'low' ? 0 : 1 }));
      this.ctx.mat.ensureChalkAttr(g);
      this.geos.set(tier, g);
      const col = g.getAttribute('color') as THREE.BufferAttribute;
      const find = (hex: number) => {
        _tc.setHex(hex);
        const out: number[] = [];
        for (let i = 0; i < col.count; i++) {
          if (Math.abs(col.getX(i) - _tc.r) < 1e-5 && Math.abs(col.getY(i) - _tc.g) < 1e-5 && Math.abs(col.getZ(i) - _tc.b) < 1e-5) out.push(i);
        }
        return Uint32Array.from(out);
      };
      this.cloth.set(g, { uniform: find(C.uniform), pants: find(C.pants) });
      this.retone(g);
    }
    return g;
  }

  /** 段的氛围变了（Actor 在换段、atmosphere cue 时调用）：校服、裤子的顶点色按新氛围重写（所有角色共用几何体）。 */
  setAtmosphere(id: AtmosphereId): void {
    if (id === this.atmo) return;
    this.atmo = id;
    for (const g of this.geos.values()) this.retone(g);
  }
  get atmosphere(): AtmosphereId { return this.atmo; }

  private retone(g: THREE.BufferGeometry): void {
    const idx = this.cloth.get(g);
    if (!idx) return;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    for (const key of ['uniform', 'pants'] as const) {
      const [r, gg, b] = clothAlbedo(key, this.atmo);
      for (const i of idx[key]) col.setXYZ(i, r, gg, b);
    }
    col.needsUpdate = true;
  }
  create(role: 'player' | 'double' | 'shadow' | 'leader'): RigHandle { return this.make(role); }
  /** 同 create，但返回具体类型（包内用）。 */
  make(role: 'player' | 'double' | 'shadow' | 'leader', mat?: THREE.Material): Rig {
    const r = new Rig(this.geometry(), mat ?? (role === 'shadow' ? this.mats.shadow : this.mats.body), role, role === 'shadow');
    this.rigs.push(r);
    return r;
  }
  /** 画质切换：换共用几何体（按档位缓存，只在第一次切到某档时生成）。 */
  setQuality(q: QualityProfile): void {
    if (q.tier === this.tier) return;
    this.tier = q.tier;
    const g = this.geometry(q.tier);
    for (const r of this.rigs) r.setGeometry(g);
  }
}
