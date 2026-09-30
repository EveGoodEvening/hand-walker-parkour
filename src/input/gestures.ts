// src/input/gestures.ts —— 滑动识别（DESIGN.md §2.2 输入细节、D8）。CORE 写初版，之后归 WP8。纯逻辑，不碰 DOM，可在 Node 测试。
// · 位移超过阈值（24 px，设置可选 32 / 16）或速度 ≥ 0.35 px/ms 就立即触发，不等抬手。
// · 按主轴判定方向，|主| / |次| ≥ 1.2，比值不够就不触发。
// · 同一次按下，累计位移超过 2 倍阈值时可以再换一次道（只对左右）。
// · 下滑触发后手指不抬起就是按住（抬手时发 release）。
// · 意图时刻 = pointerdown 时刻 + 40 ms（补偿识别滑动所需的延迟）。
export type SwipeDir = 'left' | 'right' | 'up' | 'down';
export interface SwipeFire { kind: 'swipe'; dir: SwipeDir; t: number }
export interface SwipeRelease { kind: 'release'; dir: 'down'; t: number }
export type GestureOut = SwipeFire | SwipeRelease;
export interface SwipeConfig { threshold: number; velocity: number; ratio: number; intentOffsetMs: number }
export const DEFAULT_SWIPE: SwipeConfig = { threshold: 24, velocity: 0.35, ratio: 1.2, intentOffsetMs: 40 };

export class SwipeRecognizer {
  private active = false;
  private x0 = 0; private y0 = 0; private t0 = 0;
  private fired: SwipeDir | null = null;
  private extraUsed = false;
  private holdingDown = false;
  constructor(public cfg: SwipeConfig = DEFAULT_SWIPE) {}

  get isActive(): boolean { return this.active; }
  get holding(): boolean { return this.holdingDown; }

  down(x: number, y: number, t: number): void {
    this.active = true; this.x0 = x; this.y0 = y; this.t0 = t;
    this.fired = null; this.extraUsed = false; this.holdingDown = false;
  }

  move(x: number, y: number, t: number): GestureOut[] {
    if (!this.active) return [];
    const out: GestureOut[] = [];
    const dx = x - this.x0, dy = y - this.y0;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const intent = this.t0 + this.cfg.intentOffsetMs;
    if (this.fired === null) {
      const main = Math.max(ax, ay), minor = Math.min(ax, ay);
      const dt = Math.max(1, t - this.t0);
      const fast = main >= 8 && main / dt >= this.cfg.velocity;
      if ((main >= this.cfg.threshold || fast) && main >= this.cfg.ratio * minor) {
        const dir: SwipeDir = ax >= ay ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        this.fired = dir;
        if (dir === 'down') this.holdingDown = true;
        out.push({ kind: 'swipe', dir, t: intent });
      }
    } else if ((this.fired === 'left' || this.fired === 'right') && !this.extraUsed) {
      const along = this.fired === 'left' ? -dx : dx;
      if (along >= 2 * this.cfg.threshold && along >= this.cfg.ratio * ay) {
        this.extraUsed = true;
        out.push({ kind: 'swipe', dir: this.fired, t: t });
      }
    }
    return out;
  }

  up(_x: number, _y: number, t: number): GestureOut[] {
    if (!this.active) return [];
    this.active = false;
    const out: GestureOut[] = [];
    if (this.holdingDown) out.push({ kind: 'release', dir: 'down', t });
    this.holdingDown = false;
    return out;
  }

  cancel(t: number): GestureOut[] { return this.up(0, 0, t); }
}
