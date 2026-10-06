// src/render/materials.ts —— 材质工厂 MaterialsAPI（DESIGN.md §5 总则、§5.3，WP3）。
// 材质只有两种：MeshLambertMaterial（开顶点色，打 LampField 补丁）和 MeshBasicMaterial（发光体、影子、玻璃）。
// 所有 Lambert（包括实例化和蒙皮的）都经过 patchLambert；basic({ lampLit: true }) 按灯自身的亮度明灭。
// 没有 aChalk 属性的几何体由 ensureChalkAttr 补一个全 0 的属性（零额外 draw call）。
import * as THREE from 'three';
import type { MaterialsAPI } from '../core/contracts';
import { patchBasicLamp, patchLambert, type LampField } from './lampField';

export interface LambertOpts { vertexColors?: boolean; map?: THREE.Texture; transparent?: boolean; opacity?: number; flat?: boolean }
export interface BasicOpts { color?: number; map?: THREE.Texture; transparent?: boolean; opacity?: number; additive?: boolean; lampLit?: boolean }

export class HwMaterials implements MaterialsAPI {
  /** 创建过的材质数（测试 / 调试用）。 */
  created = 0;
  constructor(readonly lamps: LampField) {}

  lambert(o: LambertOpts = {}): THREE.MeshLambertMaterial {
    const p: THREE.MeshLambertMaterialParameters = { vertexColors: o.vertexColors ?? false, flatShading: o.flat ?? true };
    if (o.map) { p.map = o.map; if (o.map.colorSpace !== THREE.SRGBColorSpace) o.map.colorSpace = THREE.SRGBColorSpace; }
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity ?? 1; }
    const m = new THREE.MeshLambertMaterial(p);
    patchLambert(m, this.lamps.uniforms);
    this.created++;
    return m;
  }

  basic(o: BasicOpts = {}): THREE.MeshBasicMaterial {
    const p: THREE.MeshBasicMaterialParameters = { color: o.color ?? 0xffffff };
    if (o.map) { p.map = o.map; if (o.map.colorSpace !== THREE.SRGBColorSpace) o.map.colorSpace = THREE.SRGBColorSpace; }
    if (o.transparent || o.additive) { p.transparent = true; p.opacity = o.opacity ?? 1; p.depthWrite = false; }
    if (o.additive) p.blending = THREE.AdditiveBlending;
    const m = new THREE.MeshBasicMaterial(p);
    if (o.lampLit) patchBasicLamp(m, this.lamps.uniforms);
    this.created++;
    return m;
  }

  ensureChalkAttr(g: THREE.BufferGeometry): void {
    if (g.getAttribute('aChalk')) return;
    const n = g.getAttribute('position')?.count ?? 0;
    g.setAttribute('aChalk', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  }
}
