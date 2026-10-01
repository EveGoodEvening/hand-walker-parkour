// tests/unit/render/sets.test.ts —— 校园静场 set（DESIGN.md §5.9，WP3 验收 1：每个 set ≤ 12 次 draw call）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { StillSet } from '../../../src/core/contracts';
import { BOARDS } from '../../../src/render/boards';
import { canteenWindowSet } from '../../../src/render/sets/school/canteenWindow';
import { counterSet, handAt } from '../../../src/render/sets/school/counter';
import { crowdAt, deskFeetPeople, deskFeetSet, teacherPath } from '../../../src/render/sets/school/deskFeet';
import { labBoardSet } from '../../../src/render/sets/school/labBoard';
import { WARM } from '../../../src/render/palette';
import { fakeCtx, meshCount, snap } from './helpers';

const SETS: StillSet[] = [deskFeetSet, counterSet, canteenWindowSet, labBoardSet];

describe('校园 set', () => {
  it('4 个 set 的 id 与所有者', () => {
    expect(SETS.map((s) => s.id).sort()).toEqual(['canteenWindow', 'counter', 'deskFeet', 'labBoard']);
    for (const s of SETS) expect(s.owner).toBe('WP3');
    expect(deskFeetSet.variants).toEqual(['teacher', 'math']);
  });

  for (const set of SETS) {
    for (const v of set.variants) {
      it(`${set.id}.${v}：≤ 12 次 draw call，三角形在静场预算内，update 不抛错`, () => {
        for (const tier of ['low', 'high'] as const) {
          const ctx = fakeCtx(tier);
          const obj = set.build(ctx, v);
          expect(meshCount(obj)).toBeLessThanOrEqual(12);
          let tris = 0;
          obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.getAttribute('position')?.count ?? 0) / 3; });
          expect(tris).toBeLessThan(tier === 'low' ? 20_000 : 40_000);
          for (let t = 0; t < 14; t += 0.25) set.update?.(t, snap({ s: 0, t, segIndex: 0, segKind: 'still', still: { t, variant: v, set: set.id } }));
          expect(set.playerAnchor(v)).toBeInstanceOf(THREE.Matrix4);
        }
      });
    }
  }

  it('deskFeet：老师按步行速度走近（≤ 1.3 m/s，附录 A-1）、3.0 s 缓停在桌边，4.3 s 后接着往后走出画面', () => {
    let prev = teacherPath(0);
    expect(prev.visible).toBe(true);
    for (let t = 0.05; t <= 9; t += 0.05) {
      const p = teacherPath(t);
      expect(Math.abs(p.z - prev.z) / 0.05).toBeLessThanOrEqual(1.3 + 1e-6);
      // 腿的相位按走过的距离：距离的增量就是位移（不滑行）
      expect(p.dist - prev.dist).toBeCloseTo(Math.abs(p.z - prev.z), 6);
      prev = p;
    }
    expect(teacherPath(2.95).speed).toBeLessThan(0.15);               // 缓停
    const stop = teacherPath(3.5);
    expect(stop.walking).toBe(false); expect(stop.z).toBeCloseTo(-0.25, 6);
    expect(teacherPath(3.1).z).toBeCloseTo(-0.25, 6);                  // 「今天你值日」（3.2 s）之前已经停住
    expect(teacherPath(5.5).z).toBeGreaterThan(stop.z);                // 接着往教室后面走，不回头穿过起身的同学
    expect(teacherPath(9).visible).toBe(false);
  });

  it('deskFeet：同学们 4.75 s 起一列列起身（0.5 s 过渡），沿过道走到前门；任意两人、人与老师都不相撞', () => {
    const ctx = fakeCtx('low');
    const obj = deskFeetSet.build(ctx, 'teacher');
    const crowd = obj.getObjectByName('classmates') as THREE.Mesh;
    for (const a of ['aStand', 'aSwing', 'aP0', 'aP1']) expect(crowd.geometry.getAttribute(a)?.count).toBe(crowd.geometry.getAttribute('position').count);
    expect(crowd.frustumCulled).toBe(false);
    const people = deskFeetPeople('teacher');
    expect(people.length).toBeGreaterThan(12);
    // 4.6 s（早读结束）之前都坐着；起身是 0.5 s 的过渡，不是瞬间互换
    for (const p of people) {
      expect(crowdAt(p, 4.6).k).toBe(0);
      expect(crowdAt(p, p.ts + 0.25).k).toBeGreaterThan(0.2);
      expect(crowdAt(p, p.ts + 0.25).k).toBeLessThan(0.8);
    }
    let minPair = 9, minTeacher = 9;
    for (let t = 4.6; t < 22; t += 0.02) {
      const pos = people.map((p) => crowdAt(p, t));
      const tp = teacherPath(t);
      for (let i = 0; i < pos.length; i++) {
        const a = pos[i] as ReturnType<typeof crowdAt>;
        if (a.gone || a.x > 3.6) continue;                          // 出了前门就被墙挡住
        if (tp.visible) minTeacher = Math.min(minTeacher, Math.hypot(a.x - 1.2, a.z - tp.z));
        for (let j = i + 1; j < pos.length; j++) {
          const b = pos[j] as ReturnType<typeof crowdAt>;
          if (b.gone || b.x > 3.6 || (a.k < 0.5 && b.k < 0.5)) continue;
          minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.z - b.z));
        }
      }
    }
    expect(minPair).toBeGreaterThan(0.38);
    expect(minTeacher).toBeGreaterThan(1.0);
    for (const p of people) expect(crowdAt(p, 22).gone).toBe(true);
    // update 把时间写进着色器的 uniform
    deskFeetSet.update?.(5.5, snap({ s: 0, t: 5.5, segIndex: 0, segKind: 'still', still: { t: 5.5, variant: 'teacher' } }));
    const mat = crowd.material as THREE.MeshLambertMaterial;
    const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <lights_fragment_end>' };
    mat.onBeforeCompile(sh as never, null as never);
    expect((sh.uniforms.uCrowdT as { value: number }).value).toBe(5.5);
    expect(sh.vertexShader).toContain('aStand');
    expect(mat.customProgramCacheKey()).toContain('hwCrowd');
    // math 变体：一直坐着
    deskFeetSet.build(fakeCtx('low'), 'math');
    for (const p of deskFeetPeople('math')) expect(crowdAt(p, 30).k).toBe(0);
  });

  it('counter：阿姨的手舀菜、再舀一勺红烧肉（2.85 s 落到餐盘上）；暖色只在这里', () => {
    const ctx = fakeCtx('low');
    const obj = counterSet.build(ctx, 'default');
    const pork = obj.getObjectByName('pork') as THREE.Mesh;
    counterSet.update?.(2.0, snap({ s: 0, t: 2, segIndex: 0, segKind: 'still', still: { t: 2, variant: 'default' } }));
    expect(pork.visible).toBe(false);
    counterSet.update?.(3.0, snap({ s: 0, t: 3, segIndex: 0, segKind: 'still', still: { t: 3, variant: 'default' } }));
    expect(pork.visible).toBe(true);
    expect(handAt(1.55).z).toBeGreaterThan(handAt(0).z);   // 伸到餐盘上方
    // 暖色确实用上了（窗口灯与红烧肉）
    const colors = new Set<number>();
    const c = new THREE.Color();
    obj.traverse((o) => {
      const m = o as THREE.Mesh; const a = m.isMesh ? m.geometry.getAttribute('color') as THREE.BufferAttribute : null;
      if (a) for (let i = 0; i < a.count; i += 3) colors.add(c.setRGB(a.getX(i), a.getY(i), a.getZ(i)).getHex());
    });
    expect(colors.has(new THREE.Color(WARM.windowLamp).getHex())).toBe(true);
  });

  it('canteenWindow：玻璃是反光面 canteenGlass（x = −1.1），陈默 7 s 前后坐下', () => {
    const surf = canteenWindowSet.surfaces?.('default') ?? [];
    expect(surf.map((s) => s.id)).toEqual(['canteenGlass']);
    expect(surf[0]?.plane.distanceToPoint(new THREE.Vector3(-1.1, 1, 0))).toBeCloseTo(0, 6);
    const obj = canteenWindowSet.build(fakeCtx('low'), 'default');
    const cm = obj.getObjectByName('chenMoLegs') as THREE.Mesh;
    canteenWindowSet.update?.(5, snap({ s: 0, t: 5, segIndex: 0, segKind: 'still', still: { t: 5, variant: 'default' } }));
    expect(cm.visible).toBe(false);
    canteenWindowSet.update?.(8, snap({ s: 0, t: 8, segIndex: 0, segKind: 'still', still: { t: 8, variant: 'default' } }));
    expect(cm.visible).toBe(true);
  });

  it('labBoard：黑板注册为 board 表面 labBoard（board cue 写 / 擦）', () => {
    labBoardSet.build(fakeCtx('low'), 'default');
    expect(BOARDS.has('labBoard')).toBe(true);
    expect(labBoardSet.surfaces?.('default').map((s) => s.id)).toEqual(['labBoard']);
  });
});
