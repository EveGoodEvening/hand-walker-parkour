// scripts/browser-lock.mjs —— 浏览器槽位锁（DESIGN.md §8.11）。CORE 冻结。
// 2 个槽位：/tmp/hw-parkour-browser/slot-0.lock、slot-1.lock，内容是 {pid, start, who}；进程已死或超过 20 min 视为失效。
// 所有启动浏览器的脚本都必须经过 withBrowserSlot() 或 acquireBrowserSlot()。任何时候最多 2 个浏览器。
//
// 与 §8.8 示例的差异：示例里 openGame 在 withBrowserSlot 的回调里「启动后立即返回」，锁会在浏览器关闭前就被释放。
// 这里改为 acquireBrowserSlot() 返回 release()，由调用方在关闭浏览器之后释放（e2e-lib 的 openGame 返回的 close() 会做这件事）。
import { mkdirSync, openSync, closeSync, writeSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_DIR = process.env.HW_BROWSER_LOCK_DIR || '/tmp/hw-parkour-browser';
export const SLOTS = 2;
const STALE_MS = 20 * 60 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readLock(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function tryTake(file, who) {
  try {
    const fd = openSync(file, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, start: Date.now(), who }));
    closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const info = readLock(file);
    const stale = !info || !alive(info.pid) || Date.now() - (info.start ?? 0) > STALE_MS;
    if (stale) {
      try { unlinkSync(file); } catch { /* 别人先删了 */ }
      return tryTake(file, who);
    }
    return false;
  }
}

/** 当前各槽位的占用情况。 */
export function slotStatus() {
  return Array.from({ length: SLOTS }, (_, i) => {
    const file = join(LOCK_DIR, `slot-${i}.lock`);
    const info = existsSync(file) ? readLock(file) : null;
    return { slot: i, file, info, alive: !!info && alive(info.pid) };
  });
}

/**
 * 取得一个槽位；返回 release()。等待超过 timeoutMs（缺省 15 min）抛错。
 * 同一进程退出时会自动释放它持有的槽位。
 */
export async function acquireBrowserSlot({ who = process.argv[1] ?? 'unknown', timeoutMs = 15 * 60 * 1000, pollMs = 1000 } = {}) {
  mkdirSync(LOCK_DIR, { recursive: true });
  const t0 = Date.now();
  let warned = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const file = join(LOCK_DIR, `slot-${i}.lock`);
      if (tryTake(file, who)) {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          const info = readLock(file);
          if (info && info.pid === process.pid) { try { unlinkSync(file); } catch { /* ignore */ } }
          process.off('exit', release);
        };
        process.on('exit', release);
        for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { release(); process.exit(130); });
        return release;
      }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`browser-lock: no free slot after ${Math.round(timeoutMs / 1000)} s (${LOCK_DIR})`);
    if (!warned) { console.error(`browser-lock: both slots busy, waiting… (${LOCK_DIR})`); warned = true; }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** 在持有槽位期间运行 fn（fn 结束或抛错后释放）。 */
export async function withBrowserSlot(fn, opts) {
  const release = await acquireBrowserSlot(opts);
  try { return await fn(); } finally { release(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(slotStatus(), null, 2));
}
