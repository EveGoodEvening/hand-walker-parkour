#!/usr/bin/env node
// scripts/bot-difficulty.mjs —— human 机器人难度报告（DESIGN.md §2.8、§8.10 WP1 验收 6、§8.11 集成时用它调 tuning 和谱面密度）。WP1。
// 用 tsx 运行（npm run bot:difficulty）：直接在 Node 里跑模拟，不开浏览器。
// 对每章每个检查点区间（跑段起点与段内 checkpoints 之间），从检查点开始（稳度回满），用 human 机器人跑 N 次（机器人种子 1..N），
// 失败率 = 这个区间里摔倒的比例。§2.8 的目标是「每个检查点区间」的：第一章 ≤ 5%……第五章 ≤ 20%（上限）。
// 判定按区间：「可能失败」的区间（追随者不是 hidden）里，失败率 > 目标 + 3 个百分点的区间记 over（区间的 status），
// 有任何一个 over，这一章的 status 就是 harder。章的平均值、最大值只作参考。
// 比目标低 3 个百分点以上（WP1 验收 6「目标 ±3 个百分点」的下沿）：区间与章的 band 记 below、章另注 note 'well below target'，
// status 仍是 ok——§2.8 的目标是上限，偏易不算不合格（这一解释写在 docs/contract-requests/WP1.md，待 lead 确认）。
// 评审 U2：
//   · 机器人报告「从换道输入到接触的平均提前量」（laneLead）：每个区间、每章和全部（秒），只算躲开障碍的换道，见 HumanBot.ts。
//     另报分布：laneLeadMedian、laneLeadP25（秒）和 laneLeadUnder（提前量 < 0.25 s 的比例）。回中道时原车道远处还有障碍也算躲避，
//     这类样本 1–3 s，会把均值拉高，所以看「最后一刻闪避」要看中位数和 < 0.25 s 的比例。
//   · 每个跑段的绝对密度（validate.ts 的 segmentDensity：去掉纸条，求解器按本章 MIN_ACTION_GAP 求最少输入路线）：
//     章的 segments 里每段有 inputsPer10Beats、inputsPerSec、maxIdleSec。§2.8 / §4 点名的段（DENSITY_TARGET）低于目标的 60%
//     时记 warning（status 仍是 ok），缺省只打印、不改变退出码（--strict 或 --strict-density 时才算失败）。
//   --trials N    每个区间的次数（缺省 40）      --ch ch3    只跑一章          --out FILE   另把 JSON 写进文件
//   --only 4-5@144  只跑这些区间（逗号分隔；只写段名则跑这一段的全部区间）
//   --strict      有任何区间 over（章 status 为 harder），或有任何密度 warning 时，退出码 1（缺省只报告）
//   --strict-density  只在有密度 warning 时退出码 1（不看失败率）
// 还没实现的章（WP2 合并前返回 null 的桩）打印 skipped。
import { writeFileSync } from 'node:fs';
import { MIN_ACTION_GAP } from '../src/core/constants.ts';
import { compile } from '../src/levels/compile.ts';
import { CHAPTER_ORDER, getChapter } from '../src/levels/chapters/index.ts';
import { densityWarning, segmentDensity } from '../src/levels/validate.ts';
import { Sim } from '../src/sim/Sim.ts';
import { solver } from '../src/sim/Solver.ts';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const trials = Number(arg('--trials', 40));
const only = arg('--ch', null);
const out = arg('--out', null);
const strict = args.includes('--strict');
const strictDensity = args.includes('--strict-density');
const onlyIntervals = arg('--only', null)?.split(',').map((x) => x.trim()).filter(Boolean) ?? null;
const wanted = (segId, from) => !onlyIntervals || onlyIntervals.some((w) => w === segId || w === `${segId}@${from}`);
/** §2.8 human 机器人目标失败率（每个检查点区间）。 */
const TARGET = { ch1: 0.05, ch2: 0.10, ch3: 0.18, ch4: 0.12, ch5: 0.20 };
const TOL = 0.03;
const MAX_SEC = 120;
/** 「最后一刻闪避」的界线（秒）：评审 U2 的验收要求平均提前量 ≥ 这个值，报告另给低于它的比例。 */
const LAST_MOMENT = 0.25;

