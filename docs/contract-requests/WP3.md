# WP3 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-09-30 | core/contracts.ts（ViewContext） | 新增可选 `decals?: { source(fn: (d: DecalSink) => void): () => void }`，其他包每帧往地面贴花里加实例（WP5 低画质的圆形暗斑影子、WP4 水洼涟漪环），仍然 1 次 draw call | §5.3 把这些都归到地面贴花，但契约里没有入口；现在 WP3 的贴花只画灯带倒影、光池、掌光环 | 兼容（可选字段）。先绕过：需要的包自己画一个小网格
- 2026-09-30 | DESIGN.md §5.9 / §8.4（KitChunk 约定，不改类型） | kit 返回的几何体可在 `userData` 上带画面提示：`floor.userData.hwFloorMap = { id, params }`（地面贴图，需要 uv）、`hwDepthWrite: true`（楼梯）、`hwGloss: 0..1`（光滑度，决定灯带倒影）；`static` 有 `uv` 时用校园贴图集材质，否则纯顶点色；`emissive` 的顶点属性 `aSteady = 1` 表示不跟灯走（窗），缺省跟 LampField 明灭。请写进设计文档，WP4 的户外 kit 可以用同一套（路灯、店招跟灯走，窗户不跟） | 需要一个统一说法，否则 WP4 不知道怎么给地面贴图 | 兼容（纯约定）
- 2026-09-30 | DESIGN.md §5.8（分工说明） | 墙镜 / 窗 / 端墙镜的「镜中房间」外壳（深 3.8 m 的内表面，暗色，含灯管倒影；窗的 backdrop 为发光的窗外）由 WP3 的 kit 画进 chunk 的 static 几何体（0 次额外 draw call）。WP5 只需在里面放替身、画玻璃叠加层，不要再画一个同位置的盒子（会 z-fighting）；中高画质的「镜中走廊副本」可以放在壳里面 | §5.8 表里「洞后面放一个暗色的镜中房间盒子」没写归谁，WP5 的交付里也写了「镜中房间」 | 兼容
- 2026-09-30 | DESIGN.md §4.2、§8.4（StillSet.surfaces 的 id 与 rect） | 校园 set 的反光面 / 黑板 id：canteenWindow 的玻璃 `'canteenGlass'`（平面 x = −1.1），labBoard 的黑板 `'labBoard'`（平面 z = −3.2，board cue 的 surface 用它）。`rect` 约定为平面内的 `[u0, v0, u1, v1]`：x 向平面是 `[zMin, yMin, zMax, yMax]`，z 向平面是 `[xMin, yMin, xMax, yMax]`，都相对 STILL_ORIGIN。请 WP2 在 2-5 的 double、2-9 的 board 事件里用这两个 id | 数据与画面要对上同一个名字 | 兼容
- 2026-09-30 | DESIGN.md §5.9（chunk 长度） | WP3 的 kit 的 chunk 长度取「最接近 12 m 的偶数拍」（步幅 1.0 → 12 m，1.1 → 11 m，0.6 → 12 m），这样铜条（每拍）、灯管（每 2 拍）在 4 个通用变体之间严丝合缝；别的包的 kit 仍然按 12 m 逐个预建 | 通用变体复用的前提 | 兼容（CHUNK_LEN 不变）
- 2026-09-30 | DESIGN.md §8.7（lights cue 语义说明） | 建议写明：`from` / `to` 是段内拍号（缺省为整段）；`every = N` 从区间内第一盏起每 N 盏选一盏；`delay` 为秒；flicker 持续到同一区间的 `on`；`sound` 让区间内的灯变成声控（默认黑，撑跃落地 / ↓ 拍地点亮前方 8 m 内的灯 4 s，`delay` 为反应延迟，5-2 用 0.5）；`palmRings` 让区间内的每一掌激起光环；窗（kind window）不受开关灯影响。重来时 WP3 会重放检查点之前的 lights / atmosphere / fog 事件 | WP2 写数据时需要知道 | 兼容（只是说明）
