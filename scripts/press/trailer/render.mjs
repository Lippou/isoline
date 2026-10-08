// Renders the presentation film (trailer.js) frame by frame in headless Chromium and encodes
// it with the game's music: docs/media/trailer.mp4. Needs the footage (footage.mjs).
// Usage:
//   node scripts/press/trailer/render.mjs                 the film, then everything made from it:
//     docs/media/trailer.mp4 (web size, −16 LUFS), the README clips (animated WebP) and
//     docs/media/social-preview.jpg (GitHub's social preview, uploaded by hand in the settings)
//   node scripts/press/trailer/render.mjs --stills 3,8.5  single frames (seconds) → .cache/press/stills/
//   node scripts/press/trailer/render.mjs --from 10 --to 20   a preview of a range (no music)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? null : process.argv[i + 1];
};
const footageDir = path.join(root, '.cache/press/footage');
/** README excerpts: [name, from (s), length (s)] — each chapter of the film with its caption. */
const CLIPS = [
  ['monde', 5.5, 5.2],
  ['etendre', 11.4, 5.1],
  ['batir', 17.0, 5.1],
  ['percer', 24.9, 6.7],
  ['dissuader', 32.2, 5.5],
];
const MUSIC = { file: 'public/audio/music/victory.ogg', from: 30 }; // « Heroic Age », Kevin MacLeod (CC BY 4.0)

// A tiny static server: ES modules, fonts and footage cannot load from file://.
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
const server = http
  .createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

/** Playwright's Chromium, or else the newest headless shell already in its cache. */
function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cache)) return undefined;
  const shells = fs
    .readdirSync(cache)
    .filter((d) => d.startsWith('chromium_headless_shell-'))
    .sort();
  for (const d of shells.reverse()) {
    const dir = path.join(cache, d);
    const sub = fs.readdirSync(dir).find((x) => x.startsWith('chrome-headless-shell'));
    const exe = sub && path.join(dir, sub, 'chrome-headless-shell');
    if (exe && fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: chromiumPath() }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(`${base}/scripts/press/trailer/trailer.html`);
await page.waitForFunction(() => !!window.trailer);
const frames = Object.fromEntries(
  fs
    .readdirSync(footageDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.endsWith('-raw'))
    .map((d) => [d.name, fs.readdirSync(path.join(footageDir, d.name)).length]),
);
const info = await page.evaluate((c) => window.trailer.init(c), {
  footage: `${base}/.cache/press/footage`,
  fonts: `${base}/node_modules/@fontsource`,
  frames,
  symbolSvg: fs.readFileSync(path.join(root, 'brand/symbol-mono.svg'), 'utf8'),
});
const canvas = page.locator('canvas');
const shot = async (f) => {
  await page.evaluate((f) => window.trailer.renderFrame(f), f);
  return canvas.screenshot({ type: 'png' });
};

const stills = arg('stills');
if (stills) {
  const dir = path.join(root, '.cache/press/stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    const f = Math.round(s * info.fps);
    fs.writeFileSync(path.join(dir, `${s.toFixed(1)}.png`), await shot(f));
    console.log('still', s);
  }
} else {
  const from = Math.round(Number(arg('from') ?? 0) * info.fps);
  const to = Math.min(info.frames, Math.round(Number(arg('to') ?? info.duration) * info.fps));
  const full = from === 0 && to === info.frames;
  const out =
    arg('out') ?? path.join(root, full ? '.cache/press/trailer-master.mp4' : '.cache/press/preview.mp4');
  const secs = (to - from) / info.fps;
  const audio = full
    ? ['-ss', String(MUSIC.from), '-t', String(secs), '-i', path.join(root, MUSIC.file)]
    : [];
  const afilter = full
    ? [
        '-af',
        `afade=t=in:d=1.2,afade=t=out:st=${(secs - 3.5).toFixed(2)}:d=3.5`,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
      ]
    : [];
  const enc = spawn(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(info.fps),
      '-c:v',
      'png',
      '-i',
      '-',
      ...audio,
      '-map',
      '0:v',
      ...(full ? ['-map', '1:a'] : []),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      '-tune',
      'film',
      '-movflags',
      '+faststart',
      ...afilter,
      '-shortest',
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const png = await shot(f);
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
    if ((f - from) % 150 === 0) console.log(`frame ${f}/${to} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  console.log('written', path.relative(root, out), `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  if (full) await publish(out);
}

/** From the master: the web film, the README clips and the social preview. */
async function publish(master) {
  const media = path.join(root, 'docs/media');
  const run = (args) =>
    new Promise((res, rej) =>
      spawn(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }).on('close', (c) =>
        c ? rej(new Error(`ffmpeg ${c}`)) : res(),
      ),
    );
  await run([
    '-i',
    master,
    '-c:v',
    'libx264',
    '-preset',
    'slower',
    '-crf',
    '22',
    '-tune',
    'film',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=9',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    path.join(media, 'trailer.mp4'),
  ]);
  // The README's excerpts: one per chapter, its caption included.
  for (const [name, from, secs] of CLIPS)
    await run([
      '-ss',
      String(from),
      '-t',
      String(secs),
      '-i',
      master,
      '-vf',
      'fps=20,scale=960:-1:flags=lanczos',
      '-c:v',
      'libwebp_anim',
      '-q:v',
      '76',
      '-compression_level',
      '6',
      '-loop',
      '0',
      path.join(media, `${name}.webp`),
    ]);
  await run([
    '-ss',
    '41.6',
    '-i',
    master,
    '-frames:v',
    '1',
    '-vf',
    'crop=1920:960:0:20,scale=1280:640:flags=lanczos',
    '-q:v',
    '2',
    path.join(media, 'social-preview.jpg'),
  ]);
  console.log(
    'published docs/media: trailer.mp4, social-preview.jpg,',
    CLIPS.map((c) => `${c[0]}.webp`).join(', '),
  );
}
await browser.close();
server.close();
