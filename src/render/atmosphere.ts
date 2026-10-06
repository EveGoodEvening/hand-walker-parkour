// src/render/atmosphere.ts —— 13 个氛围预设与插值（DESIGN.md §5.2，WP3）。
// 每个预设只有 1 个 HemisphereLight 和最多 1 个不投影的 DirectionalLight；雾一律线性 THREE.Fog。
// 低画质雾远距离 ×0.8（QualityProfile.fogMul），但不小于 R4 的要求（见 MIN_FAR）。
// 预设之间用 atmosphere 事件在 N 秒内插值颜色、强度、雾距与 LampField 参数，默认 1.5 s。
// 状态里同时存「未乘 fogMul 的 far」（farRaw）：游戏中切画质时只重算 far，进行中的过渡和 fog cue 的覆盖都保留。
// dreamGray 是一段渐变（§5.2「#D9DEE0 → #5D6468；far 60 → 28；1.6 → 0.9」）：fog cue 把 far 往 28 收时，
// 雾色、背景和半球光强度按 far 的进度 k 一起变（见 ATMO_RAMPS）。
import * as THREE from 'three';
import { registerAtmosphere, type AtmospherePreset } from '../core/registry';
import type { AtmosphereId } from '../core/types';
import { lerp } from '../core/math';

type V3 = [number, number, number];
const DEFAULT_PLANAR: V3 = [0.3, -1, -0.55];
/** 夜色半球光（§5.2 表里只给了强度的几行沿用 nightIndoor 的天 / 地色）。 */
const NIGHT_SKY = 0x3a4650, NIGHT_GROUND = 0x0b0f12;
/** 平行光没写颜色的几行（noon、labNorth、nightIndoor、overcast 以外有平行光的）沿用 morning 的 #E9EEF0。 */
const DIR_WHITE = 0xe9eef0;
/** 雨夜照到人和物体的灯色、逆光色（冷灰蓝，U6）。 */
export const RAIN_LAMP = 0x8fa0ac;

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
  labNorth:    P([0x8e9ca3, 8, 38], [0x9fb0b8, 0x4b5559, 1.0], { color: DIR_WHITE, intensity: 0.6, dir: [0.3, -1, -0.55] }, [0.3, -1, -0.55], 0.8, 0, false),
  nightIndoor: P([0x0f151a, 6, 30], [NIGHT_SKY, NIGHT_GROUND, 0.35], { color: DIR_WHITE, intensity: 0.15, dir: [0.3, -1, -0.55] }, [0.3, -1, -0.55], 1.4, 0.35, true),
  // U6 修订（建议 §10.3）：LampField 照到人和物体的颜色改为冷色 RAIN_LAMP；路灯碎金 #C8A15A 只用于地面光池贴花（ATMO_EXTRA.poolColor）
  // 与水洼里的倒影（WP4 kit 的发光体）。半球光 0.25 → 0.45，另加一盏 0.2 的冷色逆光：从前方高处照向镜头，
  // 顶面和朝前的面受光、朝镜头的面不受光，剪影上沿镶一道冷边。平面影子方向仍按 planarDir（WP5 读预设）。
  // 以前整个画面（主角、障碍）都被路灯色染成赭黄：躯干色相 46–49°，3-3 到 3-7 的亮度中位 0.008–0.07。
  // 灯的增益 1.2 → 2.3（U6 r2）：冷灯色本身比碎金暗 12%，而且三个通道都有，NeutralToneMapping 的 toe 按最小通道减，
  // 暗色地面、墙在冷灯下比在碎金下少一半左右的亮度（3-4 车棚、3-6、3-7 的整帧亮度中位比改动前低 20–35%）。
  // 2.3 让 3-3 到 3-7 的街道材质在任何灯光电平下都不比改动前暗（tests/unit/render/rainNight.test.ts 逐个材质比）。
  rainNight:   P([0x0e1419, 4, 26], [NIGHT_SKY, NIGHT_GROUND, 0.45], { color: RAIN_LAMP, intensity: 0.2, dir: [0.15, -0.65, 0.75] }, [0.2, -1, -0.4], 2.3, 0.35, true, RAIN_LAMP),
  // §5.2 表里 busNight、homeDark 没有标 dark（描边最低亮度 0）；LampField 的底亮度仍按暗场景给 0.15（ATMO_EXTRA）
  busNight:    P([0x0b1014, 3, 14], [NIGHT_SKY, NIGHT_GROUND, 0.2], null, DEFAULT_PLANAR, 0.8, 0, false),
  homeDark:    P([0x0b1014, 3, 14], [NIGHT_SKY, NIGHT_GROUND, 0.15], null, DEFAULT_PLANAR, 0.5, 0, false),
  // 从身后低角度照来：光线朝前（−z）行进，影子长长地铺在前方
  dream:       P([0xd9dee0, 20, 120], [0xf0f3f4, 0x9aa3a6, 1.8], { color: 0xf0f3f4, intensity: 1.2, dir: [0.1, -0.35, -0.9] }, [0.1, -0.35, -0.9], 0, 0, false),
  // 起点值：雾色 #D9DEE0、far 60、半球 1.6；fog cue 把 far 往 28 收时，雾色、背景、半球光沿 ATMO_RAMPS.dreamGray 一起变深
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
 * 随雾距渐变的预设：far（未乘 fogMul）从预设值收到 far1 的进度 k（0..1）决定雾色、背景和半球光强度。
 * 只在 fog cue（或重来时重放的 fog cue）改了 far 时生效；预设本身的 far 对应 k = 0。
 */
