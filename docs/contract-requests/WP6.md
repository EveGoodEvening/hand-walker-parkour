# WP6 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-09-30 | src/sim/Track.ts（WP1）→ 契约 | 把 `obstacleState` / `swingOpen` / `ObstacleState` 提升为契约（例如移到 `src/levels/` 或 `src/core/`）。画面必须和碰撞用同一个函数（门、伸出的脚、让开的陈默、移动的人墙、线框）。WP6 目前只在 `src/render/npc/simBridge.ts` 一处 re-export 它（CORE 占位实现原本就这样 import）；WP1 若改签名，只改这一个文件即可。 | 兼容（只是换位置）
- 2026-09-30 | src/core/types.ts SimSnapshot | 可选追加 `tSeg?: number`（当前段内时间，和 Sim 碰撞用的 pace.tSeg 相同）。WP6 现在用 `snap.t − segment 事件时刻`（跳转时用 `snap.t − seg.timeAt(segBeat)`）反推，和 Sim 逐 tick 一致；但若 WP1 以后让 tSeg 在某些情况下不随 t 走（例如暂停段内时间），画面就会和碰撞错开。 | 兼容（可选字段）
- 2026-09-30 | 数据约定（WP2 章节数据，不改 schema） | 特殊 NPC 靠 id 识别（大小写不敏感，推荐直接用 Speaker 名）：陈默 = `kind: 'chenMo'`，他留在过道里的脚 = 同段 4 m 内、`id` 含 `chenmo` 的 footOut（第一章已是 `chenmoFoot`）；周主任 = 3-3 的 legs item `id: 'directorZhou'`（street.schoolGate 里带任何 id 的 legs 也按周主任画）；马老师 = 5-7 的 legs item `id: 'teacherMa'`（track 里带 id 的 legs 同理）；班长 = 3-1 的 npcs 组 `id: 'monitor'`（kind 用 walkers）；梦里的男生 = 4-2 的 kneeler item + `behavior: { type: 'fallInto' }`（或 `id: 'dreamBoy'`）。crowd cue 的 `group` 用 NpcGroupDef.id；找不到或写 `'*'` 时作用于本章全部组。 | 兼容（纯约定）
- 2026-09-30 | GameEvents.ask（WP1 的 Ask.ts） | WP6 按 `targetId = CompiledObstacle.id`（被请求的那个 legs 障碍）实现「让一下」：part → 0.5 s 后横移 0.6 m（多车道时从中间分开），ignore → 不动；两种结果附近 6 m 的鞋尖都会转过来。请 WP1 按这个含义填 targetId，并让 part 之后该障碍在碰撞上失效或随之移动。 | 兼容（解释约定）
- 2026-09-30 | WP3 校园 kit（classroom / canteen） | seatedRow 里坐着的人自带椅子（chairBar 原型的 `seat` 变体，放在 |x| ≈ 1.6、人身下）。WP3 的课桌椅如果也在这个位置放椅子，会叠成两把，集成时请二选一（建议 kit 只放课桌）。 | 兼容（协调）
