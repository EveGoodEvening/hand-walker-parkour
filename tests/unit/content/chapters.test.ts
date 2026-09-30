// tests/unit/content/chapters.test.ts —— 五章数据（DESIGN.md §4、§8.10 WP2 验收 1–4、6，附录 B.1、B.3、附录 C）。归 WP2。
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../../src/core/constants';
import { FALLBACK_ATMOSPHERES } from '../../../src/core/fallbacks';
import type { ChapterId, ObstacleClass } from '../../../src/core/types';
import { availableChapters, getChapter, nextChapterOf } from '../../../src/levels/chapters/index';
import { compile } from '../../../src/levels/compile';
import { KIT_VARIANTS, SET_VARIANTS } from '../../../src/levels/kitSymbols';
import { lineText } from '../../../src/levels/lines';
import { segmentEvents } from '../../../src/levels/lint';
import { OBSTACLES } from '../../../src/levels/obstacles';
import type { ChapterDef, RunSegmentDef, SegmentDef, StillSegmentDef } from '../../../src/levels/schema';
import { nominalTimeline, validateChapter } from '../../../src/levels/validate';
import { solver } from '../../../src/sim/Solver';

const IDS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as const;
const ch = (id: ChapterId) => getChapter(id) as ChapterDef;

/** 附录 C：每章必备节拍 id。 */
const REQUIRED: Record<(typeof IDS)[number], string[]> = {
  ch1: ['whisperHandWalker', 'memoryInverted', 'chenMoAsk', 'mirrorLate', 'bellWarning', 'noteDesk', 'teacherDuty', 'footTwitch',
    'firstSteps', 'emptyHall', 'shadowStanding', 'thirdHandShush'],
  ch2: ['lunchBell', 'legForest', 'counterStand', 'trayCollar', 'reflectionSits', 'palmHeat', 'reflectionWalksFaster', 'echoReturns',
    'echoStops', 'feetHold', 'noteBehind', 'threeHands', 'boardQuestion', 'boardAnswer', 'handThroughGlass', 'approachingFront'],
  ch3: ['lightsOut', 'anotherSteps', 'stairsCount', 'oneBeatLate', 'directorZhou', 'rainStarts', 'puddleStands', 'puddleShush',
    'hushRun', 'busTap', 'closerNow', 'graffitiHand', 'uselessLookBack', 'reflectiveEverywhere', 'barrierWound', 'soundLight',
    'twelvePalms', 'mirrorEmpty', 'handOnShoulder'],
  ch4: ['dreamFast', 'admired', 'teachMe', 'boyFalls', 'dreamStand', 'overtaken', 'shadowOtherWay', 'palmEye', 'choiceDrowned',
    'dontStand', 'kneel', 'inSync', 'passMirror', 'waterQuestion', 'waterBreaks', 'fingerPractice'],
  ch5: ['feetDisobey', 'feetRelax', 'lateLight', 'followerAbsent', 'reversedShadow', 'shadowFaster', 'startRun', 'shadowGone',
    'driftStraighten', 'standingBehind', 'noOneBehind', 'mathSilence', 'standingMeWalks', 'windEar', 'notInMirror',
    'riseThreeSeconds', 'seventhFall', 'theyPractice', 'walkedSeven', 'noteNoMe', 'pillowDent', 'aheadRhythm', 'fist',
    'leaderAhead', 'mirrorFlip'],
};

/** 附录 B.1：开场卡与结尾卡（结尾卡只列文字行）。 */
const CARDS: Record<(typeof IDS)[number], { card: string[]; outro: string[] }> = {
  ch1: { card: ['早自习的铃声还没响，走廊里已经有人了。'], outro: ['有些问题问出来就回不去了。', '但我现在已经不想问了。', '我想知道答案。'] },
  ch2: { card: ['午饭铃比早自习铃更长，', '像一把钝锯在空气里来回拉扯。'], outro: ['我没有回头。', '像有人在空房间里鼓掌。'] },
  ch3: { card: ['晚自习的灯是一盏一盏灭的。'], outro: ['它们在练习。', '它在等我。', '而我，第一次想要回头。'] },
  ch4: { card: ['我睡着的时候，脚还在抖。'], outro: ['羡慕和歧视，有时候是同一件事，只是换了一个表情。', '它不像鼓掌。', '像某种练习。'] },
  ch5: { card: ['我醒的时候，闹钟还没响。'], outro: ['因为它可能是真正的我。', '而我，只是它的倒影。'] },
};

