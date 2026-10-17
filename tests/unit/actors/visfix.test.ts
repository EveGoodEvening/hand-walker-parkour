// tests/unit/actors/visfix.test.ts —— 视觉修复（actors-2 / -6 / -7）：5-1 被子里的脚不画主角的身体；2-5 倒影的双手放在大腿上；
// 1-2 记忆闪回里倒着的人整个落在窗洞里、靠近画面中间，不被贴墙站着的人和主角挡住（Node 场景台 scene.ts）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, BONES } from '../../../src/core/rig';
import ch1 from '../../../src/levels/chapters/ch1';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef } from '../../../src/levels/schema';
import { stillHidden } from '../../../src/render/actors/Actor';
import { clipPose, SET_DEFAULT_CLIP } from '../../../src/render/actors/clips';
import { MEMORY_SILL, memoryScale } from '../../../src/render/actors/Doubles';
import { PoseBuilder } from '../../../src/render/actors/handCycle';
import { PELVIS_Z } from '../../../src/render/actors/poses';
import { createPose } from '../../../src/core/rig';
import { expandSegment } from '../../../src/render/npc/crowds';
import '../../../src/render/sets/outside/bedroom';
import { doubleVerts, ndc, occluderDepth, playRun, playStill, scene, visibleAgainst } from './scene';

describe('5-1 feet in the quilt (visual fix actors-2)', () => {
  it('the protagonist body is never drawn, even while the feetArch cue plays; the quilt carries the legs', async () => {
    expect(stillHidden('bedroom', 'feet')).toBe(true);
    // 第四章结尾卡（天花板）、医务室、只写了 set 键为 null 的 palmEye（cue 的姿势照样出现）不受影响
    expect(stillHidden('bedroom', 'ceiling')).toBe(false);
    expect(stillHidden('infirmary', 'bed')).toBe(false);
    expect(stillHidden('palmEye', 'default')).toBe(false);
    expect(SET_DEFAULT_CLIP['bedroom.ceiling']).toBe('lieBack');
    const w = await scene(ch5 as ChapterDef);
    for (const t of [0.2, 0.9, 2.0, 3.2]) {
      playStill(w, '5-1', t);                          // feetArch 的 actor cue 在 0.3–3.3 s
      expect(w.actor.rig.root.visible, `t ${t}`).toBe(false);
    }
  });
});

describe('2-5 reflection rests its hands on its thighs (visual fix actors-6)', () => {
  it('sitEat: both palms are low, over the thighs, not held out at chest height', () => {
    const b = new PoseBuilder();
    const out = createPose();
    clipPose('sitEat', 0, b, out, { x: 0, y: 0, s: 0, yaw: 0 });
    b.load(out);
    const chest = b.jointWorld('chest', new THREE.Vector3());
    for (const side of ['L', 'R'] as const) {
      const p = b.jointWorld(`palm${side}`, new THREE.Vector3());
      const knee = b.jointWorld(`shin${side}`, new THREE.Vector3());
      expect(p.y, side).toBeLessThan(0.66);            // 大腿上方（坐高约 0.5 m），以前在 0.74–0.76 的桌面高度
      expect(p.y, side).toBeLessThan(chest.y);
      // 前后落在髋与膝之间（大腿上），不伸到膝盖前面
      expect(-p.z, side).toBeLessThan(-knee.z + 0.02);
      expect(-p.z, side).toBeGreaterThan(-PELVIS_Z - 0.05);
    }
  });
});

