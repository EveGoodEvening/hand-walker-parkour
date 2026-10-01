#!/usr/bin/env node
// scripts/verify.mjs —— `npm run verify`（DESIGN.md §8.1、§8.10）。CORE 写初版，WP1 维护。
// 依次：check:owners → typecheck → test → validate → build → check:single → e2e:smoke。任何一步失败立即停止，退出码非 0。
// 各步依次执行，从不并发（资源纪律：vitest 限 2 个 worker，浏览器经锁）。
//   --skip-e2e     跳过需要浏览器的两步（check:single 只做静态检查，不跑 e2e:smoke）
//   --full         最后再跑 e2e:chapters 与 e2e:perf（五章全跑；浏览器经锁，一次各取一个槽位）
//   --keep-going   某一步失败也继续跑完后面的步骤，最后汇总失败的步骤（退出码仍非 0）；用来确认其余步骤是否全绿
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const skipE2e = process.argv.includes('--skip-e2e');
const full = process.argv.includes('--full') && !skipE2e;
const keepGoing = process.argv.includes('--keep-going');
const steps = [
  ['check:owners', ['node', 'scripts/check-owners.mjs']],
  ['typecheck', ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['test', ['npx', 'vitest', 'run']],
  ['validate', ['npx', 'tsx', 'scripts/validate-levels.ts']],
  ['build', ['npx', 'vite', 'build', '--logLevel', 'warn']],
  ['check:single', ['node', 'scripts/check-single.mjs', ...(skipE2e ? ['--static'] : [])]],
  ...(skipE2e ? [] : [['e2e:smoke', ['node', 'scripts/e2e-smoke.mjs']]]),
  ...(full ? [['e2e:chapters', ['node', 'scripts/e2e-chapters.mjs']], ['e2e:perf', ['node', 'scripts/e2e-perf.mjs']]] : []),
];
const t0 = Date.now();
const failed = [];
for (const [name, [cmd, ...args]] of steps) {
  const t = Date.now();
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✖ verify: ${name} failed (exit ${r.status ?? r.signal})`);
    if (!keepGoing) process.exit(r.status || 1);
    failed.push(name);
    continue;
  }
  console.log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
if (failed.length) {
  console.error(`\nverify: ${failed.length} step(s) failed: ${failed.join(', ')} (${steps.length - failed.length} passed, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(1);
}
console.log(`\nverify: all green in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
