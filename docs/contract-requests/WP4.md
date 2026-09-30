# WP4 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-09-30 | core/contracts.ts `EnvKit` | 追加可选 `isSpecial?(seg: CompiledSegment, s0: number, s1: number): boolean`：这一段 chunk 含按关卡数据摆放的陈设（校门立柱跟 gateBar、车棚跟 shedRoof 环境声、涂鸦跟 graffitiHand 事件、门卫室跟 barrierArm、段尾的公交站 / 广场的水），不能当「通用变体」复用 | WP3 的 ChunkStreamer 要「每个变体预建 4 个通用变体」（§5.9）；WP4 的 street / plaza 已经实现了这个方法（结构类型，不影响现有契约），请 WP3 对 `isSpecial` 为 true 的范围按真实 s0 / s1 调用 build | 兼容（可选方法）
- 2026-09-30 | core/contracts.ts `EnvKit` | 追加可选 `floorMap?(variant: string): { id: string; params?: Record<string, string | number>; metersPerRepeat: number } | null`，ChunkStreamer 据此给 floor 材质挂 TextureBank 纹理（UV 可在着色器里按世界 xz 算） | §5.9 把 asphaltWet / trackRubber / plazaTile 分给 WP4，但 KitChunk 只交几何体、材质归 World，kit 没法给地面贴图；目前 WP4 的地面细节全用顶点色，这三张纹理只在画廊 / set 里用得到 | 兼容（可选方法；不实现就维持现状）
- 2026-09-30 | core/contracts.ts `StillSet.update` 注释 | 写明「World（WP3）每帧对当前静场的 set 调用 update(snap.still.t, snap)；update 必须是 t 与快照的纯函数」 | CORE 的占位 World 从不调用 set.update；WP4 的 weather 系统目前自己驱动 WP4 的 set（公交车雨刷、滑过的路灯、滴水、水汽、眨眼、被子、水花），实现是幂等的，WP3 再调一次也没关系 | 兼容（只是注释）
- 2026-09-30 | 说明给 WP2（不改冻结文件） | 静场 set 的开口 id：3-5 车窗 `busWindow`（别名 window、busGlass），3-10 镜子 `bathMirror`（别名 mirror、bathroomMirror），4-6 水面 `water`（别名 puddle、waterSurface）；`DoubleSpec.surface` 请用这些 id。`surfaces()` 的 plane 在 set 局部坐标（相对 STILL_ORIGIN）；rect：法线 ±x 的平面是 [z0, y0, z1, y1]，±z 是 [x0, y0, x1, y1]，±y 是 [x0, z0, x1, z1] | WP5 按 id 找反光面 | 兼容
- 2026-09-30 | 说明给 WP2 / WP5（不改冻结文件） | 4-5 的大镜子：广场没有墙，WP4 把 `mirror` 开口建成一整块浅灰「镜碑」（朝车道的一面整面是镜子，里面是发白的镜中广场，深 3.8 m）。请把 SurfaceDef 写成 `side: 'R'`、`y: [0.1, 2.6]`，替身站在碑里；4-3 站立段里的镜子按 §5.8 用世界替身 | 户外没有连续墙，开口需要一个能挡住镜中房间的实体 | 兼容
- 2026-09-30 | 说明给 WP3 / WP5（不改冻结文件） | 站立段（4-3 plaza、5-8 track）在 compile 里 s0 = s1，CORE 的 World 在非跑段隐藏全部 chunk，CameraRig 在非跑段用 STILL_ORIGIN 的静场机位：站立段会看到一片空。需要 World 在站立段显示上一跑段在玩家附近的 chunk、镜头用站立机位。WP4 的天与雨已经把站立段当户外处理 | 否则 4-3 / 5-8 没有场景 | 兼容
- 2026-09-30 | 建议（lead 决定） | `rainAt(chapter, segIndex, segBeat)`（重来 / goto 时按关卡数据复原雨强）目前在 WP4 的 render/weather/rain.ts；WP7 的雨声重来时也需要同样的逻辑，但不能 import 别的包。可以挪到 core（例如 core/weather.ts）作为共享纯函数 | 单一来源 | 兼容
- 2026-09-30 | 说明给 WP3（不改冻结文件） | 雨夜的水洼涟漪按 §5.9 走地面贴花，但契约里没有给别的包放贴花的接口（LampFieldAPI.ring 是掌光环，会加光）。若要涟漪，建议 WP3 的 decals 在 rain cue 强度 > 0 时给 puddle 障碍自己挂涟漪环（强度可按 `rain` cue 读） | 目前 WP4 没有画水洼涟漪 | 兼容
- 2026-09-30 | 说明给 WP2（不改冻结文件） | 4-3 站立段「广场边上有一面大镜子」：站立段没有 surfaces（compile 只给跑段编译 surfaces），kit 也不给站立段建 chunk。建议在 4-2 段尾（玩家停下来站起的位置）加一个 `mirror` 开口（side 'R'，y [0.1, 2.6]），WP4 的 plaza kit 会在那里建镜碑，4-3 的替身（WP5）站在碑里或用世界替身 | 否则 4-3 看不到镜子 | 兼容
