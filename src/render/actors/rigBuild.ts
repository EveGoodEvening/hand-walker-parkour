// src/render/actors/rigBuild.ts —— 刚性蒙皮的占位主角（DESIGN.md §5.5、§8.9-10）。CORE 写初版，之后归 WP5。
// 按冻结的 29 根骨骼表（core/rig.ts），每根骨骼挂几个盒子（每顶点 skinIndex = 所属骨骼、weight = 1），
// 合并成 **1 个 SkinnedMesh = 1 次 draw call**。倒影、影子、领跑者共用这一份几何体，各自有独立的 Skeleton。
// 绑定姿势就是「行李」爬姿：手在肩下，大腿向后下垂，小腿拖在身后，鞋底朝上对着镜头（§5.6 基础体态）。
import * as THREE from 'three';
import type { PoseHistoryAPI, RigFactory, RigHandle, ViewContext } from '../../core/contracts';
import { GeoBuilder, type V3 } from '../../core/geo';
import { BONE_COUNT, BONE_INDEX, BONE_PARENT, BONES, copyPose, createPose, type BoneName, type Pose } from '../../core/rig';

/** 绑定姿势下各骨骼的位置（角色空间：前方 −z，上 +y，原点 = 里程 s 处的地面）。 */
export const BIND: Readonly<Record<BoneName, V3>> = {
  root: [0, 0, 0], pelvis: [0, 0.30, 0.24], spine: [0, 0.35, 0.08], chest: [0, 0.41, -0.08], neck: [0, 0.47, -0.24], head: [0, 0.54, -0.31],
  shoulderL: [-0.11, 0.44, -0.2], upperArmL: [-0.2, 0.46, -0.24], foreArmL: [-0.2, 0.20, -0.24], palmL: [-0.2, -0.05, -0.24],
  knuckleL: [-0.2, -0.05, -0.33], padL: [-0.2, -0.05, -0.375],
  shoulderR: [0.11, 0.44, -0.2], upperArmR: [0.2, 0.46, -0.24], foreArmR: [0.2, 0.20, -0.24], palmR: [0.2, -0.05, -0.24],
  knuckleR: [0.2, -0.05, -0.33], padR: [0.2, -0.05, -0.375],
  // 腿是「行李」：大腿向后下垂，膝弯约 110°，小腿向后上方翘起，鞋底朝后上方、正对镜头（§5.4「画面最前景……朝向镜头的浅色鞋底」）
  thighL: [-0.09, 0.29, 0.30], shinL: [-0.1, 0.075, 0.56], footL: [-0.11, 0.23, 0.82],
  thighR: [0.09, 0.29, 0.30], shinR: [0.1, 0.075, 0.56], footR: [0.11, 0.23, 0.82],
  arm3Upper: [0, 0.40, -0.18], arm3Fore: [0, 0.12, -0.18], arm3Hand: [0, -0.14, -0.18], propHead: [0, 0.66, -0.33], propBack: [0, 0.52, 0.04],
};
/** 上臂、前臂长度（两骨 IK 用）。 */
export const ARM = { upper: 0.26, fore: 0.25 } as const;

const C = {
  uniform: 0x2f4a6d, stripe: 0xd9dee3, pants: 0x2a3a52, skin: 0xc9b8a6, callus: 0x9b8f82, lines: 0x8c8279, hair: 0x1e2226,
  eye: 0x2a2f33, shoe: 0x2b3034, sole: 0xcfd4d6, third: 0xe6ebee, steel: 0x9ba5a9, bag: 0x3c4650,
};

function buildGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const at = (b: BoneName) => { g.bone = BONE_INDEX[b]; return BIND[b]; };
  // 躯干
  at('pelvis'); g.box([0, 0.30, 0.24], [0.30, 0.16, 0.22], C.pants);
  at('spine'); g.segment(BIND.spine, BIND.chest, 0.30, 0.19, C.uniform);
  for (const sx of [-1, 1]) g.segment([sx * 0.152, 0.35, 0.08], [sx * 0.152, 0.41, -0.08], 0.012, 0.05, C.stripe);
  at('chest'); g.segment([0, 0.41, -0.06], [0, 0.46, -0.24], 0.34, 0.23, C.uniform);
  for (const sx of [-1, 1]) g.segment([sx * 0.172, 0.41, -0.06], [sx * 0.172, 0.46, -0.24], 0.012, 0.06, C.stripe);
  at('neck'); g.segment(BIND.neck, BIND.head, 0.08, 0.08, C.skin);
  at('head');
  g.box([0, 0.56, -0.37], [0.19, 0.21, 0.2], C.skin);
  g.box([0, 0.64, -0.35], [0.21, 0.08, 0.22], C.hair);
  g.box([0, 0.585, -0.26], [0.2, 0.17, 0.05], C.hair);
  for (const sx of [-1, 1]) g.box([sx * 0.045, 0.575, -0.472], [0.022, 0.012, 0.01], C.eye);
  g.box([0, 0.515, -0.472], [0.04, 0.005, 0.008], C.eye);
  // 手臂（左右）
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    at(`shoulder${side}`); g.box([sx * 0.17, 0.45, -0.22], [0.1, 0.1, 0.11], C.uniform);
    at(`upperArm${side}`); g.segment(BIND[`upperArm${side}`], BIND[`foreArm${side}`], 0.085, 0.085, C.uniform);
    at(`foreArm${side}`);
    g.segment(BIND[`foreArm${side}`], [sx * 0.2, -0.02, -0.24], 0.072, 0.072, C.uniform);
    g.segment([sx * 0.2, 0.0, -0.24], [sx * 0.2, -0.045, -0.24], 0.078, 0.078, C.stripe);   // 袖口一圈白
    at(`palm${side}`);
    g.box([sx * 0.2, -0.036, -0.285], [0.085, 0.028, 0.09], C.skin, { colors: { '+z': C.callus, '-y': C.callus } });
    g.box([sx * 0.2, -0.021, -0.27], [0.06, 0.002, 0.05], C.lines);
    g.box([sx * (0.2 - 0.052), -0.04, -0.27], [0.02, 0.02, 0.05], C.skin);                   // 拇指
    at(`knuckle${side}`); g.box([sx * 0.2, -0.038, -0.3525], [0.085, 0.024, 0.045], 0xbba997);
    at(`pad${side}`); g.box([sx * 0.2, -0.04, -0.3975], [0.08, 0.02, 0.045], C.skin);
  }
  // 腿（行李）
  for (const side of ['L', 'R'] as const) {
    at(`thigh${side}`); g.segment(BIND[`thigh${side}`], BIND[`shin${side}`], 0.13, 0.13, C.pants);
    at(`shin${side}`); g.segment(BIND[`shin${side}`], BIND[`foot${side}`], 0.1, 0.1, C.pants);
    at(`foot${side}`);
    const a = BIND[`foot${side}`];
    g.segment(a, [a[0], 0.47, 0.86], 0.095, 0.08, C.shoe, { colors: { '+y': C.sole } });   // 鞋尖朝上，鞋底朝 +z（镜头）
  }
  // 第三只手（平时缩放为 0）
  at('arm3Upper'); g.segment(BIND.arm3Upper, BIND.arm3Fore, 0.056, 0.056, C.third);
  at('arm3Fore'); g.segment(BIND.arm3Fore, BIND.arm3Hand, 0.05, 0.05, C.third);
  at('arm3Hand'); g.box([0, -0.18, -0.18], [0.07, 0.08, 0.02], C.third);
  // 道具（平时缩放为 0）
  at('propHead'); g.box([0, 0.68, -0.33], [0.36, 0.02, 0.26], C.steel);
  at('propBack'); g.box([0, 0.55, 0.04], [0.28, 0.12, 0.34], C.bag);
  return g.build({ skin: true });
}

