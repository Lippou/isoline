// Runs electron-builder for the requested platforms with every cache kept
// inside the project folder (no writes to global caches).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
const env = {
  ...process.env,
  ELECTRON_CACHE: path.join(root, '.cache/electron'),
  electron_config_cache: path.join(root, '.cache/electron'),
  ELECTRON_BUILDER_CACHE: path.join(root, '.cache/electron-builder'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  UV_THREADPOOL_SIZE: '4',
};
fs.mkdirSync(env.ELECTRON_CACHE, { recursive: true });
fs.mkdirSync(env.ELECTRON_BUILDER_CACHE, { recursive: true });

const bin = path.join(root, 'node_modules/.bin/electron-builder');
for (const t of targets) {
  const args = t === 'mac' ? ['--mac', '--universal'] : ['--win', '--x64'];
  console.log(`\n== electron-builder ${args.join(' ')}`);
  const res = spawnSync(bin, [...args, '--publish', 'never'], { stdio: 'inherit', env, cwd: root });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
