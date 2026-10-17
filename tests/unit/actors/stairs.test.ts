// tests/unit/actors/stairs.test.ts —— 视觉修复 actors-1：楼梯上的爬姿。模拟按连续的坡线 floorY 走，台阶是一级一级的平踏面
// （kits/school/stairs.ts）。支撑手按在落掌处那一级踏面上、整个支撑期不上下滑；网格的任何一点都不戳进台阶（手臂胶囊贴着踏面，容差 6 mm）；
// 膝、踝离身下的踏面 ≥ 4 cm（实测 2-1 / 3-2 / 5-2 为 4.9 cm，3-8 为 31.8 cm）。
// 评审后补：追尾镜头里的轮廓（下楼时鞋不能顶到肩上，上楼时不能读成站着），踏面公式与 kit 画出来的几何体逐个三角形核对。
// 平地上 ChapterGround 不生效（姿势与以前逐位相同）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/core/rng';
import { compile } from '../../../src/levels/compile';
import ch2 from '../../../src/levels/chapters/ch2';
import ch3 from '../../../src/levels/chapters/ch3';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef, CompiledChapter, CompiledSegment } from '../../../src/levels/schema';
import { ChapterGround, stairStepCentre, stepFloorY } from '../../../src/render/actors/ground';
import { crawlPose, handState, PoseBuilder, stancePhase, type HandState } from '../../../src/render/actors/handCycle';
import { ActorRigFactory, PALM_DROP } from '../../../src/render/actors/rigBuild';
import type { HwKitChunkContext } from '../../../src/render/kitContext';
import { stairsKit } from '../../../src/render/kits/school/stairs';
import { ATLAS } from '../../../src/render/textures/school';
import { fakeCtx as renderCtx } from '../render/helpers';
import { crawlInput, fakeCtx } from './helpers';
import { playRun, scene, type Scene } from './scene';

const CASES: Array<[ChapterDef, string]> = [[ch2 as ChapterDef, '2-1'], [ch3 as ChapterDef, '3-2'], [ch3 as ChapterDef, '3-8'], [ch5 as ChapterDef, '5-2']];

function setup(def: ChapterDef, id: string): { ch: CompiledChapter; seg: CompiledSegment; g: ChapterGround } {
  const ch = compile(def);
  const seg = ch.segments.find((q) => q.def.id === id)!;
  const g = new ChapterGround();
  expect(g.active(ch, seg.index)).toBe(true);
  return { ch, seg, g };
}

function skinned(root: THREE.Object3D, each: (v: THREE.Vector3, bone: number) => void): void {
  root.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  const m = mesh as unknown as THREE.SkinnedMesh;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
  const skin = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const bi = skin.getX(i);
    if (bi >= 24) continue;                              // 第三只手、道具（缩放为 0）
    v.fromBufferAttribute(pos, i);
    m.applyBoneTransform(i, v);
    v.applyMatrix4(m.matrixWorld);
    each(v, bi);
  }
}

/** 场景台里主角某根骨骼关节的世界坐标。 */
function joint(w: Scene, bone: number): THREE.Vector3 {
  let mesh: THREE.SkinnedMesh | null = null;
  w.actor.rig.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  w.actor.rig.root.updateMatrixWorld(true);
  return (mesh as unknown as THREE.SkinnedMesh).skeleton.bones[bone]!.getWorldPosition(new THREE.Vector3());
}

/**
 * 追尾镜头下的轮廓（游戏的 CameraRig，横屏 16:9 与竖屏 390×844），在 8–12 拍里每 1/4 拍取一次：
 * feet = 骨盆比两只脚踝中较高的那只在画面上高多少（NDC）；torso = 骨盆到头的连线高出水平面多少度；
 * leg = 骨盆到脚踝的连线低于水平面多少度（站着是 90°）；pelvisY = 骨盆在画面上的平均高度（NDC）。
 */
async function silhouette(def: ChapterDef, id: string, aspect: number): Promise<{ feet: number; torso: number; leg: number; pelvisY: number }> {
  const w = await scene(def, 'low', aspect);
  const r = { feet: 9, torso: -99, leg: -99, pelvisY: 0 };
  for (let b = 8; b < 12; b += 0.25) {
    playRun(w, id, b - 1, b);
    const pel = joint(w, 1), head = joint(w, 5), aL = joint(w, 20), aR = joint(w, 23);
    const ny = (v: THREE.Vector3) => v.clone().project(w.camera).y;
    r.feet = Math.min(r.feet, ny(pel) - Math.max(ny(aL), ny(aR)));
    r.pelvisY += ny(pel) / 16;
    const el = (a: THREE.Vector3, b2: THREE.Vector3) => Math.atan2(b2.y - a.y, Math.hypot(b2.x - a.x, b2.z - a.z)) / Math.PI * 180;
    r.torso = Math.max(r.torso, el(pel, head));
    r.leg = Math.max(r.leg, -el(pel, aL), -el(pel, aR));
  }
  return r;
}

