// tests/unit/core/integration.test.ts —— lead 集成检查（DESIGN.md §10.2）：章节数据引用的跨包 id 必须真的存在。
// validate 只看关卡数据本身；这里把数据和画面包的注册表对上：静场 cue 的反光面 / 黑板 id 在 set 的 surfaces() 里，
// 跑段替身 / 回忆的 surface 在本段声明过，静场机位有 SET_SHOTS，crowd cue 的组存在（或写 '*'）。
import { describe, expect, it } from 'vitest';
import '../../../src/render/sets/school/index';
import '../../../src/render/sets/outside/index';
import { getSet } from '../../../src/core/registry';
import { SET_SHOTS } from '../../../src/render/camera/shots';
import { CHAPTER_ORDER, getChapter } from '../../../src/levels/chapters/index';
import type { EventBody, SegmentDef } from '../../../src/levels/schema';

type AnyEvent = EventBody & { at?: number; timeline?: AnyEvent[] };

function eventsOf(sd: SegmentDef): AnyEvent[] {
  const out: AnyEvent[] = [];
  const walk = (evs: readonly unknown[] | undefined) => {
    for (const raw of evs ?? []) {
      const e = raw as AnyEvent;
      out.push(e);
      if (e.type === 'stop' && e.timeline) walk(e.timeline);
    }
  };
  walk(sd.events as unknown[] | undefined);
  for (const w of (sd as { windows?: Array<{ then?: unknown[] }> }).windows ?? []) walk(w.then);
  walk((sd as { input?: { onDone?: unknown[] } }).input?.onDone);
  return out;
}

const RUN_SHOTS = new Set(['follow', 'turnBack', 'glanceLeft', 'puddleDown', 'mirrorClose']);

describe('章节数据与画面包的 id 对得上', () => {
  for (const id of CHAPTER_ORDER) {
    const def = getChapter(id);
    if (!def) continue;
    it(id, () => {
      const problems: string[] = [];
      const groups = new Set(def.segments.flatMap((s) => ('npcs' in s ? (s.npcs ?? []) : []).map((g) => g.id)));
      for (const sd of def.segments) {
        const evs = eventsOf(sd);
        if (sd.kind === 'still') {
          const set = getSet(sd.set);
          if (!set) { problems.push(`${sd.id}: set ${sd.set} is not registered`); continue; }
          const ids = new Set((set.surfaces?.(sd.variant ?? 'default') ?? []).map((s) => s.id));
          for (const e of evs) {
            const sf = e.type === 'double' ? e.spec.surface : e.type === 'board' ? e.surface : null;
            if (sf && sf !== 'world' && !ids.has(sf)) problems.push(`${sd.id}: ${e.type} surface '${sf}' is not on set ${sd.set}`);
            if (e.type === 'camera' && !(e.shot in SET_SHOTS) && !RUN_SHOTS.has(e.shot)) problems.push(`${sd.id}: camera shot ${e.shot} has no SET_SHOTS entry`);
          }
        } else {
          const ids = new Set((sd.kind === 'run' ? sd.surfaces ?? [] : []).map((s) => s.id));
          for (const e of evs) {
            const sf = e.type === 'double' ? e.spec.surface : e.type === 'memory' ? e.surface : null;
            if (sf && sf !== 'world' && !ids.has(sf)) problems.push(`${sd.id}: ${e.type} surface '${sf}' is not declared in this segment`);
          }
        }
        for (const e of evs) if (e.type === 'crowd' && e.group !== '*' && !groups.has(e.group)) problems.push(`${sd.id}: crowd group ${e.group} does not exist`);
      }
      expect(problems).toEqual([]);
    });
  }
});
