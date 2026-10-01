// tests/unit/audio/engine.test.ts —— 整个声音引擎的离线渲染（DESIGN.md §8.10 WP7 验收 3、4、5、7；§2.6、§2.7、§6.1；lead 补充）。WP7。
// 引擎在 OfflineAudioContext 上建出完整的总线图（门、两组混响、压缩器、限幅器、软削波），按模拟时间喂事件，渲染后测量。
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../../src/core/constants';
import { SR, library, make, paramAt, toDb } from './lib';
import { rmsOf } from '../../../src/audio/dsp';
import { renderOffline } from '../../../src/audio/library';
import {
  CROWD_CHAPTER, DREAM_CHAPTER, applauseScenario, behind, chainLatency, crowdScenario, engineFor, ev, followerScenario, hushFallScenario, hushScenario,
  hushSfxScenario, kneeScenario, peakScenario, perfScenario, quietScenario, snap, tickUp, timingScenario, voicesScenario,
  type ApplauseOrder, type ApplauseReport, type CrowdReport, type TimingReport,
} from './scenarios';
import { Ambience } from '../../../src/audio/ambience';
import { AudioEngine } from '../../../src/audio/Engine';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef } from '../../../src/levels/schema';

type Lib = Awaited<ReturnType<typeof library>>;
let lib: Lib;
beforeAll(async () => { lib = await library(); }, 60_000);

describe('验收 3：时间误差（三段声 < 2 ms，追随者 ≤ 5 ms）', () => {
  let rep: TimingReport;
  beforeAll(async () => { rep = await timingScenario(make, SR, lib); }, 60_000);

  it('渲染出来的每个声音都落在引擎排程的时刻（< 2 ms）', () => {
    expect(rep.rows.length).toBe(24);
    for (const r of rep.rows) expect(Math.abs(r.measured - r.logged) * 1000, `${r.key}#${r.triple}`).toBeLessThan(2);
  });
  it('干脆的掌：三段都严格落在模拟时间戳上（< 2 ms）', () => {
    for (const r of rep.rows.filter((x) => x.kind === 'self' && x.crisp)) expect(Math.abs(r.measured - r.nominal) * 1000, r.key).toBeLessThan(2);
  });
  it('不干脆的掌：整掌随机平移 ≤ 4 ms，三段之间的 26 / 52 ms 间隔仍 < 2 ms', () => {
    for (const tri of [1, 3]) {
      const rs = rep.rows.filter((x) => x.kind === 'self' && x.triple === tri);
      const h = rs.find((x) => x.part === 'heel') as TimingReport['rows'][number];
      for (const r of rs) {
        expect(Math.abs(r.measured - r.nominal) * 1000).toBeLessThanOrEqual(4 + 2);
        expect(Math.abs((r.measured - h.measured) - (r.nominal - h.nominal)) * 1000, r.key).toBeLessThan(2);
      }
    }
  });
  it('追随者：落在「自己的触地 + 相位差」上（≤ 5 ms）', () => {
    for (const r of rep.rows.filter((x) => x.kind === 'follower')) {
      expect(Math.abs(r.measured - r.nominal) * 1000, r.key).toBeLessThanOrEqual(5);
      const self = rep.rows.find((x) => x.kind === 'self' && x.triple === r.triple && x.part === r.part) as TimingReport['rows'][number];
      if (self.crisp) expect(Math.abs((r.measured - self.measured) - rep.lagSec) * 1000).toBeLessThanOrEqual(5);
    }
  });
});

describe('验收 4：静音段与「安静的一秒」', () => {
  it('静音段开始 0.3 s 后：环境、追随者、NPC（连同它们的混响）总线 ≤ −60 dB，输出几乎为零', async () => {
    const r = await hushScenario(make, SR, lib);
    const g = r.gatesDb as Record<string, number>;
    for (const b of ['ambience', 'floor', 'follower', 'npc', 'revB']) expect(g[b], b).toBeLessThanOrEqual(-60);
    expect(r.preDb).toBeGreaterThan(-45);                      // 之前确实在响
    expect(r.postDb).toBeLessThan(r.preDb - 60);
  }, 60_000);
  it('只保留自己的掌声（自己的总线和混响不受影响）', async () => {
    const r = await hushScenario(make, SR, lib, true);
    const g = r.gatesDb as Record<string, number>;
    expect(g.self).toBeCloseTo(0, 3);
    expect(g.revA).toBeCloseTo(0, 3);
    expect(Math.abs(r.postDb - r.preDb)).toBeLessThan(2);
  }, 60_000);
  it('人群段绊倒：环境总线 60 ms 内掐断（≤ −60 dB），停 1 s，再用 600 ms 恢复', async () => {
    const r = await quietScenario(make, SR, lib);
    expect(r.gateAt60Db as number).toBeLessThanOrEqual(-60);
    expect(r.preDb).toBeGreaterThan(-50);
    expect(r.edgeDb).toBeLessThan(r.preDb - 60);
    expect(r.cutDb).toBeLessThan(r.preDb - 60);
    expect(Math.abs(r.recoverDb - r.preDb)).toBeLessThan(3);
  }, 60_000);
});