export interface AtmoRamp { far1: number; fog: number; hemi: number }
export const ATMO_RAMPS: Partial<Record<AtmosphereId, AtmoRamp>> = {
  dreamGray: { far1: DREAM_GRAY_END.far, fog: DREAM_GRAY_END.fog, hemi: DREAM_GRAY_END.hemi },
};

/** 第三章路灯的碎金（§5.1 限用暖色）：只画在地面光池贴花上，不再照到人和物体。 */
export const STREET_GOLD = 0xc8a15a;

/**
 * 预设之外的 LampField 参数（AtmospherePreset 冻结，额外的放这里）。
 * lampFloor：LampField 的最低亮度。暗色预设 ≥ 0.15（R12）；voidDark「底亮度 0.15，另加掌光」。
 * rainNight 0.25（U6：路灯每 12 m 一盏，3-4 小路上坏了一半、30 m 才有一盏亮的，两灯之间全靠这个底亮度；0.15 时主角和障碍只剩剪影。
 * 乘上增益 2.3 之后两灯之间的有效亮度 0.58，比 r1 的 0.35 × 1.2 = 0.42 还亮，比改动前的 0.15 × 1.2 = 0.18 亮三倍）。
 * poolColor：路灯（street）地面光池贴花的颜色；缺省 = 预设的 lampColor（灯照到哪里就是什么颜色）。
 */
export const ATMO_EXTRA: Record<AtmosphereId, { lampFloor: number; poolColor?: number }> = {
  morning: { lampFloor: 0 }, noon: { lampFloor: 0 }, labNorth: { lampFloor: 0 },
  nightIndoor: { lampFloor: 0.15 }, rainNight: { lampFloor: 0.25, poolColor: STREET_GOLD }, busNight: { lampFloor: 0.15 }, homeDark: { lampFloor: 0.15 },
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
  /** far = max(near + gap, farRaw × fogMul)。farRaw 是预设 / fog cue 给的值，切画质时据此重算 far。 */
  fog: THREE.Color; near: number; far: number; farRaw: number; gap: number;
  sky: THREE.Color; ground: THREE.Color; hemi: number;
  dirColor: THREE.Color; dir: number; dirVec: THREE.Vector3;
  bg: THREE.Color;
  lampGain: number; lampColor: THREE.Color; chalkMin: number; lampFloor: number; dark: boolean;
  /** 路灯地面光池贴花的颜色（rainNight 是碎金，其余 = lampColor）。 */
  poolColor: THREE.Color;
  /** 平面影子的投射方向（预设的 planarDir，单位向量）。rainNight 的平行光（逆光）方向与它不同（U6），别的预设两者相同。 */
  planarVec: THREE.Vector3;
}

export function newState(): AtmoState {
  return {
    fog: new THREE.Color(), near: 10, far: 48, farRaw: 48, gap: MIN_FAR_OVER_NEAR, sky: new THREE.Color(), ground: new THREE.Color(), hemi: 1,
    dirColor: new THREE.Color(), dir: 0, dirVec: new THREE.Vector3(0.3, -1, -0.55).normalize(), bg: new THREE.Color(),
    lampGain: 0.6, lampColor: new THREE.Color(0xeef6ff), chalkMin: 0, lampFloor: 0, dark: false, poolColor: new THREE.Color(0xeef6ff),
    planarVec: new THREE.Vector3(0.3, -1, -0.55).normalize(),
  };
}

/** 按 farRaw、gap 与 fogMul 重算 far。 */
export function refar(st: AtmoState, fogMul: number): AtmoState {
  st.far = Math.max(st.near + st.gap, st.farRaw * fogMul);
  return st;
}

const _rampColor = new THREE.Color();
/** 渐变预设：按 farRaw 在 [预设 far, ramp.far1] 之间的进度，把雾色、背景、半球光强度从预设值推向 ramp 的终点。 */
export function applyRamp(id: AtmosphereId, p: AtmospherePreset, st: AtmoState): AtmoState {
  const r = ATMO_RAMPS[id];
  if (!r) return st;
  const span = p.fog.far - r.far1;
  const k = Math.abs(span) < 1e-6 ? 0 : Math.min(1, Math.max(0, (p.fog.far - st.farRaw) / span));
  st.fog.setHex(p.fog.color).lerp(_rampColor.setHex(r.fog), k);
  st.bg.setHex(p.background).lerp(_rampColor.setHex(r.fog), k);
  st.hemi = lerp(p.hemi.intensity, r.hemi, k);
  return st;
}

