// tests/unit/outside/sets.test.ts —— WP4 静场 set（DESIGN.md §4.3–4.5、§5.8、§8.10 WP4 验收 1、附录 A）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RENDER_ORDER, STENCIL } from '../../../src/core/constants';
import { getSet } from '../../../src/core/registry';
import type { SetId } from '../../../src/core/types';
import { hsv, isWarm, C } from '../../../src/render/kits/outside/lib/colors';
import '../../../src/render/sets/outside/bus';
import '../../../src/render/sets/outside/home';
import { vaporAt } from '../../../src/render/sets/outside/bathroom';
import { blinkFrame } from '../../../src/render/sets/outside/palmEye';
import { breakProgress, WATER_EDGE_Z } from '../../../src/render/sets/outside/water';
import { kneeHeights } from '../../../src/render/sets/outside/bedroom';
import '../../../src/render/sets/outside/infirmary';
import { LIVE_SETS } from '../../../src/render/sets/outside/lib/live';
import { SetBuild } from '../../../src/render/sets/outside/lib/setkit';
import { TIERS, snapshot, vertexColors, viewContext } from './helpers';

const SETS: Array<[SetId, string]> = [
  ['bus', 'default'], ['home', 'default'], ['bathroom', 'default'], ['palmEye', 'default'], ['water', 'default'],
  ['bedroom', 'feet'], ['bedroom', 'ceiling'], ['infirmary', 'bed'], ['infirmary', 'ceiling'],
];

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}

describe('WP4 的 7 个 set（§5.9）', () => {
  it('都由 WP4 注册，变体齐全', () => {
    const want: Record<string, string[]> = { bus: ['default'], home: ['default'], bathroom: ['default'], palmEye: ['default'], water: ['default'],
      bedroom: ['feet', 'ceiling'], infirmary: ['bed', 'ceiling'] };
    for (const [id, vs] of Object.entries(want)) {
      const s = getSet(id as SetId);
      expect(s?.id).toBe(id);
      expect(s?.owner).toBe('WP4');
      expect([...(s?.variants ?? [])]).toEqual(vs);
    }
  });
});

describe('每个 set ≤ 12 次 draw call（§8.10 WP4 验收 1）', () => {
  for (const [id, v] of SETS) for (const tier of TIERS) for (const stencil of [true, false]) {
    it(`${id}.${v} @${tier}${stencil ? '' : '（无模板）'}`, () => {
      const ctx = viewContext(tier, stencil);
      const set = getSet(id)!;
      const root = set.build(ctx, v);
      expect(SetBuild.drawCalls(root)).toBeLessThanOrEqual(12);
      for (const m of meshes(root)) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      }
      expect(set.playerAnchor(v)).toBeInstanceOf(THREE.Matrix4);
      // update 是 t 与快照的纯函数：推进不建几何体
      ctx.scene.add(root);
      const geos = meshes(root).map((m) => m.geometry);
      for (let t = 0; t < 12; t += 0.05) set.update?.(t, snapshot({ segKind: 'still', still: { set: id, variant: v, t, duration: 12, prompt: t > 6 && t < 8 ? 'hold' : null, held: Math.max(0, t - 6) } }));
      expect(meshes(root).map((m) => m.geometry)).toEqual(geos);
      ctx.scene.remove(root);
    });
  }
});

