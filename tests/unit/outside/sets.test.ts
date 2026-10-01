// tests/unit/outside/sets.test.ts —— WP4 静场 set（DESIGN.md §4.3–4.5、§5.8、§8.10 WP4 验收 1、附录 A）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EventBus } from '../../../src/core/bus';
import { RENDER_ORDER, STENCIL } from '../../../src/core/constants';
import type { Settings } from '../../../src/core/settings';
import { getSet } from '../../../src/core/registry';
import type { SetId } from '../../../src/core/types';
import { hsv, isWarm, C } from '../../../src/render/kits/outside/lib/colors';
import { PASSING_PERIOD, passingHz } from '../../../src/render/sets/outside/bus';
import { HOME_LAMP } from '../../../src/render/sets/outside/home';
import { vaporAt } from '../../../src/render/sets/outside/bathroom';
import { blinkFrame } from '../../../src/render/sets/outside/palmEye';
import { breakProgress, setWaterBreak, WATER_EDGE_Z } from '../../../src/render/sets/outside/water';
import { BED_LAMP, kneeHeights } from '../../../src/render/sets/outside/bedroom';
import '../../../src/render/sets/outside/infirmary';
import { LIVE_SETS } from '../../../src/render/sets/outside/lib/live';
import { SetBuild } from '../../../src/render/sets/outside/lib/setkit';
import { PALM_EYE, PALM_HEAD, PALM_LIFE, genCeilingCrack, palmLifeAt, type Img } from '../../../src/render/textures/outdoor';
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
    expect(kneeHeights(0.9, null, 0, null).r).toBeGreaterThan(0.15);
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

const byName = (root: THREE.Object3D, n: string): THREE.Mesh => meshes(root).find((m) => m.name === n)!;

