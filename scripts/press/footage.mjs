// Trailer footage: real game shots filmed in the app (photo mode, no HUD), at 1920×1080.
// Each shot is a screencast of the running game (Chrome DevTools, JPEG frames with their
// timestamps), resampled to a constant 30 fps image sequence for the composition
// (scripts/press/trailer/). The camera is driven frame by frame (eased dollies), the game by
// the ?automation hook.
// Usage: npm run build && node scripts/press/footage.mjs [shot…]
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.cache/press/footage');
const only = process.argv.slice(2);
const want = (k) => only.length === 0 || only.includes(k);

async function launch(query, ready = '[data-testid=clock]') {
  const userData = path.join(root, '.cache/press/userdata', `${Date.now()}`);
  const app = await electron.launch({
    executablePath: (await import('electron')).default,
    args: [root],
    cwd: root,
    env: { ...process.env, ISOLINE_QUERY: `${query}&automation`, ISOLINE_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1920, 1080);
    w.show();
  });
  await page.waitForSelector(ready, { timeout: 90_000 });
  return { app, page };
}

const iso = (page, fn, ...args) => page.evaluate(([f, a]) => window.__iso[f](...a), [fn, args]);
const cmd = (page, c) => page.evaluate((c) => window.__iso.cmd(c), c);
const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Nothing over the map: the HUD is hidden (the photo mode would hide the front lines too).
 * `labels` false also hides the countries' names.
 */
async function cleanMode(page, { labels = true } = {}) {
  await page.addStyleTag({
    content: '.game > :not(.canvas-host) { display: none !important; } body { cursor: none !important; }',
  });
  await page.mouse.move(1919, 1079);
  if (!labels) await page.keyboard.press('F2');
  await wait(page, 400);
}

/**
 * Camera dolly: from (x, y, zoom) to (x, y, zoom) over `ms`, eased (smoothstep), zoom in
 * log space. Set every animation frame, so the game's own glide never fights it.
 */
async function dolly(page, from, to, ms) {
  await page.evaluate(
    ([a, b, ms]) => {
      const cam = window.__iso.camera;
      const t0 = performance.now();
      cancelAnimationFrame(window.__dollyRaf ?? 0);
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        const e = u * u * (3 - 2 * u);
        cam.glide = null;
        cam.follow = null;
        cam.anchor = null;
        cam.cx = a[0] + (b[0] - a[0]) * e;
        cam.cy = a[1] + (b[1] - a[1]) * e;
        cam.zoom = cam.targetZoom = Math.exp(Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * e);
        if (u < 1) window.__dollyRaf = requestAnimationFrame(step);
      };
      step();
    },
    [from, to, ms],
  );
}

