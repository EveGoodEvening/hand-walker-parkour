# WP3 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-09-30 | core/contracts.ts（ViewContext） | 新增可选 `decals?: { source(fn: (d: DecalSink) => void): () => void }`，其他包每帧往地面贴花里加实例（WP5 低画质的圆形暗斑影子、WP4 水洼涟漪环），仍然 1 次 draw call | §5.3 把这些都归到地面贴花，但契约里没有入口；现在 WP3 的贴花只画灯带倒影、光池、掌光环 | 兼容（可选字段）。先绕过：需要的包自己画一个小网格
- 2026-09-30 | DESIGN.md §5.9 / §8.4（KitChunk 约定，不改类型） | kit 返回的几何体可在 `userData` 上带画面提示：`floor.userData.hwFloorMap = { id, params }`（地面贴图，需要 uv）、`hwDepthWrite: true`（楼梯）、`hwGloss: 0..1`（光滑度，决定灯带倒影）；`static` 有 `uv` 时用校园贴图集材质，否则纯顶点色；`emissive` 的顶点属性 `aSteady = 1` 表示不跟灯走（窗），缺省跟 LampField 明灭。请写进设计文档，WP4 的户外 kit 可以用同一套（路灯、店招跟灯走，窗户不跟） | 需要一个统一说法，否则 WP4 不知道怎么给地面贴图 | 兼容（纯约定）
- 2026-09-30 | DESIGN.md §5.8（分工说明） | 墙镜 / 窗 / 端墙镜的「镜中房间」外壳（深 3.8 m 的内表面，暗色，含灯管倒影；窗的 backdrop 为发光的窗外）由 WP3 的 kit 画进 chunk 的 static 几何体（0 次额外 draw call）。WP5 只需在里面放替身、画玻璃叠加层，不要再画一个同位置的盒子（会 z-fighting）；中高画质的「镜中走廊副本」可以放在壳里面 | §5.8 表里「洞后面放一个暗色的镜中房间盒子」没写归谁，WP5 的交付里也写了「镜中房间」 | 兼容
- 2026-09-30 | DESIGN.md §4.2、§8.4（StillSet.surfaces 的 id 与 rect） | 校园 set 的反光面 / 黑板 id：canteenWindow 的玻璃 `'canteenGlass'`（平面 x = −1.1），labBoard 的黑板 `'labBoard'`（平面 z = −3.2，board cue 的 surface 用它）。`rect` 约定为平面内的 `[u0, v0, u1, v1]`：x 向平面是 `[zMin, yMin, zMax, yMax]`，z 向平面是 `[xMin, yMin, xMax, yMax]`，都相对 STILL_ORIGIN。请 WP2 在 2-5 的 double、2-9 的 board 事件里用这两个 id | 数据与画面要对上同一个名字 | 兼容
- 2026-09-30 | DESIGN.md §5.9（chunk 长度） | WP3 的 kit 的 chunk 长度取「最接近 12 m 的偶数拍」（步幅 1.0 → 12 m，1.1 → 11 m，0.6 → 12 m），这样铜条（每拍）、灯管（每 2 拍）在 4 个通用变体之间严丝合缝；别的包的 kit 仍然按 12 m 逐个预建 | 通用变体复用的前提 | 兼容（CHUNK_LEN 不变）
- 2026-09-30 | DESIGN.md §8.7（lights cue 语义说明） | 建议写明：`from` / `to` 是段内拍号（缺省为整段）；`every = N` 从区间内第一盏起每 N 盏选一盏；`delay` 为秒；flicker 持续到同一区间的 `on`；`sound` 让区间内的灯变成声控（默认黑，撑跃落地 / ↓ 拍地点亮前方 8 m 内的灯 4 s，`delay` 为反应延迟，5-2 用 0.5）；`palmRings` 让区间内的每一掌激起光环；窗（kind window）不受开关灯影响。重来时 WP3 会重放检查点之前的 lights / atmosphere / fog 事件 | WP2 写数据时需要知道 | 兼容（只是说明）
- 2026-10-01 | §8.2 规则 2（levels/lines.ts） | 把 `src/levels/lines.ts` 的 `lineText` 列为共享只读契约（与 core/Game.ts、ui/UI.ts、ui/hud/Hud.ts 的现状一致）；WP3 的 ChunkStreamer 读章时按 board cue 的 `line` 预生成黑板字，必须拿到文字 | 现在属于越过包边界的 import；备选方案是 compile.ts 在 CompiledChapter 里带上已解析的文字 | 兼容
- 2026-10-01 | core/contracts.ts（ViewContext） | 正式加入两个可选字段（WP3 已在同一个 ctx 对象上挂好，类型见 `ChunkStreamer.ts` 的 `HwViewExt`）：`decals?: { source(fn: (sink: DecalSink) => void): () => void }`（每帧往地面贴花里加实例：WP4 水洼涟漪、WP5 低画质暗斑影子，仍是 1 次 draw call；sink.add(kind 'streak' / 'pool' / 'ring' / 'blob', x, y, s, w, l, sRGB 色, 强度, 转角?)）；`atmosphere?: { id, dark, planarDir, fogNear, fogFar, fogColor, lampGain, chalkMin }`（当前插值后的氛围，平面影子方向等随过渡变化） | 取代 2026-09-30 那条 decals 申请；合并前别的包可以 `(ctx as ViewContext & HwViewExt)` 先用 | 兼容（可选字段）
- 2026-10-01 | DESIGN.md §5.9 / kitContext.ts 约定（替换 2026-09-30 关于 static 材质的说法） | static 是否用校园贴图集改为显式标志 `static.userData.hwAtlas = true`（不再看有没有 uv）；static / emissive / floor 没有 `color` 属性时用白色材质（不会变黑）。WP4 的户外 kit 不需要做任何事 | 以前带 uv 的户外几何体会被贴上校园贴图集，缺顶点色的 emissive 会渲染成黑色 | 兼容
- 2026-10-01 | DESIGN.md §5.2（说明） | dreamGray 的渐变由 fog cue 驱动：far（未乘画质倍率）从 60 收到 28 的进度同时决定雾色 #D9DEE0 → #5D6468、背景、半球光 1.6 → 0.9。WP2 在 4-5、4-6 只需写 `{ type: 'fog', near: 20, far: 28, seconds: N }`；fog cue 不会打断进行中的 atmosphere 过渡 | 让「越来越深的灰」可以用数据表达 | 兼容
- 2026-10-01 | src/levels/chapters/ch1.ts（WP2，1-4） | 建议把 `{ at: 1.4, type: 'sfx', sfx: 'heels' }` 提前到 `at: 0.2`（或让 WP7 的 heels 从 0.2 s 起一步一步走近、3.0 s 停）：WP3 的 deskFeet/teacher 里英语老师现在从 0 s 起以 1.2 m/s 沿中间过道走近、3.0 s 缓停在主角身边、4.3 s 后继续往教室后面走出画面（附录 A-1：朝镜头来的必须慢），前 1.4 s 她在一排排桌腿后面若隐若现，没有脚步声会显得像无声滑过来 | 画面与声音对上 | 兼容（只改时间）
