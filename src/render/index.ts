// src/render/index.ts —— 画面包入口（DESIGN.md §8.2、§8.7，WP3）。
// 注册：13 个氛围预设、材质工厂（MaterialsAPI + LampField + TextureBank）、View 汇总器、世界系统（chunk / set / 氛围 / 灯光 / 贴花），
// 以及 WP3 负责的 cue：atmosphere、fog、lights、board。
// 调试扩展（__game.ext，只在 ?test=1 或 ?debug=… 时可用）：
//   wp3Preview(opts)  在远处单独建一段 kit（或显示一个 set）并切到预览镜头；opts 见 ChunkStreamer.PreviewOpts
//   wp3PreviewOff()   退出预览          wp3Lights(op, fromBeat, toBeat, every?)  预览段里的灯光操作
//   wp3Luma(x0,y0,x1,y1)  渲染并读回一块区域的平均亮度   wp3Mem()  几何体 / 纹理 / 着色器数量   wp3Stats()  chunk 统计
import { registerCueHandler, registerDebug, registerMaterials, registerView, registerViewSystem } from '../core/registry';
import { STILL_ORIGIN } from '../core/constants';
import { urlParams } from '../core/urlParams';
import * as THREE from 'three';
import { registerAtmospheres } from './atmosphere';
import { world, type PreviewOpts } from './ChunkStreamer';
import { LampField } from './lampField';
import { HwMaterials } from './materials';
import { HwTextureBank } from './textureBank';
import { View } from './View';

registerAtmospheres();

registerMaterials((ctx) => {
  const lamps = new LampField();
  const tex = new HwTextureBank(ctx.quality.texSize);
  try { tex.anisotropy = ctx.quality.tier === 'low' ? 1 : Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()); } catch { tex.anisotropy = 1; }
  return { mat: new HwMaterials(lamps), lamps, tex };
});

let view: View | null = null;
registerView(() => { view = new View(); return view; });
registerViewSystem(world);

registerCueHandler('atmosphere', 'WP3', (b, c) => world.transitionTo(b.id, b.seconds, c.snap.t));
registerCueHandler('fog', 'WP3', (b, c) => world.fogOverride(b.near, b.far, b.seconds, c.snap.t));
registerCueHandler('lights', 'WP3', (b, c) => world.lightsOp(b.op, c.segment, b.from, b.to, b.every, b.delay, c.snap.t));
registerCueHandler('board', 'WP3', (b, c) => world.boardOp(b, c.snap.t));

// ——————————————————— 调试扩展 ———————————————————
const guard = () => { if (!urlParams().debugEnabled) throw new Error('debug disabled'); };

/** 预览用的 set 机位（相对 STILL_ORIGIN；与 WP5 的 camera/shots.ts 保持一致，找不到时用这里的值）。 */
const SET_CAMS: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  deskFeet: { pos: [0.3, 0.3, 1.35], look: [-0.1, 0.32, -1.8], fov: 62 },
  counter: { pos: [0, 1.1, 1.6], look: [0, 1.0, -1], fov: 55 },
  canteenWindow: { pos: [0.2, 0.5, 1.2], look: [-1.5, 0.8, -1], fov: 60 },
  labBoard: { pos: [0, 0.5, 1.4], look: [0, 1.2, -3], fov: 60 },
};

registerDebug('wp3Preview', (o?: unknown) => {
  guard();
  const opts = (o ?? {}) as PreviewOpts & { cam?: { pos: [number, number, number]; look: [number, number, number]; fov?: number }; hideUi?: boolean };
  const r = world.startPreview(opts);
  if (view) {
    if (opts.cam) {
      const b = r.setShot ? STILL_ORIGIN : { x: 0, y: r.floorY, z: -r.s };
      view.previewCam = {
        pos: new THREE.Vector3(b.x + opts.cam.pos[0], b.y + opts.cam.pos[1], b.z + opts.cam.pos[2]),
        look: new THREE.Vector3(b.x + opts.cam.look[0], b.y + opts.cam.look[1], b.z + opts.cam.look[2]), fov: opts.cam.fov ?? null,
      };
    } else if (r.setShot) {
      const c = SET_CAMS[opts.set ?? ''] ?? SET_CAMS.deskFeet as (typeof SET_CAMS)[string];
      view.previewCam = {
        pos: new THREE.Vector3(STILL_ORIGIN.x + c.pos[0], STILL_ORIGIN.y + c.pos[1], STILL_ORIGIN.z + c.pos[2]),
        look: new THREE.Vector3(STILL_ORIGIN.x + c.look[0], STILL_ORIGIN.y + c.look[1], STILL_ORIGIN.z + c.look[2]), fov: c.fov,
      };
    } else {
      // 与 CameraRig 的横屏追尾机位相同：(0.7·x, 0.92, +2.35)，注视 (·, 0.45, −7)
      view.previewCam = {
        pos: new THREE.Vector3(0.7 * r.x, r.floorY + 0.92, -r.s + 2.35),
        look: new THREE.Vector3(0.42 * r.x, r.floorY + 0.45, -r.s - 7), fov: null,
      };
    }
    view.warmUp();
  }
  if (opts.hideUi !== false && typeof document !== 'undefined') {
    const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden';
  }
  return { s: r.s, floorY: r.floorY, stats: { ...world.stats } };
});
registerDebug('wp3PreviewOff', () => {
  guard();
  world.stopPreview();
  if (view) view.previewCam = null;
  if (typeof document !== 'undefined') { const ui = document.getElementById('ui'); if (ui) ui.style.visibility = ''; }
  return true;
});
registerDebug('wp3Luma', (x0?: unknown, y0?: unknown, x1?: unknown, y1?: unknown) => {
  guard();
  return view ? view.luma(Number(x0 ?? 0), Number(y0 ?? 0), Number(x1 ?? 1), Number(y1 ?? 1)) : 0;
});
registerDebug('wp3Mem', () => {
  const r = view?.renderer;
  return r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, warmups: view?.warmups ?? 0 } : null;
});
registerDebug('wp3Stats', () => ({ ...world.stats, slots: world.slotCount(), stencil: view?.stencil ?? false }));
registerDebug('wp3Lights', (op?: unknown, from?: unknown, to?: unknown, every?: unknown) => {
  guard();
  const seg = world.previewSegment;
  if (!seg) return false;
  world.lightsOp(op as 'out', seg, Number(from ?? 0), Number(to ?? 999), every === undefined ? undefined : Number(every), 0, world.lamps.now);
  return true;
});