describe('验收 5：同时发声 ≤ 32', () => {
  it('0.3 s 内塞进 90 个触地、30 个音效和一场大雨：声部池与渲染出来的同时发声都 ≤ 32', async () => {
    const r = await voicesScenario(make, SR, lib);
    expect(r.requested).toBeGreaterThan(100);
    expect(r.maxSeen).toBeLessThanOrEqual(32);
    expect(r.renderedMax as number).toBeLessThanOrEqual(32);
    expect(r.stolen).toBeGreaterThan(0);
  }, 60_000);
});

describe('验收 7：主线程开销', () => {
  it('20 s 第三章式负载（5.4 掌/s + 追随者 + 食堂 + 雨）：每帧平均 < 1 ms', async () => {
    const r = await perfScenario(make, SR, lib, 20);
    expect(r.frames).toBeGreaterThan(1000);
    expect(r.events).toBeGreaterThan(600);
    expect(r.avgFrameMs).toBeLessThan(1);
  }, 60_000);
});

describe('lead 补充：追随者的逼近听得出来；峰值 ≤ −8 dBFS', () => {
  it('稳度 3 → 0：渲染出来的追随者逐档更响、更亮、更窄、更干（加上模拟的相位差，六个通道里的五个在声音里）', async () => {
    const rows = await followerScenario(make, SR, lib);
    expect(rows.map((r) => r.steady)).toEqual([3, 2, 1, 0]);
    for (let i = 1; i < 4; i++) {
      const a = rows[i - 1] as (typeof rows)[number], b = rows[i] as (typeof rows)[number];
      expect(b.rmsDb - a.rmsDb, `rms ${a.steady}→${b.steady}`).toBeGreaterThan(1.5);
      expect(b.brightDb, `bright ${a.steady}→${b.steady}`).toBeGreaterThan(a.brightDb);
      expect(b.widthDb, `width ${a.steady}→${b.steady}`).toBeLessThan(a.widthDb - 2);
      expect(b.tailDb, `tail ${a.steady}→${b.steady}`).toBeLessThan(a.tailDb - 2);
      expect(b.lagBeats).toBeLessThan(a.lagBeats);
    }
    expect((rows[3] as { rmsDb: number }).rmsDb - (rows[0] as { rmsDb: number }).rmsDb).toBeGreaterThan(8);
  }, 60_000);

  it('最坏情况（三个音量 100、所有总线同时最响、摔倒）：整个输出的峰值 ≤ −8 dBFS，没有 NaN', async () => {
    const r = await peakScenario(make, SR, lib);
    expect(r.nonFinite).toBe(false);
    expect(r.peakDb).toBeLessThanOrEqual(LIMITS.peakDbfs);
    expect(r.rmsDb).toBeGreaterThan(-40);
  }, 60_000);
});

