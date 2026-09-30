// src/render/weather/outdoor.ts —— WP4 的画面系统（order 50「weather」，DESIGN.md §5.2、§5.9、§8.4、§8.7）。
// 负责：
//   · 雨（rain.ts，1 次 draw call）与 `rain` cue（CUE_OWNER = WP4）；重来 / goto / 中途读章时按关卡数据复原雨强。
//   · 户外天空（1 次 draw call，renderOrder backdrop）：只在户外 kit（street / plaza / track）的段里、夜 / 清晨 / 梦中灰暗时画；
//     颜色 = 当前雾色 × skyGradient 纹理（地平线处与背景无缝）。晨光从前方来，正前方地平线更亮。
//   · 3-7 电子栏杆的红光扫动（1 次 draw call，只在栏杆附近可见，只在第三章 compound 变体）。
//   · 户外纹理注册（TextureBank，WP3）；驱动 WP4 各 set 的 update（CORE 占位 World 不调用 set.update）。
// 只经 ViewContext 使用 WP3 的 MaterialsAPI、TextureBank（§8.2 规则 2），不 import 其他包的内部文件。
import * as THREE from 'three';
import type { ViewContext, ViewSystem, QualityProfile } from '../../core/contracts';
import { RENDER_ORDER } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { registerCueHandler, registerViewSystem } from '../../core/registry';
import type { AtmosphereId, KitId, SimSnapshot } from '../../core/types';
import type { CompiledChapter, CompiledSegment, RunSegmentDef, StandSegmentDef } from '../../levels/schema';
import { C } from '../kits/outside/lib/colors';
import { OGeo } from '../kits/outside/lib/geo';
import { LIVE_SETS } from '../sets/outside/lib/live';
import { registerOutdoorTextures } from '../textures/outdoor';
import { RainField, RainLevel, rainAt } from './rain';

export const OUTDOOR_KITS: ReadonlySet<KitId> = new Set<KitId>(['street', 'plaza', 'track']);
export type SkyKind = 'night' | 'dawn' | 'dusk';

/** 氛围 → 天空（null = 不画天，背景色就够了：梦的发白、阴天的灰白、室内）。 */
export function skyKindFor(a: AtmosphereId): SkyKind | null {
  switch (a) {
    case 'rainNight': case 'nightIndoor': case 'busNight': case 'homeDark': case 'voidDark': return 'night';
    case 'dawn': return 'dawn';
    case 'dreamGray': return 'dusk';
    default: return null;
  }
}
/** 天空的增益：纹理在地平线处的值 × 增益 = 1（与雾色无缝）。 */
export const SKY_GAIN: Record<SkyKind, number> = { night: 1, dusk: 1, dawn: 1.25 };

/** 这一段是不是户外（跑段或站立段的 kit 属于户外）。 */
export function isOutdoorSegment(seg: CompiledSegment | undefined): boolean {
  if (!seg) return false;
  if (seg.kind === 'still') return false;
  const kit = (seg.def as RunSegmentDef | StandSegmentDef).kit;
  return OUTDOOR_KITS.has(kit);
}

/** 3-7 电子栏杆：红光扫动的锚点（只取 compound 变体；dawn 变体属于第五章，不用红色）。 */
export function sweepAnchors(ch: CompiledChapter): Array<{ seg: number; s: number }> {
  const out: Array<{ seg: number; s: number }> = [];
  for (const seg of ch.segments) {
    if (seg.kind !== 'run') continue;
    const d = seg.def as RunSegmentDef;
    if (d.kit !== 'street' || d.variant !== 'compound') continue;
    const bars = seg.obstacles.filter((o) => o.kind === 'barrierArm');
    if (bars.length) for (const b of bars) out.push({ seg: seg.index, s: b.s0 + 0.04 });
    else out.push({ seg: seg.index, s: seg.s0 + 18 * seg.stride });
  }
  return out;
}

