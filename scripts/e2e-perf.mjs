#!/usr/bin/env node
// scripts/e2e-perf.mjs —— 性能预算检查（DESIGN.md §9.4、WP3 验收 2–3、WP4 验收 3–4）。CORE 写初版，WP1 补全。
// 低画质、640×360（缺省；--q medium|high 用对应预算）：perfect 自动驾驶跑完每个已实现的章，每 --every 个 tick 渲染一帧，
// 断言峰值 draw call 与三角形不超预算（低 50 / 60k，中 80 / 120k，高 110 / 200k）。
// 内存：同一章连跑多遍（缺省 2 遍；--minutes N 时一直跑到这一章累计 N 分钟游戏时间，WP3 / WP4 的「5 分钟内存不增长」用
// --minutes 5），第一遍结束时 renderer.info.memory 的几何体数 / 纹理数作为基准，之后任何一遍结束时比基准多就判失败
// （renderer.info 只统计上传过 GPU 的，第一遍里随新 chunk 第一次可见而增长是正常的；§5.9、§10.1「游戏过程中不新建几何体」）。
// 事件日志跨章不清空：每一遍只认本章最后一次 chapter:start 之后、data.id === 本章的 chapter:end。每一遍都必须真的跑到
// 本章结束，而且后面几遍的帧数要和第一遍一样（自检：上一遍留下的 chapter:end 不能让下一遍 1 帧就退出）。
// 还没实现的章打印 skipped。一次取锁、一个浏览器跑完。
//   --ch ch2   只跑一章      --every 60   每多少 tick 渲染一帧      --q low      --minutes 5
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ensureBuilt, openGame } from './e2e-lib.mjs';
import { availableChapters } from './chapters-list.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = arg('--ch', null);
const every = Math.max(1, Number(arg('--every', 60)));
const minutes = Number(arg('--minutes', 0));
const q = arg('--q', 'low');
const BUDGET = { low: { drawCalls: 50, triangles: 60_000 }, medium: { drawCalls: 80, triangles: 120_000 }, high: { drawCalls: 110, triangles: 200_000 } }[q];
if (!BUDGET) { console.error(`unknown quality ${q}`); process.exit(1); }
const all = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'];
const avail = new Set(availableChapters());
const chapters = (only ? [only] : all).filter((c) => { if (!avail.has(c)) { console.log(`- ${c}: not implemented yet (skipped)`); return false; } return true; });
if (!chapters.length) { console.log('e2e:perf: nothing to run'); process.exit(0); }

ensureBuilt();
const t0 = Date.now();
const g = await openGame(`q=${q}`, { who: 'e2e-perf' });
const report = [];
let bad = 0;
try {
  const pass = (ch) => g.p.evaluate(async ({ c, every }) => {
    const G = window.__game;
    await G.start(c, { skipCards: true });
    G.setAutopilot('perfect');
    // 本章最后一次 chapter:start 之后的事件
    const fresh = () => {
      const ev = G.events();
      let i = ev.length - 1;
      while (i >= 0 && !(ev[i].type === 'chapter:start' && ev[i].data && ev[i].data.id === c)) i--;
      return ev.slice(i + 1);
    };
    let peak = { drawCalls: 0, triangles: 0, at: '', trianglesAt: '' };
    let frames = 0, ended = false, st = G.getState();
    for (let i = 0; i < 120 * 900 / every; i++) {
      st = G.step(every, { render: true });
      frames++;
      const pf = G.perf();
      if (pf.drawCalls > peak.drawCalls) { peak.drawCalls = pf.drawCalls; peak.at = `${st.segment}@${st.beat.toFixed(0)}`; }
      if (pf.triangles > peak.triangles) { peak.triangles = pf.triangles; peak.trianglesAt = `${st.segment}@${st.beat.toFixed(0)}`; }
      if (fresh().some((e) => e.type === 'chapter:end' && e.data && e.data.id === c)) { ended = true; break; }
      if (st.screen !== 'play') break;
    }
    const end = G.perf();
    return { chapter: c, frames, ended, simTime: st.t, screen: st.screen, ...peak, geometries: end.geometries, textures: end.textures, falls: G.getState().falls };
  }, { c: ch, every });

  for (const ch of chapters) {
    const passes = [await pass(ch)];
    let simTotal = passes[0].simTime;
    while (passes.length < 2 || simTotal < minutes * 60) {
      const r = await pass(ch);
      passes.push(r);
      simTotal += r.simTime;
      if (!r.ended) break;
    }
    const first = passes[0];
    const failures = [];
    passes.forEach((r, i) => {
      if (!r.ended) failures.push(`pass ${i + 1} did not reach chapter:end of ${ch} (stopped on screen ${r.screen} after ${r.frames} frames)`);
      if (r.falls) failures.push(`pass ${i + 1}: ${r.falls} fall(s)`);
      if (i > 0 && Math.abs(r.frames - first.frames) > Math.max(2, first.frames * 0.02)) {
        failures.push(`pass ${i + 1} ran ${r.frames} frames, pass 1 ran ${first.frames} (each pass must play the whole chapter)`);
      }
    });
    const drawCalls = Math.max(...passes.map((r) => r.drawCalls));
    const triangles = Math.max(...passes.map((r) => r.triangles));
    const worst = passes.find((r) => r.drawCalls === drawCalls);
    const worstTri = passes.find((r) => r.triangles === triangles);
    const over = drawCalls > BUDGET.drawCalls || triangles > BUDGET.triangles;
    if (over) failures.push(`over budget: ${drawCalls} draw calls / ${triangles} triangles (budget ${BUDGET.drawCalls} / ${BUDGET.triangles})`);
    const geometries = passes.map((r) => r.geometries), textures = passes.map((r) => r.textures);
    const grew = passes.slice(1).some((r) => r.geometries > first.geometries || r.textures > first.textures);
    if (grew) failures.push(`memory grew after the first pass: geometries ${geometries.join(' → ')}, textures ${textures.join(' → ')}`);
    const r = {
      chapter: ch, passes: passes.length, simMinutes: +(simTotal / 60).toFixed(2), frames: passes.map((x) => x.frames),
      drawCalls, at: worst.at, triangles, trianglesAt: worstTri.trianglesAt, geometries, textures, budget: BUDGET, memoryGrowth: grew, ok: failures.length === 0, failures,
    };
    report.push(r);
    if (failures.length) bad++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${ch}: ${passes.length} passes (${r.simMinutes} min, frames ${r.frames.join(' / ')}), peak ${drawCalls} draw calls (${r.at}), ${triangles} triangles (${r.trianglesAt}); geometries ${geometries.join(' → ')}, textures ${textures.join(' → ')}${grew ? '' : ' (stable after the first pass)'}${failures.length ? `\n  - ${failures.join('\n  - ')}` : ''}`);
  }
} finally {
  await g.close();
}
mkdirSync(join(ROOT, 'shots'), { recursive: true });
writeFileSync(join(ROOT, 'shots', 'perf-report.json'), JSON.stringify({ quality: q, every, minutes, wallSec: (Date.now() - t0) / 1000, report }, null, 2));
if (g.errors.length) { console.error(`page errors: ${g.errors.slice(0, 5).join(' | ')}`); bad++; }
if (g.external.length) { console.error(`external requests: ${g.external.slice(0, 5).join(', ')}`); bad++; }
if (bad) { console.error('e2e:perf FAILED'); process.exit(1); }
console.log(`e2e:perf passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
