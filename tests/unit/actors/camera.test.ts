// tests/unit/actors/camera.test.ts —— §8.10 WP5 验收 6、7：竖屏 360×640 下三条车道中心都投影在视口内；
// 「减少晃动」关闭晃动、滚转、震动和视角变化。另测 §5.4 的机位数值。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/core/settings';
import { STILL_ORIGIN } from '../../../src/core/constants';
import type { SimSnapshot } from '../../../src/core/types';
import ch2 from '../../../src/levels/chapters/ch2';
import ch3 from '../../../src/levels/chapters/ch3';
import type { ChapterDef } from '../../../src/levels/schema';
import { WP5 } from '../../../src/render/actors/shared';
import { CameraRig, stillTurn, vFromH } from '../../../src/render/camera/CameraRig';
import { FOLLOW, SEGMENT_SHOTS, SET_SHOT_RETURN, SET_SHOTS } from '../../../src/render/camera/shots';
import { BOARD_Z, labBoardSet } from '../../../src/render/sets/school/labBoard';
import { BONE_INDEX } from '../../../src/core/rig';
import { snap } from './helpers';
import { frame, playerVertsInFrame, playStill, scene, stillSnap, type Scene } from './scene';

function apply(cam: THREE.PerspectiveCamera, o: { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number }, aspect: number): void {
  cam.aspect = aspect; cam.fov = o.fov;
  cam.position.copy(o.pos); cam.up.set(0, 1, 0); cam.lookAt(o.look);
  if (o.roll) cam.rotateZ(o.roll);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}

function settle(rig: CameraRig, s0: ReturnType<typeof snap>, aspect: number, settings: Settings, frames = 90) {
  let prev = s0, out = rig.compute(s0, s0, 1, 1 / 60, aspect, settings);
  for (let i = 1; i <= frames; i++) {
    const n = snap({ ...{ s: s0.player.s + i * 0.08, lane: s0.player.lane, x: s0.player.x, beat: (s0.player.s + i * 0.08) }, t: s0.t + i / 60 });
    out = rig.compute(prev, n, 1, 1 / 60, aspect, settings);
    prev = n;
  }
  return { out, last: prev };
}

