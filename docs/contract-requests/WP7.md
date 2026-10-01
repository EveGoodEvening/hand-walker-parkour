# WP7 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-10-01 | package.json（CORE） | 增加 `"e2e:audio": "node tests/unit/audio/browser/run.mjs"`，lead 集成时（或在 verify 里）跑 | 真实 Chromium WebAudio 上的验收（库与 Node 实现的逐键保真度、静音段、追随者逼近、峰值、人群脚步、失焦挂起、暂停后回到标题）现在只能手动跑，回归时可能没人发现；脚本已经走 browser-lock，约 1–2 分钟 | 兼容
- 2026-10-01 | src/core/Game.ts（CORE） | 从暂停菜单「从检查点重来」（retry）和「回到标题」（toTitle）时调用 `audio.suspend(false)` | 现在这两条路径不恢复声音（重来后整段没有声音、标题背景没有早读）。WP7 已在引擎里兜底：离开 pause / settings 屏幕即结束 Game 的暂停；CORE 修正后两边一致 | 兼容
- 2026-10-01 | §8.10 WP7 依赖（只依赖事件和快照） | 请 lead 认可两处只读依赖：(1) `src/audio/index.ts` 经 `getChapter` 读本章定义——读档 / 重来时重建地点、环境音、雨，人群脚步要读段里的 `npcs` 和 walk 障碍；(2) 注册一个不画任何东西的探针 ViewSystem，经 `ViewContext.lamps` 拿 WP3 的 LampField（§6.2 嗡鸣跟随亮度；§8.2 的例外只点名了 WP4）。两处都走 CORE 已冻结的注册表与类型，不改任何别人的文件 | 兼容
- 2026-10-01 | DESIGN.md §6.2「追随者」一行 | 请确认「基础增益 −6 dB」的含义。现在的实现：§2.6 表里的增益就是相对自己掌声的总增益（追随者库低 6 dB，总线补回 6 dB；稳度 3 / 0 = −18 / −7 dB）。如果本意是 −6 dB 再叠加稳度表（稳度 3 / 0 = −24 / −13 dB），只需把 `src/audio/follower.ts` 的 `comp` 改成 0 | 数值，兼容
