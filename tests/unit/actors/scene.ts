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
  for (let i = 0; i < pos.count; i++) {
    const bi = skin.getX(i);
    if (bi >= 24) continue;                          // 第三只手、道具（缩放为 0 时）不算
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
