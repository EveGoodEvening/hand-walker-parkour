// tests/unit/outside/kits.test.ts —— WP4 户外 kit（DESIGN.md §5.9、§8.10 WP4 验收 1、附录 A-9）。
import { describe, expect, it } from 'vitest';
import type { KitChunk } from '../../../src/core/contracts';
import { getKit } from '../../../src/core/registry';
import type { KitId } from '../../../src/core/types';
import { C, hsv, isWarm } from '../../../src/render/kits/outside/lib/colors';
import { triCount } from '../../../src/render/kits/outside/lib/geo';
import { HALF, ROOM_DEPTH } from '../../../src/render/kits/outside/lib/kit';
import '../../../src/render/kits/outside/plaza';
import { crowdInner, waterStart } from '../../../src/render/kits/outside/plaza';
import {
  ambienceSpan, barrierS, gateSpan, graffitiCenter, obstacleSpan, shedSpan, streetKit,
} from '../../../src/render/kits/outside/street';
import { TRACK_LINES } from '../../../src/render/kits/outside/track';
import { TIERS, chunkContexts, kitAtmosphere, mirror, obstacle, screenColors, segment, vertexColors } from './helpers';

const TRI_MAX = { low: 6000, medium: 9000, high: 12000 } as const;

/** 每个变体一段合成数据：让按数据摆放的陈设都出现。 */
function sampleSegment(kit: KitId, variant: string) {
  const s0 = 100, stride = kit === 'plaza' ? 1.4 : kit === 'track' ? 1.0 : 1.1;
  const at = (b: number) => s0 + b * stride;
  switch (`${kit}.${variant}`) {
    case 'street.schoolGate': return segment({ kit, variant, s0, stride, beats: 64, obstacles: [obstacle('gateBar', at(36)), obstacle('gateBar', at(42))] });
    case 'street.alley': return segment({ kit, variant, s0, stride, beats: 100, events: [
      { at: 40, body: { type: 'ambience', amb: 'shedRoof', level: 1, seconds: 1 } }, { at: 80, body: { type: 'ambience', amb: 'rainStreet', level: 1, seconds: 1 } }] });
    case 'street.shopStreet': return segment({ kit, variant, s0, stride, beats: 90, events: [{ at: 64, id: 'graffitiHand', body: { type: 'text', line: 'c1.card' } }] });
    case 'street.compound': return segment({ kit, variant, s0, stride, beats: 36, obstacles: [obstacle('barrierArm', at(18))] });
    case 'street.dawn': return segment({ kit, variant, s0, stride, beats: 80, obstacles: [obstacle('barrierArm', at(10))] });
    case 'plaza.gray': return segment({ kit, variant, s0, stride, beats: 60, surfaces: [mirror('bigMirror', 'R', at(30), at(38), [0.1, 2.6])] });
    default: return segment({ kit, variant, s0, stride, beats: 60 });
  }
}

function buildAll(kit: KitId, variant: string, tier: 'low' | 'medium' | 'high'): Array<{ ctx: ReturnType<typeof chunkContexts>[number]; chunk: KitChunk }> {
  const k = getKit(kit);
  if (!k) throw new Error('kit missing');
  const seg = sampleSegment(kit, variant);
  return chunkContexts(seg, tier).map((ctx) => ({ ctx, chunk: k.build(ctx) }));
}

/** DESIGN.md §8.5 的 KIT_VARIANTS（户外三个 kit）。照抄设计文档，不 import WP2 的 levels/kitSymbols.ts（§8.2 规则 2）。 */
const KIT_VARIANTS = {
  street: ['schoolGate', 'alley', 'shopStreet', 'compound', 'dawn'], plaza: ['bright', 'gray'], track: ['default'],
} as const satisfies Partial<Record<KitId, readonly string[]>>;
const OUTDOOR: Array<[KitId, string]> = (['street', 'plaza', 'track'] as const).flatMap((k) => KIT_VARIANTS[k].map((v) => [k, v] as [KitId, string]));

