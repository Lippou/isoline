// Media capture: 1920×1080 screenshots, a 10 s gameplay GIF and a trailer video
// (Playwright screencast). Plays a scripted sandbox game through the ?automation hook.
// Usage: npm run build && node scripts/media.mjs
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decode } from 'fast-png';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'media');
const videoDir = path.join(root, '.cache', 'video');
fs.mkdirSync(out, { recursive: true });
fs.rmSync(videoDir, { recursive: true, force: true });
const only = process.argv[2];

async function launch(query, { video = false, size = [1920, 1080] } = {}) {
  const userData = path.join(root, '.cache/e2e-userdata', `media-${Date.now()}`);
  const app = await electron.launch({
    executablePath: (await import('electron')).default,
    args: [root],
    cwd: root,
    env: { ...process.env, ISOLINE_QUERY: query, ISOLINE_USER_DATA: userData },
    ...(video ? { recordVideo: { dir: videoDir, size: { width: size[0], height: size[1] } } } : {}),
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
    win.show();
  }, size);
  return { app, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
};
const iso = (page, fn, arg) => page.evaluate(([f, a]) => window.__iso[f](...(a ?? [])), [fn, arg]);
const cam = (page, x, y, zoom) =>
  page.evaluate(([x, y, z]) => window.__iso.camera.goTo(x, y, z), [x, y, zoom]);
const cmd = (page, c) => page.evaluate((c) => window.__iso.cmd(c), c);

/** Scripted sandbox: spawn in France, expand, build an economy, fleets and nukes. */
async function playScript(page, { onMoment } = {}) {
  await page.waitForSelector('[data-testid=spawn-countdown]', { timeout: 60000 });
  const st = await iso(page, 'state');
  const w = st.width;
  // France-ish (Europe map): search a land spawn around (0.43, 0.68).
  const spawn = await page.evaluate(
    ([w, h]) => {
      for (let r = 0; r < 80; r++) {
        for (let a = 0; a < 16; a++) {
          const x = Math.round(w * 0.43 + Math.cos((a / 16) * Math.PI * 2) * r);
          const y = Math.round(h * 0.68 + Math.sin((a / 16) * Math.PI * 2) * r);
          const t = y * w + x;
          if (window.__iso.freeLand(t)) return t;
        }
      }
      return -1;
    },
    [w, st.height],
  );
  await cmd(page, { t: 'spawn', tile: spawn });
  await cam(page, (spawn % w) + 0.5, Math.floor(spawn / w) + 0.5, 1.6);
  await page.waitForSelector('[data-testid=clock]', { timeout: 60000 });
  // Expansion waves.
  for (let k = 0; k < 6; k++) {
    const tiles = await iso(page, 'ownTiles', [400]);
    const t = tiles[Math.floor(Math.random() * tiles.length)];
    await cmd(page, { t: 'attack', tile: t + 12, ratio: 0.25 });
    await page.waitForTimeout(2500);
  }
  await onMoment?.('expanded');
  // Economy: cities, ports, factories, defences, silos, SAM.
  const own = await iso(page, 'ownTiles', [4000]);
  const pick = (n) => Array.from({ length: n }, (_, k) => own[Math.floor(((k + 0.5) / n) * own.length)]);
  for (const t of pick(6)) await cmd(page, { t: 'build', kind: 0, tile: t });
  for (const t of await iso(page, 'coast', [3])) await cmd(page, { t: 'build', kind: 1, tile: t });
  for (const t of pick(9).slice(6)) await cmd(page, { t: 'build', kind: 2, tile: t + 2 });
  for (const t of pick(13).slice(10)) await cmd(page, { t: 'build', kind: 4, tile: t + 3 });
  await cmd(page, { t: 'build', kind: 5, tile: own[Math.floor(own.length / 2)] + 5 });
  await cmd(page, { t: 'research', tech: 3 });
  await page.waitForTimeout(9000);
  // Fleet.
  const coast = await iso(page, 'coast', [40]);
  for (let k = 0; k < 4; k++) {
    const c = coast[(k * 9) % coast.length];
    await cmd(page, { t: 'warship', tile: c - 3 });
  }
  await onMoment?.('built');
  // Strikes: wait for our silos, then hit the biggest nation outside SAM cover.
  for (let k = 0; k < 40; k++) {
    const bs = await iso(page, 'buildings');
    const me0 = (await iso(page, 'state')).local;
    if (bs.some((b) => b.type === 4 && b.owner === me0 && b.ready && b.tubesReady > 0)) break;
    await page.waitForTimeout(1000);
  }
  const all = await iso(page, 'state');
  const bs = await iso(page, 'buildings');
  const silo = bs.find((b) => b.type === 4 && b.owner === all.local) ?? {
    x: spawn % w,
    y: Math.floor(spawn / w),
  };
  const sams = bs.filter((b) => b.type === 5 && b.owner !== all.local);
  const exposed = (x, y) => sams.every((b) => (b.x - x) ** 2 + (b.y - y) ** 2 > 135 * 135);
  const safePath = (tx, ty) => {
    for (let k = 0; k <= 20; k++) {
      if (!exposed(silo.x + ((tx - silo.x) * k) / 20, silo.y + ((ty - silo.y) * k) / 20)) return false;
    }
    return true;
  };
  const dist = (p) => (p.label[0] - silo.x) ** 2 + (p.label[1] - silo.y) ** 2;
  const nations = all.players
    .filter((p) => p.kind === 'nation' && p.tiles > 800)
    .sort((a, b) => dist(a) - dist(b));
  const target = nations.find((n) => safePath(n.label[0], n.label[1])) ?? nations[0];
  console.log('nuke target', target?.name, 'sams', sams.length);
  if (target) {
    const tx = Math.round(target.label[0]);
    const ty = Math.round(target.label[1]);
    const tile = ty * w + tx;
    await cam(page, (tx + silo.x) / 2, (ty + silo.y) / 2, 1.5);
    await cmd(page, { t: 'nuke', kind: 1, tile, count: 1 });
    await page.waitForTimeout(300);
    await onMoment?.('nukes-launched');
    // Follow until the H-bomb lands (flight ≥ 1 s), shoot during flight, then the crater.
    await page.waitForTimeout(900);
    await onMoment?.('nukes-flight');
    await cam(page, tx, ty, 1.8);
    await page.waitForTimeout(3200);
    await onMoment?.('nukes-impact');
  }
  return { spawn, w };
}

// ------------------------------------------------------------------ screenshots
const want = (k) => !only || only === 'shots' || only === k;
if (want('menus')) {
  // 01 title + 02 lobby + 11 campaign.
  {
    const { app, page } = await launch('');
    await page.waitForSelector('[data-testid=title-screen]', { timeout: 30000 });
    await page.waitForTimeout(9000);
    await shot(page, '01-title');
    await page.getByTestId('menu-play').click();
    await page.getByTestId('menu-solo').click();
    await page.waitForTimeout(1500);
    await shot(page, '02-lobby');
    await page
      .getByRole('button', { name: /Retour|Back/ })
      .first()
      .click();
    await page.getByTestId('menu-play').click();
    await page.getByTestId('menu-campaign').click();
    await page.waitForTimeout(1200);
    await shot(page, '11-campaign');
    await app.close();
  }
}
// Sandbox game: gameplay, nukes, panels.
if (want('sandbox')) {
  {
    const { app, page } = await launch(
      'autostart=europe&nations=16&tribes=20&spawn=3&speed=2&difficulty=normal&startGold=80000000&automation&name=Ilse',
    );
    await playScript(page, {
      onMoment: async (m) => {
        if (m === 'built') {
          await page.waitForTimeout(6000);
          const st = await iso(page, 'state');
          const me = st.players.find((p) => p.name === 'Ilse');
          await cam(page, me.label[0], me.label[1], 2.6);
          await page.waitForTimeout(1500);
          await shot(page, '03-gameplay');
        }
        if (m === 'nukes-flight') await shot(page, '04-nukes-flight');
        if (m === 'nukes-impact') await shot(page, '05-nuclear-impact');
      },
    });
    // Panels.
    await page.locator('[data-testid=panel-tech]').click();
    await page.waitForTimeout(600);
    await shot(page, '08-tech-panel');
    await page.locator('[data-testid=panel-tech]').click();
    await page.locator('[data-testid=panel-diplomacy]').click();
    await page.waitForTimeout(600);
    await shot(page, '09-diplomacy');
    await page.locator('[data-testid=panel-diplomacy]').click();
    await app.close();
  }
}
// Spectated Mediterranean at ×8: busy port by day (~9 min), then the night.
if (want('med')) {
  {
    const { app, page } = await launch(
      'autostart=mediterranean&spectate&nations=26&tribes=20&spawn=1&speed=8&automation',
    );
    await page.waitForSelector('[data-testid=leaderboard]', { timeout: 60000 });
    for (let k = 0; k < 400 && (await iso(page, 'state')).tick < 5400; k++) await page.waitForTimeout(500);
    // Naval + rail close-up: the busiest port (most buildings around it).
    {
      let bs = await iso(page, 'buildings');
      for (let k = 0; k < 30 && !bs.some((b) => b.type === 1 && b.ready); k++) {
        await page.waitForTimeout(1000);
        bs = await iso(page, 'buildings');
      }
      const ports = bs.filter((b) => b.type === 1 && b.ready);
      console.log('buildings', bs.length, 'ports', ports.length);
      let best = null;
      let bestScore = -1;
      for (const p of ports) {
        const score = bs.filter((b) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 60 * 60).length;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (best) {
        await cam(page, best.x, best.y, 3.0);
        await page.waitForTimeout(3000);
        await shot(page, '06-naval-rail');
      }
    }
    for (let k = 0; k < 400; k++) {
      const tick = (await iso(page, 'state')).tick;
      if (tick % 4800 > 3300) break;
      await page.waitForTimeout(500);
    }
    const st = await iso(page, 'state');
    await cam(page, st.width * 0.42, st.height * 0.45, 1.6);
    await page.waitForTimeout(2500);
    await shot(page, '07-night');
    await app.close();
  }
}
// Fog of war: expand a little, then frame our border with the unseen world.
if (want('fog')) {
  {
    const { app, page } = await launch(
      'autostart=africa&nations=30&tribes=30&spawn=2&speed=2&fog&automation&name=Ilse',
    );
    await page.waitForSelector('[data-testid=spawn-countdown]', { timeout: 60000 });
    const st = await iso(page, 'state');
    const sp = await page.evaluate(
      ([w, h]) => {
        for (let r = 0; r < 120; r++)
          for (let a = 0; a < 16; a++) {
            const t =
              Math.round(h * 0.4 + Math.sin((a / 16) * 6.283) * r) * w +
              Math.round(w * 0.45 + Math.cos((a / 16) * 6.283) * r);
            if (!window.__iso.freeLand(t)) continue;
            let clear = true;
            for (let q = 0; q < 24 && clear; q++) {
              const qa = (q / 24) * 6.283;
              const u = t + Math.round(Math.sin(qa) * 35) * w + Math.round(Math.cos(qa) * 35);
              if (window.__iso.ownerOf(u) > 0) clear = false;
            }
            if (clear) return t;
          }
        return -1;
      },
      [st.width, st.height],
    );
    await cmd(page, { t: 'spawn', tile: sp });
    await page.waitForSelector('[data-testid=clock]', { timeout: 60000 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 6.283;
      const tgt =
        Math.round(Math.floor(sp / st.width) + Math.sin(a) * 45) * st.width +
        Math.round((sp % st.width) + Math.cos(a) * 45);
      await cmd(page, { t: 'attack', tile: tgt, ratio: 0.3 });
      await page.waitForTimeout(1800);
    }
    await page.waitForTimeout(15000);
    await cam(page, (sp % st.width) + 0.5, Math.floor(sp / st.width) + 0.5, 1.2);
    await page.waitForTimeout(2500);
    await shot(page, '10-fog-of-war');
    await app.close();
  }
}
if (want('editor')) {
  {
    const { app, page } = await launch('screen=editor');
    await page.waitForSelector('[data-testid=editor]');
    await page.locator('select').first().selectOption('archipelago');
    await page.waitForTimeout(2500);
    await shot(page, '12-editor');
    await app.close();
  }
}
// Campaign: briefing, then the guided first steps.
if (want('campaign')) {
  const { app, page } = await launch('');
  await page.waitForSelector('[data-testid=title-screen]', { timeout: 30000 });
  await page.getByTestId('menu-play').click();
  await page.getByTestId('menu-campaign').click();
  await page.getByTestId('mission-m1').click();
  await page.waitForSelector('[data-testid=briefing]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, '14-briefing');
  await page.getByTestId('briefing-start').click();
  const box = await page.locator('canvas').first().boundingBox();
  for (const [fx, fy] of [
    [0.5, 0.2],
    [0.3, 0.5],
    [0.7, 0.8],
  ]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    if (await page.getByTestId('clock').isVisible()) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(6000);
  await shot(page, '15-guide');
  await app.close();
}
// End screen (spectated Black Sea match at ×8).
if (want('end')) {
  {
    const { app, page } = await launch(
      'autostart=black-sea&spectate&nations=10&tribes=10&spawn=1&speed=8&gold=4&difficulty=hard',
    );
    await page.waitForSelector('[data-testid=end-screen]', { timeout: 600000 });
    await page.waitForTimeout(1500);
    await shot(page, '13-end-screen');
    await app.close();
  }
}

// ---------------------------------------------------------------------- GIF
if (!only || only === 'gif') {
  const { app, page } = await launch(
    'autostart=mediterranean&spectate&nations=26&tribes=20&spawn=1&speed=3&zoom=1.25&x=0.5&y=0.5',
    { size: [1280, 720] },
  );
  await page.waitForSelector('[data-testid=leaderboard]', { timeout: 60000 });
  await page.waitForTimeout(8000);
  const gif = GIFEncoder();
  const frames = 100; // 10 s at 10 fps
  const W = 640;
  const H = 360;
  for (let k = 0; k < frames; k++) {
    const t0 = Date.now();
    const png = decode(await page.screenshot());
    const src = png.data;
    const sw = png.width;
    const ch = png.channels;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = Math.floor((x / W) * sw);
        const sy = Math.floor((y / H) * png.height);
        const si = (sy * sw + sx) * ch;
        const di = (y * W + x) * 4;
        rgba[di] = src[si];
        rgba[di + 1] = src[si + 1];
        rgba[di + 2] = src[si + 2];
        rgba[di + 3] = 255;
      }
    }
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), W, H, { palette, delay: 100 });
    const spent = Date.now() - t0;
    if (spent < 100) await page.waitForTimeout(100 - spent);
  }
  gif.finish();
  fs.writeFileSync(path.join(out, 'gameplay.gif'), gif.bytes());
  console.log('gif written');
  await app.close();
}

// -------------------------------------------------------------------- video
if (!only || only === 'video') {
  const { app, page } = await launch('', { video: true, size: [1920, 1080] });
  await page.waitForSelector('[data-testid=title-screen]', { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.getByTestId('menu-play').click();
  await page.waitForTimeout(800);
  await page.getByTestId('menu-solo').click();
  await page.waitForTimeout(2500);
  await page
    .getByTestId('map-europe')
    .click()
    .catch(() => {});
  await page.waitForTimeout(1500);
  await app.close();
  // Second part: sandbox action.
  const s2 = await launch(
    'autostart=europe&nations=16&tribes=20&spawn=3&speed=2&difficulty=normal&startGold=80000000&automation&name=Ilse',
    { video: true },
  );
  await playScript(s2.page);
  await s2.page.waitForTimeout(6000);
  await s2.app.close();
  const vids = fs
    .readdirSync(videoDir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => path.join(videoDir, f));
  vids.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  // Assemble a single 58 s H.264 trailer (menus 10 s + match 48 s) with the local ffmpeg-static.
  const ffmpeg = (await import('ffmpeg-static')).default;
  const { execFileSync } = await import('node:child_process');
  execFileSync(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-threads',
    '4',
    '-i',
    vids[0],
    '-i',
    vids[1],
    '-filter_complex',
    '[0:v]trim=0:10,setpts=PTS-STARTPTS,fps=30[a];[1:v]trim=4:52,setpts=PTS-STARTPTS,fps=30[b];[a][b]concat=n=2:v=1[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    path.join(out, 'trailer.mp4'),
  ]);
  console.log('trailer.mp4 written');
}
