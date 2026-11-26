import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
