// tests/unit/sim/skip.test.ts —— 跳过已看过的静场（评审 U2）：剩余事件只保留状态，表现类 cue 不在跳过的那一刻一次排出，
// 也不带进下一个跑段。界面那一侧（跳过后清掉旧字幕）归 U4。
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../src/core/events';
import type { ChapterId } from '../../../src/core/types';
import { getChapter } from '../../../src/levels/chapters/index';
import type { ChapterDef, EventBody, SegmentDef } from '../../../src/levels/schema';
import { chapter, Driver, runSeg, stillSeg } from './fixtures';

/** 跳过的那一刻不能出现的 cue（表现类）。 */
const PRESENTATION = new Set<EventBody['type']>([
  'text', 'sfx', 'bell', 'board', 'camera', 'double', 'doubleMod', 'doubleEnd', 'shadow', 'memory', 'actor', 'overlay', 'noteOpen', 'count', 'hint', 'silence',
]);

/** 这一段里挂在事件、输入 onDone、按步事件上的 id。 */
function idsOf(sd: SegmentDef): string[] {
  const out: string[] = [];
  const evs = [...((sd.events ?? []) as Array<{ id?: string }>), ...(((sd as { input?: { onDone?: Array<{ id?: string }> } }).input?.onDone) ?? [])];
  for (const e of evs) if (e.id) out.push(e.id);
  return out;
}

function lastAmbience(events: readonly GameEvent[]): string | null {
  let a: string | null = null;
  for (const e of events) if (e.type === 'cue' && e.data.body.type === 'ambience') a = `${e.data.body.amb}:${e.data.body.level}`;
  return a;
}

/** 从静场开头跑到下一段的第一 tick：skip 时第 6 tick 跳过，否则不按任何键等它自己结束（输入超时自动完成）。 */
function toNext(def: ChapterDef, still: string, skip: boolean) {
  const d = new Driver(def, { segment: still, beat: 0 });
  d.step(6);
  let atSkip: GameEvent[] = [];
  if (skip) {
    d.sim.skipStill();
    atSkip = d.sim.drain();
    d.events.push(...atSkip);
  } else {
    d.until(() => d.snap.segment !== still, 120 * 60);
  }
  const snap = d.snap;
  return { d, atSkip, snap, follower: { mode: snap.follower.mode, hud: snap.follower.hud, voice: snap.follower.voice, from: snap.follower.from }, flip: snap.flip, ambience: lastAmbience(d.events) };
}

describe('跳过静场：只保留状态（2-9、4-4、1-4）', () => {
  for (const [ch, still] of [['ch2', '2-9'], ['ch4', '4-4'], ['ch1', '1-4']] as Array<[ChapterId, string]>) {
    it(`${ch} ${still}`, () => {
      const def = getChapter(ch);
      if (!def) return;
      const sd = def.segments.find((s) => s.id === still)!;
      const required = def.requiredBeats.filter((b) => idsOf(sd).includes(b));
      const a = toNext(def, still, true);
      const b = toNext(def, still, false);
      // 跳过的那个 tick：没有字幕、音效、黑板、机位、替身……（旧行为 'all' 会一次排出一串，检查本身不是空转）
      const shownOf = (evs: readonly GameEvent[]) => evs.filter((e) => e.type === 'cue' && PRESENTATION.has(e.data.body.type)).map((e) => (e.type === 'cue' ? e.data.body.type : ''));
      expect(shownOf(a.atSkip)).toEqual([]);
      const old = new Driver(def, { segment: still, beat: 0 });
      old.step(6);
      old.sim.skipStill('all');
      expect(shownOf(old.sim.drain()).length).toBeGreaterThan(3);
      expect(required.length).toBeGreaterThan(0);
      // 两种走法都到了下一段的起点
      expect(a.snap.segment).not.toBe(still);
      expect(a.snap.segment).toBe(b.snap.segment);
      // 必备节拍都记上了
      for (const id of required) {
        expect(a.snap.beatsFired, `skip: ${id}`).toContain(id);
        expect(b.snap.beatsFired, `watched: ${id}`).toContain(id);
      }
      // 下一段起点的状态一致
      expect(a.follower).toEqual(b.follower);
      expect(a.flip).toBe(b.flip);
      expect(a.ambience).toBe(b.ambience);
      expect(a.snap.stats.notes).toEqual(b.snap.stats.notes);
    });
  }
});

describe('跳过静场：状态类事件按终态带进下一段（合成段）', () => {
  const def = chapter([
    stillSeg({
      id: 'st', duration: 4, events: [
        { at: 0.5, type: 'ambience', amb: 'room', level: 0.5, seconds: 1 },
        { at: 0.6, type: 'text', line: 'c1.note', id: 'tx' },
        { at: 1.0, type: 'crowd', group: 'g1', op: 'turnShoes' },
        { at: 1.2, type: 'crowd', group: 'g2', op: 'turnShoes' },
        { at: 1.5, type: 'crowd', group: 'g1', op: 'silent' },
        { at: 2.0, type: 'follower', def: { mode: 'behind', steady: 2 } },
        { at: 2.2, type: 'flip', on: true },
        { at: 2.5, type: 'noteGet', note: 'nq' },
        { at: 3.0, type: 'ambience', amb: 'home', level: 0.8, seconds: 1 },
        { at: 3.5, type: 'hush', seconds: 2 },                    // 看完（4 s）时还剩 1.5 s
        { at: 3.6, type: 'beat', id: 'mark' },
      ],
      input: { at: 1, hint: 'hold', mode: 'hold', holdSeconds: 1, timeout: 3, onDone: [{ at: 0.2, type: 'sfx', sfx: 'paper', id: 'done' }] },
    }),
    runSeg({ id: 'after', beats: 40 }),
  ], { notes: [{ id: 'nq', face: 'blank', front: null, back: null, folded: false, pickup: false }] });

  it('follower、flip、noteGet、hush 的剩余部分、ambience（最后一个）、crowd（每组最后一个）；节拍照记', () => {
    const d = new Driver(def);
    d.step(2);
    d.sim.skipStill();
    const evs = d.sim.drain();
    const snap = d.snap;
    expect(snap.segment).toBe('after');
    expect(snap.follower.mode).toBe('behind');
    expect(snap.flip).toBe(true);
    expect(snap.stats.notes).toEqual(['nq']);
    expect([...snap.beatsFired].sort()).toEqual(['done', 'mark', 'tx']);
    const cues = evs.filter((e): e is Extract<GameEvent, { type: 'cue' }> => e.type === 'cue').map((e) => e.data.body);
    expect(cues.map((b) => b.type).sort()).toEqual(['ambience', 'crowd', 'crowd']);
    expect(cues.find((b) => b.type === 'ambience')).toMatchObject({ amb: 'home', level: 0.8 });
    expect(cues.filter((b) => b.type === 'crowd')).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: 'g1', op: 'silent' }), expect.objectContaining({ group: 'g2', op: 'turnShoes' }),
    ]));
    // hush：看完时还剩 1.5 s
    expect(snap.hush).toBe(true);
    d.step(Math.round(1.4 * 120));
    expect(d.snap.hush).toBe(true);
    d.step(Math.round(0.2 * 120));
    expect(d.snap.hush).toBe(false);
  });
  it("mode 'all'（旧行为）：剩余事件全部立即触发", () => {
    const d = new Driver(def);
    d.step(2);
    d.sim.skipStill('all');
    const types = d.sim.drain().filter((e): e is Extract<GameEvent, { type: 'cue' }> => e.type === 'cue').map((e) => e.data.body.type);
    expect(types).toContain('text');
    expect(types).toContain('sfx');
  });
});
