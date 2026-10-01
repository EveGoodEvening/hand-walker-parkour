// src/ui/hud/overlays.ts —— 画面叠加层的状态（DESIGN.md §5 总则「暗角、颗粒、冷色渐变、去饱和都用 DOM/CSS」、§2.7 失败演出、
// §7.2 掌心发烫 / 发麻、§7.3 减少闪烁、§8.3 静场的黑场切入切出）。WP8。纯模型：一律按模拟时间计算，无头测试里截图稳定。
// 叠加层 cue（§8.5 overlay）：palmHeat / palmNumb / coldFade / desaturate / eyesClosed / black / clear。
//   · black：seconds 内淡到全黑；eyesClosed：压暗到 60%；clear：seconds 内回到 0，同时撤掉去饱和与冷色。
//   · desaturate：去饱和持续 seconds（前后各 0.2 s 渐变；减少闪烁时 0.4 s）。
//   · coldFade：seconds 内渐变到冷色（减少闪烁时 ≥ 1.2 s），保持到 clear 或段落切换。
//   · palmHeat / palmNumb：右缘冷白渐晕 1.5 s（seconds 缺省时），节拍器泛白 / 抖动。
// 失败：摔倒后 0.8 s 内去饱和并变冷（减少闪烁时 1.2 s），不用红色、不闪白。
// 段落在跑段与静场之间切换时：黑场 1 → 0，0.4 s（View 在同一时刻切换场景）。
// 闭眼（eyesClosed，5-9）只到本段结束：下一段开始时在 EYES_OPEN_SEC 内睁开（5-10「我睁开眼。天花板上的裂缝还在。」，修复轮 B3）。
// 跳过静场时界面先把本段还没到的叠加层按终态应用（SKIP_KEEP_OVERLAYS，UI.noteSkip），所以两种走法进下一段时一样。
export type OverlayOp = 'palmHeat' | 'palmNumb' | 'coldFade' | 'desaturate' | 'eyesClosed' | 'black' | 'clear';

/** 下一段开始时睁开眼（闭眼的压暗回到 0）用的秒数。 */
export const EYES_OPEN_SEC = 1.0;
/** 跳过静场时按终态带进下一段的叠加层（会留在画面上的：黑场、闭眼、清除、冷色）；一次性的掌心、去饱和丢弃。 */
export const SKIP_KEEP_OVERLAYS: ReadonlySet<OverlayOp> = new Set<OverlayOp>(['black', 'eyesClosed', 'clear', 'coldFade']);

interface Tween { from: number; to: number; t0: number; dur: number }
const tweenAt = (w: Tween, t: number) => {
  if (w.dur <= 0) return w.to;
  const k = Math.min(1, Math.max(0, (t - w.t0) / w.dur));
  return w.from + (w.to - w.from) * k;
};
const still = (v: number): Tween => ({ from: v, to: v, t0: 0, dur: 0 });

export interface OverlayView {
  black: number;           // 0..1 黑场不透明度
  desat: number;           // 0..1 去饱和
  cold: number;            // 0..1 冷色
  palmEdge: number;        // 0..1 右缘冷白渐晕
  palm: 'none' | 'heat' | 'numb';
  pulse: number;           // 0..1 受击时的暗角脉冲
  filter: string;          // canvas 的 CSS filter
}

export class OverlayState {
  private black: Tween = still(0);
  private cold: Tween = still(0);
  private desat = { t0: -1, until: -1, fade: 0.2 };
  private palm: { op: 'heat' | 'numb'; t0: number; until: number } | null = null;
  private fallT = -1;
  private hitT = -1;
  /** 黑场层现在是闭眼的压暗（eyesClosed 之后，还没有别的黑场操作）：下一段开始时睁开。 */
  private eyesShut = false;
  reducedFlicker = false;

