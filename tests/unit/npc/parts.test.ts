// tests/unit/npc/parts.test.ts —— 着色器补丁、人群展开、特殊 NPC 识别、注册、更新耗时（验收 2）。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getCueHandler, getDebugExt, getViewSystems, getArchetype } from '../../../src/core/registry';
import { INSTANCE_COLOR_LINE, NPC_PROGRAM_KEY, PartBuilder, applyNpcPatch, patchNpcShader, variantBounds } from '../../../src/render/npc/material';
import { bandOf, expandChapter, expandSegment, type Decor, type GroupInfo } from '../../../src/render/npc/crowds';
import { LegForest, newPerson } from '../../../src/render/npc/LegForest';
import { lookFor, specialById, specialOfObstacle } from '../../../src/render/npc/specials';
import { compile } from '../../../src/levels/compile';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, CompiledObstacle, CompiledSegment } from '../../../src/levels/schema';
import { fakeCtx } from './helpers';
import '../../../src/render/npc/index';

describe('材质补丁：变体 / 着色 / 自发光（串接在 WP3 的 LampField 补丁之后）', () => {
  it('r186 的 Lambert 与 Basic 着色器里要替换的片段都在', () => {
    expect(THREE.ShaderChunk.color_vertex).toContain(INSTANCE_COLOR_LINE);
    const lam = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    expect(patchNpcShader(lam, true)).toBe(true);
    expect(lam.vertexShader).toContain('attribute vec3 aHw');
    expect(lam.vertexShader).toContain('mix( vec3( 1.0 ), instanceColor.rgb, aHw.z )');
    expect(lam.vertexShader).not.toContain(INSTANCE_COLOR_LINE);
    expect(lam.fragmentShader).toContain('totalEmissiveRadiance += vHwGlow');
    const bas = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    expect(patchNpcShader(bas, false)).toBe(true);
  });

  it('保留原有的 onBeforeCompile（例如 LampField），缓存键带上本补丁标签', () => {
    const m = new THREE.MeshLambertMaterial();
    let called = 0;
    m.onBeforeCompile = (sh) => { called++; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n// lamp'); };
    m.customProgramCacheKey = () => 'hwLampField';
    applyNpcPatch(m, true);
    const sh = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as never);
    expect(called).toBe(1);
    expect(sh.vertexShader).toContain('// lamp');
    expect(sh.vertexShader).toContain('aHw');
    expect(m.customProgramCacheKey()).toBe(`hwLampField|${NPC_PROGRAM_KEY}L`);
  });

  it('PartBuilder：变体号、着色、自发光写进 aHw；变体包围盒只算自己的顶点', () => {
    const b = new PartBuilder();
    b.box([0, 0, 0], [1, 1, 1], 0xffffff);
    b.variant(0, () => b.with({ tint: 1 }, () => b.box([5, 0, 0], [1, 1, 1], 0xffffff)));
    b.variant(1, () => b.with({ glow: 1 }, () => b.box([-5, 0, 0], [1, 1, 1], 0xffffff)));
    const g = b.build();
    const hw = g.getAttribute('aHw');
    expect(hw.count).toBe(36 * 3);
    expect(hw.getX(0)).toBe(-1);
    expect(hw.getX(36)).toBe(0); expect(hw.getZ(36)).toBe(1);
    expect(hw.getX(72)).toBe(1); expect(hw.getY(72)).toBe(1);
    expect(variantBounds(g, 0).max.x).toBeCloseTo(5.5);
    expect(variantBounds(g, 1).min.x).toBeCloseTo(-5.5);
    expect(variantBounds(g, 1).max.x).toBeCloseTo(0.5);
  });
});

