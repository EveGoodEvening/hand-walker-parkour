#!/usr/bin/env node
// scripts/e2e-chapters.mjs —— 全章 e2e（DESIGN.md §8.10 WP1 验收 8）。CORE 写初版，WP1 重写。
// SwiftShader、低画质、640×360，**一次**取浏览器锁、开一个浏览器跑完所有章：
//   每章 start(ch, { skipCards }) → perfect 自动驾驶跑到**本章**的 chapter:end；断言 0 摔倒、requiredBeats 全部触发、
//   峰值 draw call ≤ 50（每 --every 个 tick 渲染一帧取样）、零外部请求、零页面错误；每段一张截图 shots/chapters/<章>-<段>.png；
//   总墙钟时间 ≤ 10 min。
// 结尾卡输入上的节拍（例如 ch4 的 fingerPractice）：章末停在结尾卡上，用真实键盘按 ↓ 三下、再等过 6 s 的超时，
//   然后断言这些 id 出现在 __game.beats() 或事件日志的 data.id 里（附录 C「e2e 断言已触发」）。
// 事件日志是环形的、跨章不清空：只认本章最后一次 chapter:start 之后的事件，chapter:end 还要 data.id === 本章
//   （否则上一章留下的 chapter:end 会被当成本章结束）。
// 自检：先把 test 章连跑两遍，第二遍必须真的跑完（ticks 与第一遍相同），防止「上一遍的事件被当成这一遍的」回归。
// 还没实现的章（WP2 合并前返回 null 的桩）打印 skipped，合并后自动覆盖。章节元数据来自 `tsx scripts/validate-levels.ts --meta`。
//   --ch ch3    只跑一章          --no-shots   不截图           --json   只输出 JSON 汇总        --every 60   取样间隔（tick）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ensureBuilt, openGame } from './e2e-lib.mjs';
import { chapterMeta } from './chapters-list.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = arg('--ch', null);
const shots = !args.includes('--no-shots');
const quiet = args.includes('--json');
const every = Math.max(1, Number(arg('--every', 60)));
const LIMIT_MS = 10 * 60 * 1000;
const DRAW_LIMIT = 50;
const MAX_TICKS = 120 * 900;
const CHUNK = Math.max(every, 240 - (240 % every));
const OUTRO_WAIT_MS = 7000;   // 结尾卡输入超时 6 s（§4.4）+ 余量

const meta = chapterMeta().filter((m) => !only || m.id === only);
if (meta.some((m) => m.implemented && !m.requiredBeats)) { console.error('e2e:chapters: could not read chapter metadata (tsx scripts/validate-levels.ts --meta)'); process.exit(1); }
for (const m of meta) if (!m.implemented) console.log(`- ${m.id}: not implemented yet (skipped)`);
const todo = meta.filter((m) => m.implemented);
if (!todo.length) { console.log('e2e:chapters: nothing to run'); process.exit(only ? 1 : 0); }

/** 装进页面：本章最后一次 chapter:start 之后的事件（start 之前的、上一章的都不算）。经 CDP 注入，不受页面 CSP 影响。 */
const installFresh = (p) => p.evaluate(() => {
  window.__e2eFresh = (ch) => {
    const ev = window.__game.events();
    let i = ev.length - 1;
    while (i >= 0 && !(ev[i].type === 'chapter:start' && ev[i].data && ev[i].data.id === ch)) i--;
    return ev.slice(i + 1);
  };
});

const t0 = Date.now();
ensureBuilt();
const outDir = join(ROOT, 'shots', 'chapters');
mkdirSync(outDir, { recursive: true });
const g = await openGame('', { who: 'e2e-chapters' });
const results = [];
const global = [];
let bad = 0;

