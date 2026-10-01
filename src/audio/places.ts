// src/audio/places.ts —— 各 kit / set 的环境音、混响与嗡鸣（DESIGN.md §6.1 混响表、§8.10 WP7「各 kit 和 set 的环境音」）。WP7。
// 「地点」= 跑段 / 站立段的 kit.variant，或静场的 set.variant。进入一个新地点时，混响交叉淡变到该地点的预设，
// 环境音换成该地点的缺省值；关卡里的 ambience cue 随后可以覆盖（同一 tick 内的 cue 优先）。
// 本表是 WP7 的声音设计；EnvKit.ambience() / reverb() 只在本表没有收录的 variant 上作为回落。
import type { AmbienceId, CrowdOp, KitId, ReverbId, SetId } from '../core/types';
import type { ChapterDef, EventBody, SegmentDef, StillInput, TimedEventDef } from '../levels/schema';

/** 混响衰减时间（秒，§6.1）。 */
export const REVERB_RT60: Readonly<Record<ReverbId, number>> = {
  corridor: 1.2, classroom: 0.7, washroom: 0.9, stairwell: 1.8, canteen: 1.1, street: 0.4, bus: 0.3,
  bathroom: 0.7, plaza: 3.0, infirmary: 0.5, void: 4.0,
};

/** 雨声的听感位置：露天 / 车里（整体低通 900 Hz）/ 室内（隔着窗，远而闷）。 */
export type RainExposure = 'open' | 'bus' | 'indoor';

export interface Place {
  key: string;
  reverb: ReverbId;
  ambience: AmbienceId;
  /** 缺省环境音的电平（0..1，乘在配方电平上）。 */
  ambLevel: number;
  /** 有灯管：嗡鸣跟随灯光亮度（§6.2「灯管嗡鸣」）。 */
  hum: boolean;
  rain: RainExposure;
}

type PlaceSpec = Omit<Place, 'key'>;
const P = (reverb: ReverbId, ambience: AmbienceId, hum: boolean, rain: RainExposure = 'indoor', ambLevel = 1): PlaceSpec =>
  ({ reverb, ambience, ambLevel, hum, rain });

/** 跑段 / 站立段的 kit.variant（缺省用 `${kit}.*`）。 */
export const KIT_PLACES: Readonly<Record<string, PlaceSpec>> = {
  'classroom.morning':   P('classroom', 'reading', true),
  'classroom.night':     P('classroom', 'nightCorridor', true),
  'classroom.*':         P('classroom', 'room', true),
  'corridor.morning':    P('corridor', 'reading', true),
  'corridor.wet':        P('corridor', 'room', true),            // 值日：早读已经结束，人走光了
  'corridor.mirrorEnd':  P('corridor', 'room', true),
  'corridor.labNorth':   P('corridor', 'labWind', true),
  'corridor.night':      P('corridor', 'nightCorridor', true),
  'corridor.recess':     P('corridor', 'reading', true, 'indoor', 0.8),   // 课间：一层人声
  'corridor.void':       P('void', 'void', false),
  'corridor.*':          P('corridor', 'room', true),
  'washroom.*':          P('washroom', 'reading', true, 'indoor', 0.45),  // 隔着墙的早读
  'stairs.dayDown':      P('stairwell', 'room', true),
  'stairs.nightDown':    P('stairwell', 'nightCorridor', true),
  'stairs.stairwellUp':  P('stairwell', 'nightCorridor', true),   // 声控灯：嗡鸣只在灯亮时出现
  'stairs.dawnDown':     P('stairwell', 'home', true),
  'stairs.*':            P('stairwell', 'room', true),
  'canteen.*':           P('canteen', 'canteen', true),
  'labRoom.*':           P('classroom', 'labWind', true),
  'street.dawn':         P('street', 'dawnStreet', false, 'open'),
  'street.*':            P('street', 'rainStreet', false, 'open'),
  'plaza.*':             P('plaza', 'dream', false, 'open'),
  'track.*':             P('street', 'field', false, 'open'),
  'placeholder.*':       P('corridor', 'room', true),
};

/** 静场的 set.variant（缺省用 `${set}.*`）。 */
export const SET_PLACES: Readonly<Record<string, PlaceSpec>> = {
  'deskFeet.teacher':    P('classroom', 'reading', true),
  'deskFeet.*':          P('classroom', 'room', true),
  'counter.*':           P('canteen', 'canteen', true),
  'canteenWindow.*':     P('canteen', 'canteen', true, 'indoor', 0.75),
  'labBoard.*':          P('classroom', 'labWind', true),
  'bus.*':               P('bus', 'bus', false, 'bus'),
  'home.*':              P('classroom', 'home', false),
  'bathroom.*':          P('bathroom', 'home', false),
  'palmEye.*':           P('plaza', 'dream', false, 'open'),
  'water.*':             P('plaza', 'dream', false, 'open'),
  'bedroom.*':           P('infirmary', 'home', false),
  'infirmary.*':         P('infirmary', 'infirmary', true),
  'placeholder.*':       P('classroom', 'room', true),
};

export type KitLookup = (kit: KitId, variant: string) => { ambience: AmbienceId; reverb: ReverbId } | null;

function lookup(table: Readonly<Record<string, PlaceSpec>>, id: string, variant: string): PlaceSpec | null {
  return table[`${id}.${variant}`] ?? table[`${id}.*`] ?? null;
}

