// tests/unit/npc/standCut.test.ts —— 跑段 → 站立段的第一帧，人物上身着色不能当着镜头突变。
// 5-7 的同学原先只有腿，现在有弱化轮廓；进 5-8 后恢复完整着色。第一帧镜头仍在追尾位置，
// 马老师和近处同学在画面里，所以保留黑场切。这里逐 tick 渲染边界（ObstacleView + CameraRig），比较前后帧的显示风格。
// 有人变了的边界，界面必须用黑场切（ui/hud/overlays.ts 的 segmentCut）；没人变的边界（4-2 → 4-3 梦里）照旧无缝。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChapterId, QualityTier, SimSnapshot } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';
import { CameraRig } from '../../../src/render/camera/CameraRig';
import { drawsDetailedUpper } from '../../../src/render/npc/LegForest';
import { segmentCut } from '../../../src/ui/hud/overlays';
import { ViewDriver, makeView } from './helpers';

interface Seen { x: number; y: number; z: number; up: boolean }
interface Frame { people: Seen[]; all: Seen[]; cam: THREE.Vector3; snap: SimSnapshot }

/** 从 seg@beat 起每 tick 渲染一帧，直到进入站立段。返回最后一帧跑段和第一帧站立段（视锥内的人、全部的人、镜头位置）。 */
function acrossBoundary(tier: QualityTier, ch: ChapterId, seg: string, beat: number): { last: Frame; first: Frame } {
  const { view, ctx } = makeView(tier);
  const camera = ctx.camera as THREE.PerspectiveCamera;
  camera.aspect = 16 / 9; camera.near = 0.05; camera.far = 300; camera.fov = 55; camera.updateProjectionMatrix();
  const vd = new ViewDriver(view, getChapter(ch) as ChapterDef, { segment: seg, beat });
  vd.d.sim.setInvincible(true);
  const rig = new CameraRig(); rig.init(ctx); rig.onReset(vd.d.snap);
  const low = tier === 'low';
  let rec: Seen[] = [];
  const add = view.forest.add.bind(view.forest);
  view.forest.add = (p) => { rec.push({ x: p.x, y: p.y, z: p.z, up: drawsDetailedUpper(p, low) }); add(p); };
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4(), sph = new THREE.Sphere();
  // 上身所在的高度（髋以上 0.14–0.93 m，离地约 1.05–1.83 m）：球心 1.45 m，半径 0.5 m
  const inView = (p: Seen) => { sph.center.set(p.x, p.y + 1.45, p.z); sph.radius = 0.5; return frustum.intersectsSphere(sph); };
  let prev = vd.d.snap;
  let last: Frame | null = null;
  for (let k = 0; k < 6000; k++) {
    const evs = vd.d.stepOne();
    const s = vd.d.snap;
    for (const e of evs) { view.onEvent(e, s); rig.onEvent(e); }
    rec = [];
    view.frame(prev, s, 1, 1 / 120);                     // ObstacleView（order 早于镜头）读的是上一帧的镜头，和游戏一样
    rig.frame(prev, s, 1, 1 / 120);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const f: Frame = { people: rec.filter(inView), all: rec, cam: camera.position.clone(), snap: s };
    prev = s;
    if (s.segKind === 'stand') {
      if (!last) throw new Error(`${ch} ${seg}@${beat}: started inside the stand`);
      return { last, first: f };
    }
    last = f;
  }
  throw new Error(`${ch} ${seg}@${beat}: never reached the stand segment`);
}

/** 两帧里都在、并且至少在一帧的视锥内的人，上身状态变了的个数（按位置配对，1 tick 里人最多走 2 cm）。 */
function changedInView(a: Frame, b: Frame): { changed: number; matched: number } {
  let changed = 0, matched = 0;
  const near = (p: Seen, q: Seen) => Math.hypot(p.x - q.x, p.z - q.z) < 0.15 && Math.abs(p.y - q.y) < 0.3;
  const seen = new Set<Seen>();
  for (const [from, to] of [[a.people, b.all], [b.people, a.all]] as const) {
    for (const p of from) {
      const q = to.find((x) => near(p, x));
      if (!q || seen.has(p) || seen.has(q)) continue;
      seen.add(p); seen.add(q);
      matched++;
      if (p.up !== q.up) changed++;
    }
  }
  return { changed, matched };
}

describe('跑段 → 站立段：画面里的人当着镜头长出上身的边界，界面必须用黑场切（修复轮 B3 r2）', () => {
  const cases: Array<[ChapterId, string, number, string]> = [['ch5', '5-7', 61, '5-8'], ['ch4', '4-2', 126, '4-3']];
  for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
    it(`${tier}：5-7 → 5-8 镜头不变而视锥里有人长出上身 → segmentCut；4-2 → 4-3 没人变 → 无缝`, () => {
      const rows: string[] = [];
      for (const [ch, seg, beat, stand] of cases) {
        const { last, first } = acrossBoundary(tier, ch, seg, beat);
        expect(last.snap.segment).toBe(seg);
        expect(first.snap.segment).toBe(stand);
        // 同一个镜头：站立机位从最后一个追尾位置升起（第一帧几乎没动）
        expect(first.cam.distanceTo(last.cam), `${tier} ${seg}→${stand}`).toBeLessThan(0.02);
        const { changed, matched } = changedInView(last, first);
        const def = getChapter(ch)?.segments.find((x) => x.id === stand);
        const cut = segmentCut('run', 'stand', def?.kind === 'stand' ? def.script : undefined);
        rows.push(`${seg}→${stand} ${tier}: 视锥里 ${last.people.length} → ${first.people.length} 人，配对 ${matched}，上身变了 ${changed}，cut=${cut}`);
        expect(matched, rows.at(-1)).toBeGreaterThanOrEqual(2);
        // 规则：视锥里有人在这一帧长出（或收起）上身，这个边界就必须是黑场切
        if (changed > 0) expect(cut, rows.at(-1)).toBe(true);
        if (seg === '5-7') {
          expect(changed, rows.at(-1)).toBeGreaterThan(0);              // 马老师和左手边的同学：就是这次要盖住的
          expect(last.people.every((p) => !p.up), rows.at(-1)).toBe(true);   // 5-7 爬行时仍是「排队同学的腿」
          expect(first.people.filter((p) => p.up).length, rows.at(-1)).toBeGreaterThanOrEqual(changed);   // 5-8 照样「世界突然正常」
        } else {
          expect(changed, rows.at(-1)).toBe(0);                         // 4-2 广场上的人一直有上身
          expect(cut, rows.at(-1)).toBe(false);                         // 梦里一站起来：起身的镜头不被黑场盖住
        }
      }
      expect(rows.length).toBe(cases.length);
    });
  }
});
