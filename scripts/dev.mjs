// Development runner: Vite dev server (renderer) + esbuild (main/preload) + Electron.
// The Vite port is chosen dynamically (port 0 → OS-assigned free port).
import { createServer } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/`;
console.log(`[dev] renderer on ${url}`);

const b = spawnSync(process.execPath, [path.join(root, 'scripts/build-electron.mjs')], {
  stdio: 'inherit',
  cwd: root,
});
if (b.status !== 0) process.exit(1);

const electronBin = (await import('electron')).default;
const child = spawn(electronBin, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, VITE_DEV_SERVER_URL: url, ISOLINE_DEV: '1' },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
