// src/render/npc/specials.ts —— NPC 的外观与特殊 NPC 的识别（DESIGN.md §5.7「特殊 NPC」、附录 A-4）。
// 所有人都没有五官：头只是皮肤色的块，另外几面是头发。NPC 默认只建到腰带（「视线里只有膝盖和腰带」）。
// 特殊 NPC 靠数据里的 id 识别（ItemDef.id → CompiledObstacle.params.itemId，或 NpcGroupDef.id），大小写不敏感；
// 推荐直接用 Speaker 名（types.ts）：chenMo、directorZhou、teacherMa、monitor、dreamBoy。
//   陈默       kind 'chenMo'（能下蹲，全作唯一出现在你视线高度的头）；它身后同车道 4 m 内 id 含 chenmo 的 footOut 是他留在过道里的脚
//   周主任     legs + id ∈ {directorZhou, zhou, director}；或 street.schoolGate 里带 id 的 legs：灰夹克下摆、指间烟头一明一灭
//   马老师     legs + id ∈ {teacherMa, ma, coach, pe}：黑色运动裤、两侧白条
//   班长       npc 组 id ∈ {monitor, banzhang}：只有脚和一摞作业本的下沿，渐远
//   梦里的男生  kneeler + fallInto 行为，或 id ∈ {dreamBoy, boy}：干净的裤脚和鞋
import { createRng } from '../../core/rng';
import { reducedPulse } from './behaviors';
import type { KitId } from '../../core/types';
import type { CompiledObstacle, NpcGroupDef } from '../../levels/schema';
import { C } from './colors';

export type SpecialId = 'chenMo' | 'directorZhou' | 'teacherMa' | 'monitor' | 'dreamBoy';

const ALIASES: Record<SpecialId, readonly string[]> = {
  chenMo: ['chenmo', 'chen_mo', 'chen-mo'],
  directorZhou: ['directorzhou', 'zhou', 'director', 'zhouzhuren'],
  teacherMa: ['teacherma', 'ma', 'mateacher', 'coach', 'pe', 'peteacher'],
  monitor: ['monitor', 'banzhang', 'classmonitor'],
  dreamBoy: ['dreamboy', 'boy', 'imitatorboy'],
};

/** 按 id 识别特殊 NPC（先整词匹配，再子串匹配几个不会误判的长词）。 */
export function specialById(id: string | undefined | null): SpecialId | null {
  if (!id) return null;
  const k = id.toLowerCase().replace(/[^a-z_-]/g, '');
  for (const [sp, al] of Object.entries(ALIASES) as Array<[SpecialId, readonly string[]]>) if (al.includes(k)) return sp;
  if (k.includes('chenmo')) return 'chenMo';
  if (k.includes('zhou')) return 'directorZhou';
  if (k.includes('teacherma')) return 'teacherMa';
  if (k.includes('monitor')) return 'monitor';
  if (k.includes('dreamboy')) return 'dreamBoy';
  return null;
}

export function itemIdOf(o: CompiledObstacle): string | null {
  const v = o.params.itemId;
  return typeof v === 'string' ? v : null;
}

/** 障碍对应的特殊 NPC（没有则 null）。 */
export function specialOfObstacle(o: CompiledObstacle, kit: KitId, variant: string): SpecialId | null {
  if (o.kind === 'chenMo') return 'chenMo';
  const byId = specialById(itemIdOf(o));
  if (o.kind === 'kneeler') return o.behavior.type === 'fallInto' || byId === 'dreamBoy' ? 'dreamBoy' : null;
  if (o.kind !== 'legs') return byId === 'chenMo' && o.kind === 'footOut' ? 'chenMo' : null;
  if (byId === 'directorZhou' || byId === 'teacherMa') return byId;
  if (kit === 'street' && variant === 'schoolGate' && itemIdOf(o)) return 'directorZhou';
  if (kit === 'track' && itemIdOf(o)) return 'teacherMa';
  return byId === 'chenMo' ? 'chenMo' : null;
}

export function specialOfGroup(g: NpcGroupDef): SpecialId | null {
  const sp = specialById(g.id);
  return sp === 'monitor' ? 'monitor' : null;
}

// ——— 外观 ———
/** 髋部件的变体号（LegForest 的 hips 几何体）。 */
export const HIPS = { trousers: 0, skirt: 1, jacket: 2, books: 3, fullUpper: 4, trackPants: 5, noHands: 6, arms: 7 } as const;
export type HipsVariant = (typeof HIPS)[keyof typeof HIPS];
/** 腿部件的变体号：0 普通裤腿；1 两侧白条（运动裤）；2 光腿 / 丝袜（裙装）。 */
export const LEGV = { plain: 0, stripe: 1, bare: 2 } as const;

