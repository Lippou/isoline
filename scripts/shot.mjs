// Launches the built app with Playwright (Electron), optionally with URL params,
// waits, then saves screenshots. Usage:
//   node scripts/shot.mjs <out.png> "<query>" <waitMs> [more waits/out pairs]
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out = '.cache/shots/shot.png', query = '', wait = '6000', ...rest] = process.argv.slice(2);
fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
const app = await electron.launch({
  executablePath: (await import('electron')).default,
  args: [root, `--isoline-query=${query}`],
  cwd: root,
  env: { ...process.env, ISOLINE_QUERY: query },
});
const page = await app.firstWindow();
page.on('console', (m) => {
  if (m.type() !== 'debug') console.log('[console]', m.type(), m.text().slice(0, 3000));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(1920, 1080);
  w.show();
});
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: path.resolve(root, out) });
console.log('saved', out);
for (let k = 0; k + 1 < rest.length; k += 2) {
  await page.waitForTimeout(Number(rest[k + 1]));
  await page.screenshot({ path: path.resolve(root, rest[k]) });
  console.log('saved', rest[k]);
}
await app.close();
