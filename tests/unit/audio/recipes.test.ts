// tests/unit/audio/recipes.test.ts —— 配方的离线渲染（DESIGN.md §8.10 WP7 验收 1、2；§6.2；lead 补充 1、2）。WP7。
// 每个配方都在 OfflineAudioContext（Node 里是 offline/mini.ts 的规范实现）上真实渲染：不是静音、没有 NaN、峰值 ≤ −8 dBFS；
// 异常类声音的起音 ≥ 150 ms；三段落地声的音色结构（「短促、干脆」「像有人在空房间里鼓掌」）。
import { beforeAll, describe, expect, it } from 'vitest';
import { applauseLoop } from '../../../src/audio/library';
import { dbToGain, hasNonFinite, peakAbs, rmsOf } from '../../../src/audio/dsp';
import { allPalmKeys, palmKeyString, palmRecipe, PALM_VARIANTS, PALM_PEAK, SURFACES, partsOf } from '../../../src/audio/recipes/palm';
import { allOneShots, SFX } from '../../../src/audio/recipes/sfx';
import { LIMITS } from '../../../src/core/constants';
import { SR, library, make, toDb } from './lib';
import { bedReport, centroid, palmScenario, recipeReport, type PalmReport } from './scenarios';

type Lib = Awaited<ReturnType<typeof library>>;
let lib: Lib;
beforeAll(async () => { lib = await library(); }, 60_000);

describe('验收 1：每个一次性配方离线渲染', () => {
  it('库覆盖：自己和追随者各一套「表面 × 部位 × 4 个变体」，掌根另有撑跃落地版；全部音效', () => {
    for (const k of allPalmKeys()) {
      const bufs = lib.palms.get(palmKeyString(k));
      expect(bufs?.length, palmKeyString(k)).toBe(PALM_VARIANTS);
    }
    for (const voice of ['self', 'follower'] as const) {
      for (const s of SURFACES) for (const p of partsOf(s)) expect(lib.palms.has(`${voice}:${s}:${p}`)).toBe(true);
    }
    for (const r of allOneShots()) expect(lib.sfx.get(r.key)?.length, r.key).toBe(r.variants);
    expect(allPalmKeys().length).toBeGreaterThan(50);
  });

  it('不是静音、没有 NaN、峰值 ≤ −8 dBFS 并等于配方表的电平', () => {
    const rows = recipeReport(lib, SR);
    expect(rows.length).toBe(lib.info.length);
    for (const r of rows) {
      const id = `${r.key}#${r.variant}`;
      expect(r.nonFinite, id).toBe(false);
      expect(r.rawPeakDb, id).toBeGreaterThan(-80);                 // 归一之前就有实在的信号
      expect(r.targetDb, id).toBeLessThanOrEqual(LIMITS.peakDbfs);
      expect(r.peakDb, id).toBeLessThanOrEqual(LIMITS.peakDbfs);
      expect(Math.abs(r.peakDb - r.targetDb), id).toBeLessThan(0.05);
    }
    // 每个缓冲的 RMS 都远高于噪底（不只是一个尖峰）
    for (const [key, bufs] of [...lib.palms, ...lib.sfx]) {
      for (const b of bufs) {
        const chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
        expect(toDb(rmsOf(chs)), key).toBeGreaterThan(toDb(peakAbs(chs)) - 40);
      }
    }
  });

  it('同一个键的 4 个变体彼此不同（随机化：滤波频率 ±6%、噪声起点）', () => {
    const b = lib.palms.get('self:terrazzo:heel') as AudioBuffer[];
    const a0 = b[0]?.getChannelData(0) as Float32Array, a1 = b[1]?.getChannelData(0) as Float32Array;
    let diff = 0;
    for (let i = 0; i < Math.min(a0.length, a1.length); i++) diff += Math.abs((a0[i] as number) - (a1[i] as number));
    expect(diff).toBeGreaterThan(1);
  });

  it('自己的三段峰值：掌根 −12、指节 −15、指腹 −17 dBFS；追随者低 6 dB；床单 −30、空中 −32', () => {
    expect(palmRecipe({ voice: 'self', surface: 'terrazzo', part: 'heel', heavy: false })?.peakDb).toBe(PALM_PEAK.heel);
    expect(palmRecipe({ voice: 'self', surface: 'terrazzo', part: 'knuckle', heavy: false })?.peakDb).toBe(-15);
    expect(palmRecipe({ voice: 'self', surface: 'terrazzo', part: 'pad', heavy: false })?.peakDb).toBe(-17);
    expect(palmRecipe({ voice: 'follower', surface: 'terrazzo', part: 'heel', heavy: false })?.peakDb).toBe(-18);
    expect(palmRecipe({ voice: 'self', surface: 'sheet', part: 'pad', heavy: false })?.peakDb).toBe(-30);
    expect(palmRecipe({ voice: 'self', surface: 'air', part: 'pad', heavy: false })?.peakDb).toBe(-32);
    expect(palmRecipe({ voice: 'self', surface: 'sheet', part: 'heel', heavy: false })).toBeNull();
  });
});

