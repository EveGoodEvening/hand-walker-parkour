#!/usr/bin/env node
// scripts/e2e-perf.mjs —— 性能预算检查（DESIGN.md §9.4、WP3 验收 2）。CORE 写初版，归 WP1。
// 低画质、640×360：perfect 自动驾驶跑完每个已实现的章，每 60 tick 渲染一帧，断言峰值 draw call ≤ 50、三角形 ≤ 60k。
import { ensureBuilt, openGame } from './e2e-lib.mjs';
import { availableChapters } from './chapters-list.mjs';

const BUDGET = { drawCalls: 50, triangles: 60_000 };
const only = process.argv.includes('--ch') ? [process.argv[process.argv.indexOf('--ch') + 1]] : null;
ensureBuilt();
const g = await openGame('', { who: 'e2e-perf' });
const report = [];
let bad = 0;
try {
  for (const ch of only ?? availableChapters()) {
    const r = await g.p.evaluate(async (c) => {
      await window.__game.start(c, { skipCards: true });
      window.__game.setAutopilot('perfect');
      let peak = { drawCalls: 0, triangles: 0, at: '' };
      for (let i = 0; i < 400; i++) {
        const st = window.__game.step(60, { render: true });
        const pf = window.__game.perf();
        if (pf.drawCalls > peak.drawCalls) peak = { drawCalls: pf.drawCalls, triangles: Math.max(peak.triangles, pf.triangles), at: `${st.segment}@${st.beat.toFixed(0)}` };
        peak.triangles = Math.max(peak.triangles, pf.triangles);
        if (st.screen === 'outro') break;
      }
      return { chapter: c, ...peak };
    }, ch);
    report.push(r);
    if (r.drawCalls > BUDGET.drawCalls || r.triangles > BUDGET.triangles) bad++;
  }
} finally {
  await g.close();
}
console.log(JSON.stringify(report));
if (bad) { console.error('e2e:perf FAILED (budget exceeded)'); process.exit(1); }
console.log('e2e:perf passed');
