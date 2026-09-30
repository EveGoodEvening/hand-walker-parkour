#!/usr/bin/env node
// scripts/e2e-visual.mjs —— 执行各包的截图场景清单 tests/visual/WPx.json（DESIGN.md §8.10、§8.11）。CORE 写初版，WP1 补全。
// 清单格式就是 scripts/shot.mjs 的 --plan 格式：JSON 数组，每项
//   { out, query?, q?, size?, touch?, wait?, autopilot?, ops?: [{ steps: N } | { eval: "…" }] }
// （shot.mjs 也认 steps / eval / evalBefore / full，这里照样放行）。out 统一落在 shots/visual/<WP>/ 下：
// 写成 "shots/visual/WP3/x.png" 或 "x.png"、"kits/x.png" 都行，绝对路径或含 .. 的路径报错。
// 浏览器经 browser-lock（由 shot.mjs 负责：每个清单取一次锁，跑完立即释放）。每个清单跑完在 shots/visual/<WP>/index.json 写一份结果。
//   npm run e2e:visual -- --wp WP3          只跑 WP3（可写多个：--wp WP3 --wp WP5，或 --wp WP3,WP5）
//   npm run e2e:visual -- --check           只校验清单格式，不开浏览器
//   npm run e2e:visual                      全部清单
//   node scripts/e2e-visual.mjs --file some/plan.json --name WP3    跑一个还没放进 tests/visual 的清单（自查用）
import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, normalize, isAbsolute } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const dir = join(ROOT, 'tests', 'visual');
const args = process.argv.slice(2);
const wps = new Set();
for (let i = 0; i < args.length; i++) if (args[i] === '--wp') for (const w of String(args[++i] ?? '').split(',')) if (w) wps.add(w.trim());
const checkOnly = args.includes('--check');
const KEYS = new Set(['out', 'query', 'q', 'size', 'touch', 'wait', 'autopilot', 'ops', 'steps', 'eval', 'evalBefore', 'full']);

/** 校验并规范化一个清单；返回 { plan, errors }。 */
export function normalizeManifest(name, items) {
  const errors = [];
  const plan = [];
  if (!Array.isArray(items)) return { plan, errors: [`${name}: manifest must be a JSON array`] };
  const seen = new Set();
  items.forEach((it, i) => {
    const where = `${name}[${i}]`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) { errors.push(`${where}: item must be an object`); return; }
    for (const k of Object.keys(it)) if (!KEYS.has(k)) errors.push(`${where}: unknown key "${k}" (url is not allowed: shots always run against dist/)`);
    if (it.query !== undefined && typeof it.query !== 'string') errors.push(`${where}: query must be a string like "ch=ch1&seg=1-2&beat=40"`);
    if (it.q !== undefined && !['low', 'medium', 'high'].includes(it.q)) errors.push(`${where}: q must be low | medium | high`);
    if (it.size !== undefined && !/^\d+x\d+$/.test(String(it.size))) errors.push(`${where}: size must be WxH`);
    if (it.ops !== undefined) {
      if (!Array.isArray(it.ops)) errors.push(`${where}: ops must be an array`);
      else it.ops.forEach((op, j) => {
        const ok = op && typeof op === 'object' && ((Number.isFinite(op.steps) && Object.keys(op).length === 1) || (typeof op.eval === 'string' && Object.keys(op).length === 1));
        if (!ok) errors.push(`${where}.ops[${j}]: must be { steps: N } or { eval: "…" }`);
      });
    }
    let rel = String(it.out ?? `${i}.png`).replace(/\\/g, '/');
    const prefix = `shots/visual/${name}/`;
    if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);
    else if (rel.startsWith('shots/')) rel = rel.replace(/^.*\//, '');          // 旧写法：别的 shots/ 目录，只取文件名
    if (isAbsolute(rel) || normalize(rel).startsWith('..')) { errors.push(`${where}: out must stay inside shots/visual/${name}/`); return; }
    if (!/\.png$/i.test(rel)) rel += '.png';
    if (seen.has(rel)) errors.push(`${where}: duplicate out "${rel}"`);
    seen.add(rel);
    plan.push({ ...it, out: join('shots', 'visual', name, rel) });
  });
  return { plan, errors };
}

function main() {
  const extra = args.includes('--file') ? resolve(args[args.indexOf('--file') + 1]) : null;
  const extraName = args.includes('--name') ? args[args.indexOf('--name') + 1] : 'adhoc';
  const files = extra ? [] : existsSync(dir) ? readdirSync(dir).filter((f) => /^WP\d\.json$/.test(f)).sort() : [];
  const chosen = extra ? [`${extraName}.json`] : files.filter((f) => !wps.size || wps.has(f.replace('.json', '')));
  if (!extra) for (const w of wps) if (!files.includes(`${w}.json`)) console.log(`- ${w}: no manifest tests/visual/${w}.json`);
  let bad = 0;
  for (const f of chosen) {
    const name = f.replace('.json', '');
    let items;
    try { items = JSON.parse(readFileSync(extra ?? join(dir, f), 'utf8')); } catch (e) { console.error(`✖ ${name}: invalid JSON: ${e.message}`); bad++; continue; }
    const { plan, errors } = normalizeManifest(name, items);
    if (errors.length) { console.error(`✖ ${name}: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); bad++; continue; }
    if (!plan.length) { console.log(`- ${name}: empty`); continue; }
    if (checkOnly) { console.log(`✔ ${name}: ${plan.length} shot(s) ok`); continue; }
    const outDir = join(ROOT, 'shots', 'visual', name);
    mkdirSync(outDir, { recursive: true });
    const tmp = join(outDir, '.plan.json');
    writeFileSync(tmp, JSON.stringify(plan, null, 2));
    console.log(`▶ ${name}: ${plan.length} shot(s) → shots/visual/${name}/`);
    const t0 = Date.now();
    const r = spawnSync('node', ['scripts/shot.mjs', '--plan', tmp], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('{'));
    const results = lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    for (const x of results) console.log(`  ${x.error ? '✖' : x.errors?.length ? '!' : '✔'} ${x.out}${x.error ? ` — ${x.error}` : ` (${x.screen} ${x.segment ?? ''} ${x.drawCalls ?? '?'} draw calls${x.errors?.length ? `, page errors: ${x.errors.length}` : ''})`}`);
    if (r.stderr) process.stderr.write(r.stderr);
    writeFileSync(join(outDir, 'index.json'), JSON.stringify({ wp: name, wallSec: (Date.now() - t0) / 1000, exit: r.status, results }, null, 2));
    if (r.status !== 0) { console.error(`✖ ${name}: shot.mjs exited ${r.status}`); bad++; }
  }
  if (!chosen.length) console.log('e2e:visual: no manifests');
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
