# VIS-seated-crowds：路边坐着的人坐在 kit 的家具上

- 人群（WP6 crowds.ts）和 kit（WP3）各摆各的家具，会出现「一屋子空课桌 + 一排自带椅子坐在过道里的人」。座位只能有一个来源：`src/render/kits/school/seats.ts` 给出课桌行、餐桌行、方柱的 s（纯函数，不依赖 three），kit 和 crowds 都调它。人带 `kitSeat: true`，ObstacleView 就不再另画 chairBar 的 seat 椅子。
- 排布能被 Node 端复现的前提：位置相对段首对齐（`stepsIn` 的 offset 从 `segS0` 算），chunk 长度（`hwChunkLen`，ChunkStreamer 同用）是行距的整数倍，所以专建 chunk 和通用模板 chunk 的行位置一致。kit 里靠 rng 的缺座、抖动、椅子拉开，对「有人坐」的那一列一律关掉，但照样取 rng（`rng.next()` 先取再判断），别的列的随机不变。
- 教室：`e.z(s) = −(s − s0)`，椅子在课桌 +z 一侧，所以椅子中心是 `s = 行 − 0.42`，不是 `+ 0.42`。kit 的 `roomEnd = min(chunk 尾, 前墙)` 再减 0.9，等于每个 chunk 尾都有 0.9 m 的空白，复现时要连这一条一起抄。
- 伸脚的人（footOut）自带椅子坐在 |x| ≈ 1.82，正好是教室靠过道那一列：kit 在那一行同侧不摆课桌椅（`classroomFootClash`），坐的一侧由 `footOutSide` 决定（archetypes/footOut.ts 的 `footSide` 也调它）。
- 食堂：靠过道一列餐桌在 |x| = 2.85，圆凳在 (±0.35, ±0.55)，人坐在凳子上、面朝桌子中心（s 大的一侧 yaw 0，小的一侧 yaw π），离方柱外沿还有约 9 cm。方柱（|x| 1.69–2.21）和车道碰撞盒（1.32 + 人半宽 0.2）之间没有站人的地方：站着的人压进 [1.56, 2.05]，靠近方柱的沿 s 挪开。
- 每米人数保持与旧版（每 1.25 m 一人）相当，再按凳子分配概率（靠过道的凳子 0.4×密度，外侧 0.2×密度），不加重 npcMax 和低画质预算。
- 低画质的合并腿（一根从髋指向脚踝）只适合站着、走路的人；坐着、蹲着的人要分成大腿、小腿两段（同一个 FEET.leg 变体按比例缩放），否则斜着的 0.59 m 直棍在追尾镜头里像伸进过道的脚。大腿多伸半个小腿厚度（0.07），无端面的断口藏进小腿里。
- 测试做法：拦截 `KitGeo.prototype.box / prism`（按尺寸认出课桌、椅子、餐桌、圆凳、方柱），按 ChunkStreamer 的切法建整段，再和 `expandChapter` 的人逐个比位置（`tests/unit/npc/seats.test.ts`）。调试舞台传了 band 覆盖，没有 kit 家具，坐着的人照旧自带椅子。
- 通用模板 chunk（`hw.generic`）建一次、到处复用，看不到段里的障碍：教室 kit 要按伸脚的人空出课桌椅，所以 ChunkStreamer 把有 footOut 的教室 chunk 按专建。Node 测试里全部按专建，测不出这一条，改 kit 里「看段数据」的逻辑时要同时看 ChunkStreamer 的 `special` 条件。
- 手搓的 `CompiledSegment` 假数据（`parts.test.ts`）缺 `s1`、`obstacles` 时，按整段排布找座位会得到 NaN、一个人也没有：新读段字段时 grep 测试里的 `as unknown as CompiledSegment`。
