# 手行者 · 跑酷（Hand Walker Parkour）

基于小说《手行者》（https://github.com/EveGoodEvening/hand-walker ）改编的 three.js + WebGL 跑酷游戏。主角是小说中那个只会用手走路的高中生。

## 改编原则

- 遵循小说仓库 `AGENTS.md` 的调性：简约、克制、冷色调；恐怖来自熟悉场景里的细节错位（倒影慢半拍、第三只手、影子与本体不一致、无人脚步声），不是怪物或 jump scare。
- 不做爽文：用手走路不是超能力；"站起来"是不稳定、会摔倒的尝试，不是逆袭。
- 超自然元素保持暧昧，不给出明确解释。
- 游戏内文字用中文，句子短，不用网络流行语和 emoji。

## Lessons

- 无头测试 WebGL：本机已缓存 Playwright 浏览器 `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`。用 `playwright-core@1.63.0`（不要装 `playwright` 触发下载），`chromium.launch({ executablePath, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })`，WebGL2 可用（SwiftShader，较慢）。
- 截至 2026-09：`three@0.186.x`、`vite@8.3.x`。
- 同时最多运行 2 个重度使用浏览器的 agent。
- `vite-plugin-singlefile@2.3.3` 的 peerDependencies 含 `vite ^8.0.0`（2026-09 查证），可直接用于单文件构建。
- 小说第四章原文混入两处英文（"广场 suddenly 变得很安静"、"没有 chalk 的粉末"），游戏引用台词时必须避开。
- 截至 2026-09 已核实：`vitest@5.0.3`、`typescript@7.0.2`、`@types/three@0.186.0`。three r186 的 `WebGLRenderer` 默认 `stencil: false`，用模板技巧（水洼倒影、平面影子）时必须显式传 `stencil: true`；平面影子可参考 `three/addons/objects/ShadowMesh.js`（stencil Equal 0 + Increment）。
- 原文核对（设计评审时发现的常见错误）：主角第一次用脚走路是第五章体育课（"一个我以为永远不会发生的动作"），第一到三章不能给玩家自由站立/行走的操作，只能有扶着窗台、椅背、洗手台、桌沿的"临时装配起来的正常"；"第七步的时候，我摔倒了"，步数固定为七，不要做成"走了 N 步"；医务室里"走了七步。"是"我"回答陈默，不是陈默说的；"因为我站不起来。"是他自己擦掉黑板字后写的，不是异常；第五章床上的脚最后"终于放松"，不是按不住。
- 调性核对：伸进过道的脚是"不是成心的，只是习惯"，不要做成玩家靠近才触发的伏击；"搭肩的第三只手"是第三章卫生间镜子和第五章厕所镜子的专属意象，不要当作反复出现的失败画面；第四章"你想选哪一个？"原文没有回答（被掌声盖住），不要做成二选一 UI。
- 镜子替身渲染陷阱：墙镜/窗的替身是按镜面反射到墙"后面"的，只用"镜面四边形写模板 + 替身 stencil Equal"而墙体照常写深度，替身会被墙的深度挡掉、完全不可见。要么让镜子成为墙上的开口（chunk 预留 opening + 后面放暗色"镜中房间"盒），要么做经典 portal：先写模板，再在模板区用 depthFunc Always 把深度重置为远平面，然后再画替身。水洼可让地面 `depthWrite:false` 先画，地下的 `scale.y=-1` 替身照常测深度，保留自遮挡。
- SwiftShader 预算：角色（主角/倒影/影子）一律用"刚性蒙皮"合并成 1 个 SkinnedMesh（每顶点 skinIndex=部位骨骼、weight=1），不要用每部位一个 Mesh 的层级（约 18 draw call × 替身数会直接超出低档 50–60 的总预算）。平面影子可用 `DetachedBindMode` + bindMatrix=I，把投影矩阵设为影子 mesh 的 matrixWorld（`matrixAutoUpdate=false`，`frustumCulled=false`，MeshBasic）。
- 设计定稿见 `docs/DESIGN.md`（v1.0，唯一权威）。易错点：1 拍 = 1 掌（单手落地），清醒时步幅 1.0–1.1 m、梦里 1.3–1.5 m，支撑期身体只前移 0.6 m；倒影的「慢半拍」在画面上按秒算（0.35 s，头部 0.6 s），不按拍换算，因为 5 掌/s 时半拍只有 0.1 s，肉眼看不出来。
- 引用原文前先用脚本对五章原文做子串检查。常见陷阱：「疼。每天都疼。」原文中间隔着「我说」，要拆成两句；「它在所有能反光的地方，」原文后面是逗号；第二章的 "让一下。" "别。" 原文用的是 ASCII 双引号；跨段落的句子（如「我猛地回头。」「走廊空了。」）要拆开引用。
- git 提交信息里**不要**写 AI 署名尾注（Co-Authored-By 之类），本机 PreToolUse hook 会直接拦截整条 Bash 命令（它扫描整条命令文本，包括同一命令里的 heredoc 内容，所以写文件和 git commit 要分成两条命令）。
- 开发在 `feat/parkour-game` 分支（`main` 保持空）；并行工作包在各自 worktree 的 `wp/<WP>` 分支上提交，由 lead 按顺序合并。各工作包把 lessons 写到 `docs/lessons/<WP>.md`（避免 AGENTS.md 合并冲突），lead 集成时汇总到这里。
- 工具链（CORE 定稿）：`.ts` 脚本一律用 `tsx` 跑（`npx tsx scripts/xxx.ts`）。Node 24 自带的类型剥离解析不了 `src/` 里不带扩展名的 import。`typescript@7.0.2` 的 `tsc --noEmit` 配 `moduleResolution: bundler` 可以直接用。`TUNING` 用了 `as const`，类字段写 `value = TUNING.x` 会被推成字面量类型，必须显式标 `: number`。npm 11 会提示 esbuild 的 postinstall 没跑，但可选依赖 `@esbuild/linux-x64` 已经装上，vite 和 tsx 都能正常工作。
- 无头截图：界面的淡入是 CSS 动画，按真实时间走；`?test=1` 下模拟是手动 step 的，切屏后马上截图会拍到透明的界面。用 `node scripts/shot.mjs --wait 1500`。本机只有 WenQuanYi Zen Hei 这类 CJK 字体，没有竖排字形度量，`writing-mode: vertical-rl` 会叠字。竖排标题改成逐字堆叠。
- 界面容器的类名不要和内部元素重名。`hw-screen hw-title` 曾经让整个标题屏都套上了 `.hw-title` 的竖排样式。容器现在统一用 `hw-s-<name>`，测试用 `[data-screen=…]` 选。
- 碰撞（CORE 的解释，已写进 `sim/Collision.ts`）：内层盒只在横向缩到 85%。如果 s 向也缩，正面冲撞第一帧总是先碰到外层，永远会被判成擦边。横档的竖直穿透按「玩家盒顶 − 横档下沿」算，不按横档厚度截断，否则 8 cm 厚的拖把杆爬行撞上去永远只算绊。
- 求解器（`sim/Solver.ts`）按时间分层做 DP，逐 tick 复用 `PlayerState` 和 `Pace` 的代码，所以路线能在 Sim 里逐 tick 复现，自动驾驶按里程执行。去重键只能编码会影响未来的状态，已经结束的动作要归一化。曾经把 `duckStartBeat` 放进键里，状态数爆炸，32 拍的测试段都解不完。
- `SkinnedMesh` 刚性蒙皮：先 `rootBone.updateMatrixWorld(true)`，再 `new Skeleton(bones)`（逆矩阵在构造时计算），然后 `mesh.add(rootBone)`，最后 `mesh.bind(skeleton)`。设 `frustumCulled = false`。
- 浏览器锁：§8.8 的示例在 `withBrowserSlot` 的回调里启动浏览器后立即返回，浏览器还没关锁就释放了。现在用 `acquireBrowserSlot()`，由 `openGame().close()` 负责关浏览器并释放锁。触摸 e2e 用 CDP 的 `Input.dispatchTouchEvent` 滑动，距离取 32 px：超过 24 px 阈值，又不到 2 倍阈值，所以不会连换两道。
- 标题背景在读章时也会发 `checkpoint`。存档里「继续」的位置只在 play 或 intro 屏幕下写，否则第一次打开就会冒出「继续」。
- 资源上限（2026-10-01 曾因 OOM 整个会话被杀）：本机 8 核 15 GB，且与他人共用。并行 agent 同时最多 3 个；`vitest` 已在配置里限 `maxWorkers: 2`；不要在同一个 agent 里并发跑多个重命令（verify、e2e、build 依次跑）；无头浏览器一律经 browser-lock，用完立即关闭；结束前确认没有遗留的 chrome 进程（`pgrep -f chrome-linux64`）。
- 本机有全局内存闸门（见 `~/.claude/CLAUDE.md`）：任何会启动浏览器的命令都必须经 `~/.claude/bin/heavy-gate -l '<标签>' -- <命令>`，并用 `run_in_background` 运行（闸门可能等好几分钟，不要套 `timeout`）。本项目里会启动浏览器的有：`npm run verify`（最后一步是 e2e:smoke）、`npm run e2e:*`、`node scripts/shot.mjs`、`tests/e2e-touch.mjs`、`bot:difficulty`（如果它开浏览器）。例：`cd <repo> && ~/.claude/bin/heavy-gate -l hw-verify -- npm run verify`。只跑静态检查时用 `npm run typecheck`、`npm test`、`npm run validate`，它们不开浏览器、不需要闸门。项目自带的 `scripts/browser-lock.mjs` 仍然保留（在闸门之内再排队），不要再加新的锁。
- 集成（2026-10-01，lead 汇总八个工作包的 `docs/lessons/WP*.md`，原文件保留作历史）。以下按主题分组，只留可复用的经验。
- **校验与数据**：
  - 规格里写了「≤ / ≥ 某值」的边界一律带 1e-9 容差，并用精确边界值写单元测试（`0.55 − 0.43 > 0.12`）。步态跨整数拍时判定两头要用同一个容差，否则同一拍发两次掌根。
  - 引用了别处公式的量（字幕停留 = 字数 × 90 ms + 800 ms 等）直接调用同一个函数，不要用常数凑。
  - 静态检查和运行时用同一口径：校验器认定「必定触发」的 id 都要有一条「perfect 跑完后进 `beatsFired`」的测试；只在可选操作（按 Q）时触发的 id 不能列进 `requiredBeats`。perfect 会主动回头，测不出这类问题，要用不按键的 Driver。
  - 工作包不能把 lead 要求报 error 的规则自行降成 warning。豁免只认 DESIGN §10 里的书面批准（`WAIVERS[].approval` 逐字出现在 §10，有单元测试）。别的包的数据让自己变红时，用 `git show wp/WPx:path` 取对方最新数据复现，找出最小改法并验证余量（休息窗各放宽 0.3 s 仍有解），写进 contract-requests。
  - A-11（20 s 一个主异常）按 Sim 时间轴、连同静场一起数（`tests/unit/content/anomalyTimeline.ts`）；同一个异常的连续演出写成一个事件（组合 `doubleMod`）。每拉开一次 20 s 都要加长跑段，先算全章会不会超过 §4.6 的 +15%；为时间加长的段只能放边道的被动行，最后一个跑段不能比高潮段密（`chapters.test.ts`「§2.8 难度曲线」）。
  - R7 / R8：`KIT_SYMBOLS` 的轮换起点随种子变，「新种类首次出现这一行只有它」要写显式种类（`['cart', '.', 'cart']`）并用种子 1–20 检查；段首、检查点 1.6 s 内不能要求动作，前两行别放中道。
  - 静场 / 站立段等输入时时钟暂停；最后一句文字触发后要留出显示时间。`hush` 的拍数按触发时的步频换成秒，放在停拍里要多写约 2 拍；段末的 `slow` 要在段末之后才结束。
  - 墙上要在某一拍被看见的东西（门牌、涂鸦）至少放在玩家前方约 7 拍（追尾镜头在身后 2.35 m，竖屏 3.8 m）。
  - 静场反光面 / 黑板的 id 必须与 set 的 `surfaces()` 一致（`canteenGlass`、`labBoard`、`busWindow`/`window`、`bathMirror`/`mirror`、`water`）。validate 不查这些跨包 id，由 `tests/unit/core/integration.test.ts` 检查（静场 cue 的 surface、跑段 double 的 surface、camera 机位、crowd 组）。
  - 非暗色氛围没有粉笔描边：声控灯、关灯区间里的必需障碍会被 R4 判为不可读。§4 标「暗」的段要用暗色预设（5-2 用 `nightIndoor`）。
  - 原文核对：`src/levels/sourceQuotes.ts` 由 `tests/unit/content/tools/gen-source.mjs` 生成；`npm run validate` 把原文传给 `lintContent`，原文和 lint 都不能进产物（`isolation.test.ts`、`tools/leak-check.mjs`）。台词不带引号存，界面按样式加，显示前去掉原文自带的 ASCII 引号。
