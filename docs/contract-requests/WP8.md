# WP8 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


- 2026-10-01 | src/core/save.ts `SaveData` | 追加 `completed: ChapterId[]`（打完的章）与 `habitShown: boolean`（「不是成心的，只是习惯。」是否出现过） | §7.2 章节列表要给打完的章加短横线，第五章没有下一章可解锁，无法从 `unlocked` 推出；附录 B.5「全作只出现一次」要跨会话记住。现在 WP8 用单独的键 `hw-parkour:v1:ui`（`src/ui/store.ts`，同样 try/catch）绕过 | 兼容（新字段可缺省，sanitize 给默认值）
- 2026-10-01 | src/core/Game.ts `updateInputContext` | `ask` 取最近一次 `prompt` 事件的 `context.ask`（与 `ctxLook` 同样处理），现在总是 `false` | 情境按钮「让一下」（§2.2、§8.7 ask）。WP8 现在由 UI 收到 `prompt` 后经 `Input.hooks.ask` 补上 | 兼容
- 2026-10-01 | src/core/contracts.ts `GameCommands` | 追加可选 `outroInput?(id: string \| undefined, n: number): void`：结尾卡里玩家每输入一次调用一次；Game 据此记 `beat`（`id` 非空时）并发一个 sfx / 触地类 cue | §4.4 第四章结尾卡「每按一下，床单上响一声掌根、指节或指腹」，附录 C 的 `fingerPractice`（结尾卡输入）要进 `beatsFired`。UI 没有通往 Sim / Audio 的通道，现在只能做画面上的节奏 | 兼容（可选方法）
- 2026-10-01 | `OutroDef.set` 的呈现（View，WP3 / WP4） | View 在 `screen: outro` 时显示本章 `outro.set`（第四章：卧室天花板的裂缝）；WP8 再把这类结尾卡的底色改成半透明 | §4.4「结尾卡背景是卧室天花板上的裂缝」。现在结尾卡是不透明的墨色，避免露出上一段（4-6 水面）的最后一帧 | 兼容（需要两边约定，WP8 侧改动只有一个类名）
- 2026-10-01 | src/core/Game.ts `renderFrame` | 先 `setDevice(input.device())` 再 `ui.frame()`，或把 `setDevice` 写进 `UIAPI` | 现在设备切换要晚一帧才进 UI：滑动后立刻摔倒，失败卡的第一帧是键盘文字。WP8 已在 `UI.frame()` 开头自己读 `Input.active.device()` 绕过 | 兼容
- 2026-10-01 | src/core/debugHook.ts `goto` | 跳转时与 `retry` 一样清掉 `game.failing`、`loop.slowMul` | 摔倒之后用 `__game.goto()` 跳段，Game 仍在「失败中」，`pause()` 会被拒绝（e2e 版面检查踩到，现用 `__game.input('confirm')` 先真正重来一次） | 兼容（只影响调试钩子）
