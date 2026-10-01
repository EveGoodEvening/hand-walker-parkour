# WP7 Lessons

只追加（OWNERS.json APPEND）。记录可复用的经验：库版本、踩过的坑、被纠正的做法。lead 集成时汇总到 AGENTS.md。


## 2026-10-01（WP7 声音）

- **本机钩子：启动浏览器的命令必须经 `~/.claude/bin/heavy-gate -l '<标签>' -- <命令>`，并用后台方式运行**（不要套 `timeout`）。同一条 Bash 命令里如果既用 heredoc 写文件、又启动浏览器，整条命令会被拦下，文件也写不出来：先用写文件工具写好脚本，再单独跑。`heavy-gate --status` 看占用。它与 `scripts/browser-lock.mjs` 是两层锁，两层都要过。
- **Node 里测 WebAudio**：Node 没有 WebAudio。`tests/unit/audio/offline/mini.ts` 按规范实现了声音包用到的 OfflineAudioContext 子集（128 帧量子、完整的 AudioParam 自动化、规范公式的双二阶、等功率声像、分块 FFT 卷积、压缩器、WaveShaper）。要和 Chromium 对得上有两处细节：`BufferSource.start(when, offset)` 的 offset 要**取整到样本**（按小数插值等于给白噪声加了低通，高频噪声轻 0.5–1 dB）；方波 / 锯齿 / 三角要用**规范傅里叶系数的带限波表并归一到峰值 1**（朴素方波加 polyBLEP 会响约 2 dB）。做完这两处，318 个预渲染声音与 Chromium 逐键 RMS 差 ≤ 0.4 dB（`node tests/unit/audio/browser/run.mjs` 每次都复核）。
- **Chromium 的 DynamicsCompressor**：(1) 每级有 6 ms 前瞻，两级串联整条输出链路固定延迟 12 ms——测时间窗（静音段、安静的一秒、起点）时要先量出链路延迟再扣掉（`scenarios.chainLatency`）；(2) 补偿增益（makeup）从 0 dB 起要约 0.3 s 才爬到稳态：−14 dB / 4:1 / knee 6 稳态 5.15 dB，−9 dB / 20:1 / knee 0 稳态 5.13 dB，而 72–120 ms 时只有 2.7 / 1.4 dB。量补偿增益的离线渲染至少 0.6 s、取最后 0.2 s；早先 0.12 s 的校准少补了约 6 dB，整个混音偏响。
- **峰值 ≤ −8 dBFS 不要只靠压缩器**：没有前瞻的实现（或极端叠加）会漏过第一毫秒。限幅器后面接一个 WaveShaperNode 软削波（拐点 −9.5 dBFS 以下逐点恒等，tanh 逼近 −8.1 dBFS），这是原生节点，保证任何输入都不超过上限。
- **Game 只把 `screen` 发到 EventBus，不经过 `AudioAPI.onEvent`**（`settings`、`pause` 也是直接调方法）。要按屏幕做事（菜单界面音、结尾卡淡出），在 `registerAudio` 的工厂里 `bus.on('screen', …)`。
- **声部上限**：事件不按时间顺序到达（触地随机化 ±4 ms、环境颗粒提前 0.35 s 排程），「满了就抢一个」会让同时发声超过上限（压力场景里到 40）。应当把「在新声音开始之后还会响的全部声部」压到上限以下，可能要连抢几个，抢不够就放弃新声音。
- **随机化按掌抽、不按段抽**：§6.2 的「时间 ±4 ms」如果三段各自抽，掌根 / 指节 / 指腹的 26 / 52 ms 间隔会乱掉 8 ms；在掌根抽一次、同一掌沿用，整掌平移，间隔精确，干脆时严格对齐。
- **用互相关测「渲染出来的时刻」**：追随者在稳度 3 时过 2 kHz 低通加 0.6 混响，指节、指腹会被自己的混响尾巴盖住，互相关找错位置（偏 3–4 ms）。自己和追随者分两次渲染（同一时钟偏移），追随者用稳度 0 的混音（时间只取决于事件时间戳，与混音无关），参考波形也过同一个低通。
- **起音时间的测量窗取 20 ms**：低语的共振峰带通（Q 4–5）是窄带噪声，10 ms RMS 包络起伏大，最大值落在随机起伏上，起音会少量 30–40 ms。
- **离线模式的「现在」**：由模拟时间反推（`SimClock.virtualNow`）。只有环境音、没有触地声的场景，时钟永远不对齐，所有排程都挤在 0 附近——第一帧就对齐；换章时不要在离线模式里重置时钟（「现在」会倒回 0）。
- 无头 Chromium 里 `new AudioContext()` 的缺省采样率是 44100；Playwright 的 `keyboard.press` 是可信事件，能满足自动播放策略，`resume()` 后状态是 `running`，不需要 `--autoplay-policy` 参数。
- 给浏览器打包测试入口：`esbuild@0.28.2` 是 tsx / vite 的传递依赖，`import { build } from 'esbuild'` 直接可用（`format: 'iife'`、`write: false`，再 `page.addScriptTag({ content })`）。

