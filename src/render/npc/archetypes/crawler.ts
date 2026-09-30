// archetypes/crawler.ts —— 梦里同向爬行的人（block 的例外，0.55 m；§2.5「剪影靠动作识别」、§5.7 梦中的爬行者）。
// 与 4-3 超过你的人、crawlerStream 组是同一种人，共用 Crawlers 的实例（身体 + 手臂，2 次 draw call），这里只登记原型。
import { defineArchetype } from '../archetype';

export default defineArchetype({ id: 'crawler', material: 'lambert', cap: 0, variants: [], delegate: 'crawlers' });
