// src/levels/chapters/ch4.ts —— 第4章数据（DESIGN.md §4）。归 WP2。
// CORE 只放一个空桩：导出 null 表示「本章尚未实现」，chapters/index.ts 会把它当作不可玩。
// WP2 用 `export default { ... } satisfies ChapterDef;` 替换本文件即可，不需要改 index.ts。
import type { ChapterDef } from '../schema';

const chapter: ChapterDef | null = null;
export default chapter;
