// tests/unit/audio/integration.test.ts —— 真实的模拟事件流驱动声音引擎（DESIGN.md §8.3 运行时结构、§8.7、§8.10 WP7 验收 7）。WP7。
// 用 WP1 的 Sim（自动驾驶 perfect）跑第一章 1-5 结尾到 1-6 的「嘘」，事件和快照按 Game 的顺序喂给引擎（每 tick 分发事件，
// WP7 的四种 cue 先走 index.ts 注册的处理器，
// 每 2 tick 一帧），在 OfflineAudioContext 上渲染。检查：只用原生节点、没有错误、触地都排上了、静音段生效、峰值 ≤ −8 dBFS。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderOffline } from '../../../src/audio/library';
import { hasNonFinite, peakAbs } from '../../../src/audio/dsp';
import { LIMITS } from '../../../src/core/constants';
import type { GameEvent } from '../../../src/core/events';
import type { SimSnapshot } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';
import { SR, library, make, paramAt, toDb } from './lib';
import { MiniContext } from './offline/mini';
import { engineFor } from './scenarios';

type Lib = Awaited<ReturnType<typeof library>>;
let lib: Lib;
beforeAll(async () => { lib = await library(); }, 60_000);

/** 原生节点的工厂方法（§8.10 WP7 验收 7：不用 ScriptProcessor / AudioWorklet）。 */
const NATIVE = new Set(['createGain', 'createBiquadFilter', 'createOscillator', 'createBufferSource', 'createStereoPanner', 'createConvolver',
  'createDynamicsCompressor', 'createWaveShaper', 'createBuffer', 'createConstantSource']);

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('验收 7：只用原生节点', () => {
  it('src/audio 里没有 ScriptProcessor / AudioWorklet', () => {
    const files = srcFiles(join(__dirname, '../../../src/audio'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(/ScriptProcessor|AudioWorklet|audioWorklet|createScriptProcessor/.test(code), f).toBe(false);
    }
  });
});

describe('真实事件流：第一章 1-5 → 1-6「嘘」', () => {
  let res: {
    created: Map<string, number>; errors: number; contacts: number; follower: number; selfScheduled: number; folScheduled: number;
    hushAt: number | null; gates: Record<string, number>; selfGate: number; peakDb: number; nonFinite: boolean; avgFrameMs: number; maxVoices: number;
    segments: string[]; cues: string[];
  };

  beforeAll(async () => {
    const def = getChapter('ch1') as ChapterDef;
    const sim = new Sim(solver);
    sim.load(compile(def, 1), { segment: '1-5', beat: 150 }, 1);
    sim.setAutopilot('perfect');
    const dur = 26;
    const created = new Map<string, number>();
    const wrapCtx = (c: MiniContext) => {
      const proto = Object.getPrototypeOf(c) as Record<string, unknown>;
      for (const k of Object.getOwnPropertyNames(proto)) {
        if (!k.startsWith('create') || typeof proto[k] !== 'function') continue;
        const orig = (c as unknown as Record<string, (...a: unknown[]) => unknown>)[k] as (...a: unknown[]) => unknown;
        (c as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => { created.set(k, (created.get(k) ?? 0) + 1); return orig.apply(c, a); };
      }
      return c;
    };
    const { e, ctx } = await engineFor((ch, len, sr) => wrapCtx(make(ch, len, sr) as unknown as MiniContext) as unknown as OfflineAudioContext, SR, dur, lib);
    let snap: SimSnapshot = sim.snapshot();
    // 与 Game.dispatch 相同的顺序：cue 先经分发器（WP7 的 bell / sfx / ambience / silence 处理器），再 audio.onEvent
    const feed = (evs: GameEvent[]) => {
      for (const x of evs) {
        if (x.type === 'cue') {
          const b = x.data.body;
          if (b.type === 'bell') e.onBell(b.kind, snap);
          else if (b.type === 'sfx') e.onSfx(b.sfx, b.pan, b.gain, snap);
          else if (b.type === 'ambience') e.onAmbience(b.amb, b.level, b.seconds, snap);
          else if (b.type === 'silence') e.onSilence(b.seconds, snap);
        }
        e.onEvent(x, snap);
      }
    };
    feed(sim.drain());
    let contacts = 0, follower = 0, hushTick = -1;
    const segments: string[] = [];
    for (let tick = 0; tick < (dur - 1) * 120; tick++) {
      sim.step([], new Set());
      snap = sim.snapshot();
      const evs = sim.drain();
      for (const x of evs) {
        if (x.type === 'contact') contacts++;
        if (x.type === 'followerContact') follower++;
        if (x.type === 'segment') segments.push(x.data.id);
      }
      feed(evs);
      if (snap.hush && hushTick < 0) hushTick = tick;
      if (tick % 2 === 1) e.frame(snap, 1 / 60);
      if (evs.some((x) => x.type === 'chapter:end')) break;
    }
    const off = e.clock.offset as number;
    const hushAt = hushTick >= 0 ? (hushTick + 1) / 120 + off : null;
    const m = e.mixer as NonNullable<typeof e.mixer>;
    const gates: Record<string, number> = {};
    if (hushAt !== null) for (const b of ['follower', 'npc', 'ambience', 'floor', 'revB'] as const) gates[b] = toDb(paramAt(m.gate(b).param, hushAt + 0.3));
    const selfGate = hushAt !== null ? toDb(paramAt(m.gate('self').param, hushAt + 0.3)) : 0;
    const out = await renderOffline(ctx);
    const chs = [out.getChannelData(0), out.getChannelData(1)];
    const st = e.stats();
    res = {
      created, errors: st.errors as number, contacts, follower,
      selfScheduled: e.scheduled.filter((x) => x.key.startsWith('self:')).length,
      folScheduled: e.scheduled.filter((x) => x.key.startsWith('follower:')).length,
      hushAt, gates, selfGate, peakDb: toDb(peakAbs(chs)), nonFinite: hasNonFinite(chs), avgFrameMs: st.avgFrameMs as number,
      maxVoices: e.voices.maxSeen, segments, cues: e.cues(1024),
    };
  }, 120_000);

  it('引擎创建的节点全部是原生节点', () => {
    expect(res.created.size).toBeGreaterThan(5);
    for (const k of res.created.keys()) expect(NATIVE.has(k), k).toBe(true);
  });
  it('没有错误；走进了 1-6；自己的三段声和追随者都排上了', () => {
    expect(res.errors).toBe(0);
    expect(res.segments).toContain('1-6');
    expect(res.contacts).toBeGreaterThan(60);
    expect(res.follower).toBeGreaterThan(30);
    // scheduled 是最近 512 个的环形日志：至少排上了大部分
    expect(res.selfScheduled + res.folScheduled).toBeGreaterThan(Math.min(480, (res.contacts + res.follower) * 0.8));
  });
  it('1-6「嘘」：0.3 s 后环境、追随者、NPC ≤ −60 dB，自己的掌声不受影响', () => {
    expect(res.hushAt).not.toBeNull();
    for (const [b, g] of Object.entries(res.gates)) expect(g, b).toBeLessThanOrEqual(-60);
    expect(res.selfGate).toBeCloseTo(0, 3);
    expect(res.cues).toContain('hush');
    expect(res.cues).toContain('sfx:shush');
  });
  it('渲染：峰值 ≤ −8 dBFS、没有 NaN；声部 ≤ 32；每帧平均开销 < 1 ms', () => {
    expect(res.nonFinite).toBe(false);
    expect(res.peakDb).toBeLessThanOrEqual(LIMITS.peakDbfs);
    expect(res.peakDb).toBeGreaterThan(-30);
    expect(res.maxVoices).toBeLessThanOrEqual(32);
    expect(res.avgFrameMs).toBeLessThan(1);
  });
});
