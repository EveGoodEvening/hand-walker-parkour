// tests/unit/audio/units.test.ts —— 声音包的纯逻辑（DESIGN.md §2.6 追随者表、§6.1、§6.2）。WP7。
// 不渲染：追随者映射、时钟换算、门、声部池、地点表、cue 命名、声控灯 / 闪烁模型、滤波系数、脉冲响应、软削波曲线。
import { describe, expect, it } from 'vitest';
import { SimClock } from '../../../src/audio/clock';
import { CueLog, cueNames } from '../../../src/audio/cueLog';
import { biquadCoefs, biquadMagnitude, dbToGain, impulseResponse, qDb } from '../../../src/audio/dsp';
import { followerMix, mixKey } from '../../../src/audio/follower';
import { LightModel } from '../../../src/audio/lights';
import { CEIL_DB, Gate, KNEE_DB, safetyCurve, volumeGain } from '../../../src/audio/mixer';
import { KIT_PLACES, SET_PLACES, REVERB_RT60, placeKnown, placeOf, soundStateAt } from '../../../src/audio/places';
import { FOLLOWER_BASE_DB } from '../../../src/audio/recipes/palm';
import { MAX_VOICES, VoicePool, type Voice } from '../../../src/audio/voices';
import { AHEAD_DISTANCE, FOLLOWER_MIX, LAG_BEATS } from '../../../src/core/constants';
import type { GameEvent } from '../../../src/core/events';
import type { FollowerMode, FollowerSnap, KitId, ReverbId, SetId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import { KIT_VARIANTS } from '../../../src/levels/kitSymbols';
import type { ChapterDef } from '../../../src/levels/schema';
import { MiniContext } from './offline/mini';
import { snap } from './scenarios';

const fol = (mode: FollowerMode, o: Partial<FollowerSnap> = {}): FollowerSnap => ({
  mode, voice: mode === 'hidden' || mode === 'absent' ? 'none' : 'echo', hud: 'dots', from: 'behind', lagBeats: 0, distance: 0,
  leaderS: null, leaderLane: null, ...o,
});

describe('追随者的声音映射（§2.6：六个通道里的四个声音通道 + 相位差）', () => {
  it('behind：稳度 3 → 0 时更响、更亮、更窄、更干；数值与 FOLLOWER_MIX 一致（库本身低 6 dB，总线补回）', () => {
    const rows = [3, 2, 1, 0].map((s) => followerMix(fol('behind', { lagBeats: LAG_BEATS.behind[s] }), s));
    for (const [i, s] of [3, 2, 1, 0].entries()) {
      const r = rows[i] as ReturnType<typeof followerMix>, t = FOLLOWER_MIX[s] as (typeof FOLLOWER_MIX)[number];
      expect(r.audible).toBe(true);
      expect(r.gainDb).toBeCloseTo(t.gainDb - FOLLOWER_BASE_DB, 6);
      expect(r.lowpass).toBe(t.lowpass);
      expect(r.panWidth).toBe(t.panWidth);
      expect(r.reverb).toBe(t.reverb);
    }
    for (let i = 1; i < 4; i++) {
      const a = rows[i - 1] as ReturnType<typeof followerMix>, b = rows[i] as ReturnType<typeof followerMix>;
      expect(b.gainDb).toBeGreaterThan(a.gainDb);
      expect(b.lowpass).toBeGreaterThan(a.lowpass);
      expect(b.panWidth).toBeLessThan(a.panWidth);
      expect(b.reverb).toBeLessThan(a.reverb);
      expect(LAG_BEATS.behind[3 - i] as number).toBeLessThan(LAG_BEATS.behind[4 - i] as number);   // 相位差：0.5 → 0
    }
    // 稳度 3 → 0 的总跨度：电平 +11 dB，低通 ×4
    expect((rows[3] as { gainDb: number }).gainDb - (rows[0] as { gainDb: number }).gainDb).toBeCloseTo(11, 6);
  });

  it('pressure 与 behind 同表；稳度变化必然换键（触发 300 ms 滑变）', () => {
    const keys = new Set([3, 2, 1, 0].map((s) => mixKey(followerMix(fol('pressure'), s))));
    expect(keys.size).toBe(4);
    expect(followerMix(fol('pressure'), 2)).toEqual(followerMix(fol('behind'), 2));
  });

  it('hidden / absent / voice none（5-3 影子的爬行没有声音）都不出声', () => {
    expect(followerMix(fol('hidden'), 3).audible).toBe(false);
    expect(followerMix(fol('absent'), 0).audible).toBe(false);
    expect(followerMix(fol('pressure', { voice: 'none' }), 0).audible).toBe(false);
    expect(mixKey(followerMix(fol('hidden'), 3))).toBe('off');
  });

  it('synced（第四章）：增益、低通不随稳度变，越低越散（声像变宽）', () => {
    const r = [3, 2, 1, 0].map((s) => followerMix(fol('synced'), s));
    expect(new Set(r.map((x) => x.gainDb)).size).toBe(1);
    expect(new Set(r.map((x) => x.lowpass)).size).toBe(1);
    expect((r[0] as { gainDb: number }).gainDb).toBeCloseTo(-10 - FOLLOWER_BASE_DB, 6);
    for (let i = 1; i < 4; i++) expect((r[i] as { panWidth: number }).panWidth).toBeGreaterThan((r[i - 1] as { panWidth: number }).panWidth);
  });

  it('ahead（第五章）：偏亮、声像几乎居中；越远越轻，永远不比 3 m 更近', () => {
    const r = [3, 2, 1, 0].map((s) => followerMix(fol('ahead', { distance: AHEAD_DISTANCE[s] as number, lagBeats: -0.25, from: 'front' }), s));
    for (const x of r) { expect(x.lowpass).toBeGreaterThanOrEqual(8000); expect(x.panWidth).toBeLessThanOrEqual(0.05); }
    for (let i = 1; i < 4; i++) expect((r[i] as { gainDb: number }).gainDb).toBeLessThan((r[i - 1] as { gainDb: number }).gainDb);
    expect(followerMix(fol('ahead', { distance: 1 }), 3).gainDb).toBe(followerMix(fol('ahead', { distance: 3 }), 3).gainDb);
  });

  it('3-2 楼梯 lagOverride = 1：从上方传来，闷、湿、居中', () => {
    const m = followerMix(fol('behind', { lagBeats: 1 }), 3);
    expect(m.audible).toBe(true);
    expect(m.panWidth).toBe(0);
    expect(m.reverb).toBeGreaterThan(0.6);
    expect(m.lowpass).toBeLessThanOrEqual(3000);
  });
});

describe('SimClock（§6.1 调度：按模拟时间戳换算，提前约 50 ms）', () => {
  it('第一次换算对齐到「现在 + 50 ms」，之后保持同一偏移（同一组声音的相对时间精确）', () => {
    const c = new SimClock();
    expect(c.toAudio(10, 2)).toBeCloseTo(2.05, 12);
    expect(c.toAudio(10.026, 2.001)).toBeCloseTo(2.076, 12);
    expect(c.toAudio(10.2, 2.1)).toBeCloseTo(2.25, 12);
    expect(c.reanchors).toBe(1);
  });
  it('事件会排到过去（音频时钟跑到了前面）或太早时重新对齐', () => {
    const c = new SimClock();
    c.toAudio(0, 0);
    expect(c.toAudio(0.1, 0.2)).toBeCloseTo(0.25, 12);      // 0.1 + 0.05 = 0.15 < 0.2 + minLead
    expect(c.reanchors).toBe(2);
    expect(c.toAudio(5, 0.3)).toBeCloseTo(0.35, 12);        // 太早（> maxLead）
    expect(c.reanchors).toBe(3);
  });
  it('帧检查：漂移超过 120 ms 才重新对齐；peek 不改变偏移', () => {
    const c = new SimClock();
    c.toAudio(0, 0);
    c.track(1, 1.1);
    expect(c.offset).toBeCloseTo(0.05, 12);
    c.track(1, 1.2);
    expect(c.offset).toBeCloseTo(0.25, 12);
    const before = c.reanchors;
    expect(c.peek(2, 0)).toBeCloseTo(2.25, 12);
    expect(c.reanchors).toBe(before);
  });
});

describe('Gate（门：若干个带起止时间的增益之积，只用 setTargetAtTime 排程）', () => {
  const mk = () => new MiniContext(1, 128, 8000).createGain().gain as unknown as AudioParam & { valueAt(t: number): number };
  it('压下、保持、恢复；门之间相乘', () => {
    const p = mk();
    const g = new Gate(p);
    g.set('a', 0, 1, 2, 0.01, 0.05, 0);
    g.set('b', 0.5, 0, 3, 0.01, 0.05, 0);
    expect(p.valueAt(0.5)).toBeCloseTo(0.5, 3);
    expect(p.valueAt(1.2)).toBeLessThan(1e-4);
    expect(p.valueAt(2.6)).toBeCloseTo(0.5, 3);
    expect(p.valueAt(3.6)).toBeCloseTo(1, 3);
    expect(g.target(1.5)).toBe(0);
  });
  it('clear 提前结束一个门，之后连续恢复', () => {
    const p = mk();
    const g = new Gate(p);
    g.set('h', 0, 0, Infinity, 0.035, 0.3, 0);
    expect(p.valueAt(0.3)).toBeLessThan(dbToGain(-70));
    g.clear('h', 1, 0.1, 0.5);
    expect(p.valueAt(0.9)).toBeLessThan(dbToGain(-70));
    expect(p.valueAt(1.6)).toBeGreaterThan(0.99);
    expect(g.has('h')).toBe(true);
  });
});

describe('VoicePool（§6.1：同时发声上限 32，抢占最老、最轻的声部）', () => {
  const stub = () => ({ src: { stop() { /* 测试桩 */ } } as unknown as AudioScheduledSourceNode, g: new MiniContext(1, 128, 8000).createGain() as unknown as GainNode });
  it('乱序到达的事件（抖动、提前排程的颗粒）也不会让任何时刻超过上限', () => {
    const pool = new VoicePool();
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 600; i++) {
      const now = i * 0.002;
      const at = now + rnd() * 0.35;
      const prio = i % 7 === 0 ? 0 : i % 3 === 0 ? 1 : 2;
      if (!pool.admit(now, at, prio)) continue;
      const len = 0.05 + rnd() * 0.4;
      pool.add({ ...stub(), start: at, end: at + len, peak: rnd(), tau: 0.05, prio } as Voice);
    }
    for (let t = 0; t < 1.6; t += 0.001) expect(pool.activeAt(t)).toBeLessThanOrEqual(MAX_VOICES);
    expect(pool.maxSeen).toBeLessThanOrEqual(MAX_VOICES);
    expect(pool.stolen).toBeGreaterThan(0);
  });
  it('满了：环境颗粒直接放弃；普通声音不能抢自己的掌声', () => {
    const pool = new VoicePool(2);
    pool.add({ ...stub(), start: 0, end: 1, peak: 1, tau: 1, prio: 2 } as Voice);
    pool.add({ ...stub(), start: 0, end: 1, peak: 1, tau: 1, prio: 2 } as Voice);
    expect(pool.admit(0, 0.1, 0)).toBe(false);
    expect(pool.admit(0, 0.1, 1)).toBe(false);
    expect(pool.admit(0, 0.1, 2)).toBe(true);
    expect(pool.dropped).toBe(2);
  });
});

