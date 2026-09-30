// src/sim/Stand.ts —— 站立段（DESIGN.md §3「站起来」、D6、§2.4 stand、§4.4 4-3、§4.5 5-8、附录 A-6）。WP1。
//
// 七步（sevenSteps，5-8）：
//   · 起身：到 input.at 时开始等待。按住 ↑（触屏：按住屏幕）逐秒出字（progress），满 holdSeconds（缺省 3 s）站起；
//     提前松手沉回去、计时重来（出字也重来）；hintRepeat（8 s）还没按过就再提示一次；input.timeout（缺省 12 s）后腿自己站起来。
//   · 站起后每 stepPeriod（0.9 s）自动迈一步。第 2 步之后 0.3 s 必定失衡一次：双手撑地 0.6 s（planted），稳住后继续；
//     **第 7 步必定摔倒**（fallen）。步数永远是七，不早也不晚，与玩家输入无关。
//   · ← → 只影响晃动角 θ（画面的晃动与镜头滚转，§5.4 滚转 = θ × 0.6）：θ 不参与任何判定，也不改变步点的时刻。
// 梦中站立（dream，4-3）：自动起身（1.2 s），零扰动，走三步后站住；← → 只挪动重心（0.6 m/s），不碰撞；按 ↓ 没有用
//   （第一次按 ↓ 时由 Sim 显示一次「我的手垂在身侧，不听使唤。」）。
// 随机数只用站立段自己的 rng（种子 = hash(章种子, 段 id + ':stand')），与其他系统互不影响。
import type { Action, StandSnap } from '../core/types';
import type { StandSegmentDef, StillInput } from '../levels/schema';
import type { Mulberry32 } from '../core/rng';
import { TUNING } from './tuning';

const ST = TUNING.stand;
/** 梦中起身的时长（秒，与 §5.4 站立镜头的 1.2 s 过渡一致）。 */
export const DREAM_RISE_SEC = 1.2;
/** 梦中走几步后站住（§4.4「走三步」）。 */
export const DREAM_STEPS = 3;
/** 七步：失衡在第几步、摔倒在第几步。 */
export const PLANT_STEP = 2;
export const FALL_STEP = 7;
/** 第 2 步之后多久双手撑地（秒），以及撑地多久（§5.6「失衡时双手撑地 0.6 s 后再起来」）。 */
export const PLANT_DELAY = 0.3;
export const PLANT_SEC = 0.6;
/** 晃动角的画面上限（弧度）：θ 只是画面，碰到上限就停住。 */
const THETA_MAX = ST.plantAngle;

export type StandEvent =
  | { phase: 'rise' | 'risen' }
  | { phase: 'step' | 'plant' | 'fall'; step: number; theta: number };

export class StandController {
  script: 'dream' | 'sevenSteps' = 'sevenSteps';
  phase: StandSnap['phase'] = 'wait';
  /** 这一次连续按住 ↑ 的秒数。 */
  held = 0;
  steps = 0;
  /** 距上一步的秒数（撑地期间暂停）。 */
  stepT = 0;
  theta = 0;
  omega = 0;
  /** 梦中挪动重心的横向偏移（米）。 */
  x = 0;
  /** 开始等待起身以来的秒数。 */
  waitT = 0;
  private hintRepeated = false;
  private riseT = 0;
  private plantDelay = -1;
  private plantT = 0;
  private progressFired: number[] = [];
  private input: StillInput | undefined;
  /** 梦里第一次按 ↓ 的字只显示一次。 */
  downSaid = false;

  constructor(private rng: Mulberry32) {}

  start(def: StandSegmentDef, rng: Mulberry32): StandEvent[] {
    this.rng = rng;
    this.script = def.script;
    this.input = def.input;
    this.held = 0; this.steps = 0; this.stepT = 0; this.theta = 0; this.omega = 0; this.x = 0; this.waitT = 0;
    this.hintRepeated = false; this.riseT = 0; this.plantDelay = -1; this.plantT = 0; this.progressFired = []; this.downSaid = false;
    if (def.script === 'dream') { this.phase = 'rising'; return [{ phase: 'rise' }]; }
    this.phase = 'wait';
    return [];
  }

  /** 七步起身需要按住的秒数。 */
  get holdNeed(): number { return this.input?.holdSeconds ?? ST.riseHold; }
  /** 七步：多久不起身腿就自己站起来。 */
  get autoAfter(): number { return this.input?.timeout ?? ST.autoRiseAfter; }

