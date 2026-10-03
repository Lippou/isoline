// Prints the Courier's press photos (one per world event) from Wikimedia Commons.
//   npx tsx scripts/press/build-photos.ts [--force] [id…]
// For each photo of src/ui/hud/pressPhotos.ts: reads its licence and author from the
// Commons API (and stops if they no longer match the credits), downloads the original
// into .cache/press-src/ (not committed), cuts the 3:2 frame, then prints it in the
// paper's inks with the local ffmpeg-static: a duotone from the navy ink to the newsprint,
// the red of the source kept as the magenta spot colour where it carries the story (the
// boards "in the red"), and a light paper grain. Output: public/press/<id>.webp, which
// Vite copies into dist-renderer/ (packaged with the app, served by isoline://app/press/).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { PRESS_H, PRESS_PHOTOS, PRESS_W, type PressPhoto } from '../../src/ui/hud/pressPhotos';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(ROOT, '.cache', 'press-src');
const OUT = path.join(ROOT, 'public', 'press');
fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const UA = { 'User-Agent': 'IsolineAssetBot/1.0 (https://github.com/Lippou/isoline; press photo credits)' };
const API = 'https://commons.wikimedia.org/w/api.php';
const FFMPEG = ffmpeg as unknown as string;

// Newsprint inks (src/ui/styles/global.css, BRAND.md §4).
const INK = [0x17, 0x2a, 0x3c];
const PAPER = [0xf1, 0xec, 0xe2];
const SPOT_DARK = [0xb3, 0x24, 0x5f];
const SPOT_LIGHT = [0xe0, 0x45, 0x6f];
const QUALITY = 74;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string | URL): Promise<Response> {
  for (let k = 0; k < 6; k++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r;
    console.warn(`  HTTP ${r.status}, retrying…`);
    await sleep(3000 * (k + 1));
  }
  throw new Error(`cannot fetch ${String(url)}`);
}

interface Meta {
  url: string;
  width: number;
  height: number;
  licence: string;
  artist: string;
}
async function meta(file: string): Promise<Meta> {
  const u = new URL(API);
  const q = {
    action: 'query',
    format: 'json',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist',
  };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const j = (await (await get(u)).json()) as {
    query: {
      pages: Record<
        string,
        {
          imageinfo?: {
            url: string;
            width: number;
            height: number;
            extmetadata: Record<string, { value: string } | undefined>;
          }[];
        }
      >;
    };
  };
  const info = Object.values(j.query.pages)[0]?.imageinfo?.[0];
  if (!info) throw new Error(`${file}: not found on Commons`);
  const text = (k: string) => (info.extmetadata[k]?.value ?? '').replace(/<[^>]+>/g, '').trim();
  return {
    url: info.url.split('?')[0]!,
    width: info.width,
    height: info.height,
    licence: text('LicenseShortName'),
    artist: text('Artist'),
  };
}

/** The credits must still hold: same licence, same author. */
function check(id: string, p: PressPhoto, m: Meta): void {
  if (m.licence.toLowerCase() !== p.licence.toLowerCase())
    throw new Error(`${id}: Commons now says "${m.licence}", credits say "${p.licence}"`);
  const who = p.author.split(' / ')[0]!.toLowerCase();
  if (!m.artist.toLowerCase().includes(who))
    throw new Error(`${id}: Commons author "${m.artist}" does not match "${p.author}"`);
}

/** Deterministic grain (mulberry32), seeded by the event id. */
function rng(seed: string): () => number {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Duotone in the paper's inks, red kept as the spot colour, a little grain. */
function print(raw: Buffer, id: string, p: PressPhoto): Buffer {
  const n = PRESS_W * PRESS_H;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const r = raw[i * 3]!;
    const g = raw[i * 3 + 1]!;
    const b = raw[i * 3 + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    hist[Math.min(255, Math.round(l))]!++;
  }
  // Levels: the 0.5 % darkest and lightest pixels are clipped (the ink is solid, the paper bare).
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]!) >= q * n) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = Math.max(lo + 1, pct(0.995));
  const gamma = p.gamma ?? 1;
  const spot = p.spot ?? 0;
  const grain = rng(id);
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const v = Math.pow(clamp((lum[i]! - lo) / (hi - lo)), gamma);
    let rgb = [mix(INK[0]!, PAPER[0]!, v), mix(INK[1]!, PAPER[1]!, v), mix(INK[2]!, PAPER[2]!, v)];
    if (spot > 0) {
      const r = raw[i * 3]!;
      const g = raw[i * 3 + 1]!;
      const b = raw[i * 3 + 2]!;
      // How red the source is: red well above green and blue, and bright enough to read.
      const m = clamp((r - Math.max(g, b) - 36) / 70) * clamp((r - 70) / 80) * spot;
      if (m > 0) {
        const tone = [0, 1, 2].map((c) => mix(SPOT_DARK[c]!, SPOT_LIGHT[c]!, v));
        rgb = rgb.map((c, k) => mix(c, tone[k]!, m));
      }
    }
    const noise = (grain() - 0.5) * 9;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[c]! + noise)));
  }
  return out;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
let total = 0;
for (const [id, p] of Object.entries(PRESS_PHOTOS)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`${id}: ${p.file}`);
  const m = await meta(p.file);
  check(id, p, m);
  const ext = path.extname(m.url).toLowerCase() || '.jpg';
  const src = path.join(SRC, `${id}${ext}`);
  if (force || !fs.existsSync(src)) {
    fs.writeFileSync(src, Buffer.from(await (await get(m.url)).arrayBuffer()));
    await sleep(1000);
  }
  const [cx, cy, cw] = p.crop;
  const w = Math.round(cw * m.width);
  const h = Math.round(w / 1.5);
  const x = Math.round(cx * m.width);
  const y = Math.round(cy * m.height);
  if (x + w > m.width || y + h > m.height)
    throw new Error(`${id}: the 3:2 frame ${w}×${h}+${x}+${y} leaves the ${m.width}×${m.height} original`);
  const raw = execFileSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-i',
      src,
      '-vf',
      `crop=${w}:${h}:${x}:${y},scale=${PRESS_W}:${PRESS_H}:flags=lanczos`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (raw.length !== PRESS_W * PRESS_H * 3) throw new Error(`${id}: unexpected decode size ${raw.length}`);
  const file = path.join(OUT, `${id}.webp`);
  execFileSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${PRESS_W}x${PRESS_H}`,
      '-i',
      '-',
      '-c:v',
      'libwebp',
      '-quality',
      String(QUALITY),
      '-compression_level',
      '6',
      file,
    ],
    { input: print(raw, id, p) },
  );
  const size = fs.statSync(file).size;
  total += size;
  console.log(`  → public/press/${id}.webp (${(size / 1024).toFixed(0)} KB, frame ${w}×${h}+${x}+${y})`);
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
