// src/core/registry.ts —— 注册表（DESIGN.md §8.2 防冲突规则 3、§8.4）。CORE 冻结。
// 各包在自己的 index.ts 里调用 register*()；某个包还没注册时自动回落到 CORE 的占位实现（core/fallbacks.ts
// 或 main.ts 固定 import 的 render/kits/placeholder.ts、render/sets/placeholder.ts），所以任何一个包单独合并进来游戏都能跑。
// 与 §8.4 的差异：多了 registerView()（Game 需要 ViewAPI，§8.4 的列表里漏了）和若干 get*() 读取函数。
import type {
  ArchetypeFactory, ArchetypeId, AudioAPI, EnvKit, InputAPI, LampFieldAPI, MaterialsAPI, RigFactory, SimAPI, SolverAPI, StillSet,
  TextureBank, UIAPI, ViewAPI, ViewContext, ViewSystem,
} from './contracts';
import { CUE_OWNER } from './constants';
import type { Bus } from './events';
import type { Settings } from './settings';
import type { AtmosphereId, KitId, SetId, SimSnapshot, WpId } from './types';
import type { CompiledSegment, EventBody } from '../levels/schema';

export interface AtmospherePreset {
  fog: { color: number; near: number; far: number }; hemi: { sky: number; ground: number; intensity: number };
  dir: { color: number; intensity: number; dir: [number, number, number] } | null; planarDir: [number, number, number];
  lampGain: number; lampColor: number; chalkMin: number; dark: boolean; background: number;
}
export interface CueContext { view: ViewContext; snap: SimSnapshot; segment: CompiledSegment; emit(body: EventBody): void }
export type CueHandler<T extends EventBody['type'] = EventBody['type']> = (body: Extract<EventBody, { type: T }>, ctx: CueContext) => void;
export type MaterialsFactory = (ctx: Omit<ViewContext, 'mat' | 'lamps' | 'tex' | 'rig'>) => { mat: MaterialsAPI; lamps: LampFieldAPI; tex: TextureBank };

interface Registry {
  viewSystems: Map<string, ViewSystem>;
  kits: Map<KitId, EnvKit>;
  sets: Map<SetId, StillSet>;
  archetypes: Map<ArchetypeId, ArchetypeFactory>;
  atmospheres: Map<AtmosphereId, AtmospherePreset>;
  materials: MaterialsFactory | null;
  rig: ((ctx: ViewContext) => RigFactory) | null;
  sim: ((solver: SolverAPI) => SimAPI) | null;
  solver: SolverAPI | null;
  audio: ((bus: Bus, settings: Settings, mute: boolean) => AudioAPI) | null;
  ui: (() => UIAPI) | null;
  input: (() => InputAPI) | null;
  view: (() => ViewAPI) | null;
  cues: Map<EventBody['type'], { owner: WpId; fn: CueHandler }>;
  debug: Map<string, (...a: unknown[]) => unknown>;
}

const R: Registry = {
  viewSystems: new Map(), kits: new Map(), sets: new Map(), archetypes: new Map(), atmospheres: new Map(),
  materials: null, rig: null, sim: null, solver: null, audio: null, ui: null, input: null, view: null,
  cues: new Map(), debug: new Map(),
};

/** 同 id 的 ViewSystem 后注册者覆盖先注册者（占位实现先注册，正式实现覆盖它）。 */
export function registerViewSystem(s: ViewSystem): void { R.viewSystems.set(s.id, s); }
export function registerKit(k: EnvKit): void { R.kits.set(k.id, k); }
export function registerSet(s: StillSet): void { R.sets.set(s.id, s); }
export function registerArchetype(a: ArchetypeFactory): void { R.archetypes.set(a.id, a); }
export function registerAtmosphere(id: AtmosphereId, p: AtmospherePreset): void { R.atmospheres.set(id, p); }
export function registerMaterials(f: MaterialsFactory): void { R.materials = f; }
export function registerRigFactory(f: (ctx: ViewContext) => RigFactory): void { R.rig = f; }
export function registerSim(f: (solver: SolverAPI) => SimAPI): void { R.sim = f; }
export function registerSolver(s: SolverAPI): void { R.solver = s; }
export function registerAudio(f: (bus: Bus, settings: Settings, mute: boolean) => AudioAPI): void { R.audio = f; }
export function registerUI(f: () => UIAPI): void { R.ui = f; }
export function registerInput(f: () => InputAPI): void { R.input = f; }
/** 扩展（§8.4 未列出）：画面汇总器，CORE → WP3。 */
export function registerView(f: () => ViewAPI): void { R.view = f; }
/** owner 必须等于 CUE_OWNER[type]，否则直接抛错；同一类型重复注册也抛错（§8.7）。 */
export function registerCueHandler<T extends EventBody['type']>(type: T, owner: WpId,
  fn: (body: Extract<EventBody, { type: T }>, ctx: CueContext) => void): void {
  const expected = CUE_OWNER[type];
  if (expected !== owner) throw new Error(`registerCueHandler: cue "${type}" belongs to ${expected}, not ${owner}`);
  if (R.cues.has(type)) throw new Error(`registerCueHandler: cue "${type}" already registered`);
  R.cues.set(type, { owner, fn: fn as unknown as CueHandler });
}
export function registerDebug(name: string, fn: (...a: unknown[]) => unknown): void { R.debug.set(name, fn); }

// ——— 读取（Game / View / cues.ts 用）———
export function getViewSystems(): ViewSystem[] { return Array.from(R.viewSystems.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }
export function getKit(id: KitId): EnvKit | undefined { return R.kits.get(id) ?? R.kits.get('placeholder'); }
export function getSet(id: SetId): StillSet | undefined { return R.sets.get(id) ?? R.sets.get('placeholder'); }
export function getArchetype(id: ArchetypeId): ArchetypeFactory | undefined { return R.archetypes.get(id); }
export function getAtmosphere(id: AtmosphereId): AtmospherePreset | undefined { return R.atmospheres.get(id); }
export function getMaterialsFactory(): MaterialsFactory | null { return R.materials; }
export function getRigFactory(): ((ctx: ViewContext) => RigFactory) | null { return R.rig; }
export function getSimFactory(): ((solver: SolverAPI) => SimAPI) | null { return R.sim; }
export function getSolver(): SolverAPI | null { return R.solver; }
export function getAudioFactory(): ((bus: Bus, settings: Settings, mute: boolean) => AudioAPI) | null { return R.audio; }
export function getUIFactory(): (() => UIAPI) | null { return R.ui; }
export function getInputFactory(): (() => InputAPI) | null { return R.input; }
export function getViewFactory(): (() => ViewAPI) | null { return R.view; }
export function getCueHandler(type: EventBody['type']): { owner: WpId; fn: CueHandler } | undefined { return R.cues.get(type); }
export function getDebugExt(): Record<string, (...a: unknown[]) => unknown> { return Object.fromEntries(R.debug); }
export function hasKit(id: KitId): boolean { return R.kits.has(id); }
export function hasSet(id: SetId): boolean { return R.sets.has(id); }

/** 仅测试用：清空注册表。 */
export function __resetRegistryForTests(): void {
  R.viewSystems.clear(); R.kits.clear(); R.sets.clear(); R.archetypes.clear(); R.atmospheres.clear(); R.cues.clear(); R.debug.clear();
  R.materials = null; R.rig = null; R.sim = null; R.solver = null; R.audio = null; R.ui = null; R.input = null; R.view = null;
}