  /**
   * 七步的起身等待（时间线停在 input.at 时每 tick 调用）。
   * 返回：'risen' 已站起；'hint' 需要再提示一次；否则 null。onLine 收到逐秒的出字。
   */
  stepWait(dt: number, held: ReadonlySet<Action>, out: StandEvent[], onLine: (line: string) => void): 'risen' | 'hint' | null {
    this.waitT += dt;
    if (held.has('up')) {
      if (this.held === 0) { this.phase = 'rising'; out.push({ phase: 'rise' }); }
      this.held += dt;
      for (const p of this.input?.progress ?? []) {
        if (this.held >= p.at - 1e-9 && !this.progressFired.includes(p.at)) { this.progressFired.push(p.at); onLine(p.line); }
      }
    } else if (this.held > 0) {
      this.held = 0; this.progressFired = []; this.phase = 'wait';   // 沉回去，计时重来
    }
    if (this.held >= this.holdNeed - 1e-9 || this.waitT >= this.autoAfter - 1e-9) { this.rise(out); return 'risen'; }
    if (!this.hintRepeated && this.held === 0 && this.waitT >= ST.hintRepeat - 1e-9) { this.hintRepeated = true; return 'hint'; }
    return null;
  }

  private rise(out: StandEvent[]): void {
    this.phase = 'walking';
    this.held = Math.max(this.held, this.holdNeed);
    this.stepT = 0; this.theta = 0; this.omega = 0;
    out.push({ phase: 'risen' });
  }

  /** 站起之后（或梦中）每 tick 调用。 */
  stepMove(dt: number, held: ReadonlySet<Action>, out: StandEvent[]): void {
    const u = (held.has('left') ? 1 : 0) - (held.has('right') ? 1 : 0);   // 按 ← 把重心往左挪：θ 向负
    if (this.script === 'dream') {
      if (this.phase === 'rising') {
        this.riseT += dt;
        if (this.riseT >= DREAM_RISE_SEC - 1e-9) this.rise(out);
        return;
      }
      if (this.phase !== 'walking') return;
      this.x = Math.max(-1.1, Math.min(1.1, this.x - u * ST.dreamSidestep * dt));
      if (this.steps < DREAM_STEPS) {
        this.stepT += dt;
        if (this.stepT >= ST.stepPeriod - 1e-9) { this.stepT -= ST.stepPeriod; this.steps++; out.push({ phase: 'step', step: this.steps, theta: 0 }); }
        if (this.steps >= DREAM_STEPS) this.stepT = 0;
      }
      return;
    }
    // —— 七步 ——
    if (this.phase === 'fallen' || this.phase === 'wait' || this.phase === 'rising') return;
    this.integrateTheta(dt, u);
    if (this.phase === 'planted') {
      this.plantT -= dt;
      this.theta *= Math.max(0, 1 - 6 * dt); this.omega = 0;       // 手撑住，身体回正
      if (this.plantT <= 1e-9) { this.phase = 'walking'; this.theta = 0; }
      return;
    }
    if (this.plantDelay >= 0) {
      this.plantDelay -= dt;
      // 失衡：θ 被推向当前倾斜的一侧（画面）
      const side = this.theta >= 0 ? 1 : -1;
      this.theta = Math.max(-THETA_MAX, Math.min(THETA_MAX, this.theta + side * 1.2 * dt));
      if (this.plantDelay <= 1e-9) {
        this.plantDelay = -1; this.phase = 'planted'; this.plantT = PLANT_SEC;
        out.push({ phase: 'plant', step: this.steps, theta: this.theta });
      }
    }
    this.stepT += dt;
    if (this.stepT >= ST.stepPeriod - 1e-9) {
      this.stepT -= ST.stepPeriod;
      this.steps++;
      const [k0, k1] = ST.kick;
      this.omega += (this.rng.next() < 0.5 ? -1 : 1) * (k0 + (k1 - k0) * this.rng.next());
      if (this.steps >= FALL_STEP) {
        this.phase = 'fallen'; this.stepT = 0;
        out.push({ phase: 'fall', step: this.steps, theta: this.theta });
        return;
      }
      out.push({ phase: 'step', step: this.steps, theta: this.theta });
      if (this.steps === PLANT_STEP) this.plantDelay = PLANT_DELAY;
    }
  }

  /** θ 的画面动力学：倒立摆 + 阻尼 + 玩家的扭矩；碰到上限就停住。 */
  private integrateTheta(dt: number, u: number): void {
    const alpha = ST.gravity * Math.sin(this.theta) - ST.damping * this.omega + ST.torque * -u * 0.5;
    this.omega += alpha * dt;
    this.theta += this.omega * dt;
    if (this.theta > THETA_MAX) { this.theta = THETA_MAX; this.omega = Math.min(0, this.omega); }
    if (this.theta < -THETA_MAX) { this.theta = -THETA_MAX; this.omega = Math.max(0, this.omega); }
  }

  /** 是否已经可以结束这一段（七步：已经摔倒；梦：已经站起来）。 */
  finished(): boolean {
    if (this.script === 'sevenSteps') return this.phase === 'fallen';
    return this.phase === 'walking';
  }

  snapshot(): StandSnap {
    return { script: this.script, phase: this.phase, held: this.held, steps: this.steps, stepT: this.stepT, theta: this.theta, x: this.x };
  }
}
