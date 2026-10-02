// Verifies the packaged deliverables in dist/: existence, sizes, macOS bundle
// structure (Info.plist, universal binary, ad-hoc signature, asar, maps), Windows
// PE resources (icon, version info), NSIS installers, then launches the macOS app
// in --smoke-test mode (must open the title screen and exit with code 0).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const v = pkg.version;
const dist = path.join(root, 'dist');
const MB = 1024 * 1024;
let failures = 0;
const report = [];

function check(ok, label, detail = '') {
  report.push(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function size(p) {
  return fs.existsSync(p) ? fs.statSync(p).size : 0;
}

function dirSize(p) {
  if (!fs.existsSync(p)) return 0;
  let total = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(p);
  return total;
}

const only = process.argv.slice(2);
const doMac = only.length === 0 || only.includes('mac');
const doWin = only.length === 0 || only.includes('win');

// ------------------------------------------------------------------ macOS
if (doMac) {
  const dmg = path.join(dist, `Isoline-${v}-mac-universal.dmg`);
  const zip = path.join(dist, `Isoline-${v}-mac-universal.zip`);
  check(
    size(dmg) > 50 * MB && size(dmg) < 300 * MB,
    'macOS DMG present, 50–300 MB',
    `${(size(dmg) / MB).toFixed(1)} MB`,
  );
  check(
    size(zip) > 50 * MB && size(zip) < 300 * MB,
    'macOS ZIP present, 50–300 MB',
    `${(size(zip) / MB).toFixed(1)} MB`,
  );
  const app = path.join(dist, 'mac-universal', 'Isoline.app');
  const exe = path.join(app, 'Contents', 'MacOS', 'Isoline');
  check(fs.existsSync(exe), 'Contents/MacOS/Isoline exists');
  check(
    fs.existsSync(path.join(app, 'Contents', 'Resources', 'app.asar')),
    'Contents/Resources/app.asar exists',
  );
  check(
    fs.existsSync(path.join(app, 'Contents', 'Resources', 'maps', 'world.png')),
    'Contents/Resources/maps/world.png (extraResources)',
  );
  check(fs.existsSync(path.join(app, 'Contents', 'Resources', 'icon.icns')), 'Contents/Resources/icon.icns');
  check(
    dirSize(app) > 0,
    'App bundle size',
    `${(dirSize(app) / MB).toFixed(0)} MB on disk (universal: x64 + arm64)`,
  );
  try {
    const plist = (k) =>
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, path.join(app, 'Contents', 'Info.plist')])
        .toString()
        .trim();
    check(
      plist('CFBundleIdentifier') === 'io.isoline.game',
      'Info.plist CFBundleIdentifier',
      plist('CFBundleIdentifier'),
    );
    check(
      plist('LSApplicationCategoryType') === 'public.app-category.strategy-games',
      'Info.plist category',
      plist('LSApplicationCategoryType'),
    );
    check(
      plist('CFBundleShortVersionString') === v,
      'Info.plist version',
      plist('CFBundleShortVersionString'),
    );
    check(
      plist('NSHumanReadableCopyright').includes('Isoline'),
      'Info.plist copyright',
      plist('NSHumanReadableCopyright'),
    );
    check(
      plist('LSMinimumSystemVersion').startsWith('12'),
      'Info.plist minimum macOS 12',
      plist('LSMinimumSystemVersion'),
    );
  } catch (e) {
    check(false, 'Info.plist readable', String(e));
  }
  try {
    const archs = execFileSync('lipo', ['-archs', exe]).toString().trim();
    check(archs.includes('x86_64') && archs.includes('arm64'), 'Universal binary (lipo)', archs);
  } catch (e) {
    check(false, 'lipo', String(e));
  }
  // (-dvv: the signing authorities are only printed from the second verbosity level.)
  const cs = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' });
  const team = /TeamIdentifier=(\S+)/.exec(cs.stderr)?.[1] ?? '';
  check(
    /Signature=adhoc|Authority=Developer ID Application/.test(cs.stderr),
    'Code signature (ad hoc or Developer ID)',
    (
      cs.stderr.match(/Authority=Developer ID Application[^\n]*|Signature=\w+|TeamIdentifier=\S+/g) ?? []
    ).join(' · '),
  );
  if (team && team !== 'not set') {
    // Developer ID builds are notarised: the ticket is stapled to the app.
    const st = spawnSync('xcrun', ['stapler', 'validate', app], { encoding: 'utf8' });
    check(st.status === 0, 'Notarisation ticket stapled', (st.stdout || st.stderr).trim().split('\n').pop());
  }
  const vr = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
  check(vr.status === 0, 'codesign --verify --deep --strict', vr.stderr.trim());
  // Smoke test: open the title screen then quit with code 0.
  const userData = path.join(root, '.cache', 'smoke-userdata');
  const smoke = spawnSync(exe, ['--smoke-test'], {
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, ISOLINE_USER_DATA: userData },
  });
  check(
    smoke.status === 0 && smoke.stdout.includes('ISOLINE_SMOKE_OK'),
    'macOS app --smoke-test exits 0 after the title screen',
    `status ${smoke.status}`,
  );
}

// ---------------------------------------------------------------- Windows
if (doWin) {
  const setup = path.join(dist, `Isoline-${v}-win-x64-setup.exe`);
  const portable = path.join(dist, `Isoline-${v}-win-x64-portable.exe`);
  for (const [label, f] of [
    ['NSIS installer', setup],
    ['Portable exe', portable],
  ]) {
    const s = size(f);
    check(s > 50 * MB && s < 300 * MB, `${label} present, 50–300 MB`, `${(s / MB).toFixed(1)} MB`);
    if (s) {
      const head = Buffer.alloc(2);
      const fd = fs.openSync(f, 'r');
      fs.readSync(fd, head, 0, 2, 0);
      fs.closeSync(fd);
      check(head.toString('latin1') === 'MZ', `${label} is a PE executable (MZ)`);
      const desc = execFileSync('file', [f]).toString();
      check(/Nullsoft/.test(desc), `${label} is a Nullsoft (NSIS) package`, desc.split(':')[1]?.trim());
    }
  }
  const unpacked = path.join(dist, 'win-unpacked');
  const exe = path.join(unpacked, 'Isoline.exe');
  check(fs.existsSync(path.join(unpacked, 'resources', 'app.asar')), 'win-unpacked/resources/app.asar');
  check(
    fs.existsSync(path.join(unpacked, 'resources', 'maps', 'world.png')),
    'win-unpacked/resources/maps/world.png',
  );
  if (fs.existsSync(exe)) {
    const desc = execFileSync('file', [exe]).toString();
    check(/PE32\+ executable.*x86-64/.test(desc), 'Isoline.exe is PE32+ x86-64', desc.split(':')[1]?.trim());
    const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(pe);
    const icons = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const sizes = icons.flatMap((g) => g.icons.map((i) => i.width || 256));
    check(
      sizes.includes(16) && sizes.includes(256),
      'Isoline.exe embeds the Isoline icon (16 → 256)',
      sizes.join(','),
    );
    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
    const strings = vi ? vi.getStringValues(vi.getAllLanguagesForStringValues()[0]) : {};
    check(
      strings.ProductName === 'Isoline' && String(strings.FileVersion).startsWith(v),
      'Isoline.exe version resource',
      `${strings.ProductName} ${strings.FileVersion}`,
    );
  } else check(false, 'win-unpacked/Isoline.exe exists');
}

console.log(report.join('\n'));
console.log(failures ? `\n${failures} check(s) failed` : '\nAll package checks passed');
process.exit(failures ? 1 : 0);
