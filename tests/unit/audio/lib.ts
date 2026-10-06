// tests/unit/audio/lib.ts —— 声音测试的公共设置。WP7。
// Node 没有 WebAudio：用 offline/mini.ts 的最小 OfflineAudioContext（按规范逐样本渲染）。采样率取 32 kHz 让渲染快一些；
// 同一套场景在无头 Chromium 里用真正的 OfflineAudioContext、浏览器缺省采样率再跑一遍（browser/run.mjs）。
import { makeMiniOffline } from './offline/mini';
import { buildLibrary } from './scenarios';

export const SR = 32000;
export const make = makeMiniOffline;

let cached: ReturnType<typeof buildLibrary> | null = null;
/** 预渲染整个声音库（每个测试文件一份，约 3 s）。 */
export function library(): ReturnType<typeof buildLibrary> {
  if (!cached) cached = buildLibrary(make, SR, true);
  return cached;
}

/** 读 AudioParam 在任意时刻的值（只有最小实现支持）。 */
export function paramAt(p: AudioParam, t: number): number {
  return (p as unknown as { valueAt(t: number): number }).valueAt(t);
}

export const toDb = (g: number): number => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