## 2026-10-01（WP7 第 1 轮验收后的修复）

- **更正上面第一条**：浏览器命令不需要后台运行。前台经 `~/.claude/bin/heavy-gate -l '<标签>' -- node tests/unit/audio/browser/run.mjs` 跑就行，Bash 超时设到 10 min；不要用 `&` 或后台进程，也不要套 `timeout`（lead 的资源纪律）。`npm run verify` 里有 e2e:smoke，同样要经 heavy-gate。
- **挂起要两个标志**：Game 只在游玩屏幕失焦时自动暂停，而且暂停菜单里「从检查点重来」「回到标题」不调 `suspend(false)`。声音自己记「Game 的暂停」和「失焦 / 隐藏」两个标志，任何一个成立就 `ctx.suspend()`，两个都清掉才 `resume()`；离开 pause / settings 屏幕视为 Game 的暂停结束。失焦监听放在 `registerAudio` 的工厂里（`window` 的 blur / focus、`document` 的 visibilitychange）。
- happy-dom 里测标签页隐藏：`Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })`，再派发 `visibilitychange`；测完 `Reflect.deleteProperty(document, 'hidden')` 还原。
- **人群的脚步**：NPC 组（`NpcGroupDef`）只有 from / to（拍）和 side，没有逐人位置。按段内拍号算远近（玩家在范围里满电平，10 拍外听不见），walk 障碍的位置用 `at + speed / stride × tSeg`。第一章没有 walkers，e2e 测不出来，要自己造一段带 walkers 的章节测。
- **朗读膜的电平**：按「带宽 × 白噪声功率」估算会忽略整体低通（操场 1.2 kHz 切掉大半个 F2），偏低 3–6 dB。改成用 JS 把白噪声过三组典型 F1 / F2 加整体低通实测，再乘有效占空比 0.3，早读 / 食堂 / 操场都落在配方电平 ±1 dB。
- **主线程尖峰**：程序生成脉冲响应时每样本两次 `Math.exp`，4 s 的虚空走廊要 16 ms，而且是在换地点那一帧里现算。改成乘法递推（低通系数每 16 个样本更新一次）后约 4 ms，并在解锁后用 `setTimeout` 一个一个预生成；梦中掌声的三个循环缓冲也拆成三次。
- **cue 日志**：每掌六条掌声 cue，一章就把 1024 条的环形挤满，章首的 `bell:morning` 读不到。稀有 cue 另存一个环形，`recent(n)` 按发生顺序合并。
- **ConvolverNode 的 buffer 赋值才是大头**：Chromium 在主线程上给 `ConvolverNode.buffer` 赋值时就做分块 FFT，实测 1.2 s 的走廊约 6 ms、3 s 的广场约 14 ms、4 s 的虚空走廊约 18 ms；两组混响各一个，换地点那一帧会卡 12–36 ms（这才是第 1 轮验收看到的 21.5 / 30.9 ms 尖峰，比生成脉冲响应本身贵得多）。做法：每组混响按地点缓存装好的 Convolver，读章时在空闲任务里预先装好本章用到的（A、B 各一个任务），换地点时只接线；还没装好就把「装 A、装 B、切换」插到空闲队列最前面，不在帧里做。改完后第一章实时跑完，单帧最大 1.8 ms（之前 12 ms）。用 `__game.ext.audio().maxFrameWhat` 看最贵的一帧是哪个事件。
- 在 scratchpad 里写的浏览器脚本：`playwright-core` 能直接 import，`esbuild` 解析不到——用 `await import('<worktree>/node_modules/esbuild/lib/main.js')`（取 `.default.build`）。

