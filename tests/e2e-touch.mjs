#!/usr/bin/env node
// tests/e2e-touch.mjs —— 键盘 / 触摸全流程与版面检查（DESIGN.md §8.9 验收 1、§8.10 WP8 验收 2、3）。CORE 写初版，归 WP8。
// 三轮，每轮单独经 browser-lock 取槽位（每次占用远小于 10 min），用完立即关闭浏览器：
//   keyboard：640×360，只用键盘。标题 ↓ 回车「章节」→ 回车「第一章」→ 开场卡（选章的回车不能顺带跳过它）按一个没映射的键跳过
//             → Esc 暂停 → ↓↓ 回车「设置」→ → 改一项 → Esc 返回暂停 → 回车「继续」→ 按求解器路线用方向键玩
//             （静场按住 ↓，回头按 Q）→ 1-5 追随者登场后故意不动，直到摔倒 → 失败卡：1.2 s 之前按键无效，之后按任意键从检查点重来
//             → 继续玩完第一章 → 结尾卡。
//   touch   ：360×640 竖屏、Chrome 设备模拟（hasTouch / isMobile），只用触摸。点「章节」→ 点「第一章」→ 轻触跳过开场卡
//             → 点右上角‖ → 点「设置」→ 点「返回」→ 点「继续」→ 用 CDP 触摸事件滑动（左右滑换道、上滑撑跃、下滑不松手 = 伏低 / 按住）、
//             点情境按钮「回头」→ 故意摔倒 → 轻触重来 → 结尾卡。
//   layout  ：360×640（触摸）与 1920×1080，标题 / 章节 / 设置 / 纸条 / 暂停 / 失败 / 结尾卡 / HUD（hudDemo 把每个元素都填上最长的内容）：
//             没有横向滚动条、没有元素伸出视口左右边；字幕与其余 HUD 元素两两不重叠，HUD 栈里的元素互不重叠。
// 断言：到达结尾卡、只摔倒那一次、必备节拍全部触发、HUD 章名、提示文字随设备切换（静场「↓ 按住」/「按住屏幕」）、零页面错误。
// 用法：node tests/e2e-touch.mjs [--only keyboard|touch|layout] [--url http://localhost:5173/]（缺省用 dist/index.html）
import { mkdirSync } from 'node:fs';
import { ensureBuilt, openGame } from '../scripts/e2e-lib.mjs';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const only = arg('--only') ?? null;
const url = arg('--url');   // 例如 vite dev：http://localhost:5173/
mkdirSync('shots', { recursive: true });

const FAIL_KEY = '按任意键，从检查点重来。';
const FAIL_TOUCH = '轻触，从检查点重来。';
const HOLD_TEXT = { keyboard: '↓ 按住', touch: '按住屏幕' };

async function state(p) { return p.evaluate(() => window.__game.getState()); }
async function step(p, n) { return p.evaluate((k) => window.__game.step(k), n); }
async function ui(p) { return p.evaluate(() => window.__game.ext.ui()); }
function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function waitScreen(p, name, ms = 30_000) {
  await p.waitForFunction((n) => window.__game.screen() === n, name, { timeout: ms });
}
/** UI 自己的界面（章节 / 设置 / 纸条只由 UI 切换，Game 的 screen 不变）。 */
async function uiScreen(p) { return (await ui(p)).screen; }

