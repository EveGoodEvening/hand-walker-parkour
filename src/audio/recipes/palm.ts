// src/audio/recipes/palm.ts —— 三段落地声（DESIGN.md §6.2 前五行与「表面」「追随者」两行，§3「三段落地」）。WP7。
// 「掌根，指节，指腹——依次压过水磨石地面，发出短促、干脆、几乎带着回音的声响。像有人在空房间里鼓掌。」
// 按「声部（自己 / 追随者）× 表面 × 部位 × 4 个变体」预渲染；掌根另有一套撑跃落地用的加重版（正弦再低 10 Hz）。
import type { ContactPart, Surface } from '../../core/types';
import { chain, filt, gain, noise, osc, perc } from '../graph';
import { jit, nb, rr, type OneShot, type RecipeCtx } from './common';

export type PalmVoice = 'self' | 'follower';
export interface PalmKey { voice: PalmVoice; surface: Surface; part: ContactPart; heavy: boolean }

export const SURFACES: readonly Surface[] = ['terrazzo', 'tile', 'concrete', 'asphaltWet', 'rubber', 'plaza', 'water', 'sheet', 'leavesWet', 'air'];
export const PARTS: readonly ContactPart[] = ['heel', 'knuckle', 'pad'];
/** 每个部位的变体数（§6.1）。 */
export const PALM_VARIANTS = 4;
/** 自己的三段峰值（dBFS，§6.2）。 */
export const PALM_PEAK: Readonly<Record<ContactPart, number>> = { heel: -12, knuckle: -15, pad: -17 };
/** 追随者：基础增益 −6 dB（§6.2）。 */
export const FOLLOWER_BASE_DB = -6;
/** 追随者：所有滤波频率 ×1.25（「更轻，更脆，像某种更干燥的骨头」）。 */
export const FOLLOWER_FREQ_MUL = 1.25;

interface SurfaceMod {
  shelf?: { f: number; db: number };
  knuckleShift?: number;
  grit?: boolean;
  wet?: 'asphalt' | 'water' | 'leaves';
  lp?: number;
  tauMul?: number;
  /** 指腹的混响发送量；掌根 ×0.35，指节 ×0.55。 */
  send: number;
  padOnly?: boolean;
  padHp?: number;
  padPeak?: number;
}

/** 表面对音色的修改（§6.2「表面」一行）。 */
export const SURFACE_MODS: Readonly<Record<Surface, SurfaceMod>> = {
  terrazzo:   { shelf: { f: 2500, db: 2 }, send: 0.4 },
  tile:       { knuckleShift: 600, send: 0.45 },
  concrete:   { grit: true, send: 0.35 },
  asphaltWet: { wet: 'asphalt', send: 0.25 },
  rubber:     { lp: 1200, tauMul: 0.7, send: 0.1 },
  plaza:      { send: 0.35 },
  water:      { wet: 'water', shelf: { f: 2500, db: 1 }, send: 0.35 },   // 室内的水渍、水洼
  sheet:      { padOnly: true, padHp: 2000, padPeak: -30, send: 0.1 },
  leavesWet:  { wet: 'leaves', send: 0.2 },
  air:        { padOnly: true, padPeak: -32, send: 0.3 },
};

export function partsOf(surface: Surface): readonly ContactPart[] {
  return SURFACE_MODS[surface].padOnly ? ['pad'] : PARTS;
}

export function palmKeyString(k: PalmKey): string {
  return `${k.voice}:${k.surface}:${k.part}${k.heavy ? ':heavy' : ''}`;
}

/** 该键在库里的全部组合。 */
export function allPalmKeys(): PalmKey[] {
  const out: PalmKey[] = [];
  for (const voice of ['self', 'follower'] as const) {
    for (const surface of SURFACES) {
      for (const part of partsOf(surface)) {
        out.push({ voice, surface, part, heavy: false });
        if (voice === 'self' && part === 'heel') out.push({ voice, surface, part, heavy: true });
      }
    }
  }
  return out;
}

