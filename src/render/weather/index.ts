// src/render/weather/index.ts —— 天气（雨）入口（DESIGN.md §5.9）。CORE 建的桩，之后归 WP4。
// WP4 在这里注册雨的 ViewSystem（order 50）与 `rain` cue 处理器；桩阶段 `rain` cue 由 core/cues.ts 的默认处理器记录。
import.meta.glob(['./*.ts', '!./index.ts'], { eager: true });