## 2026-10-01（WP7 第 2 轮验收后的修复）

- **同一 tick 里 cue 的先后由关卡数据决定**：WP2 的 4-3 把 `crowd applaud` 写在 `ambience dreamApplause` 前面，引擎「只在当前环境音是掌声时才改参数」就把对齐丢了。依赖另一个 cue 先到的状态一律**锁存**（不管当前是什么环境音都记下），创建实例时立即应用；读档 / 跳段时和环境音一样按章节数据重建（`soundStateAt` 一并算出）。测试两种顺序都要覆盖。
- **同一个一次性声音从两条路径各排一次，相隔 1 tick（8.33 ms）正好是 60 Hz 的半个周期**：膝盖闷响的 60 Hz 主体互相抵消，40–90 Hz 低了约 10 dB，听起来反而更轻。§8.7 的「唯一处理者」表要逐行对照：`stand` 只分给 WP7「先轻后重」，第七步的闷响归关卡的 sfx cue。共用的声音再加一个短窗口去重（0.1 s）。
- **`cancelScheduledValues(now)` 连恰好在 now 的事件也取消**：门（Gate）在同一时刻连改两次时，第二次如果把第一次排在 now 的恢复当成「已经生效」并因为目标没变而跳过，参数就停在旧值。实例：人群段绊倒（安静的一秒）后很快摔倒、5 s 内重来，环境和人群的门停在 0，整段没有环境声。判断「当前目标」只能看 t < now 的排程点。
- **门掉一条总线要连它的混响发送一起门**：发送是每个声部直接接到混响组的，不经过总线输出的门。静音段只门干声时，铃的混响照样响（−26 dBFS 几乎不降）。做法：发送也过一个增益，和总线输出由同一个 Gate 排程。共用的混响组里已经有的尾巴门不掉（否则连自己掌声的混响也没了），按房间衰减时间自然消失。
- 静音段要门掉音效总线，但「嘘」本身就是静音段的开头（1-6 里和 hush 同一刻），要走不受门影响的总线；5-5 的椅子刮擦与 `silence` cue 同一刻，所以静默 cue 不门音效总线。
- 摔倒的一次性声音（膝盖闷响、两串节拍合一）原来接在房间底噪的门后面，静音段一门底噪，摔倒就没声了。给它单独一条有门的总线（`floorSfx`），失败、静音段、静默都不门它。
- **`requestIdleCallback` 的 timeout 每次重新请求都从头算**：空闲期不够就再请求一次的写法，在每帧都有一点空闲的游玩中永远等不到超时。自己记每件任务的入队时间，等够了就照做。
- tsx 跑 scratchpad 里带顶层 await 的脚本要用 `.mts` 扩展名（`.ts` 会按 cjs 转换，报「Top-level await is currently not supported」）。
- 量「修复前」的数字不必切分支或动工作区：`git archive HEAD src tests tsconfig.json package.json | tar -x -C <scratch>/old`，再把 `node_modules` 软链过去，用同一个场景脚本跑。
