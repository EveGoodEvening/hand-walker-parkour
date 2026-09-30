# WP6 Lessons

只追加（OWNERS.json APPEND）。记录可复用的经验：库版本、踩过的坑、被纠正的做法。lead 集成时汇总到 AGENTS.md。


- 「每个原型只有一个 InstancedMesh」但一个原型要画好几种障碍：几何体里并排放每种障碍的变体，顶点属性 `aHw.x` = 变体号（−1 = 共用），实例属性 `iHw.x` = 要显示的变体，顶点着色器把不属于本实例变体的顶点收拢到一点（`transformed = vec3(0.)`，三角形退化不光栅化）。代价：每个实例都要处理全部变体的顶点，`renderer.info.render.triangles` 也按全量计数——变体要做得省（人物部件尽量一个盒子），重的特殊变体会让每个实例都背上。
- 同一套补丁顺便做了「着色遮罩」和逐顶点自发光：r186 的 `color_vertex` 里是 `vColor.rgb *= instanceColor.rgb;`，把这一行换成 `mix(vec3(1.0), instanceColor.rgb, aHw.z)`，鞋底、手、粉笔白线就不会被衣服颜色染色；自发光（周主任的烟头、电子栏杆红灯）在 `emissivemap_fragment` 之后加进 `totalEmissiveRadiance`。单元测试断言这一行还在，three 升级改了它会立刻报错。
- 在 WP3 的 LampField 补丁上叠自己的补丁：保存原来的 `onBeforeCompile` 并先调用它，再改自己的片段；`customProgramCacheKey` 也要串接（原型方法默认返回 `onBeforeCompile.toString()`）。只改 LampField 不碰的片段（color_pars_vertex / color_vertex / begin_vertex / color_pars_fragment / emissivemap_fragment）。
- 贴花要逐顶点透明度：把 `color` 属性做成 itemSize 4，three 会定义 `USE_COLOR_ALPHA`，Basic 材质开 `vertexColors` + `transparent` 即可让边缘淡出。
- test 模式下 `shot.mjs` 只在最后渲染一帧（中间的 `step` 不渲染），所以 NPC 的一切画面状态都必须是时间的纯函数：伸脚按段内时间；「玩家进入 3 m」的凝视按当前距离 ÷ 速度倒推触发时刻；受击、让一下、crowd cue 按事件时刻（事件每 tick 都会分发给 View）。不要靠「第一次看到的那一帧」。
- 画面的 tSeg 要和 Sim 碰撞用的 pace.tSeg 一致：段首是 `segment` 事件那一 tick 的 `snap.t`；读章 / 跳转 / 重来后 `onReset` 里用 `snap.t − seg.timeAt(snap.segBeat)`（Sim 跳转时把 tSeg 设成 timeAt(beat)）。onReset 在事件分发之后调用，会覆盖 segment 事件里设的值。
- 单元测试里比较两次运行的逐 tick 序列时，不要用 CORE Driver 的 `tap()`：它内部多走一个 tick，两次运行的时钟就错开了；用 `press()` + `release()` 只排队输入。
- `easeInOutSine(0)` 返回 −0，`expect(x).toBe(0)` 会失败（Object.is）；返回值加 `+ 0` 归一。
- 「安静的一秒」的动画时钟：几次静止窗口重叠时要先合并，否则扣掉的时间会重复累计，时钟倒着走。
- 「模型边缘与碰撞盒偏差 ≤ 5 cm」的单元测试：整宽的盒子顶点都在两端，按顶点找「车道中线上方最低的面」会漏掉；要按三角形的 x 跨度判断（跨过 x = 0 的三角形里取最低）。地面暗带（y ≤ 0.005 的深缝影子）要排除。
- 碰撞盒是 85% 规则的外层盒；视觉 ≈ 碰撞 ÷ 0.85，但大障碍（整宽横档 1.65 m）按比例会外扩 29 cm，和「偏差 ≤ 5 cm」冲突。WP6 的做法：每面外扩 min(按比例, 5 cm)；横档下沿再往下 2 cm（看起来更低，只会让人更早伏低）。
- 人腿障碍的碰撞盒高 1.70 m，但 NPC 只建到腰带（§5.7）：线框顶面会比模型高 0.65 m。玩家盒最高 0.85 m，这部分不影响任何判定，是有意的差异。
- 占位主角正好挡住中道；截图画廊把障碍放在左右两道，并用 `npcStage(name, { ahead })` 把后面几排拉近。
- `renderer.info.memory.geometries` 在第一次跑某一章时会逐步增长（预建的 chunk 第一次被渲染才上传 GPU），跑完第一遍之后就平了（第一章 5 分钟：60 → 151 后不变）。WP6 自己的几何体（18 个原型池 + 8 个人物部件 + 2 个爬行者部件）都在 init 时一次建好。
- 热路径不要 `createRng()`（每次都 new 一个对象）：按 id 取固定随机数用 `sin` 散列，或读章时预先算好。
- 第二到五章的数据由 WP2 并行编写，WP6 截图时没有这些段落：`__game.ext.npcStage(name, { ahead, follow })`（只在 ?test=1 / ?debug= 下可用）用合成的障碍和人群在玩家前方搭场景，走和正式数据完全相同的放置代码；`npcCrowd(group, op)`、`npcAsk('part'|'ignore')`、`npcHit()` 模拟 crowd cue、「让一下」和人群段绊倒；`npcStats()` 返回人数、各类可见 InstancedMesh 数和本帧耗时。tests/visual/WP6.json 全部基于这些扩展。
- 实测（无头 Chrome，本机）：森林舞台高画质 64 人，ObstacleView 每帧 0.22 ms；梦里高画质 64 人 + 爬行者：人 6 个 InstancedMesh、爬行者 2 个。第一章低画质 e2e:perf 峰值 25 次 draw call、24.5k 三角形。