describe('事件 → 声音（§2.7、§3、§8.7 中 WP7 的部分）', () => {
  const run = async (dur = 2) => engineFor(make, SR, dur, lib);

  it('绊：缺指节，加擦地声', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    e.onEvent(ev('hit', { severity: 'stumble', kind: 'bag', obstacleId: 1, lane: 0, steady: 2, crowd: false, firstLegHit: false }, 0.5), snap({ t: 0.5 }));
    for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
      const t = 0.55 + off;
      e.onEvent(ev('contact', { hand: 'L', part, t, s: 0, x: 0, surface: 'terrazzo', crisp: false, heavy: false }, t), snap({ t: tickUp(t) }));
    }
    const keys = e.scheduled.map((x) => x.key);
    expect(keys).toContain('scrape');
    expect(keys).toContain('self:terrazzo:heel');
    expect(keys).toContain('self:terrazzo:pad');
    expect(keys).not.toContain('self:terrazzo:knuckle');
  });

  it('摔倒：膝盖闷响（不淡出）、两串节拍合一、环境 60 ms 掐断、其余 0.3 s 淡出；重来后恢复', async () => {
    const { e } = await run(3);
    const fol = behind(0.33);
    e.frame(snap({ t: 0, follower: fol, steady: 1 }), 0);
    e.onAmbience('reading', 1, 0.05, snap({ t: 0, follower: fol, steady: 1 }));
    e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 1), snap({ t: 1, follower: fol, steady: 0 }));
    const at = 1 + (e.clock.offset as number);
    const keys = e.scheduled.map((x) => `${x.key}@${x.bus}`);
    expect(keys).toContain('kneeThud@floor');
    expect(keys.filter((k) => k.startsWith('follower:') && k.endsWith('@floor')).length).toBeGreaterThanOrEqual(6);
    const m = e.mixer as NonNullable<typeof e.mixer>;
    expect(toDb(paramAt(m.gate('ambience').param, at + 0.06))).toBeLessThanOrEqual(-60);
    for (const b of ['self', 'follower', 'npc', 'sfx', 'revA', 'revB'] as const) expect(toDb(paramAt(m.gate(b).param, at + 0.3)), b).toBeLessThanOrEqual(-60);
    expect(paramAt(m.gate('floor').param, at + 0.3)).toBeCloseTo(1, 3);          // 房间底噪与膝盖闷响保留
    e.onEvent(ev('retry', { segment: 't-1', beat: 0 }, 2), snap({ t: 2 }));
    expect(paramAt(m.gate('self').param, at + 1.6)).toBeGreaterThan(0.95);
    expect(paramAt(m.gate('ambience').param, at + 1.6)).toBeGreaterThan(0.95);
  });

  it('回头：追随者静音 1.2 s', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0, follower: behind(0.5) }), 0);
    e.onEvent(ev('lookBack', { phase: 'start', gain: 1, auto: false }, 0.5), snap({ t: 0.5, follower: behind(0.5) }));
    const at = 0.5 + (e.clock.offset as number);
    const p = (e.mixer as NonNullable<typeof e.mixer>).followerMute.param;
    expect(toDb(paramAt(p, at + 0.15))).toBeLessThanOrEqual(-60);
    expect(toDb(paramAt(p, at + 1.15))).toBeLessThanOrEqual(-60);
    expect(paramAt(p, at + 1.8)).toBeGreaterThan(0.95);
  });

  it('玻璃触碰（2-10）：之后其他总线 −9 dB 持续 2 s', async () => {
    const { e } = await run(4);
    e.frame(snap({ t: 0 }), 0);
    e.onSfx('glassTouch', undefined, undefined, snap({ t: 0.5 }));
    const at = 0.5 + (e.clock.offset as number);
    const m = e.mixer as NonNullable<typeof e.mixer>;
    expect(toDb(paramAt(m.gate('self').param, at + 1.5))).toBeCloseTo(-9, 0);
    expect(toDb(paramAt(m.gate('ambience').param, at + 1.5))).toBeCloseTo(-9, 0);
    expect(paramAt(m.gate('sfx').param, at + 1.5)).toBeCloseTo(1, 3);         // 玻璃声自己不被压
    expect(paramAt(m.gate('self').param, at + 3.6)).toBeGreaterThan(0.95);
  });

  it('追随者混音：稳度换档后 300 ms 内到位（电平、低通、混响三个参数同时滑变）', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0, follower: behind(0.5), steady: 3 }), 0);
    e.frame(snap({ t: 0.5, follower: behind(0), steady: 0 }), 1 / 60);
    const at = 0.5 + (e.clock.offset as number);
    const m = e.mixer as unknown as { folLevel: GainNode; folLp: BiquadFilterNode; folSend: GainNode };
    expect(toDb(paramAt(m.folLevel.gain, at - 0.01))).toBeCloseTo(-12, 0);       // −18 + 6（库低 6 dB）
    expect(toDb(paramAt(m.folLevel.gain, at + 0.3))).toBeGreaterThan(-1 - 0.6);  // → −7 + 6 = −1 dB
    expect(paramAt(m.folLp.frequency, at + 0.3)).toBeGreaterThan(7400);          // 2.0 → 8.0 kHz
    expect(paramAt(m.folSend.gain, at + 0.3)).toBeLessThan(0.23);                // 0.60 → 0.20
    expect(paramAt(m.folSend.gain, at + 0.05)).toBeGreaterThan(0.35);            // 是滑变，不是跳变
  });

  it('结尾卡 / 演职卡：所有声音淡出；回到游玩恢复', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    e.onScreen('outro');
    const m = e.mixer as NonNullable<typeof e.mixer>;
    expect(toDb(paramAt(m.gate('ambience').param, 0.5))).toBeGreaterThan(-20);     // 慢慢淡出，不是掐断
    expect(toDb(paramAt(m.gate('ambience').param, 2))).toBeLessThanOrEqual(-60);
    expect(toDb(paramAt(m.gate('floor').param, 2))).toBeLessThanOrEqual(-60);
    expect(e.menuScreen).toBe(true);
    e.onScreen('play');
    expect(e.menuScreen).toBe(false);
  });

  it('站立（4-3、5-8）：自己的「先轻后重」，第二声 +3 dB、音高 ±5% 颤动', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    for (let i = 1; i <= 7; i++) e.onEvent(ev('stand', { phase: 'step', step: i }, 0.2 + i * 0.1), snap({ t: 0.2 + i * 0.1 }));
    const steps = e.scheduled.filter((x) => x.key === 'stepSelf');
    expect(steps.length).toBe(7);
    expect(new Set(steps.map((x) => x.pan)).size).toBe(2);                     // 左右脚
    const r = (await import('../../../src/audio/recipes/sfx')).SFX;
    expect(r.stepSelf.peakDb - r.stepPair.peakDb).toBe(3);
  });

  it('换地点：两个 Convolver 交叉淡变 0.8 s；环境音换成该地点的缺省（第一章 1-1 教室 → 1-2 走廊 → 1-3 卫生间）', async () => {
    const { e } = await run(4);
    const S = (t: number, segIndex: number) => snap({ t, chapter: 'ch1', segIndex, segBeat: 0 });
    e.frame(S(0, 0), 0);
    e.onEvent(ev('chapter:start', { id: 'ch1' }, 0), S(0, 0));
    e.onEvent(ev('segment', { id: '1-1', index: 0, kind: 'run' }, 0), S(0, 0));
    expect(e.stats().reverb).toBe('classroom');
    expect(e.stats().ambience).toBe('reading');
    e.frame(S(1, 0), 1 / 60);
    e.onEvent(ev('segment', { id: '1-2', index: 1, kind: 'run' }, 1), S(1, 1));
    const at = 1 + (e.clock.offset as number);
    expect(e.stats().reverb).toBe('corridor');
    const slots = (e.mixer as unknown as { revA: { slots: Array<{ g: GainNode; id: string }> } }).revA.slots;
    expect(slots.map((x) => x.id)).toEqual(['classroom', 'corridor']);
    const [oldG, newG] = slots.map((x) => x.g.gain) as [AudioParam, AudioParam];
    expect(paramAt(newG, at + 0.05)).toBeLessThan(0.3);                         // 渐入，不是跳变
    expect(paramAt(oldG, at + 0.05)).toBeGreaterThan(0.7);
    expect(paramAt(newG, at + 0.8)).toBeGreaterThan(0.95);
    expect(paramAt(oldG, at + 0.8)).toBeLessThan(0.05);
    e.frame(S(2, 2), 1 / 60);
    e.onEvent(ev('segment', { id: '1-3', index: 2, kind: 'run' }, 2), S(2, 2));
    e.frame(S(2.1, 2), 1 / 60);
    expect(e.stats().reverb).toBe('washroom');
    expect(e.stats().ambience).toBe('reading');                                  // 隔着墙的早读（电平 0.45）
  });

  it('撑跃落地：整体 +3 dB（随机 ±1.5 dB，单个声部仍 ≤ −9 dBFS）', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    for (let i = 0; i < 6; i++) {
      for (const [part, off] of [['heel', 0], ['knuckle', 0.026], ['pad', 0.052]] as const) {
        const t = 0.2 + i * 0.2 + off;
        e.onEvent(ev('contact', { hand: 'L', part, t, s: 0, x: 0, surface: 'terrazzo', crisp: false, heavy: true }, t), snap({ t: tickUp(t) }));
      }
    }
    const g = (k: string) => e.scheduled.filter((x) => x.key.startsWith(k)).map((x) => x.gainDb);
    for (const v of g('self:terrazzo:heel')) { expect(v).toBeGreaterThanOrEqual(1.5 - 1e-9); expect(v).toBeLessThanOrEqual(3 + 1e-9); }   // 掌根 −12 + 3 = −9 封顶
    for (const v of [...g('self:terrazzo:knuckle'), ...g('self:terrazzo:pad')]) { expect(v).toBeGreaterThanOrEqual(1.5 - 1e-9); expect(v).toBeLessThanOrEqual(4.5 + 1e-9); }
  });

  it('嘘：没有给声像时居中（1-6 端墙镜在正前方、3-4 水洼在中道）；给了就用 cue 的', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    e.onSfx('shush', undefined, undefined, snap({ t: 0.2 }));
    e.onSfx('shush', -0.6, undefined, snap({ t: 0.4 }));
    expect(e.scheduled.filter((x) => x.key === 'shush').map((x) => x.pan)).toEqual([0, -0.6]);
  });

  it('摔倒的膝盖闷响跟「音效」音量：环境音量 0 时照样听得见，音效音量 0 时听不见', async () => {
    const level = async (v: { master: number; sfx: number; ambience: number }) => {
      const { e, ctx } = await engineFor(make, SR, 1.2, lib, {}, v);
      e.frame(snap({ t: 0, follower: behind(0) }), 0);
      e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 0.2), snap({ t: 0.2, follower: behind(0), steady: 0 }));
      expect(e.scheduled.some((x) => x.key === 'kneeThud' && x.bus === 'floor')).toBe(true);
      const out = await renderOffline(ctx);
      const at = (x: number) => Math.floor((x + (e.clock.offset as number)) * SR);
      return toDb(rmsOf([out.getChannelData(0), out.getChannelData(1)], at(0.2), at(0.9)));
    };
    expect(await level({ master: 100, sfx: 100, ambience: 0 })).toBeGreaterThan(-40);
    expect(await level({ master: 100, sfx: 0, ambience: 100 })).toBeLessThan(-90);
  });

  it('cue 日志与静音实现同名（bell / sfx / ambience / silence / hush）', async () => {
    const { e } = await run();
    e.frame(snap({ t: 0 }), 0);
    e.onBell('morning', snap({ t: 0.1 }));
    e.onSfx('shush', undefined, undefined, snap({ t: 0.2 }));
    e.onAmbience('room', 1, 0.5, snap({ t: 0.3 }));
    e.onSilence(1, snap({ t: 0.4 }));
    e.frame(snap({ t: 0.5, hush: true }), 1 / 60);
    expect(e.cues(5)).toEqual(['bell:morning', 'sfx:shush', 'ambience:room', 'silence:1', 'hush']);
    expect(e.stats().errors).toBe(0);
  });
});

