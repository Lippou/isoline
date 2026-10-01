// Scripted play session for visual QA: spawn, expand, radial menu, build, panels.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache/shots/qa');
fs.mkdirSync(out, { recursive: true });
const userData = path.join(root, '.cache/e2e-userdata', `qa-${Date.now()}`);
const query = process.argv[2] ?? 'autostart=black-sea&nations=8&tribes=12&spawn=8&speed=2';
const app = await electron.launch({
  executablePath: (await import('electron')).default,
  args: [root],
  cwd: root,
  env: { ...process.env, ISOLINE_QUERY: query, ISOLINE_USER_DATA: userData },
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 400));
});
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(1920, 1080);
  w.show();
});
const shot = async (n) => {
  await page.screenshot({ path: path.join(out, `${n}.png`) });
  console.log('shot', n);
};
await page.waitForSelector('[data-testid=spawn-countdown]', { timeout: 30000 });
const box = await page.locator('canvas').first().boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
// Spawn on the southern shore (Anatolia).
let [x, y] = at(0.5, 0.8);
await page.mouse.click(x, y);
await page.waitForTimeout(800);
await shot('01-spawn');
await page.waitForSelector('[data-testid=clock]', { timeout: 30000 });
// Zoom in around the spawn.
for (let k = 0; k < 4; k++) {
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(800);
// Expand: click free land near spawn in 4 directions.
for (const [dx, dy] of [
  [60, 0],
  [-60, 0],
  [0, -60],
  [0, 40],
]) {
  await page.mouse.click(x + dx, y + dy);
  await page.waitForTimeout(300);
}
await page.waitForTimeout(6000);
await shot('02-expanded');
// Radial menu on own territory.
await page.mouse.click(x, y, { button: 'right' });
await page.waitForTimeout(500);
await shot('03-radial');
await page.locator('[data-testid=radial-build]').click();
await page.waitForTimeout(300);
await shot('04-radial-build');
await page.keyboard.press('Escape');
// Build a city with the hotkey.
await page.keyboard.press('Digit1');
await page.mouse.move(x + 5, y + 5);
await page.waitForTimeout(300);
await shot('05-ghost');
await page.mouse.click(x + 5, y + 5);
await page.waitForTimeout(3000);
// Panels.
await page.locator('[data-testid=panel-diplomacy]').click();
await page.waitForTimeout(500);
await shot('06-diplomacy');
await page.locator('[data-testid=panel-tech]').click();
await page.waitForTimeout(500);
await shot('07-tech');
await page.locator('[data-testid=panel-stats]').click();
await page.waitForTimeout(500);
await shot('08-stats');
await page.locator('[data-testid=panel-stats]').click();
await page.keyboard.press('Space');
await page.waitForTimeout(400);
await shot('09-terrain-view');
await page.keyboard.press('Space');
await page.waitForTimeout(20000);
await shot('10-later');
await app.close();
