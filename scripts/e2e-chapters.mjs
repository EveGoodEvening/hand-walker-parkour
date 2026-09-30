#!/usr/bin/env node
// scripts/e2e-chapters.mjs —— 全章 e2e（DESIGN.md §8.10 WP1 验收 8）。CORE 写初版，WP1 重写。
// SwiftShader、低画质、640×360，**一次**取浏览器锁、开一个浏览器跑完所有章：
//   每章 start(ch, { skipCards }) → perfect 自动驾驶跑到 chapter:end；断言 0 摔倒、requiredBeats 全部触发（结尾卡输入上的
//   节拍在界面里触发，nocards 下不算）、峰值 draw call ≤ 50、零外部请求、零页面错误；每段一张截图 shots/chapters/<章>-<段>.png；
//   总墙钟时间 ≤ 10 min。
// 还没实现的章（WP2 合并前返回 null 的桩）打印 skipped，合并后自动覆盖。章节元数据来自 `tsx scripts/validate-levels.ts --meta`。
//   --ch ch3    只跑一章          --no-shots   不截图           --json   只输出 JSON 汇总
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ensureBuilt, openGame } from './e2e-lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--ch') ? args[args.indexOf('--ch') + 1] : null;
const shots = !args.includes('--no-shots');
const LIMIT_MS = 10 * 60 * 1000;
const DRAW_LIMIT = 50;
const MAX_TICKS = 120 * 900;

const metaRun = spawnSync('npx', ['tsx', 'scripts/validate-levels.ts', '--meta'], { cwd: ROOT, encoding: 'utf8' });
if (metaRun.status !== 0) { console.error(metaRun.stderr); process.exit(1); }
const meta = JSON.parse(metaRun.stdout).filter((m) => m.id !== 'test' && (!only || m.id === only));
for (const m of meta) if (!m.implemented) console.log(`- ${m.id}: not implemented yet (skipped)`);
const todo = meta.filter((m) => m.implemented);
if (!todo.length) { console.log('e2e:chapters: nothing to run'); process.exit(only ? 1 : 0); }

const t0 = Date.now();
ensureBuilt();
const outDir = join(ROOT, 'shots', 'chapters');
mkdirSync(outDir, { recursive: true });
const g = await openGame('', { who: 'e2e-chapters' });
const results = [];
let bad = 0;
try {
  const { p } = g;
  for (const m of todo) {
    const tc = Date.now();
    const failures = [];
    await p.evaluate(async (ch) => { await window.__game.start(ch, { skipCards: true }); window.__game.setAutopilot('perfect'); }, m.id);
    const shotSegs = new Set();
    let ended = false, ticks = 0, sinceRender = 1200, lastSeg = null, peakCalls = 0, peakTris = 0, peakAt = '';
    while (!ended && ticks < MAX_TICKS) {
      const r = await p.evaluate(() => {
        const st = window.__game.step(240);
        const ev = window.__game.events(600);
        return { st, ended: ev.some((e) => e.type === 'chapter:end'), fell: ev.some((e) => e.type === 'fall') };
      });
      ticks += 240; sinceRender += 240;
      ended = r.ended || r.st.screen === 'outro';
      if (r.fell || r.st.screen === 'fail') { failures.push(`fell at ${r.st.segment} beat ${r.st.beat.toFixed(1)}`); break; }
      const segChanged = r.st.segment !== lastSeg;
      lastSeg = r.st.segment;
      if (sinceRender >= 1200 || (segChanged && !shotSegs.has(r.st.segment))) {
        sinceRender = 0;
        const pf = await p.evaluate(() => { window.__game.render(); return window.__game.perf(); });
        if (pf.drawCalls > peakCalls) { peakCalls = pf.drawCalls; peakAt = `${r.st.segment}@${r.st.beat.toFixed(0)}`; }
        peakTris = Math.max(peakTris, pf.triangles);
        if (pf.drawCalls > DRAW_LIMIT) failures.push(`draw calls ${pf.drawCalls} > ${DRAW_LIMIT} at ${r.st.segment} beat ${r.st.beat.toFixed(1)}`);
        if (r.st.segment && !shotSegs.has(r.st.segment) && r.st.screen === 'play') {
          shotSegs.add(r.st.segment);
          // 再推进一小段，让画面里有东西（进段瞬间常是空拍）
          const pf2 = await p.evaluate(() => { window.__game.step(90); window.__game.render(); return window.__game.perf(); });
          peakCalls = Math.max(peakCalls, pf2.drawCalls);
          if (pf2.drawCalls > DRAW_LIMIT) failures.push(`draw calls ${pf2.drawCalls} > ${DRAW_LIMIT} at ${r.st.segment}`);
          if (shots) await p.screenshot({ path: join(outDir, `${m.id}-${r.st.segment}.png`) });
          ticks += 90;
        }
      }
    }
    const st = await p.evaluate(() => window.__game.getState());
    const beats = await p.evaluate(() => window.__game.beats());
    const need = m.requiredBeats.filter((b) => !m.outroIds.includes(b));
    const missing = need.filter((b) => !beats.includes(b));
    if (!ended) failures.push(`chapter:end not reached after ${ticks} ticks (at ${st.segment} beat ${st.beat.toFixed(1)}, screen ${st.screen})`);
    if (st.falls !== 0) failures.push(`falls = ${st.falls}`);
    if (missing.length) failures.push(`missing required beats: ${missing.join(', ')}`);
    const segsMissingShot = shots ? m.segments.map((s) => s.id).filter((id) => !shotSegs.has(id)) : [];
    if (segsMissingShot.length) failures.push(`no screenshot for segment(s): ${segsMissingShot.join(', ')}`);
    const res = {
      chapter: m.id, ok: failures.length === 0, ended, ticks, simTime: +st.t.toFixed(1), falls: st.falls, stumbles: st.stumbles, crashes: st.crashes,
      lookBacks: st.lookBacks, notes: st.notes, beats: beats.length, requiredBeats: need.length, outroBeats: m.outroIds,
      peakDrawCalls: peakCalls, peakAt, peakTriangles: peakTris, screenshots: shotSegs.size, wallSec: +((Date.now() - tc) / 1000).toFixed(1), failures,
    };
    results.push(res);
    if (failures.length) bad++;
    if (!args.includes('--json')) console.log(`${res.ok ? 'PASS' : 'FAIL'} ${m.id}: ${JSON.stringify(res)}`);
  }
} finally {
  await g.close();
}
const wall = Date.now() - t0;
const global = [];
if (g.external.length) global.push(`external requests: ${g.external.slice(0, 5).join(', ')}`);
if (g.errors.length) global.push(`page errors: ${g.errors.slice(0, 5).join(' | ')}`);
if (wall > LIMIT_MS) global.push(`wall clock ${(wall / 1000).toFixed(0)} s > ${LIMIT_MS / 1000} s`);
const summary = { chapters: results.map((r) => r.chapter), skipped: meta.filter((m) => !m.implemented).map((m) => m.id), external: g.external.length, pageErrors: g.errors.length, wallSec: +(wall / 1000).toFixed(1), failures: global };
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
if (bad || global.length) {
  console.error(`e2e:chapters FAILED\n  - ${[...results.flatMap((r) => r.failures.map((f) => `${r.chapter}: ${f}`)), ...global].join('\n  - ')}`);
  process.exit(1);
}
console.log('e2e:chapters passed');
