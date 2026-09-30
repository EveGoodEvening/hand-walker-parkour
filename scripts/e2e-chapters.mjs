#!/usr/bin/env node
// scripts/e2e-chapters.mjs —— 全章 e2e（DESIGN.md §8.10 WP1 验收 8）。CORE 写初版，归 WP1。
// 对每个已实现的章（可用 --ch 指定）：perfect 自动驾驶从开场跑到 chapter:end；0 摔倒；requiredBeats 全部触发；
// 峰值 draw call ≤ 50；零外部请求；每段一张截图（shots/chapters/）。复用 e2e-smoke 的逻辑，逐章启动。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { availableChapters } from './chapters-list.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const only = process.argv.includes('--ch') ? [process.argv[process.argv.indexOf('--ch') + 1]] : null;
const chapters = only ?? availableChapters();
let bad = 0;
for (const ch of chapters) {
  console.log(`▶ ${ch}`);
  const r = spawnSync('node', ['scripts/e2e-smoke.mjs', '--ch', ch], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
process.exit(bad ? 1 : 0);
