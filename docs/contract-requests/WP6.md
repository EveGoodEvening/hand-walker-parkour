# WP6 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-09-30 | src/sim/Track.ts（WP1）→ 契约 | 把 `obstacleState` / `swingOpen` / `ObstacleState` 提升为契约（例如移到 `src/levels/` 或 `src/core/`）。画面必须和碰撞用同一个函数（门、伸出的脚、让开的陈默、移动的人墙、线框）。WP6 目前只在 `src/render/npc/simBridge.ts` 一处 re-export 它（CORE 占位实现原本就这样 import）；WP1 若改签名，只改这一个文件即可。 | 兼容（只是换位置）
- 2026-09-30 | src/core/types.ts SimSnapshot | 可选追加 `tSeg?: number`（当前段内时间，和 Sim 碰撞用的 pace.tSeg 相同）。WP6 现在用 `snap.t − segment 事件时刻`（跳转时用 `snap.t − seg.timeAt(segBeat)`）反推，和 Sim 逐 tick 一致；但若 WP1 以后让 tSeg 在某些情况下不随 t 走（例如暂停段内时间），画面就会和碰撞错开。 | 兼容（可选字段）
- 2026-09-30 | 数据约定（WP2 章节数据，不改 schema） | 特殊 NPC 靠 id 识别（大小写不敏感，推荐直接用 Speaker 名）：陈默 = `kind: 'chenMo'`，他留在过道里的脚 = 同段 4 m 内、`id` 含 `chenmo` 的 footOut（第一章已是 `chenmoFoot`）；周主任 = 3-3 的 legs item `id: 'directorZhou'`（street.schoolGate 里带任何 id 的 legs 也按周主任画）；马老师 = 5-7 的 legs item `id: 'teacherMa'`（track 里带 id 的 legs 同理）；班长 = 3-1 的 npcs 组 `id: 'monitor'`（kind 用 walkers）；梦里的男生 = 4-2 的 kneeler item + `behavior: { type: 'fallInto' }`（或 `id: 'dreamBoy'`）。crowd cue 的 `group` 用 NpcGroupDef.id；找不到或写 `'*'` 时作用于本章全部组。 | 兼容（纯约定）
- 2026-09-30 | GameEvents.ask（WP1 的 Ask.ts） | WP6 按 `targetId = CompiledObstacle.id`（被请求的那个 legs 障碍）实现「让一下」：part → 0.5 s 后横移 0.6 m（多车道时从中间分开），ignore → 不动；两种结果附近 6 m 的鞋尖都会转过来。请 WP1 按这个含义填 targetId，并让 part 之后该障碍在碰撞上失效或随之移动。 | 兼容（解释约定）
- 2026-09-30 | WP3 校园 kit（classroom / canteen） | seatedRow 里坐着的人自带椅子（chairBar 原型的 `seat` 变体，放在 |x| ≈ 1.6、人身下）。WP3 的课桌椅如果也在这个位置放椅子，会叠成两把，集成时请二选一（建议 kit 只放课桌）。 | 兼容（协调）
- 2026-10-01 | DESIGN.md §10（lead 裁决）+ src/levels/obstacles.ts legs | 请明确豁免人腿碰撞盒的高度：legs 的 y1 = 1.70，但 NPC 只建到腰带（≈ 1.05 m，§5.7、lead 补充要求 3），线框顶面比模型高 0.65 m。玩家碰撞盒最高 0.85 m，block 只看横向和沿 s，这 0.65 m 不影响任何判定。二选一：§10 写明「legs 的 y1 只是线框，模型只到腰带」；或把 legs 的 y1 改成 1.05（判定不变）。 | 兼容
- 2026-10-01 | DESIGN.md §5.7 vs lead 补充要求 3 | §5.7 写「躯干和头只在站立段、梦里、远景中显示」，lead 补充要求写「NPC 只建到腰带」。按 §5.4 的机位（高 0.92、竖直视角 50–62°），2 m 以外的人整个都在画面里，远处一排排只有裤腿的人会直接露出腰部的截断。WP6 目前按「只建到腰带」实现（站立段、梦里、陈默除外），没有做「远景」。若要做：中 / 高画质下离玩家 > 6 m 的路边的人加躯干和头（已有部件，不加 draw call，最多多 64 个实例），低画质仍只到腰带。请 lead 裁决。 | 兼容
- 2026-10-01 | src/levels/obstacles.ts legs（walk 行为） | 走路的人沿 s 的外沿随 ±22° 的摆腿在中心前后 0.06–0.48 m 之间变化，0.30 的碰撞深度只能取平均（横向在 ±5 cm 内）。如果要求走路的人沿 s 也 ≤ 5 cm，需要 walk 行为的人腿用更深的碰撞盒（约 0.7），或者 §5.7 把行人的摆腿改小；两者都改判定或设计，请 lead 决定。WP6 目前把它当作有意的例外（测试只查横向）。 | 兼容（待裁决）
- 2026-10-01 | WP1 sim（可选） | 「安静的一秒」：WP6 现在让碰撞盒还在走的行人（walk 行为的人腿）在静止的 1 s 里照常迈步（步态按段内时间 = 碰撞盒的位移驱动），画面和碰撞一起动，不滑行。若希望「所有人静止」也包括这些行人，请 WP1 在人群段绊倒时让 walk 障碍的段内时间停 1 s（再用 0.6 s 追上），WP6 改成用同一个时钟即可。 | 兼容（可选）
- 2026-10-01 | 数据约定（更正上面 2026-09-30 的 crowd cue 约定） | crowd cue 的 `group` 找不到时**不再**作用于全章，只在控制台警告一次（防止拼写错误让整章人群一起转鞋尖或鼓掌）；作用于全部组请写 `'*'`。周主任（灰夹克 + 暖色烟头）只在第三章识别，其他章节里 id 碰巧是 zhou / director 的人按普通人画（附录 A-9）。 | 兼容
- 2026-10-01 | WP3 src/render/lampField.ts（协调） | WP6 的 aChalk 用了中间值：人腿四个竖直面、垂着的手、鞋面 0.5（暗场里人的剪影只要一层淡光，和障碍顶边的 1.0 区分开），陈默的脚等仍是 1.0。§5.3 的着色器是 `uChalkColor * vChalk * uChalk`，按连续值线性处理即可；请 WP3 不要把 vChalk 当布尔量（例如 step / > 0.5）。 | 兼容
- 2026-10-01 | src/core/types.ts SimSnapshot（补充上面 `tSeg?` 那一条） | 已经出现了一种 tSeg 不随 t 走的情况：失败（fall）以后 Sim 不再推进 pace.tSeg。WP6 现在在 `fall` 事件时把障碍的段内时间停住、retry 时由 onReset 重新同步；若快照里有 `tSeg`，画面直接用它，不必再反推。 | 兼容（可选字段）
