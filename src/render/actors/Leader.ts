// src/render/actors/Leader.ts —— 前方的它（DESIGN.md §2.6 ahead、§3「前方的它」、§4.5 5-11）。WP5。
// 一个和你一模一样的爬行替身，在你前方 3 / 6 / 9 / 12 m（按稳度；永远不会比 3 m 更近，镜头也不会穿过它），
// 按求解器路线在它所在的位置做出正确动作（换道、撑跃、伏低），每一掌在地上激起一圈光（LampFieldAPI.ring），替你照亮前路。
// 位置取 FollowerSnap.leaderS / leaderLane（WP1 的 Leader）；没有时按 s + distance 与求解器路线推算。出现 / 远去时淡入淡出。
import * as THREE from 'three';
import type { Plan, PlanStep, ViewContext, ViewSystem } from '../../core/contracts';
import { AHEAD_DISTANCE, LANE_WIDTH } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp, lerp } from '../../core/math';
import type { SimSnapshot } from '../../core/types';
import type { CompiledChapter, CompiledSegment } from '../../levels/schema';
import { crawlPose, jumpDur, PoseBuilder, type CrawlInput } from './handCycle';
import type { ActorRigFactory, Rig } from './rigBuild';

export class LeaderSystem implements ViewSystem {
  readonly id = 'wp5.leader';
  readonly owner = 'WP5' as const;
  readonly order = 32;
  private ctx!: ViewContext;
  private rig!: Rig;
  private mat!: THREE.MeshLambertMaterial;
  private readonly b = new PoseBuilder();
  private readonly I: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 5, speed: 5, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };
  private chapter: CompiledChapter | null = null;
  private plan: Plan | null = null;
  private planSeg = -1;
  private alpha = 0;
  private x = 0; private xv = 0; private duck = 0;
  private lastBeat = NaN;
  private lastT = 0;
  /** 调试：强制显示（__game.ext.wp5Leader(true)）。 */
  forced = false;
  /** 本帧状态（测试用）。 */
  state = { visible: false, s: 0, x: 0, air: false, duck: 0, distance: 0 };

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    const f = ctx.rig as unknown as ActorRigFactory;
    this.mat = ctx.mat.lambert({ vertexColors: true, flat: true, transparent: true, opacity: 0 });
    this.mat.name = 'wp5.leader';
    this.rig = f.make('leader', this.mat);
    this.rig.root.visible = false;
    ctx.scene.add(this.rig.root);
  }
  async loadChapter(ch: CompiledChapter): Promise<void> { this.chapter = ch; this.plan = null; this.planSeg = -1; this.alpha = 0; }
  onSegment(seg: CompiledSegment): void { if (seg.index !== this.planSeg) { this.plan = null; this.planSeg = -1; } }
  onEvent(e: GameEvent): void { if (e.type === 'retry') { this.lastBeat = NaN; } }
  onReset(): void { this.lastBeat = NaN; this.plan = null; this.planSeg = -1; }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const f = next.follower;
    const on = next.segKind === 'run' && (f.mode === 'ahead' || this.forced);
    const tNow = next.t;
    let sdt = tNow - this.lastT;
    if (!(sdt >= 0) || sdt > 60) sdt = 0;
    this.lastT = tNow;
    void dt;
    const step = Math.max(sdt, 1e-3);
    this.alpha = clamp(this.alpha + (on ? sdt / 1.5 : -sdt / 1.2), 0, 1);
    this.state.visible = this.alpha > 0.001;
    if (!this.state.visible) { this.rig.root.visible = false; return; }
    const seg = this.chapter?.segments[next.segIndex];
    if (!seg || seg.kind !== 'run') { this.rig.root.visible = false; return; }
    const P = prev.player, N = next.player;
    const a = prev.segIndex === next.segIndex ? alpha : 1;
    const s = lerp(P.s, N.s, a);
    const dist = Math.max(3, f.distance > 0 ? f.distance : (AHEAD_DISTANCE[clamp(Math.floor(N.steady), 0, 4)] as number));
    const sl = f.leaderS !== null ? Math.max(f.leaderS, s + 3) : s + dist;
    if (this.planSeg !== seg.index) { this.plan = this.ctx.solver.solve(seg); this.planSeg = seg.index; }
    const plan = this.plan;
    const lane = f.leaderLane ?? (plan ? plan.laneAt(sl) : 0);
    const h = Math.min(0.05, step), w = 14;
    this.xv += (w * w * (lane * LANE_WIDTH - this.x) - 2 * w * this.xv) * h; this.x += this.xv * h;
    if (sdt > 0.25 || Math.abs(this.x - lane * LANE_WIDTH) > 2.5) { this.x = lane * LANE_WIDTH; this.xv = 0; }
    // 动作：按路线里在 sl 之前最近的一步
    const cad = Math.max(0.5, N.cadence || seg.cadenceAt((sl - seg.s0) / seg.stride));
    const speed = Math.max(0.5, N.speed || cad * seg.stride);
    let air = false, airT = 0, y = 0, duckT = 0;
    if (plan) {
      let lastJump: PlanStep | null = null, duckOn = false;
      for (const st of plan.steps) {
        const ss = st.s ?? 0;
        if (ss > sl) break;
        if (st.action === 'jump') lastJump = st;
        if (st.action === 'duck') duckOn = true;
        if (st.action === 'duckRelease') duckOn = false;
      }
      if (lastJump) {
        const dur = jumpDur(cad);
        airT = (sl - (lastJump.s ?? 0)) / speed;
        if (airT >= 0 && airT < dur) { air = true; const u = airT / dur; y = 4 * 0.6 * u * (1 - u); }
      }
      duckT = duckOn || plan.actionAt(sl) === 'duck' ? 1 : 0;
    }
    this.duck = lerp(this.duck, duckT, clamp(step * 14, 0, 1));
    const I = this.I;
    I.s = sl; I.x = this.x; I.y = y; I.floorY = seg.floorY(sl); I.beat = (sl - seg.s0) / seg.stride; I.stride = seg.stride;
    I.cadence = cad; I.speed = speed; I.duck = this.duck; I.air = air; I.airT = airT; I.laneTarget = lane;
    const pose = crawlPose(I, this.b);
    this.rig.apply(pose);
    this.rig.root.visible = true;
    this.mat.opacity = this.alpha;
    // 每一掌激起一圈光
    const bi = Math.floor(I.beat);
    if (!air && Number.isFinite(this.lastBeat) && bi > this.lastBeat) this.ctx.lamps.ring(sl, this.x, 0.9 * this.alpha, 1.3);
    this.lastBeat = bi;
    Object.assign(this.state, { s: sl, x: this.x, air, duck: this.duck, distance: sl - s });
  }
}
