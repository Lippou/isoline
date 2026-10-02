// In-app performance measurement (Electron + Playwright): startup time to the
// title screen, FPS with 100 nations at medium zoom, and memory of all processes.
// Writes docs/perf-app.json. Requires `npm run build` first.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = (await import('electron')).default;
const soak = process.argv.includes('soak');
const exe = process.argv.slice(2).find((a) => a !== 'soak'); // optional: packaged app executable

async function launch(query) {
  const userData = path.join(root, '.cache/e2e-userdata', `perf-${Date.now()}`);
  const t0 = Date.now();
  const app = await electron.launch({
    executablePath: exe ?? electronPath,
    args: exe ? [] : [root],
    cwd: root,
    env: { ...process.env, ISOLINE_QUERY: query, ISOLINE_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1920, 1080);
    w.show();
  });
  return { app, page, t0 };
}

const outFile = path.join(root, 'docs', soak ? 'soak.json' : 'perf-app.json');
const out = { date: new Date().toISOString() };

if (soak) {
  // Stability: 60 game minutes (×8) on the World map with 50 nations, memory sampled every 30 s.
  const { app, page } = await launch(
    'autostart=world&spectate&nations=50&tribes=60&spawn=1&speed=8&threshold=101&perf',
  );
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid=perf]', { timeout: 60000 });
  const samples = [];
  const t0 = Date.now();
  let ended = false;
  while (Date.now() - t0 < 40 * 60_000) {
    await page.waitForTimeout(30_000);
    const clock =
      (await page
        .getByTestId('clock')
        .textContent()
        .catch(() => '')) ?? '';
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => m.memory.workingSetSize));
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const perf =
      (await page
        .getByTestId('perf')
        .textContent()
        .catch(() => '')) ?? '';
    const s = {
      realS: Math.round((Date.now() - t0) / 1000),
      clock: clock.trim(),
      totalMB: Math.round(metrics.reduce((a, b) => a + b, 0) / 1024),
      rendererHeapMB: Math.round(heap / 1048576),
      fps: Number(perf.match(/FPS (\d+)/)?.[1] ?? 0),
    };
    samples.push(s);
    console.log(JSON.stringify(s));
    ended = await page
      .getByTestId('end-screen')
      .isVisible()
      .catch(() => false);
    const [m] = s.clock.split(':').map(Number);
    if (ended || m >= 60) break;
  }
  out.soak = { samples, ended, errors };
  await app.close();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  process.exit(0);
}

// 1. Startup to title screen.
{
  const { app, page, t0 } = await launch('');
  await page.waitForSelector('[data-testid=title-screen]', { timeout: 30000 });
  out.startupToTitleMs = Date.now() - t0;
  await app.close();
}

// 2. FPS + memory with 100 nations on the World map (medium zoom).
for (const [label, query] of [
  [
    'world100_mediumZoom',
    'autostart=world&spectate&nations=100&tribes=100&spawn=1&speed=2&perf&zoom=2.5&x=0.52&y=0.4',
  ],
  ['world100_fullMap', 'autostart=world&spectate&nations=100&tribes=100&spawn=1&speed=2&perf'],
]) {
  const { app, page } = await launch(query);
  const tLoad = Date.now();
  await page.waitForSelector('[data-testid=perf]', { timeout: 60000 });
  out[`${label}_mapReadyMs`] = Date.now() - tLoad;
  await page.waitForTimeout(25000);
  const samples = [];
  for (let k = 0; k < 10; k++) {
    const txt = await page.getByTestId('perf').textContent();
    const fps = Number(txt.match(/FPS (\d+)/)?.[1] ?? 0);
    const tick = Number(txt.match(/tick ([\d.]+) ms/)?.[1] ?? 0);
    samples.push({ fps, tick });
    await page.waitForTimeout(1000);
  }
  const metrics = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
  );
  const totalMB = Math.round(metrics.reduce((s, m) => s + m.kb, 0) / 1024);
  out[label] = {
    fpsMin: Math.min(...samples.map((s) => s.fps)),
    fpsAvg: Math.round(samples.reduce((s, x) => s + x.fps, 0) / samples.length),
    tickMsAvg: +(samples.reduce((s, x) => s + x.tick, 0) / samples.length).toFixed(2),
    memoryTotalMB: totalMB,
    processes: metrics.map((m) => `${m.type}:${Math.round(m.kb / 1024)}MB`).join(' '),
  };
  await page.screenshot({ path: path.join(root, `.cache/shots/perf-${label}.png`) });
  await app.close();
}

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
