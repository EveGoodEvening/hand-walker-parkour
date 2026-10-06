// src/core/quality.ts —— 画质档位表与自动档位（DESIGN.md §9.4，唯一权威）。CORE 冻结。
// high 的 pixelRatio 在运行时取 Math.min(devicePixelRatio, 1.5)。
import type { QualityProfile } from './contracts';
import type { QualityTier } from './types';
import { quantile } from './math';

export const QUALITY: Record<QualityTier, Omit<QualityProfile, 'pixelRatio'> & { pixelRatio: number | 'dpr1.5' }> = {
  low:    { tier: 'low',    pixelRatio: 0.6,  antialias: false, fogMul: 0.8, chunksAhead: 3, npcMax: 24, crawlersMax: 24,  rainLines: 250,
            mirrorsActive: 1, puddlesActive: 1, mirrorChunkCopy: false, planarShadow: 'events', texSize: 256,
            capsuleSegments: 5, icoDetail: 0, grain: false, lightShafts: false, dust: false },
  medium: { tier: 'medium', pixelRatio: 0.85, antialias: false, fogMul: 1.0, chunksAhead: 5, npcMax: 40, crawlersMax: 60,  rainLines: 600,
            mirrorsActive: 2, puddlesActive: 2, mirrorChunkCopy: true,  planarShadow: 'always', texSize: 512,
            capsuleSegments: 6, icoDetail: 1, grain: true,  lightShafts: true,  dust: false },
  high:   { tier: 'high',   pixelRatio: 'dpr1.5', antialias: true, fogMul: 1.0, chunksAhead: 6, npcMax: 64, crawlersMax: 120, rainLines: 1200,
            mirrorsActive: 3, puddlesActive: 2, mirrorChunkCopy: true,  planarShadow: 'alwaysPlusNpcBlobs', texSize: 1024,
            capsuleSegments: 8, icoDetail: 1, grain: true,  lightShafts: true,  dust: true },
};

/** 把档位表解析成运行时 profile（pixelRatio 取实数）。 */
export function resolveQuality(tier: QualityTier, devicePixelRatio = 1): QualityProfile {
  const q = QUALITY[tier];
  return { ...q, pixelRatio: q.pixelRatio === 'dpr1.5' ? Math.min(devicePixelRatio || 1, 1.5) : q.pixelRatio };
}

/**
 * 自动档位（§7.3、§9.4）：先用中档；进入游玩后统计 3 s 的 p90 帧时间，
 * > 24 ms 降到低档，< 12 ms 且是桌面端升到高档；之后不再自动切换。
 */
export class AutoQuality {
  private samples: number[] = [];
  private elapsed = 0;
  private decided = false;
  constructor(private readonly desktop: boolean, readonly windowSec = 3) {}
  get done(): boolean { return this.decided; }
  /** 每帧喂入真实帧时间（秒）；返回决定的档位或 null（还没决定 / 不需要切换）。 */
  sample(frameSec: number): QualityTier | null {
    if (this.decided) return null;
    this.samples.push(frameSec * 1000);
    this.elapsed += frameSec;
    if (this.elapsed < this.windowSec) return null;
    this.decided = true;
    const p90 = quantile(this.samples, 0.9);
    this.samples = [];
    if (p90 > 24) return 'low';
    if (p90 < 12 && this.desktop) return 'high';
    return 'medium';
  }
}