describe('地点表（§6.1 混响表、§8.10「各 kit 和 set 的环境音」）', () => {
  it('混响衰减时间与 §6.1 一致', () => {
    expect(REVERB_RT60).toEqual({ corridor: 1.2, classroom: 0.7, washroom: 0.9, stairwell: 1.8, canteen: 1.1, street: 0.4, bus: 0.3,
      bathroom: 0.7, plaza: 3.0, infirmary: 0.5, void: 4.0 });
  });
  it('每个 kit 变体、每个 set 都有地点（声音设计表收录，不靠回落）', () => {
    for (const [kit, vs] of Object.entries(KIT_VARIANTS)) for (const v of vs) expect(placeKnown('kit', kit as KitId, v), `${kit}.${v}`).toBe(true);
    const sets: SetId[] = ['deskFeet', 'counter', 'canteenWindow', 'labBoard', 'bus', 'home', 'bathroom', 'palmEye', 'water', 'bedroom', 'infirmary', 'placeholder'];
    for (const s of sets) expect(placeKnown('set', s, 'anything'), s).toBe(true);
    const reverbs = new Set(Object.keys(REVERB_RT60));
    for (const p of [...Object.values(KIT_PLACES), ...Object.values(SET_PLACES)]) expect(reverbs.has(p.reverb as ReverbId)).toBe(true);
  });
  it('第一章：地点、环境音与雨按段重建（读档 / 重来用）', () => {
    const def = getChapter('ch1') as ChapterDef;
    const idx = (id: string) => def.segments.findIndex((s) => s.id === id);
    expect(placeOf(def.segments[idx('1-1')] as ChapterDef['segments'][number]).reverb).toBe('classroom');
    expect(placeOf(def.segments[idx('1-2')] as ChapterDef['segments'][number]).reverb).toBe('corridor');
    expect(placeOf(def.segments[idx('1-3')] as ChapterDef['segments'][number]).reverb).toBe('washroom');
    expect(soundStateAt(def, idx('1-1'), 0)?.ambience.amb).toBe('reading');
    expect(soundStateAt(def, idx('1-4'), 4.0)?.ambience.amb).toBe('reading');
    expect(soundStateAt(def, idx('1-4'), 5.0)?.ambience.amb).toBe('room');          // 4.6 s：早读结束，人走光
    expect(soundStateAt(def, idx('1-6'), 10)?.ambience.amb).toBe('room');
    expect(soundStateAt(def, idx('1-6'), 10)?.rain).toBe(0);
  });
});

