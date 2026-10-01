// tests/unit/content/isolation.test.ts —— 原文不进产物（DESIGN.md §8.10 WP2「sourceQuotes.ts 只给测试用，不进产物」）。归 WP2。
// 从 src/main.ts 出发沿 import（含动态 import 与 import.meta.glob）走一遍依赖图：sourceQuotes.ts 不可达；
// lint.ts 也不应进产物（它只给测试和 validate 脚本用）。另外 src/ 里除 sourceQuotes.ts 自己之外，没有文件提到它。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SRC = join(ROOT, 'src');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|mts|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;                       // 包（three 等）
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** 简单的 glob（只支持 * 与 **，相对于调用文件）。 */
function expandGlob(from: string, pattern: string): string[] {
  const abs = resolve(dirname(from), pattern);
  const re = new RegExp(`^${abs.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);
  return listTs(SRC).filter((f) => re.test(f));
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec || /^\s*import\s+type\b/.test(m[0])) continue;   // import type 在构建时被擦除
      const r = resolveImport(f, spec);
      if (r) stack.push(r);
    }
    for (const m of text.matchAll(/import\.meta\.glob\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g)) {
      const pats = (m[1] as string).match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) ?? [];
      for (const p of pats) if (!p.startsWith('!')) stack.push(...expandGlob(f, p));
    }
  }
  return seen;
}

describe('原文不进产物', () => {
  it('src/main.ts 的依赖图里没有 sourceQuotes.ts 和 lint.ts', () => {
    const files = [...reachable(join(SRC, 'main.ts'))].map((f) => relative(ROOT, f));
    expect(files.length).toBeGreaterThan(20);                   // 确实走到了各包
    expect(files).toContain('src/levels/lines.ts');
    expect(files).not.toContain('src/levels/sourceQuotes.ts');
    expect(files).not.toContain('src/levels/lint.ts');
  });
  it('src/ 里没有别的文件引用 sourceQuotes', () => {
    const users = listTs(SRC).filter((f) => !f.endsWith('sourceQuotes.ts') && /sourceQuotes/.test(readFileSync(f, 'utf8'))
      && /from\s*['"][^'"]*sourceQuotes['"]|import\(\s*['"][^'"]*sourceQuotes/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => relative(ROOT, f))).toEqual([]);
  });
  it('章节数据只 import schema.ts、lines.ts、kitSymbols.ts（§8.2 规则 2）', () => {
    for (const n of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5']) {
      const text = readFileSync(join(SRC, 'levels/chapters', `${n}.ts`), 'utf8');
      const specs = [...text.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(['../schema', '../lines', '../kitSymbols'], `${n}: ${s}`).toContain(s);
    }
  });
});
