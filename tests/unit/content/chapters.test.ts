// tests/unit/content/chapters.test.ts —— 五章数据（DESIGN.md §4、§8.10 WP2 验收 1–4、6，附录 B.1、B.3、附录 C）。归 WP2。
import { describe, expect, it } from 'vitest';
import { CORRIDOR_WIDTH, LANE_WIDTH, LIMITS, TEXT, TICK_DT } from '../../../src/core/constants';
import { FALLBACK_ATMOSPHERES } from '../../../src/core/fallbacks';
import { QUALITY } from '../../../src/core/quality';
import type { ChapterId, ObstacleClass } from '../../../src/core/types';
import { availableChapters, getChapter, nextChapterOf } from '../../../src/levels/chapters/index';
import { compile } from '../../../src/levels/compile';
import { KIT_VARIANTS, SET_VARIANTS } from '../../../src/levels/kitSymbols';
import { lineText } from '../../../src/levels/lines';
import { segmentEvents } from '../../../src/levels/lint';
import { OBSTACLES } from '../../../src/levels/obstacles';
import type { ChapterDef, CompiledSegment, RunSegmentDef, SegmentDef, StillSegmentDef } from '../../../src/levels/schema';
import { nominalTimeline, readDistance, timeAtS, validateChapter } from '../../../src/levels/validate';
import { solver } from '../../../src/sim/Solver';
import { Sim } from '../../../src/sim/Sim';
import { advancePace, createPaceState, nominalCadence, paceEvents } from '../../../src/sim/Pace';
import { expandSegment, type Decor, type GroupInfo } from '../../../src/render/npc/crowds';
import { specialById, specialOfGroup } from '../../../src/render/npc/specials';
import { NOTE_OPEN } from '../../../src/ui/hud/Hud';

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
  // 第三章结尾卡在「它们在练习。」之前加原文「然后我的右脚动了。」（评审修复 U1，代替 3-11 静场；建议 lead 回写 B.1）
  ch3: { card: ['晚自习的灯是一盏一盏灭的。'], outro: ['然后我的右脚动了。', '它们在练习。', '它在等我。', '而我，第一次想要回头。'] },
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
  it('crowd 事件指向存在的 NPC 组：跑段用本段的组；站立段用紧挨着的前一个跑段的组（WP6 把它保留到站立段）', () => {
    const problems: string[] = [];
    const used: string[] = [];
    for (const id of IDS) {
      const segs = ch(id).segments;
      segs.forEach((s, i) => {
        const crowd = segmentEvents(s).filter((e) => e.type === 'crowd');
        if (!crowd.length) return;
        let groups: readonly { id?: string }[] = [];
        if (s.kind === 'run') groups = s.npcs ?? [];
        else if (s.kind === 'stand') { const prev = segs[i - 1]; groups = prev?.kind === 'run' ? (prev.npcs ?? []) : []; }
        const ids = new Set(groups.map((g) => g.id));
        for (const e of crowd) {
          if (e.type !== 'crowd') continue;
          used.push(`${s.id}:${e.group}:${e.op}`);
          if (!ids.has(e.group)) problems.push(`${s.id} crowd ${e.op} → '${e.group}' (available: ${[...ids].join(', ') || 'none'})`);
        }
      });
    }
    expect(problems).toEqual([]);
    expect(used).toEqual(['4-3:ring2:applaud', '4-3:imitators:crawlOvertake', '5-6:recessSides:centerShoes', '5-8:class5:turnShoes']);
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

describe('画面上不穿模', () => {
  const STILL = new Set(['static', 'askable', 'swing', 'shift', 'yield', 'fallInto']);
  it.each(IDS)('%s：同车道的静止障碍互不重叠；移动障碍被追上前 6 s 的路径上没有同车道的静止障碍', (id) => {
    const problems: string[] = [];
    for (const seg of compile(ch(id)).segments) {
      if (seg.kind !== 'run') continue;
      const st = seg.obstacles.filter((o) => STILL.has(o.behavior.type) && o.cls !== 'soft' && o.cls !== 'pickup');
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
        const a = st[i]!, b = st[j]!;
        if (a.lanes.some((l) => b.lanes.includes(l)) && a.s1 > b.s0 && b.s1 > a.s0) problems.push(`${seg.def.id} ${a.kind}@${a.beat} × ${b.kind}@${b.beat}`);
      }
      const tl = nominalTimeline(seg);
      for (const o of seg.obstacles) {
        if (o.behavior.type !== 'walk') continue;
        const v = o.behavior.speed;
        let k = -1;
        for (let i = 0; i < tl.n; i++) if ((tl.s[i] as number) + 0.25 >= o.s0 + v * (tl.t[i] as number)) { k = i; break; }
        if (k < 0) { problems.push(`${seg.def.id} ${o.kind}@${o.beat} is never reached`); continue; }
        const tm = tl.t[k] as number;
        const p0 = o.s0 + v * Math.max(0, tm - 6), p1 = o.s0 + v * tm;
        const lo = Math.min(p0, p1) - 1, hi = Math.max(p0, p1) + 1;
        for (const q of st) if (q.lanes.some((l) => o.lanes.includes(l)) && q.s1 >= lo && q.s0 <= hi) problems.push(`${seg.def.id} walker ${o.kind}@${o.beat} × ${q.kind}@${q.beat}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

/** 跑段的密度：必需类别（low / bar / block）的行数 / 10 拍、任意 20 拍里的峰值（行 / 10 拍）、
 *  求解器最少输入次数 / 10 拍（§2.8「必需动作密度」；去掉纸条，免得为了捡纸条多出来的换道算进去）。 */
function density(seg: CompiledSegment): { rows: number; peak: number; inputs: number } {
  const REQ: ReadonlySet<ObstacleClass> = new Set(['low', 'bar', 'block']);
  const d = seg.def as RunSegmentDef;
  const rows = [...new Set(seg.obstacles.filter((o) => REQ.has(o.cls)).map((o) => o.beat))];
  let peak = 0;
  for (let b = 0; b <= d.beats; b++) peak = Math.max(peak, rows.filter((x) => x >= b && x < b + 20).length);
  const plan = solver.solve({ ...seg, obstacles: seg.obstacles.filter((o) => o.cls !== 'pickup') }, { noAsk: d.crowd === true });
  const inputs = plan ? plan.steps.filter((p) => p.action === 'left' || p.action === 'right' || p.action === 'jump' || p.action === 'duck').length : NaN;
  return { rows: (rows.length / d.beats) * 10, peak: peak / 2, inputs: (inputs / d.beats) * 10 };
}

describe('§2.8 难度曲线：最后一个跑段是减速的叙事收束，不比技巧高潮密', () => {
  // 规则：高潮在倒数第二或第三个跑段（取两者里更密的）。§2.8 表格单独点名的两章按表格：
  // 第四章只有三个跑段，高潮就是最后的 4-5（「2.2 → 3.0（4-5）」），这时检查它是本章最密的跑段；
  // 第五章的高潮是 5-3（「2.0 → 3.0（5-3）/ 2.0（5-11）」），5-6 课间、5-7 体育课按设计就很稀。
  const CLIMAX: Partial<Record<(typeof IDS)[number], string>> = { ch4: '4-5', ch5: '5-3' };
  it.each(IDS)('%s', (id) => {
    const runs = compile(ch(id)).segments.filter((s) => s.kind === 'run');
    const last = runs[runs.length - 1]!;
    const climaxIds = CLIMAX[id] ? [CLIMAX[id]!] : runs.slice(-3, -1).map((s) => s.def.id);
    const m = new Map(runs.map((s) => [s.def.id, density(s)]));
    const problems: string[] = [];
    for (const k of ['rows', 'peak', 'inputs'] as const) {
      for (const [sid, v] of m) expect(Number.isFinite(v[k]), `${sid} ${k}`).toBe(true);
      if (climaxIds.includes(last.def.id)) {
        for (const [sid, v] of m) if (v[k] > m.get(last.def.id)![k] + 1e-9) problems.push(`${k}: ${sid} ${v[k].toFixed(2)} > climax ${last.def.id}`);
      } else {
        const top = Math.max(...climaxIds.map((c) => m.get(c)![k]));
        const mine = m.get(last.def.id)![k];
        if (mine > top + 1e-9) problems.push(`${k}: last ${last.def.id} ${mine.toFixed(2)} > climax ${climaxIds.join('/')} ${top.toFixed(2)}`);
      }
    }
    expect(problems).toEqual([]);
  });
  // 评审修复 U1 推翻了 §10.2「2-10 只有 @10 一个障碍」：140 拍里 30 s 不用按键太空。2-10 仍是减速的叙事收束，
  // 但每 12–16 拍有一个轻的强制动作；必需动作密度 ≤ 0.5 次 / 10 拍，并且低于本章技巧高潮 2-8。
  it('2-10 碎角镜：求解器最少输入 ≤ 0.5 次 / 10 拍，低于本章最密的 2-8；2-8 是第二章最密的跑段', () => {
    const runs = compile(ch('ch2')).segments.filter((s) => s.kind === 'run');
    const d = new Map(runs.map((s) => [s.def.id, density(s).inputs]));
    expect(d.get('2-10')!).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(d.get('2-10')!).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(d.get('2-10')!).toBeLessThan(d.get('2-8')!);
    for (const [sid, v] of d) if (sid !== '2-8') expect(v, sid).toBeLessThan(d.get('2-8')!);
  });
  it('第三章高潮不倒置：3-6 的最少输入 ≥ 3-4；第四章 4-5 ≥ 4-1', () => {
    const inputs = (id: ChapterId, sid: string) => density(compile(ch(id)).segments.find((s) => s.def.id === sid)!).inputs;
    expect(inputs('ch3', '3-6')).toBeGreaterThanOrEqual(inputs('ch3', '3-4'));
    expect(inputs('ch4', '4-5')).toBeGreaterThanOrEqual(inputs('ch4', '4-1'));
  });
});

describe('5-11 门牌（§4.5「@208 画面水平翻转（门牌成了反字）」）', () => {
  // 机位按 §5.4：横屏在玩家身后 2.35 m、横向 0.7·x、水平视角 76°；竖屏在身后 3.8 m、横向 0.6·x、竖直视角 80°，
  // 按 9:20 的手机算水平视角。最坏情况是玩家在右道（离左墙最远）。门牌贴在左墙 x = −走廊半宽。
  const CAMS = [
    { name: 'landscape', back: 2.35, k: 0.7, halfH: (76 / 2) * (Math.PI / 180) },
    { name: 'portrait', back: 3.8, k: 0.6, halfH: Math.atan(Math.tan((80 / 2) * (Math.PI / 180)) * (9 / 20)) },
  ];
  // 评审修复 U1：门牌挂低、略提前（@214、y 1.3–1.6 m），让它在翻转后约 0.5–1.2 s 进入 0.92 m 横屏机位的视线带。
  // 代价是竖屏（镜头更靠后、水平视角更窄）在画面里的时间从 0.85 s 降到约 0.67 s，所以竖屏只要求 ≥ 0.6 s。
  const MIN_IN_FRAME: Record<string, number> = { landscape: 0.8, portrait: 0.6 };
  it('翻转那一拍：门牌在两种机位前方 ≥ 4 m、在雾的远端以内；翻转之后还在画面里（横屏 ≥ 0.8 s，竖屏 ≥ 0.6 s）', () => {
    const seg = compile(ch('ch5')).segments.find((s) => s.def.id === '5-11')!;
    const plate = seg.surfaces.find((s) => s.kind === 'doorPlate');
    expect(plate?.side).toBe('L');
    const flip = seg.events.find((e) => e.body.type === 'flip');
    expect(flip?.at).toBe(208);
    const tl = nominalTimeline(seg);
    const sFlip = seg.s0 + flip!.at * seg.stride;
    const tFlip = timeAtS(tl, sFlip);
    const fogFar = FALLBACK_ATMOSPHERES[seg.def.atmosphere].fog.far * QUALITY.low.fogMul;
    for (const c of CAMS) {
      const ahead = plate!.s0 - (sFlip - c.back);
      expect(ahead, `${c.name}: ahead of the camera at the flip`).toBeGreaterThanOrEqual(4);
      expect(ahead, `${c.name}: inside the fog at the flip`).toBeLessThanOrEqual(fogFar);
      const lateral = CORRIDOR_WIDTH / 2 + c.k * LANE_WIDTH;
      const sExit = plate!.s0 + c.back - lateral / Math.tan(c.halfH);   // 玩家走到这里时门牌出画
      expect(timeAtS(tl, sExit) - tFlip, `${c.name}: seconds in frame after the flip`).toBeGreaterThanOrEqual(MIN_IN_FRAME[c.name]!);
    }
  });
  it('门牌挂低（y 在 1.2–1.7 m 之间，0.92 m 机位的视线带），翻转后约 0.5–1.2 s 内经过横屏镜头前 6 m → 4 m', () => {
    const seg = compile(ch('ch5')).segments.find((s) => s.def.id === '5-11')!;
    const plate = seg.surfaces.find((s) => s.kind === 'doorPlate')!;
    const [y0, y1] = plate.y ?? [0, 0];
    expect(y0).toBeGreaterThanOrEqual(1.2);
    expect(y1).toBeLessThanOrEqual(1.7);
    const tl = nominalTimeline(seg);
    const tFlip = timeAtS(tl, seg.s0 + 208 * seg.stride);
    const back = CAMS[0]!.back;
    const tAt = (ahead: number) => timeAtS(tl, plate.s0 + back - ahead) - tFlip;   // 门牌在镜头前 ahead 米的时刻
    expect(tAt(6)).toBeGreaterThanOrEqual(0.4);
    expect(tAt(4)).toBeLessThanOrEqual(1.2);
  });
});

describe('评审修复 U1 的数据形状', () => {
  const runSeg = (id: ChapterId, sid: string) => compile(ch(id)).segments.find((s) => s.def.id === sid)!;
  it('1-2 陈默：@113–@121 之间至少有一条边道上没有储物柜或任何 block（他要有地方让开）', () => {
    const seg = runSeg('ch1', '1-2');
    const s0 = seg.s0 + 113 * seg.stride, s1 = seg.s0 + 121 * seg.stride;
    const free = ([-1, 1] as const).filter((lane) => !seg.obstacles.some((o) => o.cls === 'block' && o.lanes.includes(lane) && o.s1 > s0 && o.s0 < s1));
    expect(free.length).toBeGreaterThanOrEqual(1);
    // 陈默本人与他留在过道里的脚仍在中道（§4.1）；他在脚之前让开
    const chen = seg.obstacles.find((o) => o.kind === 'chenMo')!;
    const foot = seg.obstacles.find((o) => o.kind === 'footOut' && o.params.itemId === 'chenmoFoot')!;
    expect(chen.lanes).toEqual([0]);
    expect(foot.lanes).toEqual([0]);
    expect(chen.behavior.type === 'yield' ? chen.behavior.atBeat : NaN).toBeLessThan(chen.beat);
  });
  it('1-2 陈默那场的减速：回到原速用 ≥ 1.2 s，并在撑跃那只脚之前回到稳定步频', () => {
    const seg = runSeg('ch1', '1-2');
    const slow = seg.events.find((e) => e.body.type === 'slow')!;
    const b = slow.body as Extract<typeof slow.body, { type: 'slow' }>;
    expect(b.ramp ?? 0.5).toBeGreaterThanOrEqual(1.2);
    const tl = nominalTimeline(seg);
    const foot = seg.obstacles.find((o) => o.kind === 'footOut' && o.params.itemId === 'chenmoFoot')!;
    const tSlowEnd = timeAtS(tl, seg.s0 + slow.at * seg.stride) + (b.ramp ?? 0.5) * 2 + b.seconds;
    const tFoot = timeAtS(tl, foot.s0 - 0.25);                 // 接触时刻（碰撞盒前沿）
    expect(tFoot - tSlowEnd, 'seconds between the end of the speed-up and the foot').toBeGreaterThanOrEqual(0.4);
  });
  it('1-3「它还在低头。」出字到消失都在替身低头保持的时间里', () => {
    const seg = runSeg('ch1', '1-3');
    const tl = nominalTimeline(seg);
    const tB = (b: number) => timeAtS(tl, seg.s0 + b * seg.stride);
    const mod = seg.events.find((e) => e.body.type === 'doubleMod' && e.id === 'mirrorLate')!;
    const hold = (mod.body as Extract<typeof mod.body, { type: 'doubleMod' }>).mod.headDownHold ?? 0;
    const text = seg.events.find((e) => e.body.type === 'text' && e.body.line === 'c1.stillDown')!;
    const t0 = tB(mod.at), tText = tB(text.at);
    const shown = (Array.from(lineText('c1.stillDown')).length * TEXT.msPerChar + TEXT.baseMs) / 1000;
    expect(tText).toBeGreaterThanOrEqual(t0);
    expect(tText + shown, `text gone at +${(tText + shown - t0).toFixed(2)} s, head held down for ${hold} s`).toBeLessThanOrEqual(t0 + hold + 1e-9);
  });
  it('5-9「像有人刚刚坐过。」在纸条收起之后（纸条显示 NOTE_OPEN.endAt 秒）', () => {
    const seg = ch('ch5').segments.find((s) => s.id === '5-9') as StillSegmentDef;
    const open = seg.events.find((e) => e.type === 'noteOpen')!;
    const sat = seg.events.find((e) => e.type === 'text' && e.line === 'c5.sat')!;
    const dent = seg.events.find((e) => e.type === 'actor' && e.clip === 'touchPillowDent')!;
    expect(sat.at).toBeGreaterThanOrEqual(open.at + NOTE_OPEN.endAt - 1e-9);
    expect(dent.at).toBeGreaterThanOrEqual(open.at + NOTE_OPEN.endAt - 1e-9);
  });
  it('1-2 陈默：perfect 自动驾驶从检查点 @96 起，在他让开到那只脚之间只按一次，是撑跃越过那只脚（不是抢先换进右道贴着他躲过去）', () => {
    const c = compile(ch('ch1'));
    const sim = new Sim(solver);
    sim.load(c, { segment: '1-2', beat: 96 }, c.seed);
    sim.setAutopilot('perfect');
    const acts: Array<{ beat: number; kind: string }> = [];
    let hits = 0;
    for (let i = 0; i < 120 * 30; i++) {
      sim.step([], new Set());
      const n = sim.snapshot();
      for (const e of sim.drain()) {
        if (e.type === 'hit') hits++;
        if (e.type === 'action') acts.push({ beat: n.player.beat, kind: String((e.data as { kind?: string }).kind) });
      }
      if (n.player.beat > 121 || n.segment !== '1-2') break;
    }
    expect(hits).toBe(0);
    const near = acts.filter((a) => a.beat > 112 && a.beat < 118.3 && ['lane', 'jump', 'duck'].includes(a.kind));
    expect(near.map((a) => a.kind)).toEqual(['jump']);
    expect(near[0]!.beat).toBeGreaterThan(116.5);
  });
  it('班长与马老师的组存在（不是中道上的障碍）；马老师的组是一个人，站在 5-8 七步起点的前方', () => {
    const groups = (id: ChapterId, sid: string) => ((ch(id).segments.find((s) => s.id === sid) as RunSegmentDef).npcs ?? []);
    expect(groups('ch3', '3-1').map((g) => g.id)).toContain('monitor');
    const s57 = ch('ch5').segments.find((s) => s.id === '5-7') as RunSegmentDef;
    const ma = groups('ch5', '5-7').find((g) => g.id === 'teacherMa')!;
    expect(ma).toBeDefined();
    expect(specialById(ma.id)).toBe('teacherMa');                        // WP6 的别名表认得这个 id
    expect(specialOfGroup(ma)).toBe('teacherMa');                         // 组也按马老师画（黑色运动裤、两侧白条）
    // 站立段沿用紧挨着的前一个跑段的组（§10.2）：5-8 从 5-7 的终点起身，往前走七步，他要在那附近
    const segs = ch('ch5').segments;
    expect(segs[segs.findIndex((s) => s.id === '5-7') + 1]?.id).toBe('5-8');
    expect(ma.from).toBeGreaterThanOrEqual(s57.beats);
    expect(ma.to).toBeLessThanOrEqual(s57.beats + 4);
    const seg = compile(ch('ch5')).segments.find((s) => s.def.id === '5-7')!;
    const out: Decor[] = [], info: GroupInfo[] = [];
    expandSegment(1705, seg, out, info);
    const gi = info.findIndex((g) => g.key === 'teacherMa');
    expect(out.filter((d) => d.group === gi)).toHaveLength(1);
    for (const id of IDS) for (const sg of compile(ch(id)).segments) {
      for (const o of sg.obstacles) expect(['monitor', 'teacherMa'].includes(String(o.params.itemId ?? '')), `${sg.def.id} ${o.kind}`).toBe(false);
    }
  });
  // 修复单元 A（第 3 轮）：说话的人在画面里。马老师（5-7）与班长（3-1）是 npc 组里的一个人：他们的台词出字时，人在追尾镜头前方、
  // 低画质雾的可读距离（R4 同一口径）以内，三条车道的横屏机位都在水平视角里。走动的人按「组的起点 + 速度 × 段内时间」算。
  it('马老师、班长说话时人在画面里（镜头前方、可读距离以内、水平视角里）', () => {
    const CAM_BACK = 2.35, HALF = (76 / 2) * (Math.PI / 180);
    const cases: Array<[ChapterId, string, string]> = [['ch5', '5-7', 'teacherMa'], ['ch3', '3-1', 'monitor']];
    for (const [id, sid, speaker] of cases) {
      const c = compile(ch(id));
      const seg = c.segments.find((x) => x.def.id === sid)!;
      const out: Decor[] = [], info: GroupInfo[] = [];
      expandSegment(c.seed, seg, out, info);
      const gi = info.findIndex((g) => g.key === speaker);
      const person = out.filter((d) => d.group === gi);
      expect(person, `${sid} ${speaker}`).toHaveLength(1);
      const p = person[0]!;
      const tl = nominalTimeline(seg);
      const rd = readDistance(seg.def.atmosphere);
      const lines = (seg.def as RunSegmentDef).events!.filter((e) => e.type === 'text' && 'speaker' in e && e.speaker === speaker);
      expect(lines.length, `${sid} ${speaker} lines`).toBeGreaterThan(0);
      for (const e of lines) {
        const sp = seg.s0 + e.at * seg.stride;
        const sN = p.s + p.speed * timeAtS(tl, sp);
        const ahead = sN - (sp - CAM_BACK);
        expect(ahead, `${sid} @${e.at}: ${speaker} ahead of the camera`).toBeGreaterThan(CAM_BACK + 0.5);
        expect(ahead, `${sid} @${e.at}: ${speaker} within the readable distance ${rd.toFixed(1)} m`).toBeLessThanOrEqual(rd);
        for (const lane of [-1, 0, 1]) expect(Math.atan2(Math.abs(p.x - 0.7 * lane * LANE_WIDTH), ahead), `${sid} @${e.at} lane ${lane}`).toBeLessThanOrEqual(HALF);
      }
    }
  });
  it('3-7：compound kit 在栏杆前只画门卫室，栏杆不能太靠后；「它在所有……」三句都在钻栏杆之前出字，红光那句在之后', () => {
    const seg = runSeg('ch3', '3-7');
    const bar = seg.obstacles.find((o) => o.kind === 'barrierArm')!;
    expect(bar.s0 - seg.s0, 'metres of street before the barrier').toBeLessThanOrEqual(24);
    const at = (l: string) => seg.events.find((e) => e.body.type === 'text' && [e.body.line].flat().includes(l as never))!.at;
    for (const l of ['c3.reflective', 'c3.seeSelf', 'c3.shouldStand']) expect(at(l), l).toBeLessThan(bar.beat);
    expect(at('c3.redLight')).toBeGreaterThan(bar.beat);
    // 「它不在我身后。」紧接「我已经知道回头没用。」，在 3-6 最后一排之后
    const s36 = ch('ch3').segments.find((s) => s.id === '3-6') as RunSegmentDef;
    const nb = (s36.events ?? []).find((e) => e.type === 'text' && e.line === 'c3.notBehind');
    expect(nb?.at).toBeGreaterThan(Math.max(...(s36.rows ?? []).map((r) => r[0])));
  });
  it('4-5 照原文「很慢，很慢。但比站着好。」（lead 裁定）：步幅 1.1–1.2 m、段首约 4.2 掌/s（约 5 m/s），渐变到 ≤ 6.5 m/s，「我们终于跑成了一样的速度。」之前已经稳定', () => {
    const s45 = runSeg('ch4', '4-5'), s41 = runSeg('ch4', '4-1');
    // AGENTS.md：清醒时步幅 1.0–1.1 m；lead 批准 4-5 用到 1.2 m（撑跃窗口 ≥ 0.16 s）
    expect(s45.stride).toBeGreaterThanOrEqual(1.1 - 1e-9);
    expect(s45.stride).toBeLessThanOrEqual(1.2 + 1e-9);
    // 按 Pace 实际推进（含段中的 cadence 事件），取每一拍的名义步频
    const cad: number[] = [];
    const p = createPaceState(s45, s45.s0, 0);
    const evs = paceEvents(s45);
    const beats = (s45.def as RunSegmentDef).beats;
    for (let b = (p.s - s45.s0) / s45.stride; b < beats; b = (p.s - s45.s0) / s45.stride) {
      if (cad.length <= Math.floor(b)) cad.push(nominalCadence(s45, p, b));
      advancePace(s45, p, evs, 1, TICK_DT);
    }
    expect(cad[0]!).toBeGreaterThanOrEqual(4.0);                         // 约 4.2 掌/s
    expect(cad[0]!).toBeLessThanOrEqual(4.6);
    expect(Math.max(...cad)).toBeLessThanOrEqual(5.4 + 1e-9);             // 到 5.4 掌/s 为止
    expect(cad[0]! * s45.stride).toBeGreaterThanOrEqual(4.6);
    expect(cad[0]! * s45.stride).toBeLessThanOrEqual(5.4);
    for (let b = 1; b < cad.length; b++) expect(cad[b]!).toBeGreaterThanOrEqual(cad[b - 1]! - 1e-9);   // 只会越来越快
    const vmax = Math.max(...cad) * s45.stride;
    expect(vmax).toBeLessThanOrEqual(6.5 + 1e-9);
    expect(vmax).toBeLessThan(0.75 * s41.cadenceAt(0) * s41.stride);
    const inSync = s45.events.find((e) => e.id === 'inSync')!;
    let lastChange = 0;
    for (let b = 1; b < cad.length; b++) if (Math.abs(cad[b]! - cad[b - 1]!) > 1e-6) lastChange = b;
    expect(inSync.at - lastChange, 'beats of steady cadence before 「我们终于跑成了一样的速度。」').toBeGreaterThanOrEqual(20);
    const first = s45.events.find((e) => e.body.type === 'text')!;
    expect(first.at).toBe(0);
    const body = first.body as Extract<typeof first.body, { type: 'text' }>;
    expect((Array.isArray(body.line) ? body.line : [body.line]).map((l) => lineText(l))).toEqual(['很慢，很慢。', '但比站着好。']);
  });
});

describe('校验器（验收 1：五章全部通过当前的 validate）', () => {
  it.each(IDS)('%s：没有 error，也没有 warning', (id) => {
    const r = validateChapter(ch(id), solver);
    expect(r.issues).toEqual([]);
  });
});
