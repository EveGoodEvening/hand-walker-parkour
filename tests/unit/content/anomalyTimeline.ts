// tests/unit/content/anomalyTimeline.ts —— 附录 A-11「任意 20 s 内最多一个主异常」按 Sim 时间轴检查（含静场、站立段、跨段）。归 WP2。
//
// 校验器的 R6 只看跑段（静场里的异常不查），也不看段定义带来的追随者变化。这里把整章交给 Sim，用 perfect 自动驾驶跑完
// （零受击；静场输入一出现就完成，这是异常最密的时序），按实际触发时刻收集主异常，再按「场景」检查间隔。
//
// 主异常（与 validate.ts 的 R6 一致，另加三条说明）：
//   · cue：`doubleMod`、`memory`、`board`、`shadow`（normal / blob 除外）。
//     `board` 里玩家自己擦字、写字（`byPlayer`）不算：「因为我站不起来。」是他擦掉问题后自己写的，不是异常（AGENTS.md）。
//   · `double` 只是反光面开始工作，不算（§10.1 R6）。但替身一出现就带着异常的——带第三只手、站在别人身后（attachBehind）、
//     或者就站在世界里（surface 'world'）——算；同一段里之后对它的 `doubleMod` 是同一次异常的后续演出。
//   · 追随者登场：从「感觉不到」变成「听得见或 HUD 看得见空心点」（voice = echo 或 hud = dots），不论是段内事件还是跑段定义。
//     静场 / 站立段的段定义（§4 各章表格里静场的追随者一栏写的是「静音」）不改变这个状态，所以静场之后回到 behind、
//     behind 升级成 pressure 都不是登场（validate.ts 的 isMainAnomaly 也是只有 hidden / absent → 其他模式才算）。
//     3-5 公交（静场）→ 3-6 pressure 就按这一条不算登场，等 lead 裁定（docs/contract-requests/WP2.md）。
//     hud = shadow 表示追随者就是地上的那个影子：它的登场就是本段前面那条 shadow cue，不另算（5-3：@30 反向的影子，
//     @44 它开始朝你爬）；本段前面没有 shadow cue 时单独算一次。
//   · 回头窗口 then 里的异常：玩家可以在窗口里任何时刻回头（自动回头的窗口在窗口结束时），所以时刻取区间
//     [按窗口开始回头, 按窗口结束回头]，与前一个场景比最早时刻，与后一个场景比最晚时刻（§10.1 R6 的最坏时序）。
//
// 场景：一个静场或站立段里的全部主异常是同一个场景（2-9、3-10、4-3 按设计就是一个场景里连着演出）；跑段里每个主异常各是一个场景
// （上面两条「后续演出」除外）。相邻两个场景之间：后一个的最早时刻 − 前一个的最晚时刻 ≥ 20 s。
import type { GameEvent } from '../../../src/core/events';
import { compile } from '../../../src/levels/compile';
import type { ChapterDef, EventBody, RunSegmentDef } from '../../../src/levels/schema';
import { Sim } from '../../../src/sim/Sim';
import { solver } from '../../../src/sim/Solver';

export interface Anomaly { a: number; b: number; t: number; seg: string; kind: 'run' | 'still' | 'stand'; what: string; scene: number }
export interface Scene { id: number; seg: string; a: number; b: number; items: Anomaly[] }
export interface AnomalyRun { anomalies: Anomaly[]; scenes: Scene[]; violations: string[]; ended: boolean; hits: number; falls: number; t: number }

export const A11_MIN_GAP = 20;

type Presence = 'none' | 'shadow' | 'present';
function presence(f: { mode: string; voice: string; hud: string }): Presence {
  if (f.mode === 'hidden' || f.mode === 'absent') return 'none';
  if (f.voice === 'echo' || f.hud === 'dots') return 'present';
  if (f.hud === 'shadow') return 'shadow';
  return 'none';
}

const strip = (e: Record<string, unknown>): string => { const { at: _a, id: _i, ...rest } = e; return JSON.stringify(rest); };

