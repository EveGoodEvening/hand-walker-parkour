// scripts/validate-levels.ts —— `npm run validate`（DESIGN.md §2.8、§8.9 验收 4）。CORE 写初版，归 WP1。
// 用 tsx 运行（Node 原生类型剥离不能解析 src 里不带扩展名的 import）。
// 对所有已实现的章节加 test 章跑校验器；有 error 时退出码 1。`--json` 输出完整报告，`--ch ch1` 只校验一章。
import { availableChapters, getChapter } from '../src/levels/chapters/index';
import { validateChapter } from '../src/levels/validate';
import { solver } from '../src/sim/Solver';
import type { ChapterId } from '../src/core/types';

const args = process.argv.slice(2);
const json = args.includes('--json');
const chArg = args.includes('--ch') ? args[args.indexOf('--ch') + 1] : null;
const ids: ChapterId[] = chArg ? [chArg as ChapterId] : availableChapters(true);
const t0 = performance.now();
let errors = 0;
const reports = [];
for (const id of ids) {
  const def = getChapter(id);
  if (!def) { console.log(`- ${id}: not implemented (skipped)`); continue; }
  const r = validateChapter(def, solver);
  reports.push(r);
  const e = r.issues.filter((i) => i.level === 'error');
  const w = r.issues.filter((i) => i.level === 'warn');
  errors += e.length;
  if (!json) {
    const st = r.stats;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${id}: ${st.totalSec.toFixed(1)} s (run ${st.runSec.toFixed(1)} s, non-run ${st.nonRunSec.toFixed(1)} s = ${(st.nonRunRatio * 100).toFixed(1)}%), ${e.length} error(s), ${w.length} warning(s)`);
    for (const i of r.issues) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '} [${i.rule}]${i.segment ? ` ${i.segment}` : ''}: ${i.msg}`);
  }
}
if (json) console.log(JSON.stringify(reports, null, 2));
else console.log(`validate: ${errors} error(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(errors ? 1 : 0);
