import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Renderer build. The Electron main process serves `dist-renderer/` through the
// custom `isoline://` protocol; in dev it loads the Vite dev server instead.
export default defineConfig({
  root: '.',
  base: './',
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Static media (sound effects, music, narration) copied as-is into the build.
  publicDir: 'public',
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
