// tests/unit/render/sets.test.ts —— 校园静场 set（DESIGN.md §5.9，WP3 验收 1：每个 set ≤ 12 次 draw call）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { StillSet } from '../../../src/core/contracts';
import { BOARDS } from '../../../src/render/boards';
import { canteenWindowSet } from '../../../src/render/sets/school/canteenWindow';
import { counterSet, handAt } from '../../../src/render/sets/school/counter';
import { deskFeetSet, teacherPath } from '../../../src/render/sets/school/deskFeet';
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

  it('deskFeet：老师 0.9 s 后从前面走来，2.8 s 停在桌边，4.4 s 后离开；早读结束同学起身', () => {
    expect(teacherPath(0.5).visible).toBe(false);
    expect(teacherPath(2).walking).toBe(true);
    const stop = teacherPath(3.5);
    expect(stop.walking).toBe(false); expect(stop.z).toBeGreaterThan(-0.5);
    expect(teacherPath(5.4).dir).toBe(-1);
    expect(teacherPath(7).visible).toBe(false);
    const ctx = fakeCtx('low');
    const obj = deskFeetSet.build(ctx, 'teacher');
    const seated = obj.getObjectByName('classmatesSeated') as THREE.Mesh;
    const leaving = obj.getObjectByName('classmatesLeaving') as THREE.Mesh;
    deskFeetSet.update?.(3, snap({ s: 0, t: 3, segIndex: 0, segKind: 'still', still: { t: 3, variant: 'teacher' } }));
    expect(seated.visible).toBe(true); expect(leaving.visible).toBe(false);
    deskFeetSet.update?.(5.5, snap({ s: 0, t: 5.5, segIndex: 0, segKind: 'still', still: { t: 5.5, variant: 'teacher' } }));
    expect(seated.visible).toBe(false); expect(leaving.visible).toBe(true);
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
