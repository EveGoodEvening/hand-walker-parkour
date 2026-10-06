// tests/unit/core/core.test.ts —— 核心层单元测试（DESIGN.md §8.4、§8.9-2）：rng、hash、bus、loop、quality、settings、save、
// urlParams、CUE_OWNER、registry、cues、surfaces。
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/core/bus';
import { CUE_OWNER, LAG_BEATS, AHEAD_DISTANCE } from '../../../src/core/constants';
import { CueDispatcher } from '../../../src/core/cues';
import { Hasher, hashString } from '../../../src/core/hash';
import { FixedLoop } from '../../../src/core/loop';
import { AutoQuality, QUALITY, resolveQuality } from '../../../src/core/quality';
import { __resetRegistryForTests, getViewSystems, registerCueHandler, registerViewSystem } from '../../../src/core/registry';
import { createRng } from '../../../src/core/rng';
import { createSave, SAVE_KEY } from '../../../src/core/save';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../../src/core/settings';
import { ChapterSurfaces } from '../../../src/core/surfaces';
import { parseUrlParams } from '../../../src/core/urlParams';
import { BONES, BONE_COUNT, BONE_PARENT, createPose } from '../../../src/core/rig';
import { failLineId } from '../../../src/core/Game';
import { compile } from '../../../src/levels/compile';
import ch1 from '../../../src/levels/chapters/ch1';
import type { ChapterDef, EventBody } from '../../../src/levels/schema';

describe('rng', () => {
  it('同种子同序列；fork 互不影响', () => {
    const a = createRng(42), b = createRng(42);
    const xa = Array.from({ length: 10 }, () => a.next()), xb = Array.from({ length: 10 }, () => b.next());
    expect(xa).toEqual(xb);
    for (const x of xa) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    const c = createRng(42), f1 = c.fork('sim');
    const before = c.next();
    const d = createRng(42); d.fork('other'); expect(d.next()).toBe(before);
    expect(f1.next()).not.toBe(createRng(42).fork('fx').next());
    expect(createRng(1).int(5)).toBeLessThan(5);
    expect(() => createRng(1).pick([])).toThrow();
  });
});