/** 峰值目标（dBFS）。 */
export function palmPeak(k: PalmKey): number {
  const m = SURFACE_MODS[k.surface];
  const base = k.part === 'pad' && m.padPeak !== undefined ? m.padPeak : PALM_PEAK[k.part];
  return base + (k.voice === 'follower' ? FOLLOWER_BASE_DB : 0);
}

/** 混响发送量。 */
export function palmSend(surface: Surface, part: ContactPart): number {
  const s = SURFACE_MODS[surface].send;
  return part === 'pad' ? s : part === 'knuckle' ? s * 0.55 : s * 0.35;
}

export function palmRecipe(k: PalmKey): OneShot | null {
  const m = SURFACE_MODS[k.surface];
  if (!partsOf(k.surface).includes(k.part)) return null;
  const fm = k.voice === 'follower' ? FOLLOWER_FREQ_MUL : 1;
  const tm = m.tauMul ?? 1;
  const dur = k.part === 'heel' ? 0.3 : k.part === 'knuckle' ? 0.14 : m.wet ? 0.3 : 0.22;
  const tau = k.part === 'heel' ? 0.028 * tm : k.part === 'knuckle' ? 0.008 * tm : 0.02 * tm;
  return {
    key: palmKeyString(k), dur, channels: 1, peakDb: palmPeak(k), bus: k.voice === 'self' ? 'self' : 'follower',
    send: palmSend(k.surface, k.part), tau, variants: PALM_VARIANTS,
    build: (r) => buildPalm(r, k, m, fm, tm),
  };
}

/** 表面的后级（高架、整体低通），返回它的输入节点。 */
function post(r: RecipeCtx, m: SurfaceMod, fm: number): AudioNode {
  const nodes: AudioNode[] = [];
  if (m.shelf) nodes.push(filt(r.ctx, 'highshelf', m.shelf.f * fm, 0.7071, m.shelf.db));
  if (m.lp) nodes.push(filt(r.ctx, 'lowpass', m.lp * fm, 0.7071));
  if (!nodes.length) return r.out;
  chain(...nodes, r.out);
  return nodes[0] as AudioNode;
}

function buildPalm(r: RecipeCtx, k: PalmKey, m: SurfaceMod, fm: number, tm: number): void {
  const { ctx, t0, rng } = r;
  const sr = ctx.sampleRate;
  const jf = jit(rng, 0.06);                    // 滤波频率 ±6%（每个变体一个值）
  const out = post(r, m, fm);
  const end = t0 + 0.3;
  if (k.part === 'heel') {
    // 白噪声 → 低通 520 Hz（Q 0.7），起音 1 ms，τ = 22 ms
    const fc = 520 * fm * jf;
    const g = gain(ctx, 0);
    chain(noise(ctx, r.noise, 'white', t0, 0.3, rng), filt(ctx, 'lowpass', fc, 0.7), g, out);
    perc(g.gain, t0, nb(1.1 * fc, sr), 0.001, 0.022 * tm);
    // 正弦 105 → 68 Hz（40 ms 内下滑，τ = 30 ms，增益 0.5）；追随者去掉这一支；撑跃落地再低 10 Hz
    if (k.voice === 'self') {
      const drop = k.heavy ? 10 : 0;
      const o = osc(ctx, 'sine', 105 - drop, t0, end);
      o.frequency.setValueAtTime(105 - drop, t0);
      o.frequency.exponentialRampToValueAtTime(68 - drop, t0 + 0.04);
      const gs = gain(ctx, 0);
      chain(o, gs, out);
      perc(gs.gain, t0, 0.5, 0.001, 0.03 * tm);
    }
    return;
  }
  if (k.part === 'knuckle') {
    // 白噪声 → 带通 2.2 kHz（Q 3），τ = 7 ms；叠加三角波 780 Hz，12 ms，0.12。瓷砖：带通中心 +600 Hz
    const fc = (2200 + (m.knuckleShift ?? 0)) * fm * jf;
    const g = gain(ctx, 0);
    chain(noise(ctx, r.noise, 'white', t0, 0.14, rng), filt(ctx, 'bandpass', fc, 3), g, out);
    perc(g.gain, t0, nb((1.57 * fc) / 3, sr), 0.0005, 0.007 * tm);
    const tri = osc(ctx, 'triangle', 780 * fm * jf, t0, t0 + 0.03);
    const gt = gain(ctx, 0);
    chain(tri, gt, out);
    perc(gt.gain, t0, 0.12, 0.0005, 0.004 * tm);
    if (m.grit) grit(r, out, t0 + 0.001, fm);
    return;
  }
  // 指腹
  if (m.wet) { wetPad(r, out, m.wet, fm, jf); return; }
  const hp = (m.padHp ?? 900) * fm * jf;
  const lp = 4500 * fm * jf;
  const g = gain(ctx, 0);
  chain(noise(ctx, r.noise, 'white', t0, 0.22, rng), filt(ctx, 'highpass', hp, 0.7071), filt(ctx, 'lowpass', lp, 0.7071), g, out);
  perc(g.gain, t0, nb(Math.max(400, lp - hp), sr), 0.002, 0.016 * tm);
  if (m.grit) grit(r, out, t0 + 0.002, fm);
}

