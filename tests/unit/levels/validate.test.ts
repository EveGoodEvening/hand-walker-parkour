// tests/unit/levels/validate.test.ts —— 校验器 R1–R13 与静态检查（DESIGN.md §2.8、§10.1、§8.10 WP1 验收 5；
// lead 补充要求 1：R3、R4、R6、R7 的检出各有单元测试）。每条规则都用最小的合成章节造一次违规，再确认干净的数据零 error。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import test from '../../../src/levels/chapters/test';
import { availableChapters, getChapter } from '../../../src/levels/chapters/index';
import { compile } from '../../../src/levels/compile';
import { lineText } from '../../../src/levels/lines';
import type { ChapterDef, RunSegmentDef, SegmentDef, TimedEventDef } from '../../../src/levels/schema';
import {
  CHALK_MIN, DARK_ATMOSPHERES, lookBackRestEnd, nominalTimeline, normalizeLint, runLint, surfaceVisible, timeAtS, validateChapter, WAIVERS,
} from '../../../src/levels/validate';
import { solver } from '../../../src/sim/Solver';
import { chapter, MECH_RUN, runSeg, SEVEN, stillSeg } from '../sim/fixtures';

const errors = (def: ChapterDef) => validateChapter(def, solver).issues.filter((i) => i.level === 'error');
const rules = (def: ChapterDef) => errors(def).map((i) => i.rule);
const one = (o: Partial<RunSegmentDef>, extra: SegmentDef[] = [], c: Partial<ChapterDef> = {}) => chapter([runSeg({ beats: 60, cadence: 4.4, ...o }), ...extra], c);

describe('干净的数据零 error', () => {
  for (const def of [test, MECH_RUN] as ChapterDef[]) {
    it(`${def.name}（${def.id}）`, () => { expect(errors(def)).toEqual([]); });
  }
  for (const id of availableChapters()) {
    it(`${id}（已实现的章节）`, () => { expect(errors(getChapter(id) as ChapterDef)).toEqual([]); });
  }
});

describe('R1 / R2 / R3', () => {
  it('R1：一行三个挡道', () => {
    expect(rules(one({ rows: [[30, 'BBB']], events: [{ at: 2, type: 'hint', hint: 'lane' }] }))).toContain('R1');
  });
  it('R2：每个切片都有空道，但来不及换过去', () => {
    const r = rules(one({ rows: [[20, '.BB'], [20.6, 'BB.']], events: [{ at: 2, type: 'hint', hint: 'lane' }] }));
    expect(r).toContain('R2');
    expect(r).not.toContain('R1');
  });
  it('R3：连换两道只能相隔 < 0.9 s（第一章的最小间隔），但 0.22 s 的物理间隔可以', () => {
    const r = rules(one({ rows: [[20, 'BB.'], [23, '.BB']], events: [{ at: 2, type: 'hint', hint: 'lane' }] }));
    expect(r).toContain('R3');
    expect(r).not.toContain('R2');
  });
  it('R2：人群段不开口也必须有解（noAsk）', () => {
    const r = rules(one({ crowd: true, items: [{ at: 30, lane: 'all', kind: 'legs', behavior: { type: 'askable', ignore: false } }], events: [{ at: 2, type: 'hint', hint: 'lane' }] }));
    expect(r).toContain('R2');
    expect(errors(one({ crowd: true, items: [{ at: 30, lane: 'all', kind: 'legs', behavior: { type: 'askable', ignore: false } }], events: [{ at: 2, type: 'hint', hint: 'lane' }] }))
      .find((i) => i.rule === 'R2')!.msg).toContain('noAsk');
  });
});

