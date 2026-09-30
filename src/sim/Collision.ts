// src/sim/Collision.ts —— 双层碰撞盒与受击结算（DESIGN.md §2.4、§2.5）。CORE 编写，归 WP1。
// 外层 = 障碍表里的碰撞盒；内层 = 横向缩到 85%（lethalShrink；s 向不缩，见 classify 注释）。
// 横档的竖直穿透 = 玩家盒顶 − 横档下沿（爬行 0.55 m 撞任何横档都 > 0.12 m，一定是撞；§2.4「爬行时……一定会撞上」）。
//   low   ：外层相交 → 绊（−1），障碍被碰倒。
//   bar   ：内层相交且竖直穿透 > 0.12（grazeY）→ 撞（−2），否则绊；伏低过渡中被擦到只算绊。
//   block ：正面（上一 tick 横向已对齐）内层相交 → 撞，推到最近的空车道；外层擦边或侧面 → 绊，弹回原车道。
//   soft  ：不扣稳度，只改地面材质（换道 0.22 s）。
//   pickup：不在空中（y < 0.1）时经过即拾取。
import type { AABB, HitSeverity } from '../core/types';
import type { CompiledObstacle } from '../levels/schema';
import type { ObstacleState } from './Track';
import { TUNING } from './tuning';

const H = TUNING.hitbox;

/** 玩家碰撞盒（写入 out，不分配）。duck 为 0..1 的伏低混合，twitch 为 0..1 的腿抬起程度。 */
export function playerBox(s: number, x: number, y: number, duck: number, twitch: number, out: AABB): AABB {
  const hCrawl = H.height + (H.twitchHeight - H.height) * twitch;
  const height = hCrawl + (TUNING.duck.height - hCrawl) * duck;
  const sExt = H.sFront + (H.duckS - H.sFront) * duck;
  out.x0 = x - H.halfW; out.x1 = x + H.halfW;
  out.y0 = y; out.y1 = y + height;
  out.s0 = s - sExt; out.s1 = s + sExt;
  return out;
}

export function obstacleBox(o: CompiledObstacle, st: ObstacleState, out: AABB): AABB {
  out.x0 = st.x0; out.x1 = st.x1; out.y0 = o.y0; out.y1 = o.y1; out.s0 = o.s0 + st.ds; out.s1 = o.s1 + st.ds;
  return out;
}

const lt = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
function shrink(a0: number, a1: number, k: number): [number, number] {
  const c = (a0 + a1) / 2, h = ((a1 - a0) / 2) * k;
  return [c - h, c + h];
}

export type HitKind =
  | { type: 'none' }
  | { type: 'soft' }
  | { type: 'pickup' }
  | { type: 'hit'; severity: HitSeverity; mode: 'low' | 'barCrash' | 'barGraze' | 'blockFront' | 'blockSide' | 'blockGraze' }
  | { type: 'nearMiss'; side: -1 | 1 };

/**
 * 判定一对盒子。prev 为上一 tick 的玩家盒（判断正面 / 侧面）。
 * ducking 表示伏低过渡中（0 < duck < 1）：横档只算绊。
 */
export function classify(p: AABB, prev: AABB, o: CompiledObstacle, ob: AABB, ducking: boolean): HitKind {
  const xs = lt(p.x0, p.x1, ob.x0, ob.x1);
  const ss = lt(p.s0, p.s1, ob.s0, ob.s1);
  if (o.cls === 'soft') return xs && ss ? { type: 'soft' } : { type: 'none' };
  if (o.cls === 'pickup') return xs && ss && p.y0 < 0.1 ? { type: 'pickup' } : { type: 'none' };
  const ys = lt(p.y0, p.y1, ob.y0, ob.y1);
  if (!(xs && ss && ys)) {
    if (o.cls === 'block' && ss && ys) {
      const gap = p.x1 <= ob.x0 ? ob.x0 - p.x1 : p.x0 - ob.x1;
      if (gap >= 0 && gap < 0.1) return { type: 'nearMiss', side: p.x1 <= ob.x0 ? 1 : -1 };
    }
    return { type: 'none' };
  }
  if (o.cls === 'low') return { type: 'hit', severity: 'stumble', mode: 'low' };
  // 内层只在横向缩小：玩家沿 s 前进，第一次接触时一定先碰到外层的前沿，所以「是否会撞进内层」只取决于横向是否对准
  //（§2.5 的「内层盒缩小 15%」对 s 方向不适用，否则正面冲撞永远先被判成擦边。这是 CORE 的解释，见 lead 汇报）。
  const k = H.lethalShrink;
  const [ix0, ix1] = shrink(ob.x0, ob.x1, k);
  const inner = lt(p.x0, p.x1, ix0, ix1);
  if (o.cls === 'bar') {
    // 竖直穿透 = 玩家盒顶高出横档下沿多少（不按横档厚度截断：拖把杆只有 8 cm 厚，爬行撞上去也必须是「撞」，§2.4）
    const pen = p.y1 - ob.y0;
    if (inner && pen > H.grazeY && !ducking) return { type: 'hit', severity: 'crash', mode: 'barCrash' };
    return { type: 'hit', severity: 'stumble', mode: 'barGraze' };
  }
  // block
  if (!inner) return { type: 'hit', severity: 'stumble', mode: 'blockGraze' };
  const prevAligned = lt(prev.x0, prev.x1, ix0, ix1);
  if (prevAligned) return { type: 'hit', severity: 'crash', mode: 'blockFront' };
  return { type: 'hit', severity: 'stumble', mode: 'blockSide' };
}

/** 是否会碰撞（求解器用：任何受击都算失败，soft / pickup / nearMiss 不算）。 */
export function wouldHit(p: AABB, o: CompiledObstacle, ob: AABB): boolean {
  if (o.cls === 'soft' || o.cls === 'pickup') return false;
  return lt(p.x0, p.x1, ob.x0, ob.x1) && lt(p.s0, p.s1, ob.s0, ob.s1) && lt(p.y0, p.y1, ob.y0, ob.y1);
}
