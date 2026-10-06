// src/sim/Sim.ts —— 模拟主体（DESIGN.md §2、§3、§8.3、§8.9-4…7、§8.10 WP1）。CORE 编写，WP1 补全。纯 TS，不 import three。
// 120 Hz 固定步长，确定性：只用 rng.sim（种子 = hash(chapter.seed, segment.id)）；机器人用 rng.bot（HumanBot.ts）。
// 每 tick 的顺序（Solver 复刻了其中与运动有关的部分，改动时两边一起改）：
//   输入 → 受击速度恢复 → 腿自主抬起 → 腿偏移 → Pace 前进（里程 s、段内时间）→ 竖直（撑跃 / 落地）→ 横向（换道）→ 伏低
//   → 三段触地 → 段内事件（按拍）→ 窗口（rest / ask 打开，回头）→ 「让一下」→ 碰撞 → 回稳 → 领跑者 → 追随者 → timeline（按秒）→ 检查点 → 段末。
// 各机制在自己的文件里：Twitch（腿自主抬起）、Drift（腿偏移）、LookBack（回头）、Ask（让一下）、Stand（七步与梦中站立）、
// Leader（前方的它）、StillRunner（静场时间线）、Autopilot / HumanBot（自动驾驶）。
import type { SimAPI, SolverAPI } from '../core/contracts';
import { TICK_DT } from '../core/constants';
import type { GameEvent, GameEventName, GameEvents } from '../core/events';
import { Hasher } from '../core/hash';
import { hashState } from './stateHash';
import { createRng, type Mulberry32 } from '../core/rng';
import type {
  AABB, Action, ChapterId, ContactPart, FollowerSnap, Hand, HintId, InputEvent, Lane, PlayerMode, RunStats, SimSnapshot, Surface,
} from '../core/types';
import { LINE_HOOKS, type LineId } from '../levels/lines';
import type {
  CompiledChapter, CompiledObstacle, CompiledSegment, EventBody, FollowerDef, RunSegmentDef, StandSegmentDef, StepEventDef, StillSegmentDef,
  TimedEventDef,
} from '../levels/schema';
import { AskRuntime } from './Ask';
import { Autopilot, type AutopilotView } from './Autopilot';
import { classify, obstacleBox, playerBox } from './Collision';
import { driftCounter, driftStart, driftUpdate } from './Drift';
import { Follower } from './Follower';
import { GaitClock, type PendingContact } from './Gait';
import { LeaderRuntime } from './Leader';
import { LookBackRuntime } from './LookBack';
import { advancePace, createPaceState, inAutoCrawl, inStop, nominalCadence, paceEvents, type PaceEvent, type PaceState } from './Pace';
import { laneX, PlayerState } from './Player';
import { StandController, type StandEvent } from './Stand';
import { Steady } from './Steady';
import { StillRunner, type StillFire } from './StillRunner';
import { lanesCovered, obstacleState, TrackRuntime, type ObstacleState } from './Track';
import { twitchSpeedMul, twitchStart, twitchUpdate, twitchVisual, type TwitchOutcome } from './Twitch';
import { DERIVED, TUNING } from './tuning';

const SIM_TYPES = new Set<EventBody['type']>(['follower', 'twitch', 'drift', 'slow', 'stop', 'autoCrawl', 'cadence', 'noteGet', 'leader', 'hush', 'flip', 'end', 'beat']);
const isCue = (t: EventBody['type']) => !SIM_TYPES.has(t);
/** 端盘段：2 s 内换道 ≥ 3 次会晃出汤汁（§3「端盘」）。 */
const SPILL_WINDOW = 2;
const SPILL_COUNT = 3;

interface Timed { t: number; seq: number; id?: string; body: EventBody; fromStop: boolean }
/** hash() 跳过的字段：只读编译数据的引用、输出缓冲、每 tick 重算的临时对象。 */
const HASH_SKIP: ReadonlySet<string> = new Set(['ch', 'seg', 'solver', 'paceEvs', 'out', 'nearTmp', 'dueTmp', 'tmp', 'box', 'ob', 'ost', 'gate']);

/** 「干脆」判定（§2.2）：意图时刻距最近一次掌根触地（刚发生的或下一次）≤ window 秒。 */
export function crispDelta(tIntent: number, lastHeelT: number, nextHeelT: number): number {
  return Math.min(lastHeelT >= 0 ? Math.abs(tIntent - lastHeelT) : Infinity, Math.abs(tIntent - nextHeelT));
}

/**
 * 输入的意图时刻（秒，模拟时钟）。契约（types.ts InputEvent）：t 已经是意图时刻——键盘取 keydown.timeStamp，
 * 触摸取 pointerdown.timeStamp + 40 ms（input/gestures.ts 的 intentOffsetMs = TUNING.steady.touchIntentOffset），
 * Game 在交给模拟之前换算到模拟时钟。所以这里不再二次补偿。
 */
