// vitest.config.ts —— CORE 冻结（§8.1、§8.9-1）。单元测试默认跑在 Node；需要 DOM 的测试文件首行写
// `// @vitest-environment happy-dom`。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // lead：多个 agent 并行跑测试时，默认每核一个 worker 会把内存吃满（曾导致 OOM 整体被杀）。限制为 2。
    maxWorkers: 2,
  },
});
