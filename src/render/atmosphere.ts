// src/render/atmosphere.ts —— 13 个氛围预设与插值（DESIGN.md §5.2，WP3）。
// 每个预设只有 1 个 HemisphereLight 和最多 1 个不投影的 DirectionalLight；雾一律线性 THREE.Fog。
// 低画质雾远距离 ×0.8（QualityProfile.fogMul），但不小于 R4 的要求（见 MIN_FAR）。
// 预设之间用 atmosphere 事件在 N 秒内插值颜色、强度、雾距与 LampField 参数，默认 1.5 s。
import * as THREE from 'three';
import { registerAtmosphere, type AtmospherePreset } from '../core/registry';
import type { AtmosphereId } from '../core/types';
import { lerp } from '../core/math';

type V3 = [number, number, number];
const DEFAULT_PLANAR: V3 = [0.3, -1, -0.55];
/** 夜色半球光（§5.2 表里只给了强度的几行沿用 nightIndoor 的天 / 地色）。 */
const NIGHT_SKY = 0x3a4650, NIGHT_GROUND = 0x0b0f12;
/** 平行光没写颜色的几行沿用 morning 的 #E9EEF0。 */
const DIR_WHITE = 0xe9eef0;

function P(fog: [number, number, number], hemi: [number, number, number], dir: { color: number; intensity: number; dir: V3 } | null,
  planarDir: V3, lampGain: number, chalkMin: number, dark: boolean, lampColor = 0xeef6ff): AtmospherePreset {
  return {
    fog: { color: fog[0], near: fog[1], far: fog[2] }, hemi: { sky: hemi[0], ground: hemi[1], intensity: hemi[2] },
    dir, planarDir, lampGain, lampColor, chalkMin, dark, background: fog[0],
  };
}

/** §5.2 表，逐行照抄。planarDir 是平面影子的投射方向（光线行进方向）；dir.dir 同样是光线行进方向。 */
export const ATMOSPHERES: Record<AtmosphereId, AtmospherePreset> = {
  morning:     P([0xaab4b8, 10, 48], [0xdfe7ea, 0x5d6566, 1.2], { color: 0xe9eef0, intensity: 1.6, dir: [0.3, -1, -0.55] }, [0.3, -1, -0.55], 0.6, 0, false),
  noon:        P([0xb5bcbc, 12, 50], [0xe4e8e6, 0x6a706c, 1.3], { color: DIR_WHITE, intensity: 1.4, dir: [0.15, -1, -0.3] }, [0.15, -1, -0.3], 0.4, 0, false),
  labNorth:    P([0x8e9ca3, 8, 38], [0x9fb0b8, 0x4b5559, 1.0], { color: 0xc9d6de, intensity: 0.6, dir: [0.3, -1, -0.55] }, [0.3, -1, -0.55], 0.8, 0, false),
  nightIndoor: P([0x0f151a, 6, 30], [NIGHT_SKY, NIGHT_GROUND, 0.35], { color: 0x9fb2c0, intensity: 0.15, dir: [0.3, -1, -0.55] }, [0.3, -1, -0.55], 1.4, 0.35, true),
  rainNight:   P([0x0e1419, 4, 26], [NIGHT_SKY, NIGHT_GROUND, 0.25], null, [0.2, -1, -0.4], 1.2, 0.35, true, 0xc8a15a),
  busNight:    P([0x0b1014, 3, 14], [NIGHT_SKY, NIGHT_GROUND, 0.2], null, DEFAULT_PLANAR, 0.8, 0, true),
  homeDark:    P([0x0b1014, 3, 14], [NIGHT_SKY, NIGHT_GROUND, 0.15], null, DEFAULT_PLANAR, 0.5, 0, true),
  // 从身后低角度照来：光线朝前（−z）行进，影子长长地铺在前方
  dream:       P([0xd9dee0, 20, 120], [0xf0f3f4, 0x9aa3a6, 1.8], { color: 0xf0f3f4, intensity: 1.2, dir: [0.1, -0.35, -0.9] }, [0.1, -0.35, -0.9], 0, 0, false),
  // 起点值：雾色 #D9DEE0、far 60、半球 1.6；「→ #5D6468、far 28、0.9」由关卡的 fog / atmosphere cue 推进（见 DREAM_GRAY_END）
  dreamGray:   P([0xd9dee0, 20, 60], [0xf0f3f4, 0x9aa3a6, 1.6], { color: 0xe4e8ea, intensity: 0.8, dir: [0.1, -0.35, -0.9] }, [0.1, -0.35, -0.9], 0, 0.2, false),
  // 从前方低角度照来：影子向后落在镜头和你之间
  dawn:        P([0x7f909a, 8, 45], [0x9fb2c0, 0x2a3035, 0.8], { color: 0xc9d6de, intensity: 1.0, dir: [0.1, -0.6, 0.8] }, [0.1, -0.6, 0.8], 0.3, 0, false),
  overcast:    P([0xc3c8cb, 15, 70], [0xc3c8cb, 0x6e7476, 1.5], null, DEFAULT_PLANAR, 0.4, 0, false),
  fluorescent: P([0xdde4e6, 6, 25], [0xeef3f5, 0x8a9396, 1.4], null, DEFAULT_PLANAR, 0.6, 0, false),
  voidDark:    P([0x07090b, 4, 18], [NIGHT_SKY, 0x07090b, 0.05], null, DEFAULT_PLANAR, 1.6, 0.4, true),
};

