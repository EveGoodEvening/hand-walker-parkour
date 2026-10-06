// vite.config.ts —— CORE 编写，之后归 WP1（§8.1）。单文件构建：产物只有 dist/index.html。
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [
    viteSingleFile(),
    {
      name: 'third-party-notices',
      transformIndexHtml() {
        // 非执行文本随 HTML 一起分发；压缩 JS 时不会丢失许可声明。
        return [{
          tag: 'script',
          attrs: { id: 'third-party-notices', type: 'text/plain' },
          children: '\n' + readFileSync(new URL('./THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8'),
          injectTo: 'head',
        }];
      },
    },
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
  },
});
