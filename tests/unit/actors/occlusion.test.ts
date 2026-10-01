// tests/unit/actors/occlusion.test.ts —— 修复轮 U5：横屏追尾机位下，主角不挡住本车道的必需障碍（§2.8 R4、§5.4）。
// 读入全部章节的编译数据，用 FOLLOW.landscape（16:9）把每个 low / bar 障碍的顶边投影到屏幕，与主角爬姿包围盒的投影比较：
// 接触前 1.2 s 内至少 1.0 s，顶边被遮住的部分不超过一半。主角的上半身按 readability.ts 的规则淡出（不透明度 ≤ 0.5 时不算遮挡），
// 下半身和着地的手一直算。玩家放在障碍所在的每一条车道上（最坏情况：正对着它爬过去）。
// 修复轮 U5 第二轮：上半身淡出只在镜头还在他身后时用（CameraRig 写 WP5.chaseCam）。同样的检查也对竖屏追尾机位（9:16）
// 和 5-3 的段内追尾机位（SEGMENT_SHOTS，只查那一段拍区间里的障碍）跑一遍：这两种机位不淡出时分别有 255 / 335 和 18 / 18 个不合格，
// 所以淡出在它们下面也保留。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../../src/core/quality';
import { BONE_INDEX } from '../../../src/core/rig';
import { compile } from '../../../src/levels/compile';
import { CHAPTER_ORDER, getChapter } from '../../../src/levels/chapters';
import type { CompiledChapter } from '../../../src/levels/schema';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { OPAQUE_BONE_INDICES, stepUpperFade, UPPER_FADE, upperAlpha, upperFadeWanted } from '../../../src/render/actors/readability';
import { buildRigGeometry, Rig, rigDetail } from '../../../src/render/actors/rigBuild';
import { vFromH } from '../../../src/render/camera/CameraRig';
import { FOLLOW, SEGMENT_SHOTS } from '../../../src/render/camera/shots';
import { crawlInput } from './helpers';

const ASPECT = 16 / 9;
const geo = buildRigGeometry(rigDetail(QUALITY.low));
const rig = new Rig(geo, new THREE.MeshBasicMaterial(), 'player');
const pos = geo.getAttribute('position') as THREE.BufferAttribute;
const skin = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
const HIDDEN = new Set(['arm3Upper', 'arm3Fore', 'arm3Hand', 'propHead', 'propBack'].map((n) => BONE_INDEX[n as 'propHead']));
const OPAQUE = new Set(OPAQUE_BONE_INDICES);
type Box = [number, number, number, number];

type CamKind = 'landscape' | 'portrait' | '5-3';
function chaseCam(x: number, kind: CamKind = 'landscape'): THREE.PerspectiveCamera {
  const L = FOLLOW.landscape;
  if (kind === 'portrait') {
    const P = FOLLOW.portrait, a = 9 / 16;
    const cam = new THREE.PerspectiveCamera(Math.min(P.vMax, vFromH(L.hfov, a)), a, 0.05, 200);
    cam.position.set(P.k * x, P.h, P.back); cam.lookAt(P.lookK * x, P.ly, P.lz); cam.updateMatrixWorld(true);
    return cam;
  }
  if (kind === '5-3') {
    const S = SEGMENT_SHOTS['5-3']!;
    const cam = new THREE.PerspectiveCamera(S.fov, ASPECT, 0.05, 200);
    cam.position.set(L.k * x + S.dx, S.h, S.back); cam.lookAt(L.lookK * x + S.lx, S.ly, S.lz); cam.updateMatrixWorld(true);
    return cam;
  }
  const cam = new THREE.PerspectiveCamera(Math.min(L.vMax, Math.max(L.vMin, vFromH(L.hfov, ASPECT))), ASPECT, 0.05, 200);
  cam.position.set(L.k * x, L.h, L.back);
  cam.lookAt(L.lookK * x, L.ly, L.lz);
  cam.updateMatrixWorld(true);
  return cam;
}

/** 主角（根在 s = 0、车道 lane）各步态相位的屏幕包围盒（NDC）：全身 / 只算不淡的部分。 */
function playerBoxes(lane: number, cam: THREE.PerspectiveCamera): { full: Box; opaque: Box } {
  const b = new PoseBuilder();
  const full: Box = [9, 9, -9, -9], opaque: Box = [9, 9, -9, -9];
  const v = new THREE.Vector3();
  for (const beat of [6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75]) {
    rig.apply(crawlPose(crawlInput({ s: 0, x: lane * 1.1, laneTarget: lane, beat }), b));
    rig.root.updateMatrixWorld(true);
    for (let i = 0; i < pos.count; i++) {
      const bi = skin.getX(i);
      if (HIDDEN.has(bi)) continue;
      v.fromBufferAttribute(pos, i);
      rig.mesh.applyBoneTransform(i, v);
      v.applyMatrix4(rig.mesh.matrixWorld).project(cam);
      for (const box of OPAQUE.has(bi) ? [full, opaque] : [full]) {
        box[0] = Math.min(box[0], v.x); box[1] = Math.min(box[1], v.y); box[2] = Math.max(box[2], v.x); box[3] = Math.max(box[3], v.y);
      }
    }
  }
  return { full, opaque };
}

const LANES = [-1, 0, 1] as const;
const camSets = new Map<CamKind, { cams: Map<number, THREE.PerspectiveCamera>; boxes: Map<number, { full: Box; opaque: Box }> }>();
function camSet(kind: CamKind) {
  let c = camSets.get(kind);
  if (!c) {
    const cams = new Map(LANES.map((l) => [l as number, chaseCam(l * 1.1, kind)]));
    c = { cams, boxes: new Map(LANES.map((l) => [l as number, playerBoxes(l, cams.get(l)!)])) };
    camSets.set(kind, c);
  }
  return c;
}
const chapters: CompiledChapter[] = CHAPTER_ORDER.map((id) => getChapter(id)).filter((d) => d !== null).map((d) => compile(d!));