describe('CameraRig (§5.4)', () => {
  it('landscape follow camera matches FOLLOW.landscape: (0.7·x, 1.15, +2.8) (U5, replaces §5.4 0.92 / 2.35), vertical fov 50–62°', () => {
    const rig = new CameraRig();
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: true };
    const { out, last } = settle(rig, snap({ s: 10, lane: 1 }), 16 / 9, settings);
    expect(out.pos.x).toBeCloseTo(0.7 * 1.1, 2);
    expect(out.pos.y).toBeCloseTo(FOLLOW.landscape.h, 3);
    expect(out.pos.z).toBeCloseTo(-last.player.s + FOLLOW.landscape.back, 3);
    expect(out.look.y).toBeCloseTo(FOLLOW.landscape.ly, 3);
    expect(out.fov).toBeGreaterThanOrEqual(50);
    expect(out.fov).toBeLessThanOrEqual(62);
  });

  it('portrait 360×640: all three lane centres project inside the viewport from every lane', () => {
    const aspect = 360 / 640;
    const cam = new THREE.PerspectiveCamera(55, aspect, 0.05, 240);
    for (const lane of [-1, 0, 1] as const) {
      const rig = new CameraRig();
      const { out, last } = settle(rig, snap({ s: 20, lane }), aspect, { ...DEFAULT_SETTINGS });
      expect(out.fov).toBeLessThanOrEqual(80);
      apply(cam, out, aspect);
      for (const l of [-1, 0, 1]) {
        // 车道中心：玩家所在里程处的地面，以及前方 4 m 处
        for (const ahead of [0, 4]) {
          const p = new THREE.Vector3(l * 1.1, 0, -(last.player.s + ahead)).project(cam);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
          expect(p.z).toBeLessThan(1);
        }
      }
    }
  });

  it('reducedMotion: no bob, no roll, no shake, no fov change; look-back is a cut', () => {
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: true };
    const rig = new CameraRig();
    let prev = snap({ s: 0 });
    const ys: number[] = [], rolls: number[] = [], fovs: number[] = [];
    rig.onEvent({ type: 'hit', tick: 0, data: { severity: 'stumble', kind: 'bag', obstacleId: 1, lane: 0, steady: 2, crowd: false, firstLegHit: false } } as never);
    for (let i = 1; i < 120; i++) {
      const lane = i < 40 ? 0 : 1;
      const x = i < 40 ? 0 : Math.min(1.1, (i - 40) * 0.15);
      const n = snap({ s: i * 0.05, beat: i * 0.05, lane, x, t: i / 60, speed: i > 80 ? 8 : 5 });
      const o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      ys.push(o.pos.y); rolls.push(o.roll); fovs.push(o.fov);
      prev = n;
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9);
    expect(rolls.every((r) => r === 0)).toBe(true);
    expect(Math.max(...fovs) - Math.min(...fovs)).toBeLessThan(1e-9);
    // 回头：直接切镜头（lookBack < 0.5 不转，≥ 0.5 转到 160°）
    const r2 = new CameraRig();
    const a = r2.compute(snap({ s: 5 }), snap({ s: 5, lookBack: 0.3, t: 0.1 }), 1, 1 / 60, 16 / 9, settings);
    expect(a.pos.z).toBeGreaterThan(-5);
    const b = r2.compute(snap({ s: 5, t: 0.1 }), snap({ s: 5, lookBack: 0.6, t: 0.2 }), 1, 1 / 60, 16 / 9, settings);
    expect(b.pos.z).toBeLessThan(-5);        // 转到玩家前方，看向身后
  });

  it('without reducedMotion the gait bob, lane-change roll, hit shake and dream fov are present', () => {
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: false };
    const rig = new CameraRig();
    let prev = snap({ s: 0 });
    const ys: number[] = [], rolls: number[] = [], fovs: number[] = [];
    for (let i = 1; i < 150; i++) {
      if (i === 100) rig.onEvent({ type: 'hit', tick: 0, data: { severity: 'crash', kind: 'bag', obstacleId: 1, lane: 0, steady: 1, crowd: false, firstLegHit: false } } as never);
      const lane = i < 40 ? 0 : 1;
      const x = i < 40 ? 0 : Math.min(1.1, (i - 40) * 0.15);
      const n = snap({ s: i * 0.08, beat: i * 0.08, lane, x, t: i / 60, speed: i > 110 ? 9 : 5 });
      const o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      ys.push(o.pos.y); rolls.push(o.roll); fovs.push(o.fov);
      prev = n;
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.008);
    expect(Math.max(...rolls.map(Math.abs))).toBeGreaterThan(0.005);
    expect(Math.max(...rolls.map(Math.abs))).toBeLessThanOrEqual(1.5 * Math.PI / 180 + 1e-9);
    expect(Math.max(...fovs)).toBeGreaterThan(Math.min(...fovs) + 1);
  });

  it('vFromH derives the vertical fov from 76° horizontal', () => {
    expect(vFromH(76, 16 / 9)).toBeCloseTo(47.4, 0);
    expect(vFromH(76, 1)).toBeCloseTo(76, 6);
  });
});

describe('segment chase shot (U5): 5-3 @30–@212 pulls back so the shadow crawling after you is in frame', () => {
  const run = (segBeatOf: (i: number) => number, frames: number) => {
    const rig = new CameraRig();
    const settings = { ...DEFAULT_SETTINGS, reducedMotion: false };
    let prev = snap({ s: 0 }); prev.segment = '5-3';
    let o = rig.compute(prev, prev, 1, 1 / 60, 16 / 9, settings);
    for (let i = 1; i <= frames; i++) {
      const n = snap({ s: i * 0.09, beat: i * 0.09, t: i / 60 });
      n.segment = '5-3'; n.segBeat = segBeatOf(i);
      o = rig.compute(prev, n, 1, 1 / 60, 16 / 9, settings);
      prev = n;
    }
    return { o, last: prev };
  };
  it('inside the range the camera is ~1.8 m up and ~3.8 m back, looking at the ground 2 m ahead; outside it is the normal follow camera', () => {
    const inside = run((i) => 40 + i * 0.08, 120);
    const sh = SEGMENT_SHOTS['5-3']!;
    expect(inside.o.pos.y).toBeCloseTo(sh.h, 1);
    expect(inside.o.pos.z - -inside.last.player.s).toBeCloseTo(sh.back, 1);
    expect(inside.o.look.y).toBeLessThan(0.15);
    // 身后 2 m 的地面在画面里（追来的影子）
    const cam = new THREE.PerspectiveCamera(inside.o.fov, 16 / 9, 0.05, 200);
    apply(cam, inside.o, 16 / 9);
    const behind = new THREE.Vector3(0, 0, -inside.last.player.s + 2).project(cam);
    expect(Math.abs(behind.x)).toBeLessThan(1); expect(Math.abs(behind.y)).toBeLessThan(1);
    const late = run((i) => 150 + i * 0.08, 120);                                     // 「我开始跑。」之后照样
    expect(late.o.pos.y).toBeCloseTo(sh.h, 1);
    const outside = run((i) => 213 + i * 0.08, 120);
    expect(outside.o.pos.y).toBeCloseTo(FOLLOW.landscape.h, 1);
    const before = run((i) => 10 + i * 0.08, 120);
    expect(before.o.pos.y).toBeCloseTo(FOLLOW.landscape.h, 1);
  });
});

