// src/render/actors/index.ts —— 角色包入口（DESIGN.md §5.5–§5.8、§8.7、§8.8、§8.10 WP5）。WP5。
// 注册：RigFactory（刚性蒙皮主角，1 次 draw call）、主角（order 30）、领跑者（32）、反光面（40）、替身（42）、平面影子（44）；
// cue 处理器：double、doubleMod、doubleEnd、shadow、memory、actor（camera 在 render/camera/index.ts）。
// 调试扩展（__game.ext）：poseTest（§8.8 的 7 种姿势）、wp5State、wp5Cam、wp5NoStencil、wp5Leader、wp5Puddle、wp5PixelCheck。
import * as THREE from 'three';
import { registerCueHandler, registerDebug, registerRigFactory, registerViewSystem } from '../../core/registry';
import type { SimSnapshot } from '../../core/types';
import { playerActor } from './Actor';
import { DoubleSystem } from './Doubles';
import { LeaderSystem } from './Leader';
import { PlanarShadowSystem } from './PlanarShadow';
import { ActorRigFactory, triangleCount } from './rigBuild';
import { WP5, wp5Params, type PoseTestName } from './shared';
import { ReflectSurfaces } from './surfaces';

let factory: ActorRigFactory | null = null;
export const surfacesSys = new ReflectSurfaces();
export const doubles = new DoubleSystem(surfacesSys);
export const shadowSys = new PlanarShadowSystem();
export const leaderSys = new LeaderSystem();

WP5.forceNoStencil = wp5Params().noStencil;

registerRigFactory((ctx) => { factory = new ActorRigFactory(ctx); return factory; });
registerViewSystem(playerActor);
registerViewSystem(leaderSys);
registerViewSystem(surfacesSys);
registerViewSystem(doubles);
registerViewSystem(shadowSys);

registerCueHandler('actor', 'WP5', (b, c) => playerActor.playClip(b.clip, b.seconds, c.snap.t));
registerCueHandler('double', 'WP5', (b, c) => doubles.spawn(b.spec, c.snap));
registerCueHandler('doubleMod', 'WP5', (b, c) => doubles.modify(b.target, b.mod, c.snap.t));
registerCueHandler('doubleEnd', 'WP5', (b, c) => doubles.end(b.target, b.fade, c.snap.t));
registerCueHandler('shadow', 'WP5', (b, c) => shadowSys.setMode(b.mode, b.seconds, c.snap.t));
registerCueHandler('memory', 'WP5', (b, c) => doubles.memory(b.surface, b.seconds, c.snap));

// ———————————————————— 调试扩展 ————————————————————
const POSES: readonly PoseTestName[] = ['crawl', 'jump', 'duck', 'twitch', 'stand', 'thirdHand', 'shadowThreeHands'];
registerDebug('poseTest', (name: unknown) => {
  WP5.poseTest = POSES.includes(name as PoseTestName) ? (name as PoseTestName) : null;
  return WP5.poseTest;
});
registerDebug('wp5Cam', (...a: unknown[]) => {
  const [pos, look, fov] = a as [number[] | null, number[] | undefined, number | undefined];
  if (!pos) { WP5.debugCam = null; return null; }
  const r = WP5.playerRoot;
  const rel = (v: number[]) => new THREE.Vector3(r.x + (v[0] ?? 0), r.y + (v[1] ?? 0), r.z + (v[2] ?? 0));
  WP5.debugCam = { pos: rel(pos), look: rel(look ?? [0, 0.3, 0]), fov: fov ?? 50 };
  return true;
});
registerDebug('wp5NoStencil', (on: unknown) => { WP5.forceNoStencil = on === true; return WP5.forceNoStencil; });
registerDebug('wp5Leader', (on: unknown) => { leaderSys.forced = on === true; return leaderSys.forced; });
registerDebug('wp5State', () => ({
  doubles: doubles.active(), shadow: { mode: shadowSys.mode, ...shadowSys.state }, leader: { ...leaderSys.state },
  surfaces: Array.from(surfacesSys.views.values()).filter((v) => v.active).map((v) => v.id),
  focus: WP5.focus ? { kind: WP5.focus.kind, weight: WP5.focus.weight, point: WP5.focus.point.toArray() } : null,
  poseTest: WP5.poseTest, forceNoStencil: WP5.forceNoStencil,
  triangles: factory ? triangleCount(factory.geometry()) : 0, history: factory ? factory.history.size : 0,
  player: WP5.playerRoot.toArray(),
}));

/** 在玩家前方放一个调试水洼，并在里面放一个站着的替身（像素检查用）。 */
registerDebug('wp5Puddle', (...a: unknown[]) => {
  const o = (a[0] ?? {}) as { ahead?: number; lane?: number };
  const snap = lastSnap;
  if (!snap) return null;
  // 当前里程：优先读 __game.getState()（无头测试里 step(n) 之后还没渲染，lastSnap 是旧的）
  const g = (globalThis as { __game?: { getState?: () => { s: number } } }).__game;
  const sNow = g?.getState?.().s ?? snap.player.s;
  const v = surfacesSys.placeDebugPuddle((o.lane ?? 0) * 1.1, sNow + (o.ahead ?? 3.2), snap.player.floorY);
  if (!v) return null;
  doubles.spawn({ id: '__wp5Puddle', surface: v.id, source: 'script', clip: 'standIdle' }, snap);
  return v.id;
});

