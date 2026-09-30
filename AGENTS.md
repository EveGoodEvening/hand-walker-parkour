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
