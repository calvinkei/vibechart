import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  root: command === 'serve' ? 'demo' : '.',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5180, open: false },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'OpenChart',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'openchart.js' : 'openchart.umd.js'),
    },
    sourcemap: true,
    minify: 'esbuild',
    cssCodeSplit: false,
    rollupOptions: { output: { assetFileNames: 'openchart.[ext]' } },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
}));