let lastSnap: SimSnapshot | null = null;
registerViewSystem({ id: 'wp5.snap', owner: 'WP5', order: 29, init() { /* */ }, frame(_p, n) { lastSnap = n; } });

/**
 * 像素检查（在页面里跑，用带模板的渲染目标读回像素）：
 *   'puddle'：替身显示 / 隐藏两次渲染的差异像素，必须全部落在水洼遮罩（膨胀 2 px）之内；
 *   'shadow'：影子显示 / 隐藏两次渲染，逐像素的变暗比例；有模板时重叠处只压暗一次（没有 < 0.5 的像素）。
 * 失败时抛错（console.error → shot.mjs 退出码 2），结果对象同时返回。
 */
registerDebug('wp5PixelCheck', (kind: unknown) => {
  const ctx = viewCtx;
  if (!ctx) throw new Error('wp5PixelCheck: no view');
  const { renderer, scene, camera } = ctx;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.floor(size.x)), h = Math.max(1, Math.floor(size.y));
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: true });
  const read = (): Uint8Array => {
    const buf = new Uint8Array(w * h * 4);
    renderer.setRenderTarget(rt); renderer.clear(true, true, true); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(null);
    return buf;
  };
  const lum = (b: Uint8Array, i: number) => 0.299 * (b[i] as number) + 0.587 * (b[i + 1] as number) + 0.114 * (b[i + 2] as number);
  try {
    if (kind === 'puddle') {
      const box = scene.getObjectByName(doubleBoxName('__wp5Puddle'));
      const v = surfacesSys.debugPuddle;
      if (!box || !v || !v.mask) throw new Error('wp5PixelCheck(puddle): call __game.ext.wp5Puddle() first');
      const A = read();
      const vis = box.visible; box.visible = false;
      const B = read();
      const maskMat = v.mask.material as THREE.Material;
      const red = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false });
      v.mask.material = red; const mv = v.mask.visible; v.mask.visible = true;
      const ov = v.overlay?.visible ?? false, bl = v.blob?.visible ?? false;
      if (v.overlay) v.overlay.visible = false;
      if (v.blob) v.blob.visible = false;
      const M = read();
      v.mask.material = maskMat; v.mask.visible = mv; red.dispose(); box.visible = vis;
      if (v.overlay) v.overlay.visible = ov;
      if (v.blob) v.blob.visible = bl;
      const inMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if ((M[i * 4] as number) > 200 && (M[i * 4 + 1] as number) < 60) inMask[i] = 1;
      // 膨胀 2 px（抗锯齿与光栅化边缘）
      const dil = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let hit = 0;
        for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && inMask[yy * w + xx]) hit = 1;
        }
        dil[y * w + x] = hit;
      }
      let changed = 0, outside = 0, mask = 0;
      for (let i = 0; i < w * h; i++) {
        if (inMask[i]) mask++;
        const d = Math.abs((A[i * 4] as number) - (B[i * 4] as number)) + Math.abs((A[i * 4 + 1] as number) - (B[i * 4 + 1] as number)) + Math.abs((A[i * 4 + 2] as number) - (B[i * 4 + 2] as number));
        if (d > 12) { changed++; if (!dil[i]) outside++; }
      }
      const stencil = ctx.stencil && !WP5.forceNoStencil;
      const res = { kind, stencil, w, h, mask, changed, outside, ok: stencil ? changed > 20 && outside <= Math.max(2, changed * 0.005) : outside <= Math.max(2, changed * 0.005) };
      if (!res.ok) { console.error('[wp5PixelCheck] puddle failed', JSON.stringify(res)); }
      return res;
    }
    if (kind === 'shadow') {
      const A = read();
      const hide = scene.children.filter((o) => o.name === 'rig:shadow' && o.visible);
      for (const o of hide) o.visible = false;
      const B = read();
      for (const o of hide) o.visible = true;
      let changed = 0, twice = 0, sum = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        const lb = lum(B, i), la = lum(A, i);
        if (lb < 40 || la >= lb - 3) continue;
        changed++;
        const r = la / lb;
        sum += r;
        if (r < 0.5) twice++;
      }
      const stencil = ctx.stencil && !WP5.forceNoStencil;
      const res = { kind, stencil, w, h, changed, twice, meanRatio: changed ? sum / changed : 1, ok: changed > 50 && (stencil ? twice <= changed * 0.01 : true) };
      if (!res.ok) console.error('[wp5PixelCheck] shadow failed', JSON.stringify(res));
      return res;
    }
    throw new Error(`wp5PixelCheck: unknown kind ${String(kind)}`);
  } finally { rt.dispose(); }
});

function doubleBoxName(id: string): string {
  const i = doubles.slotIndexOf(id);
  return i >= 0 ? `double${i}` : '';
}

let viewCtx: import('../../core/contracts').ViewContext | null = null;
registerViewSystem({ id: 'wp5.ctx', owner: 'WP5', order: 28, init(ctx) { viewCtx = ctx; }, frame() { /* */ } });