describe('人群展开（npcs 组 → 路边的人）', () => {
  const ch = compile(getChapter('ch1') as ChapterDef);
  it('确定性：同一章同一种子，展开结果完全相同', () => {
    const a = expandChapter(ch.seed, ch.segments), b = expandChapter(ch.seed, ch.segments);
    expect(a.decor.map((d) => [d.s, d.x, d.yaw])).toEqual(b.decor.map((d) => [d.s, d.x, d.yaw]));
    expect(a.decor.length).toBeGreaterThan(40);
  });
  it('路边的人都站在车道外（不遮挡任何车道，不参与碰撞）', () => {
    const { decor } = expandChapter(ch.seed, ch.segments);
    for (const d of decor) expect(Math.abs(d.x)).toBeGreaterThanOrEqual(1.52);
    for (const kit of ['corridor', 'classroom', 'canteen', 'street', 'plaza', 'track'] as const) expect(bandOf(kit)[0]).toBeGreaterThanOrEqual(1.52);
  });
  it('第一章：1-1 两侧坐着的同学、1-2 两处站着的人，鞋尖会转向（gaze: turnShoes）', () => {
    const { decor, groups } = expandChapter(ch.seed, ch.segments);
    const g = (id: string) => groups.findIndex((x) => x.def.id === id);
    expect(decor.filter((d) => d.group === g('class7') && d.pose === 'seat').length).toBeGreaterThan(20);
    expect(decor.filter((d) => d.group === g('eyes')).every((d) => d.gaze === 'turnShoes')).toBe(true);
  });
  it('各种组都能展开，密度 0 时一个人也没有', () => {
    const kinds = ['seatedRow', 'standingCluster', 'walkers', 'queue', 'lineSides', 'onlookerRing', 'imitators', 'crawlerStream', 'classmates'] as const;
    for (const kind of kinds) {
      for (const density of [0, 1]) {
        const seg = { index: 0, s0: 0, stride: 1, def: { id: 's', kit: 'canteen' }, npcGroups: [{ id: 'g', kind, from: 0, to: 30, side: 'both', density }] } as unknown as CompiledSegment;
        const out: Decor[] = [], gi: GroupInfo[] = [];
        expandSegment(3, seg, out, gi);
        if (density === 0) expect(out.length, kind).toBe(0); else expect(out.length, kind).toBeGreaterThan(3);
      }
    }
  });
});

describe('特殊 NPC 识别（按数据里的 id）', () => {
  const ob = (kind: CompiledObstacle['kind'], itemId?: string, behavior: CompiledObstacle['behavior'] = { type: 'static' }): CompiledObstacle => ({
    id: 1, kind, cls: 'block', archetype: 'legs', lanes: [0], beat: 0, s0: 0, s1: 0.3, y0: 0, y1: 1.7, halfW: 0.26, behavior, npc: true, params: itemId ? { itemId } : {},
  });
  it('Speaker 名与常见别名', () => {
    expect(specialById('directorZhou')).toBe('directorZhou');
    expect(specialById('zhou')).toBe('directorZhou');
    expect(specialById('teacherMa')).toBe('teacherMa');
    expect(specialById('monitor')).toBe('monitor');
    expect(specialById('chenmoFoot')).toBe('chenMo');
    expect(specialById('girls')).toBeNull();
  });
  it('障碍：陈默、周主任（也认 street.schoolGate 里带 id 的人腿）、马老师、梦里的男生', () => {
    expect(specialOfObstacle(ob('chenMo'), 'corridor', 'morning')).toBe('chenMo');
    expect(specialOfObstacle(ob('legs', 'directorZhou'), 'street', 'schoolGate')).toBe('directorZhou');
    expect(specialOfObstacle(ob('legs', 'zhu'), 'street', 'schoolGate')).toBe('directorZhou');
    expect(specialOfObstacle(ob('legs'), 'street', 'schoolGate')).toBeNull();
    expect(specialOfObstacle(ob('legs', 'teacherMa'), 'track', 'default')).toBe('teacherMa');
    expect(specialOfObstacle(ob('kneeler', undefined, { type: 'fallInto', atBeat: 3 }), 'plaza', 'bright')).toBe('dreamBoy');
  });
});

describe('注册（§8.2 规则 3、§8.7）', () => {
  it('ViewSystem「npc」归 WP6；18 个原型都注册了；crowd cue 的处理者是 WP6；调试扩展', () => {
    const v = getViewSystems().find((s) => s.id === 'npc');
    expect(v?.owner).toBe('WP6');
    for (const id of ['footOut', 'lowBox', 'bucket', 'curb', 'bikeDown', 'kneeler', 'tableBar', 'chairBar', 'armBar', 'shutter', 'legs', 'cart', 'column', 'vehicle', 'stallDoor', 'crawler', 'floorDecal', 'note'] as const) {
      expect(getArchetype(id)?.id).toBe(id);
    }
    expect(getCueHandler('crowd')?.owner).toBe('WP6');
    const ext = getDebugExt();
    for (const k of ['npcStage', 'npcHitbox', 'npcStats', 'npcCrowd', 'npcAsk', 'npcHit']) expect(typeof ext[k]).toBe('function');
    // 调试扩展在非调试模式下拒绝改状态
    expect(() => (ext.npcStage as (n: string) => unknown)('forest')).toThrow('debug disabled');
  });
  it('契约工厂：legs / crawler 由 LegForest / Crawlers 负责，create() 也能独立使用', () => {
    const ctx = fakeCtx('low');
    for (const id of ['legs', 'crawler', 'lowBox'] as const) {
      const pool = getArchetype(id)?.create(ctx, 8);
      expect(pool?.object).toBeInstanceOf(THREE.Object3D);
      const o: CompiledObstacle = { id: 3, kind: id === 'legs' ? 'legs' : id === 'crawler' ? 'crawler' : 'bag', cls: 'block', archetype: id, lanes: [1], beat: 4, s0: 4, s1: 4.3, y0: 0, y1: 1, halfW: 0.3, behavior: { type: 'static' }, npc: false, params: {} };
      pool?.place(0, o, 0.5);
      let n = 0;
      pool?.object.traverse((x) => { if ((x as THREE.InstancedMesh).isInstancedMesh) n += (x as THREE.InstancedMesh).count; });
      expect(n, id).toBeGreaterThan(0);
    }
  });
});

