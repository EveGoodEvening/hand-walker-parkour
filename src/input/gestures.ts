// src/input/gestures.ts —— 滑动识别（DESIGN.md §2.2 输入细节、D8）。WP8。纯逻辑，不碰 DOM，可在 Node 测试。
// · 位移超过阈值（24 px，设置可选 32 / 16）或速度 ≥ 0.35 px/ms 就立即触发，不等抬手。
//   速度取「自按下以来的平均速度」与「相邻两次采样之间的瞬时速度」中较大的一个；速度触发还要求位移 ≥ 8 px，
//   否则手指落下时的抖动（1–2 px / 1 ms）会被当成快速滑动。
// · 按主轴判定方向，|主| / |次| ≥ 1.2，比值不够就不触发（之后移动到比值够了再触发）。
// · 同一次按下，沿同一方向的累计位移超过 2 倍阈值时可以再换一次道（只对左右，只一次）。
// · 下滑触发后手指不抬起就是按住（抬手时发 release）。
// · 意图时刻 = pointerdown 时刻 + 40 ms（补偿识别滑动所需的延迟，§2.2「干脆」判定）。
export type SwipeDir = 'left' | 'right' | 'up' | 'down';
export interface SwipeFire { kind: 'swipe'; dir: SwipeDir; t: number }
export interface SwipeRelease { kind: 'release'; dir: 'down'; t: number }
export type GestureOut = SwipeFire | SwipeRelease;
export interface SwipeConfig { threshold: number; velocity: number; ratio: number; intentOffsetMs: number; minFastPx: number }
export const DEFAULT_SWIPE: SwipeConfig = { threshold: 24, velocity: 0.35, ratio: 1.2, intentOffsetMs: 40, minFastPx: 8 };

export class SwipeRecognizer {
  private active = false;
  private x0 = 0; private y0 = 0; private t0 = 0;
  private lx = 0; private ly = 0; private lt = 0;
  private fired: SwipeDir | null = null;
  private extraUsed = false;
  private holdingDown = false;
  cfg: SwipeConfig;
  constructor(cfg: Partial<SwipeConfig> = {}) { this.cfg = { ...DEFAULT_SWIPE, ...cfg }; }

  get isActive(): boolean { return this.active; }
  get holding(): boolean { return this.holdingDown; }
  get firedDir(): SwipeDir | null { return this.fired; }

  down(x: number, y: number, t: number): void {
    this.active = true; this.x0 = x; this.y0 = y; this.t0 = t;
    this.lx = x; this.ly = y; this.lt = t;
    this.fired = null; this.extraUsed = false; this.holdingDown = false;
  }

  move(x: number, y: number, t: number): GestureOut[] {
    if (!this.active) return [];
    const out: GestureOut[] = [];
    const dx = x - this.x0, dy = y - this.y0;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (this.fired === null) {
      const main = Math.max(ax, ay), minor = Math.min(ax, ay);
      const avg = main / Math.max(1, t - this.t0);
      const sx = x - this.lx, sy = y - this.ly;
      const inst = Math.max(Math.abs(sx), Math.abs(sy)) / Math.max(1, t - this.lt);
      const fast = main >= this.cfg.minFastPx && Math.max(avg, inst) >= this.cfg.velocity;
      if ((main >= this.cfg.threshold || fast) && main >= this.cfg.ratio * minor) {
        const dir: SwipeDir = ax >= ay ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        this.fired = dir;
        if (dir === 'down') this.holdingDown = true;
        out.push({ kind: 'swipe', dir, t: this.t0 + this.cfg.intentOffsetMs });
      }
    } else if ((this.fired === 'left' || this.fired === 'right') && !this.extraUsed) {
      const along = this.fired === 'left' ? -dx : dx;
      if (along >= 2 * this.cfg.threshold && along >= this.cfg.ratio * ay) {
        this.extraUsed = true;
        out.push({ kind: 'swipe', dir: this.fired, t });
      }
    }
    this.lx = x; this.ly = y; this.lt = t;
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
