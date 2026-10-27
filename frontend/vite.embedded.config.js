import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * 内嵌构建：产出单一 ESM 模块 runtime/embedded/rvguarder-embedded.mjs，
 * 导出 mountEmbedded/dispose；Preact 与样式全部打入，不依赖外部资源。
 */
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../runtime/embedded',
    emptyOutDir: true,
    minify: true,
    target: 'es2022',
    lib: {
      entry: 'src/embedded.jsx',
      formats: ['es'],
      fileName: () => 'rvguarder-embedded.mjs',
    },
    rollupOptions: {
      output: {
        // 单文件产物：内联一切动态导入，避免宿主内的资源定位问题。
        inlineDynamicImports: true,
      },
    },
  },
});
