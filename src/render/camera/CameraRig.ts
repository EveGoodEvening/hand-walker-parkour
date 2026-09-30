// src/render/camera/CameraRig.ts —— 低视角镜头（DESIGN.md §5.4 全部状态）。WP5。
// 追尾：横屏 (0.7·x, 0.92, +2.35) 注视 (·, 0.45, −7)，水平视角 76°、竖直视角由宽高比反算并限制在 50–62°；
//       竖屏（宽高比 < 1）(0.6·x, 1.30, +3.8) 注视 (·, 0.30, −6)，竖直视角 ≤ 80°，三条车道都在画面内。
// 横向跟随：临界阻尼弹簧 ω = 12，换道滚转 1.5°；撑跃高度 +0.35 × 抬升；伏低 −0.10；受击震动 0.12 s / 0.03，视角脉冲 +1.5°；
// 梦中高速（> 7 m/s）视角 +8°；回头 0.25 s 绕玩家转 160°、停 0.4 s、0.25 s 转回；站立 (0, 1.62, +1.9) 注视 (0, 1.5, −8)，
// 1.2 s 过渡，滚转 = θ × 0.6；摔倒 (0.2, 0.18, +1.0)，0.35 s，滚转 0.2 rad；静场按 ShotId 固定机位（相对主角锚点）。
// 步态晃动：高度 1.2 cm、俯仰 0.3°，与掌根触地同步；落地下沉 1 cm。
// 停拍里如果镜中 / 水洼里有替身（WP5.focus），镜头慢慢看过去（「我停下来，看了一眼。镜子里的人也停了下来。」）。
// 「减少晃动」：没有晃动、滚转、震动和视角变化；回头、推近直接切镜头。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { STILL_ORIGIN } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp, DEG, easeInOutSine, frac, lerp, springStep } from '../../core/math';
import type { Settings } from '../../core/settings';
import type { ShotId, SimSnapshot } from '../../core/types';
import { WP5 } from '../actors/shared';
import { FOLLOW, RUN_SHOT_OFFSETS, SET_DEFAULT_SHOT, SET_SHOTS, STAND_SHOTS, DEFAULT_SET_SHOT } from './shots';

export interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number }

/** poseTest 机位：[pos x, y, z, look x, y, z, fov]（相对玩家根，世界坐标）。 */
const POSE_CAMS: Record<string, [number, number, number, number, number, number, number]> = {
  crawl: [1.35, 0.8, 1.15, 0, 0.32, -0.25, 46], duck: [1.35, 0.75, 1.15, 0, 0.25, -0.25, 46], twitch: [1.45, 0.9, 1.3, 0, 0.35, -0.1, 46],
  jump: [2.1, 1.1, 1.8, 0, 0.75, -0.3, 46], stand: [2.2, 1.2, 2.0, 0, 0.85, 0, 46], thirdHand: [0.95, 0.72, -1.25, 0, 0.5, -0.35, 44],
  shadowThreeHands: [0.2, 2.4, 1.3, 0.35, 0, -0.7, 55],
};

const _off = new THREE.Vector3(), _g = new THREE.Vector3(), _gl = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3();
const _sp: [number, number] = [0, 0];

export function vFromH(hDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hDeg * DEG) / 2) / aspect)) / DEG;
}