describe('the chase camera does not hide required obstacles in your lane (U5, R4)', () => {
  it('FOLLOW.landscape is raised and pulled back, looking lower than §5.4 (portrait unchanged)', () => {
    expect(FOLLOW.landscape.h).toBeGreaterThan(1.05);
    expect(FOLLOW.landscape.back).toBeGreaterThan(2.6);
    expect(FOLLOW.landscape.ly).toBeLessThan(0.3);
    expect(FOLLOW.portrait).toMatchObject({ k: 0.6, h: 1.3, back: 3.8, ly: 0.3, lz: -6 });
  });

  it('the upper body fades to 40 % when a low / bar obstacle is in your lane within max(8 m, 1.5 s), not for other lanes', () => {
    const seg = chapters[0]!.segments.find((s) => s.def.id === '1-1')!;
    const feet = seg.obstacles.filter((o) => o.kind === 'footOut');
    const foot = feet[0]!, last = feet.at(-1)!;                                              // 第一只、最后一只伸进过道的脚
    expect(upperFadeWanted(seg.obstacles, foot.s0 - 6, 0, 0, 4.4)).toBe(true);
    expect(upperFadeWanted(seg.obstacles, foot.s0 - 9, 0, 0, 4.4)).toBe(false);
    expect(upperFadeWanted(seg.obstacles, foot.s0 - 6, 1, 1, 4.4)).toBe(false);
    expect(upperFadeWanted(seg.obstacles, foot.s0 - 6, 1, 0, 4.4)).toBe(true);           // 正在换进它的车道
    expect(upperFadeWanted(seg.obstacles, last.s1, 0, 0, 4.4)).toBe(false);               // 越过之后不再淡
    let w = 0;
    for (let i = 0; i < 12; i++) w = stepUpperFade(w, true, 1 / 120);                    // 0.1 s：还在淡出途中
    expect(upperAlpha(w)).toBeGreaterThan(0.5);
    for (let i = 0; i < 60; i++) w = stepUpperFade(w, true, 1 / 120);
    expect(upperAlpha(w)).toBeCloseTo(UPPER_FADE.alpha, 6);
  });

  /** 不合格的障碍（kind 机位下；fade = false 时上半身不淡出）。5-3 的段内机位只查它那一段拍区间。 */
  function badObstacles(kind: CamKind, fade = true): { checked: number; bad: string[] } {
    let checked = 0;
    const bad: string[] = [];
    const v = new THREE.Vector3();
    const { cams, boxes } = camSet(kind);
    const ss = SEGMENT_SHOTS['5-3']!;
    for (const ch of chapters) {
      for (const seg of ch.segments) {
        if (seg.kind !== 'run') continue;
        if (kind === '5-3' && seg.def.id !== '5-3') continue;
        for (const o of seg.obstacles) {
          if (o.cls !== 'low' && o.cls !== 'bar') continue;
          if (kind === '5-3' && !(o.beat >= ss.from && o.beat < ss.to)) continue;
          for (const lane of o.lanes) {
            checked++;
            const cam = cams.get(lane)!, bx = boxes.get(lane)!;
            const speed = seg.cadenceAt(o.beat) * seg.stride;
            // 主角碰撞盒前沿碰到障碍近沿的时刻 = 0；从 −3 s 开始按模拟时钟推进淡出
            const dt = 1 / 120;
            let w = 0, okT = 0;
            for (let t = -3; t < 0; t += dt) {
              const sRoot = o.s0 - UPPER_FADE.front + t * speed;
              w = stepUpperFade(w, fade && upperFadeWanted(seg.obstacles, sRoot, lane, lane, speed), dt);
              if (t < -1.2) continue;
              const box = upperAlpha(w) <= 0.5 ? bx.opaque : bx.full;
              const ahead = o.s0 - sRoot;              // 障碍近沿在主角根前方多少米（相机放在 s = 0 的主角身后）
              const n = 21;
              let vis = 0;
              for (let k = 0; k < n; k++) {
                v.set(lane * 1.1 - o.halfW + (2 * o.halfW * k) / (n - 1), o.y1, -ahead).project(cam);
                const onScreen = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1;
                const hidden = v.x > box[0] && v.x < box[2] && v.y > box[1] && v.y < box[3];
                if (onScreen && !hidden) vis++;
              }
              if (vis * 2 >= n) okT += dt;
            }
            if (okT < 1.0 - 1e-9) bad.push(`${seg.def.id}@${o.beat} ${o.kind} lane ${lane}: ${okT.toFixed(2)} s`);
          }
        }
      }
    }
    return { checked, bad };
  }

  it('every low / bar obstacle of every chapter: its top edge is at most half hidden for ≥ 1.0 s of the last 1.2 s', () => {
    const r = badObstacles('landscape');
    expect(r.checked).toBeGreaterThan(200);
    expect(r.bad).toEqual([]);
  });

  it('the same holds under the portrait chase camera and the 5-3 segment chase camera, where the fade is kept (and is needed)', () => {
    for (const kind of ['portrait', '5-3'] as const) {
      const r = badObstacles(kind);
      expect(r.checked).toBeGreaterThan(kind === '5-3' ? 10 : 200);
      expect(r.bad).toEqual([]);
      expect(badObstacles(kind, false).bad.length).toBeGreaterThan(r.checked / 2);  // 不淡出时一半以上不合格：淡出在这两种机位下有用
    }
  });
});
