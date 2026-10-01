// src/render/actors/index.ts —— 角色包入口（DESIGN.md §5.5–§5.8、§8.7、§8.8、§8.10 WP5）。WP5。
// 注册：RigFactory（刚性蒙皮主角，1 次 draw call）、主角（order 30）、领跑者（32）、反光面（40）、替身（42）、平面影子（44）；
// cue 处理器：double、doubleMod、doubleEnd、shadow、memory、actor（camera 在 render/camera/index.ts）。
// 调试扩展（__game.ext）：poseTest（§8.8 的 7 种姿势）、wp5State、wp5Cam、wp5NoStencil、wp5Leader、wp5Puddle、wp5PixelCheck、wp5Scene。
import * as THREE from 'three';
import { registerCueHandler, registerDebug, registerRigFactory, registerViewSystem } from '../../core/registry';
import type { SimSnapshot } from '../../core/types';
import { playerActor } from './Actor';
import { DoubleSystem, eyeCenter, scaleEyeVertex } from './Doubles';
import { LeaderSystem } from './Leader';
import { PlanarShadowSystem } from './PlanarShadow';
import { ActorRigFactory, RIG_COLORS, triangleCount } from './rigBuild';
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
  player: WP5.playerRoot.toArray(), upperAlpha: playerActor.upperAlpha,
  playerHead: WP5.playerHead.toArray(), palmGlass: WP5.palmGlass, chaseCam: WP5.chaseCam, standMirror: doubles.mirrorState(),
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
 *   'eyes'（第二个参数是替身 id，修复轮 U5 第三轮）：直接读回画面（色调映射、sRGB 之后）里这个替身两只眼睛的像素与旁边脸上的像素，
 *     眼睛的 HSL 亮度要比脸高 ≥ 0.15，每只眼睛在 CSS 像素里 ≥ 4 px（4-6「眼睛很亮」）。
 * 失败时抛错（console.error → shot.mjs 退出码 2），结果对象同时返回。
 */
