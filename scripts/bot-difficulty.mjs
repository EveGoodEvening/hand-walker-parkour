#!/usr/bin/env node
// scripts/bot-difficulty.mjs —— human 机器人难度报告（DESIGN.md §2.8、§8.10 WP1 验收 6、§8.11 集成时用它调 tuning 和谱面密度）。WP1。
// 用 tsx 运行（npm run bot:difficulty）：直接在 Node 里跑模拟，不开浏览器。
// 对每章每个检查点区间（跑段起点与段内 checkpoints 之间），从检查点开始（稳度回满），用 human 机器人跑 N 次（机器人种子 1..N），
// 失败率 = 这个区间里摔倒的比例。§2.8 的目标是「每个检查点区间」的：第一章 ≤ 5%……第五章 ≤ 20%（上限）。
// 判定按区间：「可能失败」的区间（追随者不是 hidden）里，失败率 > 目标 + 3 个百分点的区间记 over（区间的 status），
// 有任何一个 over，这一章的 status 就是 harder。章的平均值、最大值只作参考。
// 比目标低 3 个百分点以上（WP1 验收 6「目标 ±3 个百分点」的下沿）：区间与章的 band 记 below、章另注 note 'well below target'，
// status 仍是 ok——§2.8 的目标是上限，偏易不算不合格（这一解释写在 docs/contract-requests/WP1.md，待 lead 确认）。
//   --trials N    每个区间的次数（缺省 40）      --ch ch3    只跑一章          --out FILE   另把 JSON 写进文件
//   --strict      有任何区间 over（章 status 为 harder）时退出码 1（缺省只报告）
// 还没实现的章（WP2 合并前返回 null 的桩）打印 skipped。
import { writeFileSync } from 'node:fs';
import { compile } from '../src/levels/compile.ts';
import { CHAPTER_ORDER, getChapter } from '../src/levels/chapters/index.ts';
import { Sim } from '../src/sim/Sim.ts';
import { solver } from '../src/sim/Solver.ts';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const trials = Number(arg('--trials', 40));
const only = arg('--ch', null);
const out = arg('--out', null);
const strict = args.includes('--strict');
/** §2.8 human 机器人目标失败率（每个检查点区间）。 */
const TARGET = { ch1: 0.05, ch2: 0.10, ch3: 0.18, ch4: 0.12, ch5: 0.20 };
const TOL = 0.03;
const MAX_SEC = 120;

function runInterval(compiled, seg, cp, nextCp, trial) {
  const sim = new Sim(solver);
  sim.load(compiled, { segment: seg.def.id, beat: cp }, compiled.seed);
  sim.setAutopilot('human');
  sim.setBotSeed(trial);
  const held = new Set();
  const segIndex = seg.index;
  let canFail = false;
  for (let n = 0; n < 120 * MAX_SEC; n++) {
    sim.step([], held);
    sim.drain();
    const s = sim.snapshot();
    if (s.follower.mode !== 'hidden' && s.segKind === 'run') canFail = true;
    if (s.player.mode === 'fall') return { fell: true, hits: s.stats.stumbles + s.stats.crashes, canFail };
    if (sim.isEnded || s.segIndex !== segIndex || s.segBeat >= nextCp) return { fell: false, hits: s.stats.stumbles + s.stats.crashes, canFail };
  }
  return { fell: false, hits: 0, timeout: true, canFail };
}

const t0 = Date.now();
const report = { trials, target: TARGET, tolerance: TOL, chapters: [] };
let outOfRange = 0;
for (const id of only ? [only] : CHAPTER_ORDER) {
  const def = getChapter(id);
  if (!def) { console.error(`- ${id}: not implemented yet (skipped)`); report.chapters.push({ chapter: id, skipped: true }); continue; }
  const compiled = compile(def);
  const intervals = [];
  for (const seg of compiled.segments) {
    if (seg.kind !== 'run') continue;
    const cps = seg.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const next = i + 1 < cps.length ? cps[i + 1] : seg.def.beats;
      let falls = 0, hits = 0, timeouts = 0, canFail = true;
      for (let k = 1; k <= trials; k++) {
        const r = runInterval(compiled, seg, cp, next, k);
        if (r.fell) falls++;
        hits += r.hits;
        if (r.timeout) timeouts++;
        canFail = r.canFail;
      }
      const failRate = falls / trials;
      const target = TARGET[id];
      const band = !canFail ? 'cannotFail' : failRate > target + TOL ? 'over' : failRate < target - TOL ? 'below' : 'in';
      intervals.push({ segment: seg.def.id, from: cp, to: next, canFail, failRate, meanHits: +(hits / trials).toFixed(3), timeouts, band, status: band === 'over' ? 'over' : 'ok' });
    }
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
  report.chapters.push({ chapter: id, target, status, band, ...(note ? { note } : {}), over: hot, failRate: +mean.toFixed(4), maxInterval: +max.toFixed(4), intervals });
  console.error(`${id}: ${live.length} interval(s) that can fail, fail rate per interval ${live.map((x) => `${x.segment}@${x.from} ${(x.failRate * 100).toFixed(1)}%`).join(', ') || '-'} (mean ${(mean * 100).toFixed(1)}%, max ${(max * 100).toFixed(1)}%), target ≤ ${(target * 100).toFixed(0)}% (+3) per interval → ${status}${note ? ` (${note})` : ''}${hot.length ? `; over target: ${hot.join(', ')}` : ''}`);
}
report.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
const text = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, text);
console.log(text);
process.exit(strict && outOfRange ? 1 : 0);
