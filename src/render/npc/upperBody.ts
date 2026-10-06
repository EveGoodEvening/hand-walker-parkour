import * as THREE from 'three';
import type { V3 } from '../../core/geo';
import { C } from './colors';
import type { PartBuilder } from './material';

/** 平面人物照旧用面法线；弱化轮廓改用圆滑的顶点法线，不改外沿或碰撞尺寸。只在建模时执行。 */
export function upperBox(b: PartBuilder, center: V3, size: V3, hex: number, opts: Parameters<PartBuilder['box']>[3] = {}): void {
  const start = b.vertexCount;
  b.box(center, size, hex, opts);
  const inv = b.g.matrix?.clone().invert();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = start; i < b.vertexCount; i++) {
    p.fromArray(b.g.pos, i * 3);
    if (inv) p.applyMatrix4(inv);
    n.set((p.x - center[0]) / size[0], (p.y - center[1]) / size[1], (p.z - center[2]) / size[2]).normalize();
    if (b.g.matrix) n.transformDirection(b.g.matrix);
    n.toArray(b.g.nor, i * 3);
  }
}

/** 42 个三角形的躯干、两臂与头；原点在髋关节，头顶在 0.93 m。 */
export function lowUpperBody(b: PartBuilder, silhouette = false): void {
  const shirt = silhouette ? C.uniform : 0xffffff;
  const shade = silhouette ? shirt : 0xdadada;
  b.with({ tint: 1 }, () => {
    upperBox(b, [0, 0.4, 0], [0.4, 0.52, 0.22], shirt, { faces: '+x-x+z-z+y', colors: { '+y': shade } });
    for (const s of [-1, 1]) upperBox(b, [s * 0.24, 0.38, 0.02], [0.075, 0.5, 0.08], shade, { faces: '+x-x+z-z+y' });
  });
  upperBox(b, [0, 0.81, 0.01], [0.17, 0.24, 0.18], silhouette ? shirt : C.skin, silhouette ? {} : { colors: { '+y': C.hair, '-z': C.hair } });
}
