# 手行者 · 跑酷（Hand Walker Parkour）

基于小说《手行者》改编的 three.js + WebGL 跑酷游戏：你用掌根、指节、指腹的节奏穿过一所高中。最终产物是**单个 HTML 文件**，没有任何外部资源。

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
| `npm test` | vitest 单元测试（Node；需要 DOM 的文件首行写 `// @vitest-environment happy-dom`） |
| `npm run validate` | 关卡校验（R1–R8、R10、R13 与静态检查），`--json` 输出报告，`--ch ch1` 只校验一章 |
| `npm run check:single` | 产物只有一个 HTML、≤ 1.5 MB、没有外部 src/href、运行时零外部请求（`--static` 跳过运行时检查） |
| `npm run check:owners` | 所有权覆盖率；在 `wp/<ID>` 分支上检查越界（`--as WP3` 可模拟） |
| `npm run e2e:smoke` | 自动驾驶 0 摔倒跑完第一章，必备节拍、draw call、外部请求、每段截图（`shots/smoke/`） |
| `npm run e2e:touch` | 只用键盘 / 只用触摸（CDP 触摸事件、竖屏）从标题玩到结尾卡 |
| `npm run e2e:chapters` / `e2e:perf` / `e2e:visual` | 全章 e2e / 性能预算 / 各包截图清单（`tests/visual/WPx.json`） |
| `npm run shot -- …` | 通用截图工具（见下） |
| `npm run verify` | check:owners → typecheck → test → validate → build → check:single → e2e:smoke |

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