function runInterval(compiled, seg, cp, nextCp, trial) {
  const sim = new Sim(solver);
  sim.load(compiled, { segment: seg.def.id, beat: cp }, compiled.seed);
  sim.setAutopilot('human');
  sim.setBotSeed(trial);
  const held = new Set();
  const segIndex = seg.index;
  let canFail = false;
  const lead = () => ({ leadSum: sim.botStats.laneLeadSum, leadN: sim.botStats.laneLeadN, leads: sim.botStats.laneLeads });
  for (let n = 0; n < 120 * MAX_SEC; n++) {
    sim.step([], held);
    sim.drain();
    const s = sim.snapshot();
    if (s.follower.mode !== 'hidden' && s.segKind === 'run') canFail = true;
    if (s.player.mode === 'fall') return { fell: true, hits: s.stats.stumbles + s.stats.crashes, canFail, ...lead() };
    if (sim.isEnded || s.segIndex !== segIndex || s.segBeat >= nextCp) return { fell: false, hits: s.stats.stumbles + s.stats.crashes, canFail, ...lead() };
  }
  return { fell: false, hits: 0, timeout: true, canFail, ...lead() };
}

const t0 = Date.now();
const report = { trials, target: TARGET, tolerance: TOL, chapters: [] };
let outOfRange = 0, densityWarnings = 0;
let allLeadSum = 0, allLeadN = 0;
const allLeads = [];
const r3 = (x) => +x.toFixed(3);
/** 提前量样本的分布：中位数、下四分位数、< LAST_MOMENT 的比例（没有样本时为 null）。 */
function leadDist(xs) {
  if (!xs.length) return { laneLeadMedian: null, laneLeadP25: null, laneLeadUnder: null };
  const a = [...xs].sort((p, q) => p - q);
  const at = (f) => a[Math.floor(f * (a.length - 1))];
  return { laneLeadMedian: r3(at(0.5)), laneLeadP25: r3(at(0.25)), laneLeadUnder: r3(a.filter((x) => x < LAST_MOMENT).length / a.length) };
}
const fmtDist = (d) => d.laneLeadMedian === null ? '-' : `median ${d.laneLeadMedian} s, p25 ${d.laneLeadP25} s, ${(d.laneLeadUnder * 100).toFixed(1)}% < ${LAST_MOMENT} s`;
for (const id of only ? [only] : CHAPTER_ORDER) {
  const def = getChapter(id);
  if (!def) { console.error(`- ${id}: not implemented yet (skipped)`); report.chapters.push({ chapter: id, skipped: true }); continue; }
  const compiled = compile(def);
  const intervals = [];
  let chLeadSum = 0, chLeadN = 0;
  const chLeads = [];
  for (const seg of compiled.segments) {
    if (seg.kind !== 'run') continue;
    const cps = seg.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (!wanted(seg.def.id, cp)) continue;
      const next = i + 1 < cps.length ? cps[i + 1] : seg.def.beats;
      let falls = 0, hits = 0, timeouts = 0, canFail = true, leadSum = 0, leadN = 0;
      const leads = [];
      for (let k = 1; k <= trials; k++) {
        const r = runInterval(compiled, seg, cp, next, k);
        if (r.fell) falls++;
        hits += r.hits;
        if (r.timeout) timeouts++;
        canFail = r.canFail;
        leadSum += r.leadSum; leadN += r.leadN;
        for (const x of r.leads) leads.push(x);
      }
      chLeadSum += leadSum; chLeadN += leadN;
      for (const x of leads) chLeads.push(x);
      const failRate = falls / trials;
      const target = TARGET[id];
      const band = !canFail ? 'cannotFail' : failRate > target + TOL ? 'over' : failRate < target - TOL ? 'below' : 'in';
      intervals.push({
        segment: seg.def.id, from: cp, to: next, canFail, failRate, meanHits: +(hits / trials).toFixed(3), timeouts, band, status: band === 'over' ? 'over' : 'ok',
        laneLead: leadN ? r3(leadSum / leadN) : null, laneLeadCount: leadN, ...leadDist(leads),
      });
    }
  }
  allLeadSum += chLeadSum; allLeadN += chLeadN;
  for (const x of chLeads) allLeads.push(x);
  // 每个跑段的绝对密度（§2.8），点名的段低于目标 60% 记 warning
  const segments = [];
  for (const seg of compiled.segments) {
    if (seg.kind !== 'run' || (onlyIntervals && !onlyIntervals.some((w) => w.split('@')[0] === seg.def.id))) continue;
    const d = segmentDensity(seg, MIN_ACTION_GAP[id], solver);
    if (!d) { segments.push({ segment: seg.def.id, status: 'ok', warning: 'no route (density not measured)' }); continue; }
    const warning = densityWarning(d);
    if (warning) { densityWarnings++; console.error(`${id} density warning: ${warning}`); }
    segments.push({
      segment: d.segment, beats: d.beats, inputs: d.inputs, inputsPer10Beats: r3(d.inputsPer10Beats), inputsPerSec: r3(d.inputsPerSec),
      maxIdleSec: r3(d.maxIdleSec), maxIdleFrom: r3(d.maxIdleFrom), minGap: d.minGap, ...(d.gapRelaxed ? { gapRelaxed: true } : {}),
      status: 'ok', ...(warning ? { warning } : {}), route: d.route,
    });
  }
  const live = intervals.filter((x) => x.canFail);
  const rates = live.map((x) => x.failRate);
  const mean = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
  const max = Math.max(0, ...rates);
  const target = TARGET[id];
  // §2.8：目标按每个检查点区间判定，任何一个区间超过目标 + 3 个百分点，这一章就不合格
  const hot = live.filter((x) => x.band === 'over').map((x) => `${x.segment}@${x.from}`);
  const status = hot.length ? 'harder' : 'ok';
  const band = hot.length ? 'over' : live.length && live.every((x) => x.band === 'below') ? 'below' : 'in';
  const note = band === 'below' ? 'well below target' : undefined;
  if (status !== 'ok') outOfRange++;
  const laneLead = chLeadN ? r3(chLeadSum / chLeadN) : null;
  const chDist = leadDist(chLeads);
  report.chapters.push({ chapter: id, target, status, band, ...(note ? { note } : {}), over: hot, failRate: +mean.toFixed(4), maxInterval: +max.toFixed(4), laneLead, laneLeadCount: chLeadN, ...chDist, intervals, segments });
  console.error(`${id}: ${live.length} interval(s) that can fail, fail rate per interval ${live.map((x) => `${x.segment}@${x.from} ${(x.failRate * 100).toFixed(1)}%`).join(', ') || '-'} (mean ${(mean * 100).toFixed(1)}%, max ${(max * 100).toFixed(1)}%), target ≤ ${(target * 100).toFixed(0)}% (+3) per interval → ${status}${note ? ` (${note})` : ''}${hot.length ? `; over target: ${hot.join(', ')}` : ''}; lane-change lead mean ${laneLead ?? '-'} s (${chLeadN}; ${fmtDist(chDist)})`);
}
report.laneLead = allLeadN ? r3(allLeadSum / allLeadN) : null;
report.laneLeadCount = allLeadN;
Object.assign(report, leadDist(allLeads));
report.densityWarnings = densityWarnings;
report.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
console.error(`all: mean lane-change lead before contact ${report.laneLead ?? '-'} s over ${allLeadN} dodges (${fmtDist(report)}); ${densityWarnings} density warning(s)`);
const text = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, text);
console.log(text);
process.exit((strict && outOfRange) || ((strict || strictDensity) && densityWarnings) ? 1 : 0);