/** Films `ms` of the page into out/<name>/ as a 30 fps JPEG sequence. */
async function record(page, name, ms, during) {
  const raw = path.join(out, `${name}-raw`);
  fs.rmSync(raw, { recursive: true, force: true });
  fs.mkdirSync(raw, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(raw, `${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, ts: f.metadata.timestamp });
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080 });
  const done = wait(page, ms);
  await during?.();
  await done;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  // Variable frame times → constant 30 fps (each frame held until the next one).
  const list = frames
    .map((f, k) => {
      const d = (frames[k + 1]?.ts ?? f.ts + 1 / 30) - f.ts;
      return `file '${f.file}'\nduration ${Math.max(0.001, d).toFixed(4)}`;
    })
    .join('\n');
  fs.writeFileSync(path.join(raw, 'list.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
  const dir = path.join(out, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(raw, 'list.txt'),
    '-vf',
    'fps=30',
    '-q:v',
    '2',
    path.join(dir, '%04d.jpg'),
  ]);
  fs.rmSync(raw, { recursive: true, force: true });
  const n = fs.readdirSync(dir).length;
  const fps = frames.length / (frames.at(-1).ts - frames[0].ts);
  console.log(`shot ${name}: ${n} frames (captured at ${fps.toFixed(0)} fps)`);
}

// ------------------------------------------------------------------ shots
/** The whole world filling up with countries (spectator, fast), the camera easing in. */
if (want('world')) {
  const { app, page } = await launch('autostart=world&nations=60&tribes=40&spawn=1&spectate&speed=4&seed=11');
  const st = await iso(page, 'state');
  const [W, H] = [st.width, st.height];
  const fit = 1920 / W;
  await wait(page, 40_000);
  await cleanMode(page);
  const a = [W * 0.5, H * 0.5, fit * 1.02];
  const b = [W * 0.54, H * 0.45, fit * 1.55];
  await dolly(page, a, a, 10);
  await wait(page, 600);
  await record(page, 'world', 9000, () => dolly(page, a, b, 9000));
  await app.close();
}

// ------------------------------------------------------------------ a played game
/** Our country, by name, in the automation state. */
const me = (st) => st.players.find((p) => p.name === 'Ilse');
const xy = (t, W) => [(t % W) + 0.5, Math.floor(t / W) + 0.5];

/** Spawns near the map fraction (fx, fy): the first free land tile on a widening spiral. */
async function spawnNear(page, fx, fy) {
  const { width: W, height: H } = await iso(page, 'state');
  for (let r = 0; r < 60; r += 2)
    for (let a = 0; a < 12; a++) {
      const x = Math.round(W * fx + Math.cos((a / 12) * Math.PI * 2) * r);
      const y = Math.round(H * fy + Math.sin((a / 12) * Math.PI * 2) * r);
      await cmd(page, { t: 'spawn', tile: y * W + x });
      await wait(page, 150);
      // A valid pick starts the game at once (we are the only human).
      const st = await iso(page, 'state');
      if (st.phase === 'playing') return me(st).capital >= 0 ? me(st).capital : y * W + x;
    }
  throw new Error('no spawn');
}

/** One push into free land or a neighbour, from a random spot of our land towards (dx, dy). */
async function push(page, W, dx, dy, ratio = 0.3) {
  const own = await iso(page, 'ownTiles', 3000);
  if (!own.length) return;
  const t = own[Math.floor(Math.random() * own.length)];
  await cmd(page, { t: 'attack', tile: t + dy * W + dx, ratio });
}

if (want('game')) {
  const { app, page } = await launch(
    'autostart=europe&nations=24&tribes=12&spawn=90&speed=1&difficulty=easy&startGold=60000000&seed=5&name=Ilse',
    '[data-testid=spawn-countdown]',
  );
  const { width: W } = await iso(page, 'state');
  // Western France, near the Atlantic: room to grow, and a coast for ports and fleets.
  const spawn = await spawnNear(page, 0.345, 0.65);
  const [sx, sy] = xy(spawn, W);
  console.log('spawned at', sx, sy);
  await cleanMode(page);

  // 1. Expansion: the first pushes into free land, close up.
  await iso(page, 'speed', 3);
  await wait(page, 2500);
  await dolly(page, [sx, sy, 17], [sx, sy, 17], 10);
  await wait(page, 300);
  await record(page, 'expand', 8000, async () => {
    void dolly(page, [sx, sy, 17], [sx + 3, sy - 1, 10], 8000);
    for (const [dx, dy] of [
      [24, 0],
      [0, -24],
      [-24, 0],
      [0, 24],
      [18, 18],
      [-18, -18],
      [24, -10],
      [10, 24],
    ]) {
      await push(page, W, dx, dy, 0.45);
      await wait(page, 900);
    }
  });

  // 2. Fast forward: a country, an economy (cities, factories → rail, ports), a fleet.
  await iso(page, 'speed', 4);
  for (let k = 0; k < 24; k++) {
    await push(page, W, [30, 0, -30, 0][k % 4], [0, 30, 0, -30][k % 4], 0.3);
    await wait(page, 1500);
  }
  const own = await iso(page, 'ownTiles', 6000);
  const pick = (n) => Array.from({ length: n }, (_, k) => own[Math.floor(((k + 0.5) / n) * own.length)]);
  for (const t of pick(7)) await cmd(page, { t: 'build', kind: 0, tile: t });
  for (const t of pick(5)) await cmd(page, { t: 'build', kind: 2, tile: t + 3 });
  for (const t of (await iso(page, 'coast', 400)).filter((_, k) => k % 120 === 0).slice(0, 3))
    await cmd(page, { t: 'build', kind: 1, tile: t });
  await wait(page, 25_000);
  const coast = await iso(page, 'coast', 400);
  for (let k = 0; k < 3; k++) await cmd(page, { t: 'warship', tile: coast[(k * 37) % coast.length] - 3 });
  await wait(page, 20_000);
  let st = await iso(page, 'state');
  const [lx, ly] = me(st).label;
  console.log('economy ready', me(st).tiles, 'tiles');

  // 3. The economy at work: trains on the rails, merchant ships, a slow pan.
  await iso(page, 'speed', 1);
  await dolly(page, [lx - 30, ly - 12, 8], [lx - 30, ly - 12, 8], 10);
  await wait(page, 400);
  await record(page, 'economy', 7000, () => dolly(page, [lx - 30, ly - 12, 8], [lx, ly + 6, 9.5], 7000));

  // 4. Front lines: a closed position round the capital, organised; an offensive line on the
  // strongest neighbour, its steel arrow drawn at its heart, then the assault launched.
  const cap = me(st).capital;
  const [cx, cy] = xy(cap, W);
  const ring = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    ring.push(Math.round(cx + Math.cos(a) * 11), Math.round(cy + Math.sin(a) * 9));
  }
  ring.push(ring[0], ring[1]);
  await cmd(page, { t: 'line', kind: 0, pts: ring, side: 1, ratio: 0.15 });
  await wait(page, 800);
  st = await iso(page, 'state');
  const ringLine = st.lines.find((l) => l.owner === me(st).id && l.kind === 0);
  if (ringLine) await cmd(page, { t: 'lineOrganize', id: ringLine.id });
  const d2 = (p) => (p.label[0] - lx) ** 2 + (p.label[1] - ly) ** 2;
  const foes = st.players.filter((p) => p.kind === 'nation' && p.tiles > 500).sort((a, b) => d2(a) - d2(b));
  let off = null;
  let foe = null;
  for (const f of foes.slice(0, 4)) {
    await cmd(page, { t: 'lineBorder', target: f.id, at: f.capital, ratio: 0.35 });
    await wait(page, 600);
    st = await iso(page, 'state');
    off = st.lines.find((l) => l.owner === me(st).id && l.kind === 1);
    if (off) {
      foe = f;
      break;
    }
  }
  console.log('ring', !!ringLine, 'offensive on', foe?.name);
  if (off && foe) {
    const [mx, my] = xy(off.mid, W);
    // Where the arrow will start: the line's grip, found on screen (the line's middle tile
    // is only a row-major median).
    await dolly(page, [mx, my, 4], [mx, my, 4], 10);
    await wait(page, 500);
    const grip = await page.evaluate((id) => {
      const iso = window.__iso;
      let [sx, sy, n] = [0, 0, 0];
      for (let y = 0; y < 1080; y += 6)
        for (let x = 0; x < 1920; x += 6)
          if (iso.lineGripAt(x, y) === id) {
            sx += x;
            sy += y;
            n++;
          }
      return n ? iso.camera.screenToWorld(sx / n, sy / n) : null;
    }, off.id);
    const [gx, gy] = grip ?? [mx, my];
    // The arrow: 50 tiles deep into their land, towards the heart of their territory.
    const [vx, vy] = [foe.label[0] - gx, foe.label[1] - gy];
    const vl = Math.hypot(vx, vy) || 1;
    const ax = Math.round(gx + (vx / vl) * 50);
    const ay = Math.round(gy + (vy / vl) * 50);
    console.log('grip', grip, 'aim', ax, ay);
    await cmd(page, { t: 'lineAim', id: off.id, aim: ay * W + ax });
    await iso(page, 'speed', 4);
    await wait(page, 9000); // the charge (30 s of game time)
    await iso(page, 'speed', 2);
    // Close on the ready arrow (framed low: it sits above the film's caption band), the
    // click at 3.2 s, then back out as the front moves.
    const c0 = [gx + (ax - gx) * 0.5, gy + (ay - gy) * 0.5 + 10, 12];
    const c1 = [gx + (ax - gx) * 0.9, gy + (ay - gy) * 0.9 + 14, 8.5];
    await dolly(page, c0, c0, 10);
    await wait(page, 400);
    await record(page, 'lines', 12_000, async () => {
      await wait(page, 3200);
      await cmd(page, { t: 'lineLaunch', id: off.id });
      void dolly(page, c0, c1, 8000);
    });
    // The ring, organised, its barbed wire out.
    await iso(page, 'speed', 1);
    await dolly(page, [cx - 4, cy, 22], [cx - 4, cy, 22], 10);
    await wait(page, 400);
    await record(page, 'ring', 6000, () => dolly(page, [cx - 4, cy, 22], [cx + 2, cy - 1, 17], 6000));

    // 5. The bomb: an H-bomb from our capital to a distant capital (render only), then the blast.
    const far = foes.find((f) => Math.sqrt(d2(f)) > 170 && Math.sqrt(d2(f)) < 330) ?? foe;
    const [tx, ty] = xy(far.capital, W);
    const flight = await iso(page, 'missileFx', 1, cx, cy, tx, ty, {}, true);
    const n0 = [cx + (tx - cx) * 0.3, cy + (ty - cy) * 0.3, 4.2];
    const n1 = [cx + (tx - cx) * 0.75, cy + (ty - cy) * 0.75, 4.6];
    await dolly(page, n0, n0, 10);
    await record(page, 'nuke', Math.round(flight * 1000) + 5000, async () => {
      void dolly(page, n0, n1, flight * 1000);
      await wait(page, flight * 1000 - 50);
      await iso(page, 'nukeFx', 1, tx, ty);
      void dolly(page, n1, [tx, ty, 6.5], 5000);
    });
  }

  await app.close();
}