describe('cue 命名（静音与出声两种实现共用，§8.8 __game.cues()）', () => {
  const E = (type: string, data: unknown) => ({ type, tick: 0, data }) as GameEvent;
  it('触地、追随者、受击、摔倒、回头、站立', () => {
    expect(cueNames(E('contact', { part: 'heel', heavy: false }))).toEqual(['palm:heel']);
    expect(cueNames(E('contact', { part: 'pad', heavy: true }))).toEqual(['land:pad']);
    expect(cueNames(E('followerContact', { part: 'knuckle' }))).toEqual(['follower:knuckle']);
    expect(cueNames(E('hit', { severity: 'stumble', crowd: true }))).toEqual(['hit:stumble', 'quietSecond']);
    expect(cueNames(E('fall', {}))).toEqual(['kneeThud']);
    expect(cueNames(E('lookBack', { phase: 'start' }))).toEqual(['followerSilence']);
    expect(cueNames(E('stand', { phase: 'step' }))).toEqual(['step']);
    expect(cueNames(E('steady', { value: 2 }))).toEqual([]);
  });
  it('环形日志只保留最近的', () => {
    const l = new CueLog(3, 3);
    for (const n of ['a', 'b', 'c', 'd']) l.record(n);
    expect(l.recent(10)).toEqual(['b', 'c', 'd']);
    expect(l.recent(1)).toEqual(['d']);
  });
  it('一章跑完（每掌六条掌声 cue）之后，章首的铃、音效、环境 cue 仍然读得到；顺序按发生先后', () => {
    const l = new CueLog();
    l.record('ambience:reading'); l.record('bell:morning');
    for (let i = 0; i < 3000; i++) { l.record('palm:heel'); l.record('follower:heel'); if (i === 1500) l.record('sfx:heels'); }
    l.record('hush');
    const all = l.recent(5000);
    expect(all.slice(0, 3)).toEqual(['ambience:reading', 'bell:morning', 'sfx:heels']);
    expect(all.length).toBe(3 + 1024);
    expect(all[all.length - 1]).toBe('hush');
    expect(l.recent(3)).toEqual(['palm:heel', 'follower:heel', 'hush']);
  });
});