  apply(op: OverlayOp, seconds: number, t: number): void {
    const s = Math.max(0, seconds);
    switch (op) {
      case 'black': this.black = { from: this.blackAt(t), to: 1, t0: t, dur: s }; this.eyesShut = false; break;
      case 'eyesClosed': this.black = { from: this.blackAt(t), to: 0.6, t0: t, dur: s }; this.eyesShut = true; break;
      case 'clear':
        this.eyesShut = false;
        this.black = { from: this.blackAt(t), to: 0, t0: t, dur: s };
        this.cold = { from: this.coldAt(t), to: 0, t0: t, dur: Math.max(s, this.reducedFlicker ? 1.2 : 0) };
        this.desat = { t0: -1, until: -1, fade: 0.2 };
        this.palm = null;
        break;
      case 'desaturate': {
        const fade = this.reducedFlicker ? 0.4 : 0.2;
        this.desat = { t0: t, until: t + Math.max(s, fade * 2), fade };
        break;
      }
      case 'coldFade': this.cold = { from: this.coldAt(t), to: 1, t0: t, dur: Math.max(s, this.reducedFlicker ? 1.2 : 0) }; break;
      case 'palmHeat': case 'palmNumb':
        this.palm = { op: op === 'palmHeat' ? 'heat' : 'numb', t0: t, until: t + (s > 0 ? s : 1.5) };
        break;
    }
  }

  /** 段落切换：跑段 ↔ 静场时黑场切入；冷色在新段落里褪去。黑场正在淡入（1-6、3-10 结尾）时不打断。 */
  segment(t: number, cut: boolean): void {
    if (this.cold.to > 0) this.cold = { from: this.coldAt(t), to: 0, t0: t, dur: this.reducedFlicker ? 1.2 : 0.6 };
    if (cut && this.black.to < 1) this.black = { from: 1, to: 0, t0: t, dur: 0.4 };
    else if (this.eyesShut) this.black = { from: this.blackAt(t), to: 0, t0: t, dur: EYES_OPEN_SEC };   // 睁开眼
    this.eyesShut = false;
    this.palm = null;
  }

  /** 跳过静场（修复轮 B3）：正在进行的黑场、冷色渐变直接走到终点（自然看完时它们早就走完了）。 */
  settle(): void { this.black = still(this.black.to); this.cold = still(this.cold.to); }

  fall(t: number): void { this.fallT = t; }
  hit(t: number): void { this.hitT = t; }
  /** 重来 / 新章节：全部复位。 */
  reset(): void {
    this.black = still(0); this.cold = still(0); this.desat = { t0: -1, until: -1, fade: 0.2 };
    this.palm = null; this.fallT = -1; this.hitT = -1; this.eyesShut = false;
  }

  private blackAt(t: number): number { return tweenAt(this.black, t); }
  private coldAt(t: number): number { return tweenAt(this.cold, t); }

  view(t: number): OverlayView {
    let desat = 0;
    const d = this.desat;
    if (d.t0 >= 0 && t < d.until) {
      desat = Math.min(1, (t - d.t0) / d.fade, (d.until - t) / d.fade);
      desat = Math.max(0, desat);
    }
    let cold = tweenAt(this.cold, t);
    if (this.fallT >= 0 && t >= this.fallT) {
      const k = Math.min(1, (t - this.fallT) / (this.reducedFlicker ? 1.2 : 0.8));
      desat = Math.max(desat, k);
      cold = Math.max(cold, k * 0.8);
    }
    let palmEdge = 0;
    let palm: OverlayView['palm'] = 'none';
    if (this.palm && t >= this.palm.t0 && t < this.palm.until) {
      palm = this.palm.op;
      const span = this.palm.until - this.palm.t0;
      const u = (t - this.palm.t0) / span;
      palmEdge = Math.min(1, u / 0.2, (1 - u) / 0.3);
    }
    const pulse = this.hitT >= 0 && t >= this.hitT && t - this.hitT < 0.35 ? 1 - (t - this.hitT) / 0.35 : 0;
    const black = tweenAt(this.black, t);
    const q = (v: number) => Math.round(v * 100) / 100;
    const parts: string[] = [];
    if (desat > 0.005) parts.push(`grayscale(${q(desat * 0.85)})`, `brightness(${q(1 - desat * 0.18)})`);
    if (cold > 0.005) parts.push(`saturate(${q(1 - cold * 0.35)})`, `brightness(${q(1 - cold * 0.06)})`);
    return { black: q(black), desat: q(desat), cold: q(cold), palmEdge: q(palmEdge), palm, pulse: q(pulse), filter: parts.join(' ') };
  }
}
