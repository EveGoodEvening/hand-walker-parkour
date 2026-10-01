// src/sim/tuning.ts —— 动作数值（DESIGN.md §2.4）。CORE 写初版，归 WP1。
// 单位：秒、米、拍。所有模拟逻辑只从这里读数值。
export const TUNING = {
  tickHz: 120,
  laneWidth: 1.1,
  laneChange: { dry: 0.14, wet: 0.22, queue: 1, easing: 'easeOutCubic' },
  inputBuffer: 0.12,
  jump: { beats: 3, minSec: 0.48, maxSec: 0.72, peak: 0.60, fastFall: 0.12, fastFallDuckBeats: 2 },
  duck: { minBeats: 2, maxBeats: 8, height: 0.30, blend: 0.06 },
  hitbox: { halfW: 0.22, height: 0.55, sFront: 0.25, sBack: 0.25,   // 只算从手到胸，拖在后面的腿不碰撞
            duckS: 0.35, twitchHeight: 0.85, lethalShrink: 0.85, grazeY: 0.12 },
  hit: { stumbleSpeedMul: 0.7, stumbleRecover: 0.8, crashStop: 0.3, crashRecover: 0.8, grace: 1.2 },
  steady: { max: 3, pressureMax: 2, regenBeats: 16, pressureRegenBeats: 24, syncedRegenBeats: 24,
            crispBonusBeats: 4, crispWindow: 0.06, touchIntentOffset: 0.04,
            pressureCrispBonusBeats: 0 },   // 施压段、同拍段（技巧高潮）干脆不加回稳计数（最终 QA，DESIGN §10.5）
  gait: { supportLen: 0.6, knuckleMs: 26, padMs: 52, subScaleRef: 4.8, subScaleClamp: [0.8, 1.2] },
  twitch: { warn: 0.6, rise: 1.2, holdDefault: 0.25, speedMul: 0.85 },
  drift: { warn: 0.6 },
  lookBack: { turn: 0.25, hold: 0.4, back: 0.25, silence: 1.2 },
  ask: { delay: 0.5, perSegment: 2, range: 6, ignoreChance: 0.3 },
  stand: { stepPeriod: 0.9, gravity: 3.2, torque: 4.5, damping: 0.8, kick: [0.25, 0.55],
           plantAngle: 0.35, riseHold: 3.0, hintRepeat: 8, autoRiseAfter: 12, dreamSidestep: 0.6 },
  soundLight: { reach: 8, hold: 4, delayCh5: 0.5 },
  assist: { speedMul: 0.9, crispWindow: 0.10, steadyBonus: 1, regenBeats: 12 },
  slowOption: 0.9,                  // 暂停菜单「放慢一点」
} as const;

/** 以下是 CORE 实现时补充的派生常量（§2.4 没有直接给出）。 */
export const DERIVED = {
  /** 撞上横档后自动伏低的拍数（「撞了会自动压低钻过去」）。 */
  crashDuckBeats: 2,
  /** 擦肩：与 block 横向相距 < 0.1 m 时只放一声衣料摩擦（§2.5）。 */
  nearMissGap: 0.1,
  /** 绊的视觉/模式时长（秒）。 */
  stumbleModeSec: 0.5,
} as const;
