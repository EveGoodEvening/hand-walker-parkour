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

## 2026-10-01 验收第 1 轮之后的修复（更正上文）

- **更正：站立段的 crowd 指向紧挨着的前一个跑段**。上文「4-1 的 `onlookers`」写错了：4-3 前面的跑段是 4-2。现在 4-3 的 `applaud` 指向 4-2 的 `ring2`（围观的环），`crawlOvertake` 指向 4-2 的 `imitators`（爬行的模仿者，原文「他们一个接一个趴到地上」「他们从我身边爬过去，超过我」）；5-8 的 `turnShoes` 仍指向 5-7 的 `class5`。规则：站立段只引用**紧挨着的前一个跑段**的组 id，WP6 把那一段的 NPC 组保留到站立段结束。`tests/unit/content/chapters.test.ts`「crowd 事件指向存在的 NPC 组」检查。契约申请 `StandSegmentDef.npcs?` 不变。
- 2026-10-01 | src/levels/schema.ts | `DoubleSpec` 追加可选字段 `fadeIn?: number`（秒） | 4-3 梦里镜中站着的「我」、5-6 站着的「我」是 `surface: 'world'` 的替身，数据里没法写淡入。附录 A-1 不允许东西突然出现在镜头前方。绕过：WP5 对 world 替身一律用 ≥ 0.6 s 的淡入 | 兼容（可选字段）
- **给 lead 回写 DESIGN.md 的数据差异（第二章、第五章，取代上文 2-6 / 2-7 / 2-10 与 5-8 的数值）**：2-2 136 拍（表中 150），@46 右道加一个走动的腿（1.2 m/s）；2-6 110 拍，玻璃里的它 @52 出现、@66 加速、「玻璃里的它走得比我快。」@74、@80 走出画面，窗墙 @40–92；2-7 136 拍，回声 @54、停拍 @68、检查点 @78、文字 @82 / @88，之后的障碍前移 4 拍；2-8 86 拍（表中 96）；2-10 140 拍，影子 @56、碎角镜替身 @114、停拍 @137（第三只手在停拍 2.6 s，冷色渐变 4.6 s，替身消失 5.2 s），镜子 @140；5-8 13 s（第 7 步之后 +3.0 s 那句要显示完）。第二章合计 199.5 s（§4.6 175 s 的 +14.0%）。
- **请 lead 裁定：A-11 在静场、站立段与跨段时怎么数**。校验器的 R6 只看跑段。WP2 现在用 Sim 时间轴检查整章（`tests/unit/content/anomalies.test.ts`，计数规则在 `tests/unit/content/anomalyTimeline.ts` 头注释）：一个静场 / 站立段里的全部主异常算一个场景，跑段里每个主异常各算一个，相邻场景相隔 ≥ 20 s。第二章因此要从 2-5 的第三只手到 2-7 的回声留出 ≥ 40 s，从 2-9 的黑板到 2-10 的停拍也要留出 ≥ 40 s，所以 2-10 从设计的 40 拍变成 140 拍，2-2、2-8 要缩短来抵消时长。如果 lead 裁定「静场和紧接着的短跑段算同一个场景」（设计表里 2-9 → 2-10 @4 → @24 本来只隔几秒），2-10 可以回到约 92 拍，2-2、2-8 也能恢复设计长度。
- **请 lead 裁定：静场的 `follower: absent` 是不是「静音」**。WP2 的检查把静场 / 站立段的段定义当作静音，不改变追随者状态：3-4 behind → 3-5 公交（静场）→ 3-6 pressure 不算一次登场（3-5 的 busTap 之后 6.2 s 就进 3-6）。校验器同样不把它算作登场。如果要算，3-6 段首要改成 absent，等到 busTap 之后 ≥ 20 s 再出现。
- **WP1（可选）**：`validate.ts` 的 R6 可以照 `anomalyTimeline.ts` 的规则把静场、站立段和跨段的间隔也算进去，这样 `npm run validate` 也能查到。

## 2026-10-01 验收第 2 轮之后的修复（更正上文）