describe('§6.2 人群的脚步「先轻后重」（npc 总线；§5.7 walk / silent）', () => {
  let r: CrowdReport;
  beforeAll(async () => { r = await crowdScenario(make, SR, lib); }, 60_000);

  it('进入有 walkers 的段：排出 stepPair，走 npc 总线，间隔 0.47–0.56 s（1.9 ± 0.1 步/s），声像在那一侧（左）', () => {
    const before = r.steps.filter((x) => x.at < r.hitAt);
    expect(before.length).toBeGreaterThanOrEqual(3);
    for (const x of before) { expect(x.bus).toBe('npc'); expect(x.pan).toBeLessThan(-0.2); }
    for (let i = 1; i < before.length; i++) {
      const d = (before[i] as { at: number }).at - (before[i - 1] as { at: number }).at;
      expect(d).toBeGreaterThanOrEqual(0.47);
      expect(d).toBeLessThanOrEqual(0.56);
    }
    // 增益随机 ±10%（约 ±0.9 dB），在这群人中间时是满电平（−3 dB）
    for (const x of before) expect(Math.abs(x.gainDb + 3)).toBeLessThanOrEqual(0.95);
    // 排队的人在 120 拍之外、坐着的人不走路：只有这一路
    expect(new Set(before.map((x) => Math.round(x.pan * 10))).size).toBeLessThanOrEqual(2);
  });

  it('渲染出来听得见，而且是「先轻后重」：轻的一声在前，约 80 ms 后重的一声，重的响得多', () => {
    expect(r.stepsDb).toBeGreaterThan(-60);
    expect(r.heavyDb - r.lightDb).toBeGreaterThan(6);
    expect(r.gapMs).toBeGreaterThan(65);
    expect(r.gapMs).toBeLessThan(105);
  });

  it('人群段绊倒：所有人静止 1 s——不排新的脚步，npc 总线 60 ms 内掐断；之后恢复', () => {
    expect(r.steps.filter((x) => x.at >= r.hitAt && x.at < r.hitAt + 1.06)).toEqual([]);
    expect(r.npcGateDb as number).toBeLessThanOrEqual(-60);
    expect(r.steps.some((x) => x.at >= r.hitAt + 1.06 && x.at < r.hitAt + 2)).toBe(true);
  });

  it('迎面走来的腿（walk 障碍，右道）：走近时出现在右边，越近越响', () => {
    const oncoming = r.steps.filter((x) => x.pan > 0.2);
    expect(oncoming.length).toBeGreaterThanOrEqual(2);
    expect((oncoming[0] as { at: number }).at - r.offset).toBeGreaterThan(3.9);       // 10 拍之外听不见（约 4.1 s 进入）
    expect((oncoming[oncoming.length - 1] as { gainDb: number }).gainDb).toBeGreaterThan((oncoming[0] as { gainDb: number }).gainDb + 3);
  });

  const run = async (def: ChapterDef) => {
    const { e } = await engineFor(make, SR, 8, lib, { chapter: (id) => (id === 'test' ? def : getChapter(id)) });
    return e;
  };

  it('静音段、失败、静场：不排脚步；离开这一段就停', async () => {
    const e = await run(CROWD_CHAPTER);
    const S = (t: number, o: { hush?: boolean } = {}) => snap({ t, segBeat: 2 + t, ...o });
    e.frame(S(0), 0);
    e.onEvent(ev('segment', { id: 'c-1', index: 0, kind: 'run' }, 0), S(0));
    for (let t = 1 / 60; t < 1.5; t += 1 / 60) e.frame(S(t, { hush: true }), 1 / 60);
    expect(e.scheduled.filter((x) => x.key === 'stepPair')).toEqual([]);
    for (let t = 1.5; t < 3; t += 1 / 60) e.frame(S(t), 1 / 60);
    const n = e.scheduled.filter((x) => x.key === 'stepPair').length;
    expect(n).toBeGreaterThanOrEqual(2);
    e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 3), S(3));
    for (let t = 3; t < 4.5; t += 1 / 60) e.frame(S(t), 1 / 60);
    expect(e.scheduled.filter((x) => x.key === 'stepPair').length).toBeLessThanOrEqual(n + 1);   // 至多已经排了的一步
    expect(e.stats().crowd).toBe(4);                                          // 走动的一人 + 排队的两人 + 迎面的腿
    e.onEvent(ev('segment', { id: 'x', index: 5, kind: 'still' }, 4.5), S(4.5));
    expect(e.stats().crowd).toBe(0);
  });

  it('crowd「silent」：只有那一群人静止 1 s', async () => {
    const e = await run(CROWD_CHAPTER);
    const S = (t: number) => snap({ t, segBeat: 2 + t });
    e.frame(S(0), 0);
    e.onEvent(ev('segment', { id: 'c-1', index: 0, kind: 'run' }, 0), S(0));
    for (let t = 1 / 60; t < 1; t += 1 / 60) e.frame(S(t), 1 / 60);
    e.onEvent(ev('cue', { body: { type: 'crowd', group: 'passing', op: 'silent' }, segment: 'c-1' }, 1), S(1));
    const at = 1 + (e.clock.offset as number);
    for (let t = 1; t < 3; t += 1 / 60) e.frame(S(t), 1 / 60);
    const steps = e.scheduled.filter((x) => x.key === 'stepPair');
    expect(steps.filter((x) => x.at >= at + 0.36 && x.at < at + 1)).toEqual([]);     // 已经提前排了的（≤ 0.35 s）之后，一步也没有
    expect(steps.some((x) => x.at >= at + 1)).toBe(true);
  });

  it('排队的人：一阵 2–3 步（步间 0.50–0.556 s），停 1.5 s 以上', async () => {
    const def: ChapterDef = { ...CROWD_CHAPTER, segments: [{ ...(CROWD_CHAPTER.segments[0] as Extract<ChapterDef['segments'][number], { kind: 'run' }>),
      npcs: [{ id: 'q', kind: 'queue', from: 0, to: 80, side: 'R', density: 0.3 }], items: [] }] };
    const e = await run(def);
    const S = (t: number) => snap({ t, segBeat: 2 + t });
    e.frame(S(0), 0);
    e.onEvent(ev('segment', { id: 'c-1', index: 0, kind: 'run' }, 0), S(0));
    for (let t = 1 / 60; t < 7.5; t += 1 / 60) e.frame(S(t), 1 / 60);
    const at = e.scheduled.filter((x) => x.key === 'stepPair').map((x) => x.at);
    expect(at.length).toBeGreaterThanOrEqual(4);
    const gaps = at.slice(1).map((t, i) => t - (at[i] as number));
    for (const g of gaps) expect(g < 0.56 ? g >= 0.5 - 1e-9 : g >= 1.5).toBe(true);
    expect(gaps.some((g) => g >= 1.5)).toBe(true);
  });
});

