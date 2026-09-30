# WP4 Lessons

只追加（OWNERS.json APPEND）。记录可复用的经验：库版本、踩过的坑、被纠正的做法。lead 集成时汇总到 AGENTS.md。


## 2026-09-30（WP4 户外、夜、梦与天气）

- **暗场景的 set 要「烘」光**：busNight / homeDark 的半球光只有 0.15–0.2，Lambert 顶点色几乎是一片黑；LampField 按 −z 采样，只覆盖玩家前后 128 m，STILL_ORIGIN（z ≈ 0）处的 set 拿不到灯光。做法：墙、地按 0.3–0.6 m 细分（`OGeo.cell`），把阅读灯、电视、窗帘缝、门缝这些光源按距离衰减 × 半 Lambert 烘进顶点色（`bakeLights`），再用顶点色 Basic 材质画。雾照常生效，不需要常驻 PointLight（§5 总则）。亮场景（梦、医务室）照常用 Lambert。
- **镜中房间用反射矩阵把房间再画一遍**：负行列式会让三角形反向被剔除，要交换 b、c；GeoBuilder 按交换后的顺序算法线，法线会指向背面，要再取反（`OGeo.tri` 已处理），否则烘焙光照全错。镜中房间的灯也要镜像过去单独烘（`mirrorLights`），不然真实房间会被镜子后面的灯照亮。
- **ViewSystem 的 order 50（weather）早于镜头（60）**：跟着镜头走的东西（雨的盒子、天穹）在 `frame()` 里读到的是上一帧的镜头。test 模式下 `step(600)` 之后只渲染一次，镜头可能跳了几十米，雨就整个不见了。放进 `object.onBeforeRender(renderer, scene, camera)`：它在 `modelViewMatrix` 计算之前调用，改完 `position` 再 `updateMatrixWorld()` 当帧生效；天的颜色也在这里从 `scene.fog` 取（此时氛围已经定好）。
- **天穹要和背景色无缝**：Basic 材质 `fog: false`、`toneMapped: false`（背景色不走色调映射），颜色 = 雾色 × 灰度纹理。TextureBank 统一设 `SRGBColorSpace`，采样时会解码成线性，所以灰度纹理里要写「线性乘数的 sRGB 编码」，地平线写 255 才是真正的 1。
- **自定义 ShaderMaterial 要自己做输出色彩空间**：片元末尾 `#include <colorspace_fragment>`，否则 sRGB 输出下颜色偏暗；雾在着色器里手算（`fog: false`），`toneMapped: false`。
- **按档位截断的线段要分层抽样**：雨一次分配 1200 条，换档只改 `drawRange`；每条线的随机数用黄金分割序列 `(i·0.618) mod 1`，任何前缀里「随机数 < 强度」的比例都 ≈ 强度，三个档位下同样强度看起来一样密。
- **chunk 里跨界的长物件按 chunk 裁剪**：World 在玩家越过 chunk 12 m 后才隐藏它，锚点在前一个 chunk、伸出去十几米的看台 / 远楼会在身边突然消失。用 `ChunkWork.spans()` 按周期区段裁剪，每个 chunk 只画自己那一截，真正的两端才画端面。
- **地面层不写深度**：chunk 的 floor 几何体最先画、不写深度，所以 static 里任何低于 y = 0 且在屏幕上与地面重叠的东西都会盖在地面上。户外的路面、水面比人行道低时也放在 floor 几何体里（同一个 draw call 里按顺序覆盖），不要放进 static。
- **第三到五章的数据在并行开发**：为了在 worktree 里自查，做了 `__game.ext.wp4` 画廊（在玩家旁边 400 m 按合成数据建 chunk / set，覆盖镜头与氛围），`'scene'` 命令先试真实章节、没实现时回落到画廊。清单 71 张图，SwiftShader 下 33 s 跑完（一次占锁）。
- **CORE 的 LampField 桩不发光**：夜街在桩下几乎全黑，只有灯头、窗和「路灯碎金」这些 emissive 看得见；正式的亮度要等 WP3 的 LampField（rainNight 增益 1.2、路灯色 #C8A15A）。画廊加了 `lit` 检查模式（半球光换成中性灰再放大），只用来看几何。
- **test 章只有 32 拍**：长时间的模拟（5 分钟内存检查）每 600 tick 调一次 `__game.goto('t-1', 0)`；`goto` 不重置模拟时间，`t` 会一直往前走。
- **Node 里测纹理**：CORE 的 `FlatTextureBank` 在没有 `document` 时返回 1×1 白纹理，不会调用生成器；把生成器写成纯函数（size, params → RGBA 数组），单元测试直接检查像素（暖色比例、眨眼帧、天空渐变）。
- **Material.copy / clone 不复制 onBeforeCompile**：克隆 WP3 打过 LampField 补丁的材质会丢掉补丁。WP4 假设 `MaterialsAPI.lambert()/basic()` 每次返回新实例（CORE 的 ChunkStreamer 也这样用：拿到地面材质后改 `depthWrite`），直接在返回的材质上改 `depthWrite`、模板、透明度，不克隆。
