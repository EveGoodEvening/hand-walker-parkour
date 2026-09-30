// src/render/ChunkStreamer.ts —— 世界：chunk 预建与流式显示、静场 set、氛围与灯光（DESIGN.md §5.2、§5.9、§8.3）。
// CORE 写的占位版本，归 WP3（WP3 会换成「每个 kit 变体预建 4 个通用变体」的对象池版本）。
// 规则：读章（开场卡期间）时建好全部几何体；游戏过程中不创建任何几何体或纹理，只切换可见性。
// 静场：隐藏全部 chunk，显示对应 set（放在 STILL_ORIGIN）。
import * as THREE from 'three';
import type { KitChunk, ViewContext, ViewSystem } from '../core/contracts';
import { CHUNK_LEN, RENDER_ORDER, STILL_ORIGIN } from '../core/constants';
import type { GameEvent } from '../core/events';
import { FALLBACK_ATMOSPHERES } from '../core/fallbacks';
import { lerp } from '../core/math';
import { getAtmosphere, getKit, getSet, type AtmospherePreset } from '../core/registry';
import { createRng } from '../core/rng';
import type { AtmosphereId, SimSnapshot } from '../core/types';
import type { CompiledChapter, CompiledSegment, RunSegmentDef, StillSegmentDef } from '../levels/schema';

interface Chunk { s0: number; s1: number; seg: number; group: THREE.Group; geos: THREE.BufferGeometry[] }
interface AtmoState { fog: THREE.Color; near: number; far: number; sky: THREE.Color; ground: THREE.Color; hemi: number; dirColor: THREE.Color; dir: number; dirVec: THREE.Vector3; bg: THREE.Color }
interface LightOp { op: 'flicker' | 'out' | 'on' | 'sound' | 'palmRings'; s0: number; s1: number; every: number; t0: number }

function presetOf(id: AtmosphereId): AtmospherePreset { return getAtmosphere(id) ?? FALLBACK_ATMOSPHERES[id]; }

function stateOf(p: AtmospherePreset, fogMul: number): AtmoState {
  return {
    fog: new THREE.Color(p.fog.color), near: p.fog.near, far: Math.max(p.fog.near + 1, p.fog.far * fogMul),
    sky: new THREE.Color(p.hemi.sky), ground: new THREE.Color(p.hemi.ground), hemi: p.hemi.intensity,
    dirColor: new THREE.Color(p.dir?.color ?? 0xffffff), dir: p.dir?.intensity ?? 0,
    dirVec: new THREE.Vector3(...(p.dir?.dir ?? [0.3, -1, -0.55])).normalize(), bg: new THREE.Color(p.background),
  };
}

