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
