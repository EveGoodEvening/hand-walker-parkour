// src/render/actors/clips.ts —— 脚本姿势 PoseClipId（DESIGN.md §5.6、§8.4）。WP5。纯函数，Node 可测。
// 给替身（script 来源）和静场 / 停拍里的主角（actor cue）用。clipPose(id, t) 返回 t 秒时的姿势；
// 根的位置由调用方给出（RootAt：x、地面 y、里程 s、朝向 yaw），姿势本身在角色空间里描述。
// 附录 A：没有面孔（smile 也只是站着、头微偏）；站起来的姿势都不稳（膝微屈、手悬在两侧）。
import { clamp, DEG, easeInOutSine, frac, lerp, smoothstep } from '../../core/math';
import type { Pose } from '../../core/rig';
import type { PoseClipId, SetId } from '../../core/types';
import { armTo, crawlPose, setHand, type CrawlInput, type PoseBuilder } from './handCycle';
import { PALM_DROP } from './rigBuild';
import * as THREE from 'three';
import {
  applyPosture, blendPoses, floorSit, kneeling, lyingBack, mixPosture, PELVIS_Z, seated, standing, walkingLegs, type Posture, type RootAt,
} from './poses';
import { copyPose, createPose } from '../../core/rig';

/** 包内额外的姿势（静场缺省用，不属于冻结的 PoseClipId）。 */
export type InternalClip = 'crawlIdle' | 'palmEyeHold' | 'handsInWater' | 'sitFloor' | 'kneelSit' | 'sitDesk' | 'sitEatTucked';
export type AnyClip = PoseClipId | InternalClip;

export const ALL_CLIPS: readonly PoseClipId[] = ['sit', 'sitEat', 'busSeat', 'busSeatNormal', 'standIdle', 'standUp', 'walkUpright', 'turnAround',
  'turnHead', 'headDown', 'handstand', 'crawlToward', 'crawlReach', 'tapGlass', 'palmToGlass', 'pointMirror', 'pointBack', 'kneel', 'lieBack',
  'feetArch', 'feetArchDesk', 'answerLean', 'sitMissFeet', 'counterStand', 'sinkLean', 'writeBoard', 'wipeBoard', 'touchPillowDent', 'fistAir',
  'standBehindShoulder', 'smile'];

/** 静场的缺省主角姿势：键 = `${set}.${variant}` 或 `${set}`；null = 不显示主角（镜头在他眼睛里）。 */
export const SET_DEFAULT_CLIP: Partial<Record<string, AnyClip | null>> = {
  deskFeet: 'sitDesk', counter: 'counterStand', canteenWindow: 'sitEatTucked', labBoard: 'sitFloor', bus: 'busSeat', home: 'crawlToward',
  // lead 集成：palmEye 的镜头在他眼睛里（4-4 的手由 WP4 的 set 画），画出身体会挡住整个画面。
  // 修复轮 U5：4-6（water）画按进水里的手臂和手，身体其余部分由 Actor 藏起来（EYE_GROUPS）
  bathroom: 'sinkLean', palmEye: null, water: 'handsInWater', 'bedroom.feet': 'lieBack', 'bedroom.ceiling': 'lieBack',
  bedroom: 'lieBack', 'infirmary.bed': 'lieBack', 'infirmary.ceiling': 'lieBack', infirmary: 'lieBack', placeholder: 'sitDesk',
} satisfies Partial<Record<SetId | string, AnyClip | null>>;

/** 4-6 按进水里的双手（角色空间、相对根：横向半宽、高度、前方）。water.ts 的涟漪中心与它一致。 */
export const WATER_HANDS: readonly [number, number, number] = [0.3, -0.05, -0.62];
const _hv = new THREE.Vector3(), _hw = new THREE.Vector3();

/** smile：抬头的角度（弧度，局部 x）。 */
export const SMILE_HEAD_UP = 0.22;

const crawlIn: CrawlInput = { s: 0, x: 0, y: 0, floorY: 0, beat: 0, stride: 1, cadence: 4.8, speed: 4.8, duck: 0, air: false, airT: 0, mode: 'crawl', modeT: 0, laneTarget: 0, twitch: 0, drift: 0, lookBack: 0 };
const _tmp = createPose();

