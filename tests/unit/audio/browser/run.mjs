#!/usr/bin/env node
// tests/unit/audio/browser/run.mjs —— WP7 声音在真正的 Chromium WebAudio 上的验收（DESIGN.md §8.10 WP7 验收 1–7）。WP7。
// vitest 里用的是 Node 的最小 OfflineAudioContext（offline/mini.ts）；这里把同一套场景（scenarios.ts）用 esbuild 打包，
// 注入无头 Chromium，用浏览器自己的 OfflineAudioContext 再跑一遍，并逐键对比两种实现渲染出来的库。
// 然后打开构建好的游戏（不加 mute），用真实按键解锁，实时跑第一章几秒，读 __game.ext.audio() 的统计；再用 mute=1 确认不创建 AudioContext。
//
// 用法：node tests/unit/audio/browser/run.mjs [--sr 48000] [--no-game] [--demo DIR] [--json FILE]
//   --demo DIR：另外渲染约 14 s 的试听片段（追随者从稳度 3 逼近到 0，再进入「嘘」），写 DIR/wp7-demo.wav 和声谱图 DIR/wp7-demo.png。
// 资源纪律：经 scripts/browser-lock.mjs 取槽位；一个浏览器、用完立即关闭；整个运行约 1–2 分钟。
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { acquireBrowserSlot } from '../../../../scripts/browser-lock.mjs';
import { CHROME, CHROME_ARGS, ROOT, baseUrl, ensureBuilt } from '../../../../scripts/e2e-lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SR = Number(opt('--sr', '48000'));
const DEMO = opt('--demo', null);
const JSON_OUT = opt('--json', null);
const GAME = !args.includes('--no-game');

const fails = [];
const check = (ok, what, detail = '') => { if (!ok) fails.push(`${what}${detail ? ` (${detail})` : ''}`); console.log(`${ok ? '  ok ' : '  FAIL'} ${what}${detail ? `  ${detail}` : ''}`); };
const f1 = (x) => (typeof x === 'number' ? x.toFixed(1) : String(x));
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));