describe('LightModel（嗡鸣跟随的灯光；没有 WP3 的 LampField 时自己估）', () => {
  it('闪烁：任意 1 s 内亮灭 ≤ 3 次（附录 A-10）', () => {
    const m = new LightModel();
    m.onCue({ type: 'lights', op: 'flicker', from: 0, to: 400, every: 0.5 }, snap({ t: 0, segBeat: 0 }));
    const dips: number[] = [];
    let prev = 1;
    for (let i = 0; i < 120 * 20; i++) {
      const t = i / 120;
      const b = m.brightness(snap({ t, segBeat: t * 5.4 }));
      if (b < 0.5 && prev >= 0.5) dips.push(t);
      prev = b;
    }
    expect(dips.length).toBeGreaterThan(20);
    for (let i = 3; i < dips.length; i++) expect((dips[i] as number) - (dips[i - 3] as number)).toBeGreaterThanOrEqual(1);
  });
  it('「减少闪烁」打开：flicker 区间不再闪（嗡鸣和「咔」跟着不闪）', () => {
    const m = new LightModel();
    m.reducedFlicker = true;
    m.onCue({ type: 'lights', op: 'flicker', from: 0, to: 400, every: 0.5 }, snap({ t: 0, segBeat: 0 }));
    for (let i = 0; i < 120 * 5; i++) expect(m.brightness(snap({ t: i / 120, segBeat: (i / 120) * 5.4 }))).toBe(1);
  });
  it('声控灯：拍地后亮 4 s；第五章晚 0.5 s', () => {
    const m = new LightModel();
    m.onCue({ type: 'lights', op: 'sound', from: 0, to: 100 }, snap({ t: 0, segBeat: 0 }));
    expect(m.brightness(snap({ t: 1, segBeat: 5 }))).toBe(0);
    expect(m.trigger(snap({ t: 1, segBeat: 5 }))).toBe(true);
    expect(m.brightness(snap({ t: 1.1, segBeat: 5.5 }))).toBe(1);
    expect(m.brightness(snap({ t: 5.1, segBeat: 25 }))).toBe(0);
  });
});

