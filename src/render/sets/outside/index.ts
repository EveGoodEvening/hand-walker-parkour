// src/render/sets/outside/index.ts —— WP4 的 set 注册入口（DESIGN.md §8.2 规则 4、§5.9）。CORE 建的桩，之后归 WP4。
// 本目录下的每个模块自己调用 registerSet()；这里用 import.meta.glob 自动加载，新增文件不需要改任何索引。
// 目录为空时注册表回落到 CORE 的占位实现（render/sets/placeholder.ts）。
import.meta.glob(['./*.ts', '!./index.ts'], { eager: true });