describe('第 2 轮验收的修复：梦中掌声对齐（§6.2「4-3 被超越时逐渐对齐」）', () => {
  let r: Record<ApplauseOrder, ApplauseReport>;
  beforeAll(async () => {
    r = {
      crowdFirst: await applauseScenario(make, SR, lib, 'crowdFirst'),
      ambienceFirst: await applauseScenario(make, SR, lib, 'ambienceFirst'),
      none: await applauseScenario(make, SR, lib, 'none'),
    };
  }, 120_000);

  it('同一 tick 内先 crowd applaud、后 ambience dreamApplause（4-3 的实际顺序）：状态锁存，掌声对齐', () => {
    expect(r.crowdFirst.applause).toEqual({ density: 1, align: 1 });
    expect(r.ambienceFirst.applause).toEqual({ density: 1, align: 1 });
    expect(r.none.applause).toEqual({ density: 0.5, align: 0 });
  });

  it('渲染出来：两种顺序都是一阵一阵整齐的拍击（0.44 s 周期），缺省的散掌声是平的；电平相近', () => {
    for (const o of ['crowdFirst', 'ambienceFirst'] as const) {
      expect(r[o].pulseDb - r.none.pulseDb, o).toBeGreaterThan(10);
      expect(r[o].periodicity, o).toBeGreaterThan(0.5);
      expect(Math.abs(r[o].rmsDb - r.none.rmsDb), o).toBeLessThan(6);
    }
    expect(r.none.periodicity).toBeLessThan(0.3);
  });

  it('dreamApplause 新建时立即应用锁存的状态：密度当下就变，对齐排在 0.5 s 之后（先散后齐）；两种顺序一样', async () => {
    for (const order of ['crowdFirst', 'ambienceFirst'] as const) {
      const spy = vi.spyOn(Ambience.prototype, 'param');
      try {
        const { e } = await engineFor(make, SR, 2, lib);
        e.frame(snap({ t: 0 }), 0);
        const crowd = () => e.onEvent(ev('cue', { body: { type: 'crowd', group: 'ring2', op: 'applaud' }, segment: 't-1' }, 0.5), snap({ t: 0.5 }));
        if (order === 'crowdFirst') crowd();
        e.onAmbience('dreamApplause', 1, 1.0, snap({ t: 0.5 }));
        if (order === 'ambienceFirst') crowd();
        const from = 0.5 + (e.clock.offset as number);
        const calls = spy.mock.calls.map((c, i) => ({ id: (spy.mock.contexts[i] as Ambience).id, name: c[0], v: c[1], at: c[2] }))
          .filter((c) => c.id === 'dreamApplause' && c.name !== 'rain');
        const last = (name: string) => calls.filter((c) => c.name === name).pop();
        expect(last('density')?.v, order).toBe(1);
        expect(last('density')?.at as number, order).toBeCloseTo(from, 6);
        expect(last('align')?.v, order).toBe(1);
        expect(last('align')?.at as number, order).toBeCloseTo(from + 0.5, 6);
      } finally { spy.mockRestore(); }
    }
  });

  it('章内跨段保持（4-3 人群超过你之后，4-4「新的掌声」也整齐）；跳段时按章节数据重建；换章重置', async () => {
    const { e } = await engineFor(make, SR, 2, lib, { chapter: (id) => (id === 'test' ? DREAM_CHAPTER : getChapter(id)) });
    const S = (t: number, segIndex: number, segBeat: number) => ({ ...snap({ t, segIndex, segBeat }), segKind: 'still' as const });
    e.frame(S(0, 1, 6), 0);
    e.onEvent(ev('chapter:start', { id: 'test' }, 0), S(0, 1, 6));
    e.onEvent(ev('segment', { id: 'd-4', index: 1, kind: 'still' }, 0), S(0, 1, 6));       // 读档：落在 4-4 的掌声中间
    expect(e.stats().ambience).toBe('dreamApplause');
    expect(e.stats().applause).toEqual({ density: 1, align: 1 });
    e.onEvent(ev('chapter:start', { id: 'test' }, 0.5), S(0.5, 0, 0));
    expect(e.stats().applause).toEqual({ density: 0.5, align: 0 });
    // 顺序走：crowd applaud 时环境音还不是掌声，照样锁存
    e.onEvent(ev('segment', { id: 'd-3', index: 0, kind: 'stand' }, 0.5), S(0.5, 0, 0));
    e.onEvent(ev('cue', { body: { type: 'crowd', group: 'ring2', op: 'applaud' }, segment: 'd-3' }, 0.6), S(0.6, 0, 0.1));
    expect(e.stats().ambience).not.toBe('dreamApplause');
    expect(e.stats().applause).toEqual({ density: 1, align: 1 });
  });
});