- **模拟与求解器**：
  - 输入在本 tick 推进之前处理，此刻的 `segBeat()` 对应 `t − TICK_DT`。检查点之后 Pace 只补放持续的段中换挡（cadence），不补放临时的减速 / 停拍。重来要恢复到检查点时的按章累计状态（如回头收益）。
  - 求解器去重键只编码会影响未来的状态，里程按 0.2 m 分桶；节点复制用手写 `copyFrom()`（配一条测试核对字段齐全）；热循环里不要建闭包（tsx 的 keepNames 会给每个闭包调 `__name`）。`hash()` 用反射递归（`sim/stateHash.ts`），不要手写字段清单。
  - 站立段的按步事件（`atStep`）不进 `CompiledSegment.events`，Sim 直接读 `def.events`；跳过静场时要补发还没到的按步事件。画面按帧查询的 `Plan.actionAt(s)` 按区间回答。
  - vitest 只按文件并行：重的扫描按章拆成多个测试文件；测试里用 `sim.isEnded`，不要每 tick 扫全部事件。`__game.events()` 跨章不清空，e2e 判断「本章结束」只认最后一次 `chapter:start` 之后、`data.id` 是本章的 `chapter:end`，并带自检（同一章跑两遍结果相同）。
- **渲染（three r186）**：
  - §5.1 色板是画面上看到的颜色，不是反照率：Lambert 对半球光、平行光都除以 π，`NeutralToneMapping` 的 toe 让暗色又暗又饱和（裤子 #2A3A52 会变成 #04213D）。顶点色写入前按氛围反推（`render/wallTone.ts` 的 `propAlbedo` / `kitPropTone`、`kits/outside/lib/tone.ts`；只能写十六进制的人物——主角、NPC——用 `propHex`），先在 Node 里用「Lambert ÷ π + Neutral + sRGB」小模拟器对色，再上浏览器。Neutral 有解析逆。
  - `renderer.info.memory.geometries` 在几何体第一次被画时才加一：读章后要预热（`View.warmUp`），判断泄漏要同一章跑两遍比第二遍。灯光数量变化会让所有材质重编译：没有平行光的预设也保留那盏 `DirectionalLight`，强度设 0。
  - 负行列式（镜像）矩阵会翻转三角形绕向，被背面剔除；累积器要自动翻转绕向，烘焙光照时法线也要取反。单面光带按法线定绕序。
  - 地面层先画、不写深度：地面以下的东西放进 floor 几何体，绘制顺序就是覆盖顺序。低画质下墙根接缝会漏背景色，贴地的墙往地下多伸 6 cm、相邻面多搭 5 cm。跨 chunk 的长物件按 chunk 裁剪。
  - 实例化贴花按「格子号」取图集时，在顶点着色器里 `floor(x + 0.5)` 取整后再传偏移，不要在片元里对插值过的 varying 做 `mod`/`floor`；互不相干的形状拼成的图集不生成 mip。一次 draw call 里同时加亮和压暗用预乘 alpha（`ONE` / `ONE_MINUS_SRC_ALPHA`）。
  - 在别人的 `onBeforeCompile` 补丁（LampField）上叠补丁：先调原来的，再改自己的片段，`customProgramCacheKey` 串接。`Material.clone()` 不复制 `onBeforeCompile`。`MaterialsAPI.lambert()/basic()` 每次返回新实例，可以直接改。
  - 自定义 `ShaderMaterial` 要在片元末尾 `#include <colorspace_fragment>`。天穹：`fog: false`、`toneMapped: false`，颜色 = 雾色 × 灰度纹理（纹理里写线性乘数的 sRGB 编码）。跟着镜头走的东西在 `onBeforeRender` 里摆（ViewSystem 的 order 早于镜头）。
  - ClampToEdge 的贴图 UV 不要超出 [0, 1]；图案只占中间时在生成器里缩到画布中间，四周留空。
  - 暗场景的 set 把光源烘进顶点色（LampField 只覆盖跑道附近，到不了 `STILL_ORIGIN`）。发光体带 `aSteady` 顶点属性：1 = 不跟灯明灭（窗、镜中的雾），缺省跟灯走。
  - `q.slerpQuaternions(qa, qb, t)` 在 `this === qb` 时结果永远是 qa；原地混合先进临时四元数。姿势高度要移动根（骨盆），单元测试按蒙皮后的网格量最高 / 最低点。改父骨骼后做两骨 IK 之前先 `fk()`。
  - 一个原型一个 `InstancedMesh` 画多种变体（顶点属性标变体，着色器把别的变体收成一点）时，每个实例都要处理全部顶点，三角形也按全量计：低画质用单独的小几何体。`color_vertex` 的补丁要有单元测试断言那一行还在。
  - NPC、替身、过渡一律是模拟时间的纯函数（test 模式下 `step` 不渲染，截图只画最后一帧）：段内时间按每段在模拟时钟上的开始时刻算，已经过去的段照常计时，失败后冻结；弹簧类在间隔 > 0.25 s 时直接吸附。
  - 镜头在主角眼睛里的静场（`palmEye`、`waterDown`）不画主角身体，否则身体挡满整个画面；静场替身的位置可以由 set 的 `surfaces()[i].at` 指定。用 `__game.goto(seg, beat)` 截图时，beat 之前的 cue（替身出现等）不会重放，要从段首跑过去再截。
  - 调试用的东西（画廊、调试反光面、调试 ViewSystem）只在 `urlParams().debugEnabled` 时注册，不进活动候选列表，不往真实总线发伪造的 cue。
