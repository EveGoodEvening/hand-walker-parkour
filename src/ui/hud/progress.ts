// src/ui/hud/progress.ts —— 暂停界面的章节进度（DESIGN.md §7.2 Pause：「下方一条 1 px 的细线表示章节进度，检查点是刻度，
// 当前位置是一个点」）。WP8。纯函数：按段落的名义时长估计（跑段 = 拍数 ÷ 步频，渐变步频按 §2.3 的对数公式；静场 / 站立段 = duration）。
// 停拍、减速这些时间线不计入：细线只是示意，不是计时器。不画数字。
import type { ChapterDef, RunSegmentDef, SegmentDef } from '../../levels/schema';

export function segmentSeconds(s: SegmentDef): number {
  if (s.kind !== 'run') return Math.max(0.5, s.duration);
  const r = s as RunSegmentDef;
  const B = Math.max(1, r.beats);
  if (typeof r.cadence === 'number') return B / Math.max(0.5, r.cadence);
  const [c0, c1] = r.cadence;
  if (Math.abs(c1 - c0) < 1e-6) return B / Math.max(0.5, c0);
  return (B / (c1 - c0)) * Math.log(c1 / c0);
}

/** 拍 → 段内时间（秒），与 segmentSeconds 同一套公式。 */
function beatSeconds(r: RunSegmentDef, beat: number): number {
  const B = Math.max(1, r.beats);
  const b = Math.max(0, Math.min(B, beat));
  if (typeof r.cadence === 'number') return b / Math.max(0.5, r.cadence);
  const [c0, c1] = r.cadence;
  if (Math.abs(c1 - c0) < 1e-6) return b / Math.max(0.5, c0);
  const c = c0 + ((c1 - c0) * b) / B;
  return (B / (c1 - c0)) * Math.log(c / c0);
}

export interface ProgressView { marks: number[]; pos: number }

/**
 * 进度（0..1）。marks = 检查点刻度（每个跑段的起点 + checkpoints）；pos = 当前位置。
 * at：段序号与段内位置（跑段用拍，静场 / 站立段用秒）。
 */
export function chapterProgress(def: ChapterDef, at: { segIndex: number; segBeat: number; stillT?: number }): ProgressView {
  const secs = def.segments.map(segmentSeconds);
  const total = secs.reduce((a, b) => a + b, 0) || 1;
  const starts: number[] = [];
  let acc = 0;
  for (const s of secs) { starts.push(acc); acc += s; }
  const marks: number[] = [];
  def.segments.forEach((s, i) => {
    if (s.kind !== 'run') return;
    const r = s as RunSegmentDef;
    marks.push((starts[i] as number) / total);
    for (const cp of r.checkpoints ?? []) if (cp > 0) marks.push(((starts[i] as number) + beatSeconds(r, cp)) / total);
  });
  const i = Math.max(0, Math.min(def.segments.length - 1, at.segIndex));
  const seg = def.segments[i] as SegmentDef;
  const within = seg.kind === 'run' ? beatSeconds(seg as RunSegmentDef, at.segBeat) : Math.min(secs[i] as number, Math.max(0, at.stillT ?? at.segBeat));
  const q = (v: number) => Math.round(v * 1000) / 1000;
  return { marks: marks.map(q), pos: q(Math.min(1, ((starts[i] as number) + within) / total)) };
}