/** 跑一章到本章的 chapter:end。返回统计；takeShots 时每段截一张图。 */
async function runChapter(id, { takeShots = false } = {}) {
  const { p } = g;
  const failures = [];
  await p.evaluate(async (ch) => { await window.__game.start(ch, { skipCards: true }); window.__game.setAutopilot('perfect'); }, id);
  const shotSegs = new Set();
  let ended = false, ticks = 0, frames = 0, peakCalls = 0, peakTris = 0, peakAt = '';
  while (!ended && ticks < MAX_TICKS) {
    const r = await p.evaluate(({ ch, chunk, every }) => {
      const G = window.__game;
      const freshOf = window.__e2eFresh;
      let st = G.getState();
      let calls = 0, tris = 0, at = '', n = 0, ended = false, fell = false, done = 0;
      while (done < chunk) {
        st = G.step(every, { render: true });
        done += every; n++;
        const pf = G.perf();
        if (pf.drawCalls > calls) { calls = pf.drawCalls; at = `${st.segment}@${st.beat.toFixed(0)}`; }
        tris = Math.max(tris, pf.triangles);
        const ev = freshOf(ch);
        ended = st.screen === 'outro' || ev.some((e) => e.type === 'chapter:end' && e.data && e.data.id === ch);
        fell = st.screen === 'fail' || ev.some((e) => e.type === 'fall');
        if (ended || fell) break;
      }
      return { st, calls, tris, at, n, ended, fell, done };
    }, { ch: id, chunk: CHUNK, every });
    ticks += r.done; frames += r.n;
    if (r.calls > peakCalls) { peakCalls = r.calls; peakAt = r.at; }
    peakTris = Math.max(peakTris, r.tris);
    if (r.calls > DRAW_LIMIT) failures.push(`draw calls ${r.calls} > ${DRAW_LIMIT} at ${r.at}`);
    if (r.fell) { failures.push(`fell at ${r.st.segment} beat ${r.st.beat.toFixed(1)}`); break; }
    ended = r.ended;
    if (takeShots && !ended && r.st.segment && !shotSegs.has(r.st.segment) && r.st.screen === 'play') {
      shotSegs.add(r.st.segment);
      // 再推进一小段，让画面里有东西（进段瞬间常是空拍）
      const pf2 = await p.evaluate(() => { window.__game.step(90); window.__game.render(); return window.__game.perf(); });
      ticks += 90; frames++;
      if (pf2.drawCalls > peakCalls) { peakCalls = pf2.drawCalls; peakAt = `${r.st.segment}`; }
      if (pf2.drawCalls > DRAW_LIMIT) failures.push(`draw calls ${pf2.drawCalls} > ${DRAW_LIMIT} at ${r.st.segment}`);
      await p.screenshot({ path: join(outDir, `${id}-${r.st.segment}.png`) });
    }
  }
  const st = await p.evaluate(() => window.__game.getState());
  if (!ended) failures.push(`chapter:end of ${id} not reached after ${ticks} ticks (at ${st.segment} beat ${st.beat.toFixed(1)}, screen ${st.screen})`);
  if (st.falls !== 0) failures.push(`falls = ${st.falls}`);
  return { failures, ended, ticks, frames, st, peakCalls, peakAt, peakTris, shotSegs };
}