/** 用 Sim 跑一章，返回主异常、场景与违反 A-11 的地方。 */
export function anomalyRun(def: ChapterDef, seed?: number, maxSec = 600): AnomalyRun {
  const sim = new Sim(solver);
  sim.load(compile(def, seed), undefined, seed);
  sim.setAutopilot('perfect');
  const anomalies: Anomaly[] = [];
  let sceneSeq = 0;
  let seg = { id: '', kind: 'run' as 'run' | 'still' | 'stand' };
  let stillScene = -1;                                   // 当前静场 / 站立段的场景号
  const segDouble = new Map<string, number>();           // 本段里算过的替身 id → 场景号
  let segShadowScene = -1;                               // 本段最近一条 shadow 异常的场景号
  let pres: Presence = 'none';
  // 回头窗口：本段各窗口的开始 / 结束时刻，以及回头之后的 then 事件
  let wins: Array<{ from: number; to: number; then: Set<string>; tFrom: number; tTo: number }> = [];
  let look: { tPress: number; win: number } | null = null;
  const lookItems: Array<{ an: Anomaly; tPress: number; win: (typeof wins)[number] }> = [];
  let ended = false, hits = 0, falls = 0, t = 0;

  const push = (what: string, sceneOf?: number): Anomaly => {
    const scene = sceneOf ?? (seg.kind !== 'run' ? (stillScene < 0 ? (stillScene = sceneSeq++) : stillScene) : sceneSeq++);
    const an: Anomaly = { a: t, b: t, t, seg: seg.id, kind: seg.kind, what, scene };
    anomalies.push(an);
    return an;
  };

  const onCue = (body: EventBody, id: string | undefined) => {
    const tag = id ? ` #${id}` : '';
    let an: Anomaly | null = null;
    switch (body.type) {
      case 'doubleMod': an = push(`doubleMod ${body.target}${tag}`, segDouble.get(body.target)); break;
      case 'memory': an = push(`memory ${body.what}${tag}`); break;
      case 'board': if (!body.byPlayer) an = push(`board ${body.op}${tag}`); break;
      case 'shadow':
        if (body.mode !== 'normal' && body.mode !== 'blob') { an = push(`shadow ${body.mode}${tag}`); segShadowScene = an.scene; }
        break;
      case 'double': {
        const s = body.spec;
        if (s.thirdHand || s.attachBehind || s.surface === 'world') { an = push(`double ${s.id}${tag}`); segDouble.set(s.id, an.scene); }
        break;
      }
      default: break;
    }
    if (an && look && seg.kind === 'run') {
      const w = wins[look.win];
      if (w && w.then.has(JSON.stringify(body))) lookItems.push({ an, tPress: look.tPress, win: w });
    }
  };

  const handle = (evs: readonly GameEvent[]) => {
    let enteredStill = false;
    for (const e of evs) {
      switch (e.type) {
        case 'segment': {
          seg = { id: e.data.id, kind: e.data.kind };
          enteredStill = e.data.kind !== 'run';
          stillScene = -1; segDouble.clear(); segShadowScene = -1; look = null;
          const sd = def.segments[e.data.index];
          wins = sd?.kind === 'run'
            ? ((sd as RunSegmentDef).windows ?? []).filter((w) => w.type === 'lookBack')
              .map((w) => ({ from: w.from, to: w.to, then: new Set((w.then ?? []).map((x) => strip(x as never))), tFrom: NaN, tTo: NaN }))
            : [];
          break;
        }
        case 'follower': {
          if (enteredStill) break;                       // 静场 / 站立段的段定义：静音的场景，不改变追随者的状态
          const p = presence(e.data);
          if (pres !== 'present' && p === 'present') push(`follower ${e.data.mode}`);
          else if (pres === 'none' && p === 'shadow') push(`follower ${e.data.mode} (hud shadow)`, segShadowScene >= 0 ? segShadowScene : undefined);
          pres = p;
          break;
        }
        case 'cue': onCue(e.data.body, e.data.id); break;
        case 'lookBack':
          if (e.data.phase === 'start') {
            const beat = sim.snapshot().segBeat;
            const k = wins.findIndex((w) => beat >= w.from - 1e-6 && beat <= w.to + 1);
            look = k >= 0 ? { tPress: t, win: k } : null;
          }
          break;
        case 'hit': hits++; break;
        case 'fall': falls++; break;
        case 'chapter:end': ended = true; break;
        default: break;
      }
    }
  };

  handle(sim.drain());
  for (let i = 0; i < maxSec * 120 && !ended; i++) {
    sim.step([], new Set());
    const snap = sim.snapshot();
    t = snap.t;
    if (snap.segKind === 'run') for (const w of wins) {
      if (Number.isNaN(w.tFrom) && snap.segBeat >= w.from) w.tFrom = t;
      if (Number.isNaN(w.tTo) && snap.segBeat >= w.to) w.tTo = t;
    }
    handle(sim.drain());
  }
  // 回头窗口里的异常：区间 [按窗口开始回头, 按窗口结束回头]
  for (const { an, tPress, win } of lookItems) {
    if (!Number.isNaN(win.tFrom)) an.a = an.t - (tPress - win.tFrom);
    if (!Number.isNaN(win.tTo)) an.b = an.t + Math.max(0, win.tTo - tPress);
  }

  const byScene = new Map<number, Scene>();
  for (const an of anomalies) {
    const sc = byScene.get(an.scene) ?? { id: an.scene, seg: an.seg, a: Infinity, b: -Infinity, items: [] };
    sc.a = Math.min(sc.a, an.a); sc.b = Math.max(sc.b, an.b); sc.items.push(an);
    byScene.set(an.scene, sc);
  }
  const scenes = [...byScene.values()].sort((x, y) => x.a - y.a);
  const violations: string[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const p = scenes[i - 1] as Scene, q = scenes[i] as Scene;
    const gap = q.a - p.b;
    if (gap < A11_MIN_GAP - 1e-6) {
      const last = p.items.reduce((x, y) => (y.b > x.b ? y : x));
      const first = q.items.reduce((x, y) => (y.a < x.a ? y : x));
      violations.push(`${last.seg} ${last.what} (${last.b.toFixed(2)} s) → ${first.seg} ${first.what} (${first.a.toFixed(2)} s): ${gap.toFixed(1)} s`);
    }
  }
  return { anomalies, scenes, violations, ended, hits, falls, t };
}
