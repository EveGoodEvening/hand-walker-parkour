// src/render/kitContext.ts —— ChunkStreamer 传给 WP3 kit 的扩展上下文（DESIGN.md §5.9，WP3 内部约定）。
// KitChunkContext 是冻结契约；这里只在同一个对象上多挂一个可选字段 hw（结构类型兼容，别的包的 kit 看不见也不受影响）。
// 另外约定 kit 返回的几何体可以在 userData 上带画面提示（ChunkStreamer 读取，别的包也可以用）：
//   floor.userData.hwFloorMap = { id, params }   地面贴图（TextureBank id 与参数），uv 必须存在；
//   floor.userData.hwDepthWrite = true           地面写深度（楼梯段，§5.8）；
//   floor.userData.hwGloss = 0..1                地面光泽：灯带倒影贴花的强度（「水银河」）；
//   static 有 uv 属性时用校园贴图集材质，没有时用纯顶点色材质。
//   emissive 的 aSteady = 1 表示不跟灯走（窗），0 / 缺省表示按 LampField 的 G 通道明灭（灯管、灯泡）。
import type { KitChunkContext } from '../core/contracts';
import type { KitId } from '../core/types';
import type { Rect } from './geom';

export interface HwKitExt {
  /** 通用变体模板：不要画与具体里程有关的东西（段首段尾、门牌、开口都在专建 chunk 里）。 */
  generic: boolean;
  /** 前一个 / 后一个跑段（或站立段）的 kit；章首、章尾为 null。 */
  prev: { kit: KitId; variant: string } | null;
  next: { kit: KitId; variant: string } | null;
  /** 关卡数据里门牌文字在校园贴图集里的矩形（最多 2 个；没有位置时返回 null）。 */
  plateRect(text: string): Rect | null;
  /** 整个 chunk 的名义长度（最后一个 chunk 可能更短）。 */
  chunkLen: number;
}

export type HwKitChunkContext = KitChunkContext & { hw?: HwKitExt };

export interface FloorMapHint { id: string; params?: Readonly<Record<string, string | number>> }

/** 读取 kit 返回的地面提示。 */
export function floorHints(u: Record<string, unknown>): { map: FloorMapHint | null; depthWrite: boolean; gloss: number } {
  const m = u.hwFloorMap as FloorMapHint | undefined;
  return {
    map: m && typeof m.id === 'string' ? m : null,
    depthWrite: u.hwDepthWrite === true,
    gloss: typeof u.hwGloss === 'number' ? Math.max(0, Math.min(1, u.hwGloss)) : 0,
  };
}