/** 附录 B.3 与 §4 各章「纸条」：id → [获得方式, 所在段, 拍, 车道]。 */
const NOTES: Record<string, { ch: (typeof IDS)[number]; pickup: boolean; seg: string; at?: number; lane?: number; text: boolean }> = {
  'n1-desk': { ch: 'ch1', pickup: false, seg: '1-4', text: true },
  'n1-a': { ch: 'ch1', pickup: true, seg: '1-2', at: 132, lane: 1, text: true },
  'n1-b': { ch: 'ch1', pickup: true, seg: '1-5', at: 166, lane: -1, text: false },
  'n2-a': { ch: 'ch2', pickup: true, seg: '2-2', at: 70, lane: 1, text: false },
  'n2-b': { ch: 'ch2', pickup: true, seg: '2-10', at: 16, lane: -1, text: false },
  'n3-a': { ch: 'ch3', pickup: true, seg: '3-1', at: 50, lane: 0, text: false },
  'n3-b': { ch: 'ch3', pickup: true, seg: '3-4', at: 150, lane: 1, text: false },
  'n3-c': { ch: 'ch3', pickup: true, seg: '3-6', at: 40, lane: -1, text: false },
  'n5-a': { ch: 'ch5', pickup: true, seg: '5-3', at: 170, lane: 1, text: false },
  'n5-note': { ch: 'ch5', pickup: false, seg: '5-9', text: true },
};

/** §4.6：每章合计（不含卡片，秒）。WP2 交付可以相差 ±15%。 */
const TARGET_SEC: Record<(typeof IDS)[number], number> = { ch1: 127, ch2: 175, ch3: 168, ch4: 131, ch5: 215 };

/** 与 validate.ts 相同的计时：跑段按名义时间，停拍计入非跑动；静场 / 站立 = 时长 + 等输入（取 min(超时, 按住秒数 ?? 0.3)）。 */
function durations(def: ChapterDef) {
  const c = compile(def);
  let run = 0, non = 0;
  for (const seg of c.segments) {
    if (seg.kind === 'run') { const tl = nominalTimeline(seg); run += tl.tEnd - tl.stopSec; non += tl.stopSec; continue; }
    const d = seg.def as StillSegmentDef;
    non += d.duration + (d.input ? Math.min(d.input.timeout, d.input.holdSeconds ?? 0.3) : 0);
  }
  return { run, non, total: run + non, ratio: non / (run + non) };
}

/** 一段里挂在事件、窗口、输入上的全部 id（含 atStep 事件）。 */
function idsOf(def: ChapterDef): Set<string> {
  const ids = new Set<string>();
  for (const sd of def.segments) {
    for (const e of segmentEvents(sd)) if (e.id) ids.add(e.id);
    if (sd.kind === 'run') for (const w of sd.windows ?? []) if (w.id) ids.add(w.id);
  }
  for (const l of def.outro.lines) if ('input' in l && l.id) ids.add(l.id);
  return ids;
}

describe('章节索引：五章都能按现有注册方式加载', () => {
  it('availableChapters 顺序是 ch1–ch5；下一章链条完整', () => {
    expect(availableChapters()).toEqual([...IDS]);
    expect(IDS.map((id) => nextChapterOf(id))).toEqual(['ch2', 'ch3', 'ch4', 'ch5', null]);
  });
  it.each(IDS)('%s：标题、章名与 B.4 一致，能编译', (id) => {
    const def = ch(id);
    expect(def.id).toBe(id);
    expect(`${def.title}　${def.name}`).toBe({ ch1: '第一章　早自习', ch2: '第二章　午饭', ch3: '第三章　雨夜', ch4: '第四章　广场', ch5: '第五章　七步' }[id]);
    expect(compile(def).segments.length).toBe(def.segments.length);
  });
});

describe('附录 C：必备节拍', () => {
  it.each(IDS)('%s：requiredBeats 与附录 C 完全一致，且每个都挂在事件 / 窗口 / 输入的 id 上', (id) => {
    const def = ch(id);
    expect([...def.requiredBeats].sort()).toEqual([...REQUIRED[id]].sort());
    const ids = idsOf(def);
    for (const rb of def.requiredBeats) expect(ids.has(rb), rb).toBe(true);
  });
});