export function intentSec(e: InputEvent): number { return e.t / 1000; }

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
  private readonly look = new LookBackRuntime();
  private readonly askRt = new AskRuntime();
  private readonly leader = new LeaderRuntime();
  private readonly stand: StandController;
  private readonly autopilot: Autopilot;
  private out: GameEvent[] = [];
  private tick = 0;
  private t = 0;
  private evCursor = 0;
  private timed: Timed[] = [];
  private timedSeq = 0;
  private hushUntil = -1;
  private flip = false;
  private slowOption = false;
  private invincible = false;
  private checkpoint = { segment: '', beat: 0 };
  /** 到达当前检查点时「本章是否已经拿过回头收益」：重来回到检查点时的状态（否则重来后的回头收益与第一次不同）。 */
  private cpLookGainUsed = false;
  private stats: RunStats = { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] };
  private beatsFired: string[] = [];
  private firstLegHitDone = false;
  private twitchSaid = false;
  private twSay: LineId | undefined;
  private drSay: LineId | undefined;
  private ended = false;
  private fallT = -1;
  private rngSim: Mulberry32 = createRng(0);
  private lastHeelT = -1;
  private crispNext = false;
  private stillBeat = 0;
  private stillCrawl: { until: number; speed: number } | null = null;
  private prevBox: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private box: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private ob: AABB = { x0: 0, x1: 0, y0: 0, y1: 0, s0: 0, s1: 0 };
  private ost: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  private nearTmp: CompiledObstacle[] = [];
  private dueTmp: PendingContact[] = [];
  private modePrev: PlayerMode = 'crawl';
  private modeT = 0;
  private assist = false;
  private prompt: { hint: HintId | null; look: boolean; ask: boolean } = { hint: null, look: false, ask: false };
  private promptForce = false;
  private trayLanes: number[] = [];
  /** 本段 rest / ask 窗口是否已经打开（与 seg.windows 下标对应；lookBack 窗口由 LookBackRuntime 管，恒为 true）。 */
  private winOpened: boolean[] = [];
  private hitCount = 0;

  constructor(private readonly solver: SolverAPI) {
    this.autopilot = new Autopilot(solver);
    this.stand = new StandController(createRng(0));
  }

  // ——————————————————— SimAPI ———————————————————
  load(ch: CompiledChapter, at?: { segment: string; beat: number }, seed?: number): void {
    this.ch = ch;
    this.seed = (seed ?? ch.seed) >>> 0;
    this.tick = 0; this.t = 0; this.out = [];
    this.stats = { timeMs: 0, falls: 0, stumbles: 0, crashes: 0, lookBacks: 0, notes: [] };
    this.beatsFired = [];
    this.firstLegHitDone = false; this.twitchSaid = false; this.ended = false; this.flip = false; this.hushUntil = -1;
    this.hitCount = 0;
    this.look.resetChapter();
    this.track.taken.clear();
    this.leader.prepare(ch, this.solver);
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
    else if (this.seg.kind === 'stand') this.stepStand(evs, hd);
    else this.stepStill(evs, hd);
    this.follower.update(TICK_DT);
    this.flushContacts();
    this.flushTimed();
    this.updateMode();
    this.updatePrompt();
  }

  snapshot(): Readonly<SimSnapshot> {
    const P = this.P;
    const seg = this.seg;
    const s = this.pace?.s ?? 0;
    const beat = this.segBeat();
    const run = seg?.kind === 'run';
    const mul = this.globalMul() * P.hitMul * twitchSpeedMul(P);
    const speed = run ? (this.pace?.base ?? 0) * mul : 0;
    playerBox(s, P.x, P.y, P.duck, P.twitch, this.box);
    const def = seg?.def;
    const standSnap = seg?.kind === 'stand' ? this.stand.snapshot() : null;
    return {
      tick: this.tick, t: this.t,
      chapter: (this.ch?.def.id ?? 'ch1') as ChapterId, segment: def?.id ?? '', segIndex: this.segIndex, segKind: seg?.kind ?? 'run',
      segBeat: beat,
      checkpoint: { ...this.checkpoint },
      player: {
        s, x: standSnap ? standSnap.x : P.x, y: P.y, floorY: seg ? seg.floorY(s) : 0,
        lane: P.lane, laneTarget: P.laneTarget,
        mode: this.modePrev, modeT: this.modeT,
        speed, cadence: run ? speed / seg.stride : 0, stride: seg?.stride ?? 1,
        beat, airT: P.air ? P.airT : 0, duck: P.duck, twitch: twitchVisual(P), drift: P.drift,
        steady: this.steady.value, steadyMax: this.steady.max,
        graceT: P.graceT, surface: this.surfaceNow(), hitbox: { ...this.box },
        lookBack: this.look.value(), carrying: run && (def as RunSegmentDef).controls?.jump === false ? 'tray' : 'none', stand: standSnap,
      },
      follower: this.followerSnap(),
      still: seg && seg.kind !== 'run' ? {
        set: seg.kind === 'still' ? (def as StillSegmentDef).set ?? 'placeholder' : 'placeholder',
        variant: (def as StillSegmentDef | StandSegmentDef).variant ?? 'default',
        t: this.still.clock, duration: this.still.duration, prompt: this.prompt.hint,
        held: seg.kind === 'stand' ? this.stand.held : this.still.held,
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
    this.slowOption = false;
    this.gotoInternal(segment, beat, false, false);
  }

  setAutopilot(mode: 'off' | 'perfect' | 'human'): void { this.autopilot.mode = mode; this.autopilot.invalidate(); }
  setInvincible(on: boolean): void { this.invincible = on; }
  /** 「放慢一点」（§2.7）：速度 ×0.9，只对本段生效（离开本段即重置，§10.1）。 */
  setSlowOption(on: boolean): void { this.slowOption = on; this.autopilot.invalidate(); }
  /** 辅助模式（§7.3）：速度 ×0.9，干脆窗口 ±100 ms，稳度上限 +1，回稳 12 拍。 */
  setAssist(on: boolean): void {
    this.assist = on; this.steady.assist = on;
    this.steady.setMax(Steady.maxFor(this.follower.mode, this.follower.steadyMaxOverride, on));
    this.autopilot.invalidate();
  }
  /** 难度机器人的种子（rng.bot，WP1 扩展）。 */
  setBotSeed(seed: number): void { this.autopilot.human.setSeed(seed); }
  /** 机器人统计（测试与难度报告用）。 */
  get botStats() { return this.autopilot.human.stats; }

  /**
   * 模拟状态哈希（§8.3）：对 Sim 自身和它持有的全部运行时对象做反射式 FNV-1a（stateHash.ts），覆盖全部数值——
   * 玩家（含换道预排、跳跃 / 伏低缓冲、绊 / 撞计时）、Pace、稳度、追随者（含回放队列与滑变）、步态待发子事件、timed 队列、
   * 翻转 / 静音 / 放慢一点 / 辅助 / 无敌、检查点、静场与站立段、回头、让一下、领跑者、自动驾驶与机器人（含 rng 状态）。
   * 只跳过指向只读编译数据的引用（章、段、求解器、段内 Pace 事件表）和输出缓冲 / 每 tick 重算的临时对象。
   */
  hash(): string {
    return hashState(new Hasher(), this, HASH_SKIP).digest();
  }

  /**
   * 前方 meters 米内、此刻参与碰撞的障碍（__game.obstaclesAhead）。按 obstacleState 的实时状态计算（与碰撞同一口径）：
   * ds = 实际前沿 − s（走动的人含位移），lanes = 此刻覆盖的车道（shift 之后是新车道），此刻不参与碰撞的（门荡开前、
   * 腿收回、到点前、已让开）不列出。len = 沿 s 的长度（s1 − s0），behavior = 行为定义（副本）。旧字段不变。
   */
  obstaclesAhead(meters: number) {
    if (!this.seg || this.seg.kind !== 'run') return [];
    const s = this.pace.s;
    const tSeg = this.pace.tSeg;
    const beat = this.segBeat();
    const st: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
    const out: Array<{ id: number; kind: CompiledObstacle['kind']; cls: CompiledObstacle['cls']; lanes: Lane[]; ds: number; beat: number; len: number; behavior: CompiledObstacle['behavior'] }> = [];
    for (const o of this.seg.obstacles) {
      if (this.track.knocked.has(o.id) || this.track.taken.has(o.id) || this.askRt.parted(o.id, tSeg)) continue;
      obstacleState(o, tSeg, beat, st);
      if (!st.active) continue;
      const ds = o.s0 + st.ds - s;
      if (o.s1 + st.ds < s || ds > meters) continue;
      out.push({ id: o.id, kind: o.kind, cls: o.cls, lanes: lanesCovered(st), ds, beat: o.beat, len: o.s1 - o.s0, behavior: { ...o.behavior } });
    }
    return out;
  }

  /**
   * 跳过当前静场（重试或已看过时由 UI 调用；测试钩子也用）。剩余的事件（含 onDone、站立段还没到的按步事件）：
   *   · mode 'state'（缺省）：只记节拍 id（markBeat），并把会改变状态的事件按「不跳过、看完时」的终态带进下一段（skipState）；
   *     表现类 cue（字幕、音效、铃、机位、替身、影子、回忆、姿势、黑板、叠加层、纸条特写、数数、提示……）一律丢弃，
   *     免得跳过的那一刻一次排出十几个 cue、把字幕和低语带进下一个跑段。
   *   · mode 'all'：旧行为，剩余事件全部立即触发。
   */
  skipStill(mode: 'state' | 'all' = 'state'): void {
    if (!this.seg || this.seg.kind === 'run') return;
    const extra: StillFire[] = [];
    if (this.seg.kind === 'stand') {
      for (const e of this.stepEvents()) if (e.atStep > this.stand.steps) extra.push(stepFire(e));
    }
    if (mode === 'all') this.still.skip((f) => this.fire(f.body, f.id, 'still'), extra);
    else {
      const rest: StillFire[] = [];
      const end = this.still.skip((f) => rest.push(f), extra);
      this.skipState(rest, end);
    }
    this.flushTimed();
    this.nextSegment();
  }

  /**
   * 跳过静场时，剩余事件只保留状态（skipStill 的 'state' 模式）。end = 不跳过时本段在时间线上的结束时刻。
   *   · 节拍：所有带 id 的事件照常记为已触发（必备节拍不丢）。
   *   · 模拟状态：follower、flip、leader 按顺序应用（终态与看完时相同）；noteGet 记进纸条（已有的不重复发 note）；
   *     hush 只把「看完时还剩下的」部分带进下一段。
   *   · 状态类 cue：ambience、atmosphere、fog、rain 各只发最后一个；hud 按它管的状态分两组（显示 / 身后淡出）各发最后一个；
   *     crowd 每组只发最后一个，lights（除 flicker）按顺序全发。
   *   · 其余（表现类 cue；一次性的模拟事件 twitch、drift、autoCrawl、slow、stop、cadence、end、beat）丢弃。
   */
  private skipState(rest: readonly StillFire[], end: number): void {
    const cues = new Map<string, EventBody>();
    let lights = 0;
    for (const f of rest) {
      if (f.id) this.markBeat(f.id);
      const b = f.body;
      let key: string | null = null;
      switch (b.type) {
        case 'follower': case 'flip': case 'leader': this.fire(b, undefined, 'still'); break;
        case 'noteGet': if (!this.stats.notes.includes(b.note)) this.gainNote(b.note, true); break;
        case 'hush': {
          const secs = b.seconds ?? (b.beats !== undefined ? b.beats / Math.max(0.5, this.cadenceNow()) : 1);
          const left = (f.at ?? end) + secs - end;
          if (left > 0) this.hushUntil = Math.max(this.hushUntil, this.t + left);
          break;
        }
        case 'ambience': case 'atmosphere': case 'fog': case 'rain': key = b.type; break;
        // hud 的两组操作管两个互不相干的状态：show / hide / followerFadeInAhead 管空心点显不显示，followerFadeOutBehind 管身后的点淡出
        case 'hud': key = b.op === 'followerFadeOutBehind' ? 'hud:behind' : 'hud:show'; break;
        case 'crowd': key = `crowd:${b.group}`; break;
        case 'lights': if (b.op !== 'flicker') key = `lights:${lights++}`; break;
        default: break;
      }
      if (key) { cues.delete(key); cues.set(key, b); }   // 先删再放：按最后一次出现的先后发
    }
    for (const b of cues.values()) this.emitCue(b);
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
  /** 当前段（测试与难度机器人用）。 */
  get segment(): CompiledSegment { return this.seg; }

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

  private followerSnap(): FollowerSnap {
    const f = this.follower.snapshot(this.steady.value);
    if (f.mode === 'ahead' && this.leader.s !== null) {
      f.leaderS = this.leader.s; f.leaderLane = this.leader.lane; f.distance = this.leader.distance();
    }
    return f;
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
    lookAvailable: () => this.look.available,
    beat: () => this.segBeat(),
    lookWindowFrom: () => this.look.activeWindow()?.from ?? null,
    cadenceMul: () => this.globalMul(),
    player: () => this.P,
    pace: () => this.pace,
    ask: () => ({ asked: Array.from(this.askRt.asked), parts: Array.from(this.askRt.partAt), used: this.askRt.used }),
    stand: () => (this.seg.kind === 'stand' ? this.stand.snapshot() : null),
    seed: () => this.seed,
    hits: () => this.hitCount,
  };

  private gotoInternal(segment: string, beat: number, isRetry: boolean, isLoad: boolean): void {
    const ch = this.ch as CompiledChapter;
    const idx = ch.segments.findIndex((s) => s.def.id === segment);
    const i = idx >= 0 ? idx : 0;
    const seg = ch.segments[i] as CompiledSegment;
    const b = seg.kind === 'run' ? Math.max(0, Math.min(beat, (seg.def as RunSegmentDef).beats - 1)) : 0;
    // 重建追随者、画面翻转与领跑者：依次应用各段的 follower 定义，以及本段 b 之前的 follower / flip / leader 事件
    this.follower.apply({ mode: 'hidden' });
    this.flip = false;
    this.leader.reset();
    let leaderAppeared = false, leaderReceded = false;
    for (let j = 0; j <= i; j++) {
      const sj = ch.segments[j] as CompiledSegment;
      this.follower.apply(sj.def.follower);
      leaderAppeared = false; leaderReceded = false;
      for (const e of sj.events) {
        if (j === i && (sj.kind !== 'run' || e.at >= b)) break;
        if (e.body.type === 'follower') this.follower.apply(e.body.def);
        if (e.body.type === 'flip') this.flip = e.body.on;
        if (e.body.type === 'leader') { if (e.body.op === 'appear') leaderAppeared = true; else leaderReceded = true; }
      }
    }
    if (isRetry) this.look.gainUsed = this.cpLookGainUsed;
    this.P.reset(0);
    this.gait.reset();
    this.follower.clearQueue();
    this.timed = [];
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
    if (leaderAppeared) this.leader.appear();
    if (leaderReceded) this.leader.recede();
    this.leader.target(this.steady.value, true);
    this.checkpoint = { segment: seg.def.id, beat: b };
    this.cpLookGainUsed = this.look.gainUsed;
    this.emit('steady', { value: this.steady.value, max: this.steady.max });
    this.emit('follower', this.followerSnap());
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
    this.look.enterSegment(seg, beat);
    this.winOpened = seg.kind === 'run' ? seg.windows.map((w) => w.type === 'lookBack' || w.to < beat) : [];
    this.askRt.reset();
    this.track.reset();
    this.trayLanes = [];
    this.rngSim = createRng(this.seed, seg.def.id);
    this.autopilot.invalidate();
    this.stillBeat = 0;
    this.stillCrawl = null;
    this.emit('segment', { id: seg.def.id, index: i, kind: seg.kind });
    this.prompt = { hint: null, look: false, ask: false };
    this.emit('prompt', { hint: null, context: { look: false, ask: false } });
    this.leader.enterSegment(seg, this.follower.mode === 'ahead');
    if (seg.kind === 'run') {
      this.P.mode = 'crawl';
      playerBox(s, this.P.x, this.P.y, this.P.duck, 0, this.prevBox);
      if (beat === 0) {
        this.checkpoint = { segment: seg.def.id, beat: 0 };
        this.cpLookGainUsed = this.look.gainUsed;
        this.emit('checkpoint', { ...this.checkpoint });
      }
    } else if (seg.kind === 'stand') {
      this.P.mode = 'still';
      const def = seg.def as StandSegmentDef;
      this.still.start(seg, { external: def.script === 'sevenSteps', gate: () => this.stand.finished() });
      for (const e of this.stand.start(def, createRng(this.seed, `${def.id}:stand`))) this.emitStand(e);
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
    this.slowOption = false;   // 「放慢一点」只对本段生效（§2.7、§10.1）
    const lane = this.P.laneTarget;
    const fdef: Partial<FollowerDef> = nextSeg.def.follower;
    const changed = this.follower.apply(fdef);
    const keepX = this.P.x;
    if (nextSeg.kind === 'run' && this.seg.kind !== 'run') this.P.reset(0);
    else if (nextSeg.kind !== 'run') this.P.reset(lane);
    else {
      // 跑段接跑段：横向位置保留，腿部状态清零（段落边界是门洞或拐角）
      this.P.x = keepX; this.P.twPhase = 0; this.P.twitch = 0; this.P.drPhase = 0;
    }
    this.enterSegment(this.segIndex + 1, nextSeg.kind === 'run' ? Math.max(s, nextSeg.s0) : s, 0, 0);
    this.steady.setMax(Steady.maxFor(this.follower.mode, this.follower.steadyMaxOverride, this.assist));
    if (fdef.steady !== undefined) this.steady.value = Math.min(this.steady.max, fdef.steady);
    if (changed) this.follower.snapTo(this.steady.value); else this.follower.retarget(this.steady.value);
    this.leader.target(this.steady.value, changed);
    this.emit('steady', { value: this.steady.value, max: this.steady.max });
    this.emit('follower', this.followerSnap());
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

  private emitCue(body: EventBody, id?: string): void {
    const cue: GameEvents['cue'] = { body, segment: this.seg.def.id };
    if (id !== undefined) cue.id = id;
    this.emit('cue', cue);
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
        if (changed && this.follower.mode === 'ahead') this.leader.enterSegment(this.seg, true);
        this.leader.target(this.steady.value, changed);
        this.emit('steady', { value: this.steady.value, max: this.steady.max });
        this.emit('follower', this.followerSnap());
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
      case 'twitch':
        twitchStart(this.P, body.hold);
        this.twSay = body.say;
        this.emit('twitch', { phase: 'warn' });
        return;
      case 'drift':
        driftStart(this.P, body.dir);
        this.drSay = body.say;
        this.emit('drift', { phase: 'warn', dir: body.dir });
        return;
      case 'leader':
        if (body.op === 'appear') { this.leader.appear(); this.leader.target(this.steady.value, true); } else this.leader.recede();
        this.emit('follower', this.followerSnap());
        return;
      case 'beat': return;
      default:
        if (isCue(body.type)) this.emitCue(body, id);
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
    // 2. 受击速度恢复；腿自主抬起；腿偏移
    P.updateHit(TICK_DT);
    this.onTwitch(twitchUpdate(P, TICK_DT, held.has('down')));
    if (driftUpdate(P, TICK_DT, P.onSoft) === 'moved') this.emit('drift', { phase: 'moved', dir: P.drDir });
    // 3. 前进
    advancePace(seg, this.pace, this.paceEvs, this.globalMul() * P.hitMul * twitchSpeedMul(P), TICK_DT);
    const beat = this.segBeat();
    // 4. 竖直
    if (P.updateAir(TICK_DT)) {
      this.emit('land', { surface: this.surfaceNow(), heavy: true });
      this.gait.landing(this.t, this.cadenceNow(), (hand, t) => this.emitContact(hand, 'heel', t, true));
      // 速降落地后的自动伏低：2 拍是最短时长；↓ 还按着就和地面上的伏低一样，按住可以延长（§2.2）
      if (P.duckAfterLandBeats > 0) { P.startDuck(beat, P.duckAfterLandBeats); P.duckHeld = held.has('down'); P.duckAfterLandBeats = 0; }
    }
    // 5. 横向、伏低
    P.updateLane(TICK_DT, P.onSoft);
    P.updateDuck(TICK_DT, beat);
    // 6. 三段触地（空中不落掌；停拍中静止时 beat 不变，自然没有触地）
    if (!P.air) {
      const cad = Math.max(0.5, this.pace.base * this.globalMul() * P.hitMul * twitchSpeedMul(P) / seg.stride);
      this.gait.cross(prevBeat, beat, t0, t1, cad, (bi, t) => {
        this.emitContact(bi % 2 === 0 ? 'L' : 'R', 'heel', t, false);
      });
    }
    // 7. 段内事件（按拍）
    while (this.evCursor < seg.events.length && (seg.events[this.evCursor] as { at: number }).at <= beat + 1e-9) {
      const e = seg.events[this.evCursor++] as { at: number; id?: string; body: EventBody };
      this.fire(e.body, e.id, 'run');
    }
    // 8. 窗口：rest / ask 打开时记节拍、排 then；回头窗口
    this.openWindows(beat);
    this.look.updateWindows(beat, (i) => this.startLookBack(i, true));
    if (this.look.update(TICK_DT)) this.emit('lookBack', { phase: 'end', gain: this.look.gain, auto: this.look.auto });
    // 9. 碰撞
    const hit = this.collide(beat);
    if (P.mode === 'fall' as PlayerMode) return;
    // 10. 回稳
    if (!hit && beat > prevBeat) {
      if (this.steady.progress(beat - prevBeat, this.follower.mode)) this.onSteadyChanged();
    }
    // 11. 领跑者
    if (this.follower.mode === 'ahead') this.leader.update(TICK_DT, seg, this.pace.s, this.solver);
    // 12. 检查点
    for (const cp of seg.checkpoints) {
      if (cp > 0 && beat >= cp && prevBeat < cp && !(this.checkpoint.segment === def.id && this.checkpoint.beat >= cp)) {
        this.checkpoint = { segment: def.id, beat: cp };
        this.cpLookGainUsed = this.look.gainUsed;
        this.emit('checkpoint', { ...this.checkpoint });
      }
    }
    // 13. 段末
    if (this.pace.ended || beat >= def.beats) { this.flushContacts(); this.flushTimed(); this.nextSegment(); }
  }

  private onTwitch(o: TwitchOutcome): void {
    if (!o) return;
    this.emit('twitch', { phase: o });
    if (o === 'suppressed') {
      this.emit('action', { kind: 'hold', crisp: false });
      if (this.twSay && !this.twitchSaid) {
        this.twitchSaid = true;
        this.emitCue({ type: 'text', line: this.twSay, style: 'whisper' });
      }
    }
  }

  private surfaceNow(): Surface {
    const P = this.P;
    if (!this.seg) return 'terrazzo';
    if (P.onSoft && P.surfaceSoftKind) return P.surfaceSoftKind;
    return this.seg.kind === 'run' ? (this.seg.def as RunSegmentDef).surface : 'terrazzo';
  }

  private isCrisp(e: InputEvent): boolean {
    const win = this.assist ? TUNING.assist.crispWindow : TUNING.steady.crispWindow;
    const cad = Math.max(0.5, this.cadenceNow() * this.globalMul());
    const beat = this.segBeat();
    // 输入在本 tick 推进之前处理：beat 对应的是上一 tick 末（this.t − TICK_DT）
    const nextHeel = this.t - TICK_DT + (Math.ceil(beat + 1e-9) - beat) / cad;
    return crispDelta(intentSec(e), this.lastHeelT, nextHeel) <= win + 1e-9;
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
        if (driftCounter(P, dir)) {
          // 腿偏移预警中按反方向：掰正，留在原车道（§3）
          this.emit('drift', { phase: 'countered', dir: (-dir) as -1 | 1 });
          this.emit('action', { kind: 'straighten', crisp, dir });
          if (crisp) onCrisp();
          if (this.drSay) this.emitCue({ type: 'text', line: this.drSay });
          break;
        }
        if (P.laneInput(dir, P.onSoft)) {
          this.emit('action', { kind: 'lane', crisp, dir });
          if (crisp) onCrisp();
          this.trayCheck();
        }
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
      case 'look': {
        const i = this.look.activeIndex();
        if (this.look.available && i >= 0) this.startLookBack(i, false);
        break;
      }
      case 'ask': {
        const res = this.askRt.ask(this.seg, this.pace.s, beat, this.pace.tSeg);
        if (res.length) {
          this.emit('action', { kind: 'ask', crisp: false });
          for (const r of res) this.emit('ask', { targetId: r.id, result: r.result });
        }
        break;
      }
      default: break;
    }
  }

  /** 端盘段：2 s 内换道 ≥ 3 次，汤汁晃出来（纯减损，§3「端盘」）。 */
  private trayCheck(): void {
    if ((this.seg.def as RunSegmentDef).controls?.jump !== false) return;
    this.trayLanes.push(this.t);
    while (this.trayLanes.length && this.t - (this.trayLanes[0] as number) > SPILL_WINDOW) this.trayLanes.shift();
    if (this.trayLanes.length >= SPILL_COUNT) {
      this.trayLanes = [];
      this.emitCue({ type: 'sfx', sfx: 'soupSpill' });
    }
  }

  private startLookBack(i: number, auto: boolean): void {
    const r = this.look.start(i, auto);
    if (!r) return;
    if (r.gain) { this.steady.gain(1); this.onSteadyChanged(); }
    this.stats.lookBacks++;
    if (!auto) this.emit('action', { kind: 'look', crisp: false });
    this.emit('lookBack', { phase: 'start', gain: r.gain, auto });
    if (r.window.id) this.markBeat(r.window.id);
    this.scheduleThen(r.window.then);
  }

  /**
   * rest / ask 窗口在段内拍号到达 from 时打开：窗口 id 记为已触发的节拍，then 按相对秒数排进 timeline（与校验器的口径一致：
   * 附录 C 允许把必备节拍挂在窗口上，staticChecks 把 rest / ask 窗口的 id 与 then 里的 id 都算作「必定触发」）。
   * 进段（或从检查点重来）时已经结束的窗口不再打开；正处在窗口里的，第一 tick 就打开。回头窗口只在回头开始时触发（startLookBack）。
   */
  private openWindows(beat: number): void {
    const wins = this.seg.windows;
    for (let i = 0; i < wins.length; i++) {
      if (this.winOpened[i] !== false) continue;
      const w = wins[i];
      if (!w || beat < w.from - 1e-9) continue;
      this.winOpened[i] = true;
      if (w.id) this.markBeat(w.id);
      this.scheduleThen(w.then);
    }
  }

  /** 把一组相对此刻的 TimedEventDef 排进 timeline（回头的 then、rest / ask 窗口的 then）。 */
  private scheduleThen(then: readonly TimedEventDef[] | undefined): void {
    if (!then?.length) return;
    for (const te of then) {
      const { at, id, ...rest } = te as TimedEventDef & Record<string, unknown>;
      const item: Timed = { t: this.t + at, seq: this.timedSeq++, body: rest as unknown as EventBody, fromStop: false };
      if (id !== undefined) item.id = id as string;
      this.timed.push(item);
    }
    this.timed.sort((a, b) => a.t - b.t || a.seq - b.seq);
  }

  private emitContact(hand: Hand, part: ContactPart, t: number, heavy: boolean, surface?: Surface): void {
    const crisp = part === 'heel' && this.crispNext;
    if (part === 'heel') { this.lastHeelT = t; this.crispNext = false; }
    this.emit('contact', { hand, part, t, s: this.pace?.s ?? 0, x: this.P.x, surface: surface ?? this.surfaceNow(), crisp, heavy });
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
      if (this.askRt.parted(o.id, this.pace.tSeg)) continue;
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
    this.hitCount++;
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
    if (this.autopilot.active && this.autopilot.mode === 'perfect') this.autopilot.invalidate();
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
        if (q.cls !== 'block' || q.id === o.id || this.askRt.parted(q.id, this.pace.tSeg)) return false;
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
    this.leader.target(this.steady.value);
    if (this.follower.retarget(this.steady.value)) this.emit('follower', this.followerSnap());
  }

  // ——————————————————— 静场 ———————————————————
  private stillFire = (f: StillFire): void => {
    if (f.body.type === 'autoCrawl') { this.stillCrawl = { until: this.t + f.body.seconds, speed: f.body.speed }; if (f.id) this.markBeat(f.id); return; }
    if (f.body.type === 'end') { if (f.id) this.markBeat(f.id); this.still.done = true; return; }
    this.fire(f.body, f.id, 'still');
  };

  private stepStill(events: readonly InputEvent[], held: ReadonlySet<Action>): void {
    const set = (this.seg.def as StillSegmentDef).set;
    this.still.step(TICK_DT, events, held, this.stillFire, (i) => {
      // ↓ ↓ ↓：每一下是一声掌根、指节或指腹（§4.4 结尾卡）
      const part: ContactPart = i === 1 ? 'heel' : i === 2 ? 'knuckle' : 'pad';
      this.emitContact(i % 2 === 1 ? 'L' : 'R', part, this.t, false, set === 'bedroom' ? 'sheet' : 'air');
    });
    this.onTwitch(twitchUpdate(this.P, TICK_DT, held.has('down')));
    // 静场里的自动爬行：只推进步态相位，照常发出触地
    if (this.stillCrawl && this.t <= this.stillCrawl.until) {
      const prev = this.stillBeat;
      this.stillBeat += this.stillCrawl.speed * TICK_DT;
      this.gait.cross(prev, this.stillBeat, this.t - TICK_DT, this.t, this.stillCrawl.speed, (bi, t) => this.emitContact(bi % 2 === 0 ? 'L' : 'R', 'heel', t, false));
    }
    if (this.still.done) { this.stillCrawl = null; this.flushContacts(); this.flushTimed(); this.nextSegment(); }
  }

  // ——————————————————— 站立段 ———————————————————
  private stepEvents(): StepEventDef[] {
    const def = this.seg.def as StandSegmentDef;
    return (def.events as Array<Record<string, unknown>>).filter((e) => typeof e.atStep === 'number') as unknown as StepEventDef[];
  }

  private emitStand(e: StandEvent): void {
    if (!('step' in e)) { this.emit('stand', { phase: e.phase }); if (e.phase === 'risen') this.promptForce = true; return; }
    this.emit('stand', { phase: e.phase, step: e.step, theta: e.theta });
    if (e.phase === 'step' || e.phase === 'fall') {
      for (const se of this.stepEvents()) {
        if (se.atStep !== e.step) continue;
        const f = stepFire(se);
        this.still.schedule(this.still.clock + (se.delay ?? 0), f.body, f.id);
      }
    }
  }

  private stepStand(events: readonly InputEvent[], held: ReadonlySet<Action>): void {
    const st = this.stand;
    if (st.script === 'dream' && !st.downSaid && events.some((e) => e.phase === 'down' && e.action === 'down')) {
      st.downSaid = true;
      // 4-3 梦中第一次按 ↓ 时的字（§4.4、§10.2）：WP2 在 lines.ts 的 LINE_HOOKS 里登记
      this.emitCue({ type: 'text', line: LINE_HOOKS.dreamDownPress });
    }
    this.still.step(TICK_DT, events, held, this.stillFire);
    const out: StandEvent[] = [];
    if (this.still.waiting) {
      const r = st.stepWait(TICK_DT, held, out, (line) => this.emitCue({ type: 'text', line: line as LineId }));
      if (r === 'risen') this.still.completeInput();
      if (r === 'hint') this.promptForce = true;
    } else if (!this.still.done) {
      st.stepMove(TICK_DT, held, out);
    }
    for (const e of out) this.emitStand(e);
    if (this.still.done) { this.flushTimed(); this.nextSegment(); }
  }

  // ——————————————————— 提示与情境按钮 ———————————————————
  private updatePrompt(): void {
    if (!this.seg || this.ended) return;
    let hint: HintId | null = null;
    let look = false, ask = false;
    if (this.seg.kind === 'run') {
      look = this.look.available;
      ask = this.askRt.available(this.seg, this.pace.s, this.segBeat());
      hint = look ? 'look' : ask ? 'ask' : null;
    } else if (this.seg.kind === 'stand') {
      if (this.still.waiting) hint = this.still.input?.hint ?? 'rise';
      else if (this.stand.script === 'sevenSteps' && (this.stand.phase === 'walking' || this.stand.phase === 'planted')) hint = 'balance';
    } else {
      hint = this.still.prompt;
    }
    const p = this.prompt;
    if (!this.promptForce && p.hint === hint && p.look === look && p.ask === ask) return;
    this.promptForce = false;
    this.prompt = { hint, look, ask };
    this.emit('prompt', { hint, context: { look, ask } });
  }

  private updateMode(): void {
    const P = this.P;
    let m: PlayerMode;
    if (P.mode === 'fall') m = 'fall';
    else if (this.seg.kind === 'stand') {
      const ph = this.stand.phase;
      m = ph === 'wait' ? 'still' : ph === 'rising' ? 'rise' : ph === 'fallen' ? 'down' : 'stand';
    } else if (this.seg.kind !== 'run') m = 'still';
    else if (P.air) m = 'air';
    else if (P.crashT >= 0) m = 'crash';
    else if (P.stumbleT > TUNING.hit.stumbleRecover - DERIVED.stumbleModeSec) m = 'stumble';
    else if (P.twPhase === 2) m = 'halfStand';
    else if (inStop(this.pace) && !inAutoCrawl(this.pace)) m = 'stop';
    else if (P.duck > 0.5) m = 'duck';
    else m = 'crawl';
    if (m !== this.modePrev) { this.modePrev = m; this.modeT = 0; } else this.modeT += TICK_DT;
  }
}

/** 按步事件 → 时间线事件（去掉 atStep / delay）。 */
function stepFire(e: StepEventDef): StillFire {
  const { atStep: _a, delay: _d, id, ...rest } = e as StepEventDef & Record<string, unknown>;
  const f: StillFire = { body: rest as unknown as EventBody };
  if (id !== undefined) f.id = id as string;
  return f;
}