registerDebug('wp5PixelCheck', (kind: unknown, arg?: unknown) => {
  const ctx = viewCtx;
  if (!ctx) throw new Error('wp5PixelCheck: no view');
  const { renderer, scene, camera } = ctx;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.floor(size.x)), h = Math.max(1, Math.floor(size.y));
  if (kind === 'eyes') return eyeCheck(ctx, String(arg ?? ''), w, h);
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
      // 有模板时：替身至少占遮罩的 8%（至少 60 像素），而且一个像素都不能漏到遮罩外（容差 0.5%）
      const res = { kind, stencil, w, h, mask, changed, outside, ok: stencil ? changed > Math.max(60, mask * 0.08) && outside <= Math.max(2, changed * 0.005) : outside <= Math.max(2, changed * 0.005) };
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

/** wp5PixelCheck('eyes', id)：见上。 */
function eyeCheck(ctx: import('../../core/contracts').ViewContext, id: string, w: number, h: number): Record<string, unknown> {
  const { renderer, scene, camera } = ctx;
  const box = scene.getObjectByName(doubleBoxName(id));
  const eyes = doubles.eyesOf(id);
  if (!box || !box.visible || !eyes) throw new Error(`wp5PixelCheck(eyes): no visible double ${id}`);
  let mesh: THREE.SkinnedMesh | null = null;
  box.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('wp5PixelCheck(eyes): no mesh');
  const m = mesh as THREE.SkinnedMesh;
  // 画到画布上，同一个任务里马上读回（浏览器合成之前，默认帧缓冲还在）：这就是屏幕上的颜色
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const hsl = (x: number, y: number): number => {
    const xi = Math.min(w - 1, Math.max(0, Math.floor(x))), yi = Math.min(h - 1, Math.max(0, Math.floor(y)));
    const i = (yi * w + xi) * 4;
    const r = (buf[i] as number) / 255, g = (buf[i + 1] as number) / 255, b = (buf[i + 2] as number) / 255;
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  };
  box.updateMatrixWorld(true);
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
  const ec = new THREE.Color().setHex(RIG_COLORS.eye);
  const bb: Record<'L' | 'R', number[]> = { L: [1e9, 1e9, -1e9, -1e9], R: [1e9, 1e9, -1e9, -1e9] };
  const px = (p: THREE.Vector3): [number, number] => { const q = p.project(camera); return [(q.x + 1) / 2 * w, (q.y + 1) / 2 * h]; };
  let ref = -1;
  for (let v = 0; v < pos.count; v++) {
    if (Math.abs(col.getX(v) - ec.r) > 0.004 || Math.abs(col.getY(v) - ec.g) > 0.004 || Math.abs(col.getZ(v) - ec.b) > 0.004) continue;
    ref = v;
    const p = new THREE.Vector3().fromBufferAttribute(pos, v);
    const b = bb[p.x < 0 ? 'L' : 'R'];
    scaleEyeVertex(p, eyes.scale);
    m.applyBoneTransform(v, p); p.applyMatrix4(m.matrixWorld);
    const [x, y] = px(p);
    b[0] = Math.min(b[0] as number, x); b[1] = Math.min(b[1] as number, y); b[2] = Math.max(b[2] as number, x); b[3] = Math.max(b[3] as number, y);
  }
  if (ref < 0) throw new Error('wp5PixelCheck(eyes): no eye vertices');
  const css = (renderer.domElement.clientWidth || w) / w;
  const eye: Record<string, { px: number; l: number }> = {};
  for (const [k, b] of Object.entries(bb)) {
    // 眼睛方块里面（四边各收 20 %）的像素平均亮度
    const x0 = b[0] as number, y0 = b[1] as number, x1 = b[2] as number, y1 = b[3] as number;
    const ix = (x1 - x0) * 0.2, iy = (y1 - y0) * 0.2;
    let sum = 0, n = 0;
    for (let y = Math.ceil(y0 + iy - 0.5); y + 0.5 <= y1 - iy; y++) for (let x = Math.ceil(x0 + ix - 0.5); x + 0.5 <= x1 - ix; x++) { sum += hsl(x, y); n++; }
    if (!n) { sum = hsl((x0 + x1) / 2, (y0 + y1) / 2); n = 1; }
    eye[k] = { px: +(Math.min(x1 - x0, y1 - y0) * css).toFixed(1), l: +(sum / n).toFixed(3) };
  }
  // 旁边的脸：两只眼睛正下方 4 cm、两眼之间（静止姿势里贴着脸，按头骨蒙皮），各取 3×3 像素
  const face: number[] = [];
  const at = (sx: -1 | 1, dx: number, dy: number, dz: number) => {
    const p = eyeCenter(sx).add(new THREE.Vector3(dx, dy, dz));
    m.applyBoneTransform(ref, p); p.applyMatrix4(m.matrixWorld);
    const [x, y] = px(p);
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += hsl(x + i, y + j);
    face.push(s / 9);
  };
  at(-1, 0, -0.04, 0.02); at(1, 0, -0.04, 0.02); at(1, -0.036, 0, 0.012);
  face.sort((a, b) => a - b);
  const skin = face[1] as number;
  const minEye = Math.min(...Object.values(eye).map((e) => e.l)), minPx = Math.min(...Object.values(eye).map((e) => e.px));
  const res = { kind: 'eyes', id, eyes, eye, face: face.map((x) => +x.toFixed(3)), dL: +(minEye - skin).toFixed(3), ok: minEye - skin >= 0.15 && minPx >= 4 };
  if (!res.ok) console.error('[wp5PixelCheck] eyes failed', JSON.stringify(res));
  return res;
}

function doubleBoxName(id: string): string {
  const i = doubles.slotIndexOf(id);
  return i >= 0 ? `double${i}` : '';
}

/** 场景根（只在调试模式下可用）：验收时在页面里检查 / 临时改动场景用，例如对照 CORE 占位 kit 的端墙镜框。 */
registerDebug('wp5Scene', () => viewCtx?.scene ?? null);

let viewCtx: import('../../core/contracts').ViewContext | null = null;
registerViewSystem({ id: 'wp5.ctx', owner: 'WP5', order: 28, init(ctx) { viewCtx = ctx; }, frame() { /* */ } });
