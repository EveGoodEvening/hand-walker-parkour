#!/usr/bin/env node
// scripts/shot.mjs —— 通用截图工具（CORE 冻结；lead 追加的交付）。各工作包在 e2e-visual 就绪之前用它自查画面。
// 必须经 browser-lock 取得浏览器槽位；默认打开 dist/index.html（过期会自动重新构建），--url 可指向别的地址（例如 vite dev）。
//
// 用法：
//   node scripts/shot.mjs --q low --size 640x360 --query "ch=ch1&seg=1-2&beat=40" --steps 240 --out shots/ch1-1-2.png
//   node scripts/shot.mjs --query "ch=ch1&seg=1-3" --eval "__game.setAutopilot('off')" --steps 60 --eval "__game.input('up')" --steps 20 --out shots/x.png
//   node scripts/shot.mjs --plan shots.json
// 参数：
//   --q low|medium|high      画质（缺省 low）                --size WxH   视口（缺省 640x360）
//   --query "k=v&…"          追加到 ?test=1&mute=1&q=… 之后   --url URL    基础地址（缺省 dist/index.html）
//   --steps N                推进 N 个 tick（可多次，与 --eval 按命令行顺序执行）
//   --eval "<JS 表达式>"      在页面里执行，可用 window.__game（可多次；可返回 Promise；结果打印出来）
//   --out PATH               输出 PNG（缺省 shots/shot.png）   --touch      模拟触摸设备
//   --no-autopilot           不自动加 autopilot=perfect（缺省会加，除非 query 里已有 autopilot=）
//   --no-build               不检查 / 重新构建 dist/        --full       截整页（缺省只截视口）
// --plan 文件：JSON 数组，每项 { out, query?, q?, size?, url?, touch?, autopilot?: boolean, ops?: [{steps:N}|{eval:"…"}], steps?, eval? }
// 输出：每张图一行 JSON（out、屏幕、段、拍、稳度、perf、页面错误）。有页面错误时退出码 2。
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { acquireBrowserSlot } from './browser-lock.mjs';
import { CHROME, CHROME_ARGS, ROOT, baseUrl, ensureBuilt } from './e2e-lib.mjs';

function parseArgs(argv) {
  const o = { q: 'low', size: '640x360', query: '', ops: [], out: 'shots/shot.png', url: null, plan: null, autopilot: true, build: true, touch: false, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`missing value for ${a}`); return x; };
    switch (a) {
      case '--q': o.q = v(); break;
      case '--size': o.size = v(); break;
      case '--query': o.query = v(); break;
      case '--steps': o.ops.push({ steps: Number(v()) }); break;
      case '--eval': o.ops.push({ eval: v() }); break;
      case '--out': o.out = v(); break;
      case '--url': o.url = v(); break;
      case '--plan': o.plan = v(); break;
      case '--no-autopilot': o.autopilot = false; break;
      case '--no-build': o.build = false; break;
      case '--touch': o.touch = true; break;
      case '--full': o.full = true; break;
      case '-h': case '--help':
        console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
        process.exit(0);
        break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  return o;
}

function normalizePlanItem(it, defaults) {
  const ops = it.ops ? [...it.ops] : [];
  if (!it.ops) {
    for (const e of [].concat(it.evalBefore ?? [])) ops.push({ eval: e });
    if (it.steps) ops.push({ steps: it.steps });
    for (const e of [].concat(it.eval ?? [])) ops.push({ eval: e });
  }
  return {
    out: it.out ?? defaults.out, query: it.query ?? '', q: it.q ?? defaults.q, size: it.size ?? defaults.size,
    url: it.url ?? defaults.url, touch: it.touch ?? defaults.touch, autopilot: it.autopilot ?? defaults.autopilot, ops, full: it.full ?? defaults.full,
  };
}

function buildQuery(s) {
  let q = `q=${encodeURIComponent(s.q)}`;
  if (s.query) q += `&${s.query}`;
  if (s.autopilot && !/(^|&)autopilot=/.test(s.query)) q += '&autopilot=perfect';
  return q;
}

async function runShot(browser, s) {
  const [w, h] = s.size.split('x').map(Number);
  const ctxOpts = { viewport: { width: w || 640, height: h || 360 } };
  if (s.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack ? e.stack : e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u) && !(s.url && u.startsWith(new URL(s.url).origin))) external.push(u); });
  const base = baseUrl(s.url);
  const url = `${base}${base.includes('?') ? '&' : '?'}test=1&mute=1&${buildQuery(s)}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60_000 });
  await page.evaluate(() => window.__game.ready);
  const evals = [];
  for (const op of s.ops) {
    if (op.steps) {
      let left = Math.max(0, Math.floor(op.steps));
      while (left > 0) { const n = Math.min(600, left); await page.evaluate((k) => window.__game.step(k), n); left -= n; }
    } else if (op.eval) {
      const r = await page.evaluate(`(async () => (${op.eval}))()`);
      evals.push({ expr: op.eval, result: r === undefined ? null : r });
    }
  }
  await page.evaluate(() => { try { window.__game.render(); } catch { /* 非 test 模式 */ } });
  mkdirSync(dirname(resolve(ROOT, s.out)), { recursive: true });
  await page.screenshot({ path: resolve(ROOT, s.out), fullPage: s.full });
  const info = await page.evaluate(() => {
    const g = window.__game; const st = g.getState(); const pf = g.perf();
    return { screen: st.screen, chapter: st.chapter, segment: st.segment, beat: +st.beat.toFixed(2), s: +st.s.toFixed(2), lane: st.lane,
      mode: st.mode, steady: st.steady, falls: st.falls, text: st.text, drawCalls: pf.drawCalls, triangles: pf.triangles };
  });
  await context.close();
  return { out: s.out, url, ...info, evals, errors, external };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const defaults = { out: o.out, q: o.q, size: o.size, url: o.url, touch: o.touch, autopilot: o.autopilot, full: o.full };
  const shots = o.plan
    ? JSON.parse(readFileSync(resolve(o.plan), 'utf8')).map((it, i) => normalizePlanItem({ out: `shots/plan-${i}.png`, ...it }, defaults))
    : [normalizePlanItem({ query: o.query, ops: o.ops, out: o.out }, defaults)];
  if (o.build && shots.some((s) => !s.url)) ensureBuilt();
  const release = await acquireBrowserSlot({ who: 'shot.mjs' });
  let bad = 0;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
    for (const s of shots) {
      try {
        const r = await runShot(browser, s);
        if (r.errors.length) bad++;
        console.log(JSON.stringify(r));
      } catch (e) {
        bad++;
        console.log(JSON.stringify({ out: s.out, error: String(e && e.message ? e.message : e) }));
      }
    }
  } finally {
    try { await browser?.close(); } finally { release(); }
  }
  process.exit(bad ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
