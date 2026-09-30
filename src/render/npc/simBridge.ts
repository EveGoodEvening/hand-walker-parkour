// src/render/npc/simBridge.ts —— WP6 唯一跨包引用模拟代码的地方（DESIGN.md §8.2 规则 2 的例外，见 docs/contract-requests/WP6.md）。
// 障碍的运行时状态（门荡开、腿伸出、陈默让开、人墙移动、行人偏移）必须和碰撞完全一致，所以画面直接复用
// sim/Track.ts 的纯函数 obstacleState / swingOpen（CORE 的占位实现也是这样做的）。它们不依赖 three，Node 可测。
// 已申请把这两个函数提升为契约；在那之前，WP1 若改了签名，只需改这一个文件。
export { obstacleState, swingOpen, type ObstacleState } from '../../sim/Track';