export interface Look {
  pants: number; shirt: number; shoes: number; skin: number;
  hips: HipsVariant; legs: number; shoe: 0 | 1; hair: 0 | 1;
  /** 是否显示躯干和头（梦里、站立段、陈默）。 */
  upper: boolean;
  /** 自发光（周主任的烟头），由 ObstacleView 每帧调制。 */
  ember: boolean;
}

export type Crowd = 'student' | 'dream' | 'street' | 'track' | 'teacher';

export function crowdOfKit(kit: KitId): Crowd {
  switch (kit) {
    case 'plaza': return 'dream';
    case 'street': return 'street';
    case 'track': return 'track';
    default: return 'student';
  }
}

const PICK = {
  student: { pants: [0x2a3a52, 0x26344a, 0x2f3f58, 0x1e2226], shirt: [0x2f4a6d, 0x2b4466, 0xd9dee3], shoes: [0xd9dee3, 0x2b3034, 0xb7bdbb, 0x3c4650] },
  dream: { pants: [0x7e878b, 0x8a9396, 0x737c80, 0x9aa3a6], shirt: [0x9aa3a6, 0xb7bdbb, 0xa8b0b3], shoes: [0xcfd4d6, 0xb7bdbb, 0x9aa3a6] },
  street: { pants: [0x2a3136, 0x3a464d, 0x1c2227, 0x33404a], shirt: [0x3a464d, 0x2a3136, 0x50606a], shoes: [0x1e2226, 0x2b3034, 0x50606a] },
  track: { pants: [0x2a3a52, 0x1e2226, 0x2f4a6d], shirt: [0xd9dee3, 0xcfd4d6, 0x2f4a6d], shoes: [0xd9dee3, 0xcfd4d6, 0x2b3034] },
  teacher: { pants: [0x3f4448, 0x5b6468, 0x2a3136], shirt: [0x5b6468, 0x8a979e], shoes: [0x1e2226, 0x2b3034] },
} as const;

/** 普通人的外观（确定性：同一个 seed 同样的人）。 */
export function lookFor(crowd: Crowd, seed: number, salt: string): Look {
  const r = createRng(seed, `look:${salt}`);
  const p = PICK[crowd];
  const skirt = crowd === 'teacher' && r.next() < 0.3;
  const stripes = crowd === 'track' && r.next() < 0.5;
  return {
    pants: r.pick(p.pants), shirt: r.pick(p.shirt), shoes: r.pick(p.shoes), skin: C.skin,
    hips: skirt ? HIPS.skirt : stripes ? HIPS.trackPants : HIPS.trousers,
    legs: skirt ? LEGV.bare : stripes ? LEGV.stripe : LEGV.plain,
    shoe: skirt ? 1 : 0, hair: r.next() < 0.45 ? 1 : 0, upper: crowd === 'dream', ember: false,
  };
}

/** 特殊 NPC 的外观。 */
export function specialLook(sp: SpecialId): Look {
  switch (sp) {
    case 'chenMo':
      return { pants: C.trousers, shirt: C.uniform, shoes: 0xd9dee3, skin: C.skin, hips: HIPS.fullUpper, legs: LEGV.plain, shoe: 0, hair: 0, upper: true, ember: false };
    case 'directorZhou':
      return { pants: 0x5b5f5e, shirt: C.zhouJacket, shoes: 0x1e2226, skin: C.skin, hips: HIPS.jacket, legs: LEGV.plain, shoe: 0, hair: 0, upper: false, ember: true };
    case 'teacherMa':
      return { pants: C.maPants, shirt: 0x2a3136, shoes: 0xd9dee3, skin: C.skin, hips: HIPS.trackPants, legs: LEGV.stripe, shoe: 0, hair: 0, upper: false, ember: false };
    case 'monitor':
      return { pants: C.trousers, shirt: C.uniform, shoes: 0xd9dee3, skin: C.skin, hips: HIPS.books, legs: LEGV.plain, shoe: 0, hair: 1, upper: false, ember: false };
    case 'dreamBoy':
      return { pants: 0xaeb4b7, shirt: 0xc3c8cb, shoes: 0xe4e8ea, skin: C.skin, hips: HIPS.trousers, legs: LEGV.plain, shoe: 0, hair: 0, upper: true, ember: false };
  }
}

/** 烟头最亮时的自发光强度。 */
export const EMBER_PEAK = 1.6;
/**
 * 周主任的烟头：一明一灭，「像某种小型的心跳」（约 0.8 Hz，0.35 → 1.6，远低于 3 Hz 闪烁上限）。
 * 「减少闪烁」打开时换成 0.5 Hz 的平滑明暗，最低是峰值的 0.4（§7.3）。
 */
export function emberGlow(t: number, reducedFlicker = false): number {
  if (reducedFlicker) return EMBER_PEAK * reducedPulse(t);
  const u = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.6);
  return 0.35 + (EMBER_PEAK - 0.35) * u * u;
}
