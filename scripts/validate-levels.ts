// scripts/validate-levels.ts —— `npm run validate`（DESIGN.md §2.8、§8.10 WP1 验收 5）。CORE 写初版，WP1 补全。
// 用 tsx 运行（Node 原生类型剥离不能解析 src 里不带扩展名的 import）。
// 对五章加 test 章跑校验器（R1–R13 + 静态检查）；还没实现的章（WP2 合并前返回 null 的桩）打印 skipped，合并后自动覆盖。
// 有 error 时退出码 1；耗时超过 20 s 打印警告（验收 5）。
//   --json          输出完整报告（JSON）
//   --ch ch3        只校验一章
//   --meta          不校验，只输出各章的元数据（必备节拍、结尾卡输入上的节拍、段落），给 e2e 脚本用
import { CHAPTER_ORDER, getChapter } from '../src/levels/chapters/index';
import { validateChapter, type ValidateReport } from '../src/levels/validate';
import { solver } from '../src/sim/Solver';
import type { ChapterId } from '../src/core/types';

const args = process.argv.slice(2);
const json = args.includes('--json');
const chArg = args.includes('--ch') ? (args[args.indexOf('--ch') + 1] as ChapterId) : null;
const ids: ChapterId[] = chArg ? [chArg] : [...CHAPTER_ORDER, 'test'];
const BUDGET_SEC = 20;

if (args.includes('--meta')) {
  const meta = ids.map((id) => {
    const def = getChapter(id);
    if (!def) return { id, implemented: false };
    const outroIds = def.outro.lines.flatMap((l) => ('input' in l && l.id ? [l.id] : []));
    return {
      id, implemented: true, name: `${def.title}　${def.name}`, requiredBeats: def.requiredBeats, outroIds,
      segments: def.segments.map((s) => ({ id: s.id, kind: s.kind })),
    };
  });
  console.log(JSON.stringify(meta));
  process.exit(0);
}

const t0 = performance.now();
let errors = 0;
const reports: Array<ValidateReport & { skipped?: boolean; ms?: number }> = [];
for (const id of ids) {
  const def = getChapter(id);
  if (!def) {
    if (!json) console.log(`- ${id}: not implemented yet (skipped)`);
    reports.push({ chapter: id, ok: true, skipped: true, issues: [], stats: { runSec: 0, nonRunSec: 0, totalSec: 0, nonRunRatio: 0, segments: [] } });
    continue;
  }
  const t = performance.now();
  const r = validateChapter(def, solver);
  const ms = performance.now() - t;
  reports.push({ ...r, ms });
  const e = r.issues.filter((i) => i.level === 'error');
  const w = r.issues.filter((i) => i.level === 'warn');
  errors += e.length;
  if (!json) {
    const st = r.stats;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${id}: ${st.totalSec.toFixed(1)} s (run ${st.runSec.toFixed(1)} s, non-run ${st.nonRunSec.toFixed(1)} s = ${(st.nonRunRatio * 100).toFixed(1)}%), ${e.length} error(s), ${w.length} warning(s) [${(ms / 1000).toFixed(1)} s]`);
    for (const i of r.issues) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '} [${i.rule}]${i.segment ? ` ${i.segment}` : ''}: ${i.msg}`);
  }
}
const sec = (performance.now() - t0) / 1000;
if (json) console.log(JSON.stringify(reports, null, 2));
else {
  console.log(`validate: ${errors} error(s) in ${sec.toFixed(1)} s`);
  if (sec > BUDGET_SEC) console.log(`validate: WARNING — took ${sec.toFixed(1)} s, budget is ${BUDGET_SEC} s (DESIGN §8.10 WP1 acceptance 5)`);
}
process.exit(errors ? 1 : 0);