describe('1-2 memory flash: the inverted figure is readable (visual fix actors-7)', () => {
  const ALL = BONES.map((_, i) => i).filter((i) => i < BONE_INDEX.arm3Upper);
  for (const [name, aspect] of [['16:9', 16 / 9], ['portrait', 390 / 844]] as const) {
    it(`${name}: inside the window opening, near mid-frame, ≥ 50% visible past the protagonist and the people by the wall`, async () => {
      const def = ch1 as ChapterDef;
      for (const b1 of [48.3, 50.0, 52.5]) {
        const w = await scene(def, 'low', aspect);
        const seg = w.ch.segments.find((s) => s.def.id === '1-2')!;
        const win = seg.surfaces.find((q) => q.id === 'win3f')!;
        const y0 = seg.floorY(win.s0) + (win.y?.[0] ?? 0), y1 = seg.floorY(win.s0) + (win.y?.[1] ?? 0);
        playRun(w, '1-2', 44, b1);
        const id = 'memory:win3f';
        const pts: THREE.Vector3[] = [];
        expect(doubleVerts(w, id, (v) => pts.push(v.clone())), `beat ${b1}`).toBe(true);
        let ylo = 9, yhi = -9, slo = 1e9, shi = -1e9;
        const c = new THREE.Vector3();
        for (const v of pts) { ylo = Math.min(ylo, v.y); yhi = Math.max(yhi, v.y); slo = Math.min(slo, -v.z); shi = Math.max(shi, -v.z); c.add(v); }
        c.multiplyScalar(1 / pts.length);
        // 整个人落在窗洞里：手腕在窗台上方，鞋尖低于窗顶
        expect(ylo, 'lowest point above the sill').toBeGreaterThan(y0 - 0.02);
        expect(yhi, 'highest point below the window top').toBeLessThan(y1 + 0.02);
        expect(slo).toBeGreaterThan(win.s0 - 0.05);
        expect(shi).toBeLessThan(win.s1 + 0.05);
        // 靠近画面中间（以前在 NDC x ≈ −0.72 的左缘）。竖屏的水平视角只有约 44°，窗洞本来就在左缘附近：
        // 替身停在窗洞远端，闪回的前一半在 0.75 以内，最后（52.5 拍，快要淡出）还在画面里
        const cn = ndc(w, c);
        const lim = aspect > 1 ? 0.6 : b1 < 51 ? 0.75 : 0.95;
        expect(Math.abs(cn.x), `centre NDC x at beat ${b1}`).toBeLessThan(lim);
        expect(Math.abs(cn.y)).toBeLessThan(0.8);
        // 主角挡不住
        const vis = visibleAgainst(w, id, ALL, occluderDepth(w, { player: true }));
        expect(vis.visible, `visible past the protagonist at beat ${b1}`).toBeGreaterThan(0.5);
        // 贴着左墙站着的人（doorways）：视线（俯视）离人的竖轴 < 0.3 m、而且在人的高度以下的点算被挡住
        const npc: Array<[number, number]> = [];
        const decor: Parameters<typeof expandSegment>[2] = [];
        expandSegment(w.ch.seed, seg, decor, []);
        for (const d of decor) if (d.side === -1 && d.s > win.s0 - 12 && d.s < win.s1 + 2) npc.push([d.x, d.s]);
        const cam = w.camera.position;
        let clear = 0;
        for (const v of pts) {
          let hit = false;
          for (const [nx, ns] of npc) {
            const vs = -v.z, cs = -cam.z;
            if ((ns - cs) * (vs - ns) <= 0) continue;     // 人不在镜头与这个点之间
            const k = (ns - cs) / (vs - cs);
            const x = cam.x + (v.x - cam.x) * k, y = cam.y + (v.y - cam.y) * k;
            if (Math.abs(x - nx) < 0.3 && y < 1.75) { hit = true; break; }
          }
          if (!hit) clear++;
        }
        expect(clear / pts.length, `clear of the people by the wall at beat ${b1}`).toBeGreaterThan(0.5);
      }
    });
  }

  it('scale: a 1.2 m window holds the whole figure; the wrists sit just above the sill', () => {
    expect(memoryScale(1.2)).toBeGreaterThan(0.5);
    expect(memoryScale(1.2)).toBeLessThan(0.6);
    expect(memoryScale(3)).toBe(0.82);
    expect(MEMORY_SILL).toBeGreaterThan(0);
  });
});
