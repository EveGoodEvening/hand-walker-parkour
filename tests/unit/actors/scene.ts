// tests/unit/actors/scene.ts —— 修复轮 U5 的 Node 场景台：主角（PlayerActor）、反光面、替身、影子、镜头一起按段的数据跑，
// 用镜头投影读替身头部的 NDC、主角的屏幕包围盒。静场和停拍的构图在这里先算准，再上浏览器截图确认。
import * as THREE from 'three';
import type { ViewContext } from '../../../src/core/contracts';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import type { SimSnapshot } from '../../../src/core/types';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, CompiledChapter, CompiledSegment } from '../../../src/levels/schema';
import { PlayerActor } from '../../../src/render/actors/Actor';
import { DoubleSystem } from '../../../src/render/actors/Doubles';
import { PlanarShadowSystem } from '../../../src/render/actors/PlanarShadow';
import { ActorRigFactory } from '../../../src/render/actors/rigBuild';
import { WP5 } from '../../../src/render/actors/shared';
import { ReflectSurfaces } from '../../../src/render/actors/surfaces';
import { CameraRig } from '../../../src/render/camera/CameraRig';
import '../../../src/render/sets/outside/bathroom';
import '../../../src/render/sets/outside/bus';
import '../../../src/render/sets/outside/water';
import '../../../src/render/sets/outside/infirmary';
import '../../../src/render/sets/school/canteenWindow';
import '../../../src/render/sets/school/labBoard';
import { fakeCtx, snap } from './helpers';

export const ASPECT = 16 / 9;

export interface Scene {
  ctx: ViewContext; f: ActorRigFactory; actor: PlayerActor; surf: ReflectSurfaces; dbl: DoubleSystem; shadow: PlanarShadowSystem; cam: CameraRig;
  ch: CompiledChapter; camera: THREE.PerspectiveCamera;
}

export async function scene(def: ChapterDef, tier: 'low' | 'medium' = 'low'): Promise<Scene> {
  const ctx = fakeCtx(tier);
  const f = new ActorRigFactory(ctx);
  (ctx as { rig: unknown }).rig = f;
  const actor = new PlayerActor(); actor.init(ctx);
  const surf = new ReflectSurfaces(); surf.init(ctx);
  const dbl = new DoubleSystem(surf); dbl.init(ctx);
  const shadow = new PlanarShadowSystem(); shadow.init(ctx);
  const cam = new CameraRig(); cam.init(ctx);
  const ch = compile(def);
  await actor.loadChapter(ch); await surf.loadChapter(ch); await dbl.loadChapter(ch);
  WP5.poseTest = null; WP5.debugCam = null; WP5.focus = null;
  return { ctx, f, actor, surf, dbl, shadow, cam, ch, camera: new THREE.PerspectiveCamera(55, ASPECT, 0.05, 300) };
}

/** 静场在 t 秒时的快照。 */
export function stillSnap(seg: CompiledSegment, t: number): SimSnapshot {
  const n = snap({ s: seg.s0, t: 100 + t, segKind: 'still' });
  n.segIndex = seg.index; n.segment = seg.def.id;
  n.player.floorY = seg.floorY(seg.s0);                // 静场的地面高度 = 前面各段累计的（楼梯之后不是 0）
  const d = seg.def as { set: string; variant?: string; duration?: number };
  n.still = { set: d.set as never, variant: d.variant ?? 'default', t, duration: d.duration ?? 10, prompt: null, held: 0 };
  return n;
}

type Ev = { at: number; type: string; [k: string]: unknown };

/** 把一条 cue 交给 WP5 的处理器（与 render/actors/index.ts、camera/index.ts 的注册一致）。 */
export function fire(w: Scene, e: Ev, s: SimSnapshot): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = e as any;
  switch (e.type) {
    case 'double': w.dbl.spawn(b.spec, s); break;
    case 'doubleMod': w.dbl.modify(b.target, b.mod, s.t); break;
    case 'doubleEnd': w.dbl.end(b.target, b.fade, s.t); break;
    case 'camera': w.cam.setShot(b.shot, b.seconds, s.t); break;
    case 'actor': w.actor.playClip(b.clip, b.seconds, s.t); break;
    case 'shadow': w.shadow.setMode(b.mode, b.seconds, s.t); break;
    default: break;
  }
}

/** 一帧：主角 → 反光面 → 替身 → 影子 → 镜头（与 ViewSystem 的 order 一致），然后把镜头参数写进 w.camera。 */
export function frame(w: Scene, prev: SimSnapshot, next: SimSnapshot, dt = 1 / 60): void {
  w.actor.frame(prev, next, 1, dt);
  w.surf.frame(prev, next, 1, dt);
  w.dbl.frame(prev, next, 1, dt);
  w.shadow.frame(prev, next, 1, dt);
  const o = w.cam.compute(prev, next, 1, dt, ASPECT, { ...DEFAULT_SETTINGS });
  const c = w.camera;
  c.aspect = ASPECT; c.fov = o.fov; c.position.copy(o.pos); c.up.set(0, 1, 0); c.lookAt(o.look);
  if (o.roll) c.rotateZ(o.roll);
  c.updateProjectionMatrix(); c.updateMatrixWorld(true);
}

