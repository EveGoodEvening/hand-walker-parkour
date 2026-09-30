// vitest.config.ts —— CORE 冻结（§8.1、§8.9-1）。单元测试默认跑在 Node；需要 DOM 的测试文件首行写
// `// @vitest-environment happy-dom`。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
