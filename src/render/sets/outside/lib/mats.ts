// src/render/sets/outside/lib/mats.ts —— WP4 取材质、改材质的唯一入口（DESIGN.md §8.2 规则 2、§8.11「先用本地适配层绕过」）。
// 契约（core/contracts.ts MaterialsAPI）只给了 vertexColors（仅 lambert）/ map / transparent / opacity / flat / additive / lampLit，
// 没有写明「每次调用返回新实例、调用方可以改」。WP4 还要改 vertexColors（basic）、depthWrite、colorWrite、stencil*、fog、toneMapped，
// 运行时还会改 opacity、map、color。已在 docs/contract-requests/WP4.md 申请（2026-10-01）。lead 确认之前：
//   · kits / sets / weather 只经 wp4Lambert() / wp4Basic() 取材质，不在别处直接写材质的渲染状态，集成时只换这一个文件；
//   · 同一个实例第二次交到 WP4 手里（说明 WP3 按参数缓存了材质），从第一次拿到时留的原样副本克隆一份再改（第一次的那个
//     已经被 WP4 改过了）。克隆时带上 onBeforeCompile 与 customProgramCacheKey（Material.copy 不复制它们，
//     WP3 的 LampField / 粉笔补丁就挂在那里）；
//   · WP3 若把同一个实例也给自己的 World 用，把 MAT_POLICY.clone 改成 'always' 即可（一行）。
// 经这里拿到的材质归 WP4 独占：运行时改 opacity / map / color 只影响 WP4 自己的 mesh。
// 纹理同理：要改 wrap 的纹理用 wp4Texture() 取，参数里多带一个 wrap 键，TextureBank 按 id + 参数缓存，拿到的是单独一份。
import * as THREE from 'three';
import type { MaterialsAPI, TextureBank } from '../../../../core/contracts';

/** 契约之外、WP4 需要的材质状态。 */
export interface MatTune {
  vertexColors?: boolean;
  depthWrite?: boolean;
  colorWrite?: boolean;
  fog?: boolean;
  toneMapped?: boolean;
  /** 模板测试：写（func Always + zPass Replace）或只读（func Equal、writeMask 0）。 */
  stencil?: { ref: number; func: THREE.StencilFunc; funcMask?: number; writeMask?: number; zPass?: THREE.StencilOp };
}

export const MAT_POLICY: { clone: 'onReuse' | 'always' } = { clone: 'onReuse' };

/** WP4 拿到过的实例 → 拿到时的原样副本（'onReuse' 下再次拿到同一个实例时从这里克隆）。 */
const seen = new WeakMap<THREE.Material, THREE.Material>();

function cloneFrom<M extends THREE.Material>(src: M, patch: M): M {
  const c = src.clone() as M;
  c.onBeforeCompile = patch.onBeforeCompile;
  c.customProgramCacheKey = patch.customProgramCacheKey;
  return c;
}

/** 让 m 归 WP4 独占（必要时克隆），再套上 t。 */
export function tuneMat<M extends THREE.Material>(m: M, t: MatTune = {}): M {
  let out = m;
  if (MAT_POLICY.clone === 'always') out = cloneFrom(m, m);
  else {
    const orig = seen.get(m) as M | undefined;
    if (orig) out = cloneFrom(orig, m);
    else seen.set(m, cloneFrom(m, m));
  }
  if (t.vertexColors !== undefined) out.vertexColors = t.vertexColors;
  if (t.depthWrite !== undefined) out.depthWrite = t.depthWrite;
  if (t.colorWrite !== undefined) out.colorWrite = t.colorWrite;
  if (t.fog !== undefined) (out as THREE.Material & { fog?: boolean }).fog = t.fog;
  if (t.toneMapped !== undefined) out.toneMapped = t.toneMapped;
  if (t.stencil) {
    const s = t.stencil;
    out.stencilWrite = true;
    out.stencilRef = s.ref;
    out.stencilFunc = s.func;
    out.stencilFuncMask = s.funcMask ?? 0xff;
    out.stencilWriteMask = s.writeMask ?? 0;
    out.stencilZPass = s.zPass ?? THREE.KeepStencilOp;
  }
  return out;
}

export type LambertOpts = Parameters<MaterialsAPI['lambert']>[0];
export type BasicOpts = Parameters<MaterialsAPI['basic']>[0];

export function wp4Lambert(mat: MaterialsAPI, o: LambertOpts, t?: MatTune): THREE.MeshLambertMaterial { return tuneMat(mat.lambert(o), t); }
export function wp4Basic(mat: MaterialsAPI, o: BasicOpts, t?: MatTune): THREE.MeshBasicMaterial { return tuneMat(mat.basic(o), t); }

/** 写模板位（遮罩）：不写颜色、不写深度。 */
export const stencilWrite = (ref: number): MatTune['stencil'] => ({ ref, func: THREE.AlwaysStencilFunc, writeMask: ref, zPass: THREE.ReplaceStencilOp });
/** 只在模板位 ref 里画。 */
export const stencilInside = (ref: number): MatTune['stencil'] => ({ ref, func: THREE.EqualStencilFunc, funcMask: ref, writeMask: 0 });

/** 取一张要平铺（RepeatWrapping）的纹理：参数里多一个 wrap 键，拿到的是单独缓存的一份，改 wrap 不影响别人。 */
export function wp4Texture(tex: TextureBank, id: string, p: Readonly<Record<string, string | number>> = {}, repeat = false): THREE.Texture {
  if (!repeat) return tex.get(id, p);
  const t = tex.get(id, { ...p, wrap: 'repeat' });
  if (t.wrapS !== THREE.RepeatWrapping || t.wrapT !== THREE.RepeatWrapping) {
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  }
  return t;
}