function crawlAt(at: RootAt, beat: number, b: PoseBuilder, stride = 1): Pose {
  crawlIn.s = at.s; crawlIn.x = at.x; crawlIn.floorY = at.y; crawlIn.beat = beat; crawlIn.stride = stride;
  crawlIn.laneTarget = at.x / 1.1; crawlIn.mode = 'crawl';
  const p = crawlPose(crawlIn, b);
  p.root[3] = (p.root[3] as number) + at.yaw;
  return p;
}

/** 手在身前举起（掌心朝前 / 朝脸）。 */
const armUp = (sx: number, y: number, z: number, f: [number, number, number], n: [number, number, number]) =>
  ({ t: [sx * 0.16, y, z] as [number, number, number], pole: [sx * 0.8, -0.4, 0.4] as [number, number, number], f, n });

/** 取体态（t 秒）。返回 null 表示这个 clip 走爬行路径。 */
function posture(id: AnyClip, t: number): Posture | null {
  switch (id) {
    // 替身「坐在椅子上，双腿垂落，脚尖点地」（2-5）
    case 'sit': return seated({});
    // 主角在课桌前：腿伸进桌下，脚平放（1-4 / 5-5 镜头在桌下，鞋在前景）
    case 'sitDesk': return seated({ flat: true, lean: 8 });
    // 2-5：主角吃饭时把腿塞进椅子下面的横档（sitEatTucked，静场缺省）；倒影「双腿自然垂落，脚尖点地」（sitEat，替身）
    case 'sitEatTucked': return seated({ tucked: true, lean: 10, L: { t: [-0.16, 0.78, PELVIS_Z - 0.42], pole: [-0.6, -0.2, 1], f: [0.3, 0, -1], n: [0, -1, 0] }, R: { t: [0.16, 0.8, PELVIS_Z - 0.44], pole: [0.6, -0.2, 1], f: [-0.3, 0, -1], n: [0, -1, 0] } });
    case 'sitEat': {
      const P = seated({ lean: 6, L: { t: [-0.16, 0.74, PELVIS_Z - 0.4], pole: [-0.6, -0.2, 1], f: [0.3, 0, -1], n: [0, -1, 0] }, R: { t: [0.16, 0.76, PELVIS_Z - 0.42], pole: [0.6, -0.2, 1], f: [-0.3, 0, -1], n: [0, -1, 0] } });
      // 脚尖刚好点在地上（seated 的踝高按平放的脚算，脚尖朝下时会戳进地面约 7 cm）
      P.legL = { ...P.legL, t: [P.legL.t[0], P.legL.t[1] + 0.07, P.legL.t[2]] };
      P.legR = { ...P.legR, t: [P.legR.t[0], P.legR.t[1] + 0.07, P.legR.t[2]] };
      return P;
    }
    case 'busSeat': return seated({ tucked: true, lean: 4 });
    case 'busSeatNormal': return seated({ lean: 2, L: { t: [-0.13, 0.6, PELVIS_Z - 0.36], pole: [-0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] }, R: { t: [0.13, 0.6, PELVIS_Z - 0.36], pole: [0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] } });
    case 'standIdle': case 'standBehindShoulder': {
      const P = standing({ knee: 5, lean: 2 });
      P.chest = [0.01 * Math.sin(t * 1.4), 0, 0];
      return P;
    }
    case 'smile': {
      // 4-3 镜中的「我」在笑（没有五官，附录 A-4）：慢慢抬起头、肩膀松下来，两手垂到身侧
      const k = smoothstep(0.3, 1.5, t);
      const P = standing({ knee: 4, lean: 0, arms: 'hang' });
      P.head = [0.04 + SMILE_HEAD_UP * k, 0.05, 0.1 * (1 - k)];
      P.chest = [-0.05 * k, 0, 0];
      P.L = { ...P.L, t: [P.L.t[0] - 0.01 * k, P.L.t[1] - 0.04 * k, P.L.t[2]] };
      P.R = { ...P.R, t: [P.R.t[0] + 0.01 * k, P.R.t[1] - 0.04 * k, P.R.t[2]] };
      return P;
    }
    case 'walkUpright': return walkingLegs(armSwing(standing({ knee: 6, lean: 3 }), t * 0.95), t * 0.95, 0.62, 0);
    case 'turnAround': { const P = standing({ knee: 5 }); P.yaw = Math.PI * easeInOutSine(clamp(t / 1.0, 0, 1)); return P; }
    case 'turnHead': { const P = seated({ lean: 2, L: { t: [-0.13, 0.6, PELVIS_Z - 0.36], f: [0, 0, -1], n: [0, -1, 0] }, R: { t: [0.13, 0.6, PELVIS_Z - 0.36], f: [0, 0, -1], n: [0, -1, 0] } }); P.head = [0, 70 * DEG * easeInOutSine(clamp(t / 0.8, 0, 1)), 0]; return P; }
    case 'handstand': {
      // 「整个人以手腕为轴，悬在窗玻璃后面，双腿笔直地指向天空，像两根被遗忘的旗杆」
      const sway = 0.02 * Math.sin(t * 1.3);
      return {
        lift: 1.03 - 0.34, pelvis: [Math.PI + sway, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0.25, 0, 0], head: [0.2, 0, 0],
        L: { t: [-0.22, 0.03, PELVIS_Z], pole: [-0.6, 0, -1], f: [0, 0, -1], n: [0, -1, 0] },
        R: { t: [0.22, 0.03, PELVIS_Z], pole: [0.6, 0, -1], f: [0, 0, -1], n: [0, -1, 0] },
        legL: { t: [-0.08, 1.8, PELVIS_Z + 0.02], pole: [0, 0, 1], f: [0, 1, 0.1], n: [0, -0.1, 1] },
        legR: { t: [0.08, 1.8, PELVIS_Z + 0.02], pole: [0, 0, 1], f: [0, 1, 0.1], n: [0, -0.1, 1] },
      };
    }
    case 'tapGlass': {
      // 坐着，转头，用食指敲一下玻璃（3-5）：反射之前车窗在它的左边（−x），左手抬到窗边，1.0 s 处敲一下
      // （修复轮 U5：以前抬的是右手、头转向右边，反射之后手和脸都背对着玻璃）
      const P = seated({ lean: 2 });
      const reach = smoothstep(0, 0.6, t);
      const tap = Math.exp(-Math.pow((t - 1.0) / 0.08, 2));
      // 3-5 里它坐在靠窗的座位上（离玻璃约 0.37 m）：食指尖敲到玻璃
      P.L = { t: [-0.07 - 0.1 * reach - 0.025 * tap, 0.98, PELVIS_Z - 0.34], pole: [-0.8, -0.5, 0.3], f: [-1, 0.3, -0.2], n: [0, -1, 0], k: -0.2, d: -0.2 };
      P.head = [0, 60 * DEG * smoothstep(0, 0.5, t), 0];
      return P;
    }
    case 'palmToGlass': {
      // 跪着，右手掌心贴在身前的竖直玻璃上（2-5 替身 / 2-10 掌心贴掌心）
      return kneeling({ lean: 8, R: armUp(1, 0.95, PELVIS_Z - 0.62, [0, 1, 0], [0, 0, -1]) });
    }
    case 'pointMirror': {
      const P = standing({ knee: 5 });
      P.L = { t: [-0.62, 1.32, PELVIS_Z - 0.3], pole: [0, -1, 0.3], f: [-1, 0.1, -0.4], n: [0, -1, 0], k: 0.15, d: 0.1 };
      P.head = [0, 30 * DEG, 0];
      return P;
    }
    case 'pointBack': {
      const P = standing({ knee: 5 });
      P.R = { t: [0.3, 1.2, PELVIS_Z + 0.55], pole: [1, 0, 0], f: [0.2, 0, 1], n: [0, -1, 0] };
      P.head = [0, -40 * DEG, 0];
      return P;
    }
    case 'kneel': return kneeling({ lean: 3 });
    case 'kneelSit': return kneeling({ sitBack: 1, lean: 10 });
    case 'lieBack': return lyingBack({});
    case 'feetArch': {
      // 被子里的脚自己弯起来（5-1）：膝盖慢慢拱起
      const k = smoothstep(0, 1.5, t);
      return lyingBack({ knees: lerp(8, 55, k), feetUp: 0 });
    }
    case 'feetArchDesk': {
      // 1-4：右脚自己动了一下——脚跟抬起、脚弓成站姿，鞋尖直直地指向课桌腿
      const P = seated({ flat: true, lean: 8 });
      const k = smoothstep(0, 0.3, t) * (1 - 0.3 * smoothstep(0.7, 1.0, t));
      const fz = PELVIS_Z - 0.5;
      P.legR = { t: [0.12, lerp(0.09, 0.2, k), lerp(fz, fz + 0.06, k)], pole: [0, 0.2, -1], f: [0.04, lerp(0, -0.62, k), -1], n: [0, lerp(-1, -0.8, k), lerp(0, 0.5, k)] };
      return P;
    }
    case 'answerLean': {
      // 撑着桌沿站起来回答问题（5-5）
      const P = standing({ knee: 14, lean: 26 });
      P.L = { t: [-0.24, 0.76, PELVIS_Z - 0.5], pole: [-0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.R = { t: [0.24, 0.76, PELVIS_Z - 0.5], pole: [0.6, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      return P;
    }
    case 'sitMissFeet': {
      // 坐下时脚没跟上，用手撑住椅子
      const k = smoothstep(0, 0.6, t);
      const P = mixPosture(standing({ knee: 30, lean: 20 }), seated({ lean: 20 }), k * 0.7);
      P.R = { t: [0.32, 0.5, PELVIS_Z + 0.15], pole: [1, 0, 0.3], f: [0, 0, 1], n: [0, -1, 0] };
      P.legL = { t: [-0.1, 0.09, PELVIS_Z - 0.62], pole: [0, 0.3, -1] };
      P.legR = { t: [0.13, 0.09, PELVIS_Z - 0.6], pole: [0, 0.3, -1] };
      return P;
    }
    case 'counterStand': {
      // 2-3：双手撑在窗台边缘，膝盖弯曲，脚踮地
      const P = standing({ knee: 26, lean: 14 });
      P.L = { t: [-0.24, 0.92, PELVIS_Z - 0.48], pole: [-0.7, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.R = { t: [0.24, 0.92, PELVIS_Z - 0.48], pole: [0.7, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.legL = { ...P.legL, t: [-0.1, 0.13, PELVIS_Z - 0.02], f: [0, -0.55, -0.83], n: [0, -0.83, 0.55] };
      P.legR = { ...P.legR, t: [0.1, 0.13, PELVIS_Z - 0.02], f: [0, -0.55, -0.83], n: [0, -0.83, 0.55] };
      return P;
    }
    case 'sinkLean': {
      // 3-10：手撑在洗手台边缘
      const P = standing({ knee: 18, lean: 18 });
      P.L = { t: [-0.26, 0.84, PELVIS_Z - 0.46], pole: [-0.7, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      P.R = { t: [0.26, 0.84, PELVIS_Z - 0.46], pole: [0.7, 0, 1], f: [0, 0, -1], n: [0, -1, 0] };
      return P;
    }
    case 'writeBoard': {
      const P = kneeling({ lean: 6 });
      const w = t * 5;
      P.R = armUp(1, 1.2 + 0.03 * Math.sin(w * 1.3), PELVIS_Z - 0.55 + 0, [0.3, 1, -0.2], [0, 0, -1]);
      P.R = { ...P.R, t: [0.12 + 0.08 * Math.sin(w), P.R.t[1], P.R.t[2]], k: 0.3, d: 0.3 };
      return P;
    }
    case 'wipeBoard': {
      const P = kneeling({ lean: 6 });
      const w = t * 4.2;
      P.R = { ...armUp(1, 1.1 + 0.05 * Math.sin(w * 0.5), PELVIS_Z - 0.58, [0, 1, 0], [0, 0, -1]), t: [0.18 * Math.sin(w), 1.1 + 0.05 * Math.sin(w * 0.5), PELVIS_Z - 0.58] };
      return P;
    }
    case 'touchPillowDent': {
      // 5-9：躺着，左手摸一下枕边的凹陷（凹陷在头的左边；锚点在床面上，修复轮 U5：以前右手伸向床尾、整个人浮在床面上方 0.5 m）
      const P = lyingBack({ knees: 12 });
      P.L = { t: [-0.46, 0.03, PELVIS_Z + 0.4], pole: [-1, 0.6, 0], f: [-0.2, 0, 1], n: [0, -1, 0] };
      P.head = [-0.15, 0.5, 0];
      return P;
    }
    case 'fistAir': {
      // 5-10：伸出右手，在空中张开五指，然后握紧
      const P = lyingBack({});
      const grip = smoothstep(2.2, 2.6, t);
      P.R = { t: [0.18, 0.62, PELVIS_Z + 0.42], pole: [1, 0, 0.3], f: [0, 1, 0], n: [0, 0, 1], k: -0.1 + grip * 1.6, d: -0.1 + grip * 1.4 };
      return P;
    }
    case 'palmEyeHold': {
      // 4-4：右手举到眼前（镜头在眼睛里；头的内壁是背面，被剔除）
      const P = kneeling({ sitBack: 0.6, lean: 4 });
      P.R = { t: [0.04, 1.02, PELVIS_Z - 0.34], pole: [1, -0.5, 0.2], f: [0, 1, 0], n: [0, 0, 1] };
      return P;
    }
    case 'sitFloor': return floorSit();
    default: return null;
  }
}

/** 与时间无关的体态：缓存一次，避免每帧分配（§9.4「热路径不分配内存」）。 */
const STATIC: ReadonlySet<AnyClip> = new Set<AnyClip>(['sit', 'sitDesk', 'sitEat', 'sitEatTucked', 'busSeat', 'busSeatNormal', 'kneel', 'kneelSit', 'lieBack',
  'palmToGlass', 'pointMirror', 'pointBack', 'answerLean', 'counterStand', 'sinkLean', 'touchPillowDent', 'palmEyeHold', 'sitFloor']);
const STATIC_CACHE = new Map<AnyClip, Posture>();

/** 行走时的手臂轻摆。 */
function armSwing(P: Posture, phase: number): Posture {
  const a = Math.sin(frac(phase) * 2 * Math.PI) * 0.12;
  return { ...P, L: { ...P.L, t: [P.L.t[0], P.L.t[1], P.L.t[2] + a] }, R: { ...P.R, t: [P.R.t[0], P.R.t[1], P.R.t[2] - a] } };
}

/**
 * 脚本姿势：id 在 t 秒时的 Pose。at：根（世界）。写进 out（也会用 b 作为计算缓冲）。
 * 爬行类（crawlToward / crawlReach / headDown / crawlIdle）走 handCycle；standUp 从爬到站。
 */
export function clipPose(id: AnyClip, t: number, b: PoseBuilder, out: Pose, at: RootAt): Pose {
  switch (id) {
    case 'crawlToward': case 'crawlIdle': return copyPose(out, crawlAt(at, id === 'crawlIdle' ? 0.3 + 0.05 * Math.sin(t) : t * 4.8, b, 1));
    case 'headDown': {
      crawlAt(at, 0.3, b);
      b.addLocal('neck', -0.35, 0, 0); b.addLocal('head', -0.6, 0, 0);
      b.fkAll(); return copyPose(out, b.finish());
    }
    case 'handsInWater': {
      // 4-6：趴在水边，双手按进水里（手掌在水面下约 2 cm）。镜头在他眼睛里（waterDown），只画手臂和手（Actor 的 EYE_GROUPS）
      crawlAt(at, 0.25, b);
      for (const side of ['L', 'R'] as const) {
        const sx = side === 'L' ? -1 : 1;
        b.toWorld(_hv.set(sx * WATER_HANDS[0], WATER_HANDS[1] - at.y, WATER_HANDS[2]), _hw);
        _hw.y = at.y + WATER_HANDS[1] + PALM_DROP;
        armTo(b, side, _hw, 0.8);
        setHand(b, side, at.yaw - sx * 6 * DEG, 0, 0, 0, 0);
      }
      b.fkAll();
      return copyPose(out, b.finish());
    }
    case 'crawlReach': {
      crawlAt(at, 0.3, b);
      // 右手向前上方伸：够镜子
      const k = smoothstep(0, 0.8, t);
      b.addLocal('upperArmR', -0.9 * k, 0, 0.15 * k); b.addLocal('foreArmR', -0.3 * k, 0, 0); b.addLocal('palmR', 1.2 * k, 0, 0);
      b.fkAll(); return copyPose(out, b.finish());
    }
    case 'standUp': {
      // 从爬到站：0–1.2 s 跪起，1.2–2.6 s 站直（「然后它慢慢地、慢慢地站了起来」）
      const c = crawlAt(at, 0.3, b);
      copyPose(_tmp, c);
      const k1 = smoothstep(0, 1.2, t), k2 = smoothstep(1.2, 2.6, t);
      const P = mixPosture(kneeling({ lean: 20 }), standing({ knee: 6, lean: 3 }), k2);
      const s = applyPosture(P, at, b);
      return blendPoses(_tmp, s, k1, out);
    }
    default: break;
  }
  let P: Posture | null;
  if (STATIC.has(id)) {
    P = STATIC_CACHE.get(id) ?? null;
    if (!P) { P = posture(id, 0); if (P) STATIC_CACHE.set(id, P); }
  } else P = posture(id, t);
  if (!P) return copyPose(out, crawlAt(at, 0.3, b));
  return copyPose(out, applyPosture(P, at, b));
}
