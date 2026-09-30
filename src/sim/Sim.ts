// src/sim/Sim.ts —— 模拟主体（DESIGN.md §2、§8.3、§8.9-4…7）。CORE 编写，归 WP1。纯 TS，不 import three。
// 120 Hz 固定步长，确定性：只用 rng.sim（种子 = hash(chapter.seed, segment.id)）。
// 每 tick 的顺序（Solver 复刻了其中与运动有关的部分，改动时两边一起改）：
//   输入 → 受击速度恢复 → Pace 前进（里程 s、段内时间）→ 竖直（撑跃 / 落地）→ 横向（换道）→ 伏低
//   → 三段触地 → 段内事件（按拍）→ 回头窗口 → 碰撞 → 回稳 → 追随者 → timeline（按秒）→ 检查点 → 段末。
import type { SimAPI, SolverAPI } from '../core/contracts';
import { TICK_DT } from '../core/constants';
import type { GameEvent, GameEventName, GameEvents } from '../core/events';
import { Hasher } from '../core/hash';
import { createRng, type Mulberry32 } from '../core/rng';
import type {
  AABB, Action, ChapterId, ContactPart, Hand, InputEvent, Lane, PlayerMode, RunStats, SimSnapshot, Surface,
} from '../core/types';
import type {
  CompiledChapter, CompiledObstacle, CompiledSegment, EventBody, FollowerDef, RunSegmentDef, StillSegmentDef, TimedEventDef,
} from '../levels/schema';
import { Autopilot, type AutopilotView } from './Autopilot';
import { classify, obstacleBox, playerBox } from './Collision';
import { Follower } from './Follower';
import { GaitClock, type PendingContact } from './Gait';
import { advancePace, createPaceState, inAutoCrawl, inStop, nominalCadence, paceEvents, type PaceEvent, type PaceState } from './Pace';
import { laneX, PlayerState } from './Player';
import { Steady } from './Steady';
import { StillRunner } from './StillRunner';
import { obstacleState, TrackRuntime, type ObstacleState } from './Track';
import { DERIVED, TUNING } from './tuning';

const isCue = (t: EventBody['type']) => !SIM_TYPES.has(t);
const SIM_TYPES = new Set<EventBody['type']>(['follower', 'twitch', 'drift', 'slow', 'stop', 'autoCrawl', 'cadence', 'noteGet', 'leader', 'hush', 'flip', 'end', 'beat']);

interface Timed { t: number; seq: number; id?: string; body: EventBody; fromStop: boolean }
type WinState = 'pending' | 'active' | 'done';

