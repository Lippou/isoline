// Bundles the online server (server/online-main.ts) for the Binotech server, after the web
// build: it simulates that very build, named by its entry script (players must load it).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const html = readFileSync('dist-renderer/index.html', 'utf8');
const id = html.match(/assets\/(index-[\w-]+)\.js/)?.[1];
if (!id) throw new Error('dist-renderer/index.html: no entry script (run vite build first)');

await build({
  entryPoints: ['src/server/online-main.ts'],
  outfile: 'dist-online/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['bufferutil', 'utf-8-validate'],
  define: { __BUILD_ID__: JSON.stringify(id) },
  logLevel: 'info',
});
console.log(`online server for ${id}`);