// ——————————————————————————— 全流程 ———————————————————————————
async function flow(mode) {
  const touch = mode === 'touch';
  const W = touch ? 360 : 640, H = touch ? 640 : 360;
  const g = await openGame('', { touch, url, viewport: { width: W, height: H }, who: `e2e-touch:${mode}` });
  const { p } = g;
  const log = [];
  const t0 = Date.now();
  let cdp = null;
  const cx = W / 2, cy = H * 0.55;
  let touching = false, downHeld = false;
  const tStart = async (x = cx, y = cy) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); touching = true; };
  const tMove = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); };
  const tEnd = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); touching = false; };
  const swipe = async (dx, dy, hold = false) => {
    await tStart();
    await tMove(cx + dx * 0.5, cy + dy * 0.5);
    await tMove(cx + dx, cy + dy);
    if (!hold) await tEnd();
  };
  /** 轻触屏幕空白处（菜单情境 = 确认）：取上方 15% 处的中线，避开按钮和右上角的‖。 */
  const tapBlank = async () => { await p.touchscreen.tap(cx, H * 0.15); };
  const releaseAll = async () => {
    if (touch && touching) await tEnd();
    if (!touch && downHeld) { await p.keyboard.up('ArrowDown'); downHeld = false; }
  };
  const seen = { chapterName: new Set(), hints: new Set(), failPrompt: '', intro: false };
  try {
    if (touch) cdp = await p.context().newCDPSession(p);
    let st = await state(p);
    expect(st.screen === 'title', `expected title, got ${st.screen}`);
    // —— 标题 → 章节 ——
    if (touch) await p.tap('[data-screen="title"] button:has-text("章节")');
    else { await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); }
    expect(await uiScreen(p) === 'chapters', 'chapters screen did not open');
    log.push('title → chapters');
    // —— 章节 → 第一章 → 开场卡 ——
    if (touch) await p.tap('[data-screen="chapters"] button[data-chapter="ch1"]');
    else await p.keyboard.press('Enter');
    await waitScreen(p, 'intro');
    st = await step(p, 2);
    expect(st.screen === 'intro', `the key that picked the chapter also skipped the intro (screen ${st.screen})`);
    seen.intro = true;
    // 「按任意键 / 轻触」跳过开场卡：键盘用一个没有映射的键
    if (touch) await tapBlank(); else await p.keyboard.press('KeyK');
    st = await step(p, 2);
    expect(st.screen === 'play', `intro did not end on any key / tap (screen ${st.screen})`);
    log.push('intro skipped');
    // —— 暂停 → 设置 → 返回 → 继续 ——
    if (touch) await p.tap('.hw-pausebtn'); else await p.keyboard.press('Escape');
    st = await step(p, 1);
    expect(st.screen === 'pause', `pause did not open (screen ${st.screen})`);
    if (touch) await p.tap('[data-screen="pause"] button:has-text("设置")');
    else { await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); }
    expect(await uiScreen(p) === 'settings', 'settings did not open from pause');
    // 改一项（字幕大小：标准 → 大），检查原地更新
    if (touch) await p.tap('[data-screen="settings"] button.v[data-key="subtitleSize"]');
    else {
      for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowDown');
      await p.keyboard.press('ArrowRight');
    }
    const sub = await p.evaluate(() => document.querySelector('[data-screen="settings"] button.v[data-key="subtitleSize"]')?.textContent);
    expect(sub === '大', `settings value did not change in place (${sub})`);
    if (touch) await p.tap('[data-screen="settings"] button:has-text("返回")'); else await p.keyboard.press('Escape');
    expect(await uiScreen(p) === 'pause', 'back from settings did not return to pause');
    if (touch) await p.tap('[data-screen="pause"] button:has-text("继续")'); else await p.keyboard.press('Enter');
    st = await step(p, 1);
    expect(st.screen === 'play', `resume failed (screen ${st.screen})`);
    log.push('pause → settings → back → resume');
    // —— 游玩：按求解器路线用真实输入；1-5 追随者登场后故意摔倒一次 ——
    let seg = null, plan = null, cursor = 0, stillHeld = false, guard = 0, failed = false;
    const looked = new Set();
    while (guard++ < 20_000) {
      const r = await p.evaluate(() => {
        const b = document.querySelector('.hw-context-btn');
        return {
          st: window.__game.getState(), look: !!b && b.style.display !== 'none' && b.textContent === '回头',
          chname: document.querySelector('.hw-chname')?.textContent ?? '', hint: document.querySelector('.hw-hint.on')?.textContent ?? '',
        };
      });
      st = r.st;
      if (r.chname) seen.chapterName.add(r.chname);
      if (r.hint) seen.hints.add(r.hint);
      if (st.screen === 'outro') break;
      if (st.screen === 'fail') {
        expect(!failed, `fell a second time at ${st.segment} beat ${st.beat.toFixed(1)}`);
        failed = true;
        await releaseAll();
        // 1.2 s 之前按键无效
        if (touch) await tapBlank(); else await p.keyboard.press('KeyK');
        st = await step(p, 1);
        expect(st.screen === 'fail', 'retry accepted before the 1.2 s prompt');
        let u = await ui(p);
        for (let i = 0; i < 40 && !u.failPrompt; i++) { await step(p, 3); u = await ui(p); }
        expect(u.failPrompt, 'fail prompt never appeared');
        await p.evaluate(() => window.__game.render());
        seen.failPrompt = await p.evaluate(() => document.querySelector('.hw-fail .prompt.on')?.textContent ?? '');
        await p.screenshot({ path: `shots/e2e-${mode}-fail.png` });
        if (touch) await tapBlank(); else await p.keyboard.press('KeyK');
        st = await step(p, 1);
        expect(st.screen === 'play', `any key / tap did not retry (screen ${st.screen})`);
        expect(st.segment === st.checkpoint.segment, 'retry did not return to the checkpoint segment');
        log.push(`fail → retry at ${st.checkpoint.segment}@${st.checkpoint.beat}`);
        seg = null; plan = null;
        continue;
      }
      if (st.screen !== 'play') { await step(p, 1); continue; }
      if (st.segKind !== 'run') {
        if (plan) { plan = null; seg = null; }
        const waiting = st.hint && st.hint !== 'look';
        if (waiting && !stillHeld) {
          // 静场提示（每次都显示，不计入 hintsSeen）：先渲染一帧，确定地读到它的文字
          const h = await p.evaluate(() => { window.__game.render(); return document.querySelector('.hw-hint.on')?.textContent ?? ''; });
          if (h) seen.hints.add(h);
          if (touch) await tStart(); else await p.keyboard.down('ArrowDown');
          stillHeld = true; log.push(`${st.segment}: hold`);
        } else if (!waiting && stillHeld) {
          if (touch) await tEnd(); else await p.keyboard.up('ArrowDown');
          stillHeld = false;
        }
        await step(p, 6);
        continue;
      }
      // 故意摔倒：1-5 追随者登场（hidden → behind）之后不再输入
      if (!failed && st.segment === '1-5' && st.follower.mode !== 'hidden') {
        await releaseAll();
        await step(p, 6);
        continue;
      }
      if (st.segment !== seg) {
        seg = st.segment;
        plan = await p.evaluate(() => { const pl = window.__game.plan(); return pl ? pl.steps.map((s) => ({ s: s.s, a: s.action })) : null; });
        expect(plan, `no plan for ${seg}`);
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
          else if (nx.a === 'duck') { await p.keyboard.down('ArrowDown'); downHeld = true; }
          else if (nx.a === 'duckRelease') { await p.keyboard.up('ArrowDown'); downHeld = false; }
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
    await p.evaluate(() => window.__game.render());
    const outro = await p.evaluate(() => ({
      text: document.querySelector('[data-screen="outro"]')?.textContent ?? '',
      buttons: Array.from(document.querySelectorAll('[data-screen="outro"] button')).map((b) => b.textContent),
    }));
    const problems = [];
    if (st.screen !== 'outro') problems.push(`did not reach outro (screen ${st.screen}, ${st.segment} beat ${st.beat.toFixed(1)})`);
    if (!failed) problems.push('never reached the fail card');
    if (st.falls !== 1) problems.push(`falls = ${st.falls} (expected exactly the one on purpose)`);
    const missing = required.filter((b) => !beats.includes(b));
    if (missing.length) problems.push(`missing beats: ${missing.join(', ')}`);
    if (!outro.text.includes('用时')) problems.push('outro stats line missing');
    if (!outro.buttons.includes('重玩本章') || !outro.buttons.includes('回到标题')) problems.push(`outro buttons: ${outro.buttons.join('/')}`);
    if (!seen.chapterName.has('第一章　早自习')) problems.push(`HUD chapter name never shown (${[...seen.chapterName].join('/')})`);
    const wantFail = touch ? FAIL_TOUCH : FAIL_KEY;
    if (seen.failPrompt !== wantFail) problems.push(`fail prompt "${seen.failPrompt}", expected "${wantFail}"`);
    if (!seen.hints.has(HOLD_TEXT[mode])) problems.push(`still hold hint "${HOLD_TEXT[mode]}" never shown (saw ${[...seen.hints].join(' / ')})`);
    const other = HOLD_TEXT[touch ? 'keyboard' : 'touch'];
    if (seen.hints.has(other)) problems.push(`hint for the other device shown: ${other}`);
    if (g.errors.length) problems.push(`page errors: ${g.errors.slice(0, 3).join(' | ')}`);
    await p.waitForTimeout(3500);   // 结尾卡逐行淡入（CSS 动画按真实时间走）
    await p.screenshot({ path: `shots/e2e-${mode}-outro.png` });
    console.log(JSON.stringify({ mode, sec: Math.round((Date.now() - t0) / 1000), screen: st.screen, falls: st.falls, stumbles: st.stumbles,
      crashes: st.crashes, lookBacks: st.lookBacks, notes: st.notes, beats: beats.length, actions: log.length,
      hints: [...seen.hints], failPrompt: seen.failPrompt, outroButtons: outro.buttons, flow: log.filter((l) => !l.includes('@')) }));
    return problems;
  } finally {
    await g.close();
  }
}