describe('R4：从可读到接触 ≥ 1.2 s', () => {
  it('雾很近（homeDark）又很快（7.5 m/s）：报 R4', () => {
    const r = rules(one({ atmosphere: 'homeDark', stride: 1.5, cadence: 5, rows: [[20, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }] }));
    expect(r).toContain('R4');
  });
  it('到点才摔进车道的人（fallInto）：从出现到接触 < 1.2 s 报 R4；迎面走来的人按相对速度算', () => {
    const late = errors(one({ cadence: 4.8, items: [{ at: 30, lane: 0, kind: 'kneeler', behavior: { type: 'fallInto', atBeat: 27 } }], events: [{ at: 2, type: 'hint', hint: 'jump' }] }));
    expect(late.filter((i) => i.rule === 'R4').map((i) => i.msg).join()).toContain('fallInto');
    expect(rules(one({ cadence: 4.8, items: [{ at: 30, lane: 0, kind: 'kneeler', behavior: { type: 'fallInto', atBeat: 22 } }], events: [{ at: 2, type: 'hint', hint: 'jump' }] }))).not.toContain('R4');
    const oncoming = one({ atmosphere: 'nightIndoor', stride: 1.1, cadence: 5.2, items: [{ at: 50, lane: 0, kind: 'legs', behavior: { type: 'walk', speed: -6 } }], events: [{ at: 2, type: 'hint', hint: 'lane' }] });
    expect(rules(oncoming)).toContain('R4');
    const sameWay = one({ atmosphere: 'nightIndoor', stride: 1.1, cadence: 5.2, items: [{ at: 50, lane: 0, kind: 'legs', behavior: { type: 'walk', speed: 1.2 } }], events: [{ at: 2, type: 'hint', hint: 'lane' }] });
    expect(rules(sameWay)).not.toContain('R4');
  });
  it('同样的障碍在晨雾（清晰距离约 20 m）里没问题', () => {
    expect(rules(one({ stride: 1.5, cadence: 5, rows: [[20, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }] }))).not.toContain('R4');
  });
});

describe('R5 / R8', () => {
  it('R5：文字后 0.8 s 内需要动作', () => {
    expect(rules(one({ rows: [[30, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 29, type: 'text', line: 'c1.hey' }] }))).toContain('R5');
  });
  it('R8：检查点后 1.6 s 内需要动作', () => {
    expect(rules(one({ rows: [[4, 'LLL']], events: [{ at: 0, type: 'hint', hint: 'jump' }] }))).toContain('R8');
  });
});

describe('R6：主异常', () => {
  const lookThenShadow = (auto: boolean) => ({ id: 'wl', from: 20, to: 40, type: 'lookBack' as const, auto, gain: 1 as const, then: [{ at: 0.9, type: 'shadow' as const, mode: 'jellyfish' as const, seconds: 2 }] });
  const memAt = (at: number, auto = true) => one({
    beats: 170, cadence: 4.8,
    surfaces: [{ id: 'win', kind: 'window', side: 'L', from: 125, to: 160, y: [1, 2.2], backdrop: 'evening' }],
    windows: [lookThenShadow(auto)],
    events: [{ at, type: 'memory', what: 'handstandWindow', surface: 'win', seconds: 1.2 }],
  });
  it('最坏时序（不按 Q、窗口结束时才回头）：间隔 < 20 s 报 error（§10.1）', () => {
    // 窗口开始时回头：水母影子 5.1 s，记忆 27.1 s → 22 s；窗口结束时回头：影子 9.2 s → 只隔 17.9 s
    const e = errors(memAt(130)).filter((i) => i.rule === 'R6');
    expect(e.length).toBe(1);
    expect(e[0]!.msg).toContain('worst case');
    expect(e[0]!.level).toBe('error');
    expect(errors(memAt(130, false)).some((i) => i.rule === 'R6')).toBe(true);   // 不自动的窗口：玩家也可能拖到最后才按
  });
  it('跟随者登场只算从 hidden 出来（1-5）；absent 之后回来不算主异常', () => {
    const mk = (from: 'hidden' | 'absent') => chapter([runSeg({ beats: 120, cadence: 4.8, follower: { mode: from },
      surfaces: [{ id: 'm', kind: 'mirror', side: 'L', from: 30, to: 60 }],
      events: [{ at: 20, type: 'follower', def: { mode: 'behind', steady: 3 } }, { at: 40, type: 'doubleMod', target: 'd', mod: { headLag: 0.6 } },
        { at: 30, type: 'double', spec: { id: 'd', surface: 'm', source: 'history' } }] })]);
    expect(errors(mk('hidden')).some((i) => i.rule === 'R6' && i.msg.includes('follower'))).toBe(true);
    expect(errors(mk('absent')).some((i) => i.rule === 'R6')).toBe(false);
  });
  it('两种时序都 ≥ 20 s 就通过', () => {
    expect(rules(memAt(150))).not.toContain('R6');
  });
  it('异常前 1 s 到后 2 s 内需要动作：报 R6（休息窗）', () => {
    const r = rules(one({ beats: 60, cadence: 4.8, surfaces: [{ id: 'm', kind: 'mirror', side: 'L', from: 20, to: 50 }],
      rows: [[30, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 29, type: 'double', spec: { id: 'd', surface: 'm', source: 'history' } }] }));
    expect(r).toContain('R6');
  });
  it('几何：挂在反光面上的异常必须三条车道都看得见；世界替身必须 ≥ 6 m', () => {
    const behind = one({ beats: 40, cadence: 4.8, surfaces: [{ id: 'w', kind: 'window', side: 'L', from: 10, to: 10.5 }],
      events: [{ at: 12, type: 'memory', what: 'handstandWindow', surface: 'w', seconds: 1 }] });
    expect(errors(behind).filter((i) => i.rule === 'R6').map((i) => i.msg).join()).toContain('not visible');
    const near = one({ beats: 40, cadence: 4.8, events: [{ at: 12, type: 'double', spec: { id: 'me', surface: 'world', source: 'script', anchor: { sAhead: 4, lane: 0 } } }] });
    expect(errors(near).filter((i) => i.rule === 'R6').map((i) => i.msg).join()).toContain('< 6 m');
    const ok = one({ beats: 40, cadence: 4.8, events: [{ at: 12, type: 'double', spec: { id: 'me', surface: 'world', source: 'script', anchor: { sAhead: 9, lane: 0 } } }] });
    expect(rules(ok)).not.toContain('R6');
  });
  it('surfaceVisible：侧墙镜要进水平视角 ±38°；端墙镜在正前方', () => {
    const wall = { id: 'x', kind: 'mirror' as const, side: 'L' as const, from: 0, to: 0, s0: 10, s1: 14, plane: [1, 0, 0, 1.8] as [number, number, number, number] };
    expect(surfaceVisible(wall, 8, 1, 40)).toBe(true);        // 镜子在镜头前 4.35–8.35 m
    expect(surfaceVisible(wall, 14, 1, 40)).toBe(false);      // 镜头已经走到镜子旁边，镜子出了视角
    const end = { ...wall, side: 'end' as const, s0: 20, s1: 20 };
    for (const lane of [-1, 0, 1] as const) expect(surfaceVisible(end, 10, lane, 40)).toBe(true);
  });
});

