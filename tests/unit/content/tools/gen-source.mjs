// tests/unit/content/tools/gen-source.mjs —— 生成 src/levels/sourceQuotes.ts（归 WP2）：把小说五章原文逐行嵌入（JSON 字符串数组，join('\n') 还原）。
// 用法：node tests/unit/content/tools/gen-source.mjs <小说仓库目录> src/levels/sourceQuotes.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const NOVEL = process.argv[2];
const OUT = process.argv[3];
let body = '';
const hashes = [];
for (const n of [1, 2, 3, 4, 5]) {
  const raw = readFileSync(`${NOVEL}/第 ${n} 章.md`, 'utf8');
  hashes.push(`第 ${n} 章.md sha256 ${createHash('sha256').update(raw).digest('hex')}`);
  const lines = raw.split('\n');
  body += `  ${n}: [\n${lines.map((l) => `    ${JSON.stringify(l)},`).join('\n')}\n  ].join('\\n'),\n`;
}
const head = `// src/levels/sourceQuotes.ts —— 小说《手行者》第 1–5 章原文（DESIGN.md §8.10 WP2、R14）。归 WP2。
// 只给测试和内容 lint 用（tests/unit/content/**、scripts/validate-levels.ts），**不得**被 src/main.ts 的依赖图引用，
// 否则原文会被打进 dist/index.html。tests/unit/content/isolation.test.ts 检查 src/ 里没有任何文件 import 本文件。
// 来源：https://github.com/EveGoodEvening/hand-walker （commit 99fa832），逐行嵌入，join('\\n') 后与原文件逐字节一致：
${hashes.map((h) => `//   ${h}`).join('\n')}
// 重新生成：node tests/unit/content/tools/gen-source.mjs <小说目录> src/levels/sourceQuotes.ts

/** 章号 → 原文全文（Markdown 原样，含标题与分隔线）。 */
export const SOURCE_CHAPTERS: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
`;
writeFileSync(OUT, `${head}${body}};\n`);
console.log('wrote', OUT);
