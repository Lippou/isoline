// Publishes the current version to the private GitHub repository, where the in-app
// updater (src/desktop/updater.ts) finds it:
//   1. builds and packages macOS (Developer ID signed, notarised through the keychain
//      profile "isoline-notary") and Windows, unless --skip-build;
//   2. checks the artefacts, tags v<version> and pushes the branch and the tag;
//   3. creates the GitHub release with the changelog section as notes.
// Usage: npm run release [-- --skip-build] [-- --draft]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

function sh(cmd, argv, opts = {}) {
  console.log(`$ ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
}
function out(cmd, argv) {
  return spawnSync(cmd, argv, { cwd: root, encoding: 'utf8' }).stdout.trim();
}

if (out('git', ['status', '--porcelain'])) {
  console.error('✗ Uncommitted changes: commit them before releasing.');
  process.exit(1);
}

if (!args.includes('--skip-build')) {
  sh('npm', ['run', 'package:all'], { env: { ...process.env, APPLE_KEYCHAIN_PROFILE: 'isoline-notary' } });
  sh('npm', ['run', 'verify:packages']);
}

const files = [
  `Isoline-${version}-mac-universal.zip`,
  `Isoline-${version}-mac-universal.dmg`,
  `Isoline-${version}-win-x64-setup.exe`,
  `Isoline-${version}-win-x64-portable.exe`,
].map((f) => path.join(root, 'dist', f));
for (const f of files)
  if (!fs.existsSync(f)) {
    console.error(`✗ Missing ${path.relative(root, f)}`);
    process.exit(1);
  }

// Release notes: this version's section of the changelog.
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const start = log.indexOf(`## [${version}]`);
const end = start >= 0 ? log.indexOf('\n## [', start + 1) : -1;
const notes = start >= 0 ? log.slice(start, end > 0 ? end : undefined).trim() : `Isoline ${version}`;
const notesFile = path.join(os.tmpdir(), `isoline-${version}-notes.md`);
fs.writeFileSync(notesFile, notes);

if (!out('git', ['tag', '--list', tag])) sh('git', ['tag', '-a', tag, '-m', `Isoline ${version}`]);
sh('git', ['push', 'origin', 'HEAD', '--follow-tags']);
sh('gh', [
  'release',
  'create',
  tag,
  ...files,
  '--title',
  `Isoline ${version}`,
  '--notes-file',
  notesFile,
  ...(args.includes('--draft') ? ['--draft'] : []),
]);
console.log(`✓ Released ${tag}`);
