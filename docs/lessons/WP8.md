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
- 「最后一次输入的设备」不能只靠动作事件记：界面按钮、情境按钮、「跳过」都带 `data-ui-control`，不进 TouchInput，也不发动作。手机上点「开始」之后让开场卡自己走完，设备一直是缺省的键盘，教学提示全是键盘文字，而且每个只显示一次（hintsSeen）。现在 `Input.attach` 在 window 上挂捕获阶段的 `pointerdown`（比按钮自己的 `stopPropagation` 先到），只记设备、不发动作：touch / pen = 触屏，mouse = 键盘，没写 pointerType 的合成事件不改。初始值按 `matchMedia('(pointer: coarse)')` 猜。菜单里点空白处的 confirm 也按 pointerType 记设备，鼠标不再被记成触屏。
- e2e 里读情境按钮之前必须先 `__game.render()`：按钮的显隐由 `UI.frame()` 经 DomBatch 写，`step()` 不渲染，直接读 DOM 永远是隐藏的，「点回头」那一步从来没执行过（回头次数来自窗口结束时的自动回头）。现在 e2e 读 `__game.ext.ui().ctxLook`（模型），窗口开着时渲染一帧再点，并断言 lookBack 的 `auto: false`。
- 提前出现的教学提示（cue，3.2 s）会比它对应的情境活得久：1-5 的「Q 回头」在 122 拍出现，窗口 124–136 拍，玩家回过头之后它还挂着。窗口关上（prompt 的 context.look 由真变假）或 lookBack 开始时撤掉 `look` 提示。
- 静场「看过」只在按顺序走到下一段（segment 事件的 index = 上一段 + 1）时记。`?seg=<静场>` 启动时 load 和 goto 各发一次同一段的 segment 事件，按「离开就算看过」会让还没看过的静场第一次就能跳过。
- 竖屏 360 px 下 18 px 的字幕一行只放得下 18 字，24 字的句子折成两行，「最多 2 行」实际是 3–4 行。窄屏（≤ 520 px）把字号缩到 24 字正好一行（约 14 px）；玩家选了「大字号」时保持 18 px，宁可折行。
- 附录 B.4 是「只允许以下这些」：不在表里的 HintId（anyKey）也不能自己截短 B.4 的句子，直接用整句。
- 更正上面「shot 清单里 `touch: true` 设备仍是键盘」那条：现在 Input 开机按 `(pointer: coarse)` 猜设备，Playwright 的 `hasTouch + isMobile` 模拟下它成立，所以 `touch: true` 的截图一开始就是触摸文字。要在 e2e 里证明「点按钮会切设备」，先用 `__game.input('confirm', 'up')` 把设备拨回键盘（标题界面不处理输入），再点按钮。`__game.ext.ui().device` 是最后一次渲染时的值，`step()` 不渲染，读之前要 `__game.render()`。
- （U4）回到标题要先复位场景、复位完成后再切到标题屏：读章时发出的 checkpoint 不会写进「继续」（那时屏幕还是失败卡 / 暂停），声音包也是先收到 chapter:start / segment、再收到标题屏。表示「正在复位」的 Promise 必须在启动异步体之前挂上：同一章的分支（goto + afterJump）是同步跑完的，先跑完再赋值，finally 里的清空就被覆盖，tick 永远早退。
- （U4）Game 可以在单元测试里整个 boot：`// @vitest-environment happy-dom`，`import '../../../src/sim/index'` 注册真的 Sim / Solver，再 `registerView / registerAudio / registerUI / registerInput` 换成只记录调用的假实现；boot 之后 `game.loop.stop()`，用 `game.tick()` 推进。blur / focus 直接 `window.dispatchEvent(new Event('blur'))`。
- （U4）同一个元素换了文字，CSS 的淡入动画不会重播。数数每出一个新数就在两个内容相同的 keyframes 名字之间切换（`.alt`），DomBatch 只多写一个类。
- （U4）字幕的柔边衬底用 `background` 加同色的 `box-shadow` 扩散，跟着每一行的宽度走（flex 列里 `align-items: center` 的子项按内容收缩）。窄屏「24 字一行」的字号公式要扣掉衬底的左右 padding，否则又会折行；贴边的低语改用 margin 留边、max-width 96%。
- （U4）文字对比度的量法：同一状态拍两张（第二张 `color: transparent !important`，阴影、衬底保留），两张图亮度差最大的那些像素就是字形中心，比较它们在两张图里的亮度（字形对它背后）。test 模式是确定性的，分两项截图也能逐像素对齐；章名有 2 s 的淡出过渡，wait 要 ≥ 2.5 s。
- （U4）主角的屏幕包围框：`root = scene.getObjectByName('player')`，取它的 SkinnedMesh，`mesh.getVertexPosition(i, v)` 已经带蒙皮（局部坐标），再 `applyMatrix4(mesh.matrixWorld).project(camera)`。读之前先 `__game.render()`，骨骼的 matrixWorld 才是这一帧的。
- （U4）自动画质切档会同步重建 chunk（SwiftShader 下 150–270 ms）。AutoQuality 只做决定，Game 在下一个静场 / 站立段开头、重来、读章时才切；手选档位立即生效（在菜单里）。
- （U4）等后台的重命令跑完，用 `until grep -q '^exit' <后台任务的输出文件>; do sleep 5; done`（命令末尾 `echo exit $?`）。不要用 `until ! pgrep -f '<计划文件路径>'`：等待命令自己的命令行里也有这个路径，pgrep 永远能匹配到它自己，循环不会结束。
- （修复轮 B3）HUD 元素按 3D 画面里的东西让位时，先在 Node 里用游戏的机位投影 set 的几何体（横屏视角固定、竖屏 ×1.3，比例只随宽高比变），得到「指尖在 53–55% 高度」这类与分辨率无关的数，再用 `vh` 写 CSS；只挪 `transform`，栈里照样占位，别的元素不跟着动。页面里的验收：读 DOM 元素的包围框，用 `wp3Color` 取它下面那块画布的颜色，和同一高度画面边上的空地比；临时去掉类名再取一次，就是同一页里的「修复前」。
- （修复轮 B3）跳过静场时模拟会丢掉叠加层 cue，可闭眼、黑场这类会留在画面上进下一段。界面在 `noteSkip` 里先把正在进行的黑场 / 冷色渐变走完（`settle`），再把本段还没到的持久叠加层（含 onDone）按终态应用；`noteSkip` 读的 `this.snap` 来自最近一帧或最近一个事件，已经发生过的 cue 不会重放。
- （修复轮 B3 r2）段落切换用不用黑场，统一由 `hud/overlays.ts` 的 `segmentCut(prev, next, script)` 决定：进出静场，以及跑段接七步站立段（5-7 → 5-8：主角从爬行跳到坐姿，5-7 的同学同一帧有了上身，镜头还在追尾的位置）。梦里的站立（4-3）从爬行直接起身，广场上的人一直有上身，不切。别的包让「画面在某一帧突变」时，先用 Node 测出视锥里到底有没有东西变，再决定切不切（`tests/unit/npc/standCut.test.ts`）。
- （修复轮 B3 r2）可交互的结尾卡（第四章 ↓ ↓ ↓）从出现起就发 `hw-ui-await` = true，到输入完成才收回：提示出来之前卡上还没有按钮，方向键、回车什么也不做，也不该响菜单音。事件只在状态变化时发（`OutroScreen.setQuiet`），离开结尾卡时收回。
- （修复轮 B3 r3）HUD 给 3D 画面让位时，把整个栈一起挪（transform 放在栈容器上），不要只挪其中一项。只挪节拍点，它就跑到字幕上面（§7.2 的顺序反了），字幕还压在原处的掌心上。栈里绝对定位的子元素（横屏的操作提示）会跟着容器一起平移，要在同一个媒体查询里用相反的 translate 抵消。页面验收读 `.hw-line`、`.hw-hint.on`、`.hw-self` 的包围框，和手的投影包围框比较。