describe('4-6：每一遍都从没碎开的水面开始（同一个 set 实例连续经历两次 4-6）', () => {
  const still = (t: number) => ({ set: 'water' as SetId, variant: 'default', t, duration: 8, prompt: null, held: 0 });
  const setup = () => {
    const ctx = viewContext('low', true);
    const bus = ctx.bus as EventBus;
    const root = getSet('water')!.build(ctx, 'default');
    ctx.scene.add(root);
    const crowd = byName(root, 'waterCrowd'), overlay = byName(root, 'waterOverlay').material as THREE.MeshBasicMaterial;
    const at = (simT: number) => { bus.tick = Math.round(simT * 120); };
    const upd = (simT: number, stillT: number) => getSet('water')!.update!(stillT, snapshot({ t: simT, tick: Math.round(simT * 120), segment: '4-6', segKind: 'still', still: still(stillT) }));
    const enter = (simT: number) => { at(simT); bus.emit('segment', { id: '4-6', index: 5, kind: 'still' }); };
    const breakNow = (simT: number) => { at(simT); bus.emit('cue', { body: { type: 'sfx', sfx: 'waterBreak' }, segment: '4-6' }); };
    const done = () => ctx.scene.remove(root);
    return { ctx, bus, root, crowd, overlay, at, upd, enter, breakNow, done };
  };

  it('重玩第四章（Game 不重建 View）：第二遍开场倒影可见、水面 0.42；碎开时倒影往下沉，沉到底才不画', () => {
    const w = setup();
    w.enter(100); w.upd(100, 0);
    expect(w.crowd.visible).toBe(true);
    expect(w.overlay.opacity).toBeCloseTo(0.42);
    w.breakNow(106.5);
    w.upd(106.8, 6.8);
    expect(w.crowd.visible).toBe(true);
    expect(w.crowd.position.y).toBeLessThan(-0.1);
    expect(w.overlay.opacity).toBeGreaterThan(0.6);
    w.upd(107.2, 7.2);
    expect(w.crowd.visible).toBe(false);
    expect(w.overlay.opacity).toBeCloseTo(0.93);
    // 同一会话里重玩：模拟时间 140 s 才再到 4-6
    w.at(130); w.bus.emit('chapter:start', { id: 'ch4' });
    w.enter(140); w.upd(140, 0);
    expect(w.crowd.visible).toBe(true);
    expect(w.crowd.position.y).toBe(0);
    expect(w.overlay.opacity).toBeCloseTo(0.42);
    w.upd(141, 1);
    expect(w.crowd.visible).toBe(true);
    // 第二遍照样能碎开
    w.breakNow(146.5); w.upd(147.2, 7.2);
    expect(w.crowd.visible).toBe(false);
    w.done();
  });
  it('没有总线事件时，静场时钟倒退也算新的一遍', () => {
    const w = setup();
    w.upd(100, 0); w.breakNow(106.5); w.upd(107.2, 7.2);
    expect(w.crowd.visible).toBe(false);
    w.upd(140, 0);
    expect(w.crowd.visible).toBe(true);
    expect(w.overlay.opacity).toBeCloseTo(0.42);
    w.done();
  });
  it('从检查点重来：即使这一遍的静场时间比上一遍晚，也不沿用上一遍的碎开', () => {
    const w = setup();
    w.upd(100, 0); w.breakNow(106.5); w.upd(107.2, 7.2);
    expect(w.crowd.visible).toBe(false);
    w.at(120); w.bus.emit('retry', { segment: '4-5', beat: 0 });
    w.upd(150, 7.5);
    expect(w.crowd.visible).toBe(true);
    expect(w.overlay.opacity).toBeCloseTo(0.42);
    w.done();
  });
  it('同一 tick 里先到的、属于新段的 cue 不被段切换清掉', () => {
    const w = setup();
    w.breakNow(200); w.enter(200);
    w.upd(200.7, 0.7);
    expect(w.crowd.visible).toBe(false);
    w.done();
  });
  it('画廊：setWaterBreak 直接指定碎开时刻，不往总线上发 cue；总线事件也不会把它清掉', () => {
    const w = setup();
    let cues = 0;
    w.ctx.bus.on('cue', () => { cues++; });
    setWaterBreak(w.root, 1);
    w.enter(10);
    w.upd(10, 2);
    expect(w.crowd.visible).toBe(false);
    expect(cues).toBe(0);
    setWaterBreak(w.root, null);
    w.upd(10, 2.1);
    expect(w.crowd.visible).toBe(true);
    w.done();
  });
});

describe('3-5：窗外滑过的路灯光（§4.3「雨刷把路灯切成一段一段的光」、附录 A-10）', () => {
  it('光带朝车厢里：FrontSide 材质下，全部三角形都朝着 busWindow 机位', () => {
    const root = getSet('bus')!.build(viewContext('low'), 'default');
    const m = byName(root, 'passingLights');
    expect((m.material as THREE.Material).side).toBe(THREE.FrontSide);
    const p = m.geometry.getAttribute('position');
    const cam = new THREE.Vector3(0.3, 1.1, 0.6);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
    let tris = 0;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      n.subVectors(b, a).cross(e.subVectors(c, a));
      expect(n.dot(e.subVectors(cam, a)), `三角形 ${i / 3}`).toBeGreaterThan(0);
      // 左窗的光带朝 +x，右窗的朝 −x（都朝车厢中间）
      expect(Math.sign(n.x)).toBe(a.x < 0 ? 1 : -1);
      tris++;
    }
    expect(tris).toBe(32);
  });
  it('掠过车窗的频率 < 3 Hz；「减少闪烁」时降到 0.5 Hz，设置随时生效', () => {
    expect(passingHz(false)).toBeLessThan(3);
    expect(passingHz(true)).toBeCloseTo(0.5);
    const ctx = viewContext('low');
    const root = getSet('bus')!.build(ctx, 'default');
    ctx.scene.add(root);
    const m = byName(root, 'passingLights');
    const upd = (t: number) => getSet('bus')!.update!(t, snapshot({ segKind: 'still', still: { set: 'bus', variant: 'default', t, duration: 12, prompt: null, held: 0 } }));
    upd(0); const z0 = m.position.z; upd(0.1);
    expect(m.position.z - z0).toBeCloseTo(0.1 * passingHz(false) * PASSING_PERIOD);
    (ctx.settings as Settings).reducedFlicker = true;
    upd(0); const z1 = m.position.z; upd(0.1);
    expect(m.position.z - z1).toBeCloseTo(0.1 * 0.5 * PASSING_PERIOD);
    ctx.scene.remove(root);
  });
});

