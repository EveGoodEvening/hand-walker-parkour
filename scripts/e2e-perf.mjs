#!/usr/bin/env node
// scripts/e2e-perf.mjs —— 性能预算检查（DESIGN.md §9.4、WP3 验收 2、WP4 验收 3）。CORE 写初版，WP1 补全。
// 低画质、640×360（缺省；--q medium|high 用对应预算）：perfect 自动驾驶跑完每个已实现的章，每 --every 个 tick 渲染一帧，
// 断言峰值 draw call 与三角形不超预算（低 50 / 60k，中 80 / 120k，高 110 / 200k）。
// 另外报告内存：同一章连跑两遍，第二遍结束时 renderer.info.memory 的几何体数 / 纹理数不应比第一遍结束时多
// （renderer.info 只统计上传过 GPU 的，第一遍里随新 chunk 第一次可见而增长是正常的；§5.9「游戏过程中不创建几何体」）。
// 只报告，不判失败——WP3 / WP4 的「5 分钟内存不增长」验收用。
// 还没实现的章打印 skipped。一次取锁、一个浏览器跑完。
//   --ch ch2   只跑一章      --every 60   每多少 tick 渲染一帧      --q low
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ensureBuilt, openGame } from './e2e-lib.mjs';
import { availableChapters } from './chapters-list.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const only = arg('--ch', null);
const every = Number(arg('--every', 60));
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
  for (const ch of chapters) {
    const pass = () => g.p.evaluate(async ({ c, every }) => {
      const G = window.__game;
      await G.start(c, { skipCards: true });
      G.setAutopilot('perfect');
      let peak = { drawCalls: 0, triangles: 0, at: '', trianglesAt: '' };
      let frames = 0;
      for (let i = 0; i < 120 * 900 / every; i++) {
        const st = G.step(every, { render: true });
        frames++;
        const pf = G.perf();
        if (pf.drawCalls > peak.drawCalls) { peak.drawCalls = pf.drawCalls; peak.at = `${st.segment}@${st.beat.toFixed(0)}`; }
        if (pf.triangles > peak.triangles) { peak.triangles = pf.triangles; peak.trianglesAt = `${st.segment}@${st.beat.toFixed(0)}`; }
        if (st.screen !== 'play' || G.events(200).some((e) => e.type === 'chapter:end')) break;
      }
      const end = G.perf();
      return { chapter: c, frames, ...peak, geometries: end.geometries, textures: end.textures, falls: G.getState().falls };
    }, { c: ch, every });
    const first = await pass();
    const second = await pass();
    const r = { ...first, drawCalls: Math.max(first.drawCalls, second.drawCalls), triangles: Math.max(first.triangles, second.triangles),
      geometries: [first.geometries, second.geometries], textures: [first.textures, second.textures] };
    const over = r.drawCalls > BUDGET.drawCalls || r.triangles > BUDGET.triangles;
    const grew = r.geometries[1] > r.geometries[0] || r.textures[1] > r.textures[0];
    report.push({ ...r, budget: BUDGET, ok: !over, memoryGrowth: grew });
    if (over) bad++;
    console.log(`${over ? 'FAIL' : 'PASS'} ${ch}: peak ${r.drawCalls} draw calls (${r.at}), ${r.triangles} triangles (${r.trianglesAt}); geometries ${r.geometries.join(' → ')}, textures ${r.textures.join(' → ')}${grew ? ' (grew on the second pass: possible leak)' : ' (stable on the second pass)'}`);
  }
} finally {
  await g.close();
}
mkdirSync(join(ROOT, 'shots'), { recursive: true });
writeFileSync(join(ROOT, 'shots', 'perf-report.json'), JSON.stringify({ quality: q, every, wallSec: (Date.now() - t0) / 1000, report }, null, 2));
if (g.errors.length) { console.error(`page errors: ${g.errors.slice(0, 5).join(' | ')}`); bad++; }
if (g.external.length) { console.error(`external requests: ${g.external.slice(0, 5).join(', ')}`); bad++; }
if (bad) { console.error('e2e:perf FAILED'); process.exit(1); }
console.log(`e2e:perf passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
