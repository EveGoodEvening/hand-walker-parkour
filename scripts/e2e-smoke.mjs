#!/usr/bin/env node
// scripts/e2e-smoke.mjs —— 冒烟测试（DESIGN.md §8.8、§8.9 验收 5）。CORE 冻结。
// SwiftShader、低画质、640×360：start('ch1', { skipCards: true }) → setAutopilot('perfect') → 分段 step，直到出现 chapter:end。
// 断言：falls === 0；beats() 包含 ch1.requiredBeats；每 1200 tick 渲染一帧，perf().drawCalls ≤ 50；零外部请求；零页面错误；
// 每段截一张图（shots/smoke/<段>.png）；墙钟时间 ≤ 120 s。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ensureBuilt, openGame } from './e2e-lib.mjs';

const CH = process.argv.includes('--ch') ? process.argv[process.argv.indexOf('--ch') + 1] : 'ch1';
const LIMIT_MS = 120_000;
const DRAW_LIMIT = 50;

const t0 = Date.now();
ensureBuilt();
const g = await openGame('', { who: 'e2e-smoke' });
const outDir = join(ROOT, 'shots', 'smoke');
mkdirSync(outDir, { recursive: true });
const failures = [];
let peakCalls = 0;
let peakTris = 0;
try {
  const { p } = g;
  const required = await p.evaluate(async (ch) => {
    await window.__game.start(ch, { skipCards: true });
    window.__game.setAutopilot('perfect');
    return ch;
  }, CH);
  void required;
  const shotSegs = new Set();
  let ended = false;
  let ticks = 0;
  let sinceRender = 0;
  let lastSeg = null;
  while (!ended && ticks < 120 * 400) {
    const r = await p.evaluate(() => {
      const st = window.__game.step(240);
      const ev = window.__game.events(400);
      return { st, ended: ev.some((e) => e.type === 'chapter:end') };
    });
    ticks += 240; sinceRender += 240;
    ended = r.ended || r.st.screen === 'outro';
    const segChanged = r.st.segment !== lastSeg;
    lastSeg = r.st.segment;
    if (sinceRender >= 1200 || (segChanged && !shotSegs.has(r.st.segment))) {
      sinceRender = 0;
      const pf = await p.evaluate(() => { window.__game.render(); return window.__game.perf(); });
      peakCalls = Math.max(peakCalls, pf.drawCalls);
      peakTris = Math.max(peakTris, pf.triangles);
      if (pf.drawCalls > DRAW_LIMIT) failures.push(`draw calls ${pf.drawCalls} > ${DRAW_LIMIT} at ${r.st.segment} beat ${r.st.beat.toFixed(1)}`);
      if (r.st.segment && !shotSegs.has(r.st.segment) && r.st.screen === 'play') {
        shotSegs.add(r.st.segment);
        // 再推进一小段，让画面里有东西（进段瞬间常是空拍）
        await p.evaluate(() => { window.__game.step(90); window.__game.render(); });
        await p.screenshot({ path: join(outDir, `${CH}-${r.st.segment}.png`) });
        ticks += 90;
      }
    }
  }
  const st = await p.evaluate(() => window.__game.getState());
  const beats = await p.evaluate(() => window.__game.beats());
  const requiredBeats = await p.evaluate(() => window.__game.ext.requiredBeats?.() ?? null);
  const expected = requiredBeats ?? (CH === 'ch1'
    ? ['whisperHandWalker', 'memoryInverted', 'chenMoAsk', 'mirrorLate', 'bellWarning', 'noteDesk', 'teacherDuty', 'footTwitch', 'firstSteps', 'emptyHall', 'shadowStanding', 'thirdHandShush']
    : []);
  if (!ended) failures.push(`chapter:end not reached after ${ticks} ticks (at ${st.segment} beat ${st.beat.toFixed(1)}, screen ${st.screen})`);
  if (st.falls !== 0) failures.push(`falls = ${st.falls}`);
  const missing = expected.filter((b) => !beats.includes(b));
  if (missing.length) failures.push(`missing required beats: ${missing.join(', ')}`);
  if (g.external.length) failures.push(`external requests: ${g.external.join(', ')}`);
  if (g.errors.length) failures.push(`page errors: ${g.errors.slice(0, 5).join(' | ')}`);
  const wall = Date.now() - t0;
  if (wall > LIMIT_MS) failures.push(`wall clock ${(wall / 1000).toFixed(1)} s > ${LIMIT_MS / 1000} s`);
  console.log(JSON.stringify({
    chapter: CH, ended, ticks, simTime: +st.t.toFixed(1), falls: st.falls, stumbles: st.stumbles, crashes: st.crashes, lookBacks: st.lookBacks,
    notes: st.notes, beats: beats.length, requiredBeats: expected.length, peakDrawCalls: peakCalls, peakTriangles: peakTris,
    external: g.external.length, pageErrors: g.errors.length, screenshots: shotSegs.size, wallSec: +(wall / 1000).toFixed(1),
  }));
} finally {
  await g.close();
}
if (failures.length) {
  console.error(`e2e:smoke FAILED\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('e2e:smoke passed');
