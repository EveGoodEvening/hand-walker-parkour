// src/core/types.ts —— 所有跨包共享的基础类型（DESIGN.md §8.4）。CORE 冻结。
// 规则：只能经 docs/contract-requests/WPx.md 申请追加可选字段或新的联合成员（§8.11）。

/** 章节 id；'test' 是 32 拍的测试章（§8.9-11）。 */
export type ChapterId = 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5' | 'test';
/** 车道：−1 左、0 中、1 右；x = lane × LANE_WIDTH（§2.3）。 */
export type Lane = -1 | 0 | 1;
/** 偶数拍左手、奇数拍右手（§2.3）。 */
export type Hand = 'L' | 'R';
/** 三段触地：掌根 → 指节 → 指腹（§2.3、§3）。 */
export type ContactPart = 'heel' | 'knuckle' | 'pad';
/** 地面材质，影响音色与失败句（§6.2、附录 B.5）。 */
export type Surface = 'terrazzo' | 'tile' | 'concrete' | 'asphaltWet' | 'rubber' | 'plaza' | 'water' | 'sheet' | 'leavesWet' | 'air';
/** 画质档位（§9.4）。 */
export type QualityTier = 'low' | 'medium' | 'high';
/** 最后一次输入的设备，决定提示文字（§7.3）。 */
export type Device = 'keyboard' | 'touch';
/** 抽象动作（§2.2）。 */
export type Action = 'left' | 'right' | 'up' | 'down' | 'look' | 'ask' | 'pause' | 'confirm' | 'back' | 'skip';
/** 界面（§7.1）。 */
export type ScreenName = 'boot' | 'title' | 'chapters' | 'settings' | 'notes' | 'intro' | 'play' | 'pause' | 'fail' | 'outro' | 'credits';
/** 工作包 id（§8.10）。 */
export type WpId = 'CORE' | 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5' | 'WP6' | 'WP7' | 'WP8';

/** 跑段场景件（§5.9）；'placeholder' 是 CORE 的盒子走廊。 */
export type KitId = 'classroom' | 'corridor' | 'washroom' | 'stairs' | 'canteen' | 'labRoom' | 'street' | 'plaza' | 'track' | 'placeholder';
/** 静场场景（§5.9）。 */
export type SetId = 'deskFeet' | 'counter' | 'canteenWindow' | 'labBoard' | 'bus' | 'home' | 'bathroom' | 'palmEye' | 'water'
  | 'bedroom' | 'infirmary' | 'placeholder';
/** 氛围预设（§5.2）。 */
export type AtmosphereId = 'morning' | 'noon' | 'labNorth' | 'nightIndoor' | 'rainNight' | 'busNight' | 'homeDark'
  | 'dream' | 'dreamGray' | 'dawn' | 'overcast' | 'fluorescent' | 'voidDark';
/** 追随者模式（§2.6）。 */
export type FollowerMode = 'hidden' | 'absent' | 'behind' | 'pressure' | 'synced' | 'ahead';
/** 障碍类别（§2.5）。 */
export type ObstacleClass = 'low' | 'bar' | 'block' | 'soft' | 'pickup';
/** 受击程度：绊 −1，撞 −2（§2.5）。 */
export type HitSeverity = 'stumble' | 'crash';
/** 玩家状态（§2.4、§3）。 */
export type PlayerMode = 'crawl' | 'air' | 'duck' | 'halfStand' | 'stumble' | 'crash' | 'stop' | 'still' | 'rise' | 'stand' | 'fall' | 'down';
/** 字幕样式（§4.0）。 */
export type TextStyle = 'narration' | 'self' | 'other' | 'whisper' | 'board';
/** 说话人（§7.2 字幕规则）。 */
export type Speaker = 'chenMo' | 'englishTeacher' | 'monitor' | 'directorZhou' | 'lunchLady' | 'mathTeacher' | 'teacherMa'
  | 'dreamBoy' | 'classmate';
/** 操作提示 id（附录 B.2）。 */
export type HintId = 'jump' | 'lane' | 'duck' | 'hold' | 'wet' | 'look' | 'ask' | 'tray' | 'wipe' | 'slap' | 'straighten'
  | 'rise' | 'balance' | 'kneel' | 'taps3' | 'fist' | 'anyKey' | 'skip';
/** 镜头机位（§5.4）。 */
export type ShotId = 'follow' | 'glanceLeft' | 'turnBack' | 'puddleDown' | 'mirrorClose' | 'deskFeet' | 'counter' | 'windowSeat'
  | 'labBoard' | 'busWindow' | 'homeCrawl' | 'bathroomMirror' | 'palmEye' | 'waterDown' | 'ceilingCrack' | 'bedFeet'
  | 'infirmaryBed' | 'trackSky' | 'standEye';
/** 脚本姿势（§5.6，WP5 实现）。 */
export type PoseClipId = 'sit' | 'sitEat' | 'busSeat' | 'busSeatNormal' | 'standIdle' | 'standUp' | 'walkUpright' | 'turnAround'
  | 'turnHead' | 'headDown' | 'handstand' | 'crawlToward' | 'crawlReach' | 'tapGlass' | 'palmToGlass' | 'pointMirror'
  | 'pointBack' | 'kneel' | 'lieBack' | 'feetArch' | 'feetArchDesk' | 'answerLean' | 'sitMissFeet' | 'counterStand'
  | 'sinkLean' | 'writeBoard' | 'wipeBoard' | 'touchPillowDent' | 'fistAir' | 'standBehindShoulder' | 'smile';