const bundle = await build({
  entryPoints: [join(ROOT, 'tests/unit/audio/browser/entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser',
  target: 'es2022', logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;
if (GAME) ensureBuilt({ quiet: true });

const release = await acquireBrowserSlot({ who: 'wp7-audio-browser' });
const t0 = Date.now();
let b;
const report = { sampleRate: SR };
try {
  b = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });

  // ——— 1. 场景：真正的 OfflineAudioContext ———
  {
    const p = await b.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.setContent('<!doctype html><html><body></body></html>');
    await p.addScriptTag({ content: code });
    const r = await p.evaluate((sr) => window.__wp7.all(sr), SR);
    Object.assign(report, r);
    console.log(`\nChromium OfflineAudioContext @ ${r.sampleRate} Hz（库 ${Math.round(r.libraryMs)} ms）`);
    check(errors.length === 0, '页面没有错误', errors.join('; '));

    console.log('验收 1：配方');
    const bad = r.recipes.filter((x) => x.nonFinite || !(x.rawPeakDb > -80) || x.peakDb > -8 || Math.abs(x.peakDb - x.targetDb) > 0.05);
    check(bad.length === 0, `${r.recipes.length} 个一次性声音：不是静音、没有 NaN、峰值 ≤ −8 dBFS、等于配方电平`, bad.slice(0, 5).map((x) => `${x.key}#${x.variant} ${f2(x.peakDb)}`).join(', '));
    const fw = r.fidelityWorst;
    check(fw.palm.db < 0.5, `Node 最小实现与 Chromium：手掌库逐键 RMS 一致（最大差 ${f2(fw.palm.db)} dB @ ${fw.palm.key}）`);
    check(fw.other.db < 0.6, `Node 最小实现与 Chromium：其余一次性声音逐键 RMS 一致（最大差 ${f2(fw.other.db)} dB @ ${fw.other.key}）`);
    const bedBad = r.beds.filter((x) => x.nonFinite || x.peakDb > -8 || x.rmsDb < -60);
    check(bedBad.length === 0, `${r.beds.length} 种环境音 / 雨 / 嗡鸣：不是静音、没有 NaN、峰值 ≤ −8 dBFS`, bedBad.map((x) => x.id).join(', '));
    for (const x of r.beds) console.log(`       ${x.id.padEnd(24)} rms ${f1(x.rmsDb)}  peak ${f1(x.peakDb)}`);

    console.log('验收 2：异常类声音的起音');
    const an = r.recipes.filter((x) => x.anomaly);
    for (const x of an.filter((x) => x.variant === 0)) console.log(`       ${x.key.padEnd(12)} ${Math.round(x.attackMs)} ms`);
    check(an.length >= 5 && an.every((x) => x.attackMs >= 150), '嘘 / 玻璃触碰 / 风 / 心跳 / 低语 起音 ≥ 150 ms');

    console.log('验收 3：时间误差');
    const t = r.timing;
    const maxSched = Math.max(...t.rows.map((x) => Math.abs(x.measured - x.logged))) * 1000;
    const maxCrisp = Math.max(...t.rows.filter((x) => x.kind === 'self' && x.crisp).map((x) => Math.abs(x.measured - x.nominal))) * 1000;
    let maxSpacing = 0;
    for (const tri of [1, 3]) {
      const rs = t.rows.filter((x) => x.kind === 'self' && x.triple === tri);
      const h = rs.find((x) => x.part === 'heel');
      for (const x of rs) maxSpacing = Math.max(maxSpacing, Math.abs((x.measured - h.measured) - (x.nominal - h.nominal)) * 1000);
    }
    const maxFol = Math.max(...t.rows.filter((x) => x.kind === 'follower').map((x) => Math.abs(x.measured - x.nominal))) * 1000;
    console.log(`       链路固定延迟 ${f2(t.latency * 1000)} ms（压缩器前瞻，所有声音一样，已扣除）；两次渲染的时钟偏移 ${t.offsets.map((o) => f2(o * 1000)).join(' / ')} ms`);
    check(maxSched < 2, `渲染 vs 排程 < 2 ms（最大 ${f2(maxSched)} ms）`);
    check(maxCrisp < 2, `干脆的三段 vs 模拟时间戳 < 2 ms（最大 ${f2(maxCrisp)} ms）`);
    check(maxSpacing < 2, `不干脆的掌：三段间隔误差 < 2 ms（最大 ${f2(maxSpacing)} ms）`);
    check(maxFol <= 5, `追随者 vs 自己 + 相位差 ≤ 5 ms（最大 ${f2(maxFol)} ms）`);

    console.log('验收 4：静音段与安静的一秒');
    check(r.hush.postDb < r.hush.preDb - 60, `静音段 0.3 s 后：${f1(r.hush.preDb)} → ${f1(r.hush.postDb)} dBFS（降 ≥ 60 dB）`);
    check(Math.abs(r.hushSelf.postDb - r.hushSelf.preDb) < 2, `自己的掌声保留：${f1(r.hushSelf.preDb)} → ${f1(r.hushSelf.postDb)} dBFS`);
    const q = r.quiet;
    check(q.edgeDb < q.preDb - 60 && q.cutDb < q.preDb - 60, `安静的一秒：之前 ${f1(q.preDb)}，60–70 ms ${f1(q.edgeDb)}，0.1–1 s ${f1(q.cutDb)} dBFS`);
    check(Math.abs(q.recoverDb - q.preDb) < 3, `600 ms 恢复后 ${f1(q.recoverDb)} dBFS`);

    console.log('验收 5：声部');
    check(r.voices.maxSeen <= 32, `塞进 ${r.voices.requested} 个声音：同时发声最多 ${r.voices.maxSeen}（抢占 ${r.voices.stolen}）`);

    console.log('验收 7：主线程开销（浏览器里）');
    check(r.perf.avgFrameMs < 1, `20 s 第三章式负载：平均 ${r.perf.avgFrameMs.toFixed(3)} ms/帧，最大 ${f2(r.perf.maxFrameMs)} ms`);

    console.log('lead 补充：追随者逼近 / 峰值 / 掌声');
    for (const x of r.follower) console.log(`       稳度 ${x.steady}（相位差 ${x.lagBeats}）电平 ${f1(x.rmsDb)}  亮度 ${f1(x.brightDb)}  宽度 ${f1(x.widthDb)}  混响 ${f1(x.tailDb)} dB`);
    const mono = r.follower.every((x, i, a) => i === 0 || (x.rmsDb > a[i - 1].rmsDb + 1.5 && x.brightDb > a[i - 1].brightDb && x.widthDb < a[i - 1].widthDb - 2 && x.tailDb < a[i - 1].tailDb - 2));
    check(mono, '稳度 3 → 0：逐档更响、更亮、更窄、更干');
    check(r.peak.peakDb <= -8 && !r.peak.nonFinite, `最坏情况整个输出峰值 ${f2(r.peak.peakDb)} dBFS ≤ −8`);
    const pm = r.palm;
    for (const x of pm.parts) console.log(`       ${x.key.padEnd(22)} 质心 ${Math.round(x.centroidHz)} Hz  600 Hz 以下 ${(x.lowShare * 100).toFixed(0)}%  −40 dB ${Math.round(x.t40Ms)} ms`);
    console.log(`       三段起点 ${pm.onsetsMs.map(f1).join(' / ')} ms；混响尾巴 / 直达 ${f1(pm.tailDb)} dB；−60 dB ${Math.round(pm.t60Ms)} ms`);
    check(Math.abs(pm.onsetsMs[1] - pm.onsetsMs[0] - 26) < 2 && Math.abs(pm.onsetsMs[2] - pm.onsetsMs[0] - 52) < 2, '三段依次落在 0 / 26 / 52 ms');
    check(pm.tailDb > -12 && pm.tailDb < 3, '走廊混响的尾巴听得见');
    console.log('§6.2 人群的脚步「先轻后重」');
    const cr = r.crowd;
    const pre = cr.steps.filter((x) => x.at < cr.hitAt);
    const gaps = pre.slice(1).map((x, i) => x.at - pre[i].at);
    console.log(`       走动的人 ${pre.length} 步，间隔 ${gaps.map((g) => g.toFixed(3)).join(' / ')} s；输出 ${f1(cr.stepsDb)} dBFS；轻 ${f1(cr.lightDb)} → 重 ${f1(cr.heavyDb)} dBFS，相隔 ${f1(cr.gapMs)} ms`);
    check(pre.length >= 3 && pre.every((x) => x.bus === 'npc' && x.pan < -0.2) && gaps.every((g) => g >= 0.47 && g <= 0.56), 'walkers：npc 总线、左侧、间隔 0.47–0.56 s');
    check(cr.stepsDb > -60 && cr.heavyDb - cr.lightDb > 6 && cr.gapMs > 65 && cr.gapMs < 105, '渲染出来听得见，先轻后重（约 80 ms）');
    check(!cr.steps.some((x) => x.at >= cr.hitAt && x.at < cr.hitAt + 1.06), '人群段绊倒：1 s 内没有新的脚步');
    const onc = cr.steps.filter((x) => x.pan > 0.2);
    check(onc.length >= 2 && onc[onc.length - 1].gainDb > onc[0].gainDb + 3, `迎面的腿：右侧、越近越响（${onc.map((x) => f1(x.gainDb)).join(' → ')} dB）`);
    const bq = Math.max(...r.biquad.map((x) => x.maxErrDb));
    check(bq < 0.1, `BiquadFilterNode 与规范公式（Node 实现用的）一致：最大偏差 ${bq.toFixed(4)} dB`);
    await p.close();
  }

  // ——— 2. 试听片段 ———
  if (DEMO) {
    const p = await b.newPage();
    await p.setContent('<!doctype html><html><body></body></html>');
    await p.addScriptTag({ content: code });
    const d = await p.evaluate((sr) => window.__wp7.demo(sr), SR);
    const dir = resolve(DEMO);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'wp7-demo.wav'), Buffer.from(d.wavB64, 'base64'));
    writeFileSync(join(dir, 'wp7-demo.png'), Buffer.from(d.png.split(',')[1], 'base64'));
    writeFileSync(join(dir, 'wp7-demo-zoom.png'), Buffer.from(d.zoom.split(',')[1], 'base64'));
    console.log(`\n试听：${join(dir, 'wp7-demo.wav')}（峰值 ${f2(d.peakDb)} dBFS），声谱图 ${join(dir, 'wp7-demo.png')}`);
    report.demo = { marks: d.marks, peakDb: d.peakDb };
    await p.close();
  }

  // ——— 3. 游戏本体：真实按键解锁、实时运行；mute=1 不创建 AudioContext ———
  if (GAME) {
    const COUNT = () => {
      const w = window;
      w.__acMade = 0; w.__oacMade = 0;
      const AC = w.AudioContext, OAC = w.OfflineAudioContext;
      w.AudioContext = class extends AC { constructor(...a) { super(...a); w.__acMade++; w.__ac = this; } };
      w.OfflineAudioContext = class extends OAC { constructor(...a) { super(...a); w.__oacMade++; } };
      if (w.webkitAudioContext) w.webkitAudioContext = w.AudioContext;
    };
    const open = async (query) => {
      const ctx = await b.newContext({ viewport: { width: 640, height: 360 } });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[audio]'))) errors.push(m.text()); });
      await p.addInitScript(COUNT);
      const base = baseUrl(null);
      await p.goto(`${base}?${query}`);
      await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 60_000 });
      await p.evaluate(() => window.__game.ready);
      return { ctx, p, errors };
    };

    console.log('\n游戏本体（dist/index.html，实时运行，第一章，自动驾驶）');
    {
      const { ctx, p, errors } = await open('q=low&ch=ch1&nocards=1&autopilot=perfect&seed=3');
      const before = await p.evaluate(() => ({ ac: window.__acMade, oac: window.__oacMade }));
      check(before.ac === 0 && before.oac === 0, `第一次按键之前没有创建任何 AudioContext（${before.ac} / ${before.oac}）`);
      await p.keyboard.press('Shift');
      await p.waitForFunction(() => window.__game.ext.audio()?.libraryReady === true, null, { timeout: 60_000 });
      await p.waitForTimeout(8000);
      const st = await p.evaluate(() => ({ s: window.__game.ext.audio(), made: window.__acMade, state: window.__ac?.state, cues: window.__game.cues(400), screen: window.__game.screen() }));
      report.game = st.s;
      console.log(`       ${JSON.stringify({ state: st.state, sampleRate: st.s.sampleRate, ambience: st.s.ambience, reverb: st.s.reverb, maxVoices: st.s.maxVoices, reanchors: st.s.reanchors, frames: st.s.frames, avgFrameMs: Number(st.s.avgFrameMs.toFixed(3)), maxFrameMs: Number(st.s.maxFrameMs.toFixed(2)), makeup: st.s.makeup })}`);
      check(st.made === 1, `按键后创建了一个 AudioContext（${st.made}）`);
      check(st.state === 'running', `AudioContext 在运行（${st.state}）`);
      check(st.s.errors === 0 && errors.length === 0, `声音没有错误（engine ${st.s.errors}，页面 ${errors.length}）`, errors.slice(0, 3).join(' | '));
      check(st.cues.some((c) => c.startsWith('palm:')), '自己的掌声在响（cue 里有 palm:*）');
      check(st.s.maxVoices <= 32, `同时发声 ≤ 32（${st.s.maxVoices}）`);
      check(st.s.frames > 20 && st.s.avgFrameMs < 1, `主线程每帧平均 ${st.s.avgFrameMs.toFixed(3)} ms < 1 ms（${st.s.frames} 帧）`);
      const mk = st.s.makeup ?? {};
      check(mk.calibrated === true && Math.abs(mk.comp - 5.15) < 0.4 && Math.abs(mk.limiter - 5.13) < 0.4,
        `压缩器补偿增益按稳态校准（comp ${f2(mk.comp)} dB，limiter ${f2(mk.limiter)} dB；Chromium 稳态 5.15 / 5.13）`);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(500);
      const paused = await p.evaluate(() => ({ screen: window.__game.screen(), state: window.__ac?.state }));
      check(paused.screen === 'pause' && paused.state === 'suspended', `暂停时 ctx.suspend()（${paused.screen} / ${paused.state}）`);
      // 暂停菜单「回到标题」：Game 不调 suspend(false)，声音要在离开暂停屏幕时自己恢复（标题背景的早读）
      await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '回到标题'); b?.click(); });
      await p.waitForTimeout(500);
      const back = await p.evaluate(() => ({ screen: window.__game.screen(), state: window.__ac?.state }));
      check(back.screen === 'title' && back.state === 'running', `暂停菜单 → 回到标题：恢复（${back.screen} / ${back.state}）`);
      report.maxFrameMs = st.s.maxFrameMs;
      await ctx.close();
    }
    {
      // §6.1「暂停和失焦时 ctx.suspend()」：标题屏（Game 不会自动暂停的屏幕）失焦 / 隐藏也挂起
      const { ctx, p, errors } = await open('q=low');
      await p.keyboard.press('Shift');
      await p.waitForFunction(() => window.__game.ext.audio()?.libraryReady === true, null, { timeout: 60_000 });
      await p.waitForTimeout(300);
      const st = (tag) => p.evaluate((t) => ({ t, screen: window.__game.screen(), state: window.__ac?.state }), tag);
      const s0 = await st('before');
      await p.evaluate(() => window.dispatchEvent(new Event('blur')));
      await p.waitForTimeout(300);
      const s1 = await st('blur');
      await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      await p.waitForTimeout(300);
      const s2 = await st('focus');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(300);
      const s3 = await st('hidden');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(300);
      const s4 = await st('visible');
      console.log(`       ${[s0, s1, s2, s3, s4].map((x) => `${x.t}: ${x.screen}/${x.state}`).join('，')}`);
      check(s0.screen === 'title' && s0.state === 'running' && s1.state === 'suspended' && s2.state === 'running' && s3.state === 'suspended' && s4.state === 'running',
        '标题屏：失焦 / 隐藏 → suspended，回来 → running');
      check(errors.length === 0, '页面没有错误', errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
    {
      const { ctx, p, errors } = await open('q=low&ch=ch1&nocards=1&autopilot=perfect&mute=1');
      await p.keyboard.press('Shift');
      await p.mouse.click(320, 180);
      await p.waitForTimeout(3000);
      const st = await p.evaluate(() => ({ ac: window.__acMade, oac: window.__oacMade, cues: window.__game.cues(50), audio: window.__game.ext.audio() }));
      check(st.ac === 0 && st.oac === 0, `mute=1：按键和点击之后 AudioContext ${st.ac} 个、OfflineAudioContext ${st.oac} 个`);
      check(st.cues.length > 0 && errors.length === 0, `mute=1：cue 照常记录（${st.cues.slice(-3).join(', ')}）`);
      await ctx.close();
    }
  }
} finally {
  try { await b?.close(); } finally { release(); }
}
console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (JSON_OUT) { mkdirSync(dirname(resolve(JSON_OUT)), { recursive: true }); writeFileSync(resolve(JSON_OUT), JSON.stringify(report, null, 1)); }
if (fails.length) { console.error(`\n${fails.length} 项不通过：\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('全部通过');