describe('契约 ArchetypePool 的槽位语义（legs / crawler 的独立工厂）', () => {
  it('place × 3 → hide(1)：只去掉槽位 1，其余两个按各自 place 时的 t 留着', () => {
    const ctx = fakeCtx('low');
    for (const id of ['legs', 'crawler'] as const) {
      const pool = getArchetype(id)?.create(ctx, 8);
      expect(pool).toBeDefined();
      if (!pool) continue;
      const ob = (n: number, lane: -1 | 0 | 1): CompiledObstacle => ({
        id: n, kind: id, cls: 'block', archetype: id, lanes: [lane], beat: 4, s0: 4, s1: 4.3, y0: 0, y1: 1, halfW: 0.3,
        behavior: { type: 'walk', speed: 2 }, npc: true, params: {},
      });
      // 低画质下普通人的髋在 npc:hipsLow 里（特殊人物在 npc:special）
      const meshName = id === 'legs' ? 'npc:hipsLow' : 'crawler:body';
      const people = () => {
        const out: Array<{ x: number; z: number }> = [];
        pool.object.traverse((o) => {
          const m = o as THREE.InstancedMesh;
          if (!m.isInstancedMesh || m.name !== meshName) return;
          const mat = new THREE.Matrix4(), v = new THREE.Vector3();
          for (let i = 0; i < m.count; i++) {
            m.getMatrixAt(i, mat); v.setFromMatrixPosition(mat);
            // legs 的髋部件每人两个实例（胯 + 垂着的手），位置相同：去重
            if (!out.some((q) => Math.abs(q.x - v.x) < 1e-6 && Math.abs(q.z - v.z) < 1e-6)) out.push({ x: v.x, z: v.z });
          }
        });
        return out.sort((a, b) => a.x - b.x);
      };
      pool.place(0, ob(0, -1), 0);
      pool.place(1, ob(1, 0), 1);
      pool.place(2, ob(2, 1), 2);
      expect(people().map((p) => Math.round(p.x * 10) / 10), id).toEqual([-1.1, 0, 1.1]);
      const before = people();
      pool.hide(1);
      const after = people();
      expect(after.map((p) => Math.round(p.x * 10) / 10), id).toEqual([-1.1, 1.1]);
      // 留下的两个位置不变（各自的 t：0 与 2，walk 2 m/s → 沿 s 差 4 m）
      expect(after[0]?.z).toBeCloseTo(before[0]?.z ?? NaN, 6);
      expect(after[1]?.z).toBeCloseTo(before[2]?.z ?? NaN, 6);
      expect((after[0]?.z ?? 0) - (after[1]?.z ?? 0)).toBeCloseTo(4, 1);
      pool.hide(0); pool.hide(2);
      expect(people().length).toBe(0);
    }
  });
});

describe('更新耗时（验收 2：40 个可见 NPC ≤ 1 ms / 帧）', () => {
  it('LegForest：40 人（高画质，全部部件）平均每帧 < 1 ms', () => {
    const ctx = fakeCtx('high');
    const f = new LegForest(); f.init(ctx);
    const look = lookFor('student', 1, 'perf');
    const p = newPerson(look);
    const frame = (k: number) => {
      f.begin();
      for (let i = 0; i < 40; i++) {
        p.x = (i % 2 ? 1 : -1) * 1.6; p.z = -i * 0.8; p.yaw = i * 0.3 + k * 0.01;
        p.hipL = Math.sin(k * 0.1 + i) * 0.38; p.hipR = -p.hipL; p.kneeL = 0.3; p.kneeR = 0.1;
        p.footYawL = 0.5; p.upper = i % 3 === 0; p.clap = (k + i) % 2 ? 1 : 2;
        f.add(p);
      }
      f.end();
    };
    for (let k = 0; k < 50; k++) frame(k);
    const t0 = performance.now();
    const N = 400;
    for (let k = 0; k < N; k++) frame(k);
    const ms = (performance.now() - t0) / N;
    expect(ms).toBeLessThan(1);
  });
});
