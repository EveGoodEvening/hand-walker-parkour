// archetypes/note.ts —— 地上的纸条（pickup，§2.5：米白色；§3「纸条」、附录 B.3）。
// 米白 #E6E1D6 是全作唯一略带暖意的白。纸面带一点自发光（0.22）和 aChalk 0.5，暗场里也读得出来。
// 变体：flat（摊开、中间一道折痕）、folded（折成小方块）、soaked（被雨泡过，纸面发皱，n3-b / n3-c）。
// 拾取后（note 事件）立刻不画；重来时已拾取的纸条保留（§2.7）。
import * as THREE from 'three';
import { createRng } from '../../../core/rng';
import { defineArchetype, type PlaceCtx } from '../archetype';
import { C } from '../colors';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

/** 被雨泡过的纸条（附录 B.3）。 */
export const SOAKED_NOTES: ReadonlySet<string> = new Set(['n3-b', 'n3-c']);

export default defineArchetype({
  id: 'note', material: 'lambert', cap: 8, tileS: false, tileX: false,
  variants: [
    {
      name: 'flat', kind: 'note',
      build(b) {
        const hx = 0.12, hz = 0.085, y = 0.004;
        b.with({ glow: 0.22, chalk: 0.5 }, () => {
          b.quad([-hx, y, hz], [0, y + 0.014, hz], [0, y + 0.014, -hz], [-hx, y + 0.004, -hz], C.paper);
          b.quad([0, y + 0.014, hz], [hx, y + 0.002, hz], [hx, y, -hz], [0, y + 0.014, -hz], 0xdcd7cc);
        });
        b.box([0.04, y + 0.009, 0.03], [0.05, 0.001, 0.004], 0xa9a497, { faces: '+y' });
      },
    },
    {
      name: 'folded',
      build(b) {
        b.with({ glow: 0.22, chalk: 0.5 }, () => b.box([0, 0.012, 0], [0.12, 0.024, 0.09], C.paper, { colors: { '+y': 0xe9e4d9, '+z': 0xd4cfc3 } }));
        b.box([0, 0.0245, 0], [0.12, 0.001, 0.004], 0xb9b4a8, { faces: '+y' });
      },
    },
    {
      name: 'soaked',
      build(b) {
        // 发皱：3 × 3 网格，顶点高度随机起伏；颜色偏灰，带水渍
        const rng = createRng(7, 'soaked');
        const hx = 0.115, hz = 0.08, n = 3;
        const h: number[] = [];
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) h.push(0.004 + rng.range(0, 0.018));
        const P = (i: number, j: number): [number, number, number] => [-hx + (2 * hx * i) / n, h[i * (n + 1) + j] as number, -hz + (2 * hz * j) / n];
        b.with({ glow: 0.18, chalk: 0.5 }, () => {
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const col = (i + j) % 2 ? 0xc9c3b6 : 0xbdb7aa;
            b.quad(P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), P(i, j), col);
          }
        });
      },
    },
  ],
  place(p, c: PlaceCtx) {
    const o = c.o;
    const note = String(o.params.note ?? '');
    const v = SOAKED_NOTES.has(note) ? 'soaked' : note === 'n1-desk' ? 'folded' : 'flat';
    const cx = (c.st.x0 + c.st.x1) / 2, cs = (o.s0 + o.s1) / 2;
    // 每张纸条的朝向由 id 决定（不随时间变化）
    const yaw = createRng(o.id, 'note').range(-0.5, 0.5);
    _p.set(cx, c.floorY, -cs);
    _q.setFromEuler(_e.set(0, yaw, 0));
    _m.compose(_p, _q, _s);
    p.push(_m, p.variantIndex(v), 1);
    return true;
  },
});