describe('DSP', () => {
  it('双二阶系数：lowpass 在截止频率处 −3 dB（Q 以 dB 计），bandpass 中心 0 dB，highshelf 高频 +gain', () => {
    const sr = 48000;
    expect(biquadMagnitude(biquadCoefs('lowpass', 1000, qDb(Math.SQRT1_2), 0, sr), 1000, sr)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(biquadMagnitude(biquadCoefs('bandpass', 2200, 3, 0, sr), 2200, sr)).toBeCloseTo(1, 6);
    expect(20 * Math.log10(biquadMagnitude(biquadCoefs('highshelf', 2500, 0, 2, sr), 15000, sr))).toBeCloseTo(2, 1);
  });
  it('脉冲响应：RT60 与表一致（Schroeder 反向积分，−5 到 −35 dB 拟合）', () => {
    const sr = 16000;
    for (const [id, rt] of Object.entries(REVERB_RT60)) {
      const [l, r] = impulseResponse(rt, sr, 3 + id.length);
      const e = new Float64Array(l.length);
      let acc = 0;
      for (let i = l.length - 1; i >= 0; i--) { acc += (l[i] as number) ** 2 + (r[i] as number) ** 2; e[i] = acc; }
      const dB = (i: number) => 10 * Math.log10((e[i] as number) / (e[0] as number));
      let i5 = 0, i35 = 0;
      while (dB(i5) > -5) i5++;
      i35 = i5;
      while (i35 < l.length - 1 && dB(i35) > -35) i35++;
      const measured = (60 * ((i35 - i5) / sr)) / 30;
      expect(measured, id).toBeGreaterThan(rt * 0.8);
      expect(measured, id).toBeLessThan(rt * 1.2);
    }
  });
  it('软削波曲线：拐点以下逐点为恒等，整条曲线单调且不超过 −8.1 dBFS', () => {
    const c = safetyCurve();
    const n = c.length, T = dbToGain(KNEE_DB), C = dbToGain(CEIL_DB);
    let max = 0;
    for (let i = 0; i < n; i++) {
      const x = (2 * i) / (n - 1) - 1, y = c[i] as number;
      if (Math.abs(x) <= T) expect(Math.abs(y - x)).toBeLessThan(1e-6);
      if (i > 0) expect(y).toBeGreaterThanOrEqual(c[i - 1] as number);
      max = Math.max(max, Math.abs(y));
    }
    expect(max).toBeLessThanOrEqual(C + 1e-7);
    expect(20 * Math.log10(max)).toBeLessThanOrEqual(-8);
  });
  it('音量曲线：(v / 100)^1.5', () => {
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(0)).toBe(0);
    expect(20 * Math.log10(volumeGain(50))).toBeCloseTo(-9.03, 1);
  });
});