describe('第 2 轮验收的修复：5-8 第七步的膝盖闷响只响一次', () => {
  it('stand fall 之后下一 tick 的 sfx kneeThud（以及 GameEvent fall 之后的）：只排一次，40–90 Hz 的主体和单独一声一样', async () => {
    const single = await kneeScenario(make, SR, lib, 'cue');
    const stand = await kneeScenario(make, SR, lib, 'standFallThenCue');
    const fall = await kneeScenario(make, SR, lib, 'fallThenCue');
    for (const x of [single, stand, fall]) { expect(x.count).toBe(1); expect(x.buses).toEqual(['floor']); }
    expect(single.lowDb).toBeGreaterThan(-45);
    expect(Math.abs(stand.lowDb - single.lowDb)).toBeLessThan(0.5);
    expect(Math.abs(fall.lowDb - single.lowDb)).toBeLessThan(0.5);
    expect(Math.abs(stand.rmsDb - single.rmsDb)).toBeLessThan(0.5);
  }, 60_000);

  it('相隔 0.1 s 以上的两声各响各的（4-4 跪下的一声、之后的摔倒）', async () => {
    const { e } = await engineFor(make, SR, 2, lib);
    e.frame(snap({ t: 0 }), 0);
    e.onSfx('kneeThud', undefined, undefined, snap({ t: 0.2 }));
    e.onSfx('kneeThud', undefined, undefined, snap({ t: 0.25 }));
    e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 0.6), snap({ t: 0.6 }));
    expect(e.scheduled.filter((x) => x.key === 'kneeThud').length).toBe(2);
  });
});