/** 天穹：内表面朝里的半球（略低于地平线），UV：u = 方位（0.5 = 正前方 −z），v = 仰角。 */
export function createSkyGeometry(radius = 150, around = 24, up = 8): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  const P = (i: number, j: number): [number, number, number, number, number] => {
    const az = (i / around) * Math.PI * 2;
    const el = -0.08 + (j / up) * (Math.PI / 2 + 0.08);
    const x = Math.sin(az) * Math.cos(el) * radius, z = -Math.cos(az) * Math.cos(el) * radius, y = Math.sin(el) * radius;
    return [x, y, z, (i / around + 0.5) % 1.0000001, Math.max(0, el) / (Math.PI / 2)];
  };
  for (let i = 0; i < around; i++) for (let j = 0; j < up; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    // u 在接缝处取 1 而不是 0
    if (i + 1 === around) { b[3] = 1; c[3] = 1; }
    // 从里面看逆时针：a → d → c，a → c → b
    for (const q of [a, d, c, a, c, b]) { pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  return g;
}

export class Outdoor implements ViewSystem {
  readonly id = 'wp4.outdoor';
  readonly owner = 'WP4' as const;
  readonly order = 50;
  ctx!: ViewContext;
  chapter: CompiledChapter | null = null;
  rain!: RainField;
  readonly level = new RainLevel();
  sky!: THREE.Mesh;
  skyMat!: THREE.MeshBasicMaterial;
  sweep!: THREE.Mesh;
  private sweepMat!: THREE.MeshBasicMaterial;
  private anchors: Array<{ seg: number; s: number }> = [];
  private segIndex = -1;
  outdoorNow = false;
  skyKind: SkyKind | null = null;
  private skyTex = new Map<SkyKind, THREE.Texture>();
  /** 预览（weather/preview.ts）接管时设置：强制户外、天空种类、栏杆锚点与 x 偏移。 */
  preview: { sky: SkyKind | null; sweepS: number | null; offsetX: number; t: number } | null = null;
  private lastT = 0;

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    registerOutdoorTextures(ctx.tex);
    // 雨
    this.rain = new RainField(ctx.quality.rainLines);
    ctx.scene.add(this.rain.object);
    // 天
    this.skyMat = ctx.mat.basic({ color: 0xffffff });
    this.skyMat.fog = false;
    this.skyMat.depthWrite = false;
    this.skyMat.toneMapped = false;
    this.sky = new THREE.Mesh(createSkyGeometry(), this.skyMat);
    this.sky.name = 'wp4.sky';
    this.sky.renderOrder = RENDER_ORDER.backdrop;
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    ctx.scene.add(this.sky);
    // 栏杆红光：贴地一道细光 + 齐腰高的一道细线（「在我身上扫了一下，像一道浅浅的伤口」），一起前后扫
    const g = new OGeo();
    g.flat(0.006, -2.3, 2.3, 0.025, -0.025, C.barrierRed);
    g.flat(0.006, -2.3, 2.3, 0.09, 0.025, 0x3a100e);
    g.flat(0.006, -2.3, 2.3, -0.025, -0.09, 0x3a100e);
    for (const f of [1, -1] as const) {
      g.wallZ(0, -2.3, 2.3, 0.44, 0.46, C.barrierRed, f);
      g.wallZ(0, -2.3, 2.3, 0.41, 0.44, 0x3a100e, f);
      g.wallZ(0, -2.3, 2.3, 0.46, 0.49, 0x3a100e, f);
    }
    const geo = g.build();
    this.sweepMat = ctx.mat.basic({ color: 0xffffff, additive: true, transparent: true, opacity: 0.7 });
    this.sweepMat.vertexColors = true;
    this.sweepMat.depthWrite = false;
    this.sweep = new THREE.Mesh(geo, this.sweepMat);
    this.sweep.name = 'wp4.barrierSweep';
    this.sweep.renderOrder = RENDER_ORDER.fx;
    this.sweep.visible = false;
    ctx.scene.add(this.sweep);
  }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    this.chapter = ch;
    this.anchors = sweepAnchors(ch);
    registerOutdoorTextures(this.ctx.tex);
    // 读章时把本章用得到的天空纹理生成好（游戏过程中不建纹理）
    for (const seg of ch.segments) {
      if (!isOutdoorSegment(seg)) continue;
      const k = skyKindFor(seg.def.atmosphere);
      if (k) this.skyTexture(k);
    }
    for (const l of LIVE_SETS.values()) l.prune();
  }

  skyTexture(k: SkyKind): THREE.Texture {
    let t = this.skyTex.get(k);
    if (!t) { t = this.ctx.tex.get('skyGradient', { kind: k }); this.skyTex.set(k, t); }
    return t;
  }

  onSegment(seg: CompiledSegment): void {
    this.segIndex = seg.index;
    this.outdoorNow = isOutdoorSegment(seg);
    this.setSky(this.outdoorNow ? skyKindFor(seg.def.atmosphere) : null);
  }

  private setSky(k: SkyKind | null): void {
    this.skyKind = k;
    if (k) {
      const t = this.skyTexture(k);
      if (this.skyMat.map !== t) { this.skyMat.map = t; this.skyMat.needsUpdate = true; }
    }
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    if (e.type === 'chapter:start') this.level.snap(rainAt(this.chapter, snap.segIndex, snap.segBeat));
  }

  onReset(snap: SimSnapshot): void {
    // 跳过的 cue 不会再发：按关卡数据复原到这一处的雨强
    this.level.snap(rainAt(this.chapter, snap.segIndex, snap.segBeat));
    const seg = this.chapter?.segments[snap.segIndex];
    if (seg) this.onSegment(seg);
  }

  /** rain cue：intensity 在 seconds 秒内渐变（§4.3 3-3 @52：4 s 内 0 → 0.6）。 */
  onRainCue(intensity: number, seconds: number, t: number): void { this.level.cue(intensity, seconds, t); }

  frame(_prev: SimSnapshot, next: SimSnapshot, _alpha: number, _dt: number): void {
    const cam = this.ctx.camera;
    const fog = this.ctx.scene.fog instanceof THREE.Fog ? this.ctx.scene.fog : null;
    const pv = this.preview;
    const t = pv ? pv.t : next.t;
    this.lastT = t;
    const outdoor = pv ? true : this.outdoorNow && next.segKind !== 'still';
    // 雨
    const lvl = outdoor ? this.level.at(t) : 0;
    this.rain.update(lvl, t, cam, fog);
    // 天
    const kind = pv ? pv.sky : this.skyKind;
    if (pv && kind) this.setSky(kind);
    this.sky.visible = outdoor && kind !== null && !!this.skyMat.map;
    if (this.sky.visible && kind) {
      this.sky.position.copy(cam.position);
      if (fog) this.skyMat.color.copy(fog.color).multiplyScalar(SKY_GAIN[kind]);
    }
    // 栏杆红光
    let sweepS: number | null = null;
    if (pv) sweepS = pv.sweepS;
    else if (next.segKind === 'run') {
      for (const a of this.anchors) if (a.seg === next.segIndex && Math.abs(a.s - next.player.s) < 24) { sweepS = a.s; break; }
    }
    this.sweep.visible = sweepS !== null;
    if (sweepS !== null) {
      const ph = Math.sin((t / 2.2) * Math.PI * 2);
      this.sweep.position.set(pv ? pv.offsetX : 0, (this.chapter?.segments[next.segIndex]?.floorY(sweepS) ?? 0), -(sweepS + 1.1 * ph));
      this.sweepMat.opacity = 0.55 + 0.25 * Math.abs(ph);
    }
    // WP4 的 set：动画（t 与快照的纯函数）
    const st = next.still;
    if (!pv && st && next.segKind === 'still') LIVE_SETS.get(st.set)?.update(st.t, next, st.variant);
  }

  setQuality(q: QualityProfile): void { this.rain.setLines(q.rainLines); }

  get time(): number { return this.lastT; }
}

export const outdoor = new Outdoor();
registerViewSystem(outdoor);
registerCueHandler('rain', 'WP4', (b, c) => outdoor.onRainCue(b.intensity, b.seconds, c.snap.t));