class Rig implements RigHandle {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  readonly bones: THREE.Bone[];
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    BONES.forEach((n, i) => {
      const p = BONE_PARENT[n];
      const me = BIND[n];
      const bone = this.bones[i] as THREE.Bone;
      if (p) {
        const pp = BIND[p];
        bone.position.set(me[0] - pp[0], me[1] - pp[1], me[2] - pp[2]);
        (this.bones[BONE_INDEX[p]] as THREE.Bone).add(bone);
      } else bone.position.set(me[0], me[1], me[2]);
    });
    const rootBone = this.bones[0] as THREE.Bone;
    rootBone.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(rootBone);
    this.mesh.bind(this.skeleton);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.setThirdHand(0);
    this.setProps({ head: 'none', back: 'none' });
  }
  apply(p: Pose): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = this.bones[i] as THREE.Bone;
      b.quaternion.set(p.q[i * 4] as number, p.q[i * 4 + 1] as number, p.q[i * 4 + 2] as number, p.q[i * 4 + 3] as number);
    }
    const r = p.root;
    this.root.position.set(r[0] as number, r[1] as number, -(r[2] as number));
    this.root.rotation.set(r[4] as number, r[3] as number, r[5] as number, 'YXZ');
    this.setThirdHand(p.thirdHand);
  }
  setThirdHand(extend: number): void {
    const k = Math.max(0, Math.min(1, extend));
    const s = k < 1e-3 ? 1e-4 : k;
    (this.bones[BONE_INDEX.arm3Upper] as THREE.Bone).scale.setScalar(s);
  }
  setProps(p: { head?: 'none' | 'tray' | 'bag'; back?: 'none' | 'bag' }): void {
    if (p.head !== undefined) (this.bones[BONE_INDEX.propHead] as THREE.Bone).scale.setScalar(p.head === 'none' ? 1e-4 : 1);
    if (p.back !== undefined) (this.bones[BONE_INDEX.propBack] as THREE.Bone).scale.setScalar(p.back === 'none' ? 1e-4 : 1);
  }
}

/** 占位姿态历史：环形缓冲，按时间 slerp 采样（WP5 换成按 tick 写入的正式版本）。 */
export class SimplePoseHistory implements PoseHistoryAPI {
  private buf: Array<{ t: number; p: Pose }> = [];
  private head = 0;
  private size = 0;
  constructor(private cap = 1024) { for (let i = 0; i < cap; i++) this.buf.push({ t: -Infinity, p: createPose() }); }
  push(t: number, p: Pose): void {
    const e = this.buf[this.head] as { t: number; p: Pose };
    e.t = t; copyPose(e.p, p);
    this.head = (this.head + 1) % this.cap; this.size = Math.min(this.cap, this.size + 1);
  }
  sample(t: number, out: Pose): boolean {
    if (!this.size) return false;
    let best: { t: number; p: Pose } | null = null, next: { t: number; p: Pose } | null = null;
    for (let i = 0; i < this.size; i++) {
      const e = this.buf[(this.head - 1 - i + this.cap) % this.cap] as { t: number; p: Pose };
      if (e.t <= t) { best = e; break; }
      next = e;
    }
    if (!best) { if (next) copyPose(out, next.p); return !!next; }
    if (!next) { copyPose(out, best.p); return true; }
    const k = (t - best.t) / Math.max(1e-6, next.t - best.t);
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (let i = 0; i < BONE_COUNT; i++) {
      qa.fromArray(best.p.q, i * 4); qb.fromArray(next.p.q, i * 4); qa.slerp(qb, k); qa.toArray(out.q, i * 4);
    }
    for (let i = 0; i < 6; i++) out.root[i] = (best.p.root[i] as number) + ((next.p.root[i] as number) - (best.p.root[i] as number)) * k;
    out.thirdHand = best.p.thirdHand + (next.p.thirdHand - best.p.thirdHand) * k;
    return true;
  }
}

/** 占位 RigFactory：几何体只建一次，所有角色共用。 */
export function createPlaceholderRigFactory(ctx: ViewContext): RigFactory {
  const geo = buildGeometry();
  ctx.mat.ensureChalkAttr(geo);
  const mat = ctx.mat.lambert({ vertexColors: true, flat: true });
  const shadowMat = ctx.mat.basic({ color: 0x0b0f12, transparent: true, opacity: 0.38 });
  const history = new SimplePoseHistory();
  return {
    history,
    create(role) { return new Rig(geo, role === 'shadow' ? shadowMat : mat); },
  };
}