describe('hash', () => {
  it('FNV-1a 稳定；数值按 1e-4 四舍五入', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(new Hasher().num(1.00001).digest()).toBe(new Hasher().num(1.00002).digest());
    expect(new Hasher().num(1.0001).digest()).not.toBe(new Hasher().num(1.0002).digest());
    expect(new Hasher().num(NaN).str('x').digest()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('bus', () => {
  it('on / emit / 取消订阅；处理器抛错不影响其他处理器', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('steady', (d) => got.push(d.value));
    bus.on('steady', () => { throw new Error('boom'); });
    const origErr = console.error; console.error = () => {};
    bus.emit('steady', { value: 2, max: 3 });
    off();
    bus.emit('steady', { value: 1, max: 3 });
    console.error = origErr;
    expect(got).toEqual([2]);
  });
});

describe('loop', () => {
  it('120 Hz 累加器；每帧最多追 8 个 tick；dt 上限 0.1 s；manual 只渲染', () => {
    let ticks = 0, frames = 0;
    const loop = new FixedLoop({ tick: () => { ticks++; }, frame: () => { frames++; } });
    loop.frame(0);
    expect(loop.frame(1000 / 60)).toBe(2);           // 16.7 ms → 2 tick
    expect(loop.frame(1000 / 60 + 1000)).toBe(8);    // 卡顿 1 s：dt 截到 0.1 s，最多 8 个
    loop.manual = true;
    expect(loop.frame(2000)).toBe(0);
    expect(frames).toBe(4);
    expect(ticks).toBe(10);
  });
});

describe('quality（§9.4）', () => {
  it('档位表与自动档位', () => {
    expect(QUALITY.low.chunksAhead).toBe(3);
    expect(QUALITY.medium.pixelRatio).toBe(0.85);
    expect(resolveQuality('high', 3).pixelRatio).toBe(1.5);
    expect(resolveQuality('high', 1).pixelRatio).toBe(1);
    const slow = new AutoQuality(true);
    let r = null; for (let i = 0; i < 120 && r === null; i++) r = slow.sample(0.03);
    expect(r).toBe('low');
    const fast = new AutoQuality(true);
    r = null; for (let i = 0; i < 400 && r === null; i++) r = fast.sample(0.008);
    expect(r).toBe('high');
    const fastMobile = new AutoQuality(false);
    r = null; for (let i = 0; i < 400 && r === null; i++) r = fastMobile.sample(0.008);
    expect(r).toBe('medium');
    expect(fastMobile.sample(0.1)).toBeNull();        // 之后不再切换
  });
});

describe('settings / save（§7.3）', () => {
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });
  it('设置清洗：未知键丢弃，类型不对回落默认值', () => {
    const s = sanitizeSettings({ quality: 'ultra', master: 250, reducedMotion: true, swipe: 'high', foo: 1 });
    expect(s.quality).toBe('auto'); expect(s.master).toBe(100); expect(s.reducedMotion).toBe(true); expect(s.swipe).toBe('high');
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('localStorage 抛异常时存档退回内存，照常工作', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); },
    };
    const save = createSave();
    expect(save.load().unlocked).toEqual(['ch1']);
    save.patch({ notes: ['n1-a'], unlocked: ['ch1', 'ch2'] });
    expect(save.load().notes).toEqual(['n1-a']);
    expect(save.load().unlocked).toEqual(['ch1', 'ch2']);
    save.reset();
    expect(save.load().notes).toEqual([]);
  });
  it('localStorage 可用时持久化（不存最好成绩）', () => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); },
    };
    createSave().patch({ last: { chapter: 'ch1', segment: '1-2', beat: 96 } });
    expect(JSON.parse(mem.get(SAVE_KEY) as string).last).toEqual({ chapter: 'ch1', segment: '1-2', beat: 96 });
    expect(createSave().load().last?.beat).toBe(96);
    expect(Object.keys(JSON.parse(mem.get(SAVE_KEY) as string))).not.toContain('best');
  });
});

describe('urlParams（§8.8）', () => {
  it('解析全部参数', () => {
    const p = parseUrlParams('?test=1&seed=42&q=low&mute=1&ch=ch3&seg=3-4&beat=60&autopilot=perfect&nocards=1&unlock=1&rf=1&rm=1&assist=1&debug=perf|hitbox');
    expect(p).toMatchObject({ test: true, seed: 42, q: 'low', mute: true, ch: 'ch3', seg: '3-4', beat: 60, autopilot: 'perfect', nocards: true, unlock: true, rf: true, rm: true, assist: true, debugEnabled: true });
    expect([...p.debug]).toEqual(['perf', 'hitbox']);
    const d = parseUrlParams('');
    expect(d.test).toBe(false); expect(d.debugEnabled).toBe(false); expect(d.ch).toBeNull();
    expect(parseUrlParams('?debug=').debugEnabled).toBe(true);
    expect(parseUrlParams('?ch=ch9&q=ultra').ch).toBeNull();
  });
});