describe('R7：新类别首次出现', () => {
  it('第一次出现的那一行混了别的类别', () => {
    expect(rules(one({ rows: [[20, 'LH.']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 3, type: 'hint', hint: 'duck' }] }))).toContain('R7');
  });
  it('接触前 1.2 s 没有提示', () => {
    const e = errors(one({ rows: [[20, '.L.']], events: [{ at: 18, type: 'hint', hint: 'jump' }] })).filter((i) => i.rule === 'R7');
    expect(e.map((i) => i.msg).join()).toContain('hint');
  });
  it('接触后 1.2 s 内又需要动作（最小间隔本身满足）', () => {
    const r = rules(one({ cadence: 4.8, rows: [[20, 'LLL'], [25, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }] }));
    expect(r).toContain('R7');
    expect(r).not.toContain('R3');
  });
  it('「首次」按整部作品算：第二章起三个类别都已在第一章学过，不再要求隔离与提示', () => {
    const mixed = { rows: [[20, 'LH.'], [40, 'B.L']] as Array<[number, string]> };
    expect(rules(one(mixed))).toContain('R7');                                   // test 章：独立校验
    expect(rules(one(mixed, [], { id: 'ch2' }))).not.toContain('R7');
  });
  it('同类别占多条车道允许（1-2 @68 的 HHH）；已学类别的新种类只报 warning', () => {
    const r = validateChapter(one({ kit: 'corridor', variant: 'morning', rows: [[20, 'HHH'], [40, 'BB.']], events: [{ at: 2, type: 'hint', hint: 'duck' }, { at: 25, type: 'hint', hint: 'lane' }] }), solver);
    expect(r.issues.filter((i) => i.rule === 'R7' && i.level === 'error')).toEqual([]);
  });
});