describe('验收 1：环境音、雨、嗡鸣、梦中掌声', () => {
  let beds: Awaited<ReturnType<typeof bedReport>>;
  beforeAll(async () => { beds = await bedReport(make, SR, lib); }, 60_000);

  it('全部 15 种环境音、雨、嗡鸣：不是静音、没有 NaN、峰值 ≤ −8 dBFS', () => {
    expect(beds.length).toBe(17);
    for (const b of beds) {
      expect(b.nonFinite, b.id).toBe(false);
      expect(b.rmsDb, b.id).toBeGreaterThan(-60);
      expect(b.peakDb, b.id).toBeLessThanOrEqual(LIMITS.peakDbfs);
    }
  });

  it('电平接近配方表：房间底噪 −42、雨 −24、嗡鸣（三层合计）约 −35 dBFS', () => {
    const at = (id: string) => (beds.find((b) => b.id === id) as { rmsDb: number }).rmsDb;
    expect(Math.abs(at('ambience:room') + 42)).toBeLessThan(2);
    expect(Math.abs(at('rain:1') + 24)).toBeLessThan(2);
    expect(Math.abs(at('hum:1') + 35)).toBeLessThan(2);
    expect(at('ambience:void')).toBeLessThan(at('ambience:room'));         // 虚空走廊几乎没有底噪
    expect(at('ambience:canteen')).toBeGreaterThan(at('ambience:reading')); // 食堂比早读更满
  });

  it('梦中掌声的三个循环：峰值 −14 dBFS、没有 NaN、首尾可无缝循环', () => {
    for (const k of ['sparse', 'dense', 'aligned'] as const) {
      const [l, r] = applauseLoop(k, SR, 4);
      expect(hasNonFinite([l, r])).toBe(false);
      expect(toDb(peakAbs([l, r]))).toBeCloseTo(-14, 1);
      const jump = Math.abs((l[0] as number) - (l[l.length - 1] as number));
      expect(jump).toBeLessThan(dbToGain(-14) * 0.5);
    }
  });
});

describe('验收 2：异常类声音的起音 ≥ 150 ms（只做减法，没有 stinger）', () => {
  it('嘘、玻璃触碰、风、心跳（外加低语）标为异常，渲染出来的起音 ≥ 150 ms', () => {
    const rows = recipeReport(lib, SR).filter((r) => r.anomaly);
    const keys = new Set(rows.map((r) => r.key));
    for (const k of ['shush', 'glassTouch', 'wind', 'heartbeat', 'whisper']) expect(keys.has(k), k).toBe(true);
    for (const r of rows) expect(r.attackMs as number, r.key).toBeGreaterThanOrEqual(LIMITS.anomalyAttackMs);
  });
  it('异常类声音都不响：峰值 ≤ −20 dBFS（远低于自己的掌根）', () => {
    for (const k of ['shush', 'glassTouch', 'wind', 'heartbeat', 'whisper'] as const) expect(SFX[k].peakDb, k).toBeLessThanOrEqual(-20);
  });
});

describe('lead 补充 1：三段落地声「短促、干脆、像有人在空房间里鼓掌」', () => {
  let rep: PalmReport;
  beforeAll(async () => { rep = await palmScenario(make, SR, lib); }, 60_000);

  it('干声：掌根低沉（质心 < 300 Hz，九成能量在 600 Hz 以下），指节 2–3.5 kHz 的硬「咔」，指腹 2–4.5 kHz 的「啪」', () => {
    const p = (part: string) => rep.parts.find((x) => x.part === part) as PalmReport['parts'][number];
    expect(p('heel').centroidHz).toBeLessThan(300);
    expect(p('heel').lowShare).toBeGreaterThan(0.9);
    expect(p('knuckle').centroidHz).toBeGreaterThan(2000);
    expect(p('knuckle').centroidHz).toBeLessThan(3500);
    expect(p('pad').centroidHz).toBeGreaterThan(2000);
    expect(p('pad').centroidHz).toBeLessThan(4500);
    expect(p('knuckle').lowShare).toBeLessThan(0.1);
  });
  it('干脆：干声从峰值落到 −40 dB 很快（掌根 < 150 ms、指节 < 50 ms、指腹 < 100 ms）', () => {
    const p = (part: string) => rep.parts.find((x) => x.part === part) as PalmReport['parts'][number];
    expect(p('heel').t40Ms).toBeLessThan(150);
    expect(p('knuckle').t40Ms).toBeLessThan(50);
    expect(p('pad').t40Ms).toBeLessThan(100);
  });
  it('依次：三段的起点在 0 / 26 / 52 ms（误差 < 2 ms），听得出三下而不是糊成一下', () => {
    const [h, k, d] = rep.onsetsMs as [number, number, number];
    expect(Math.abs(k - h - 26)).toBeLessThan(2);
    expect(Math.abs(d - h - 52)).toBeLessThan(2);
  });
  it('空房间：走廊混响的尾巴听得见（尾巴 / 直达在 −12 到 +3 dB 之间），衰减到 −60 dB 约 1.2–1.6 s', () => {
    expect(rep.tailDb).toBeGreaterThan(-12);
    expect(rep.tailDb).toBeLessThan(3);
    expect(rep.t60Ms).toBeGreaterThan(900);
    expect(rep.t60Ms).toBeLessThan(1800);
  });
  it('追随者「更轻，更脆，像某种更干燥的骨头」：掌根没有正弦（低频占比更低），指节更亮', () => {
    // 4 个变体的平均谱质心（每个变体的滤波频率有 ±6% 的随机化）
    const c = (key: string) => {
      const bufs = lib.palms.get(key) as AudioBuffer[];
      return bufs.reduce((a, b) => a + centroid(b.getChannelData(0), SR), 0) / bufs.length;
    };
    expect(c('follower:terrazzo:knuckle')).toBeGreaterThan(c('self:terrazzo:knuckle') * 1.12);
    expect(c('follower:terrazzo:pad')).toBeGreaterThan(c('self:terrazzo:pad') * 1.12);
    expect(c('follower:terrazzo:heel')).toBeGreaterThan(c('self:terrazzo:heel') * 1.5);
  });
});