describe('4-4：「我把右手举到眼前。」', () => {
  it('掌心朝自己的右手：拇指在画面右侧（+x），中指最长、在掌心中线右边一点，前臂从右下方伸进来', () => {
    const root = getSet('palmEye')!.build(viewContext('low'), 'default');
    const palm = new THREE.Box3().setFromBufferAttribute(byName(root, 'palm').geometry.getAttribute('position') as THREE.BufferAttribute);
    const hand = byName(root, 'hand').geometry.getAttribute('position');
    const cy = (palm.min.y + palm.max.y) / 2, cx = (palm.min.x + palm.max.x) / 2;
    let right = 0, left = 0, top = -Infinity, topX = 0, armX = 0, armN = 0;
    for (let i = 0; i < hand.count; i++) {
      const x = hand.getX(i), y = hand.getY(i);
      if (y > cy - 0.05 && y < cy + 0.08) { if (x > palm.max.x + 0.02) right++; if (x < palm.min.x - 0.02) left++; }
      if (y > top) { top = y; topX = x; }
      if (y < palm.min.y - 0.3) { armX += x; armN++; }
    }
    expect(right).toBeGreaterThan(0);
    expect(left).toBe(0);
    expect(topX).toBeGreaterThan(cx);
    expect(armN).toBeGreaterThan(0);
    expect(armX / armN).toBeGreaterThan(cx);                     // 前臂的下端偏右（右肩那边）
  });
  it('掌纹：生命线绕着右侧的拇指根；眼睛嵌在生命线与智慧线交叉的地方', () => {
    expect(PALM_LIFE.cx).toBeGreaterThan(0.8);
    const start = palmLifeAt(PALM_LIFE.a1), end = palmLifeAt(PALM_LIFE.a0);
    expect(start[0]).toBeGreaterThan(0.85);                      // 起点在拇指与食指之间的右侧掌缘
    expect(start[1]).toBeLessThan(0.4);
    expect(end[1]).toBeGreaterThan(0.9);                         // 终点在手腕
    // 生命线在眼睛那一行的位置
    const a = Math.PI + Math.asin((PALM_LIFE.cy - PALM_EYE.y) / PALM_LIFE.ry);
    expect(a).toBeGreaterThan(PALM_LIFE.a0);
    expect(a).toBeLessThan(PALM_LIFE.a1);
    const [lx, ly] = palmLifeAt(a);
    expect(ly).toBeCloseTo(PALM_EYE.y, 6);
    expect(Math.abs(lx - PALM_EYE.x)).toBeLessThan(0.01);
    // 智慧线从拇指一侧起，经过眼睛，往左下到小指一侧
    expect((PALM_HEAD[0] as readonly [number, number])[0]).toBeGreaterThan(0.85);
    expect((PALM_HEAD[PALM_HEAD.length - 1] as readonly [number, number])[0]).toBeLessThan(0.2);
    expect(PALM_HEAD.some(([u, v]) => Math.hypot(u - PALM_EYE.x, v - PALM_EYE.y) < 0.01)).toBe(true);
  });
});