describe('户外 kit 注册（§5.9、§8.4 KIT_VARIANTS）', () => {
  it('street / plaza / track 由 WP4 注册，变体与 KIT_VARIANTS 一致', () => {
    for (const k of ['street', 'plaza', 'track'] as const) {
      const kit = getKit(k);
      expect(kit?.id).toBe(k);
      expect(kit?.owner).toBe('WP4');
      expect([...(kit?.variants ?? [])].sort()).toEqual([...KIT_VARIANTS[k]].sort());
    }
    expect(getKit('street')?.ambience('dawn')).toBe('dawnStreet');
    expect(getKit('street')?.ambience('alley')).toBe('rainStreet');
    expect(getKit('plaza')?.reverb('bright')).toBe('plaza');
    expect(getKit('track')?.ambience('default')).toBe('field');
  });
});

describe('每个 chunk ≤ 3 次 draw call、三角形在预算内（§8.10 WP4 验收 1、§9.4）', () => {
  for (const [kit, variant] of OUTDOOR) {
    for (const tier of TIERS) {
      it(`${kit}.${variant} @${tier}`, () => {
        const built = buildAll(kit, variant, tier);
        expect(built.length).toBeGreaterThan(2);
        for (const { ctx, chunk } of built) {
          const geos = [chunk.floor, chunk.static, chunk.emissive].filter(Boolean);
          expect(geos.length).toBeLessThanOrEqual(3);
          const tris = geos.reduce((n, g) => n + triCount(g), 0);
          expect(tris).toBeLessThanOrEqual(TRI_MAX[tier]);
          for (const g of geos) {
            const p = g!.getAttribute('position');
            for (let i = 0; i < p.count; i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
            expect(g!.getAttribute('aChalk')).toBeTruthy();
          }
          for (const l of chunk.lamps) { expect(l.s).toBeGreaterThanOrEqual(ctx.s0 - 1e-6); expect(l.s).toBeLessThan(ctx.s1 + 1e-6); }
        }
      });
    }
  }
});

describe('确定性与 chunk 独立', () => {
  it('同样的输入 → 同样的几何体', () => {
    for (const [kit, variant] of OUTDOOR) {
      const a = buildAll(kit, variant, 'medium'), b = buildAll(kit, variant, 'medium');
      a.forEach((x, i) => {
        const pa = x.chunk.static.getAttribute('position').array, pb = b[i]!.chunk.static.getAttribute('position').array;
        expect(pa.length).toBe(pb.length);
        expect(Array.from(pa.slice(0, 300))).toEqual(Array.from(pb.slice(0, 300)));
      });
    }
  });
  it('地面层（不写深度）全在 y ≤ 0.01（户外 kit 没有楼梯）', () => {
    for (const [kit, variant] of OUTDOOR) for (const { chunk } of buildAll(kit, variant, 'low')) {
      const p = chunk.floor.getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThanOrEqual(0.011);
    }
  });
});

/** 一个 chunk 在画面上的全部颜色（floor / static 按 Lambert 受光，emissive 按 Basic；§5.1 是画面上的颜色）。 */
function onScreen(kit: KitId, variant: string, chunk: KitChunk): number[] {
  const a = kitAtmosphere(kit, variant);
  return [...screenColors(chunk.floor, a, 'lambert'), ...screenColors(chunk.static, a, 'lambert'), ...screenColors(chunk.emissive, a, 'basic')];
}

describe('色彩克制（附录 A-9、§5.1）', () => {
  const allowedWarm = (hex: number, extra: number[]) => {
    const h = hsv(hex).h;
    return [C.lampGold, C.barrierRed, ...extra].some((a) => Math.abs(((hsv(a).h - h + 540) % 360) - 180) < 14);
  };
  it('第三章的街：暖色只有路灯碎金与栏杆红灯', () => {
    for (const v of ['schoolGate', 'alley', 'shopStreet', 'compound']) for (const tier of TIERS) {
      for (const { chunk } of buildAll('street', v, tier)) for (const g of [chunk.floor, chunk.static, chunk.emissive]) {
        for (const c of vertexColors(g)) if (isWarm(c)) expect(allowedWarm(c, []), `${v} ${c.toString(16)}`).toBe(true);
      }
    }
  });
  it('只有 compound 有栏杆红灯（schoolGate / alley / shopStreet 没有红色）', () => {
    const redIn = (v: string) => buildAll('street', v, 'low').some(({ chunk }) => vertexColors(chunk.emissive).some((c) => isWarm(c) && hsv(c).h < 20 || hsv(c).h > 340 && isWarm(c)));
    expect(redIn('compound')).toBe(true);
    for (const v of ['schoolGate', 'alley', 'shopStreet', 'dawn']) expect(redIn(v)).toBe(false);
  });
  it('第五章清晨（dawn）在画面上没有任何暖色：栏杆灯不亮、路灯是冷白', () => {
    for (const tier of TIERS) for (const { chunk } of buildAll('street', 'dawn', tier)) {
      for (const c of onScreen('street', 'dawn', chunk)) expect(isWarm(c), c.toString(16)).toBe(false);
    }
  });
  it('梦中广场在画面上发白、几乎没有颜色（饱和度 < 0.12，人群也是；段尾的水是 §5.1 的冷灰蓝 #5D6B73，饱和度 < 0.22）', () => {
    for (const v of ['bright', 'gray']) for (const { chunk } of buildAll('plaza', v, 'high')) {
      for (const c of onScreen('plaza', v, chunk)) {
        const { h, s } = hsv(c);
        expect(s < 0.12 || (s < 0.22 && h > 180 && h < 240), c.toString(16)).toBe(true);
      }
    }
  });
  it('操场在画面上唯一的暖色是跑道本身（§5.1 跑道色），而且不比色板更饱和', () => {
    for (const { chunk } of buildAll('track', 'default', 'medium')) for (const c of onScreen('track', 'default', chunk)) {
      if (!isWarm(c)) continue;
      expect(Math.abs(hsv(c).h - hsv(C.track).h)).toBeLessThan(10);
      expect(hsv(c).s).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('墙上开口与镜中房间（§5.8）', () => {
  it('广场大镜子：x = +1.8 的平面上，开口范围内没有三角形；洞后面有深 3.8 m 的房间', () => {
    const built = buildAll('plaza', 'gray', 'low');
    const seg = built[0]!.ctx.seg;
    const o = seg.surfaces[0]!;
    let behind = 0;
    for (const { ctx, chunk } of built) {
      for (const g of [chunk.floor, chunk.static, chunk.emissive]) {
        if (!g) continue;
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i += 3) {
          const xs = [p.getX(i), p.getX(i + 1), p.getX(i + 2)];
          const ys = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
          const ss = [p.getZ(i), p.getZ(i + 1), p.getZ(i + 2)].map((z) => ctx.s0 - z);
          if (xs.every((x) => Math.abs(x - HALF) < 1e-3)) {
            const cy = (ys[0]! + ys[1]! + ys[2]!) / 3, cs = (ss[0]! + ss[1]! + ss[2]!) / 3;
            const inside = cs > o.s0 + 0.01 && cs < o.s1 - 0.01 && cy > o.y![0] + 0.01 && cy < o.y![1] - 0.01;
            expect(inside).toBe(false);
          }
          if (xs.every((x) => Math.abs(x - (HALF + ROOM_DEPTH)) < 1e-3)) behind++;
        }
      }
    }
    expect(behind).toBeGreaterThan(0);
  });
  it('街道一侧有开口时（例如 3-6 的窗）同样留洞', () => {
    const k = getKit('street')!;
    const seg = segment({ kit: 'street', variant: 'shopStreet', beats: 40, surfaces: [mirror('shopWin', 'L', 110, 116, [0.4, 2.0], 'nightStreet')] });
    let wallTris = 0, hole = 0;
    for (const ctx of chunkContexts(seg, 'low')) {
      const g = k.build(ctx).static, p = g.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        if (![0, 1, 2].every((j) => Math.abs(p.getX(i + j) + HALF) < 1e-3)) continue;
        wallTris++;
        const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cs = ctx.s0 - (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        if (cs > 110.05 && cs < 115.95 && cy > 0.45 && cy < 1.95) hole++;
      }
    }
    expect(wallTris).toBeGreaterThan(0);
    expect(hole).toBe(0);
  });
});

describe('按关卡数据摆放的陈设（§4.3、§4.5）', () => {
  it('校门跟着 gateBar；车棚跟着 shedRoof；涂鸦跟着 graffitiHand；栏杆跟着 barrierArm；数据缺失时按 §4 的拍号', () => {
    const g = sampleSegment('street', 'schoolGate');
    expect(gateSpan(g)).toEqual([g.s0 + 36 * 1.1, g.s0 + 42 * 1.1]);
    expect(gateSpan(segment({ kit: 'street', variant: 'schoolGate', stride: 1 }))).toEqual([100 + 36, 100 + 42]);
    const a = sampleSegment('street', 'alley');
    expect(ambienceSpan(a, 'shedRoof')).toEqual([40, 80]);
    expect(shedSpan(a)).toEqual([a.s0 + 40 * 1.1, a.s0 + 80 * 1.1]);
    expect(shedSpan(segment({ kit: 'street', variant: 'alley', obstacles: [obstacle('bikeRack', 150)] }))[0]).toBeCloseTo(146);
    const sh = sampleSegment('street', 'shopStreet');
    expect(graffitiCenter(sh)).toBeCloseTo(sh.s0 + 66 * 1.1);
    expect(graffitiCenter(segment({ kit: 'street', variant: 'shopStreet' }))).toBeCloseTo(100 + 66 * 1.1);
    expect(barrierS(sampleSegment('street', 'compound'), 99)).toBeCloseTo(100 + 18 * 1.1);
    expect(barrierS(segment({ kit: 'street', variant: 'compound', stride: 1 }), 18)).toBe(118);
    expect(obstacleSpan(sh, ['gateBar'])).toBeNull();
  });
  it('校门立柱落在 gateBar 前后 0.8 m（x = ±2.3）', () => {
    const built = buildAll('street', 'schoolGate', 'low');
    const [gA] = gateSpan(built[0]!.ctx.seg);
    let found = false;
    for (const { ctx, chunk } of built) {
      const p = chunk.static.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - 2.61) < 0.02 && Math.abs(ctx.s0 - p.getZ(i) - (gA - 0.8)) < 0.35 && p.getY(i) > 2.5) found = true;
    }
    expect(found).toBe(true);
  });
  it('isSpecial：含校门 / 车棚 / 涂鸦 / 门卫室 / 公交站的 chunk 不能当通用变体复用', () => {
    const g = sampleSegment('street', 'schoolGate');
    const [gA] = gateSpan(g);
    expect(streetKit.isSpecial(g, gA - 6, gA + 6)).toBe(true);
    expect(streetKit.isSpecial(g, g.s0, g.s0 + 12)).toBe(false);
    const d = sampleSegment('street', 'dawn');
    expect(streetKit.isSpecial(d, d.s1 - 12, d.s1)).toBe(true);
  });
  it('广场：gray 的段尾是水；人群围成一个接一个的弧；操场白线落在车道分界上', () => {
    const seg = sampleSegment('plaza', 'gray');
    expect(waterStart(seg)).toBeCloseTo(seg.s1 - 5);
    const last = buildAll('plaza', 'gray', 'low').at(-1)!;
    const p = last.chunk.floor.getAttribute('position');
    let water = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.02) water++;
    expect(water).toBeGreaterThan(0);
    const inner = Array.from({ length: 60 }, (_, i) => crowdInner(i, 1, false));
    expect(Math.max(...inner) - Math.min(...inner)).toBeGreaterThan(3);
    expect(Math.min(...inner)).toBeGreaterThan(HALF + 1);
    expect(TRACK_LINES).toContain(0.55);
    expect(TRACK_LINES).toContain(-0.55);
    expect(TRACK_LINES).toContain(1.65);
  });
});