/** 水泥：6 kHz 的碎响。 */
function grit(r: RecipeCtx, out: AudioNode, t: number, fm: number): void {
  const { ctx, rng } = r;
  const g = gain(ctx, 0);
  chain(noise(ctx, r.noise, 'white', t, 0.05, rng), filt(ctx, 'bandpass', 6000 * fm, 2), g, out);
  perc(g.gain, t, 0.3 * nb((1.57 * 6000 * fm) / 2, ctx.sampleRate), 0.0003, 0.004);
}

/** 水滴：正弦下滑 30%（「像拍在水里的掌声」）。 */
function drop(r: RecipeCtx, out: AudioNode, t: number, f: number, amp: number): void {
  const { ctx } = r;
  const o = osc(ctx, 'sine', f, t, t + 0.05);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.025);
  const g = gain(ctx, 0);
  chain(o, g, out);
  perc(g.gain, t, amp, 0.0008, 0.007);
}

function wetPad(r: RecipeCtx, out: AudioNode, kind: 'asphalt' | 'water' | 'leaves', fm: number, jf: number): void {
  const { ctx, t0, rng } = r;
  const sr = ctx.sampleRate;
  if (kind === 'leaves') {
    // 湿落叶：闷一点的带通，加几粒细碎的咔嚓
    const fc = 1500 * fm * jf;
    const g = gain(ctx, 0);
    chain(noise(ctx, r.noise, 'white', t0, 0.2, rng), filt(ctx, 'bandpass', fc, 0.8), g, out);
    perc(g.gain, t0, nb((1.57 * fc) / 0.8, sr), 0.001, 0.025);
    for (let i = 0; i < 3; i++) {
      const t = t0 + rr(rng, 0.004, 0.03);
      const gc = gain(ctx, 0);
      chain(noise(ctx, r.noise, 'white', t, 0.01, rng), filt(ctx, 'highpass', 3000 * fm, 0.7071), gc, out);
      perc(gc.gain, t, 0.3, 0.0002, 0.0015);
    }
    return;
  }
  // 「啪嗒」：噪声 → 低通从 3 kHz 扫到 600 Hz，60 ms；再加 2 个 1.8–2.4 kHz 的水滴声
  const water = kind === 'water';
  const f0 = (water ? 2600 : 3000) * fm * jf, f1 = (water ? 500 : 600) * fm;
  const len = water ? 0.09 : 0.06;
  const lp = filt(ctx, 'lowpass', f0, 1.2);
  lp.frequency.setValueAtTime(f0, t0);
  lp.frequency.exponentialRampToValueAtTime(f1, t0 + len);
  const g = gain(ctx, 0);
  chain(noise(ctx, r.noise, 'white', t0, len + 0.12, rng), lp, g, out);
  perc(g.gain, t0, nb(1.1 * f0 * 0.5, sr), 0.001, len / 3);
  const n = water ? 3 : 2;
  for (let i = 0; i < n; i++) drop(r, out, t0 + rr(rng, 0.012, 0.055) + i * 0.012, rr(rng, 1800, 2400) * fm, rr(rng, 0.25, 0.4));
}
