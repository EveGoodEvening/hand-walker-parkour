# WP8 Lessons

只追加（OWNERS.json APPEND）。记录可复用的经验：库版本、踩过的坑、被纠正的做法。lead 集成时汇总到 AGENTS.md。


- 菜单的「按任意键」与输入队列：章节列表里按回车选章，同一次回车（以及之前移动焦点的 ↓）还留在 Input 队列里，开场卡一出现就被 Game 当成「任意键」跳过。界面切换时必须丢掉上一个界面里按下、还没被 Game 取走的键（`Input.dropPending()`，由 `UI.show()` 调用；松开事件保留，按住集合要配对）。鼠标、触摸点按钮不会进队列（`data-ui-control`），所以只有键盘会踩到。
- `Game.renderFrame()` 先调 `ui.frame()`，后调 `setDevice()`：设备切换要晚一帧才进 UI。UI 在 `frame()` 开头自己读 `Input.active.device()`，否则「滑动后马上摔倒」的失败卡第一帧是键盘文字（`?test=1` 下截图就是那一帧）。
- 章节、设置、纸条这几个界面只由 UI 切换，`__game.screen()` 仍是 `title` / `pause`；e2e 要读 `__game.ext.ui().screen`。`ext.ui()` 反映的是最后一次渲染的帧，`?test=1` 下先 `__game.render()` 再读 DOM 或 `ext.ui()`。
- 摔倒之后 `__game.goto()` 不会清掉 Game 的失败状态，之后 `pause()` 会被拒绝。先 `__game.input('confirm')`（等 1.2 s 之后）真正重来一次，再跳段。
- shot 清单里 `touch: true` 只开设备模拟，设备仍是键盘，直到第一次真的输入。要拍触屏文字，就在 `#app` 上派发一次合成的 touch PointerEvent 滑动（pointerdown → pointermove 36 px → pointerup）。在失败卡上派发 pointerdown 等于「轻触重来」，不要这么做。
- e2e-touch 很快：`step()` 不渲染，整章第一章用真实键盘 / 触摸输入走完只要 6 s / 12 s，加上两档分辨率的版面检查，三轮共约 30 s，远低于锁的 10 min。
- 暂停时 HUD 仍然显示（章名、‖），但字幕会从 70% 的压暗背景里透出来、压在菜单项上。暂停时隐藏 HUD 底部的整个栈。
- 窄屏的中文字幕和卡片句子用 `text-wrap: balance`，否则「……很闷的」「响。」这种只剩一两个字的第二行很难看。
- CSS grid `grid-auto-flow: column` 下给某一项写死 `grid-column: 2`，它会被先放到第 2 列的第 1 行（显式定位的项先排），设置界面的「返回」就跑到了右上角。
- 标题背景是实时 3D 的亮走廊，灰色小字（首次启动提示、角落署名）几乎看不见。只在文字所在的三边加墨色渐变，并给 `.hw-screen` 统一加文字阴影；纸面（`.hw-paper-face`）要显式去掉阴影。
- 附录 B.2 的提示文字要逐字照抄（hold 的触摸是「下滑不松手」，不是「下滑不抬手」）。`tests/unit/ui/strings.test.ts` 现在直接解析 `docs/DESIGN.md` 的 B.2 表格（去掉括号注释）逐条对照 `HINTS`，改文字之前先改设计文档。
- 「每帧最多一次 DOM 写入」要连 Input 一起算：Game 在模拟 tick 里调 `Input.setContext()`，情境按钮如果在那里直接改 `style.display`，开关回头窗口的那一帧就会写两次。现在 Input 只维护模型（`buttonView()`），UI 挂载时调 `deferButton()`，由 `UI.frame()` 经 DomBatch 写。没有 UI 的场合（CORE 的 `tests/unit/core/input.test.ts`）仍然立即写，所以那个冻结的测试不受影响。
- 本机有 PreToolUse hook：凡是会起无头浏览器的命令（`npm run e2e:*`、`shot.mjs`、`verify` 里的 e2e:smoke）必须写成 `~/.claude/bin/heavy-gate -l '<标签>' -- <命令>`，并用 `run_in_background: true`，不要套 `timeout`；`heavy-gate --status` 看槽位。
- WP2 收录对白时可能保留原文的 ASCII 双引号（`"让一下。"`）。按文字找 LineId 时先逐字匹配，再忽略两端引号匹配（`bareLine`）；self / other 样式会自动加「“”」，显示前要去掉原文引号，否则变成两层引号。
