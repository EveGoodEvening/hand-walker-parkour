#!/usr/bin/env node
// scripts/check-single.mjs —— 单文件产物检查（DESIGN.md §8.9 验收 2、§9.4 包体）。CORE 冻结。
// 静态：dist/ 里只有 index.html；大小 ≤ 1.5 MB；HTML 标签上没有指向外部的 src / href（只允许 data: / blob: / #）。
// 运行时（缺省开启，--static 跳过）：经 browser-lock 打开页面，推进一小段第一章并渲染，除页面自身、data:、blob: 外没有任何请求。
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, openGame } from './e2e-lib.mjs';

const MAX = 1.5 * 1024 * 1024;
const dist = join(ROOT, 'dist');
const errors = [];
if (!existsSync(join(dist, 'index.html'))) {
  console.error('check:single: dist/index.html not found (run npm run build first)');
  process.exit(1);
}
const files = readdirSync(dist, { recursive: true }).map(String).filter((f) => statSync(join(dist, f)).isFile());
const extra = files.filter((f) => f !== 'index.html');
if (extra.length) errors.push(`dist/ must contain only index.html, found: ${extra.join(', ')}`);
const size = statSync(join(dist, 'index.html')).size;
if (size > MAX) errors.push(`dist/index.html is ${(size / 1024).toFixed(0)} KB > 1536 KB`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
// 去掉内联脚本和样式的内容，只检查真正的标签属性
const tagsOnly = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => m.slice(0, m.indexOf('>') + 1))
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => m.slice(0, m.indexOf('>') + 1));
const attrRe = /<[a-z][^>]*?\s(src|href)\s*=\s*(["']?)([^"'\s>]*)\2/gi;
for (let m; (m = attrRe.exec(tagsOnly));) {
  const v = m[3] ?? '';
  if (v === '' || v.startsWith('data:') || v.startsWith('blob:') || v.startsWith('#')) continue;
  errors.push(`external ${m[1]}="${v}"`);
}
if (/<script\b[^>]*\ssrc=/i.test(tagsOnly)) errors.push('found <script src=…>');
if (/<link\b[^>]*rel=["']?(stylesheet|modulepreload|preload)/i.test(tagsOnly)) errors.push('found external <link> (stylesheet/preload)');
console.log(`check:single: dist/index.html ${(size / 1024).toFixed(0)} KB, ${files.length} file(s)`);

if (!process.argv.includes('--static') && !errors.length) {
  const g = await openGame('ch=ch1&autopilot=perfect', { who: 'check-single' });
  try {
    await g.p.evaluate(() => { window.__game.step(600); window.__game.render(); });
    await g.p.waitForTimeout(200);
    if (g.external.length) errors.push(`runtime requests: ${g.external.join(', ')}`);
    if (g.errors.length) errors.push(`page errors: ${g.errors.slice(0, 3).join(' | ')}`);
    console.log(`check:single: runtime requests outside file:/data:/blob: = ${g.external.length}`);
  } finally {
    await g.close();
  }
}
if (errors.length) {
  console.error(`check:single FAILED\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log('check:single passed');
