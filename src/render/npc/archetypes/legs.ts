// archetypes/legs.ts —— 人腿 / 陈默（block，§2.5：竖直的高剪影；§5.7 腿的森林）。
// 契约 §8.4：「每个原型 1 个 InstancedMesh（legs 由 LegForest 负责）」——人腿障碍和路边的人是同一片森林，
// 共用 LegForest 的部件实例（低画质 3 次 draw call），这里只登记原型。
import { defineArchetype } from '../archetype';

export default defineArchetype({ id: 'legs', material: 'lambert', cap: 0, variants: [], delegate: 'forest' });
