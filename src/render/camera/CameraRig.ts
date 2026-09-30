// src/render/camera/CameraRig.ts —— 低视角追尾镜头（DESIGN.md §5.4）。CORE 写初版，之后归 WP5。
// 横屏：相对玩家 (0.7·x, 0.92, +2.35)，注视 (·, 0.45, −7)，水平视角 76°，竖直视角由宽高比反算并限制在 50–62°。
// 竖屏（宽高比 < 1）：(0.6·x, 1.30, +3.8)，注视 (·, 0.30, −6)，竖直视角 ≤ 80°，三条车道都在画面内。
// 横向跟随：临界阻尼弹簧 ω = 12；换道滚转 1.5°；撑跃高度 +0.35 × 抬升；伏低 −0.10；受击震动 0.12 s / 0.03；
// 回头：0.25 s 绕玩家转 160°，停 0.4 s，再转回（「减少晃动」时直接切）；摔倒：(0.2, 0.18, +1.0)，滚转 0.2 rad。
// 「减少晃动」关闭晃动、滚转、震动和视角变化。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { STILL_ORIGIN } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { clamp, DEG, frac, lerp, springStep } from '../../core/math';
import type { ShotId, SimSnapshot } from '../../core/types';
import { DEFAULT_SET_SHOT, RUN_SHOT_OFFSETS, SET_SHOTS } from './shots';

const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _off = new THREE.Vector3();
const _sp: [number, number] = [0, 0];

export class CameraRig implements ViewSystem {
  readonly id = 'camera';
  readonly owner = 'WP5' as const;
  readonly order = 60;
  private ctx!: ViewContext;
  private sx = 0; private sv = 0;
  private shake = 0;
  private shot: { id: ShotId; until: number; t0: number } | null = null;
  private stillShot: ShotId = 'deskFeet';
  private fallBlend = 0;
  private roll = 0;
  private lastT = 0;

  init(ctx: ViewContext): void { this.ctx = ctx; }

