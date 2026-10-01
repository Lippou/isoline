// In-app performance measurement (Electron + Playwright): startup time to the
// title screen, FPS with 100 nations at medium zoom, and memory of all processes.
// Writes docs/perf-app.json. Requires `npm run build` first.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = (await import('electron')).default;
const exe = process.argv[2]; // optional: packaged app executable

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

const out = { date: new Date().toISOString() };

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
fs.writeFileSync(path.join(root, 'docs/perf-app.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
