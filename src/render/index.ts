// src/render/index.ts —— 画面包入口（DESIGN.md §8.2）。CORE 写初版，之后归 WP3。
// 注册 View 汇总器、世界系统（chunk / set / 氛围 / 灯光），以及 WP3 负责的 cue：atmosphere、fog、lights、board。
// 材质、LampField、纹理库此时未注册 → View 回落到 core/fallbacks.ts 的桩；WP3 用 registerMaterials() 换成正式实现。
import { registerCueHandler, registerView, registerViewSystem } from '../core/registry';
import { View } from './View';
import { world } from './ChunkStreamer';

registerView(() => new View());
registerViewSystem(world);

registerCueHandler('atmosphere', 'WP3', (b) => world.transitionTo(b.id, b.seconds));
registerCueHandler('fog', 'WP3', (b) => world.fogOverride(b.near, b.far, b.seconds));
registerCueHandler('lights', 'WP3', (b, c) => world.lightsOp(b.op, c.segment, b.from, b.to, b.every, c.snap.t));
registerCueHandler('board', 'WP3', () => { /* 黑板字：WP3 实现（textures/school.ts chalkboard） */ });
