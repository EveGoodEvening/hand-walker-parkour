# WP2 契约申请

只追加（OWNERS.json APPEND，DESIGN.md §8.11）。冻结文件需要新字段或新的联合成员时，在这里追加一条，先用本地适配层绕过，lead 集成时统一合并。

格式：`- 日期 | 文件 | 改动 | 理由 | 是否兼容`


## 契约申请（冻结文件）

- 2026-09-30 | src/levels/schema.ts | `StandSegmentDef` 追加可选字段 `npcs?: NpcGroupDef[]` | 4-3 梦中站立的 `crowd`（`applaud` / `crawlOvertake`）和 5-8 七步第 4 步的 `crowd`（`turnShoes`）要指向人群；站立段现在不能声明 NPC 组，数据里暂时引用前一个跑段的组 id（4-1 的 `onlookers`、5-7 的 `class5`）。绕过：WP6 在紧接着的站立段里保留上一个跑段的 NPC 组 | 兼容（可选字段）
- 2026-09-30 | src/core/Game.ts | 结尾卡支持 `OutroDef.lines` 里的 `{ input, id }`：显示提示、等输入（超时自动完成）、按 id 写 `beat`，并让 WP7 每按一下在床单上响一声掌根 / 指节 / 指腹 | 第四章结尾卡可交互（§4.4、附录 B.1），必备节拍 `fingerPractice` 挂在这个输入上。现在 Game 只把 `line` 摊平显示，e2e:chapters 的 ch4 会缺这一个节拍 | 兼容（数据已按 schema 写好）

## 集成说明（不涉及冻结文件，给 lead 与相关 WP）

- **WP1 `scripts/validate-levels.ts`**：WP2 验收 1 要求「校验器 + lint」。请在脚本里调用 `lintContent({ chapters, sources: SOURCE_CHAPTERS })`（`src/levels/lint.ts`，原文从 `src/levels/sourceQuotes.ts` 取，脚本不进产物），把 error 计入退出码。在接入之前，`tests/unit/content/lint.test.ts` 在 `npm test` 里强制「零 error、零 warning」。
- **WP1 Stand**：5-8 的 `StepEventDef`（`atStep` / `delay`）现在被 `compile.ts` 过滤掉（只保留数字 `at`），`seventhFall`、`theyPractice` 两个必备节拍要等 Stand 按步数触发。4-3 梦中站立按 ↓ 时显示一次 `LINE_HOOKS.dreamDownPress`（`c4.handsLimp`）。
- **R6 的数据写法（WP5 请按这个约定播放）**：校验器把每个 `doubleMod`、每个非 normal 的 `shadow`、每次 hidden/absent → 其他模式的 `follower` 事件都算一次主异常，`double` 不算。同一个异常的连续演出因此只写一个事件：
  - 3-4 水洼：一个 `doubleMod` `{ headDownHold: 1.2, clip: 'standUp', thirdHand: { gesture: 'shush', at: 3.0 } }`。约定播放顺序：先保持低头 `headDownHold` 秒，再播 `clip`，`thirdHand.at` 相对于这个 mod 的触发时刻。
  - 5-6 站着的「我」：`double`（world，`anchor: { sAhead: 12, speed: -1.2 }`，speed 是它自己迎面走的速度，`avoidPlayerLane`）加一个 `doubleMod` `{ stopAtDistance: 5, clip: 'pointMirror', thirdHand: { gesture: 'neck', at: 0.6, hold: 2.2 } }`。约定：走到距离 5 m 停下、指镜子、手势 `hold` 结束后按原来的 anchor 继续走过你身边，直到 `ttl`。
  - 5-3 反向的影子：只有 @30 一个 `shadow: 'reversed'`。段首追随者就是 `pressure`，但 `hud` / `voice` 为 none、`steadyMax` 3；@44 `follower { hud: 'shadow' }` 表示影子开始朝你爬，@52 `follower { steadyMax: 2 }`。约定：pressure 且 hud = shadow 时，WP5 按 `follower.distance` 摆放那个反向的影子（`ShadowMode 'chase'` 本章没有单独用）。
- **静场里的反光面 id（WP3 / WP4 的 `StillSet.surfaces`）**：canteenWindow `window`（2-5）、bus `window`（3-5）、bathroom `mirror`（3-10）、water `water`（4-6）、labBoard `board`（2-9 的 `board` 事件）。
- **特殊 NPC 的 item id（WP6，编译后在 `params.itemId`）**：`chenmo` / `chenmoFoot`（1-2）、`girlA` / `girlB`（2-2，askable）、`directorZhou`（3-3 中道的灰裤腿，画面上沿烟头）、`dreamBoy`（4-2，fallInto）。
- **没有自己触地声时的追随者（WP7 / WP1）**：4-3 站着时 5.0 s 起 `follower behind`（「身后传来一个人的三段落地」）、5-9 静场 9.0 s 起 `follower ahead`（远处轻敲般的三段落地）、5-10「掌根，指节，指腹。」每念一个词空中响一声（surface `air`）。这些时刻玩家没有掌根触地可以延迟重放，需要单独的声源。
- **`lights` 的负拍号（WP3）**：3-1 用 `from: -9 … 0` 表示段起点之后方（教室里的灯）依次熄灭。
- **代码取用的台词**：`src/levels/lines.ts` 的 `LINE_HOOKS`（`firstLegHit` → c1.habit、`askSelf` → c2.excuse、`askWhisper` → c2.dirty、`dreamDownPress` → c4.handsLimp），WP8 / WP1 按键名取，不要写死文字。
- **静场变体表**：`src/levels/kitSymbols.ts` 新增 `SET_VARIANTS`（deskFeet teacher/math、bedroom feet/ceiling、infirmary bed/ceiling，其余 default），章节只用表里的变体。
- **给 lead 回写 DESIGN.md 的数据差异**（原因都是 R6 / A-11 或 R13，详见各章节文件头注释）：1-5 回头窗口 @124–133、1-6 停拍 @23（第三只手 +1.8 s，自动爬行 3.4 s）；2-6 加速 @40、2-7 回声 @48 / 停拍 @62 / 检查点 @76 / 文字 @84、@90；2-10 加长到 92 拍（影子 @2，停拍 @89，镜子 @92）；3-3 周主任 @18、对白 @8 / @11 / @24；5-1 7.5 s、5-3 停拍 2.0 s、5-5 8 s、5-8 11 s；n5-a 仍在 5-3 @170。
