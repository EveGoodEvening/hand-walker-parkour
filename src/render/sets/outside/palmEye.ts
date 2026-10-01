// src/render/sets/outside/palmEye.ts —— 4-4 掌心（DESIGN.md §4.4；氛围 dream）。
// 「我把右手举到眼前。掌心里有一只眼睛。它很小，嵌在生命线和智慧线交叉的地方……我眨了一下眼睛，它也眨了一下。」
// 近景：举在镜头前的右手（掌心朝镜头，手指朝上）。右手掌心朝向自己时，拇指在画面右侧（+x），食指在右、小指在左，
// 前臂从右下方（右肩那边）伸进画面；掌心贴 palmEye 纹理（4 帧眨眼，约每 2.6 s 眨一次），生命线绕着右侧的拇指根；
// 身后是空了的梦中广场（「广场又安静了。我独自一人站着。」）：发白的地面、雾。没有选项 UI（§4.4、D12）。
// 坐标相对 STILL_ORIGIN，镜头按 palmEye 机位（0, 0.8, 0.5）看向 −z。draw call：掌心 1、手 1、地面 1 = 3。
import * as THREE from 'three';
import type { StillSet, ViewContext } from '../../../core/contracts';
import { registerSet } from '../../../core/registry';
import { C, shade } from '../../kits/outside/lib/colors';
import { OGeo, TexGeo } from '../../kits/outside/lib/geo';
import { Tone } from '../../kits/outside/lib/tone';
import { liveList } from './lib/live';
import { SetBuild } from './lib/setkit';

const PZ = -0.05, PX = 0.0, PY = 0.76, PW = 0.1, PH = 0.11;

/** 眨眼：约每 2.6 s 一次，半闭 → 闭 → 半闭各 60–80 ms。返回帧号 0 睁、1 半闭、2 闭、3 半闭。 */
export function blinkFrame(t: number): 0 | 1 | 2 | 3 {
  const period = 2.6, ph = ((t % period) + period) % period;
  if (ph < 2.3) return 0;
  const d = ph - 2.3;
  if (d < 0.06) return 1;
  if (d < 0.14) return 2;
  if (d < 0.2) return 3;
  return 0;
}

function build(ctx: ViewContext, variant: string): THREE.Object3D {
  const b = new SetBuild(ctx, `set.palmEye.${variant}`);
  // 地面：空了的广场（远处雾色吞掉边界）
  const f = new OGeo();
  f.flat(0, -60, 60, 3, -80, C.plaza, true);
  for (let z = 0; z > -30; z -= 1.4) f.flat(0.001, -30, 30, z, z - 0.02, C.plazaSeam, true);
  // §5.1 是画面上的颜色：按 dream 的光反推反照率（与 plaza kit 的地面一样亮，见 kits/outside/lib/tone.ts）
  const tone = Tone.of('dream');
  tone.applyArrays(f.col, f.nor, f.pos, 'floor');
  b.lambert(f, 'plaza');
  // 手：四指、拇指、手腕、袖口（校服），掌心留给纹理
  const h = new OGeo();
  const skin = C.skin, crease = C.lines;
  const top = PY + PH;
  // [dx, 长, 宽]：从左到右是小指、无名指、中指、食指（右手掌心朝自己）；中指最长，小指最短最细
  const fingers: Array<[number, number, number]> = [[-0.068, 0.07, 0.032], [-0.023, 0.088, 0.036], [0.025, 0.09, 0.036], [0.072, 0.075, 0.034]];
  for (const [dx, len, w] of fingers) {
    const x = PX + dx;
    h.wallZ(PZ - 0.002, x - w / 2, x + w / 2, top - 0.01, top + len, skin, 1);
    h.fan([[x - w / 2, top + len, PZ - 0.002], [x + w / 2, top + len, PZ - 0.002], [x + w * 0.3, top + len + 0.012, PZ - 0.002], [x - w * 0.3, top + len + 0.012, PZ - 0.002]], skin, [0, 0, 1]);
    for (const k of [0.35, 0.68]) h.wallZ(PZ - 0.001, x - w * 0.42, x + w * 0.42, top + len * k - 0.0015, top + len * k + 0.0015, crease, 1);
  }
  // 拇指：从掌的右侧斜着伸出去（右手掌心朝向自己时，拇指在右边，+x）
  h.fan([[PX + PW, PY + 0.01, PZ - 0.002], [PX + PW, PY - 0.05, PZ - 0.002], [PX + PW + 0.07, PY + 0.03, PZ - 0.002], [PX + PW + 0.075, PY + 0.07, PZ - 0.002], [PX + PW + 0.03, PY + 0.06, PZ - 0.002]], shade(skin, 0.97), [0, 0, 1]);
  // 手腕、前臂（袖子）斜向下方出画
  h.wallZ(PZ - 0.004, PX - 0.075, PX + 0.08, PY - PH - 0.07, PY - PH + 0.005, shade(skin, 0.95), 1);
  h.face([PX - 0.09, PY - PH - 0.06, PZ - 0.004], [PX + 0.095, PY - PH - 0.06, PZ - 0.004], [PX + 0.13, PY - PH - 0.4, PZ + 0.1], [PX - 0.06, PY - PH - 0.42, PZ + 0.1], C.uniform, [0, 0, 1]);
  h.face([PX - 0.09, PY - PH - 0.055, PZ - 0.003], [PX + 0.095, PY - PH - 0.055, PZ - 0.003], [PX + 0.097, PY - PH - 0.075, PZ + 0.0], [PX - 0.092, PY - PH - 0.075, PZ + 0.0], C.white, [0, 0, 1]);
  // 手是一块正对镜头的平面：每个面都补到色板色（皮肤 #C9B8A6）
  tone.applyArrays(h.col, h.nor, h.pos, 'exact');
  b.lambert(h, 'hand');
  // 掌心（纹理：4 帧横排）；纹理的主色是皮肤，顶点色乘上同样的补偿倍数，掌心与手指一样亮
  const tg = new TexGeo();
  tg.quad([PX - PW, PY - PH, PZ], [PX + PW, PY - PH, PZ], [PX + PW, PY + PH, PZ], [PX - PW, PY + PH, PZ], [0, 0], [0.25, 0], [0.25, 1], [0, 1]);
  const k = tone.factor(C.skin, [0, 0, 1]);
  for (let i = 0; i < tg.col.length; i += 3) { tg.col[i] = (tg.col[i] as number) * k[0]; tg.col[i + 1] = (tg.col[i + 1] as number) * k[1]; tg.col[i + 2] = (tg.col[i + 2] as number) * k[2]; }
  const palm = b.textured(tg, 'palmEye', {}, 'palm');
  const uv = palm.geometry.getAttribute('uv') as THREE.BufferAttribute;
  const base = new Float32Array(uv.array as Float32Array);
  let cur = -1;
  const update = (t: number) => {
    const fr = blinkFrame(t);
    if (fr === cur) return;
    cur = fr;
    const arr = uv.array as Float32Array;
    for (let i = 0; i < uv.count; i++) arr[i * 2] = (base[i * 2] as number) + fr * 0.25;
    uv.needsUpdate = true;
  };
  update(0);
  liveList('palmEye').add({ variant, root: b.root, update: (t) => update(t) });
  return b.root;
}

export const palmEyeSet: StillSet = {
  id: 'palmEye', owner: 'WP4', variants: ['default'],
  build,
  playerAnchor: () => new THREE.Matrix4().makeTranslation(0, 0, 0.6),
  update: (t, snap) => liveList('palmEye').update(snap.still?.t ?? t, snap),
};

registerSet(palmEyeSet);
