import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Renderer build. The Electron main process serves `dist-renderer/` through the
// custom `isoline://` protocol; in dev it loads the Vite dev server instead.
export default defineConfig({
  root: '.',
  base: './',
  plugins: [svelte()],
  publicDir: false,
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  server: { strictPort: false, host: '127.0.0.1' },
});