/** 第三只手的手势（§3）。 */
export type ThirdHandGesture = 'shush' | 'palmGlass' | 'forehead' | 'shoulder' | 'point' | 'neck';
/** 影子模式（§3、§5.8）。 */
export type ShadowMode = 'normal' | 'jellyfish' | 'threeHands' | 'pointBack' | 'pointMirror' | 'long' | 'liesDown' | 'reversed'
  | 'chase' | 'blob';
/** 人群操作（§5.7）。 */
export type CrowdOp = 'turnShoes' | 'centerShoes' | 'silent' | 'applaud' | 'crawlOvertake' | 'normal';
/** NPC 组类型（§5.7）。 */
export type NpcGroupKind = 'seatedRow' | 'standingCluster' | 'walkers' | 'queue' | 'lineSides' | 'onlookerRing' | 'imitators'
  | 'crawlerStream' | 'classmates';
/** 音效 id（§6.2）。 */
export type SfxId = 'heels' | 'monitorSteps' | 'shush' | 'tap' | 'glassTouch' | 'muscle' | 'chairScrape' | 'kneeThud' | 'relay'
  | 'paper' | 'chalk' | 'waterBreak' | 'splash' | 'laughShort' | 'whistle' | 'heartbeat' | 'drip' | 'wind' | 'doorClose'
  | 'soupSpill' | 'bucketKnock' | 'cloth';
/** 环境声 id（§6.2）。 */
export type AmbienceId = 'room' | 'reading' | 'canteen' | 'labWind' | 'nightCorridor' | 'rainStreet' | 'shedRoof' | 'bus' | 'home'
  | 'dream' | 'dreamApplause' | 'dawnStreet' | 'field' | 'infirmary' | 'void' | 'none';
/** 混响预设（§6.1）。 */
export type ReverbId = 'corridor' | 'classroom' | 'washroom' | 'stairwell' | 'canteen' | 'street' | 'bus' | 'bathroom' | 'plaza'
  | 'infirmary' | 'void';
/** 铃声（§6.2）。 */
export type BellKind = 'morning' | 'lunch' | 'class';

/** 轴对齐盒：x 横向、y 竖直、s 沿赛道（§2.3）。 */
export interface AABB { x0: number; x1: number; y0: number; y1: number; s0: number; s1: number }
/** 确定性随机数（§8.3：rng.sim / rng.bot / rng.fx 互不影响）。 */
export interface Rng { next(): number; range(a: number, b: number): number; int(n: number): number; pick<T>(a: readonly T[]): T; fork(salt: string): Rng }
/**
 * 输入事件（§2.2）。`t` 是意图时刻，单位 ms。
 * 由 InputAPI 产生时是 performance.now() 时间轴；Game 在交给 SimAPI.step() 之前会换算成**模拟时钟毫秒**
 * （即 SimSnapshot.t × 1000 的时间轴），Sim 只使用后者做「干脆」判定。
 */
export interface InputEvent { action: Action; phase: 'down' | 'up'; t: number /* 意图时刻 ms */; device: Device }

// ——— 模拟快照：View / Audio / UI 只读（§8.3）———
/** 站立段快照（§3「站起来」，WP1 实现）。 */
export interface StandSnap {
  script: 'dream' | 'sevenSteps';
  phase: 'wait' | 'rising' | 'walking' | 'planted' | 'fallen';
  held: number; steps: number; stepT: number; theta: number; x: number;
}
/** 玩家快照（§2.3–§2.6）。 */
export interface PlayerSnap {
  s: number; x: number; y: number; floorY: number;
  lane: Lane; laneTarget: Lane;
  mode: PlayerMode; modeT: number;
  speed: number; cadence: number; stride: number;
  beat: number;                        // 连续相位（拍）；整数时刻就是落掌
  airT: number; duck: number;          // 0..1
  twitch: number; drift: number;       // 腿抬起 0..1；鞋尖偏转 −1..1
  steady: number; steadyMax: number;
  graceT: number; surface: Surface; hitbox: AABB;
  lookBack: number;                    // 0..1 镜头转向身后的程度
  carrying: 'none' | 'tray' | 'bag';
  stand: StandSnap | null;
}
/** 追随者快照（§2.6）。 */
export interface FollowerSnap {
  mode: FollowerMode; voice: 'echo' | 'none'; hud: 'dots' | 'shadow' | 'none'; from: 'behind' | 'front';
  lagBeats: number;                    // 身后为正，前方为负
  distance: number;                    // ahead：领跑者距离；pressure(影子)：影子在身后的距离
  leaderS: number | null; leaderLane: Lane | null;
}
/** 静场快照（§2.2 静场）。 */
export interface StillSnap { set: SetId; variant: string; t: number; duration: number; prompt: HintId | null; held: number }
/** 结尾统计（附录 B.6）。 */
export interface RunStats { timeMs: number; falls: number; stumbles: number; crashes: number; lookBacks: number; notes: string[] }
/** 每 tick 一份的模拟快照；View 用 prev/next 插值（§8.3）。 */
export interface SimSnapshot {
  tick: number; t: number;
  chapter: ChapterId; segment: string; segIndex: number; segKind: 'run' | 'still' | 'stand'; segBeat: number;
  checkpoint: { segment: string; beat: number };
  player: PlayerSnap; follower: FollowerSnap; still: StillSnap | null;
  hush: boolean; flip: boolean; slowOption: boolean;
  stats: RunStats; beatsFired: readonly string[];
}