describe('constants', () => {
  it('CUE_OWNER 覆盖全部 EventBody 类型（§8.7）', () => {
    const all: Array<EventBody['type']> = ['follower', 'twitch', 'drift', 'slow', 'stop', 'autoCrawl', 'cadence', 'noteGet', 'leader', 'hush', 'flip', 'end',
      'text', 'hint', 'double', 'doubleMod', 'doubleEnd', 'shadow', 'memory', 'actor', 'board', 'lights', 'atmosphere', 'fog', 'rain', 'bell', 'sfx',
      'ambience', 'silence', 'crowd', 'camera', 'overlay', 'count', 'noteOpen', 'hud', 'beat'];
    expect(Object.keys(CUE_OWNER).sort()).toEqual([...all].sort());
    expect(CUE_OWNER.text).toBe('WP8'); expect(CUE_OWNER.camera).toBe('WP5'); expect(CUE_OWNER.rain).toBe('WP4'); expect(CUE_OWNER.beat).toBe('CORE');
  });
  it('稳度 → 相位差、ahead 距离', () => {
    expect(LAG_BEATS.behind[3]).toBe(0.5); expect(LAG_BEATS.synced[0]).toBe(0.38); expect(AHEAD_DISTANCE[3]).toBe(3); expect(AHEAD_DISTANCE[0]).toBe(12);
  });
  it('骨骼表 29 根，父子关系闭合', () => {
    expect(BONE_COUNT).toBe(29);
    for (const b of BONES) { const p = BONE_PARENT[b]; if (p) expect(BONES.indexOf(p)).toBeLessThan(BONES.indexOf(b)); }
    const pose = createPose();
    expect(pose.q.length).toBe(29 * 4); expect(pose.q[3]).toBe(1);
  });
});

describe('registry / cues（§8.7）', () => {
  afterEach(() => __resetRegistryForTests());
  it('cue 处理者 owner 必须匹配 CUE_OWNER；重复注册抛错', () => {
    expect(() => registerCueHandler('text', 'WP3', () => {})).toThrow(/belongs to WP8/);
    registerCueHandler('text', 'WP8', () => {});
    expect(() => registerCueHandler('text', 'WP8', () => {})).toThrow(/already registered/);
  });
  it('未注册的 cue 走默认处理器（记录，不抛错）', () => {
    const d = new CueDispatcher();
    let got = '';
    registerCueHandler('bell', 'WP7', (b) => { got = b.kind; });
    const ctx = {} as never;
    d.dispatch({ body: { type: 'bell', kind: 'morning' }, segment: '1-3' }, ctx);
    d.dispatch({ body: { type: 'shadow', mode: 'jellyfish' }, segment: '1-5', id: 'x' }, ctx);
    expect(got).toBe('morning');
    expect(d.unhandled().map((e) => e.type)).toEqual(['shadow']);
    expect(d.recent().length).toBe(2);
  });
  it('ViewSystem 按 order 排序，同 id 后注册覆盖', () => {
    const mk = (id: string, order: number) => ({ id, owner: 'CORE' as const, order, init() {}, frame() {} });
    registerViewSystem(mk('camera', 60)); registerViewSystem(mk('world', 10)); registerViewSystem(mk('world', 11));
    expect(getViewSystems().map((s) => `${s.id}:${s.order}`)).toEqual(['world:11', 'camera:60']);
  });
});

describe('surfaces', () => {
  it('墙镜 / 窗 / 端墙镜留口；门牌不留口', () => {
    const c = compile(ch1 as ChapterDef);
    const idx = new ChapterSurfaces(c);
    expect(idx.get('wcMirror')?.kind).toBe('mirror');
    const all = idx.openingsIn(0, c.length).map((o) => o.surfaceId).sort();
    expect(all).toEqual(['endMirror', 'wcMirror', 'win3f']);
    const win = idx.get('win3f')!;
    expect(idx.openingsIn(win.s0 - 1, win.s0 + 1).map((o) => o.side)).toEqual(['L']);
  });
});

describe('失败卡句子（附录 B.5）', () => {
  it('按顺序匹配第一条', () => {
    expect(failLineId('ch4', 'rubber', 'legs')).toBe('fail.dream');
    expect(failLineId('ch5', 'rubber', 'legs')).toBe('fail.rubber');
    expect(failLineId('ch3', 'asphaltWet', 'bin')).toBe('fail.rain');
    expect(failLineId('ch1', 'water', 'bin')).toBe('fail.wet');
    expect(failLineId('ch1', 'terrazzo', 'mopBucket')).toBe('fail.wet');
    expect(failLineId('ch1', 'terrazzo', 'bin')).toBe('fail.knee');
  });
});