/** 某一段的地点。kitLookup：已注册的 EnvKit（本表没有收录时回落）。 */
export function placeOf(seg: SegmentDef, kitLookup?: KitLookup): Place {
  if (seg.kind === 'still') {
    const variant = seg.variant ?? 'default';
    const spec = lookup(SET_PLACES, seg.set, variant) ?? (SET_PLACES['placeholder.*'] as PlaceSpec);
    return { key: `set:${seg.set}.${variant}`, ...spec };
  }
  const variant = seg.variant;
  let spec = lookup(KIT_PLACES, seg.kit, variant);
  if (!spec) {
    const k = kitLookup?.(seg.kit, variant) ?? null;
    spec = k ? P(k.reverb, k.ambience, true) : (KIT_PLACES['placeholder.*'] as PlaceSpec);
  }
  return { key: `kit:${seg.kit}.${variant}`, ...spec };
}

/** 全部 set 与 kit 的 variant 是否都有地点（测试用）。 */
export function placeKnown(kind: 'kit' | 'set', id: KitId | SetId, variant: string): boolean {
  return lookup(kind === 'kit' ? KIT_PLACES : SET_PLACES, id, variant) !== null;
}

// ——————————————————— 梦中掌声 ———————————————————
/** 梦中掌声的状态（§6.2「梦中掌声」）：density 稀疏 → 稠密，align 散 → 整齐的一片。 */
export interface ApplauseState { density: number; align: number }
export const APPLAUSE_DEFAULT: Readonly<ApplauseState> = { density: 0.5, align: 0 };
/**
 * crowd cue 对掌声的影响。applaud（「整齐的鼓掌」）与 crawlOvertake（所有人爬着超过你：「掌根同时落下，发出一声巨大的、
 * 整齐的拍击，像雷声，像掌声」）→ 稠密、整齐；normal → 散开。其余 op 不影响。
 * 这是章内的状态（像环境音一样跨段保持）：4-3 的人群超过你之后，4-4 那阵「新的掌声」也是整齐的。
 */
export function applauseAfter(s: Readonly<ApplauseState>, op: CrowdOp): ApplauseState {
  if (op === 'applaud' || op === 'crawlOvertake') return { density: 1, align: 1 };
  if (op === 'normal') return { density: s.density, align: 0 };
  return { ...s };
}

// ——————————————————— 读档 / 重来时重建声音状态 ———————————————————
export interface AmbState { amb: AmbienceId; level: number }
export interface SoundState { place: Place; ambience: AmbState; rain: number; applause: ApplauseState }

interface Flat { at: number; body: EventBody }

/** 一段里所有会影响声音状态的事件，按段内位置（跑段 = 拍，其余 = 秒）排序；嵌套时间线挂在父事件的位置上。 */
function flatEvents(seg: SegmentDef): Flat[] {
  const out: Flat[] = [];
  const push = (at: number, body: EventBody) => {
    out.push({ at, body });
    if (body.type === 'slow' && body.timeline) for (const t of body.timeline) out.push({ at, body: strip(t) });
    if (body.type === 'stop') for (const t of body.timeline) out.push({ at, body: strip(t) });
  };
  for (const e of seg.events ?? []) {
    const at = 'at' in e ? (e.at as number) : 0;
    push(at, strip(e as TimedEventDef));
  }
  if (seg.kind === 'run') {
    for (const w of seg.windows ?? []) for (const t of w.then ?? []) out.push({ at: w.from, body: strip(t) });
  }
  const input: StillInput | undefined = seg.kind === 'run' ? undefined : seg.input;
  if (input) for (const t of input.onDone ?? []) out.push({ at: input.at, body: strip(t) });
  out.sort((a, b) => a.at - b.at);
  return out;
}

function strip(e: TimedEventDef | (EventBody & { at?: number; id?: string; atStep?: number; delay?: number })): EventBody {
  const { at: _a, id: _i, atStep: _s, delay: _d, ...rest } = e as Record<string, unknown>;
  return rest as unknown as EventBody;
}

/**
 * 章内某一位置（段序号 + 段内位置）的声音状态：地点、环境音、雨、梦中掌声。
 * 规则与运行时一致：进入新地点时环境音换成地点缺省；ambience / rain cue 覆盖。
 */
export function soundStateAt(def: ChapterDef, segIndex: number, pos: number, kitLookup?: KitLookup): SoundState | null {
  const segs = def.segments;
  if (!segs.length) return null;
  const last = Math.max(0, Math.min(segIndex, segs.length - 1));
  let place: Place | null = null;
  let ambience: AmbState = { amb: 'none', level: 1 };
  let rain = 0;
  let applause: ApplauseState = { ...APPLAUSE_DEFAULT };
  for (let j = 0; j <= last; j++) {
    const seg = segs[j] as SegmentDef;
    const p = placeOf(seg, kitLookup);
    if (!place || p.key !== place.key) ambience = { amb: p.ambience, level: p.ambLevel };
    place = p;
    for (const e of flatEvents(seg)) {
      if (j === last && e.at >= pos - 1e-9) break;
      if (e.body.type === 'ambience') ambience = { amb: e.body.amb, level: e.body.level };
      else if (e.body.type === 'rain') rain = e.body.intensity;
      else if (e.body.type === 'crowd') applause = applauseAfter(applause, e.body.op);
    }
  }
  return place ? { place, ambience, rain, applause } : null;
}
