// Bundles the Electron main + preload processes (and the embedded LAN server)
// into self-contained CommonJS files so the packaged app needs no node_modules.
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
  define: { 'process.env.ISOLINE_DEV': watch ? '"1"' : '""' },
};

await build({ ...common, entryPoints: ['src/desktop/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['src/desktop/preload.ts'], outfile: 'dist-electron/preload.cjs' });