export class World implements ViewSystem {
  readonly id = 'world';
  readonly owner = 'WP3' as const;
  readonly order = 10;
  private ctx!: ViewContext;
  private chunks: Chunk[] = [];
  private sets = new Map<number, THREE.Object3D>();
  private chapter: CompiledChapter | null = null;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private dir = new THREE.DirectionalLight(0xffffff, 1);
  private fog = new THREE.Fog(0xaab4b8, 10, 48);
  private matFloor!: THREE.MeshLambertMaterial;
  private matStatic!: THREE.MeshLambertMaterial;
  private matEmissive!: THREE.MeshBasicMaterial;
  private cur!: AtmoState;
  private from!: AtmoState;
  private to!: AtmoState;
  private atmoT = 1;
  private atmoDur = 1.5;
  private ops: LightOp[] = [];
  private segIndex = 0;
  private lampK = 1;

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    ctx.scene.fog = this.fog;
    ctx.scene.add(this.hemi, this.dir);
    this.matFloor = ctx.mat.lambert({ vertexColors: true, flat: true });
    this.matFloor.depthWrite = false;          // §5.8：地面不写深度（水洼模板门户用）
    this.matStatic = ctx.mat.lambert({ vertexColors: true, flat: true });
    this.matEmissive = ctx.mat.basic({ color: 0xffffff });
    this.matEmissive.vertexColors = true;
    const st = stateOf(presetOf('morning'), ctx.quality.fogMul);
    this.cur = st; this.from = stateOf(presetOf('morning'), ctx.quality.fogMul); this.to = stateOf(presetOf('morning'), ctx.quality.fogMul);
    this.apply(st);
  }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    // 读章：释放上一章的几何体，按数据建好本章全部 chunk 与 set
    for (const c of this.chunks) { this.ctx.scene.remove(c.group); for (const g of c.geos) g.dispose(); }
    for (const [, o] of this.sets) this.ctx.scene.remove(o);
    this.chunks = []; this.sets.clear(); this.ops = [];
    this.chapter = ch;
    for (const seg of ch.segments) {
      if (seg.kind === 'run') this.buildSegment(ch, seg);
      else if (seg.kind === 'still') {
        const d = seg.def as StillSegmentDef;
        const set = getSet(d.set);
        if (!set) continue;
        const obj = set.build(this.ctx, d.variant ?? set.variants[0] ?? 'default');
        obj.position.set(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
        obj.visible = false;
        this.ctx.scene.add(obj);
        this.sets.set(seg.index, obj);
      }
    }
    const first = ch.segments[0];
    if (first) this.snapAtmosphere(first.def.atmosphere);
  }

  private buildSegment(ch: CompiledChapter, seg: CompiledSegment): void {
    const def = seg.def as RunSegmentDef;
    const kit = getKit(def.kit);
    if (!kit) return;
    const n = Math.max(1, Math.ceil((seg.s1 - seg.s0) / CHUNK_LEN - 1e-6));
    for (let i = 0; i < n; i++) {
      const s0 = seg.s0 + i * CHUNK_LEN;
      const s1 = Math.min(seg.s1, s0 + CHUNK_LEN);
      if (s1 - s0 < 0.05) continue;
      const rng = createRng(ch.seed, `chunk:${def.id}:${i}`);
      const kc: KitChunk = kit.build({
        seg, variant: def.variant, s0, s1, stride: seg.stride, floorY: (s) => seg.floorY(s) - seg.floorY(s0),
        openings: this.ctx.surfaces.openingsIn(s0, s1), quality: this.ctx.quality, rng, mat: this.ctx.mat, tex: this.ctx.tex,
      });
      const group = new THREE.Group();
      group.position.set(0, seg.floorY(s0), -s0);
      const floor = new THREE.Mesh(kc.floor, this.matFloor);
      floor.renderOrder = RENDER_ORDER.floor;
      group.add(floor);
      group.add(new THREE.Mesh(kc.static, this.matStatic));
      const geos = [kc.floor, kc.static];
      if (kc.emissive) { group.add(new THREE.Mesh(kc.emissive, this.matEmissive)); geos.push(kc.emissive); }
      for (const m of group.children) (m as THREE.Mesh).matrixAutoUpdate = false;
      group.visible = false;
      this.ctx.scene.add(group);
      this.ctx.lamps.addLamps(`chunk:${def.id}:${i}`, kc.lamps);
      this.chunks.push({ s0, s1, seg: seg.index, group, geos });
    }
  }

  onSegment(seg: CompiledSegment): void {
    this.segIndex = seg.index;
    this.transitionTo(seg.def.atmosphere, 1.5);
  }

  onEvent(e: GameEvent, _snap: SimSnapshot): void {
    if (e.type === 'retry' || e.type === 'chapter:start') this.ops = [];
  }

  onReset(snap: SimSnapshot): void {
    const seg = this.chapter?.segments[snap.segIndex];
    if (seg) this.snapAtmosphere(seg.def.atmosphere);
    this.ops = [];
  }

  /** atmosphere cue（WP3 处理者由 render/index.ts 注册）。 */
  transitionTo(id: AtmosphereId, seconds: number): void {
    this.from = { ...this.cur, fog: this.cur.fog.clone(), sky: this.cur.sky.clone(), ground: this.cur.ground.clone(), dirColor: this.cur.dirColor.clone(), dirVec: this.cur.dirVec.clone(), bg: this.cur.bg.clone() };
    this.to = stateOf(presetOf(id), this.ctx.quality.fogMul);
    this.atmoT = 0;
    this.atmoDur = Math.max(0.001, seconds);
  }
  snapAtmosphere(id: AtmosphereId): void {
    this.to = stateOf(presetOf(id), this.ctx.quality.fogMul);
    this.from = this.to;
    this.cur = stateOf(presetOf(id), this.ctx.quality.fogMul);
    this.atmoT = 1;
    this.apply(this.cur);
  }
  fogOverride(near: number, far: number, seconds: number): void {
    this.from = { ...this.cur, fog: this.cur.fog.clone(), sky: this.cur.sky.clone(), ground: this.cur.ground.clone(), dirColor: this.cur.dirColor.clone(), dirVec: this.cur.dirVec.clone(), bg: this.cur.bg.clone() };
    this.to = { ...this.to, near, far: far * this.ctx.quality.fogMul };
    this.atmoT = 0; this.atmoDur = Math.max(0.001, seconds);
  }
  /** lights cue：from / to 是段内拍号。 */
  lightsOp(op: LightOp['op'], seg: CompiledSegment, from: number | undefined, to: number | undefined, every: number | undefined, t: number): void {
    const s0 = seg.s0 + (from ?? 0) * seg.stride;
    const s1 = seg.s0 + (to ?? ((seg.s1 - seg.s0) / seg.stride)) * seg.stride;
    this.ops.push({ op, s0, s1, every: every ?? 1, t0: t });
    this.ctx.lamps.op(op, s0, s1, { every: every ?? 1 });
  }

  private apply(a: AtmoState): void {
    this.fog.color.copy(a.fog); this.fog.near = a.near; this.fog.far = a.far;
    this.ctx.scene.background = a.bg;
    this.hemi.color.copy(a.sky); this.hemi.groundColor.copy(a.ground); this.hemi.intensity = a.hemi * this.lampK;
    this.dir.color.copy(a.dirColor); this.dir.intensity = a.dir * this.lampK;
    this.dir.position.copy(a.dirVec).multiplyScalar(-10);
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    // 氛围插值
    if (this.atmoT < 1) {
      this.atmoT = Math.min(1, this.atmoT + dt / this.atmoDur);
      const k = this.atmoT, f = this.from, t = this.to, c = this.cur;
      c.fog.copy(f.fog).lerp(t.fog, k); c.near = lerp(f.near, t.near, k); c.far = lerp(f.far, t.far, k);
      c.sky.copy(f.sky).lerp(t.sky, k); c.ground.copy(f.ground).lerp(t.ground, k); c.hemi = lerp(f.hemi, t.hemi, k);
      c.dirColor.copy(f.dirColor).lerp(t.dirColor, k); c.dir = lerp(f.dir, t.dir, k); c.dirVec.copy(f.dirVec).lerp(t.dirVec, k).normalize();
      c.bg.copy(f.bg).lerp(t.bg, k);
    }
    const s = lerp(prev.player.s, next.player.s, alpha);
    // 灯光操作：闪烁 ≤ 3 Hz；「减少闪烁」时改为 0.5 Hz 平滑明暗（最低 0.4）
    let k = 1;
    for (const op of this.ops) {
      if (s < op.s0 - 2 || s > op.s1 + 6) continue;
      if (op.op === 'flicker') {
        if (this.ctx.settings.reducedFlicker) k = Math.min(k, 0.7 + 0.3 * Math.cos(next.t * Math.PI));
        else { const ph = (next.t * 2.5) % 1; k = Math.min(k, ph < 0.16 ? 0.25 : ph < 0.22 ? 0.7 : 1); }
      } else if (op.op === 'out') k = Math.min(k, 0.3);
    }
    this.lampK = k;
    this.matEmissive.color.setScalar(k);
    this.apply(this.cur);
    // chunk 可见性：身后 1 个，前方 chunksAhead 个
    const still = next.segKind !== 'run';
    const ahead = this.ctx.quality.chunksAhead * CHUNK_LEN;
    for (const c of this.chunks) c.group.visible = !still && c.s1 > s - CHUNK_LEN && c.s0 < s + ahead;
    for (const [i, o] of this.sets) o.visible = still && i === next.segIndex;
  }

  setQuality(): void { this.snapAtmosphereKeep(); }
  private snapAtmosphereKeep(): void {
    const seg = this.chapter?.segments[this.segIndex];
    if (seg) this.transitionTo(seg.def.atmosphere, 0.01);
  }
}

/** 世界系统单例（render/index.ts 注册，cue 处理器也通过它工作）。 */
export const world = new World();