describe('第 2 轮验收的修复：静音段、界面音、cue 增益、门', () => {
  it('静音段里摔倒：房间底噪已经门掉，膝盖闷响照样听得见；追随者听不见，所以不「合一」', async () => {
    const r = await hushFallScenario(make, SR, lib);
    expect(r.roomPreDb).toBeGreaterThan(-50);
    expect(r.roomHushDb).toBeLessThan(r.roomPreDb - 50);
    expect(r.kneeDb).toBeGreaterThan(-40);
    expect(r.mergedFollower).toBe(0);
    expect(r.floorGateDb as number).toBeLessThanOrEqual(-60);
    expect(r.floorSfxGateDb as number).toBeCloseTo(0, 3);
  }, 60_000);

  it('静音段也门掉音效总线和它的混响发送：铃 0.3 s 内降到 0，只剩房间里已有的尾巴自然衰减；「嘘」与静音段同一刻，照样响', async () => {
    const r = await hushSfxScenario(make, SR, lib);
    expect(r.bellPreDb).toBeGreaterThan(-40);
    expect(r.sfxGateDb as number).toBeLessThanOrEqual(-60);
    expect(r.bellPostDb).toBeLessThan(r.bellRefPostDb - 25);                  // 不进静音段时铃还在响
    expect(r.bellLateDb).toBeLessThan(r.bellPreDb - 55);                      // 1 s 后连尾巴都没了
    expect(r.shushBus).toBe('self');
    expect(r.shushDb).toBeGreaterThan(-50);
  }, 60_000);

  it('挂起时（暂停菜单、失焦）不排界面音——否则恢复的那一刻一齐响出来；cue 照常记录', async () => {
    const { e } = await engineFor(make, SR, 2, lib);
    e.frame(snap({ t: 0 }), 0);
    e.onScreen('pause');
    e.suspend(true);
    e.ui('confirm'); e.ui('move');
    e.suspend(false);
    e.onScreen('title');
    e.background(true);
    e.ui('move');
    e.background(false);
    expect(e.scheduled.filter((x) => x.bus === 'ui')).toEqual([]);
    e.ui('confirm');
    expect(e.scheduled.filter((x) => x.bus === 'ui').length).toBe(1);
    expect(e.cues(4)).toEqual(['ui:confirm', 'ui:move', 'ui:move', 'ui:confirm']);
  });

  it('sfx cue 的 gain 为 0：不出声（不是按满电平放）', async () => {
    const { e } = await engineFor(make, SR, 2, lib);
    e.frame(snap({ t: 0 }), 0);
    e.onSfx('drip', undefined, 0, snap({ t: 0.2 }));
    expect(e.scheduled.filter((x) => x.key === 'drip')).toEqual([]);
    e.onSfx('drip', undefined, 0.5, snap({ t: 0.4 }));
    expect(e.scheduled.filter((x) => x.key === 'drip').map((x) => Math.round(x.gainDb))).toEqual([-6]);
  });

  it('人群段绊倒（安静的一秒）后很快摔倒、5 s 内重来：环境和人群的门都恢复（同一时刻连清两个门）', async () => {
    const { e } = await engineFor(make, SR, 5, lib);
    const S = (t: number) => snap({ t });
    e.frame(S(0), 0);
    e.onAmbience('reading', 1, 0.05, S(0));
    for (let t = 1 / 60; t < 0.5; t += 1 / 60) e.frame(S(t), 1 / 60);
    e.onEvent(ev('hit', { severity: 'stumble', kind: 'legs', obstacleId: 1, lane: 0, steady: 1, crowd: true, firstLegHit: false }, 0.5), S(0.5));
    for (let t = 0.5; t < 1.0; t += 1 / 60) e.frame(S(t), 1 / 60);
    e.onEvent(ev('fall', { cause: 'legs', surface: 'terrazzo' }, 1.0), S(1.0));
    for (let t = 1.0; t < 2.5; t += 1 / 60) e.frame(S(t), 1 / 60);
    e.onEvent(ev('retry', { segment: 't-1', beat: 0 }, 2.5), S(2.5));
    const at = e.now();
    const m = e.mixer as NonNullable<typeof e.mixer>;
    for (const b of ['ambience', 'npc', 'self', 'sfx', 'revA', 'revB'] as const) expect(paramAt(m.gate(b).param, at + 0.6), b).toBeGreaterThan(0.95);
  });

  it('空闲任务（实时模式）：requestIdleCallback 的空闲期不够 10 ms 就等下一个；等满 1.5 s 或超时就照做', async () => {
    type Deadline = { timeRemaining(): number; didTimeout: boolean };
    const g = globalThis as { requestIdleCallback?: unknown };
    const prev = g.requestIdleCallback;
    const cbs: Array<(d: Deadline) => void> = [];
    g.requestIdleCallback = (cb: (d: Deadline) => void) => { cbs.push(cb); return cbs.length; };
    let clock = 0;
    try {
      const e = new AudioEngine({
        createContext: () => make(2, SR, SR) as unknown as BaseAudioContext,
        makeOffline: make, preload: lib, seed: 11, perfNow: () => clock,
      });
      await e.unlock();
      await e.ready;
      const warm = (e as unknown as { warm: unknown[] }).warm;
      const next = (d: Deadline) => { expect(cbs.length).toBe(1); (cbs.shift() as (d: Deadline) => void)(d); };
      expect(warm.length).toBe(3);                                               // 三种噪声缓冲
      next({ timeRemaining: () => 4, didTimeout: false });
      expect(warm.length).toBe(3);                                               // 空闲期太短：等下一个
      next({ timeRemaining: () => 14, didTimeout: false });
      expect(warm.length).toBe(2);
      clock = 2000;
      next({ timeRemaining: () => 1, didTimeout: false });                       // 等了 2 s：照做
      expect(warm.length).toBe(1);
      next({ timeRemaining: () => 0, didTimeout: true });
      expect(warm.length).toBe(0);
      expect(cbs.length).toBe(0);
      expect(e.stats().errors).toBe(0);
    } finally { g.requestIdleCallback = prev; }
  });
});

