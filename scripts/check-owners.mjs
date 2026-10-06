#!/usr/bin/env node
// scripts/check-owners.mjs —— 文件所有权检查（DESIGN.md §8.2 防冲突规则 1、§8.11）。CORE 冻结。
// 1) 覆盖率：仓库里每个文件（已跟踪 + 未忽略的新文件）恰好匹配 OWNERS.json 里的一个所有者（APPEND 也算）。
// 2) 越界：在 wp/<ID> 分支上（或用 --as <ID> 模拟），相对基线分支（缺省 feat/parkour-game，可用 --base 或 HW_BASE 指定）
//    的全部改动（提交的 + 工作区的）只能落在 <ID> 拥有的文件里；APPEND 文件只能追加（不得删除或修改已有行）。
// 用法：node scripts/check-owners.mjs [--as WP3] [--base feat/parkour-game] [--quiet]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** glob → RegExp（** 跨目录，* 不跨目录，? 单字符，{a,b} 任选）。 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function loadOwners(path = join(ROOT, 'OWNERS.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const rules = [];
  for (const [owner, v] of Object.entries(raw)) {
    if (owner.startsWith('$') || owner === 'APPEND') continue;
    for (const g of v) rules.push({ owner, glob: g, re: globToRegExp(g), append: false });
  }
  for (const [file, owner] of Object.entries(raw.APPEND ?? {})) rules.push({ owner, glob: file, re: globToRegExp(file), append: true });
  return rules;
}

export function ownersOf(rules, file) {
  return rules.filter((r) => r.re.test(file));
}

function main() {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const rules = loadOwners();
  const problems = [];
  // —— 覆盖率 ——
  const tracked = git('ls-files').split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  const deleted = new Set(git('ls-files', '--deleted').split('\n').filter(Boolean));
  const all = Array.from(new Set([...tracked, ...untracked])).filter((f) => !deleted.has(f)).sort();
  for (const f of all) {
    const m = ownersOf(rules, f);
    const owners = Array.from(new Set(m.map((r) => r.owner)));
    if (owners.length === 0) problems.push(`unowned file: ${f}`);
    else if (owners.length > 1) problems.push(`file has several owners (${owners.join(', ')}): ${f}`);
  }
  // —— 越界 ——
  const branch = (() => { try { return git('rev-parse', '--abbrev-ref', 'HEAD'); } catch { return ''; } })();
  const asArg = args.includes('--as') ? args[args.indexOf('--as') + 1] : null;
  const wp = asArg ?? (branch.startsWith('wp/') ? branch.slice(3) : null);
  let checked = 0;
  if (wp) {
    const base = (args.includes('--base') ? args[args.indexOf('--base') + 1] : null) ?? process.env.HW_BASE ?? 'feat/parkour-game';
    let mb;
    try { mb = git('merge-base', base, 'HEAD'); } catch { problems.push(`cannot find merge-base with ${base}`); }
    if (mb) {
      const changed = new Map();
      for (const line of git('diff', '--name-status', mb).split('\n').filter(Boolean)) {
        const [st, ...paths] = line.split('\t');
        for (const p of paths) changed.set(p, st);
      }
      for (const f of untracked) changed.set(f, 'A');
      for (const [f, st] of changed) {
        checked++;
        const m = ownersOf(rules, f);
        const mine = m.find((r) => r.owner === wp);
        if (!mine) { problems.push(`${wp} may not change ${f} (owner: ${m.map((r) => r.owner).join(', ') || 'none'})`); continue; }
        if (mine.append && st !== 'A') {
          const num = git('diff', '--numstat', mb, '--', f).split('\n').filter(Boolean);
          const del = num.reduce((s, l) => s + (Number(l.split('\t')[1]) || 0), 0);
          if (del > 0 || st === 'D') problems.push(`${f} is append-only, but ${del} line(s) were removed or changed`);
        }
      }
    }
  }
  if (!quiet || problems.length) {
    console.log(`check:owners: ${all.length} files, ${rules.length} rules${wp ? `, ${checked} changed file(s) checked for ${wp}` : ` (branch ${branch || '?'}: coverage only)`}`);
  }
  if (problems.length) {
    console.error(`check:owners FAILED\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('check:owners passed');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
