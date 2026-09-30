#!/usr/bin/env node
// scripts/e2e-visual.mjs —— 执行各包的截图场景清单 tests/visual/WPx.json（DESIGN.md §8.10、§8.11）。CORE 写初版，归 WP1。
// 用法：npm run e2e:visual -- --wp WP3（缺省执行全部清单）。清单格式与 scripts/shot.mjs 的 --plan 相同；
// 输出到 shots/visual/<WP>/。经 browser-lock（由 shot.mjs 负责）。
import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const dir = join(ROOT, 'tests', 'visual');
const wp = process.argv.includes('--wp') ? process.argv[process.argv.indexOf('--wp') + 1] : null;
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^WP\d\.json$/.test(f) && (!wp || f === `${wp}.json`)) : [];
let bad = 0;
for (const f of files) {
  const name = f.replace('.json', '');
  const items = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!Array.isArray(items) || items.length === 0) { console.log(`- ${name}: empty`); continue; }
  const outDir = join('shots', 'visual', name);
  mkdirSync(join(ROOT, outDir), { recursive: true });
  const plan = items.map((it, i) => ({ ...it, out: join(outDir, it.out ? it.out.replace(/^.*\//, '') : `${i}.png`) }));
  const tmp = join(ROOT, 'shots', `.plan-${name}.json`);
  writeFileSync(tmp, JSON.stringify(plan));
  console.log(`▶ ${name}: ${plan.length} shot(s)`);
  const r = spawnSync('node', ['scripts/shot.mjs', '--plan', tmp], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
if (!files.length) console.log('e2e:visual: no manifests');
process.exit(bad ? 1 : 0);