export class Sim implements SimAPI {
  private ch: CompiledChapter | null = null;
  private seed = 0;
  private segIndex = 0;
  private seg!: CompiledSegment;
  private pace!: PaceState;
  private paceEvs: PaceEvent[] = [];
  private readonly P = new PlayerState();
  private readonly steady = new Steady();
  private readonly follower = new Follower();
  private readonly gait = new GaitClock();
  private readonly still = new StillRunner();
  private readonly track = new TrackRuntime();
  private readonly autopilot: Autopilot;
  private out: GameEvent[] = [];
  private tick = 0;
  private t = 0;
  private evCursor = 0;
  private timed: Timed[] = [];
  private timedSeq = 0;
  private winState: WinState[] = [];
  private lookT = -1;
  private lookGainUsed = false;
  private lookGain: 0 | 1 = 0;
  private lookAuto = false;
  private hushUntil = -1;
  private flip = false;
  private slowOption = false;
  private invincible = false;
  private checkpoint = { segment: '', beat: 0 };
  private stats: RunStats = { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] };
  private beatsFired: string[] = [];
  private firstLegHitDone = false;
  private ended = false;
  private fallT = -1;
  private ctxLook = false;
  private rngSim: Mulberry32 = createRng(0);
  private lastHeelT = -1;
  private crispNext = false;
  private stillBeat = 0;
  private prevBox: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private box: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private ob: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private ost: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  private nearTmp: CompiledObstacle[] = [];
  private dueTmp: PendingContact[] = [];
  private modePrev: PlayerMode = 'crawl';
  private modeT = 0;
  private assist = false;

  constructor(private readonly solver: SolverAPI) {
    this.autopilot = new Autopilot(solver);
  }

  // ——————————————————— SimAPI ———————————————————
  load(ch: CompiledChapter, at?: { segment: string; beat: number }, seed?: number): void {
    this.ch = ch;
    this.seed = (seed ?? ch.seed) >>> 0;
    this.tick = 0; this.t = 0; this.out = [];
    this.stats = { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] };
    this.beatsFired = [];
    this.firstLegHitDone = false; this.lookGainUsed = false; this.ended = false; this.flip = false; this.hushUntil = -1;
    this.track.taken.clear();
    this.emit('chapter:start', { id: ch.def.id });
    const segId = at?.segment ?? (ch.segments[0] as CompiledSegment).def.id;
    this.gotoInternal(segId, at?.beat ?? 0, false, true);
  }

  step(events: readonly InputEvent[], held: ReadonlySet<Action>): void {
    if (!this.ch) return;
    this.tick++;
    if (this.ended) return;
    this.t += TICK_DT;
    this.stats.timeMs = Math.round(this.t * 1000);
    if (this.P.mode === 'fall') { this.fallT += TICK_DT; this.flushContacts(); return; }
    let evs = events; let hd = held;
    if (this.autopilot.active) {
      const r = this.autopilot.inputs(this.apView, events, held);
      evs = r.events; hd = r.held;
    }
    if (this.seg.kind === 'run') this.stepRun(evs, hd);
    else this.stepStill(evs, hd);
    this.follower.update(TICK_DT);
    this.flushContacts();
    this.flushTimed();
    this.updateMode();
  }

  snapshot(): Readonly<SimSnapshot> {
    const P = this.P;
    const seg = this.seg;
    const s = this.pace?.s ?? 0;
    const beat = this.segBeat();
    const mul = this.globalMul() * P.hitMul;
    const speed = seg?.kind === 'run' ? (this.pace?.base ?? 0) * mul : 0;
    playerBox(s, P.x, P.y, P.duck, P.twitch, this.box);
    const surface: Surface = P.onSoft && P.surfaceSoftKind ? P.surfaceSoftKind : seg?.kind === 'run' ? (seg.def as RunSegmentDef).surface : 'terrazzo';
    const def = seg?.def;
    return {
      tick: this.tick, t: this.t,
      chapter: (this.ch?.def.id ?? 'ch1') as ChapterId, segment: def?.id ?? '', segIndex: this.segIndex, segKind: seg?.kind ?? 'run',
      segBeat: beat,
      checkpoint: { ...this.checkpoint },
      player: {
        s, x: P.x, y: P.y, floorY: seg ? seg.floorY(s) : 0,
        lane: P.lane, laneTarget: P.laneTarget,
        mode: this.modePrev, modeT: this.modeT,
        speed, cadence: seg?.kind === 'run' ? speed / seg.stride : 0, stride: seg?.stride ?? 1,
        beat, airT: P.air ? P.airT : 0, duck: P.duck, twitch: P.twitch, drift: P.drift,
        steady: this.steady.value, steadyMax: this.steady.max,
        graceT: P.graceT, surface, hitbox: { ...this.box },
        lookBack: this.lookValue(), carrying: 'none', stand: null,
      },
      follower: this.follower.snapshot(this.steady.value),
      still: seg && seg.kind !== 'run' ? {
        set: (def as StillSegmentDef).set ?? 'placeholder', variant: (def as StillSegmentDef).variant ?? 'default',
        t: this.still.clock, duration: this.still.duration, prompt: this.still.prompt, held: this.still.held,
      } : null,
      hush: this.t < this.hushUntil, flip: this.flip, slowOption: this.slowOption,
      stats: { ...this.stats, notes: [...this.stats.notes] }, beatsFired: this.beatsFired,
    };
  }

  drain(): GameEvent[] { const o = this.out; this.out = []; return o; }

  retry(): void {
    if (!this.ch) return;
    const cp = this.checkpoint;
    this.gotoInternal(cp.segment, cp.beat, true, false);
    this.emit('retry', { segment: cp.segment, beat: cp.beat });
  }

  goto(segment: string, beat = 0): void {
    if (!this.ch) return;
    this.ended = false;
    this.gotoInternal(segment, beat, false, false);
  }

  setAutopilot(mode: 'off' | 'perfect' | 'human'): void { this.autopilot.mode = mode; this.autopilot.invalidate(); }
  setInvincible(on: boolean): void { this.invincible = on; }
  setSlowOption(on: boolean): void { this.slowOption = on; this.autopilot.invalidate(); }
  /** 辅助模式（§7.3）：速度 ×0.9，稳度上限 +1，回稳 12 拍。 */
  setAssist(on: boolean): void { this.assist = on; this.steady.assist = on; this.autopilot.invalidate(); }

  hash(): string {
    const h = new Hasher();
    const P = this.P;
    h.num(this.tick).num(this.t).num(this.segIndex).num(this.pace?.s ?? 0).num(this.pace?.tSeg ?? 0).num(this.pace?.base ?? 0);
    h.num(P.x).num(P.y).num(P.laneTarget).num(P.airT).num(P.air ? 1 : 0).num(P.duck).num(P.ducking ? 1 : 0).num(P.hitMul).num(P.graceT);
    h.num(this.steady.value).num(this.steady.max).num(this.steady.regen).num(this.follower.lag).str(this.follower.mode);
    h.num(this.stats.falls).num(this.stats.stumbles).num(this.stats.crashes).num(this.stats.lookBacks).str(this.stats.notes.join(','));
    h.str(this.modePrev).num(this.rngSim.state).num(this.lookT).num(this.still.clock).bool(this.ended);
    for (const id of Array.from(this.track.knocked).sort((a, b) => a - b)) h.num(id);
    return h.digest();
  }

  obstaclesAhead(meters: number) {
    if (!this.seg || this.seg.kind !== 'run') return [];
    const s = this.pace.s;
    return this.seg.obstacles
      .filter((o) => o.s1 >= s && o.s0 - s <= meters && !this.track.knocked.has(o.id) && !this.track.taken.has(o.id))
      .map((o) => ({ id: o.id, kind: o.kind, cls: o.cls, lanes: [...o.lanes], ds: o.s0 - s, beat: o.beat }));
  }

  /** 跳过当前静场（重试或已看过时由 UI 调用；测试钩子也用）。 */
  skipStill(): void {
    if (!this.seg || this.seg.kind === 'run') return;
    this.still.skip((f) => this.fire(f.body, f.id, 'still'));
    this.flushTimed();
    this.nextSegment();
  }

  /** 当前求解计划（__game.plan）：自动驾驶开着时是它正在执行的计划，否则从当前状态现解一次。 */
  currentPlan() {
    const ap = this.autopilot.active ? this.autopilot.currentPlan() : null;
    if (ap) return ap;
    if (!this.seg || this.seg.kind !== 'run') return null;
    return this.solver.solve(this.seg, { from: { s: this.pace.s, lane: this.P.laneTarget, tSeg: this.pace.tSeg }, cadenceMul: this.globalMul() });
  }
  get compiled(): CompiledChapter | null { return this.ch; }
  get isEnded(): boolean { return this.ended; }
  get fallTime(): number { return this.fallT; }

  // ——————————————————— 内部 ———————————————————
  private emit<K extends GameEventName>(type: K, data: GameEvents[K]): void {
    this.out.push({ type, tick: this.tick, data } as GameEvent);
  }

  private globalMul(): number {
    return (this.slowOption ? TUNING.slowOption : 1) * (this.assist ? TUNING.assist.speedMul : 1);
  }

  private segBeat(): number {
    if (!this.seg) return 0;
    if (this.seg.kind === 'run') return (this.pace.s - this.seg.s0) / this.seg.stride;
    return this.still.clock;
  }

  private cadenceNow(): number {
    if (this.seg.kind !== 'run') return 4.8;
    return nominalCadence(this.seg, this.pace, this.segBeat());
  }

  private readonly apView: AutopilotView = {
    seg: () => this.seg,
    segKind: () => this.seg.kind,
    s: () => this.pace.s,
    tSeg: () => this.pace.tSeg,
    laneTarget: () => this.P.laneTarget,
    tMs: () => this.t * 1000,
    stillInput: () => this.still.input ?? null,
    stillWaiting: () => this.still.waiting,
    lookAvailable: () => this.ctxLook,
    beat: () => this.segBeat(),
    lookWindowFrom: () => {
      const i = this.winState.indexOf('active');
      return i >= 0 ? (this.seg.windows[i]?.from ?? null) : null;
    },
    cadenceMul: () => this.globalMul(),
  };

  private gotoInternal(segment: string, beat: number, isRetry: boolean, isLoad: boolean): void {
    const ch = this.ch as CompiledChapter;
    const idx = ch.segments.findIndex((s) => s.def.id === segment);
    const i = idx >= 0 ? idx : 0;
    const seg = ch.segments[i] as CompiledSegment;
    const b = seg.kind === 'run' ? Math.max(0, Math.min(beat, (seg.def as RunSegmentDef).beats - 1)) : 0;
    // 重建追随者与稳度上限：依次应用各段的 follower 定义，以及本段 b 之前的 follower / flip 事件
    this.follower.apply({ mode: 'hidden' });
    this.flip = false;
    for (let j = 0; j <= i; j++) {
      const sj = ch.segments[j] as CompiledSegment;
      this.follower.apply(sj.def.follower);
      for (const e of sj.events) {
        if (j === i && (sj.kind !== 'run' || e.at >= b)) break;
        if (e.body.type === 'follower') this.follower.apply(e.body.def);
        if (e.body.type === 'flip') this.flip = e.body.on;
      }
    }
    this.P.reset(0);
    this.gait.reset();
    this.follower.clearQueue();
    this.timed = [];
    this.lookT = -1;
    this.fallT = -1;
    this.hushUntil = isLoad ? -1 : Math.min(this.hushUntil, this.t);
    this.ended = false;
    this.autopilot.invalidate();
    const s = seg.kind === 'run' ? seg.s0 + b * seg.stride : seg.s0;
    const tSeg = seg.kind === 'run' ? seg.timeAt(b) : 0;
    this.enterSegment(i, s, tSeg, b);
    this.modePrev = seg.kind === 'run' ? 'crawl' : 'still';
    this.modeT = 0;
    this.steady.setMax(Steady.maxFor(this.follower.mode, this.follower.steadyMaxOverride, this.assist));
    if (isRetry || isLoad) this.steady.fill();
    const segDefSteady = seg.def.follower.steady;
    if (isLoad && segDefSteady !== undefined && b === 0) this.steady.value = Math.min(this.steady.max, segDefSteady);
    this.follower.snapTo(this.steady.value);
    this.checkpoint = { segment: seg.def.id, beat: b };
    this.emit('steady', { value: this.steady.value, max: this.steady.max });
    this.emit('follower', this.follower.snapshot(this.steady.value));
  }

  private enterSegment(i: number, s: number, tSeg: number, beat: number): void {
    const ch = this.ch as CompiledChapter;
    const seg = ch.segments[i] as CompiledSegment;
    this.segIndex = i;
    this.seg = seg;
    this.paceEvs = paceEvents(seg);
    this.pace = createPaceState(seg, s, tSeg);
    this.evCursor = 0;
    if (seg.kind === 'run') while (this.evCursor < seg.events.length && (seg.events[this.evCursor] as { at: number }).at < beat - 1e-9) this.evCursor++;
    this.winState = seg.windows.map((w) => (w.to < beat ? 'done' : 'pending'));
    this.ctxLook = false;
    this.track.reset();
    this.rngSim = createRng(this.seed, seg.def.id);
    this.autopilot.invalidate();
    this.stillBeat = 0;
    this.emit('segment', { id: seg.def.id, index: i, kind: seg.kind });
    this.emit('prompt', { hint: null, context: { look: false, ask: false } });
    if (seg.kind === 'run') {
      this.P.mode = 'crawl';
      playerBox(s, this.P.x, this.P.y, this.P.duck, 0, this.prevBox);
      if (beat === 0) {
        this.checkpoint = { segment: seg.def.id, beat: 0 };
        this.emit('checkpoint', { ...this.checkpoint });
      }
    } else {
      this.P.mode = 'still';
      this.still.start(seg);
    }
  }

  private nextSegment(): void {
    const ch = this.ch as CompiledChapter;
    if (this.segIndex + 1 >= ch.segments.length) { this.endChapter(); return; }
    const nextSeg = ch.segments[this.segIndex + 1] as CompiledSegment;
    const s = this.pace.s;
    this.slowOption = false;   // 「放慢一点」只对本段生效（§2.7）
    const lane = this.P.laneTarget;
    const fdef: Partial<FollowerDef> = nextSeg.def.follower;
    const changed = this.follower.apply(fdef);
    const keepX = this.P.x;
    if (nextSeg.kind === 'run' && this.seg.kind !== 'run') this.P.reset(0);
    else if (nextSeg.kind !== 'run') this.P.reset(lane);
    else { this.P.x = keepX; }
    this.enterSegment(this.segIndex + 1, nextSeg.kind === 'run' ? Math.max(s, nextSeg.s0) : s, 0, 0);
    this.steady.setMax(Steady.maxFor(this.follower.mode, this.follower.steadyMaxOverride, this.assist));
    if (fdef.steady !== undefined) this.steady.value = Math.min(this.steady.max, fdef.steady);
    if (changed) this.follower.snapTo(this.steady.value); else this.follower.retarget(this.steady.value);
    this.emit('steady', { value: this.steady.value, max: this.steady.max });
    this.emit('follower', this.follower.snapshot(this.steady.value));
  }

  private endChapter(): void {
    this.ended = true;
    this.flushTimed(true);
    this.emit('chapter:end', { id: (this.ch as CompiledChapter).def.id, stats: { ...this.stats, notes: [...this.stats.notes] } });
  }

  private markBeat(id: string): void {
    if (!this.beatsFired.includes(id)) this.beatsFired.push(id);
    this.emit('beat', { id });
  }

  /** 处理一个事件体（段内事件、timeline、静场）。 */
  private fire(body: EventBody, id: string | undefined, _source: 'run' | 'timed' | 'still'): void {
    if (id) this.markBeat(id);
    switch (body.type) {
      case 'follower': {
        const changed = this.follower.apply(body.def);
        this.steady.setMax(Steady.maxFor(this.follower.mode, this.follower.steadyMaxOverride, this.assist));
        if (body.def.steady !== undefined) this.steady.value = Math.min(this.steady.max, body.def.steady);
        if (changed) this.follower.snapTo(this.steady.value); else this.follower.retarget(this.steady.value);
        this.emit('steady', { value: this.steady.value, max: this.steady.max });
        this.emit('follower', this.follower.snapshot(this.steady.value));
        return;
      }
      case 'noteGet': this.gainNote(body.note, true); return;
      case 'hush': {
        const secs = body.seconds ?? (body.beats !== undefined ? body.beats / Math.max(0.5, this.cadenceNow()) : 1);
        this.hushUntil = Math.max(this.hushUntil, this.t + secs);
        return;
      }
      case 'flip': this.flip = body.on; return;
      case 'slow': case 'stop': {
        // 运动由 Pace 处理；这里只排 timeline（autoCrawl / end 也归 Pace，不重复处理）
        const tl = (body.type === 'slow' ? body.timeline ?? [] : body.timeline) as TimedEventDef[];
        for (const te of tl) {
          const { at, id: tid, ...rest } = te as TimedEventDef & Record<string, unknown>;
          const item: Timed = { t: this.t + at, seq: this.timedSeq++, body: rest as unknown as EventBody, fromStop: body.type === 'stop' };
          if (tid !== undefined) item.id = tid;
          this.timed.push(item);
        }
        this.timed.sort((a, b) => a.t - b.t || a.seq - b.seq);
        return;
      }
      case 'end':
        if (this.seg.kind === 'run') this.pace.ended = true;
        return;
      case 'autoCrawl':
        return; // 跑段里由 Pace 处理；静场里由 stepStill 处理
      case 'cadence': return; // Pace
      case 'twitch': case 'drift': case 'leader':
        // WP1 实现（Twitch.ts / Drift.ts / Leader.ts）；CORE 只转发给画面和声音
        if (body.type === 'twitch') this.emit('twitch', { phase: 'warn' });
        if (body.type === 'drift') this.emit('drift', { phase: 'warn', dir: body.dir });
        return;
      case 'beat': return;
      default:
        if (isCue(body.type)) {
          const cue: GameEvents['cue'] = { body, segment: this.seg.def.id };
          if (id !== undefined) cue.id = id;
          this.emit('cue', cue);
        }
    }
  }

  private gainNote(note: string, auto: boolean): void {
    if (!this.stats.notes.includes(note)) this.stats.notes.push(note);
    this.emit('note', { id: note, auto });
  }

  // ——————————————————— 跑段 ———————————————————
  private stepRun(events: readonly InputEvent[], held: ReadonlySet<Action>): void {
    const P = this.P;
    const seg = this.seg;
    const def = seg.def as RunSegmentDef;
    const prevBeat = this.segBeat();
    const t0 = this.t - TICK_DT, t1 = this.t;
    // 1. 输入
    for (const e of events) this.handleInput(e, prevBeat, def);
    if (!held.has('down')) P.duckHeld = false;
    if (P.jumpBuffer > 0) {
      P.jumpBuffer = Math.max(0, P.jumpBuffer - TICK_DT);
      if (!P.air && !P.crashStopped && def.controls?.jump !== false && P.jumpBuffer > 0) {
        P.startJump(this.cadenceNow());
        this.emit('action', { kind: 'jump', crisp: false });
      }
    }
    // 2. 受击速度恢复
    P.updateHit(TICK_DT);
    // 3. 前进
    const fired = advancePace(seg, this.pace, this.paceEvs, this.globalMul() * P.hitMul, TICK_DT);
    void fired;
    const beat = this.segBeat();
    // 4. 竖直
    if (P.updateAir(TICK_DT)) {
      this.emit('land', { surface: this.surfaceNow(), heavy: true });
      this.gait.landing(this.t, this.cadenceNow(), (hand, t) => this.emitContact(hand, 'heel', t, true));
      if (P.duckAfterLandBeats > 0) { P.startDuck(beat, P.duckAfterLandBeats); P.duckHeld = false; P.duckAfterLandBeats = 0; }
    }
    // 5. 横向、伏低
    P.updateLane(TICK_DT, P.onSoft);
    P.updateDuck(TICK_DT, beat);
    // 6. 三段触地（空中不落掌；停拍中静止时 beat 不变，自然没有触地）
    if (!P.air) {
      const cad = Math.max(0.5, this.pace.base * this.globalMul() * P.hitMul / seg.stride);
      this.gait.cross(prevBeat, beat, t0, t1, cad, (bi, t) => {
        this.emitContact(bi % 2 === 0 ? 'L' : 'R', 'heel', t, false);
      });
    }
    // 7. 段内事件（按拍）
    while (this.evCursor < seg.events.length && (seg.events[this.evCursor] as { at: number }).at <= beat + 1e-9) {
      const e = seg.events[this.evCursor++] as { at: number; id?: string; body: EventBody };
      this.fire(e.body, e.id, 'run');
    }
    // 8. 回头窗口
    this.updateWindows(beat);
    this.updateLook();
    // 9. 碰撞
    const hit = this.collide(beat);
    if (P.mode === 'fall' as PlayerMode) return;
    // 10. 回稳
    if (!hit && beat > prevBeat) {
      if (this.steady.progress(beat - prevBeat, this.follower.mode)) this.onSteadyChanged();
    }
    // 11. 检查点
    for (const cp of seg.checkpoints) {
      if (cp > 0 && beat >= cp && prevBeat < cp && !(this.checkpoint.segment === def.id && this.checkpoint.beat >= cp)) {
        this.checkpoint = { segment: def.id, beat: cp };
        this.emit('checkpoint', { ...this.checkpoint });
      }
    }
    // 12. 段末
    if (this.pace.ended || beat >= def.beats) { this.flushContacts(); this.flushTimed(); this.nextSegment(); }
  }

  private surfaceNow(): Surface {
    const P = this.P;
    if (P.onSoft && P.surfaceSoftKind) return P.surfaceSoftKind;
    return this.seg.kind === 'run' ? (this.seg.def as RunSegmentDef).surface : 'terrazzo';
  }

  private isCrisp(e: InputEvent): boolean {
    const win = this.assist ? TUNING.assist.crispWindow : TUNING.steady.crispWindow;
    const tIntent = e.t / 1000;
    const cad = Math.max(0.5, this.cadenceNow());
    const beat = this.segBeat();
    const nextHeel = this.t + (Math.ceil(beat + 1e-9) - beat) / cad;
    const d = Math.min(this.lastHeelT >= 0 ? Math.abs(tIntent - this.lastHeelT) : Infinity, Math.abs(tIntent - nextHeel));
    return d <= win;
  }

  private handleInput(e: InputEvent, beat: number, def: RunSegmentDef): void {
    const P = this.P;
    if (e.phase === 'up') {
      if (e.action === 'down') P.duckHeld = false;
      return;
    }
    const crisp = (e.action === 'left' || e.action === 'right' || e.action === 'up' || e.action === 'down') && this.isCrisp(e);
    const onCrisp = () => {
      this.crispNext = true;
      if (this.steady.crisp(this.follower.mode)) this.onSteadyChanged();
    };
    switch (e.action) {
      case 'left': case 'right': {
        const dir = e.action === 'left' ? -1 : 1;
        if (P.laneInput(dir, P.onSoft)) { this.emit('action', { kind: 'lane', crisp, dir }); if (crisp) onCrisp(); }
        break;
      }
      case 'up': {
        if (def.controls?.jump === false) break;
        if (P.air || P.crashStopped) { P.jumpBuffer = TUNING.inputBuffer; break; }
        P.startJump(this.cadenceNow());
        this.emit('action', { kind: 'jump', crisp });
        if (crisp) onCrisp();
        break;
      }
      case 'down': {
        if (P.air) { P.startFastFall(); this.emit('action', { kind: 'fastFall', crisp: false }); break; }
        P.startDuck(beat);
        this.emit('action', { kind: 'duck', crisp });
        if (crisp) onCrisp();
        break;
      }
      case 'look':
        if (this.ctxLook) {
          const i = this.winState.indexOf('active');
          if (i >= 0) this.startLookBack(i, false);
        }
        break;
      default: break;
    }
  }

  private emitContact(hand: Hand, part: ContactPart, t: number, heavy: boolean): void {
    const crisp = part === 'heel' && this.crispNext;
    if (part === 'heel') { this.lastHeelT = t; this.crispNext = false; }
    this.emit('contact', { hand, part, t, s: this.pace?.s ?? 0, x: this.P.x, surface: this.surfaceNow(), crisp, heavy });
    const cad = this.seg.kind === 'run' ? Math.max(0.5, (this.pace.base * this.globalMul()) / this.seg.stride) : 4.8;
    this.follower.onContact(t, hand, part, cad);
  }

  /** 发出到期的指节、指腹与追随者触地。 */
  private flushContacts(): void {
    for (const c of this.gait.due(this.t, this.dueTmp)) this.emitContact(c.hand, c.part, c.t, c.heavy);
    const fdue: Array<{ t: number; hand: Hand; part: ContactPart; lag: number }> = [];
    this.follower.due(this.t, fdue);
    for (const f of fdue) {
      this.emit('followerContact', { hand: f.hand, part: f.part, t: f.t, lagBeats: f.lag, steady: this.steady.value, from: this.follower.from });
    }
  }

  private flushTimed(all = false): void {
    while (this.timed.length && (all || (this.timed[0] as Timed).t <= this.t + 1e-9)) {
      const e = this.timed.shift() as Timed;
      if (e.fromStop && (e.body.type === 'autoCrawl' || e.body.type === 'end')) { if (e.id) this.markBeat(e.id); continue; }
      this.fire(e.body, e.id, 'timed');
    }
  }

  private updateWindows(beat: number): void {
    const wins = this.seg.windows;
    let look = false;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (!w || w.type !== 'lookBack') continue;
      const st = this.winState[i];
      if (st === 'pending' && beat >= w.from) this.winState[i] = 'active';
      if (this.winState[i] === 'active') {
        if (beat >= w.to) {
          if (w.auto) this.startLookBack(i, true); else this.winState[i] = 'done';
        } else look = true;
      }
    }
    if (look !== this.ctxLook) {
      this.ctxLook = look;
      this.emit('prompt', { hint: look ? 'look' : null, context: { look, ask: false } });
    }
  }

  private startLookBack(i: number, auto: boolean): void {
    const w = this.seg.windows[i];
    if (!w) return;
    this.winState[i] = 'done';
    this.lookT = 0;
    this.lookAuto = auto;
    const gain: 0 | 1 = w.gain === 1 && !this.lookGainUsed ? 1 : 0;
    this.lookGain = gain;
    if (gain) { this.lookGainUsed = true; this.steady.gain(1); this.onSteadyChanged(); }
    this.stats.lookBacks++;
    this.emit('lookBack', { phase: 'start', gain, auto });
    if (w.id) this.markBeat(w.id);
    for (const te of w.then ?? []) {
      const { at, id, ...rest } = te as TimedEventDef & Record<string, unknown>;
      const item: Timed = { t: this.t + at, seq: this.timedSeq++, body: rest as unknown as EventBody, fromStop: false };
      if (id !== undefined) item.id = id;
      this.timed.push(item);
    }
    this.timed.sort((a, b) => a.t - b.t || a.seq - b.seq);
    if (this.ctxLook) { this.ctxLook = false; this.emit('prompt', { hint: null, context: { look: false, ask: false } }); }
  }

  private updateLook(): void {
    if (this.lookT < 0) return;
    this.lookT += TICK_DT;
    const L = TUNING.lookBack;
    if (this.lookT >= L.turn + L.hold + L.back) {
      this.lookT = -1;
      this.emit('lookBack', { phase: 'end', gain: this.lookGain, auto: this.lookAuto });
    }
  }

  private lookValue(): number {
    if (this.lookT < 0) return 0;
    const L = TUNING.lookBack;
    const t = this.lookT;
    if (t < L.turn) return t / L.turn;
    if (t < L.turn + L.hold) return 1;
    return Math.max(0, 1 - (t - L.turn - L.hold) / L.back);
  }

  private collide(beat: number): boolean {
    const P = this.P;
    const seg = this.seg;
    const s = this.pace.s;
    playerBox(s, P.x, P.y, P.duck, P.twitch, this.box);
    P.onSoft = false;
    let hitNow = false;
    const ducking = P.duck > 0 && P.duck < 1;
    for (const o of this.track.near(seg.obstacles, s, 3, 3, this.nearTmp)) {
      if (this.track.knocked.has(o.id) || this.track.taken.has(o.id)) continue;
      const st = obstacleState(o, this.pace.tSeg, beat, this.ost);
      if (!st.active) continue;
      obstacleBox(o, st, this.ob);
      if (this.ob.s0 > s + 3 || this.ob.s1 < s - 3) continue;
      const r = classify(this.box, this.prevBox, o, this.ob, ducking);
      if (r.type === 'soft') { P.onSoft = true; P.surfaceSoftKind = o.kind === 'leaves' ? 'leavesWet' : 'water'; continue; }
      if (r.type === 'pickup') {
        this.track.taken.add(o.id);
        const note = String(o.params.note ?? '');
        if (note) this.gainNote(note, false);
        continue;
      }
      if (r.type === 'nearMiss') {
        if (!this.track.nearMissed.has(o.id)) { this.track.nearMissed.add(o.id); this.emit('nearMiss', { kind: o.kind, side: r.side }); }
        continue;
      }
      if (r.type !== 'hit' || hitNow) continue;
      if (P.graceT > 0 || this.invincible) continue;
      hitNow = true;
      this.applyHit(o, r.severity, r.mode, beat);
      if (P.mode === 'fall') break;
    }
    const pb = this.prevBox, b = this.box;
    pb.x0 = b.x0; pb.x1 = b.x1; pb.y0 = b.y0; pb.y1 = b.y1; pb.s0 = b.s0; pb.s1 = b.s1;
    return hitNow;
  }

  private applyHit(o: CompiledObstacle, severity: 'stumble' | 'crash', mode: string, beat: number): void {
    const P = this.P;
    const res = this.steady.hit(severity, this.follower.mode, this.invincible);
    if (severity === 'crash') this.stats.crashes++; else this.stats.stumbles++;
    if (o.cls === 'low') this.track.knocked.add(o.id);
    const firstLegHit = o.kind === 'legs' && !this.firstLegHitDone;
    if (firstLegHit) this.firstLegHitDone = true;
    this.emit('hit', {
      severity, kind: o.kind, obstacleId: o.id, lane: P.lane, steady: this.steady.value,
      crowd: (this.seg.def as RunSegmentDef).crowd === true, firstLegHit,
    });
    if (res === 'fall') { this.fall(o); return; }
    if (severity === 'stumble') {
      P.stumble();
      if ((mode === 'blockSide' || mode === 'blockGraze') && P.laneTarget !== P.laneSettled) P.startLane(P.laneSettled, P.onSoft, TUNING.laneChange.dry);
    } else {
      P.crash();
      if (mode === 'barCrash') { P.startDuck(beat, DERIVED.crashDuckBeats); P.duckHeld = false; }
      if (mode === 'blockFront') {
        const free = this.freeLaneNear(o);
        if (free !== null) P.startLane(free, P.onSoft, TUNING.laneChange.dry);
      }
    }
    this.onSteadyChanged();
    if (this.autopilot.active) this.autopilot.invalidate();
  }

  /** 撞上挡道后推到最近的空车道。 */
  private freeLaneNear(o: CompiledObstacle): Lane | null {
    const P = this.P;
    const cands = ([P.lane - 1, P.lane + 1] as number[]).filter((l) => l >= -1 && l <= 1) as Lane[];
    cands.sort((a, b) => Math.abs(laneX(a) - P.x) - Math.abs(laneX(b) - P.x) || Math.abs(a) - Math.abs(b));
    const beat = this.segBeat();
    for (const l of cands) {
      const x = laneX(l);
      const blocked = this.seg.obstacles.some((q) => {
        if (q.cls !== 'block' || q.id === o.id) return false;
        const st = obstacleState(q, this.pace.tSeg, beat, { active: true, ds: 0, x0: 0, x1: 0, amount: 1 });
        return st.active && st.x0 < x + 0.22 && st.x1 > x - 0.22 && q.s0 + st.ds < o.s1 + 1 && q.s1 + st.ds > o.s0 - 1;
      });
      if (!blocked) return l;
    }
    return null;
  }

  private fall(o: CompiledObstacle): void {
    const P = this.P;
    P.mode = 'fall';
    this.modePrev = 'fall'; this.modeT = 0;
    this.fallT = 0;
    this.stats.falls++;
    this.gait.reset();
    this.emit('fall', { cause: o.kind, surface: this.surfaceNow() });
  }

  private onSteadyChanged(): void {
    this.emit('steady', { value: this.steady.value, max: this.steady.max });
    if (this.follower.retarget(this.steady.value)) this.emit('follower', this.follower.snapshot(this.steady.value));
  }

  // ——————————————————— 静场 ———————————————————
  private stepStill(events: readonly InputEvent[], held: ReadonlySet<Action>): void {
    const r = this.still.step(TICK_DT, events, held, (f) => {
      if (f.body.type === 'autoCrawl') { this.stillCrawl = { until: this.t + f.body.seconds, speed: f.body.speed }; if (f.id) this.markBeat(f.id); return; }
      if (f.body.type === 'end') { if (f.id) this.markBeat(f.id); this.still.done = true; return; }
      this.fire(f.body, f.id, 'still');
    });
    if (r.promptChanged) this.emit('prompt', { hint: this.still.prompt, context: { look: false, ask: false } });
    // 静场里的自动爬行：只推进步态相位，照常发出触地
    if (this.stillCrawl && this.t <= this.stillCrawl.until) {
      const prev = this.stillBeat;
      this.stillBeat += this.stillCrawl.speed * TICK_DT;
      this.gait.cross(prev, this.stillBeat, this.t - TICK_DT, this.t, this.stillCrawl.speed, (bi, t) => this.emitContact(bi % 2 === 0 ? 'L' : 'R', 'heel', t, false));
    }
    if (this.still.done) { this.stillCrawl = null; this.flushContacts(); this.flushTimed(); this.nextSegment(); }
  }
  private stillCrawl: { until: number; speed: number } | null = null;

  private updateMode(): void {
    const P = this.P;
    let m: PlayerMode;
    if (P.mode === 'fall') m = 'fall';
    else if (this.seg.kind !== 'run') m = 'still';
    else if (P.air) m = 'air';
    else if (P.crashT >= 0) m = 'crash';
    else if (P.stumbleT > TUNING.hit.stumbleRecover - DERIVED.stumbleModeSec) m = 'stumble';
    else if (inStop(this.pace) && !inAutoCrawl(this.pace)) m = 'stop';
    else if (P.duck > 0.5) m = 'duck';
    else m = 'crawl';
    if (m !== this.modePrev) { this.modePrev = m; this.modeT = 0; } else this.modeT += TICK_DT;
  }
}