describe('R9：腿自主抬起与腿偏移', () => {
  it('第二章起：抬起既不在横档前 0.4 s，也不在空地上', () => {
    const r = rules(one({ cadence: 4.8, rows: [[24, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 20, type: 'twitch', hold: 0.25 }] }));
    expect(r).toContain('R9');
  });
  it('抬起落在横档前 0.4 s、或者空地上：通过', () => {
    expect(rules(one({ cadence: 4.8, rows: [[30, 'HHH']], events: [{ at: 2, type: 'hint', hint: 'duck' }, { at: 25, type: 'twitch', hold: 0.25 }] }))).not.toContain('R9');
    expect(rules(one({ cadence: 4.8, events: [{ at: 20, type: 'twitch', hold: 0.25 }] }))).not.toContain('R9');
  });
  it('腿偏移之后 1.2 s 内，被迫进入的车道上有 block', () => {
    const r = errors(one({ cadence: 4.8, rows: [[24, '.B.']], events: [{ at: 2, type: 'hint', hint: 'lane' }, { at: 20, type: 'drift', dir: -1 }] }));
    expect(r.filter((i) => i.rule === 'R9').map((i) => i.msg).join()).toContain('forces lane 0');
  });
});

describe('R10 / R11 / R12 / R13', () => {
  it('R10：回头窗口短于 1.2 s', () => {
    expect(rules(one({ windows: [{ from: 20, to: 21, type: 'lookBack' }] }))).toContain('R10');
  });
  it('R10：窗口开始到结束 + 后续文字 + 0.8 s 内需要动作', () => {
    const r = rules(one({ cadence: 4.8, rows: [[36, 'LLL']], windows: [{ from: 20, to: 30, type: 'lookBack', then: [{ at: 0, type: 'text', line: 'c1.empty' }] }], events: [{ at: 2, type: 'hint', hint: 'jump' }] }));
    expect(r).toContain('R10');
  });
  it('R10：后续文字的时长按字幕停留算（字数 × 90 ms + 800 ms，§7.2），取最后一句消失的时刻', () => {
    const dur = (ids: string[]) => (ids.map((i) => Array.from(lineText(i)).length).reduce((a, b) => a + b, 0) * 90 + 800) / 1000;
    const then = (xs: Array<[number, string | string[]]>) => xs.map(([at, line]) => ({ at, type: 'text', line })) as unknown as TimedEventDef[];
    expect(lookBackRestEnd(6.25, [])).toBeCloseTo(6.25 + 0.8, 9);
    expect(lookBackRestEnd(6.25, then([[0.5, 'c1.soundStood']]))).toBeCloseTo(6.25 + 0.5 + dur(['c1.soundStood']) + 0.8, 9);
    // 不是最后出字的那句，而是最后**消失**的那句；两行的字幕按两行字数合计
    const xs = then([[0, 'c1.soundStood'], [1.2, 'c1.empty'], [0.3, ['c1.empty', 'c1.shadowProne']]]);
    const want = Math.max(dur(['c1.soundStood']), 1.2 + dur(['c1.empty']), 0.3 + dur(['c1.empty', 'c1.shadowProne']));
    expect(lookBackRestEnd(10, xs)).toBeCloseTo(10 + want + 0.8, 9);
    // 不是文字的后续事件（影子）不计时长
    expect(lookBackRestEnd(10, [{ at: 3, type: 'shadow', mode: 'jellyfish', seconds: 3 } as TimedEventDef])).toBeCloseTo(10.8, 9);
  });
  it('R10 的精确边界：休息窗正好盖住最后一个可行的输入时刻就报 error，早 0.01 s 结束就通过（旧的 0.8 s 估算两种都放过）', () => {
    // 4.8 掌/s × 1.0 m：窗口 @20–30 = 4.17–6.25 s。@46 一整行低矮障碍，只能在某个时刻之前起跳。
    const mk = (at: number) => one({ cadence: 4.8, rows: [[46, 'LLL']], events: [{ at: 2, type: 'hint', hint: 'jump' }],
      windows: [{ id: 'wl', from: 20, to: 30, type: 'lookBack', then: [{ at, type: 'text', line: 'c1.soundStood' }] }] });
    const seg = compile(mk(0)).segments[0]!;
    const tl = nominalTimeline(seg);
    const b = timeAtS(tl, seg.s0 + 30 * seg.stride);
    expect(b).toBeCloseTo(6.25, 6);
    // 最后一个可行的输入时刻 L（求解网格 0.05 s）：禁止 [0, L] 内开始输入就无解
    let L = -1;
    for (let k = 140; k < 240; k++) { const x = k * 0.05; if (!solver.solve(seg, { forbid: [[0, x]] })) { L = x; break; } }
    expect(L).toBeGreaterThan(b);
    const textSpan = lookBackRestEnd(b, [{ at: 0, type: 'text', line: 'c1.soundStood' } as TimedEventDef]) - b - 0.8;
    const atExact = L - (b + textSpan + 0.8);           // 让休息窗的终点正好落在 L
    expect(atExact).toBeGreaterThan(0);
    const hit = errors(mk(atExact)).filter((i) => i.rule === 'R10');
    expect(hit.length).toBe(1);
    expect(hit[0]!.msg).toContain(`, ${L.toFixed(2)}]s`);
    expect(rules(mk(atExact - 0.01))).not.toContain('R10');
    // 旧实现按每句 0.8 s 估算：终点 = b + at + 0.8 + 0.8，比 L 早得多，会把这处违规放过去
    expect(b + atExact + 0.8 + 0.8).toBeLessThan(L - 1);
  });
  it('R11：端盘段有低矮障碍', () => {
    expect(rules(one({ controls: { jump: false }, rows: [[30, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }] }))).toContain('R11');
  });
  it('R12：暗色氛围都带描边；R4：非暗色氛围里关灯 / 声控灯的区间有必需障碍时报 error（没有灯也没有描边）', () => {
    for (const a of DARK_ATMOSPHERES) expect(CHALK_MIN[a]).toBeGreaterThanOrEqual(0.15);
    const lit = (atmosphere: RunSegmentDef['atmosphere'], ev: object) => one({ atmosphere, rows: [[30, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }, ev as never] });
    const out = errors(lit('morning', { at: 20, type: 'lights', op: 'out', from: 20, to: 40 })).filter((i) => i.rule === 'R4');
    expect(out.length).toBe(1);
    expect(out[0]!.msg).toContain('lights out');
    expect(rules(lit('morning', { at: 20, type: 'lights', op: 'sound', from: 20, to: 40 }))).toContain('R4');
    // 没写 to：到下一个 lights on 为止
    const closed = one({ rows: [[30, '.L.']], events: [{ at: 2, type: 'hint', hint: 'jump' }, { at: 10, type: 'lights', op: 'out' }, { at: 20, type: 'lights', op: 'on' }] });
    expect(rules(closed)).not.toContain('R4');
    expect(rules(lit('morning', { at: 20, type: 'lights', op: 'out', from: 34, to: 40 }))).not.toContain('R4');
    expect(rules(lit('morning', { at: 20, type: 'lights', op: 'flicker', from: 20, to: 40, every: 1 }))).not.toContain('R4');
    // 暗色氛围：所有必需障碍都带粉笔描边，关灯也读得到
    const dark = validateChapter(lit('nightIndoor', { at: 20, type: 'lights', op: 'out', from: 20, to: 40 }), solver);
    expect(dark.issues.some((i) => i.rule === 'R12' || i.rule === 'R4')).toBe(false);
  });
  it('R13：静场 > 15 s、非跑动占比 > 25%、七步的实际时长 > 15 s', () => {
    expect(rules(one({}, [stillSeg({ duration: 16 })]))).toContain('R13');
    expect(errors(chapter([stillSeg({ duration: 12 }), runSeg({ beats: 60, cadence: 4.4 })])).map((i) => i.msg).join()).toContain('non-run');
    const longSeven = { ...SEVEN, events: [...SEVEN.events, { atStep: 7, delay: 9, type: 'text' as const, line: 'c1.iSaw' as const }] };
    expect(errors(chapter([longSeven, runSeg({ beats: 400 })])).find((i) => i.rule === 'R13')?.msg).toContain('seven');
  });
});