// 修复轮 B3：静场里的 turnBack cue 以前被忽略（静场只认 SET_SHOTS）。第三轮（独立验收：2-9 顺着指向右后方的手转过去，身后什么也没有，
// 黑板上的字在镜头转回来时写出，与 DESIGN 2-9「镜头转向身后的黑板」相反；两处都是 0.3 s 的甩镜，原文是「我慢慢地转过……」）：
//   2-9：0–5.2 s 低头看他和地上的影子（黑板在画面外），4.4 s 影子的第三只手伸出来指向黑板，5.2 s 起顺着那只手用 0.8 s 慢慢转到黑板，
//        停在那里；6.0 s 的字就是转过来看见的。
//   3-10：5.4 s 起用 1.0 s 慢慢转过去看门和毛巾，停到 10.4 s 关门前最后一眼（问话是对着门的）。
describe('still turnBack (B3 r3): 2-9 turns from the shadow to the board and stays; 3-10 turns to the door and holds', () => {
  const anchorDir = (w: Scene): THREE.Vector3 => {
    // 镜头朝向换到锚点空间（主角朝 −z；身后是 +z、右边是 +x）
    const inv = new THREE.Matrix3().setFromMatrix4(WP5.stillAnchor).invert();
    return w.camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(inv).normalize();
  };
  const camAt = async (def: ChapterDef, seg: string, t: number) => { const w = await scene(def, 'medium'); playStill(w, seg, t); return w; };
  const O = new THREE.Vector3(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
  /** 黑板（含铝框）上 13 × 5 个点（世界坐标）。 */
  const boardPts = (): THREE.Vector3[] => {
    const r = labBoardSet.surfaces!('default')[0]!.rect;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 4; j++) {
      pts.push(new THREE.Vector3(r[0] - 0.07 + (r[2] - r[0] + 0.14) * i / 12, r[1] - 0.05 + (r[3] - r[1] + 0.1) * j / 4, BOARD_Z + 0.012).add(O));
    }
    return pts;
  };
  const inFrame = (cam: THREE.Camera, p: THREE.Vector3, m = 1): boolean => { const q = p.clone().project(cam); return q.z < 1 && Math.abs(q.x) <= m && Math.abs(q.y) <= m; };
  /** 同一时刻按另一种宽高比算的镜头（静场机位只随宽高比变视角）。 */
  const camAspect = (w: Scene, seg: string, t: number, aspect: number): THREE.PerspectiveCamera => {
    const s = w.ch.segments.find((x) => x.def.id === seg)!;
    const n = stillSnap(s, t);
    const o = w.cam.compute(n, n, 1, 1 / 60, aspect, { ...DEFAULT_SETTINGS });
    const c = new THREE.PerspectiveCamera(o.fov, aspect, 0.05, 300);
    c.position.copy(o.pos); c.up.set(0, 1, 0); c.lookAt(o.look); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    return c;
  };
  /** 影子第三只手的顶点（世界坐标）和它的根（arm3Upper 的顶点中心）。 */
  const shadowArm = (w: Scene): { pts: THREE.Vector3[]; root: THREE.Vector3; tip: THREE.Vector3 } => {
    const root = (w.shadow as unknown as { main: { root: THREE.Object3D } }).main.root;
    root.updateMatrixWorld(true);
    let mesh: THREE.SkinnedMesh | null = null;
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
    const m = mesh as unknown as THREE.SkinnedMesh;
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, skin = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
    const pts: THREE.Vector3[] = [], up: THREE.Vector3[] = [];
    if ((root.getObjectByName('arm3Upper') as THREE.Bone).scale.x < 0.01) return { pts, root: new THREE.Vector3(), tip: new THREE.Vector3() };
    for (let i = 0; i < pos.count; i++) {
      const bi = skin.getX(i);
      if (bi < BONE_INDEX.arm3Upper || bi > BONE_INDEX.arm3Hand) continue;
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      pts.push(v);
      if (bi === BONE_INDEX.arm3Upper) up.push(v);
    }
    const c = up.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / up.length);
    const tip = pts.reduce((b, p) => (p.distanceTo(c) > b.distanceTo(c) ? p : b), c.clone());
    return { pts, root: c, tip };
  };
  const yawOf = (d: THREE.Vector3): number => Math.atan2(d.x, d.z);
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

  it('2-9: the board is out of frame from 0 s until the turn at 5.2 s (landscape and portrait); his shadow and the third hand are in frame', async () => {
    for (const t of [0.5, 3.0, 4.9, 5.2]) {
      const w = await camAt(ch2 as ChapterDef, '2-9', t);
      for (const aspect of [16 / 9, 2560 / 1080, 4 / 3, 390 / 844]) {
        const c = camAspect(w, '2-9', t, aspect);
        expect(boardPts().filter((p) => inFrame(c, p)).length, `${t} s, aspect ${aspect.toFixed(2)}`).toBe(0);
      }
      expect(w.shadow.state.planar, `${t} s`).toBe(true);                       // 影子从一开始就趴在地上（事件光线）
      expect(w.shadow.state.eventK, `${t} s`).toBe(1);
      expect(playerVertsInFrame(w), `${t} s`).toBeGreaterThan(200);            // 他也在画面里（低头看影子）
      const arm = shadowArm(w);
      if (t < 4.4) expect(arm.pts.length, `${t} s`).toBe(0);                    // 4.4 s 之前只有两只手
      if (t >= 4.9) {
        for (const aspect of [16 / 9, 2560 / 1080, 4 / 3, 390 / 844]) {
          const c = camAspect(w, '2-9', t, aspect);
          expect(arm.pts.filter((p) => inFrame(c, p, 0.85)).length / arm.pts.length, `${t} s, aspect ${aspect.toFixed(2)}`).toBeGreaterThan(0.98);
        }
      }
    }
  });

  it('2-9: the shadow is drawn from the first frame on the low tier too (planar shadows are otherwise only for shadow events there)', async () => {
    const w = await scene(ch2 as ChapterDef, 'low');
    playStill(w, '2-9', 1 / 60);
    expect(w.shadow.state.planar).toBe(true);
    expect(w.shadow.state.eventK).toBe(1);                                     // 换段进静场直接到位，不从短影子拉长
    const w3 = await scene(ch3 as ChapterDef, 'low');
    playStill(w3, '3-10', 1);
    expect(w3.shadow.state.planar).toBe(false);                                 // 别的静场照旧
  });

  it('2-9: the third hand points at the board, and the camera turns the way it points; from 6.0 s the board is in frame and the camera stays there', async () => {
    const w5 = await camAt(ch2 as ChapterDef, '2-9', 5.2);
    const arm = shadowArm(w5);
    const hd = arm.tip.clone().sub(arm.root).setY(0).normalize();
    // 手的方向延长到黑板的平面，落在黑板上
    const hit = arm.root.clone().addScaledVector(hd, (BOARD_Z + O.z - arm.root.z) / hd.z).sub(O);
    expect(hd.z).toBeLessThan(-0.7);
    expect(Math.abs(hit.x)).toBeLessThan(1.8);
    const d0 = w5.camera.getWorldDirection(new THREE.Vector3());
    const w6 = await camAt(ch2 as ChapterDef, '2-9', 6.0);
    const d1 = w6.camera.getWorldDirection(new THREE.Vector3());
    // 水平方向：镜头转的方向（左 / 右）和手在镜头里指的方向一致；朝向的变化（水平分量）顺着手
    expect(Math.sign(wrap(yawOf(d1) - yawOf(d0)))).toBe(Math.sign(wrap(yawOf(hd) - yawOf(d0))));
    expect(d1.clone().sub(d0).setY(0).normalize().dot(hd)).toBeGreaterThan(0.8);
    expect(d1.y).toBeGreaterThan(d0.y + 0.5);                                    // 抬头
    for (const t of [6.0, 7.0, 9.0, 13.0]) {
      const w = t === 6.0 ? w6 : await camAt(ch2 as ChapterDef, '2-9', t);
      for (const aspect of [16 / 9, 390 / 844]) {
        const c = camAspect(w, '2-9', t, aspect);
        const pts = boardPts();
        // 横屏整块黑板都在画面里；竖屏画面窄，黑板两端出画，中间 60%（写字的地方）都在
        expect(pts.filter((p) => inFrame(c, p)).length / pts.length, `${t} s, aspect ${aspect.toFixed(2)}`).toBeGreaterThan(aspect > 1 ? 0.99 : 0.8);
        expect(pts.filter((p) => Math.abs(p.x - O.x) < 1.1).every((p) => inFrame(c, p)), `${t} s, aspect ${aspect.toFixed(2)}`).toBe(true);
      }
      const sh = SET_SHOTS.labBoard!;
      expect(w.camera.position.distanceTo(new THREE.Vector3(...sh.pos).applyMatrix4(WP5.stillAnchor)), `${t} s`).toBeLessThan(1e-6);
    }
  });

  // 竖屏：黑板机位换成 SET_SHOT_PORTRAIT（水平视角只有约 40°，原来的机位拍不全那一行字，第一个字出画）
  it('2-9: the whole chalk line is in frame and not behind his head from 6.0 s (portrait 0.45–0.75 and landscape), and the portrait turn keeps clear of his head', async () => {
    const line: THREE.Vector3[] = [];
    const r = labBoardSet.surfaces!('default')[0]!.rect;
    const half = (r[2] - r[0]) * 0.86 / 2, y = r[3] - (r[3] - r[1]) * 0.45;    // 贴图里居中、占板宽 86%、上沿往下 45%
    for (let i = 0; i <= 8; i++) line.push(new THREE.Vector3(-half + 2 * half * i / 8, y, BOARD_Z + 0.012).add(O));
    // 字高约 0.24 m（贴图 2:1 拉到 3.6 × 1.25 m 的板上）：这一行字的上下沿，用来查他的头有没有挡住字
    const band: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) for (const dy of [-0.12, 0, 0.12]) band.push(new THREE.Vector3(-half + 2 * half * i / 16, y + dy, BOARD_Z + 0.012).add(O));
    const sphere: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const u = (i + 0.5) / 64, th = Math.acos(1 - 2 * u), ph = i * 2.39996;
      sphere.push(new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)).multiplyScalar(0.15));
    }
    for (const t of [6.0, 7.4, 13.0]) {
      const w = await camAt(ch2 as ChapterDef, '2-9', t);
      for (const aspect of [0.45, 390 / 844, 360 / 640, 768 / 1024, 16 / 9, 2560 / 1080]) {
        const c = camAspect(w, '2-9', t, aspect);
        expect(line.every((p) => inFrame(c, p, 0.97)), `${t} s, aspect ${aspect.toFixed(2)}`).toBe(true);
        // 他的头（半径 0.15 m 的球）在画面上的包围框里没有这一行字的点
        const hb: [number, number, number, number] = [9, 9, -9, -9];
        for (const d of sphere) { const q = WP5.playerHead.clone().add(d).project(c); hb[0] = Math.min(hb[0], q.x); hb[1] = Math.min(hb[1], q.y); hb[2] = Math.max(hb[2], q.x); hb[3] = Math.max(hb[3], q.y); }
        const hidden = band.filter((p) => { const q = p.clone().project(c); return q.x > hb[0] && q.x < hb[2] && q.y > hb[1] && q.y < hb[3]; });
        expect(hidden.length, `${t} s, aspect ${aspect.toFixed(2)}: chalk line behind his head`).toBe(0);
      }
    }
    const w = await camAt(ch2 as ChapterDef, '2-9', 5.2);
    for (let t = 5.2; t <= 6.05; t += 0.05) {
      const c = camAspect(w, '2-9', t, 390 / 844);
      expect(c.position.distanceTo(WP5.playerHead), `${t.toFixed(2)}`).toBeGreaterThan(0.3);
      if (t <= 5.2 + 1e-6) expect(boardPts().filter((p) => inFrame(c, p)).length).toBe(0);
    }
  });

  it('3-10: turns over 1.0 s to the door and the dripping towel, holds while he asks both questions, and cuts to the last look at the mirror at 10.4 s', async () => {
    const half = anchorDir(await camAt(ch3 as ChapterDef, '3-10', 5.9));
    expect(half.z).toBeGreaterThan(-0.7); expect(half.z).toBeLessThan(0.7);                 // 1.0 s 慢慢转：到一半还在侧面
    for (const t of [6.4, 7.2, 8.8, 10.3]) {
      const w = await camAt(ch3 as ChapterDef, '3-10', t);
      expect(anchorDir(w).z, `${t} s`).toBeGreaterThan(0.7);
      for (const p of [[0.2, 1.0, 1.87], [0.2, 1.9, 1.87], [-0.72, 1.55, 1.85]] as const) {        // 门的中间、门的上沿、毛巾
        const q = new THREE.Vector3(...p).add(O).project(w.camera);
        expect(Math.abs(q.x), `${t} s ${p}`).toBeLessThan(0.9); expect(Math.abs(q.y), `${t} s ${p}`).toBeLessThan(0.9); expect(q.z).toBeLessThan(1);
      }
      expect(w.dbl.active().filter((d) => d.visible).map((d) => d.id), `${t} s`).toEqual([]);  // 镜子里没有人（3.8 s doubleEnd），身后也没有
      expect(playerVertsInFrame(w), `${t} s`).toBe(0);
    }
    const last = await camAt(ch3 as ChapterDef, '3-10', 10.5);
    expect(anchorDir(last).z).toBeLessThan(-0.6);                                             // 关门前最后一眼：又看着镜子
    const ret = SET_SHOT_RETURN.bathroomMirror!;
    expect(last.camera.position.distanceTo(new THREE.Vector3(...ret.pos).applyMatrix4(WP5.stillAnchor))).toBeLessThan(1e-6);
  });

  it('both turns are slow (≥ 0.8 s, ≤ 4° a frame), never pass within 0.25 m of his head, and run on still time (a goto into the middle needs no cue)', async () => {
    for (const [def, seg, t0, t1, at, sec] of [[ch2, '2-9', 5.0, 6.2, 5.2, 0.8], [ch3, '3-10', 5.2, 6.6, 5.4, 1.0]] as const) {
      const w = await scene(def as ChapterDef, 'medium');
      playStill(w, seg, t0 - 1 / 60);
      const s = w.ch.segments.find((x) => x.def.id === seg)!;
      let prevDir: THREE.Vector3 | null = null;
      let prev = stillSnap(s, t0 - 1 / 60);
      let moving = 0;
      for (let t = t0; t <= t1; t += 1 / 60) {
        const n = stillSnap(s, t);
        frame(w, prev, n); prev = n;
        expect(w.camera.position.distanceTo(WP5.playerHead), `${seg} ${t.toFixed(2)}`).toBeGreaterThan(0.25);
        const d = w.camera.getWorldDirection(new THREE.Vector3());
        if (prevDir) {
          const a = d.angleTo(prevDir) * 180 / Math.PI;
          expect(a, `${seg} ${t.toFixed(2)}`).toBeLessThan(4);
          if (a > 0.05) moving += 1 / 60;
          if (t < at - 1e-6 || t > at + sec + 1 / 30) expect(a, `${seg} ${t.toFixed(2)} outside the turn`).toBeLessThan(1e-6);
        }
        prevDir = d;
      }
      expect(moving, seg).toBeGreaterThan(sec - 0.15);
      // 跳到转身之后（不重放 cue）：机位照样是转过去之后的
      const g = await scene(def as ChapterDef, 'medium');
      const n = stillSnap(s, at + sec + 0.5);
      g.cam.onSegment(s);
      g.cam.onEvent({ type: 'segment', tick: 0, data: {} } as never);
      frame(g, n, n);
      const ref = await camAt(def as ChapterDef, seg, at + sec + 0.5);
      expect(g.camera.getWorldDirection(new THREE.Vector3()).angleTo(ref.camera.getWorldDirection(new THREE.Vector3())) * 180 / Math.PI, seg).toBeLessThan(1);
    }
  });

  it('reducedMotion: the turn is a cut; a still without its own turn-back shot pans 160° left in place and back', async () => {
    const rm = { ...DEFAULT_SETTINGS, reducedMotion: true };
    // 2-9：5.2 s 之前低头看影子，5.2 s 起直接是黑板
    const w = await scene(ch2 as ChapterDef, 'medium');
    const s = w.ch.segments.find((x) => x.def.id === '2-9')!;
    w.cam.onSegment(s);
    playStill(w, '2-9', 0.1);
    const at = (t: number) => { const n = stillSnap(s, t); return w.cam.compute(n, n, 1, 1 / 60, 16 / 9, rm).look.clone().sub(w.cam.out.pos).normalize(); };
    const b = at(5.19), c = at(5.21);
    expect(b.y).toBeLessThan(-0.5);                                             // 低头
    expect(c.y).toBeGreaterThan(0); expect(c.z).toBeLessThan(-0.9);             // 第一帧就是黑板
    // 没有专门的回头机位（deskFeet）：位置不动，原地向左转 160°，cue 结束时切回来
    const r2 = new CameraRig();
    const st = (t: number, set = 'deskFeet'): SimSnapshot => {
      const n = snap({ s: 0, t: 50 + t, segKind: 'still' });
      n.still = { set: set as never, variant: 'default', t, duration: 10, prompt: null, held: 0 };
      return n;
    };
    WP5.stillAnchor.identity();
    r2.setShot('deskFeet', 0, 50);
    const p0 = r2.compute(st(0), st(0.1), 1, 1 / 60, 16 / 9, rm).pos.clone();
    const d0 = r2.out.look.clone().sub(p0).setY(0).normalize();
    r2.setShot('turnBack', 1, 50.2);
    const p1 = r2.compute(st(0.1), st(0.3), 1, 1 / 60, 16 / 9, rm).pos.clone();
    const d1 = r2.out.look.clone().sub(p1).setY(0).normalize();
    expect(p1.distanceTo(p0)).toBeLessThan(1e-9);
    expect(Math.atan2(d0.x * d1.z - d0.z * d1.x, d0.x * d1.x + d0.z * d1.z) * 180 / Math.PI).toBeCloseTo(-160, 3);   // 从上往下看逆时针 = 向左
    const p2 = r2.compute(st(0.3), st(1.3), 1, 1 / 60, 16 / 9, rm).pos.clone();
    expect(r2.out.look.clone().sub(p2).setY(0).normalize().dot(d0)).toBeGreaterThan(0.999);
    expect(stillTurn).toBeTypeOf('function');
  });
});

