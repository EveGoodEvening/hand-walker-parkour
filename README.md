# 手行者 · 跑酷（Hand Walker Parkour）

基于小说《手行者》改编的 three.js + WebGL 跑酷游戏：你用掌根、指节、指腹的节奏穿过一所高中。最终产物是**单个 HTML 文件**，没有任何外部资源。

## 怎么玩

在线试玩：[手行者 · 跑酷](https://evegoodevening.github.io/hand-walker-parkour/)。

`npm ci && npm run build`，然后用浏览器打开 `dist/index.html`（桌面或手机都可以，建议戴耳机）。

| 操作 | 键盘 | 触摸 |
|---|---|---|
| 换道 | ← → 或 A D | 左 / 右滑 |
| 撑跃 | ↑、W 或空格 | 上滑 |
| 伏低（按住延长；腿自己抬起时也用它按住） | ↓ 或 S | 下滑，手指不抬起 |
| 回头 / 让一下（只在提示出现时可用） | Q / E | 右下角的按钮 |
| 暂停 | Esc 或 P | 右上角「‖」 |

五章约 15 分钟：早自习、午饭、雨夜、广场、七步。只有一种失败：稳度（HUD 的节拍点）用完时摔倒，从检查点重来。身后那串晚半拍的掌声，就是你的稳度。

- 唯一权威设计：[`docs/DESIGN.md`](docs/DESIGN.md)（v1.0）。调性原则与经验：[`AGENTS.md`](AGENTS.md)。
- 文件所有权：[`OWNERS.json`](OWNERS.json)，`npm run check:owners` 检查。

## 环境

- Node ≥ 24（本仓库在 24.18 上开发），npm 11。
- 依赖全部是 devDependencies，版本锁死（`package-lock.json`）：`three@0.186.1`、`@types/three@0.186.0`、`vite@8.3.1`、`vite-plugin-singlefile@2.3.3`、`typescript@7.0.2`、`vitest@5.0.3`、`happy-dom@20.14.5`、`playwright-core@1.63.0`、`tsx@4.23.15`、`@types/node@24.19.0`。**不要装 `playwright`**（会下载浏览器）。
- 无头浏览器：本机缓存的 `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，SwiftShader（可用 `HW_CHROME` 覆盖路径）。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 单文件构建 → `dist/index.html` |
| `npm run typecheck` | `tsc --noEmit`（TypeScript 7） |
| `npm test` | vitest 单元测试（Node；需要 DOM 的文件首行写 `// @vitest-environment happy-dom`）。WP1 的在 `tests/unit/sim/**`、`tests/unit/levels/**` |
| `npm run validate` | 关卡校验 R1–R13 与静态检查（§2.8），再接 WP2 的内容 lint（R14，`src/levels/lint.ts` 的 `lintAll()` / `lintChapter(def)`，约定见 `docs/contract-requests/WP1.md`；文件不存在时打印 skipped）；还没实现的章打印 skipped；有 error 或校验超过 20 s 都算失败。`--json` 完整报告，`--ch ch3` 只校验一章，`--meta` 输出章节元数据（给 e2e 用） |
| `npm run bot:difficulty` | human 机器人难度报告（JSON）：每章每个检查点区间的失败率，按区间对照 §2.8 目标（上限 + 3 个百分点；任何一个区间超过，这一章就是 harder，列在 `over` 里）。`--trials 40`、`--ch`、`--out`、`--strict`（有 harder 的章时退出码 1） |
| `npm run check:single` | 产物只有一个 HTML、≤ 1.5 MB、没有外部 src/href、运行时零外部请求（`--static` 跳过运行时检查） |
| `npm run check:owners` | 所有权覆盖率；在 `wp/<ID>` 分支上检查越界（`--as WP3` 可模拟） |
| `npm run e2e:smoke` | 自动驾驶 0 摔倒跑完第一章，必备节拍、draw call、外部请求、每段截图（`shots/smoke/`） |
| `npm run e2e:chapters` | 先自检（test 章连跑两遍，第二遍必须同样跑完），再把已实现的章都用 perfect 跑到**本章**的 `chapter:end`：0 摔倒、必备节拍（含结尾卡输入上的，用真实键盘按 ↓）、每 60 tick 取样的峰值 draw call ≤ 50、零外部请求、每段截图 `shots/chapters/`，一次取锁 |
| `npm run e2e:perf` | 预算：峰值 draw call / 三角形（`--q low|medium|high`）；同一章连跑多遍（缺省 2 遍，`--minutes 5` 跑满 5 分钟游戏时间），之后任何一遍的几何体 / 纹理数比第一遍多就失败；每一遍都必须跑完整章 |
| `npm run e2e:visual -- --wp WP3` | 执行 `tests/visual/WP3.json`（shot.mjs 的 --plan 格式），输出 `shots/visual/WP3/`；任何一张图有外部请求即失败；`--check` 只校验清单 |
| `npm run e2e:touch` | 只用键盘 / 只用触摸（CDP 触摸事件、竖屏）从标题玩到结尾卡 |
| `npm run shot -- …` | 通用截图工具（见下） |
| `npm run verify` | check:owners → typecheck → test → validate → build → check:single → e2e:smoke，依次执行（`--full` 再加 e2e:chapters、e2e:perf；`--skip-e2e` 不开浏览器；`--keep-going` 某步失败也跑完其余步骤再汇总） |

### 运行 .ts 脚本

用 **tsx**（`npx tsx scripts/validate-levels.ts`）。Node 24 自带的类型剥离不够用：`src/` 里的 import 不带扩展名（Vite 风格），Node 原生 ESM 解析不了。

### 截图自查：`scripts/shot.mjs`

```bash
node scripts/shot.mjs --q low --size 640x360 --query "ch=ch1&seg=1-2&beat=40" --steps 240 --out shots/ch1-1-2.png
node scripts/shot.mjs --query "ch=ch1&seg=1-3" --eval "__game.setAutopilot('off')" --steps 60 --eval "__game.input('up')" --steps 20 --out shots/x.png
node scripts/shot.mjs --plan shots.json      # [{ "out": "...", "query": "...", "steps": 240, "eval": ["..."] }, ...]
```

- 自动加 `test=1&mute=1&q=…`；缺省再加 `autopilot=perfect`（`--no-autopilot` 关闭）。`--steps` 与 `--eval` 按命令行顺序执行。
- 缺省打开 `dist/index.html`（比源码旧时自动重新构建），`--url` 可指向 dev 服务器。每张图输出一行 JSON（屏幕、段、拍、稳度、draw call、页面错误）。
- 截完一定要亲眼看一下图（黑屏、全白、看不清都算失败）。

### 浏览器锁

所有启动浏览器的脚本都经 `scripts/browser-lock.mjs`：2 个槽位 `/tmp/hw-parkour-browser/slot-{0,1}.lock`（进程已死或超过 20 min 视为失效）。
`node scripts/browser-lock.mjs` 打印当前占用情况。任何时候最多 2 个 agent 在跑浏览器。

## 模拟（`src/sim/`，WP1）

纯 TS、不 import three，120 Hz 固定步长，确定性（`rng.sim`；机器人另用 `rng.bot`）。一个机制一个文件：

| 文件 | 内容 |
|---|---|
| `Sim.ts` | 主体：每 tick 的顺序写在文件头；快照、事件、检查点与重来、提示与情境按钮（prompt） |
| `Player.ts` `Pace.ts` `Gait.ts` `Collision.ts` `Steady.ts` `Follower.ts` `Track.ts` | 横向 / 竖直 / 伏低、段内速度（减速、停拍、自动爬行、段中换挡）、三段触地、双层碰撞盒、稳度、追随者、障碍行为 |
| `Twitch.ts` `Drift.ts` | 腿自主抬起（按住 ↓ 压住）与腿偏移（反方向键掰正）；状态平铺在 `PlayerState` 上，求解器逐 tick 复现 |
| `LookBack.ts` `Ask.ts` | 回头窗口（收益每章一次、重来时恢复到检查点时的状态；auto、then）与「让一下」（人群段、6 m、0.5 s 后让开、seeded 30% 不动、每段 2 次） |
| `Stand.ts` `StillRunner.ts` | 七步（第 7 步必定摔倒、第 2 步必定撑地、θ 只影响画面）与梦中站立；静场时间线（hold + progress、tap、taps3、any、超时） |
| `Leader.ts` | ahead：前方 3 / 6 / 9 / 12 m、永不更近、按求解器路线换道（读章时预先求好）、appear / recede |
| `Solver.ts` | 车道 × 时间的分层 DP（0.05 s 网格），与模拟共用同一套推进代码；支持周期 / 移动 / 到点障碍、腿部事件、开口（noAsk）、休息窗 forbid |
| `Autopilot.ts` `HumanBot.ts` `StillPilot.ts` | perfect（从完整当前状态求解、按里程执行）与 human（反应 250 ± 60 ms、5% 失误） |

校验器在 `src/levels/validate.ts`（R1–R13 + 静态检查；R14 归 WP2 的 lint）。规则报 error 就是 error：工作包不得自行把它降成 warning，哪怕是别的包的数据问题、哪怕自己的分支因此变红（在 `docs/contract-requests/` 里写清数据、时刻和修法，等数据修好或 lead 裁定）。`WAIVERS` 只收 lead 在 DESIGN §10 里书面批准的豁免：每条精确匹配一条报错消息（数据一改自动失效），`approval` 必须逐字出现在 §10（单元测试检查）；目前为空。

必备节拍（附录 C）可以挂在事件、静场 / 站立段的输入、结尾卡输入和窗口上。rest / ask 窗口在段内拍号到达 `from` 时触发窗口 id 并播放 `then`；auto 回头窗口在窗口结束前必定回头；非 auto 回头窗口（及其 `then`）只在玩家按 Q 时触发，是可选行为，必备节拍挂在那里校验器报 error。

## 测试钩子

`window.__game`（`src/core/debugHook.ts`）始终存在；会改变状态的方法只在 `?test=1` 或 `?debug=…` 时可用。
`?test=1` 时 rAF 只渲染、不推进模拟，用 `__game.step(n)` / `advance(ms)` 同步推进。URL 参数见 DESIGN.md §8.8。

## 目录

```
src/core/        契约、主循环、注册表、测试钩子（CORE，冻结）
src/levels/      关卡格式、编译、校验、台词、章节数据
src/sim/         确定性模拟（纯 TS，不 import three）：步态、碰撞、稳度、追随者、求解器、自动驾驶
src/render/      画面：View、世界（chunk / set）、角色、镜头、NPC 与障碍、天气
src/audio/       声音（CORE 阶段是静音占位）
src/ui/ src/input/  界面、HUD、输入
scripts/         构建检查、e2e、截图、校验
tests/unit/**    单元测试；tests/visual/WPx.json 截图清单
```

CORE 阶段的画面、声音都是占位实现：各包只要在自己的 `index.ts` 里注册正式实现，注册表就会替换掉占位。
