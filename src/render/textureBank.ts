// src/render/textureBank.ts —— 程序纹理库（DESIGN.md §5.9、§8.4 TextureBank，WP3）。
// 生成器按 id 注册（WP3 注册通用与校园纹理；WP4 通过 ViewContext.tex.register 注册户外纹理）。
// get(id, p) 按 id + 参数缓存：同一纹理只生成一次；边长取画质档位的 texSize（低画质边长减半，§9.4）。
// 所有 CanvasTexture 设 colorSpace = SRGBColorSpace（§5）。没有 document 时（Node 单元测试）返回 1×1 白色纹理。
// 读章结束后 View 用 all() 把全部纹理提前上传（renderer.initTexture），游戏过程中不再新建纹理。
import * as THREE from 'three';
import type { TextureBank } from '../core/contracts';
import { COMMON_TEXTURES, type Params, type TexGen } from './textures/common';
import { SCHOOL_TEXTURES, TILEABLE } from './textures/school';

export class HwTextureBank implements TextureBank {
  private readonly gens = new Map<string, TexGen>();
  private readonly cache = new Map<string, THREE.Texture>();
  private white: THREE.Texture | null = null;
  /** 各向异性过滤（低机位看地面时很重要）；View 按渲染器能力设置。 */
  anisotropy = 1;
  /** 生成过的纹理数（测试用）。 */
  generated = 0;

  constructor(readonly size: number) {
    for (const [id, g] of Object.entries(COMMON_TEXTURES)) this.gens.set(id, g);
    for (const [id, g] of Object.entries(SCHOOL_TEXTURES)) this.gens.set(id, g);
  }

  register(id: string, gen: (size: number, p: Readonly<Record<string, string | number>>) => HTMLCanvasElement): void { this.gens.set(id, gen); }
  has(id: string): boolean { return this.gens.has(id); }

  get(id: string, p: Readonly<Record<string, string | number>> = {}): THREE.Texture {
    const key = `${id}:${stableKey(p)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const gen = this.gens.get(id);
    let tex: THREE.Texture;
    if (gen && typeof document !== 'undefined') {
      const size = Number(p.size ?? this.size);
      const canvas = gen(size, p);
      const t = new THREE.CanvasTexture(canvas);
      t.name = `hw:${key}`;
      if (TILEABLE.has(id) || p.repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
      t.anisotropy = this.anisotropy;
      this.generated++;
      tex = t;
    } else {
      if (!this.white) { this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true; }
      tex = this.white;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  /** 已生成的全部纹理（预上传用）。 */
  all(): THREE.Texture[] { return Array.from(new Set(this.cache.values())); }
}

function stableKey(p: Params): string {
  const keys = Object.keys(p).sort();
  return keys.map((k) => `${k}=${String(p[k])}`).join('&');
}