describe('U3：结尾卡的床单声、回到标题时复位声音', () => {
  it('第四章结尾卡每按一下 ↓（sfx cloth，−4 dB）：屏幕门之后 2.0 / 2.6 / 3.2 s 排在没被门掉的总线上（≥ −6 dB），渲染出来听得见；游玩中照旧走 npc', async () => {
    const { e, ctx } = await engineFor(make, SR, 4.4, lib);
    e.frame(snap({ t: 0 }), 0);
    e.onAmbience('reading', 1, 0.05, snap({ t: 0 }));
    for (let t = 1 / 60; t < 0.5; t += 1 / 60) e.frame(snap({ t }), 1 / 60);
    e.onSfx('cloth', undefined, undefined, snap({ t: 0.5 }));
    expect(e.scheduled[e.scheduled.length - 1]).toMatchObject({ key: 'cloth', bus: 'npc' });
    expect(e.outroTaps).toBe(0);
    e.onScreen('outro');                                   // Game.onChapterEnd → setScreen('outro')
    const m = e.mixer as NonNullable<typeof e.mixer>;
    const rows: Array<(typeof e.scheduled)[number]> = [];
    // 结尾卡上模拟时间停住，音频时间照走（与评审脚本 code/outro-cloth.mts 同样的推进方式）
    for (const k of [2.0, 2.6, 3.2]) {
      e.onSfx('cloth', undefined, Math.pow(10, -4 / 20), snap({ t: 0.5 + k }));   // Game.outroInput：{ sfx: 'cloth', gain: -4 }
      const s = e.scheduled[e.scheduled.length - 1] as (typeof e.scheduled)[number];
      expect(s.key).toBe('cloth');
      expect(toDb(paramAt(m.gate(s.bus).param, s.at + 0.01)), `${k}s ${s.bus}`).toBeGreaterThanOrEqual(-6);
      expect(toDb(paramAt(m.gate('npc').param, s.at + 0.01))).toBeLessThanOrEqual(-60);    // 原来那条总线确实被门掉了
      rows.push(s);
    }
    expect(e.outroTaps).toBe(3);
    const lat = await chainLatency(make, SR);
    const out = await renderOffline(ctx);
    const chs = [out.getChannelData(0), out.getChannelData(1)];
    const win = (a: number, b: number) => toDb(rmsOf(chs, Math.floor((a + lat) * SR), Math.floor((b + lat) * SR)));
    for (const s of rows) {
      expect(win(s.at, s.at + 0.25)).toBeGreaterThan(-60);
      expect(win(s.at, s.at + 0.25)).toBeGreaterThan(win(s.at - 0.3, s.at - 0.05) + 20);
    }
  }, 60_000);
});