describe('附录 B.1：开场卡与结尾卡', () => {
  it.each(IDS)('%s', (id) => {
    const def = ch(id);
    expect(def.card.map((l) => lineText(l))).toEqual(CARDS[id].card);
    expect(def.outro.lines.flatMap((l) => ('line' in l ? [lineText(l.line)] : []))).toEqual(CARDS[id].outro);
  });
  it('第四章结尾卡可交互：↓ ↓ ↓（超时 6 s），背景是卧室天花板', () => {
    const o = ch('ch4').outro;
    expect(o.set).toBe('bedroom');
    expect(o.variant).toBe('ceiling');
    const inp = o.lines.find((l) => 'input' in l);
    expect(inp && 'input' in inp ? [inp.id, inp.input.mode, inp.input.timeout] : null).toEqual(['fingerPractice', 'taps3', 6]);
  });
});

describe('纸条（附录 B.3，验收 4）', () => {
  it('每章 ≤ 3 张；第四章没有纸条；只有 n1-desk、n1-a、n5-note 有字', () => {
    const all = IDS.flatMap((id) => ch(id).notes.map((n) => ({ ...n, chapter: id })));
    for (const id of IDS) expect(ch(id).notes.length, id).toBeLessThanOrEqual(LIMITS.notesPerChapter);
    expect(ch('ch4').notes).toEqual([]);
    expect(all.map((n) => n.id).sort()).toEqual(Object.keys(NOTES).sort());
    for (const n of all) {
      const want = NOTES[n.id]!;
      expect(n.chapter, n.id).toBe(want.ch);
      expect(n.pickup, n.id).toBe(want.pickup);
      expect(!!(n.front || n.back || n.face === 'doodle'), n.id).toBe(want.text);
    }
    expect(all.find((n) => n.id === 'n1-a')?.front).toBe('c1.evoFail');
    expect(all.find((n) => n.id === 'n1-desk')?.back).toBe('c2.noteBack');
    expect(all.find((n) => n.id === 'n5-note')?.back).toBe('c5.noteBack');
  });
  it('拾取的纸条放在 §4 写明的段、拍、车道；剧情纸条由 noteGet 给出；n1-desk 在 2-9 打开', () => {
    for (const [id, want] of Object.entries(NOTES)) {
      const seg = ch(want.ch).segments.find((s) => s.id === want.seg) as SegmentDef;
      if (want.pickup) {
        const p = (seg as RunSegmentDef).notes?.find((n) => n.note === id);
        expect(p ? [p.at, p.lane] : null, id).toEqual([want.at, want.lane]);
      } else {
        expect(segmentEvents(seg).some((e) => e.type === 'noteGet' && e.note === id), id).toBe(true);
      }
    }
    const s29 = ch('ch2').segments.find((s) => s.id === '2-9') as SegmentDef;
    expect(segmentEvents(s29).some((e) => e.type === 'noteOpen' && e.note === 'n1-desk')).toBe(true);
  });
});

describe('冻结的联合类型（验收 6）', () => {
  it.each(IDS)('%s：kit 变体、set 变体、氛围、障碍种类都合法', (id) => {
    const def = ch(id);
    const atms = new Set(Object.keys(FALLBACK_ATMOSPHERES));
    for (const sd of def.segments) {
      expect(atms.has(sd.atmosphere), `${sd.id} ${sd.atmosphere}`).toBe(true);
      if (sd.kind === 'still') expect(SET_VARIANTS[sd.set].includes(sd.variant ?? 'default'), `${sd.id}`).toBe(true);
      else expect(KIT_VARIANTS[sd.kit].includes(sd.variant), `${sd.id}`).toBe(true);
    }
    for (const seg of compile(def).segments) for (const o of seg.obstacles) expect(OBSTACLES[o.kind], o.kind).toBeDefined();
  });
});

describe('时长（验收 2，§4.6，R13）', () => {
  it.each(IDS)('%s：合计与 §4.6 相差 ≤ 15%，非跑动 ≤ 25%，每个静场 / 站立段 ≤ 15 s', (id) => {
    const def = ch(id);
    const d = durations(def);
    expect(Math.abs(d.total / TARGET_SEC[id] - 1), `${d.total.toFixed(1)} s vs ${TARGET_SEC[id]} s`).toBeLessThanOrEqual(0.15);
    expect(d.ratio).toBeLessThanOrEqual(LIMITS.nonRunMaxRatio);
    for (const sd of def.segments) if (sd.kind !== 'run') expect(sd.duration, sd.id).toBeLessThanOrEqual(LIMITS.stillMaxSec);
  });
});