try {
  await installFresh(g.p);
  // —— 自检：test 章连跑两遍，第二遍必须和第一遍一样长（不能被第一遍留下的 chapter:end 提前截断）——
  const a = await runChapter('test');
  const b = await runChapter('test');
  const selfcheck = { first: { ticks: a.ticks, frames: a.frames, simTime: +a.st.t.toFixed(2) }, second: { ticks: b.ticks, frames: b.frames, simTime: +b.st.t.toFixed(2) } };
  if (!a.ended || !b.ended || a.ticks !== b.ticks || a.frames !== b.frames || Math.abs(a.st.t - b.st.t) > 0.05) {
    global.push(`self-check failed: running the test chapter twice gave ${JSON.stringify(selfcheck)} (stale events from the previous run?)`);
  }
  if (!quiet) console.log(`${global.length ? 'FAIL' : 'PASS'} self-check (test chapter twice): ${JSON.stringify(selfcheck)}`);

  for (const m of todo) {
    const tc = Date.now();
    const r = await runChapter(m.id, { takeShots: shots });
    const { p } = g;
    const failures = r.failures;
    // 结尾卡输入上的节拍：停在结尾卡上，用真实键盘按 ↓ 三下，再等过超时
    let outroFired = [];
    if (r.ended && m.outroIds.length) {
      // 超时可能按真实时间（界面计时器）也可能按模拟时间（Game.tick）走：两种都给够
      for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowDown'); await p.evaluate(() => window.__game.step(30)); await p.waitForTimeout(250); }
      for (let waited = 0; waited < OUTRO_WAIT_MS; waited += 1000) { await p.evaluate(() => window.__game.step(120)); await p.waitForTimeout(1000); }
      outroFired = await p.evaluate(({ ids, ch }) => {
        const ev = window.__e2eFresh(ch);
        const b = window.__game.beats();
        return ids.filter((id) => b.includes(id) || ev.some((e) => e.data && e.data.id === id));
      }, { ids: m.outroIds, ch: m.id });
      const notFired = m.outroIds.filter((id) => !outroFired.includes(id));
      if (notFired.length) failures.push(`outro-card beat(s) not fired: ${notFired.join(', ')} (the outro input must report its id via __game.beats() or an event with data.id; see docs/contract-requests/WP1.md)`);
    }
    const beats = await p.evaluate(() => window.__game.beats());
    const need = m.requiredBeats.filter((b) => !m.outroIds.includes(b));
    const missing = need.filter((b) => !beats.includes(b));
    if (missing.length) failures.push(`missing required beats: ${missing.join(', ')}`);
    const segsMissingShot = shots ? m.segments.map((s) => s.id).filter((id) => !r.shotSegs.has(id)) : [];
    if (segsMissingShot.length) failures.push(`no screenshot for segment(s): ${segsMissingShot.join(', ')}`);
    const st = r.st;
    const res = {
      chapter: m.id, ok: failures.length === 0, ended: r.ended, ticks: r.ticks, frames: r.frames, simTime: +st.t.toFixed(1), falls: st.falls, stumbles: st.stumbles,
      crashes: st.crashes, lookBacks: st.lookBacks, notes: st.notes, beats: beats.length, requiredBeats: need.length, outroBeats: m.outroIds, outroFired,
      peakDrawCalls: r.peakCalls, peakAt: r.peakAt, peakTriangles: r.peakTris, screenshots: r.shotSegs.size, wallSec: +((Date.now() - tc) / 1000).toFixed(1), failures,
    };
    results.push(res);
    if (failures.length) bad++;
    if (!quiet) console.log(`${res.ok ? 'PASS' : 'FAIL'} ${m.id}: ${JSON.stringify(res)}`);
  }
} finally {
  await g.close();
}
const wall = Date.now() - t0;
if (g.external.length) global.push(`external requests: ${g.external.slice(0, 5).join(', ')}`);
if (g.errors.length) global.push(`page errors: ${g.errors.slice(0, 5).join(' | ')}`);
if (wall > LIMIT_MS) global.push(`wall clock ${(wall / 1000).toFixed(0)} s > ${LIMIT_MS / 1000} s`);
const summary = { chapters: results.map((r) => r.chapter), skipped: meta.filter((m) => !m.implemented).map((m) => m.id), every, external: g.external.length, pageErrors: g.errors.length, wallSec: +(wall / 1000).toFixed(1), failures: global };
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
if (bad || global.length) {
  console.error(`e2e:chapters FAILED\n  - ${[...results.flatMap((r) => r.failures.map((f) => `${r.chapter}: ${f}`)), ...global].join('\n  - ')}`);
  process.exit(1);
}
console.log('e2e:chapters passed');