export class CameraRig implements ViewSystem {
  readonly id = 'camera';
  readonly owner = 'WP5' as const;
  readonly order = 60;
  private ctx!: ViewContext;
  private sx = 0; private sv = 0;
  private shake = 0;
  private shot: { id: ShotId; until: number; t0: number } | null = null;
  private stillShot: ShotId | null = null;
  private standShot: 'standEye' | 'trackSky' | null = null;
  private fallBlend = 0;
  private gazeBlend = 0;
  private standBlend = 0;
  private roll = 0;
  private fovExtra = 0;
  private landT = 9;
  private readonly lastPos = new THREE.Vector3();
  private readonly lastLook = new THREE.Vector3(0, 0, -1);
  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3(0, 0, -1);
  private prevKind: 'run' | 'still' | 'stand' = 'run';
  private lastSimT = 0;
  readonly out: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 55 };

  init(ctx: ViewContext): void { this.ctx = ctx; }

  /** camera cue。seconds = 0 表示一直保持到下一次切换（静场）。 */
  setShot(id: ShotId, seconds: number, t: number): void {
    if (SET_SHOTS[id]) { this.stillShot = id; return; }
    if (id === 'standEye' || id === 'trackSky') { this.standShot = id; return; }
    if (id === 'follow') { this.shot = null; return; }
    this.shot = { id, t0: t, until: seconds > 0 ? t + seconds : Infinity };
  }

  onEvent(e: GameEvent): void {
    const rm = this.ctx?.settings.reducedMotion;
    if (e.type === 'hit' && !rm) this.shake = 0.12;
    if (e.type === 'land') this.landT = 0;
    if (e.type === 'segment') { this.shot = null; this.stillShot = null; this.standShot = null; }
    if (e.type === 'retry') { this.fallBlend = 0; this.shot = null; this.gazeBlend = 0; }
  }

  onReset(snap: SimSnapshot): void {
    this.sx = snap.player.x; this.sv = 0; this.fallBlend = 0; this.shake = 0; this.shot = null; this.roll = 0; this.gazeBlend = 0;
    this.fovExtra = 0; this.standBlend = snap.segKind === 'stand' ? 1 : 0; this.prevKind = snap.segKind;
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const cam = this.ctx.camera;
    const aspect = cam.aspect || 16 / 9;
    const o = this.compute(prev, next, alpha, dt, aspect, this.ctx.settings);
    cam.position.copy(o.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(o.look);
    if (Math.abs(o.roll) > 1e-5) cam.rotateZ(o.roll);
    if (Math.abs(cam.fov - o.fov) > 1e-3) { cam.fov = o.fov; cam.updateProjectionMatrix(); }
    this.lastPos.copy(o.pos); this.lastLook.copy(o.look);
  }

  /** 计算机位（不碰 three 的相机；单元测试直接调用）。 */
  compute(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number, aspect: number, settings: Readonly<Settings>): CamPose {
    const o = this.out;
    const rm = settings.reducedMotion;
    const portrait = aspect < 1;
    // 时间：按模拟时钟推进（无头测试里 step(n) 之后只渲染一帧，过渡照样按真实经过的模拟时间完成）
    const tNow = lerp(prev.t, next.t, prev.segIndex === next.segIndex ? alpha : 1);
    let simDt = tNow - this.lastSimT;
    if (!(simDt >= 0) || simDt > 60) simDt = 0;
    this.lastSimT = tNow;
    void dt;
    const bdt = simDt;                                   // 过渡与计时：不截断
    const step = Math.min(0.1, simDt);                   // 弹簧与平滑：截断
    const snap = simDt > 0.25;
    // —— 调试 / poseTest 机位 ——
    const dbg = WP5.debugCam;
    if (dbg) { o.pos.copy(dbg.pos); o.look.copy(dbg.look); o.roll = 0; o.fov = dbg.fov; return o; }
    if (WP5.poseTest && WP5.playerVisible) {
      // poseTest（§8.8）：3/4 侧后方的展示机位；站、跳抬高，第三只手看脸，影子从上方看
      const r = WP5.playerRoot;
      const v = (POSE_CAMS[WP5.poseTest] ?? POSE_CAMS.crawl) as [number, number, number, number, number, number, number];
      o.pos.set(r.x + v[0], r.y + v[1], r.z + v[2]); o.look.set(r.x + v[3], r.y + v[4], r.z + v[5]); o.roll = 0; o.fov = v[6];
      return o;
    }
    // —— 静场 ——
    if (next.segKind === 'still') {
      this.prevKind = 'still';
      const st = next.still;
      const key = st ? `${st.set}.${st.variant}` : 'placeholder';
      const id = this.stillShot ?? SET_DEFAULT_SHOT[key] ?? (st ? SET_DEFAULT_SHOT[st.set] : undefined) ?? 'deskFeet';
      const sh = SET_SHOTS[id] ?? DEFAULT_SET_SHOT;
      const M = WP5.playerVisible ? WP5.stillAnchor : _m.makeTranslation(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
      o.pos.set(sh.pos[0], sh.pos[1], sh.pos[2]).applyMatrix4(M);
      o.look.set(sh.look[0], sh.look[1], sh.look[2]).applyMatrix4(M);
      o.roll = 0;
      o.fov = portrait ? Math.min(80, sh.fov * 1.3) : sh.fov;
      this.fallBlend = 0; this.gazeBlend = 0; this.standBlend = 0;
      return o;
    }
    const same = prev.segIndex === next.segIndex;
    const a = same ? alpha : 1;
    const P = prev.player, N = next.player;
    const s = lerp(P.s, N.s, a), x = lerp(P.x, N.x, a), y = lerp(P.y, N.y, a), fy = lerp(P.floorY, N.floorY, a);
    // —— 站立段 ——
    if (next.segKind === 'stand') {
      if (this.prevKind !== 'stand') { this.fromPos.copy(this.lastPos); this.fromLook.copy(this.lastLook); this.standBlend = this.prevKind === 'run' && !rm ? 0 : 1; }
      this.prevKind = 'stand';
      this.standBlend = clamp(this.standBlend + bdt / 1.2, 0, 1);
      const sx = x + (N.stand?.x ?? 0);
      const fallen = N.stand?.phase === 'fallen' || this.standShot === 'trackSky';
      const sh = fallen ? STAND_SHOTS.trackSky : STAND_SHOTS.standEye;
      o.pos.set(sx + sh.pos[0], fy + sh.pos[1], -s + sh.pos[2]);
      o.look.set(sx + sh.look[0], fy + sh.look[1], -s + sh.look[2]);
      const k = easeInOutSine(this.standBlend);
      if (k < 1) { o.pos.lerpVectors(this.fromPos, o.pos, k); o.look.lerpVectors(this.fromLook, o.look, k); }
      o.roll = rm ? 0 : (N.stand?.theta ?? 0) * 0.6;
      o.fov = portrait ? Math.min(80, vFromH(76, aspect)) : clamp(vFromH(70, aspect), 50, 58);
      return o;
    }
    this.prevKind = 'run';
    const duck = lerp(P.duck, N.duck, a);
    springStep(this.sx, this.sv, x, 12, step, _sp); this.sx = _sp[0]; this.sv = _sp[1];
    if (snap || !Number.isFinite(this.sx) || Math.abs(this.sx - x) > 3) { this.sx = x; this.sv = 0; }
    const L = portrait ? FOLLOW.portrait : FOLLOW.landscape;
    let camY = L.h + 0.35 * y - 0.1 * duck;
    let lookDy = 0;
    this.landT += bdt;
    if (!rm) {
      const ph = frac(lerp(P.beat, N.beat, a));
      const heel = N.mode === 'crawl' || N.mode === 'duck' ? Math.exp(-ph * 8) : 0;
      camY += -0.012 * heel;                               // 步态晃动 1.2 cm
      lookDy += -Math.tan(0.3 * DEG) * 9.3 * heel;          // 俯仰 0.3°
      if (this.landT < 0.2) camY -= 0.01 * Math.sin(Math.PI * this.landT / 0.2);   // 落地下沉 1 cm
    }
    o.pos.set(L.k * this.sx, fy + camY, -s + L.back);
    o.look.set(L.lookK * this.sx, fy + L.ly + 0.2 * y + lookDy, -s + L.lz);
    // —— 回头：绕玩家转 160° ——
    let yaw = 0;
    const lb = N.lookBack;
    if (lb > 0) yaw = rm ? (lb > 0.5 ? 160 * DEG : 0) : lb * 160 * DEG;
    // —— 跑段临时机位 ——
    let dyOff = 0, lookDyOff = 0, lookAhead = 0;
    let mirrorClose = false;
    if (this.shot) {
      if (next.t > this.shot.until) this.shot = null;
      else {
        const so = RUN_SHOT_OFFSETS[this.shot.id];
        if (this.shot.id === 'mirrorClose') mirrorClose = true;
        if (so) {
          const kin = rm ? 1 : clamp((next.t - this.shot.t0) / 0.3, 0, 1);
          const kout = rm ? 1 : clamp((this.shot.until - next.t) / 0.3, 0, 1);
          const k = easeInOutSine(Math.min(kin, kout));
          yaw += (this.shot.id === 'turnBack' ? so.yaw : rm ? 0 : so.yaw) * (this.shot.id === 'turnBack' && rm ? 1 : k);
          lookDyOff = so.lookDy * k; dyOff = so.dy * k; lookAhead = (so.lookAhead ?? 0) * k;
        }
      }
    }
    if (lookAhead > 0) o.look.z = -s - lookAhead;
    if (Math.abs(yaw) > 1e-4) {
      const px = x, pz = -s;
      _off.set(o.pos.x - px, 0, o.pos.z - pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      o.pos.x = px + _off.x; o.pos.z = pz + _off.z;
      _off.set(o.look.x - px, 0, o.look.z - pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      o.look.x = px + _off.x; o.look.z = pz + _off.z;
    }
    o.pos.y += dyOff; o.look.y += lookDyOff;
    // —— 停拍 / mirrorClose：看向镜中的替身 ——
    const f = WP5.focus;
    const wantGaze = !!f && f.weight > 0.05 && (N.mode === 'stop' || mirrorClose);
    this.gazeBlend = rm ? (wantGaze ? 1 : 0) : clamp(this.gazeBlend + (wantGaze ? bdt / 1.6 : -bdt / 0.8), 0, 1);
    if (this.gazeBlend > 0 && f) {
      const F = f.point;
      _a.set(x, fy, -s);
      _d.set(F.x - _a.x, 0, F.z - _a.z);
      const D = Math.max(0.1, _d.length());
      _d.multiplyScalar(1 / D);
      if (f.kind === 'end') {
        const standOff = clamp(D * 0.28, 2.4, 3.6);
        _g.copy(F).addScaledVector(_d, -standOff); _g.y = F.y + 0.3;
      } else if (f.kind === 'floor') {
        _g.set(F.x, fy, F.z).addScaledVector(_d, -1.5); _g.y = fy + 1.25;
      } else {
        _g.copy(o.pos).addScaledVector(_d, clamp((D - 2.5) * 0.3, 0, 2.5));
      }
      _gl.copy(F);
      const k = easeInOutSine(this.gazeBlend);
      o.pos.lerp(_g, k); o.look.lerp(_gl, k);
    }
    // —— 摔倒 ——
    const falling = N.mode === 'fall';
    this.fallBlend = rm ? (falling ? 1 : 0) : clamp(this.fallBlend + (falling ? bdt / 0.35 : -bdt / 0.35), 0, 1);
    if (this.fallBlend > 0) {
      const k = this.fallBlend;
      // §5.4 是 (0.2, 0.18, +1.0)；爬姿的腿拖在身后约 1.1 m，那个位置正好在右脚旁边、镜头会插进腿里，
      // 所以横向让到腿的外侧（x + 0.6），高度、距离不变
      o.pos.lerp(_off.set(x + 0.6, fy + 0.2, -s + 1.0), k);
      o.look.lerp(_off.set(x, fy + 0.08, -s - 1.2), k);
    }
    // —— 震动 ——
    if (this.shake > 0 && !rm) {
      this.shake = Math.max(0, this.shake - bdt);
      const amp = 0.03 * (this.shake / 0.12);
      o.pos.x += Math.sin(next.t * 97) * amp; o.pos.y += Math.cos(next.t * 83) * amp;
    }
    // —— 滚转：换道 1.5°；摔倒 0.2 rad ——
    const targetRoll = rm ? 0 : clamp(-this.sv * 0.12, -1.5 * DEG, 1.5 * DEG) + (falling ? 0.2 * this.fallBlend : 0);
    this.roll = rm ? 0 : snap ? targetRoll : lerp(this.roll, targetRoll, clamp(step * 10, 0, 1));
    o.roll = this.roll;
    // —— 视角：受击脉冲 +1.5°，梦中高速 +8° ——
    const dream = N.speed > 7;
    this.fovExtra = rm ? 0 : lerp(this.fovExtra, dream ? 8 : 0, clamp(bdt * 2, 0, 1));
    const pulse = !rm && this.shake > 0 ? 1.5 * (this.shake / 0.12) : 0;
    const base = portrait ? Math.min(FOLLOW.portrait.vMax, vFromH(FOLLOW.landscape.hfov, aspect)) : clamp(vFromH(FOLLOW.landscape.hfov, aspect), FOLLOW.landscape.vMin, FOLLOW.landscape.vMax);
    o.fov = portrait ? Math.min(FOLLOW.portrait.vMax, base + this.fovExtra * 0.5 + pulse) : base + this.fovExtra + pulse;
    return o;
  }
}

const _m = new THREE.Matrix4();