/** dreamGray 的终点（§5.2：雾色 → #5D6468，far 60 → 28，半球 1.6 → 0.9）。 */
export const DREAM_GRAY_END = { fog: 0x5d6468, far: 28, hemi: 0.9 } as const;

/**
 * 预设之外的 LampField 参数（AtmospherePreset 冻结，额外的放这里）。
 * lampFloor：LampField 的最低亮度。暗色预设 ≥ 0.15（R12）；voidDark「底亮度 0.15，另加掌光」。
 */
export const ATMO_EXTRA: Record<AtmosphereId, { lampFloor: number }> = {
  morning: { lampFloor: 0 }, noon: { lampFloor: 0 }, labNorth: { lampFloor: 0 },
  nightIndoor: { lampFloor: 0.15 }, rainNight: { lampFloor: 0.15 }, busNight: { lampFloor: 0.15 }, homeDark: { lampFloor: 0.15 },
  dream: { lampFloor: 0 }, dreamGray: { lampFloor: 0 }, dawn: { lampFloor: 0 }, overcast: { lampFloor: 0 },
  fluorescent: { lampFloor: 0 }, voidDark: { lampFloor: 0.15 },
};

/** R4：可读距离至少 1.2 s × 最快现实速度 6.4 m/s ≈ 7.7 m；低画质缩雾时 far 不低于 near + 这个值再留余量。 */
export const MIN_FAR_OVER_NEAR = 9;

export function registerAtmospheres(): void {
  for (const id of Object.keys(ATMOSPHERES) as AtmosphereId[]) registerAtmosphere(id, ATMOSPHERES[id]);
}

/** 当前生效的氛围状态（线性空间的 THREE.Color）。 */
export interface AtmoState {
  fog: THREE.Color; near: number; far: number;
  sky: THREE.Color; ground: THREE.Color; hemi: number;
  dirColor: THREE.Color; dir: number; dirVec: THREE.Vector3;
  bg: THREE.Color;
  lampGain: number; lampColor: THREE.Color; chalkMin: number; lampFloor: number; dark: boolean;
}

export function newState(): AtmoState {
  return {
    fog: new THREE.Color(), near: 10, far: 48, sky: new THREE.Color(), ground: new THREE.Color(), hemi: 1,
    dirColor: new THREE.Color(), dir: 0, dirVec: new THREE.Vector3(0.3, -1, -0.55).normalize(), bg: new THREE.Color(),
    lampGain: 0.6, lampColor: new THREE.Color(0xeef6ff), chalkMin: 0, lampFloor: 0, dark: false,
  };
}

/** 预设 → 状态（写入 out，不分配）。fogMul 只作用于远距离，且不低于 near + MIN_FAR_OVER_NEAR。 */
export function presetToState(id: AtmosphereId, p: AtmospherePreset, fogMul: number, out: AtmoState): AtmoState {
  out.fog.setHex(p.fog.color); out.near = p.fog.near;
  out.far = Math.max(p.fog.near + MIN_FAR_OVER_NEAR, p.fog.far * fogMul);
  out.sky.setHex(p.hemi.sky); out.ground.setHex(p.hemi.ground); out.hemi = p.hemi.intensity;
  out.dirColor.setHex(p.dir?.color ?? DIR_WHITE); out.dir = p.dir?.intensity ?? 0;
  const d = p.dir?.dir ?? p.planarDir;
  out.dirVec.set(d[0], d[1], d[2]).normalize();
  out.bg.setHex(p.background);
  out.lampGain = p.lampGain; out.lampColor.setHex(p.lampColor); out.chalkMin = p.chalkMin;
  out.lampFloor = ATMO_EXTRA[id]?.lampFloor ?? 0; out.dark = p.dark;
  return out;
}

export function copyState(src: AtmoState, out: AtmoState): AtmoState {
  out.fog.copy(src.fog); out.near = src.near; out.far = src.far;
  out.sky.copy(src.sky); out.ground.copy(src.ground); out.hemi = src.hemi;
  out.dirColor.copy(src.dirColor); out.dir = src.dir; out.dirVec.copy(src.dirVec);
  out.bg.copy(src.bg);
  out.lampGain = src.lampGain; out.lampColor.copy(src.lampColor); out.chalkMin = src.chalkMin; out.lampFloor = src.lampFloor; out.dark = src.dark;
  return out;
}