describe('开口（车窗、镜子、水面）给 WP5 的替身用（§5.8）', () => {
  it('bus / bathroom / water 提供平面与范围，id 带别名', () => {
    const bus = getSet('bus')!.surfaces!('default');
    expect(bus.map((s) => s.id)).toContain('busWindow');
    expect(bus[0]!.plane.distanceToPoint(new THREE.Vector3(-1.22, 1.2, 0))).toBeCloseTo(0);
    expect(bus[0]!.plane.normal.x).toBe(1);
    const bath = getSet('bathroom')!.surfaces!('default');
    expect(bath.map((s) => s.id)).toContain('bathMirror');
    expect(bath[0]!.plane.normal.z).toBe(1);
    expect(bath[0]!.plane.distanceToPoint(new THREE.Vector3(0, 1.5, -0.62))).toBeCloseTo(0);
    const water = getSet('water')!.surfaces!('default');
    expect(water.map((s) => s.id)).toContain('water');
    expect(water[0]!.plane.normal.y).toBe(1);
    expect(water[0]!.rect[3]).toBe(WATER_EDGE_Z);
  });
  it('卫生间：镜面后面是镜像过来的房间（门和毛巾在镜子里，§4.3「镜子里没有人。只有我背后的卫生间门」）', () => {
    const root = getSet('bathroom')!.build(viewContext('low'), 'default');
    const room = meshes(root).find((m) => m.name === 'room')!;
    const p = room.geometry.getAttribute('position');
    let front = 0, behind = 0;
    for (let i = 0; i < p.count; i++) { if (p.getZ(i) > 1.8) front++; if (p.getZ(i) < -0.62 * 2 - 1.8 + 0.2) behind++; }
    expect(front).toBeGreaterThan(0);
    expect(behind).toBeGreaterThan(0);
  });
  it('水：遮罩写模板位 0x80；倒影和叠加层只在 0x80 里；地面不写深度、最先画；没有模板时降级', () => {
    const root = getSet('water')!.build(viewContext('low', true), 'default');
    const byName = (n: string) => meshes(root).find((m) => m.name === n)!;
    const mask = byName('waterMask'), crowd = byName('waterCrowd'), overlay = byName('waterOverlay'), shore = byName('shore');
    const mm = mask.material as THREE.Material;
    expect(mask.renderOrder).toBe(RENDER_ORDER.puddleMask);
    expect(mm.colorWrite).toBe(false);
    expect(mm.stencilWrite).toBe(true);
    expect(mm.stencilRef).toBe(STENCIL.puddleBit);
    expect(mm.stencilZPass).toBe(THREE.ReplaceStencilOp);
    const cm = crowd.material as THREE.Material;
    expect(crowd.renderOrder).toBe(RENDER_ORDER.puddleDouble);
    expect(cm.stencilFunc).toBe(THREE.EqualStencilFunc);
    expect(cm.stencilFuncMask).toBe(STENCIL.puddleBit);
    expect(overlay.renderOrder).toBe(RENDER_ORDER.puddleOverlay);
    expect((overlay.material as THREE.Material).stencilFunc).toBe(THREE.EqualStencilFunc);
    expect(shore.renderOrder).toBe(RENDER_ORDER.floor);
    expect((shore.material as THREE.Material).depthWrite).toBe(false);
    // 倒影是倒着的（在水面以下）
    const cp = crowd.geometry.getAttribute('position');
    for (let i = 0; i < cp.count; i++) expect(cp.getY(i)).toBeLessThanOrEqual(1e-6);
    const flat = getSet('water')!.build(viewContext('low', false), 'default');
    const names = meshes(flat).map((m) => m.name);
    expect(names).not.toContain('waterCrowd');
    expect(names).toContain('blurSilhouette');
    expect(meshes(flat).find((m) => m.name === 'waterMask')!.visible).toBe(false);
  });
});

describe('色彩（附录 A-9）：第四、五章的 set 没有暖色；第三章只许路灯碎金', () => {
  for (const [id, v] of SETS) {
    it(`${id}.${v}`, () => {
      const root = getSet(id)!.build(viewContext('medium'), v);
      const ch3 = id === 'bus' || id === 'home' || id === 'bathroom';
      for (const m of meshes(root)) for (const c of vertexColors(m.geometry)) {
        if (!isWarm(c)) continue;
        // 第三章：只允许路灯金（公交车窗外滑过的路灯、挡风玻璃外的路灯）
        expect(ch3, `${id}.${v} ${m.name} ${c.toString(16)}`).toBe(true);
        expect(Math.abs(hsv(c).h - hsv(C.lampGold).h)).toBeLessThan(14);
      }
    });
  }
});

describe('动画时间线（纯函数）', () => {
  it('5-1：脚先自己弓起；按住时在手下挣动、越按越弱；输入完成后放松（不是「按不住」）', () => {
    expect(kneeHeights(0.1, null, 0, null)).toEqual({ r: 0, l: 0 });
    expect(kneeHeights(0.9, null, 0, null).r).toBeGreaterThan(0.2);
    expect(kneeHeights(2.0, null, 0, null).l).toBeGreaterThan(0.1);
    const early = kneeHeights(6, 'hold', 0.1, null).r, late = kneeHeights(6, 'hold', 2.4, null).r;
    expect(early).toBeGreaterThan(late);
    expect(kneeHeights(9, null, 0, 8).r).toBeLessThan(0.1);
    expect(kneeHeights(10, null, 0, 8)).toEqual({ r: 0, l: 0 });
  });
  it('掌心的眼睛约每 2.6 s 眨一次（睁 → 半闭 → 闭 → 半闭 → 睁）', () => {
    expect(blinkFrame(0)).toBe(0);
    expect(blinkFrame(2.33)).toBe(1);
    expect(blinkFrame(2.4)).toBe(2);
    expect(blinkFrame(2.47)).toBe(3);
    expect(blinkFrame(2.55)).toBe(0);
    expect(blinkFrame(2.6 + 2.4)).toBe(2);
  });
  it('3-10：泼水后镜面起雾，擦掉，4.0 s「镜子里没有人。」时镜面是清的', () => {
    expect(vaporAt(0.5)).toBe(0);
    expect(vaporAt(2.5)).toBeGreaterThan(0.2);
    expect(vaporAt(4.0)).toBe(0);
  });
  it('4-6：水面在 0.6 s 内碎开', () => {
    expect(breakProgress(5, null)).toBe(0);
    expect(breakProgress(5, 5.3)).toBe(0);
    expect(breakProgress(5.6, 5.3)).toBeCloseTo(0.5);
    expect(breakProgress(9, 5.3)).toBe(1);
  });
  it('set 实例表：移出场景的实例被剔除（重新读章不泄漏）', () => {
    const ctx = viewContext('low');
    const set = getSet('water')!;
    const a = set.build(ctx, 'default');
    ctx.scene.add(a);
    const list = LIVE_SETS.get('water')!;
    list.prune();
    const n = list.size;
    ctx.scene.remove(a);
    list.prune();
    expect(list.size).toBe(n - 1);
  });
});