// ——————————————————————————— 版面检查 ———————————————————————————
/** 在页面里执行：横向溢出 + 当前可见界面里伸出视口的元素。 */
function pageOverflow() {
  const vw = window.innerWidth;
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1) out.push(`scrollWidth ${de.scrollWidth}/${document.body.scrollWidth} > ${vw}`);
  const visible = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.01; };
  const roots = Array.from(document.querySelectorAll('#ui .hw-screen.on, #ui .hw-hud.on, #app > .hw-context-btn'));
  for (const root of roots) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (e.closest('.hw-layer:not(.hw-hud)') || !visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`${e.className || e.tagName} [${Math.round(r.left)}, ${Math.round(r.right)}] outside 0..${vw}`);
    }
  }
  return out.slice(0, 8);
}

/** HUD：字幕行与其余元素、栈内元素两两不重叠。 */
function hudOverlap() {
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (e) => e.getBoundingClientRect();
  const q = (s) => Array.from(document.querySelectorAll(s)).filter(vis);
  const subs = q('.hw-subs .hw-line');
  const others = [
    ...q('.hw-hint.on'), ...q('.hw-count.on'), ...q('.hw-balance.on'), ...q('.hw-metro.on .hw-dots'), ...q('.hw-noteopen.on'),
    ...q('#app > .hw-context-btn'), ...q('.hw-skipbtn.on'), ...q('.hw-notefl.on'), ...q('.hw-chname'), ...q('.hw-pausebtn'),
  ];
  const name = (e) => (typeof e.className === 'string' ? e.className : e.tagName).split(' ').slice(0, 2).join('.');
  const hit = (a, b) => { const A = box(a), B = box(b); const w = Math.min(A.right, B.right) - Math.max(A.left, B.left); const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top); return w > 1 && h > 1; };
  const out = [];
  for (const s of subs) for (const o of others) if (hit(s, o)) out.push(`subtitle × ${name(o)}`);
  for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) {
    const a = others[i], b = others[j];
    if (a.parentElement === b.parentElement && a.classList.contains('hw-dots')) continue;   // 空心点与实心点同拍时本来就重叠
    if (hit(a, b)) out.push(`${name(a)} × ${name(b)}`);
  }
  return { problems: out, counted: { subs: subs.length, others: others.length } };
}

