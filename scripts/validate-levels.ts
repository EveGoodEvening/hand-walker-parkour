// scripts/validate-levels.ts —— `npm run validate`（DESIGN.md §2.8、§8.1、§8.10 WP1 验收 5、WP2 验收 1）。CORE 写初版，WP1 补全。
// 用 tsx 运行（Node 原生类型剥离不能解析 src 里不带扩展名的 import）。
// = WP1 的关卡校验器（R1–R13 + 静态检查）+ WP2 的内容 lint（R14，src/levels/lint.ts，入口约定见 docs/contract-requests/WP1.md）。
// 对五章加 test 章跑校验器；还没实现的章（WP2 合并前返回 null 的桩）打印 skipped，合并后自动覆盖。lint.ts 还不存在时打印 skipped。
// 有 error 时退出码 1；校验耗时超过 20 s 也算失败（验收 5）。
//   --json          输出完整报告（JSON）
//   --ch ch3        只校验一章（lint 也只跑这一章，外加与章节无关的 lintAll）
//   --meta          不校验，只输出各章的元数据（必备节拍、结尾卡输入上的节拍、段落），给 e2e 脚本用
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHAPTER_ORDER, getChapter } from '../src/levels/chapters/index';
import type { ChapterDef } from '../src/levels/schema';
import { runLint, validateChapter, type Issue, type ValidateReport } from '../src/levels/validate';
import { solver } from '../src/sim/Solver';
import type { ChapterId } from '../src/core/types';

const args = process.argv.slice(2);
const json = args.includes('--json');
const chArg = args.includes('--ch') ? (args[args.indexOf('--ch') + 1] as ChapterId) : null;
const ids: ChapterId[] = chArg ? [chArg] : [...CHAPTER_ORDER, 'test'];
const BUDGET_SEC = 20;
const LINT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/levels/lint.ts');

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
const defs: ChapterDef[] = [];
for (const id of ids) {
  const def = getChapter(id);
  if (!def) {
    if (!json) console.log(`- ${id}: not implemented yet (skipped)`);
    reports.push({ chapter: id, ok: true, skipped: true, issues: [], stats: { runSec: 0, nonRunSec: 0, totalSec: 0, nonRunRatio: 0, segments: [] } });
    continue;
  }
  defs.push(def);
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

// —— R14：WP2 的内容 lint ——
let lint: { status: 'skipped' | 'ran'; entries: string[]; issues: Issue[] } = { status: 'skipped', entries: [], issues: [] };
if (!existsSync(LINT_PATH)) {
  if (!json) console.log('- lint (R14): src/levels/lint.ts not present yet (skipped)');
} else {
  let mod: Record<string, unknown> | null = null;
  try { mod = (await import(pathToFileURL(LINT_PATH).href)) as Record<string, unknown>; } catch (e) {
    lint = { status: 'ran', entries: [], issues: [{ level: 'error', rule: 'R14', chapter: 'text', msg: `src/levels/lint.ts failed to load: ${(e as Error)?.message ?? String(e)}` }] };
  }
  if (mod) {
    // lead 集成：全部章节时跑 WP2 的 lintContent（原文只在这里读，不进产物），并对 ui/strings.ts 跑附录 B.8
    const full = !chArg && defs.length === CHAPTER_ORDER.filter((id) => getChapter(id)).length + (getChapter('test') ? 1 : 0);
    const sources = full ? (await import('../src/levels/sourceQuotes')).SOURCE_CHAPTERS : undefined;
    const uiStrings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(await import('../src/ui/strings'))) {
      if (typeof v === 'string' || Array.isArray(v) || (v !== null && typeof v === 'object' && !(v instanceof Set) && !(v instanceof Map))) uiStrings[k] = v;
    }
    lint = { status: 'ran', ...runLint(mod, defs, { full, sources, uiStrings }) };
  }
  const e = lint.issues.filter((i) => i.level === 'error');
  errors += e.length;
  if (!json) {
    console.log(`${e.length ? 'FAIL' : 'PASS'} lint (R14, ${lint.entries.join(' + ') || 'no entry point'}): ${e.length} error(s), ${lint.issues.length - e.length} warning(s)`);
    for (const i of lint.issues) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '} [${i.rule}] ${i.chapter}${i.segment ? ` ${i.segment}` : ''}: ${i.msg}`);
  }
}

const overBudget = sec > BUDGET_SEC;
if (json) console.log(JSON.stringify({ reports, lint, sec, budgetSec: BUDGET_SEC, overBudget }, null, 2));
else {
  console.log(`validate: ${errors} error(s) in ${sec.toFixed(1)} s`);
  if (overBudget) console.log(`validate: FAILED — the level checks took ${sec.toFixed(1)} s, budget is ${BUDGET_SEC} s (DESIGN §8.10 WP1 acceptance 5)`);
}
process.exit(errors || overBudget ? 1 : 0);
