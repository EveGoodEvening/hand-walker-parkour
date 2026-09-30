#!/usr/bin/env node
// tests/e2e-touch.mjs —— 键盘 / 触摸全流程（DESIGN.md §8.9 验收 1、§8.10 WP8 验收 2）。CORE 写初版，归 WP8。
// 两轮，都不开自动驾驶，只用真实的 DOM 输入：
//   keyboard：640×360。标题按 Enter「开始」→ 开场卡按键跳过 → 按求解器路线用方向键玩完第一章（静场按住 ↓，回头按 Q）→ 结尾卡。
//   touch   ：360×640 竖屏、Chrome 设备模拟（hasTouch / isMobile）。点「开始」→ 等开场卡 → 用 CDP 触摸事件滑动
//             （左右滑换道、上滑撑跃、下滑不抬手 = 伏低 / 按住）、点情境按钮「回头」→ 结尾卡。
// 另外检查：暂停（Esc / 右上角‖）→ 继续。断言：到达结尾卡、0 摔倒、必备节拍全部触发、零页面错误。
// 用法：node tests/e2e-touch.mjs [--only keyboard|touch]
import { ensureBuilt, openGame } from '../scripts/e2e-lib.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

async function state(p) { return p.evaluate(() => window.__game.getState()); }
async function step(p, n) { return p.evaluate((k) => window.__game.step(k), n); }