  /** camera cue。seconds = 0 表示一直保持到下一次切换（静场）。 */
  setShot(id: ShotId, seconds: number, t: number): void {
    if (SET_SHOTS[id]) { this.stillShot = id; return; }
    this.shot = { id, t0: t, until: seconds > 0 ? t + seconds : Infinity };
  }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    if (e.type === 'hit' && !this.ctx.settings.reducedMotion) this.shake = 0.12;
    if (e.type === 'segment') { this.shot = null; if (e.data.kind !== 'run') this.stillShot = 'deskFeet'; }
    if (e.type === 'retry') { this.fallBlend = 0; this.shot = null; }
    void snap;
  }

  onReset(snap: SimSnapshot): void {
    this.sx = snap.player.x; this.sv = 0; this.fallBlend = 0; this.shake = 0; this.shot = null; this.roll = 0;
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number, dt: number): void {
    const cam = this.ctx.camera;
    const rm = this.ctx.settings.reducedMotion;
    const aspect = cam.aspect || 16 / 9;
    const portrait = aspect < 1;
    if (next.segKind !== 'run') {
      const sh = SET_SHOTS[this.stillShot] ?? DEFAULT_SET_SHOT;
      cam.position.set(STILL_ORIGIN.x + sh.pos[0], STILL_ORIGIN.y + sh.pos[1], STILL_ORIGIN.z + sh.pos[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(STILL_ORIGIN.x + sh.look[0], STILL_ORIGIN.y + sh.look[1], STILL_ORIGIN.z + sh.look[2]);
      this.setFov(portrait ? Math.min(80, sh.fov * 1.3) : sh.fov);
      return;
    }
    const same = prev.segIndex === next.segIndex;
    const a = same ? alpha : 1;
    const P = prev.player, N = next.player;
    const s = lerp(P.s, N.s, a), x = lerp(P.x, N.x, a), y = lerp(P.y, N.y, a), fy = lerp(P.floorY, N.floorY, a);
    const duck = lerp(P.duck, N.duck, a);
    const step = Math.min(0.1, Math.max(0, dt));
    springStep(this.sx, this.sv, x, 12, step, _sp); this.sx = _sp[0]; this.sv = _sp[1];
    const lateralV = this.sv;
    // 追尾机位
    const base = portrait ? { k: 0.6, h: 1.3, back: 3.8, ly: 0.3, lz: -6 } : { k: 0.7, h: 0.92, back: 2.35, ly: 0.45, lz: -7 };
    let camY = base.h + 0.35 * y - 0.1 * duck;
    if (!rm) {
      const ph = frac(N.beat);
      camY += -0.012 * Math.exp(-ph * 8) + 0.004 * Math.sin(ph * Math.PI);   // 步态晃动 1.2 cm
    }
    _pos.set(base.k * this.sx, fy + camY, -s + base.back);
    _look.set(base.k * this.sx * 0.6, fy + base.ly + 0.2 * y, -s + base.lz);
    // 回头：绕玩家转 160°
    let yaw = 0;
    const lb = N.lookBack;
    if (lb > 0) yaw = rm ? (lb > 0.5 ? Math.PI * 160 / 180 : 0) : lb * Math.PI * 160 / 180;
    // 跑段临时机位（例如 glanceLeft：朝镜子偏 8°）
    let pitchOff = 0, dyOff = 0;
    if (this.shot) {
      if (next.t > this.shot.until) this.shot = null;
      else {
        const o = RUN_SHOT_OFFSETS[this.shot.id];
        if (o) {
          const k = clamp((next.t - this.shot.t0) / 0.3, 0, 1) * clamp((this.shot.until - next.t) / 0.3, 0, 1);
          yaw += (rm ? 0 : o.yaw) * k; pitchOff = o.pitch * k; dyOff = o.dy * k;
        }
      }
    }
    if (Math.abs(yaw) > 1e-4) {
      const px = x, pz = -s;
      _off.set(_pos.x - px, 0, _pos.z - pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      _pos.x = px + _off.x; _pos.z = pz + _off.z;
      _off.set(_look.x - px, 0, _look.z - pz).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      _look.x = px + _off.x; _look.z = pz + _off.z;
    }
    _pos.y += dyOff; _look.y += pitchOff * 3;
    // 摔倒机位
    const falling = N.mode === 'fall';
    this.fallBlend = clamp(this.fallBlend + (falling ? step / 0.35 : -step / 0.35), 0, 1);
    if (this.fallBlend > 0) {
      const f = this.fallBlend;
      _pos.lerp(_off.set(x + 0.2, fy + 0.18, -s + 1.0), f);
      _look.lerp(_off.set(x, fy, -s - 1.2), f);
    }
    // 震动
    if (this.shake > 0 && !rm) {
      this.shake = Math.max(0, this.shake - step);
      const amp = 0.03 * (this.shake / 0.12);
      _pos.x += Math.sin(next.t * 97) * amp; _pos.y += Math.cos(next.t * 83) * amp;
    }
    cam.position.copy(_pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look);
    // 换道滚转 1.5°；摔倒滚转 0.2 rad
    const targetRoll = rm ? 0 : clamp(-lateralV * 0.12, -1.5 * DEG, 1.5 * DEG) + (falling ? 0.2 : 0);
    this.roll = lerp(this.roll, targetRoll, clamp(step * 10, 0, 1));
    if (Math.abs(this.roll) > 1e-5) cam.rotateZ(this.roll);
    // 视角
    if (portrait) this.setFov(Math.min(80, this.vFromH(76, aspect)));
    else this.setFov(clamp(this.vFromH(76, aspect), 50, 62) + (this.shake > 0 && !rm ? 1.5 * (this.shake / 0.12) : 0));
    this.lastT = next.t;
  }

  private vFromH(hDeg: number, aspect: number): number {
    return (2 * Math.atan(Math.tan((hDeg * DEG) / 2) / aspect)) / DEG;
  }
  private setFov(v: number): void {
    const cam = this.ctx.camera;
    if (Math.abs(cam.fov - v) > 1e-3) { cam.fov = v; cam.updateProjectionMatrix(); }
  }
}