/** 按静场数据从 0 跑到 tEnd（60 fps），途中按时刻发出 WP5 的 cue。返回最后一份快照。 */
export function playStill(w: Scene, segId: string, tEnd: number): SimSnapshot {
  const seg = w.ch.segments.find((s) => s.def.id === segId)!;
  const evs = [...((seg.def as { events?: Ev[] }).events ?? [])].sort((a, b) => a.at - b.at);
  let prev = stillSnap(seg, 0);
  w.cam.onEvent({ type: 'segment', tick: 0, data: {} } as never);
  w.actor.onEvent({ type: 'segment', tick: 0, data: {} } as never);
  w.dbl.onSegment(seg);
  let k = 0;
  for (let t = 0; t <= tEnd + 1e-9; t += 1 / 60) {
    const n = stillSnap(seg, t);
    while (k < evs.length && (evs[k]!.at as number) <= t + 1e-9) fire(w, evs[k++]!, n);
    frame(w, prev, n);
    prev = n;
  }
  return prev;
}

/** 世界点的 NDC。 */
export function ndc(w: Scene, p: THREE.Vector3 | readonly number[]): THREE.Vector3 {
  const v = p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
  return v.project(w.camera);
}

function skinnedOf(root: THREE.Object3D, each: (v: THREE.Vector3, bone: number) => void): void {
  root.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) return;
  const m = mesh as THREE.SkinnedMesh;
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
  const skin = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const third = (m.skeleton.bones[24]?.scale.x ?? 0) > 0.01;
  for (let i = 0; i < pos.count; i++) {
    const bi = skin.getX(i);
    if (bi >= 27 || (bi >= 24 && !third)) continue;  // 道具、缩放为 0 的第三只手不算
    v.fromBufferAttribute(pos, i);
    m.applyBoneTransform(i, v);
    v.applyMatrix4(m.matrixWorld);
    each(v, bi);
  }
}

/** 主角在屏幕上的包围盒 [x0, y0, x1, y1]（NDC）；只算镜头前方的顶点。 */
export function playerBox(w: Scene): [number, number, number, number] {
  const b: [number, number, number, number] = [9, 9, -9, -9];
  if (!w.actor.rig.root.visible) return [0, 0, 0, 0];
  skinnedOf(w.actor.rig.root, (v) => {
    const q = v.project(w.camera);
    if (q.z > 1) return;
    b[0] = Math.min(b[0], q.x); b[1] = Math.min(b[1], q.y); b[2] = Math.max(b[2], q.x); b[3] = Math.max(b[3], q.y);
  });
  return b;
}

/** 替身（按 id）的世界顶点。 */
export function doubleVerts(w: Scene, id: string, each: (v: THREE.Vector3, bone: number) => void): boolean {
  const i = w.dbl.slotIndexOf(id);
  if (i < 0) return false;
  const box = w.ctx.scene.getObjectByName(`double${i}`);
  if (!box) return false;
  skinnedOf(box, each);
  return true;
}

/** 替身头部 NDC。 */
export function headNdc(w: Scene, id: string): THREE.Vector3 | null {
  const d = w.dbl.active().find((q) => q.id === id);
  return d ? ndc(w, d.head) : null;
}

export function inBox(p: THREE.Vector3, b: readonly number[]): boolean {
  return p.x > (b[0] as number) && p.x < (b[2] as number) && p.y > (b[1] as number) && p.y < (b[3] as number);
}

/** 主角网格的软件光栅化深度图（W×H，NDC z；没有覆盖的像素为 +∞）。只用来判断替身的某些顶点是否被主角挡住。 */
export function playerDepth(w: Scene, W = 320, H = 180): Float32Array {
  const depth = new Float32Array(W * H).fill(Infinity);
  if (!w.actor.rig.root.visible) return depth;
  const tris: THREE.Vector3[] = [];
  skinnedOf(w.actor.rig.root, (v) => { tris.push(v.clone().project(w.camera)); });
  // skinnedOf 跳过了道具等顶点，三角形按顺序三个一组：只在三个顶点都保留时才成立（被跳过的骨骼整块跳过，顺序不乱）
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = tris[i]!, b = tris[i + 1]!, c = tris[i + 2]!;
    if (a.z > 1 || b.z > 1 || c.z > 1 || a.z < -1 || b.z < -1 || c.z < -1) continue;
    const P = [a, b, c].map((p) => [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H, p.z] as [number, number, number]);
    const [p0, p1, p2] = P as [[number, number, number], [number, number, number], [number, number, number]];
    const x0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
      const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
      const k = y * W + x;
      if (z < (depth[k] as number)) depth[k] = z;
    }
  }
  return depth;
}