async function run(mode) {
  const touch = mode === 'touch';
  const g = await openGame('', { touch, viewport: touch ? { width: 360, height: 640 } : { width: 640, height: 360 }, who: `e2e-touch:${mode}` });
  const { p } = g;
  const log = [];
  let cdp = null;
  const W = touch ? 360 : 640, H = touch ? 640 : 360;
  const cx = W / 2, cy = H * 0.55;
  let touching = false;
  const tStart = async (x = cx, y = cy) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); touching = true; };
  const tMove = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); };
  const tEnd = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); touching = false; };
  const swipe = async (dx, dy, hold = false) => {
    await tStart();
    await tMove(cx + dx * 0.5, cy + dy * 0.5);
    await tMove(cx + dx, cy + dy);
    if (!hold) await tEnd();
  };
  try {
    if (touch) cdp = await p.context().newCDPSession(p);
    let st = await state(p);
    if (st.screen !== 'title') throw new Error(`expected title, got ${st.screen}`);
    // —— 标题 → 开始 ——
    if (touch) await p.tap('[data-screen="title"] button:has-text("开始")');
    else { await p.keyboard.press('Enter'); }
    await p.waitForFunction(() => window.__game.screen() === 'intro', null, { timeout: 30_000 });
    // —— 开场卡 ——
    if (touch) st = await step(p, 420);
    else { await p.keyboard.press('Enter'); st = await step(p, 2); }
    if (st.screen !== 'play') throw new Error(`intro did not end (screen ${st.screen})`);
    // —— 暂停 → 继续 ——
    if (touch) await p.tap('.hw-pausebtn'); else await p.keyboard.press('Escape');
    st = await step(p, 1);
    if (st.screen !== 'pause') throw new Error(`pause did not open (screen ${st.screen})`);
    if (touch) await p.tap('.hw-pause button:has-text("继续")'); else { await p.keyboard.press('Enter'); }
    st = await step(p, 1);
    if (st.screen !== 'play') throw new Error(`resume failed (screen ${st.screen})`);
    // —— 游玩：按求解器路线用真实输入 ——
    let seg = null, plan = null, cursor = 0, looked = new Set(), stillHeld = false, guard = 0;
    while (guard++ < 20_000) {
      const r = await p.evaluate(() => {
        const b = document.querySelector('.hw-context-btn');
        return { st: window.__game.getState(), look: !!b && b.style.display !== 'none' && b.textContent === '回头' };
      });
      st = r.st;
      if (st.screen === 'outro') break;
      if (st.screen === 'fail') throw new Error(`fell at ${st.segment} beat ${st.beat.toFixed(1)}`);
      if (st.screen !== 'play') { await step(p, 1); continue; }
      if (st.segKind !== 'run') {
        if (plan) { plan = null; seg = null; }
        const waiting = st.hint && st.hint !== 'look';
        if (waiting && !stillHeld) {
          if (touch) await tStart(); else await p.keyboard.down('ArrowDown');
          stillHeld = true; log.push(`${st.segment}: hold`);
        } else if (!waiting && stillHeld) {
          if (touch) await tEnd(); else await p.keyboard.up('ArrowDown');
          stillHeld = false;
        }
        await step(p, 6);
        continue;
      }
      if (st.segment !== seg) {
        seg = st.segment;
        plan = await p.evaluate(() => { const pl = window.__game.plan(); return pl ? pl.steps.map((s) => ({ s: s.s, a: s.action })) : null; });
        if (!plan) throw new Error(`no plan for ${seg}`);
        cursor = 0;
        while (cursor < plan.length && plan[cursor].s < st.s - 1e-6) cursor++;
      }
      // 回头窗口：情境按钮「回头」出现就回头一次
      if (r.look && !looked.has(seg)) {
        looked.add(seg);
        if (touch) await p.tap('.hw-context-btn'); else await p.keyboard.press('KeyQ');
        log.push(`${seg}: look`);
        await step(p, 1);
        continue;
      }
      const nx = plan[cursor];
      if (nx && nx.s <= st.s + 1e-9) {
        cursor++;
        log.push(`${seg}@${st.beat.toFixed(2)} ${nx.a}`);
        if (touch) {
          if (nx.a === 'left') await swipe(-32, 0);
          else if (nx.a === 'right') await swipe(32, 0);
          else if (nx.a === 'jump') await swipe(0, -32);
          else if (nx.a === 'duck') await swipe(0, 32, true);
          else if (nx.a === 'duckRelease' && touching) await tEnd();
        } else {
          const key = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp' }[nx.a];
          if (key) await p.keyboard.press(key);
          else if (nx.a === 'duck') await p.keyboard.down('ArrowDown');
          else if (nx.a === 'duckRelease') await p.keyboard.up('ArrowDown');
        }
        // 同一 tick 可能有多个动作：先不推进，下一轮再看
        if (plan[cursor] && plan[cursor].s <= st.s + 1e-9) continue;
        await step(p, 1);
        continue;
      }
      // 离下一个动作还远：按速度估计能安全推进的 tick 数
      const speed = Math.max(7, st.speed * 1.5);   // 保守估计（减速段结束时速度会回升）
      const ticks = nx ? Math.floor(((nx.s - st.s) / speed) * 120) - 1 : 60;
      await step(p, Math.max(1, Math.min(120, ticks)));
    }
    st = await state(p);
    const beats = await p.evaluate(() => window.__game.beats());
    const required = await p.evaluate(() => window.__game.ext.requiredBeats());
    const outroText = await p.evaluate(() => document.querySelector('.hw-outro')?.textContent ?? '');
    const hits = await p.evaluate(() => window.__game.events().filter((e) => e.type === 'hit').map((e) => ({ tick: e.tick, ...e.data })));
    const problems = [];
    if (st.screen !== 'outro') problems.push(`did not reach outro (screen ${st.screen}, ${st.segment} beat ${st.beat.toFixed(1)})`);
    if (st.falls) problems.push(`falls = ${st.falls}`);
    const missing = required.filter((b) => !beats.includes(b));
    if (missing.length) problems.push(`missing beats: ${missing.join(', ')}`);
    if (!outroText.includes('用时')) problems.push('outro stats line missing');
    if (g.errors.length) problems.push(`page errors: ${g.errors.slice(0, 3).join(' | ')}`);
    await p.waitForTimeout(3500);   // 结尾卡逐行淡入（CSS 动画按真实时间走）
    await p.screenshot({ path: `shots/e2e-${mode}-outro.png` });
    console.log(JSON.stringify({ mode, screen: st.screen, falls: st.falls, stumbles: st.stumbles, crashes: st.crashes, lookBacks: st.lookBacks,
      notes: st.notes, beats: beats.length, actions: log.length, hits, outro: outroText.slice(0, 60) }));
    return problems;
  } finally {
    await g.close();
  }
}

ensureBuilt();
const problems = [];
for (const m of ['keyboard', 'touch']) {
  if (only && only !== m) continue;
  const pr = await run(m);
  for (const x of pr) problems.push(`${m}: ${x}`);
}
if (problems.length) { console.error(`e2e:touch FAILED\n  - ${problems.join('\n  - ')}`); process.exit(1); }
console.log('e2e:touch passed');