- **声音（WebAudio）**：
  - Chromium 的 `DynamicsCompressor` 每级 6 ms 前瞻（两级 12 ms 固定延迟），补偿增益要约 0.3 s 才到稳态：校准渲染至少 0.6 s。峰值上限靠限幅器后面的 `WaveShaperNode` 软削波保证。`ConvolverNode.buffer` 赋值在主线程做 FFT（3 s 混响约 14 ms）：读章时在空闲任务里预装。
  - 同一个一次性声音从两条路径各排一次、相隔 1 tick（8.33 ms）会让 60 Hz 主体相互抵消：按 §8.7 的唯一处理者表对照，并加 0.1 s 去重。依赖另一个 cue 先到的状态一律锁存（同一 tick 里 cue 的先后由关卡数据决定）。`cancelScheduledValues(now)` 连恰好在 now 的事件也取消。门掉一条总线时连它的混响发送一起门。
  - Game 只把 `screen` 发到 EventBus，不经过 `AudioAPI.onEvent`；按屏幕做事要 `bus.on('screen')`。`requestIdleCallback` 的 timeout 每次重新请求都从头算，要自己记入队时间。
  - Node 里测 WebAudio 用 `tests/unit/audio/offline/mini.ts`（`BufferSource.start` 的 offset 取整到样本；方波等用带限波表）。
