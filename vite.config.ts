import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  root: command === 'serve' && !process.env.VITEST ? 'demo' : '.',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5180, open: false },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VibeChart',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) =>
        format === 'es' ? 'vibechart.mjs' : format === 'cjs' ? 'vibechart.cjs' : 'vibechart.umd.js',
    },
    sourcemap: true,
    minify: 'esbuild',
    cssCodeSplit: false,
    rollupOptions: { output: { assetFileNames: 'vibechart.[ext]' } },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
}));