/** 替身（id）在某些骨骼上的顶点里，有多少比例在画面内且没有被主角挡住。 */
export function visibleFraction(w: Scene, id: string, bones: readonly number[], W = 320, H = 180): { visible: number; total: number } {
  const depth = playerDepth(w, W, H);
  const set = new Set(bones);
  let total = 0, visible = 0;
  doubleVerts(w, id, (v, bi) => {
    if (!set.has(bi)) return;
    total++;
    const p = v.clone().project(w.camera);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return;
    const x = Math.min(W - 1, Math.floor((p.x * 0.5 + 0.5) * W)), y = Math.min(H - 1, Math.floor((1 - (p.y * 0.5 + 0.5)) * H));
    if (p.z <= (depth[y * W + x] as number) + 1e-4) visible++;
  });
  return { visible: total ? visible / total : 0, total };
}

/**
 * 跑段停拍：从 stopBeat 前 3 s 爬到 stopBeat（写历史、按拍发出段的事件），然后停下 tAfter 秒，按停拍的 timeline 发出 cue。
 * 返回最后一份快照。主角按 lane 爬（停拍前不换道）。
 */
export function playStop(w: Scene, segId: string, stopBeat: number, tAfter: number, lane: -1 | 0 | 1 = 0): SimSnapshot {
  const seg = w.ch.segments.find((s) => s.def.id === segId)!;
  const def = seg.def as { events?: Ev[]; stride?: number; cadence?: number | number[] };
  const evs = [...(def.events ?? [])].sort((a, b) => a.at - b.at);
  const stop = evs.find((e) => e.type === 'stop' && Math.abs(e.at - stopBeat) < 1e-6) as (Ev & { timeline: Ev[] }) | undefined;
  const tl = [...(stop?.timeline ?? [])].sort((a, b) => a.at - b.at);
  const cad = seg.cadenceAt(stopBeat), stride = seg.stride, speed = cad * stride;
  const b0 = Math.max(0, stopBeat - 3 * cad);
  const at = (beat: number, t: number, mode: 'crawl' | 'stop', modeT: number) => {
    const s = seg.s0 + beat * stride;
    const n = snap({ s, lane, beat: beat, t, mode, speed: mode === 'stop' ? 0 : speed });
    n.segIndex = seg.index; n.segment = seg.def.id; n.segBeat = beat;
    n.player.floorY = seg.floorY(s); n.player.cadence = cad; n.player.stride = stride; n.player.modeT = modeT;
    return n;
  };
  w.cam.onEvent({ type: 'segment', tick: 0, data: {} } as never);
  w.dbl.onSegment(seg); w.actor.onSegment(seg);
  const tStart = 50;
  let prev = at(b0, tStart, 'crawl', 0);
  w.cam.onReset(prev);
  let k = 0;
  const dt = 1 / 60;
  let t = tStart;
  // 停拍前：爬到 stopBeat
  for (let beat = b0; beat < stopBeat - 1e-9;) {
    beat = Math.min(stopBeat, beat + cad * dt); t += dt;
    const n = at(beat, t, 'crawl', 0);
    while (k < evs.length && evs[k]!.at <= beat + 1e-9) { const e = evs[k++]!; if (e.type !== 'stop') fire(w, e, n); }
    frame(w, prev, n); prev = n;
  }
  // 停拍
  const t0 = t;
  let j = 0;
  for (let u = 0; u <= tAfter + 1e-9; u += dt) {
    t = t0 + u;
    const n = at(stopBeat, t, 'stop', u);
    while (j < tl.length && tl[j]!.at <= u + 1e-9) fire(w, tl[j++]!, n);
    frame(w, prev, n); prev = n;
  }
  return prev;
}

/** 跑段：从 b0 拍爬到 b1 拍（车道 lane），按拍发出段的事件。返回最后一份快照。 */
export function playRun(w: Scene, segId: string, b0: number, b1: number, lane: -1 | 0 | 1 = 0): SimSnapshot {
  const seg = w.ch.segments.find((s) => s.def.id === segId)!;
  const evs = [...((seg.def as { events?: Ev[] }).events ?? [])].sort((a, b) => a.at - b.at);
  const cad = seg.cadenceAt(b0), stride = seg.stride, speed = cad * stride;
  const at = (beat: number, t: number) => {
    const s = seg.s0 + beat * stride;
    const n = snap({ s, lane, beat, t, speed });
    n.segIndex = seg.index; n.segment = seg.def.id; n.segBeat = beat;
    n.player.floorY = seg.floorY(s); n.player.cadence = cad; n.player.stride = stride;
    return n;
  };
  w.cam.onEvent({ type: 'segment', tick: 0, data: {} } as never);
  w.dbl.onSegment(seg); w.actor.onSegment(seg);
  let t = 30;
  let prev = at(b0, t);
  w.cam.onReset(prev);
  let k = 0;
  while (k < evs.length && evs[k]!.at < b0) { const e = evs[k++]!; if (e.type === 'double') fire(w, e, prev); }
  const dt = 1 / 60;
  for (let beat = b0; beat < b1 - 1e-9;) {
    beat = Math.min(b1, beat + cad * dt); t += dt;
    const n = at(beat, t);
    while (k < evs.length && evs[k]!.at <= beat + 1e-9) fire(w, evs[k++]!, n);
    frame(w, prev, n); prev = n;
  }
  return prev;
}