- **界面与输入**：
  - 界面切换时丢掉上一个界面里按下、还没被 Game 取走的键（`Input.dropPending()`），否则选章的回车会跳过开场卡。最后一次输入的设备要在 window 捕获阶段的 `pointerdown` 里记（按钮带 `data-ui-control`，不发动作），初始值按 `(pointer: coarse)` 猜。
  - 「每帧 DOM 写入最多一次」要连 Input 一起算：情境按钮的显隐经 `UI.frame()` 的 DomBatch 写。e2e 读 DOM 或 `__game.ext.ui()` 之前先 `__game.render()`；章节、设置、纸条界面只由 UI 切换，读 `__game.ext.ui().screen`。
  - 窄屏字幕用 `text-wrap: balance`，≤ 520 px 缩字号让 24 字一行。附录 B.2 / B.4 的文字逐字照抄，`tests/unit/ui/strings.test.ts` 直接解析 DESIGN 的 B.2 表格，改文字先改设计文档。
- **工具与测试**：
  - `.mjs` 脚本用 `tsx` 跑时可以直接 import 带扩展名的 `.ts`；scratchpad 里带顶层 await 的 tsx 脚本要用 `.mts`。`import.meta.glob` 在 tsx 里不存在（各包 `index.ts` 用它），Node 探针直接 import 具体模块，或写成临时 vitest 文件。vitest 5 对通过的用例不打印 `console.log`。
  - 先在 Node 里把能算的都算完（kit 逐变体 build、姿势用软件光栅器、人群路径间距、声音离线渲染），浏览器只用来确认「看上去对」。截图清单里的数值验收要在同一页里自带断言（条件不满足就 `throw`）。
  - 等重命令（verify、e2e、截图）：经 heavy-gate 用 `run_in_background` 启动、把输出写进日志并在末尾追加 `EXIT $?`，再用 Monitor 的 `until grep -q '^EXIT' log; do sleep 3; done` 等（前台长 sleep 会被拦截）。截图一律写成 `shot.mjs --plan` 清单，一个浏览器拍完一批，再用 PIL 拼成网格图一次查看。
  - 量「修复前」的数字不必切分支：`git archive HEAD src tests tsconfig.json package.json | tar -x -C <scratch>/old`，再软链 `node_modules`。