// 修复轮 B3：wp3Preview 的预览机位以前还是 §5.4 的旧追尾机位（0.92 / 2.35 / 0.45），set 预览也是一张和游戏对不上的表
describe('wp3Preview cameras match the game cameras (B3)', () => {
  it('run preview = CameraRig follow camera (landscape and portrait); set preview = the set\'s default still shot relative to its anchor', async () => {
    const { previewFollowCam, previewSetCam } = await import('../../../src/render/index');
    const r = { s: 12, floorY: 0.3, x: 1.1 };
    for (const aspect of [16 / 9, 9 / 16]) {
      const rig = new CameraRig();
      const settings = { ...DEFAULT_SETTINGS, reducedMotion: true };
      const n = snap({ s: r.s, lane: 1, x: r.x });
      n.player.floorY = r.floorY;
      rig.onReset(n);
      const o = rig.compute(n, n, 1, 1 / 60, aspect, settings);
      const p = previewFollowCam(r, aspect);
      expect(p.pos.distanceTo(o.pos)).toBeLessThan(1e-9);
      expect(p.look.distanceTo(o.look)).toBeLessThan(1e-9);
    }
    expect(previewFollowCam(r, 16 / 9).pos.y - r.floorY).toBeCloseTo(FOLLOW.landscape.h, 9);   // 不再是 0.92
    for (const set of ['labBoard', 'bathroom', 'water', 'canteenWindow']) {
      const c = previewSetCam(set);
      const rig = new CameraRig();
      const n = snap({ s: 0, t: 1, segKind: 'still' });
      n.still = { set: set as never, variant: 'default', t: 0.5, duration: 10, prompt: null, held: 0 };
      const { getSet } = await import('../../../src/core/registry');
      WP5.stillAnchor.makeTranslation(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z).multiply(getSet(set as never)!.playerAnchor('default'));
      const o = rig.compute(n, n, 1, 1 / 60, 16 / 9, { ...DEFAULT_SETTINGS });
      expect(c.pos.distanceTo(o.pos), set).toBeLessThan(1e-9);
      expect(c.look.distanceTo(o.look), set).toBeLessThan(1e-9);
      expect(c.fov, set).toBe(o.fov);
    }
  });
});
