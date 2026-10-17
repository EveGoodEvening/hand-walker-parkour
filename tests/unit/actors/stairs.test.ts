// tests/unit/actors/stairs.test.ts —— 视觉修复 actors-1：楼梯上的爬姿。模拟按连续的坡线 floorY 走，台阶是一级一级的平踏面
// （kits/school/stairs.ts）。支撑手按在落掌处那一级踏面上、整个支撑期不上下滑；身体顺着坡俯仰，网格的任何一点都不戳进台阶；
// 膝、踝离身下的踏面 ≥ 2 cm（手臂胶囊贴着踏面，容差 6 mm）。平地上 ChapterGround 不生效（姿势与以前逐位相同）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX } from '../../../src/core/rig';
import { compile, stairStepCentre, stepFloorY } from '../../../src/levels/compile';
import ch2 from '../../../src/levels/chapters/ch2';
import ch3 from '../../../src/levels/chapters/ch3';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef, CompiledChapter, CompiledSegment } from '../../../src/levels/schema';
import { ChapterGround } from '../../../src/render/actors/Actor';
import { crawlPose, handState, PoseBuilder, stancePhase, type HandState } from '../../../src/render/actors/handCycle';
import { ActorRigFactory, PALM_DROP } from '../../../src/render/actors/rigBuild';
import { crawlInput, fakeCtx } from './helpers';

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

  for (const [def, id] of CASES) {
    it(`${id}: planted hand stays on its step; mesh above the steps; knees and ankles clear`, () => {
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
          if (d < below) {
            below = d;
            const sideI = bi < 12 ? 0 : 1;
            handState(inp, sideI as 0 | 1, 0, hs);
            const k = (-v.z - seg.s0) / stride;
            worst = `beat ${beat.toFixed(2)} bone ${bi} (${v.x.toFixed(2)}, ${v.y.toFixed(3)}, ${(-v.z).toFixed(2)}) stepFrac ${(k - Math.round(k)).toFixed(2)} phase ${hs.phase} phi ${hs.phi.toFixed(2)} u ${(hs.swingU ?? 0).toFixed(2)} wsFrac ${((hs.ws - seg.s0) / stride).toFixed(2)}`;
          }
        });
      }
      expect(onStep, 'wrist height above its step − PALM_DROP').toBeLessThan(0.01);
      expect(drift, 'planted wrist drift').toBeLessThan(0.01);
      expect(jointClear, 'knee / ankle above the step under it').toBeGreaterThan(0.02);
      expect(below, `deepest vertex below the step: ${worst}`).toBeGreaterThan(-0.006);
    });
  }

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
    void BONE_INDEX;
  });
});
