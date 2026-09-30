// src/render/npc/Crawlers.ts —— 梦里爬行的人（DESIGN.md §5.7「梦中的爬行者」、§4.4）。
// 身体一个 InstancedMesh，手臂一个 InstancedMesh（每人两个实例，左右对称，不用负缩放）= 2 次 draw call
// （§9.4 预算 3）。手臂绕肩按相位前后摆，身体随之起伏、左右微摆（「像一条在地面游动的鱼」）；剪影靠动作识别。
// 数量上限：高 120 / 中 60 / 低 24（QualityProfile.crawlersMax）。
// 用途：crawler 障碍（梦中同向爬行的人，挡道 0.55 m）、crawlerStream 组、4-3 crowd crawlOvertake（从两侧超过你）。
import * as THREE from 'three';
import type { QualityProfile, ViewContext } from '../../core/contracts';
import { InstPool } from './InstPool';
import { applyNpcPatch, PartBuilder } from './material';
import { C } from './colors';

/** 身体尺寸：肩高 0.46、髋高 0.34、头 0.56；长度沿 z，头在 −z（朝前爬）。几何体沿 z 从 −0.46 到 +0.675，中心偏 +0.11。 */
export const CRAWL = { shoulderY: 0.46, shoulderZ: -0.25, shoulderX: 0.19, arm: 0.44, stride: 1.1, centerZ: 0.11 } as const;

function bodyGeo(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const shirt = 0xffffff, pants = 0x7e878b;
  b.variant(0, () => {
    b.with({ tint: 1 }, () => b.segment([0, 0.34, 0.15], [0, 0.45, -0.25], 0.34, 0.2, shirt, { colors: { '+y': 0xe2e2e2 } }));
    b.with({ chalk: 1 }, () => {
      for (const s of [-1, 1]) b.segment([s * 0.16, 0.44, 0.15], [s * 0.16, 0.55, -0.25], 0.018, 0.012, C.chalkWhite);
    });
    // 头：脸朝前下方（−z），从后面只看得见头发
    b.box([0, 0.55, -0.37], [0.16, 0.18, 0.19], C.hair, { colors: { '-z': C.skin, '-y': C.skin } });
    b.box([0, 0.47, -0.33], [0.07, 0.07, 0.07], C.skin);
    b.box([0, 0.33, 0.2], [0.33, 0.14, 0.2], pants);
    for (const s of [-1, 1]) {
      b.segment([s * 0.1, 0.3, 0.2], [s * 0.12, 0.12, 0.42], 0.13, 0.12, pants);
      b.segment([s * 0.12, 0.12, 0.42], [s * 0.13, 0.08, 0.6], 0.1, 0.1, pants);
      b.box([s * 0.13, 0.08, 0.64], [0.09, 0.08, 0.07], C.shoe, { colors: { '+z': C.sole, '+y': C.sole } });
    }
  });
  return b.build();
}

function armGeo(): THREE.BufferGeometry {
  // 肩在原点，手臂向下 0.44 m，手掌平放
  const b = new PartBuilder();
  b.variant(0, () => {
    b.with({ tint: 1 }, () => b.box([0, -0.2, 0], [0.075, 0.4, 0.08], 0xffffff, { colors: { '+z': 0xe2e2e2 } }));
    b.box([0, -0.43, 0.03], [0.07, 0.03, 0.1], C.skin);
  });
  return b.build();
}

/** 一个爬行者此刻的姿态（复用）。 */
export interface Crawler { x: number; y: number; z: number; yaw: number; dist: number; color: THREE.Color; phase: number }

const _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _r = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

export class Crawlers {
  readonly group = new THREE.Group();
  private body!: InstPool;
  private arms!: InstPool;
  max = 24;
  count = 0;

  constructor() { this.group.name = 'crawlers'; }

  init(ctx: ViewContext, cap = 128): void {
    const mat = () => applyNpcPatch(ctx.mat.lambert({ vertexColors: true, flat: true }), true);
    this.body = new InstPool('crawler:body', bodyGeo(), mat(), cap, { color: true });
    this.arms = new InstPool('crawler:arms', armGeo(), mat(), cap * 2, { color: true });
    this.group.add(this.body.mesh, this.arms.mesh);
    ctx.scene.add(this.group);
    this.setQuality(ctx.quality);
  }

  setQuality(q: QualityProfile): void { this.max = q.crawlersMax; }

  get meshes(): THREE.InstancedMesh[] { return [this.body.mesh, this.arms.mesh]; }

  begin(): void { this.count = 0; this.body.begin(); this.arms.begin(); }
  end(): void { this.body.end(); this.arms.end(); }

  /** 画一个爬行者。must = true（障碍）时不受数量上限限制。dist 为已爬过的距离（驱动手臂相位）。 */
  add(c: Crawler, must = false): void {
    if (!must && this.count >= this.max) return;
    this.count++;
    const ph = (c.dist / CRAWL.stride + c.phase) * Math.PI * 2;
    const bob = 0.015 * Math.abs(Math.sin(ph));
    const wig = 0.05 * Math.sin(ph);
    _q.setFromAxisAngle(_up, c.yaw + wig);
    _a.compose(_v.set(c.x, c.y + bob, c.z), _q, _one);
    this.body.push(_a, 0, 0, c.color);
    for (const s of [-1, 1] as const) {
      // 左右手交替前摆 ±30°（支撑时几乎竖直）
      const swing = 0.52 * Math.sin(ph + (s < 0 ? 0 : Math.PI));
      _m.copy(_a).multiply(_r.makeTranslation(s * CRAWL.shoulderX, CRAWL.shoulderY, CRAWL.shoulderZ));
      _m.multiply(_r.makeRotationX(swing + 0.15));
      this.arms.push(_m, 0, 0, c.color);
    }
  }

  clear(): void { this.begin(); this.end(); }
}