describe('静态检查', () => {
  it('台词、变体、纸条、必备节拍、符号、范围', () => {
    const bad = chapter([
      runSeg({ id: 'a', kit: 'corridor', variant: 'nope', beats: 40, events: [{ at: 2, type: 'text', line: 'zz.none' as never }] }),
      runSeg({ id: 'b', kit: 'labRoom', variant: 'default', beats: 40, rows: [[20, '.W.']], checkpoints: [50], notes: [{ at: 10, lane: 0, note: 'ghost' }] }),
      stillSeg({ id: 'c', events: [{ at: 1, type: 'noteGet', note: 'ghost2' }] }),
    ], { requiredBeats: ['missing'], notes: [1, 2, 3, 4].map((i) => ({ id: `n${i}`, face: 'blank' as const, front: null, back: null, folded: false, pickup: true })) });
    const msgs = errors(bad).filter((i) => i.rule === 'static').map((i) => i.msg).join('\n');
    for (const frag of ['zz.none', 'variant corridor.nope', 'symbol W', 'checkpoint @50', 'ghost"', 'ghost2', 'requiredBeat "missing"', '4 notes']) expect(msgs).toContain(frag);
  });
  it('七步必须有起身输入', () => {
    expect(errors(chapter([{ ...SEVEN, input: undefined } as never, runSeg({ beats: 400 })])).map((i) => i.msg).join()).toContain('no rise input');
  });
});

