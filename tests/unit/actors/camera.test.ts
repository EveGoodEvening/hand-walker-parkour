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
import { FOLLOW, SEGMENT_SHOTS, SET_SHOTS } from '../../../src/render/camera/shots';
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

// 修复轮 B3：静场里的 turnBack cue 以前被忽略（静场只认 SET_SHOTS）。2-9 5.2 s（0.8 s）：顺着影子那只手指的方向向右转过去，
// 看教室后半边；3-10 5.4 s（1.0 s）：转过去看身后的门和毛巾（「回头：什么也没有」）。转回来之后是原来的静场机位。
describe('still turnBack (B3): the camera turns to look behind the protagonist, then back', () => {
  const anchorDir = (w: Scene): THREE.Vector3 => {
    // 镜头朝向换到锚点空间（主角朝 −z；身后是 +z、右边是 +x）
    const inv = new THREE.Matrix3().setFromMatrix4(WP5.stillAnchor).invert();
    return w.camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(inv).normalize();
  };
  const camAt = async (def: ChapterDef, seg: string, t: number) => { const w = await scene(def); playStill(w, seg, t); return w; };

  it('2-9: looks at the board at 4.9 s, turns right towards where the shadow hand points, looks behind at 5.6 s, is back on the board at 6.1 s', async () => {
    const before = anchorDir(await camAt(ch2 as ChapterDef, '2-9', 4.9));
    expect(before.z).toBeLessThan(-0.9);                                    // labBoard：越过左肩看前方的黑板
    const mid = anchorDir(await camAt(ch2 as ChapterDef, '2-9', 5.36));
    expect(mid.x).toBeGreaterThan(0.5);                                     // 向右转（影子的手指向右后方）
    const w = await camAt(ch2 as ChapterDef, '2-9', 5.6);
    const back = anchorDir(w);
    expect(back.z).toBeGreaterThan(0.8);                                    // 看身后
    // 主角在镜头身后：画面里没有他
    expect(playerVertsInFrame(w)).toBe(0);
    const after = await camAt(ch2 as ChapterDef, '2-9', 6.1);
    const sh = SET_SHOTS.labBoard!;
    expect(after.camera.position.distanceTo(new THREE.Vector3(...sh.pos).applyMatrix4(WP5.stillAnchor))).toBeLessThan(1e-6);
    expect(anchorDir(after).z).toBeLessThan(-0.9);
  });

  it('3-10: at 5.9 s the camera faces the door and the dripping towel behind him (both in frame, nobody there); at 6.5 s it is back on the mirror', async () => {
    const w = await camAt(ch3 as ChapterDef, '3-10', 5.9);
    expect(anchorDir(w).z).toBeGreaterThan(0.7);
    const O = new THREE.Vector3(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
    for (const p of [[0.2, 1.0, 1.87], [0.2, 1.9, 1.87], [-0.72, 1.55, 1.85]] as const) {        // 门的中间、门的上沿、毛巾
      const q = new THREE.Vector3(...p).add(O).project(w.camera);
      expect(Math.abs(q.x), `${p}`).toBeLessThan(0.9); expect(Math.abs(q.y), `${p}`).toBeLessThan(0.9); expect(q.z).toBeLessThan(1);
    }
    expect(w.dbl.active().filter((d) => d.visible).map((d) => d.id)).toEqual([]);              // 镜子里没有人（3.8 s doubleEnd），身后也没有
    expect(playerVertsInFrame(w)).toBe(0);
    const after = await camAt(ch3 as ChapterDef, '3-10', 6.5);
    expect(anchorDir(after).z).toBeLessThan(-0.6);                                            // 又看着镜子
  });

  it('the turning camera never passes through his head (≥ 0.25 m) and the look direction turns smoothly (≤ 12° a frame)', async () => {
    for (const [def, seg, t0, t1] of [[ch2, '2-9', 5.15, 6.05], [ch3, '3-10', 5.35, 6.45]] as const) {
      const w = await scene(def as ChapterDef);
      playStill(w, seg, t0 - 1 / 60);
      const s = w.ch.segments.find((x) => x.def.id === seg)!;
      let prevDir: THREE.Vector3 | null = null;
      let prev = stillSnap(s, t0 - 1 / 60);
      for (let t = t0; t <= t1; t += 1 / 60) {
        const n = stillSnap(s, t);
        frame(w, prev, n); prev = n;
        expect(w.camera.position.distanceTo(WP5.playerHead), `${seg} ${t.toFixed(2)}`).toBeGreaterThan(0.25);
        const d = w.camera.getWorldDirection(new THREE.Vector3());
        if (prevDir) expect(d.angleTo(prevDir) * 180 / Math.PI, `${seg} ${t.toFixed(2)}`).toBeLessThan(12);
        prevDir = d;
      }
    }
  });

  it('reducedMotion: the turn is a cut; a still without its own turn-back shot pans 160° left in place', async () => {
    const rig = new CameraRig();
    const rm = { ...DEFAULT_SETTINGS, reducedMotion: true };
    const st = (t: number, set = 'labBoard'): SimSnapshot => {
      const n = snap({ s: 0, t: 50 + t, segKind: 'still' });
      n.still = { set: set as never, variant: 'default', t, duration: 10, prompt: null, held: 0 };
      return n;
    };
    WP5.stillAnchor.identity();
    rig.setShot('labBoard', 0, 50);
    const a = rig.compute(st(0), st(0.1), 1, 1 / 60, 16 / 9, rm).look.clone().sub(rig.out.pos).normalize();
    rig.setShot('turnBack', 0.8, 50.2);
    const b = rig.compute(st(0.1), st(0.22), 1, 1 / 60, 16 / 9, rm).look.clone().sub(rig.out.pos).normalize();
    expect(a.z).toBeLessThan(-0.9); expect(b.z).toBeGreaterThan(0.8);           // 第一帧就转过去了
    const c = rig.compute(st(0.22), st(1.1), 1, 1 / 60, 16 / 9, rm).look.clone().sub(rig.out.pos).normalize();
    expect(c.z).toBeLessThan(-0.9);                                             // 到时直接切回来
    // 没有专门的回头机位（deskFeet）：位置不动，原地向左转 160°
    const r2 = new CameraRig();
    r2.setShot('deskFeet', 0, 50);
    const p0 = r2.compute(st(0, 'deskFeet'), st(0.1, 'deskFeet'), 1, 1 / 60, 16 / 9, rm).pos.clone();
    const d0 = r2.out.look.clone().sub(p0).setY(0).normalize();
    r2.setShot('turnBack', 1, 50.2);
    const p1 = r2.compute(st(0.1, 'deskFeet'), st(0.3, 'deskFeet'), 1, 1 / 60, 16 / 9, rm).pos.clone();
    const d1 = r2.out.look.clone().sub(p1).setY(0).normalize();
    expect(p1.distanceTo(p0)).toBeLessThan(1e-9);
    expect(Math.atan2(d0.x * d1.z - d0.z * d1.x, d0.x * d1.x + d0.z * d1.z) * 180 / Math.PI).toBeCloseTo(-160, 3);   // 从上往下看逆时针 = 向左
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
