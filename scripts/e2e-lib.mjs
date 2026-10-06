// scripts/e2e-lib.mjs —— 无头 e2e 的标准做法（DESIGN.md §8.8）。CORE 冻结。
// 只用 playwright-core（不要装 playwright），用本机缓存的 Chromium + SwiftShader。
// openGame() 经 browser-lock 取得槽位，返回 { b, p, external, errors, close }；close() 关闭浏览器并释放槽位。
import { chromium } from 'playwright-core';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireBrowserSlot } from './browser-lock.mjs';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);
export const CHROME = process.env.HW_CHROME
  || `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
export const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const DIST = join(ROOT, 'dist', 'index.html');

function newestMtime(dir) {
  let t = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) t = Math.max(t, newestMtime(p));
    else t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}

/** dist/index.html 不存在或比构建输入旧时重新构建。 */
export function ensureBuilt({ force = false, quiet = false } = {}) {
  const srcT = Math.max(newestMtime(join(ROOT, 'src')), statSync(join(ROOT, 'index.html')).mtimeMs,
    statSync(join(ROOT, 'vite.config.ts')).mtimeMs, statSync(join(ROOT, 'package.json')).mtimeMs,
    statSync(join(ROOT, 'THIRD_PARTY_NOTICES.txt')).mtimeMs);
  const stale = !existsSync(DIST) || statSync(DIST).mtimeMs < srcT;
  if (force || stale) {
    if (!quiet) console.error(`e2e: building dist/ (${existsSync(DIST) ? 'stale' : 'missing'})…`);
    execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit' });
  }
  return DIST;
}

/** 基础 URL：缺省为 dist/index.html 的 file:// 地址。 */
export function baseUrl(url) {
  return url || `file://${DIST}`;
}

/**
 * 打开游戏。query 会拼在 `?test=1&q=low&mute=1&` 之后（可覆盖）。
 * opts: { viewport: {width,height}, url, defaults: false 表示不加 test/q/mute 缺省参数, touch: 设备模拟触摸 }
 */
export async function openGame(query = '', opts = {}) {
  const release = await acquireBrowserSlot({ who: opts.who ?? process.argv[1] });
  let b;
  try {
    b = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
    const ctxOpts = { viewport: opts.viewport ?? { width: 640, height: 360 } };
    if (opts.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
    const context = await b.newContext(ctxOpts);
    const p = await context.newPage();
    const external = [];
    const errors = [];
    p.on('request', (r) => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
    p.on('pageerror', (e) => errors.push(String(e && e.stack ? e.stack : e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const base = baseUrl(opts.url);
    const defaults = opts.defaults === false ? '' : 'test=1&q=low&mute=1&';
    const sep = base.includes('?') ? '&' : '?';
    const target = `${base}${sep}${defaults}${query}`;
    await p.goto(target);
    await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 60_000 });
    await p.evaluate(() => window.__game.ready);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try { await b.close(); } finally { release(); }
    };
    return { b, p, external, errors, close, url: target };
  } catch (e) {
    try { await b?.close(); } finally { release(); }
    throw e;
  }
}

/** 分段推进，直到 predicate(state) 为真或超出 maxTicks。 */
export async function stepUntil(p, predicate, { chunk = 240, maxTicks = 120 * 600 } = {}) {
  let ticks = 0;
  let st = await p.evaluate(() => window.__game.getState());
  while (!predicate(st) && ticks < maxTicks) {
    st = await p.evaluate((n) => window.__game.step(n), chunk);
    ticks += chunk;
  }
  return st;
}

export function fmtSec(ms) { return `${(ms / 1000).toFixed(1)} s`; }