describe('豁免只认 lead 的书面批准（lead 补充要求 2、§10.1）', () => {
  it('每条豁免的 approval 都逐字出现在 DESIGN.md §10（lead 修订记录）里；工作包不得自行降级', () => {
    const design = readFileSync(new URL('../../../docs/DESIGN.md', import.meta.url), 'utf8');
    const s10 = design.slice(design.indexOf('## 10. Lead 修订记录'));
    expect(s10.length).toBeGreaterThan(0);
    for (const w of WAIVERS) expect(s10.includes(w.approval), `${w.chapter} ${w.rule}: approval text not in DESIGN §10`).toBe(true);
  });
  it('已实现章节的 R6（含最坏时序）一律报 error，没有降成 warning 的', () => {
    for (const id of availableChapters()) {
      const r = validateChapter(getChapter(id) as ChapterDef, solver);
      expect(r.issues.filter((i) => i.rule === 'R6' && i.level === 'warn').map((i) => i.msg)).toEqual([]);
      expect(r.issues.filter((i) => i.msg.startsWith('[waived') && !WAIVERS.some((w) => i.msg.endsWith(w.msg)))).toEqual([]);
    }
  });
});

describe('R14：接入 WP2 的 lint（src/levels/lint.ts，入口约定见 docs/contract-requests/WP1.md）', () => {
  it('normalizeLint：数组、字符串、{ issues }、{ errors, warnings }、message / severity 都认；认不出的结构按 error', () => {
    expect(normalizeLint([], 'ch1')).toEqual([]);
    expect(normalizeLint(undefined, 'ch1')).toEqual([]);
    const a = normalizeLint(['用了感叹号', { level: 'warn', rule: 'B.8', msg: '太长', where: 'c2.x' }, { severity: 'warning', message: 'm' }], 'ch2');
    expect(a.map((i) => [i.level, i.rule, i.chapter])).toEqual([['error', 'R14', 'ch2'], ['warn', 'B.8', 'ch2'], ['warn', 'R14', 'ch2']]);
    expect(a[1]!.msg).toBe('c2.x: 太长');
    expect(normalizeLint({ issues: [{ level: 'error', msg: 'x' }] }, 'text').map((i) => i.level)).toEqual(['error']);
    expect(normalizeLint({ errors: ['e'], warnings: ['w'] }, 'text').map((i) => i.level)).toEqual(['error', 'warn']);
    expect(normalizeLint(42, 'text')[0]!.level).toBe('error');
  });
  it('runLint：lintAll 跑一次、lintChapter 每章一次；抛错、一个入口都没有都按 error', () => {
    const seen: string[] = [];
    const ok = runLint({ lintAll: () => [], lintChapter: (d: ChapterDef) => { seen.push(d.id); return d.id === 'test' ? [{ level: 'error', msg: '「！」' }] : []; } }, [test as ChapterDef, { ...(test as ChapterDef), id: 'ch2' }]);
    expect(ok.entries).toEqual(['lintAll', 'lintChapter']);
    expect(seen).toEqual(['test', 'ch2']);
    expect(ok.issues.map((i) => [i.level, i.chapter])).toEqual([['error', 'test']]);
    const threw = runLint({ lintAll: () => { throw new Error('boom'); } }, []);
    expect(threw.issues[0]!.msg).toContain('boom');
    const none = runLint({ checkLines: () => [] }, []);
    expect(none.entries).toEqual([]);
    expect(none.issues[0]!.level).toBe('error');
    expect(none.issues[0]!.msg).toContain('checkLines');
  });
});