describe('5-1：放松的时刻属于「这一遍」', () => {
  it('第二遍进 5-1 时不沿用上一遍的放松时刻（第一次 update 的静场时间已经 ≥ 0.05）', () => {
    const ctx = viewContext('low');
    const root = getSet('bedroom')!.build(ctx, 'feet');
    ctx.scene.add(root);
    const blanket = byName(root, 'blanket').geometry.getAttribute('position');
    const maxY = () => { let m = -Infinity; for (let i = 0; i < blanket.count; i++) m = Math.max(m, blanket.getY(i)); return m; };
    const upd = (simT: number, t: number, prompt: 'hold' | null, held: number) =>
      getSet('bedroom')!.update!(t, snapshot({ t: simT, segKind: 'still', still: { set: 'bedroom', variant: 'feet', t, duration: 12, prompt, held } }));
    // 第一遍：按住 → 放松 → 放平
    upd(50, 5.9, null, 0); upd(51, 6, 'hold', 0.1); upd(53.5, 6, 'hold', 2.5); upd(54, 8, null, 0); upd(56, 10, null, 0);
    const flat = maxY();
    // 第二遍：先有段切换，第一次 update 时静场时间已经是 11 s（比上一遍的 10 s 还晚）
    (ctx.bus as EventBus).tick = 200 * 120;
    ctx.bus.emit('segment', { id: '5-1', index: 0, kind: 'still' });
    upd(211, 11, null, 0);
    expect(maxY()).toBeGreaterThan(flat + 0.08);
    ctx.scene.remove(root);
  });
  it('等输入时静场时钟停着：按住期间脚仍在手下挣动（用模拟时间）', () => {
    const a = kneeHeights(6, 'hold', 0.5, null, 2.5, 100), b = kneeHeights(6, 'hold', 0.5, null, 2.5, 100.05);
    expect(Math.abs(a.r - b.r)).toBeGreaterThan(1e-3);
  });
});

describe('天花板：贴图铺满房间（UV 在 [0, 1] 里），裂缝「从墙角爬到吊灯的位置」', () => {
  const rooms: Array<[SetId, string, [number, number, number, number]]> = [
    ['home', 'default', [-2.7, 2.7, -5.6, 2.6]], ['bedroom', 'feet', [-2.2, 2.2, -3.2, 2.4]], ['bedroom', 'ceiling', [-2.2, 2.2, -3.2, 2.4]],
  ];
  for (const [id, v, [x0, x1, z0, z1]] of rooms) {
    it(`${id}.${v}`, () => {
      const root = getSet(id)!.build(viewContext('low'), v);
      const ceil = byName(root, 'ceiling');
      const uv = ceil.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6); expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6); expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      }
      const box = new THREE.Box3().setFromBufferAttribute(ceil.geometry.getAttribute('position') as THREE.BufferAttribute);
      expect(box.min.x).toBeCloseTo(x0); expect(box.max.x).toBeCloseTo(x1);
      expect(box.min.z).toBeCloseTo(z0); expect(box.max.z).toBeCloseTo(z1);
    });
  }
  it('吊灯正下方的天花板上有裂缝（按纹理像素查）', () => {
    const im: Img = genCeilingCrack(256, { shape: 'river' });
    const dark = (u: number, y: number) => {
      let m = 255;
      const px = Math.round(u * im.w), py = Math.round(y * im.h);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = Math.min(im.w - 1, Math.max(0, px + dx)), yy = Math.min(im.h - 1, Math.max(0, py + dy));
        m = Math.min(m, im.data[(yy * im.w + x) * 4] as number);
      }
      return m;
    };
    // 画布第 0 行在 z = Z1（flipY），u 沿 x
    const onCrack = (lamp: readonly [number, number], x0: number, x1: number, z0: number, z1: number) => dark((lamp[0] - x0) / (x1 - x0), 1 - (lamp[1] - z0) / (z1 - z0));
    expect(onCrack(HOME_LAMP, -2.7, 2.7, -5.6, 2.6)).toBeLessThan(110);
    expect(onCrack(BED_LAMP, -2.2, 2.2, -3.2, 2.4)).toBeLessThan(110);
    expect(dark(0.3, 0.9)).toBeGreaterThan(150);                    // 对照：远离裂缝的地方是亮的
  });
});