describe('crawling on stairs (visual fix actors-1)', () => {
  it('the step under s is the one the stairs kit draws (centre k·stride, height = ramp at k)', () => {
    const { seg } = setup(ch3 as ChapterDef, '3-8');
    for (let k = 0; k <= 4; k++) {
      const sc = seg.s0 + k * seg.stride;
      for (const d of [-0.29, 0, 0.29]) {
        expect(stairStepCentre(sc + d, seg.s0, seg.s1, seg.stride)).toBeCloseTo(sc, 9);
        expect(stepFloorY(seg, sc + d)).toBeCloseTo(seg.floorY(sc), 9);
      }
    }
  });

  it('stepFloorY matches every tread the stairs kit actually builds (2-1, 3-2, 3-8, 5-2)', () => {
    // 公式只在 render/actors/ground.ts 里写一份（不改 WP1 的 compile.ts、WP3 的 stairs.ts），这里直接构建 kit 的 chunk 逐个踏面核对
    for (const [def, id] of CASES) {
      const { seg } = setup(def, id);
      const ctx = renderCtx('low');
      const len = 2 * Math.max(1, Math.round(12 / (2 * seg.stride))) * seg.stride;
      let treads = 0;
      for (let s0 = seg.s0; s0 < seg.s1 - 1e-6; s0 += len) {
        const s1 = Math.min(seg.s1, s0 + len);
        const variant = (seg.def as { variant: string }).variant;
        const kctx: HwKitChunkContext = {
          seg, variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0), openings: [],
          quality: ctx.quality, rng: createRng(3, `stairs:${variant}`), mat: ctx.mat, tex: ctx.tex,
          hw: { generic: false, prev: { kit: 'corridor', variant: 'morning' }, next: { kit: 'corridor', variant: 'morning' }, chunkLen: len, plateRect: () => ATLAS.plates[0] },
        };
        const g = stairsKit.build(kctx).floor;
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        const idx = g.getIndex();
        const n = idx ? idx.count : p.count;
        const at = (k: number) => (idx ? idx.getX(k) : k);
        for (let t = 0; t + 2 < n; t += 3) {
          const ys = [0, 1, 2].map((j) => p.getY(at(t + j)));
          if (Math.max(...ys) - Math.min(...ys) > 1e-6) continue;               // 只看水平的三角形（踏面）
          const zs = [0, 1, 2].map((j) => p.getZ(at(t + j)));
          if (Math.max(...zs) - Math.min(...zs) < 1e-4) continue;
          const sMid = s0 - (zs[0]! + zs[1]! + zs[2]!) / 3;
          if (sMid < seg.s0 || sMid > seg.s1) continue;                         // 段外的平台
          treads++;
          expect(Math.abs(ys[0]! + seg.floorY(s0) - stepFloorY(seg, sMid)), `${id} tread at s ${sMid.toFixed(2)}`).toBeLessThan(1e-6);
        }
      }
      expect(treads, `${id} treads checked`).toBeGreaterThan(20);
    }
  });

  for (const [def, id] of CASES) {
    it(`${id}: planted hand stays on its step; mesh above the steps; knees and ankles clear by ≥ 4 cm`, () => {
      const { seg, g } = setup(def, id);
      const stride = seg.stride, cadence = seg.cadenceAt(8), speed = cadence * stride;
      const b = new PoseBuilder();
      const ctx = fakeCtx('low');
      const f = new ActorRigFactory(ctx);
      const rig = f.make('player', ctx.mat.lambert({ vertexColors: true }));
      const st = stancePhase(stride);
      const hs: HandState = { phase: 'stance', wx: 0, wy: 0, ws: 0, palm: 0, knuckle: 0, pad: 0, phi: 0, stance: 0 };
      const anchor: Record<'L' | 'R', THREE.Vector3 | null> = { L: null, R: null };
      let onStep = 0, drift = 0, below = 0, worst = '', jointClear = 9;
      const w = new THREE.Vector3();
      for (let beat = 4; beat < 12; beat += cadence / 120) {
        const s = seg.s0 + beat * stride;
        const inp = crawlInput({ s, beat, stride, cadence, speed, floorY: seg.floorY(s), ground: g });
        const pose = crawlPose(inp, b);
        for (const side of ['L', 'R'] as const) {
          handState(inp, side === 'L' ? 0 : 1, 0, hs);
          b.jointWorld(`palm${side}`, w);
          if (hs.phase === 'stance' && hs.phi > 0.02 && hs.phi < st - 0.005) {
            onStep = Math.max(onStep, Math.abs(w.y - (stepFloorY(seg, hs.ws) + PALM_DROP * Math.cos(hs.palm))));
            const a = anchor[side];
            if (!a) anchor[side] = w.clone(); else drift = Math.max(drift, a.distanceTo(w));
          } else anchor[side] = null;
        }
        for (const j of ['shinL', 'shinR', 'footL', 'footR'] as const) {
          b.jointWorld(j, w);
          jointClear = Math.min(jointClear, w.y - stepFloorY(seg, -w.z));
        }
        rig.apply(pose);
        skinned(rig.root, (v, bi) => {
          const d = v.y - stepFloorY(seg, -v.z);
          if (d < below) { below = d; worst = `beat ${beat.toFixed(2)} bone ${bi} s ${(-v.z).toFixed(2)} y ${v.y.toFixed(3)}`; }
        });
      }
      expect(onStep, 'wrist height above its step − PALM_DROP').toBeLessThan(0.01);
      expect(drift, 'planted wrist drift').toBeLessThan(0.01);
      expect(jointClear, 'knee / ankle above the step under it').toBeGreaterThan(0.04);
      expect(below, `deepest vertex below the step: ${worst}`).toBeGreaterThan(-0.006);
    });
  }

  it('chase camera: going down, the shoes stay below the hips like on flat floor; going up (ch3) he does not read as standing', async () => {
    // 下楼的镜头按身后的台阶抬高（只比台阶高四十几厘米时，往后拖的腿怎么摆都正对镜头）。
    // 评审：第一版绕根上方 0.4 m 俯仰、腿跟着坡翘起，下楼时追尾镜头（按脚下坡线定高，只比身后的台阶高四十几厘米）里两只鞋压到肩上
    // （横屏 feet 0.134，平地 0.240）；上楼时躯干整个抬 14°、腿垂在下面（torso 30°、leg 0.434 NDC 的脚在髋下很远）。
    for (const aspect of [16 / 9, 390 / 844]) {
      const flat = await silhouette(ch3 as ChapterDef, '3-1', aspect);
      for (const [def, id] of CASES) {
        const r = await silhouette(def, id, aspect);
        const tag = `${id} @ ${aspect.toFixed(2)}`;
        expect(r.feet, `${tag}: hips above the shoes on screen`).toBeGreaterThan(0.9 * flat.feet);
        expect(r.torso, `${tag}: torso elevation (flat ${flat.torso.toFixed(1)}°)`).toBeLessThan(flat.torso + 8);
        expect(r.leg, `${tag}: hip → ankle below horizontal (standing = 90°)`).toBeLessThan(20);
        // 下楼时镜头抬高（CameraRig 的 STAIR_CAM_RAISE），注视点跟着压低：他在画面上的位置和平地一样，不沉到字幕下面
        expect(Math.abs(r.pelvisY - flat.pelvisY), `${tag}: pelvis height on screen vs flat`).toBeLessThan(0.05);
      }
    }
  }, 60000);

  it('stair segments spawn no doubles (history doubles copy the drawn pose; oracle doubles get the same ChapterGround)', () => {
    for (const [def, id] of CASES) {
      const { seg } = setup(def, id);
      const evs = ((seg.def as { events?: Array<{ type: string }> }).events ?? []).filter((e) => e.type === 'double' || e.type === 'memory');
      expect(evs, id).toEqual([]);
    }
  });

  it('flat segments: ChapterGround is not used and the pose ignores a flat profile', () => {
    const ch = compile(ch3 as ChapterDef);
    const g = new ChapterGround();
    const flat = ch.segments.findIndex((q, k) => q.kind === 'run' && !g.active(ch, k));
    expect(flat).toBeGreaterThanOrEqual(0);
    // 平的地面形状（斜率 0、踏面 = floorY）给出与没有地面形状时相同的姿势
    const prof = { stepY: () => 0, slope: () => 0 };
    const b1 = new PoseBuilder(), b2 = new PoseBuilder();
    for (const beat of [3.1, 3.4, 3.8, 4.25]) {
      const p1 = crawlPose(crawlInput({ s: beat, beat, stride: 1 }), b1);
      const p2 = crawlPose(crawlInput({ s: beat, beat, stride: 1, ground: prof }), b2);
      for (const k of Object.keys(p1) as Array<keyof typeof p1>) {
        const a = p1[k], c = p2[k];
        if (Array.isArray(a) && Array.isArray(c)) for (let n = 0; n < a.length; n++) expect(Math.abs((a[n] as number) - (c[n] as number)), `${String(k)}[${n}]`).toBeLessThan(1e-9);
      }
    }
  });
});