async function layoutAt(size, touch) {
  const [W, H] = size;
  const tag = `${W}x${H}`;
  const g = await openGame('ch=ch1&seg=1-5&beat=30&autopilot=off', { touch, url, viewport: { width: W, height: H }, who: `e2e-touch:layout-${tag}` });
  const { p } = g;
  const problems = [];
  const check = async (what) => {
    await p.evaluate(() => window.__game.render());
    const r = await p.evaluate(pageOverflow);
    for (const x of r) problems.push(`${tag} ${what}: ${x}`);
  };
  try {
    // 菜单（UI 自己切换的界面）
    await p.evaluate(() => window.__game.ext.uiSeed({ unlock: ['ch1'], completed: ['ch1'], notes: ['n1-desk', 'n1-a', 'n1-b'], opened: ['n1-desk'] }));
    for (const s of ['title', 'chapters', 'settings', 'notes', 'credits']) {
      await p.evaluate((n) => window.__game.ext.uiScreen(n), s);
      await check(s);
    }
    await p.evaluate(() => { document.querySelector('[data-note="n1-a"]')?.click(); });
    await check('notes viewer');
    await p.evaluate(() => window.__game.ext.uiScreen('play'));
    // 失败卡：不输入，直到摔倒
    let st = await step(p, 1);
    for (let i = 0; i < 30 && st.screen !== 'fail'; i++) st = await step(p, 120);
    if (st.screen !== 'fail') problems.push(`${tag}: never fell (screen ${st.screen})`);
    else {
      await step(p, 60);
      await check('fail');
      // 从检查点重来（debug goto 不会清掉 Game 的失败状态，所以先真正重来一次）
      await p.evaluate(() => window.__game.input('confirm'));
      st = await step(p, 2);
      if (st.screen !== 'play') problems.push(`${tag}: retry from fail failed (screen ${st.screen})`);
    }
    // 暂停
    await p.evaluate(() => { window.__game.goto('1-5', 40); window.__game.setAutopilot('perfect'); });
    await step(p, 30);
    await p.evaluate(() => window.__game.pause());
    await check('pause');
    await p.evaluate(() => window.__game.resume());
    // HUD：每个元素都填上最长的内容
    await step(p, 30);
    await p.evaluate(() => window.__game.ext.hudDemo());
    await check('hud');
    const ov = await p.evaluate(hudOverlap);
    for (const x of ov.problems) problems.push(`${tag} hud: ${x}`);
    if (ov.counted.subs < 2 || ov.counted.others < 8) problems.push(`${tag} hud demo incomplete: ${JSON.stringify(ov.counted)}`);
    await p.screenshot({ path: `shots/e2e-layout-hud-${tag}.png` });
    // 结尾卡
    await p.evaluate(() => window.__game.goto('1-6', 0));
    st = await step(p, 1);
    for (let i = 0; i < 40 && st.screen !== 'outro'; i++) st = await step(p, 120);
    if (st.screen !== 'outro') problems.push(`${tag}: never reached outro (screen ${st.screen})`);
    else { await p.waitForTimeout(3500); await check('outro'); }
    if (g.errors.length) problems.push(`${tag} page errors: ${g.errors.slice(0, 3).join(' | ')}`);
    console.log(JSON.stringify({ mode: 'layout', size: tag, hud: ov.counted, problems: problems.length }));
    return problems;
  } finally {
    await g.close();
  }
}

async function layout() {
  return [...await layoutAt([360, 640], true), ...await layoutAt([1920, 1080], false)];
}

if (!url) ensureBuilt();
const problems = [];
for (const m of ['keyboard', 'touch', 'layout']) {
  if (only && only !== m) continue;
  try {
    const pr = m === 'layout' ? await layout() : await flow(m);
    for (const x of pr) problems.push(`${m}: ${x}`);
  } catch (e) {
    problems.push(`${m}: ${e && e.message ? e.message : e}`);
  }
}
if (problems.length) { console.error(`e2e:touch FAILED\n  - ${problems.join('\n  - ')}`); process.exit(1); }
console.log('e2e:touch passed');