describe('R7：新类别 / 新种类第一次出现时，该行只有它（种子 1–20 与章节种子）', () => {
  const REQ: ReadonlySet<ObstacleClass> = new Set(['low', 'bar', 'block']);
  it.each(IDS)('%s', (id) => {
    const def = ch(id);
    const problems: string[] = [];
    for (const seed of [def.seed, ...Array.from({ length: 20 }, (_, i) => i + 1)]) {
      const seenC = new Set<string>(), seenK = new Set<string>();
      for (const seg of compile(def, seed).segments) {
        const rows = new Map<number, typeof seg.obstacles>();
        for (const o of seg.obstacles) rows.set(o.beat, [...(rows.get(o.beat) ?? []), o]);
        for (const o of seg.obstacles) {
          if (!REQ.has(o.cls)) continue;
          const row = (rows.get(o.beat) ?? []).filter((q) => REQ.has(q.cls));
          if (!seenC.has(o.cls)) { seenC.add(o.cls); if (row.some((q) => q.cls !== o.cls)) problems.push(`class ${seg.def.id} @${o.beat} seed ${seed}`); }
          if (!seenK.has(o.kind)) { seenK.add(o.kind); if (row.some((q) => q.kind !== o.kind)) problems.push(`kind ${o.kind} ${seg.def.id} @${o.beat} seed ${seed}`); }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('标志性段落的数据形状（§4）', () => {
  it('2-4 端盘：禁用撑跃；5-8 七步：按住 ↑ 三秒逐秒出字，第 7 步摔倒', () => {
    const tray = ch('ch2').segments.find((s) => s.id === '2-4') as RunSegmentDef;
    expect(tray.controls?.jump).toBe(false);
    const seven = ch('ch5').segments.find((s) => s.id === '5-8');
    if (seven?.kind !== 'stand') throw new Error('5-8 must be a stand segment');
    expect(seven.script).toBe('sevenSteps');
    expect(seven.input?.holdSeconds).toBe(3);
    expect(seven.input?.progress?.map((p) => lineText(p.line))).toEqual(['我站起来了一秒。', '两秒。', '三秒。']);
    const fall = seven.events.find((e) => 'atStep' in e && e.id === 'seventhFall');
    expect(fall && 'atStep' in fall ? fall.atStep : null).toBe(7);
  });
  it('回头窗口全作只有三处：1-5（收益 1，自动）、3-6（收益 0）、5-3（收益 1）', () => {
    const wins = IDS.flatMap((id) => ch(id).segments.flatMap((s) => (s.kind === 'run' ? (s.windows ?? []) : [])
      .filter((w) => w.type === 'lookBack').map((w) => `${s.id}:${w.gain ?? 0}:${w.auto ? 'auto' : '-'}`)));
    expect(wins).toEqual(['1-5:1:auto', '3-6:0:-', '5-3:1:-']);
  });
  it('腿偏移全作 4 次，都在第五章；画面翻转只在 5-11', () => {
    const drifts = IDS.flatMap((id) => ch(id).segments.flatMap((s) => segmentEvents(s).filter((e) => e.type === 'drift').map(() => s.id)));
    expect(drifts).toEqual(['5-4', '5-4', '5-6', '5-11']);
    const flips = IDS.flatMap((id) => ch(id).segments.flatMap((s) => segmentEvents(s).filter((e) => e.type === 'flip').map(() => s.id)));
    expect(flips).toEqual(['5-11']);
  });
  it('搭肩的第三只手只在 3-10 卫生间镜子与 5-4 厕所镜子（附录 A-12）', () => {
    const where: string[] = [];
    for (const id of IDS) for (const s of ch(id).segments) for (const e of segmentEvents(s)) {
      const g = e.type === 'double' ? e.spec.thirdHand?.gesture : e.type === 'doubleMod' ? e.mod.thirdHand?.gesture : undefined;
      if (g === 'shoulder') where.push(s.id);
    }
    expect(where).toEqual(['3-10', '5-4']);
  });
});

describe('校验器（验收 1：五章全部通过当前的 validate）', () => {
  it.each(IDS)('%s：没有 error，也没有 warning', (id) => {
    const r = validateChapter(ch(id), solver);
    expect(r.issues).toEqual([]);
  });
});