/** 预设 → 状态（写入 out，不分配）。fogMul 只作用于远距离，且不低于 near + MIN_FAR_OVER_NEAR。 */
export function presetToState(id: AtmosphereId, p: AtmospherePreset, fogMul: number, out: AtmoState): AtmoState {
  out.fog.setHex(p.fog.color); out.near = p.fog.near;
  out.farRaw = p.fog.far; out.gap = MIN_FAR_OVER_NEAR;
  refar(out, fogMul);
  out.sky.setHex(p.hemi.sky); out.ground.setHex(p.hemi.ground); out.hemi = p.hemi.intensity;
  out.dirColor.setHex(p.dir?.color ?? DIR_WHITE); out.dir = p.dir?.intensity ?? 0;
  const d = p.dir?.dir ?? p.planarDir;
  out.dirVec.set(d[0], d[1], d[2]).normalize();
  out.bg.setHex(p.background);
  out.lampGain = p.lampGain; out.lampColor.setHex(p.lampColor); out.chalkMin = p.chalkMin;
  out.lampFloor = ATMO_EXTRA[id]?.lampFloor ?? 0; out.dark = p.dark;
  out.poolColor.setHex(ATMO_EXTRA[id]?.poolColor ?? p.lampColor);
  out.planarVec.set(p.planarDir[0], p.planarDir[1], p.planarDir[2]).normalize();
  return applyRamp(id, p, out);
}

export function copyState(src: AtmoState, out: AtmoState): AtmoState {
  out.fog.copy(src.fog); out.near = src.near; out.far = src.far; out.farRaw = src.farRaw; out.gap = src.gap;
  out.sky.copy(src.sky); out.ground.copy(src.ground); out.hemi = src.hemi;
  out.dirColor.copy(src.dirColor); out.dir = src.dir; out.dirVec.copy(src.dirVec);
  out.bg.copy(src.bg);
  out.lampGain = src.lampGain; out.lampColor.copy(src.lampColor); out.chalkMin = src.chalkMin; out.lampFloor = src.lampFloor; out.dark = src.dark;
  out.poolColor.copy(src.poolColor); out.planarVec.copy(src.planarVec);
  return out;
}

export function mixState(a: AtmoState, b: AtmoState, k: number, out: AtmoState): AtmoState {
  out.fog.copy(a.fog).lerp(b.fog, k); out.near = lerp(a.near, b.near, k); out.far = lerp(a.far, b.far, k);
  out.farRaw = lerp(a.farRaw, b.farRaw, k); out.gap = lerp(a.gap, b.gap, k);
  out.sky.copy(a.sky).lerp(b.sky, k); out.ground.copy(a.ground).lerp(b.ground, k); out.hemi = lerp(a.hemi, b.hemi, k);
  out.dirColor.copy(a.dirColor).lerp(b.dirColor, k); out.dir = lerp(a.dir, b.dir, k);
  out.dirVec.copy(a.dirVec).lerp(b.dirVec, k);
  if (out.dirVec.lengthSq() < 1e-6) out.dirVec.copy(b.dirVec);
  out.dirVec.normalize();
  out.bg.copy(a.bg).lerp(b.bg, k);
  out.lampGain = lerp(a.lampGain, b.lampGain, k); out.lampColor.copy(a.lampColor).lerp(b.lampColor, k);
  out.chalkMin = lerp(a.chalkMin, b.chalkMin, k); out.lampFloor = lerp(a.lampFloor, b.lampFloor, k);
  out.dark = k < 0.5 ? a.dark : b.dark;
  out.poolColor.copy(a.poolColor).lerp(b.poolColor, k);
  out.planarVec.copy(a.planarVec).lerp(b.planarVec, k);
  if (out.planarVec.lengthSq() < 1e-6) out.planarVec.copy(b.planarVec);
  out.planarVec.normalize();
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

  /**
   * fog cue：只改雾的 near / far（far 乘 fogMul）；渐变预设（dreamGray）的雾色、背景、半球光跟着 far 走。
   * 正在进行的预设过渡不被打断：目标仍是那个预设，只是换了雾距，时长取两者中较长的。
   */
  fogTo(near: number, far: number, seconds: number, now: number): void {
    const remaining = this.active ? Math.max(0, this.t0 + this.dur - now) : 0;
    copyState(this.cur, this.from);
    if (!this.active) copyState(this.cur, this.to);
    this.to.near = near;
    this.to.farRaw = far;
    this.to.gap = MIN_FAR_OVER_NEAR * 0.5;
    refar(this.to, this.fogMul);
    applyRamp(this.id, this.getPreset(this.id), this.to);
    this.begin(Math.max(seconds, remaining), now);
  }

  /**
   * 切画质：只换雾远距离的倍率，按各状态的 farRaw 重算 far；进行中的过渡、fog cue 的覆盖、渐变进度都保留。
   */
  setFogMul(m: number): void {
    if (Math.abs(m - this.fogMul) < 1e-9) return;
    this.fogMul = m;
    refar(this.from, m); refar(this.to, m);
    if (this.active) {
      // 下一次 update 会按 from / to 重新插值；这里先把 cur 的 far 也换算过去，避免这一帧跳一下
      refar(this.cur, m);
    } else copyState(this.to, this.cur);
    this.apply();
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
