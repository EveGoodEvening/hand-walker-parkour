// src/render/npc/defs.ts —— 收集 archetypes/*.ts（DESIGN.md §8.2 规则 4：包内新增原型用 import.meta.glob 自动注册，
// 不改任何共享索引）。本文件没有副作用，单元测试可以直接 import。
import type { ArchetypeDef } from './archetype';

const modules = import.meta.glob<{ default: ArchetypeDef }>('./archetypes/*.ts', { eager: true });

/** 18 个障碍原型的定义（按 id 排序）。 */
export const ARCHETYPE_DEFS: ArchetypeDef[] = Object.values(modules).map((m) => m.default).sort((a, b) => a.id.localeCompare(b.id));