export function mixState(a: AtmoState, b: AtmoState, k: number, out: AtmoState): AtmoState {
  out.fog.copy(a.fog).lerp(b.fog, k); out.near = lerp(a.near, b.near, k); out.far = lerp(a.far, b.far, k);
  out.sky.copy(a.sky).lerp(b.sky, k); out.ground.copy(a.ground).lerp(b.ground, k); out.hemi = lerp(a.hemi, b.hemi, k);
  out.dirColor.copy(a.dirColor).lerp(b.dirColor, k); out.dir = lerp(a.dir, b.dir, k);
  out.dirVec.copy(a.dirVec).lerp(b.dirVec, k);
  if (out.dirVec.lengthSq() < 1e-6) out.dirVec.copy(b.dirVec);
  out.dirVec.normalize();
  out.bg.copy(a.bg).lerp(b.bg, k);
  out.lampGain = lerp(a.lampGain, b.lampGain, k); out.lampColor.copy(a.lampColor).lerp(b.lampColor, k);
  out.chalkMin = lerp(a.chalkMin, b.chalkMin, k); out.lampFloor = lerp(a.lampFloor, b.lampFloor, k);
  out.dark = k < 0.5 ? a.dark : b.dark;
  return out;
}

/**
 * 氛围插值器：持有 1 个半球光、1 个平行光和线性雾，按秒插值（时间用模拟时钟，test 模式下截图可复现）。
 * 所有状态对象在构造时分配，运行时不分配。
 */
export class AtmosphereMixer {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly dirLight = new THREE.DirectionalLight(0xffffff, 1);
  readonly fog = new THREE.Fog(0xaab4b8, 10, 48);
  readonly cur = newState();
  private readonly from = newState();
  private readonly to = newState();
  private readonly tmp = newState();
  private t0 = 0;
  private dur = 0;
  private active = false;
  /** 当前目标预设 id（fog cue 只改雾距，不改 id）。 */
  id: AtmosphereId = 'morning';
  fogMul = 1;

  constructor(private readonly getPreset: (id: AtmosphereId) => AtmospherePreset) {
    this.hemi.name = 'hw:hemi';
    this.dirLight.name = 'hw:dir';
    this.dirLight.castShadow = false;
  }

  attach(scene: THREE.Scene): void {
    scene.fog = this.fog;
    scene.add(this.hemi, this.dirLight, this.dirLight.target);
    scene.background = this.cur.bg;
  }

  /** 立即切到预设（读章、重来）。 */
  snap(id: AtmosphereId): void {
    this.id = id;
    presetToState(id, this.getPreset(id), this.fogMul, this.cur);
    copyState(this.cur, this.to);
    this.active = false;
  }

  /** 在 seconds 秒内过渡到预设；now 为当前模拟时钟秒。 */
  transition(id: AtmosphereId, seconds: number, now: number): void {
    this.id = id;
    copyState(this.cur, this.from);
    presetToState(id, this.getPreset(id), this.fogMul, this.to);
    this.begin(seconds, now);
  }

  /** fog cue：只改雾的 near / far（far 乘 fogMul）。 */
  fogTo(near: number, far: number, seconds: number, now: number): void {
    copyState(this.cur, this.from);
    copyState(this.cur, this.to);
    this.to.near = near;
    this.to.far = Math.max(near + MIN_FAR_OVER_NEAR * 0.5, far * this.fogMul);
    this.begin(seconds, now);
  }

  private begin(seconds: number, now: number): void {
    if (seconds <= 1e-3) { copyState(this.to, this.cur); this.active = false; return; }
    this.t0 = now; this.dur = seconds; this.active = true;
  }

  get transitioning(): boolean { return this.active; }

  /** 推进插值并把状态写进灯光与雾。 */
  update(now: number): void {
    if (this.active) {
      const k = this.dur > 0 ? (now - this.t0) / this.dur : 1;
      if (k >= 1) { copyState(this.to, this.cur); this.active = false; }
      else if (k > 0) {
        const e = k * k * (3 - 2 * k);
        mixState(this.from, this.to, e, this.tmp);
        copyState(this.tmp, this.cur);
      }
    }
    this.apply();
  }

  apply(): void {
    const c = this.cur;
    this.fog.color.copy(c.fog); this.fog.near = c.near; this.fog.far = c.far;
    this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.ground); this.hemi.intensity = c.hemi;
    // 光源数量保持不变（切换 visible 会让所有材质重编译），没有平行光时只把强度设为 0
    this.dirLight.color.copy(c.dirColor); this.dirLight.intensity = c.dir;
  }

  /** 平行光跟随焦点（方向只由 position − target 决定）。 */
  follow(x: number, y: number, z: number): void {
    const d = this.cur.dirVec;
    this.dirLight.target.position.set(x, y, z);
    this.dirLight.position.set(x - d.x * 20, y - d.y * 20, z - d.z * 20);
    this.dirLight.target.updateMatrixWorld();
  }
}