- **澄清**：上一轮提交信息里写的「lead rulings」，指的是本文件里**请 lead 裁定**的事项，目前一条都还没有裁定。下文「请 lead 裁定 / 确认」的几条同样只是申请。
- **给 lead 回写 DESIGN.md 的数据差异（取代上文 2-7、2-10 的数值）**：
  - 2-10 仍是 140 拍（只为了 A-11 的时间），但已经恢复成**减速的叙事收束**（§2.8）：只有 @10 一个障碍（中道地面管线）、@16 左道纸条 n2-b，另外 5 行只占边道（待在中道不用动）。密度 0.43 行 / 10 拍，去掉纸条后求解器只需要 1 次输入。上一轮 @70–@106 复制粘贴的那一段已经删掉。影子 @56、碎角镜替身 @114；停拍从 @137 挪到 @139，停在镜前 1 m（掌心贴掌心）；第三只手在停拍 2.6 s。本章最密的跑段是 2-8（1.63 行 / 10 拍），`tests/unit/content/chapters.test.ts`「§2.8 难度曲线」检查每章最后一个跑段在行密度、20 拍峰值、求解器输入密度上都不超过高潮段。
  - 2-7：回声 @54 不变；停拍 @82（离回声约 5.6 s，上一轮只有 2.8 s，表中约 7 s）、检查点 @92、文字 @96 / @102，加密的障碍从 @108 开始。
  - 2-2：人墙 2 前面 @95 那一行改成只挡左道，@94 中道合上、右道打开时，中道的玩家往右换一次道就进缝（上一轮要先往左躲再连跨两道）。
  - 5-11：门牌「高二（7）班」挪到 @215（表中 @200–212）。@208 翻转时它在玩家前方 7.7 m，翻转之后以反字经过画面（玩家在右道时，横屏约 1.2 s 后出画，竖屏 9:20 约 0.85 s）。翻转之后 @208–@218 不放障碍，之后每 8–12 拍一行，全段 1.32 行 / 10 拍，低于高潮 5-3。减速与淡黑回到表中的 @270 / @276：从 @264 开始减速的话，减速在段末之前就结束了，淡黑时玩家又在加速；现在段在减速里结束。
  - 5-3：电子栏杆回到表中的 @10。
  - 3-2「我们之间隔着半层楼梯…」在 @22（表中 @24，22 个字要显示 2.78 s，@24 开始会超出段末）；3-4 静音段写 18 拍（hush 按触发时的步频换成秒，停拍后要从 0 加速，16 拍只静到 @127.5）。第二章合计 199.9 s（+14.2%），第五章 226.6 s（+5.4%）。
- **给 WP5**：2-10 停拍时玩家在镜前 1 m，`palmToGlass` 的手要够到 @140 的端墙镜。@56 的影子 `pointMirror` 指向走廊尽头，那时镜子还在 84 m 外的雾里：请按「指向走廊尽头」演，不要求镜子在画面里。
- **给 WP8（Hud）/ WP1**：5-3 段首是 pressure，但 `hud` / `voice` 为 none、`steadyMax` 3（见上文）。现在 `src/ui/hud/Hud.ts` 只要 mode 是 behind 或 pressure，就按稳度加暗角，所以 @18–@44「身后什么也没有」那段里受击掉了稳度，也会看到追随者的暗角。请在 `hud === 'none'` 时不加暗角。另外 pressure 模式回稳按 `pressureRegenBeats` 24 拍算（其他模式 16 拍），@52 之前回稳会慢一些。这一条等 lead 裁定 5-3 的写法时一起定。
- **请 lead 确认：A-11 对「替身出现时就已经异常」的计数**。`anomalyTimeline.ts` 只把 world 替身、带第三只手的替身和 attachBehind 替身在出现时算作主异常；按剧本动作（`source: 'script'`）出现的镜子 / 窗户替身按 §10.1「double 不单独计数」不算。因此 2-6 直立行走的倒影（2-5 掌心贴玻璃之后约 17 s 出现）、4-5 广场上的 `plazaMe` → 4-6 水里的 `waterMe`（约 16 s）没有按 20 s 检查。设计表里这几处本来就相邻；如果要算，2-6 与第四章要再加长。
