// tests/unit/content/tools/leak-check.mjs —— 构建产物里不得有原文长段落（DESIGN.md §8.10 WP2「sourceQuotes.ts 不进产物」）。归 WP2。
// 用法（先 npm run build）：node tests/unit/content/tools/leak-check.mjs [dist/index.html]
// 做法：原文每个 25 字的滑动窗口都不应出现在产物里（lines.ts 每行 ≤ 24 字，所以正常引用不会命中）。有命中时退出码 1。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../../../..', import.meta.url).pathname);
const distPath = resolve(ROOT, process.argv[2] ?? 'dist/index.html');
const dist = readFileSync(distPath, 'utf8');
// 从 sourceQuotes.ts 里取回原文（JSON 字符串逐行），不需要 TS 运行时
const tsSrc = readFileSync(resolve(ROOT, 'src/levels/sourceQuotes.ts'), 'utf8');
const lines = [...tsSrc.matchAll(/^\s{4}("(?:[^"\\]|\\.)*"),$/gm)].map((m) => JSON.parse(m[1]));
let windows = 0, hits = 0, paras = 0, paraHits = 0;
for (const line of lines) {
  const chars = Array.from(line);
  if (chars.length >= 25) { paras++; if (dist.includes(line)) paraHits++; }
  for (let i = 0; i + 25 <= chars.length; i++) {
    windows++;
    const w = chars.slice(i, i + 25).join('');
    if (dist.includes(w)) { hits++; if (hits <= 5) console.error(`LEAK: ${w}`); }
  }
}
const report = { dist: distPath, bytes: dist.length, sourceLines: lines.length, paragraphsChecked: paras, paragraphHits: paraHits, windows25: windows, windowHits: hits };
console.log(JSON.stringify(report));
process.exit(hits || paraHits || lines.length < 1000 ? 1 : 0);
