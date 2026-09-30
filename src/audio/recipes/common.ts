// src/audio/recipes/common.ts —— 配方的公共类型与小工具（DESIGN.md §6.2）。WP7。
// 一个「配方」= 在任意 BaseAudioContext 上从 t0 起搭出一段声音的函数。一次性声音（手掌、音效、颗粒）在解锁音频时
// 用 OfflineAudioContext 预渲染成 AudioBuffer，并把峰值归一到配方表的 dBFS；运行时只播放 AudioBufferSourceNode（§6.1）。
import type { NoiseBank } from '../graph';

/** 总线（§6.1）。floor = 房间底噪与失败时的膝盖闷响（失败演出里唯一不淡出的声音，§2.7）。 */
export type BusId = 'self' | 'follower' | 'npc' | 'sfx' | 'ambience' | 'floor' | 'ui';

export interface RecipeCtx {
  ctx: BaseAudioContext;
  out: AudioNode;
  t0: number;
  rng: () => number;
  noise: NoiseBank;
}

export interface OneShot {
  key: string;
  /** 渲染长度（秒，含尾巴）。 */
  dur: number;
  channels: 1 | 2;
  /** 归一后的峰值（dBFS）。全部 ≤ −8（LIMITS.peakDbfs）。 */
  peakDb: number;
  bus: BusId;
  /** 混响发送量（0..1）。 */
  send: number;
  /** 衰减时间常数的估计（秒），抢占声部时估算「当前有多响」用。 */
  tau: number;
  /** 变体数（每个变体用不同的随机数渲染一次）。 */
  variants: number;
  /** 异常类声音：起音 ≥ 150 ms（§6.1）。 */
  anomaly?: boolean;
  build(r: RecipeCtx): void;
}

/**
 * 白噪声（RMS 0.5）经过有效带宽 bw（Hz）的滤波后，峰值大约是多少的倒数：
 * 让不同带宽的噪声支路在混合前处在同一量级，配方里的相对增益才有意义（最终峰值另行归一）。
 */
export function nb(bw: number, sampleRate: number): number {
  return 0.6 * Math.sqrt(sampleRate / (2 * Math.max(20, bw)));
}

/** 随机取 [a, b)。 */
export const rr = (rng: () => number, a: number, b: number): number => a + (b - a) * rng();
/** 1 ± k 的随机倍数。 */
export const jit = (rng: () => number, k: number): number => 1 + (rng() * 2 - 1) * k;
