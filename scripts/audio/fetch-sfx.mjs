// Fetches real recorded sound effects (Creative Commons 0 only) from Freesound,
// then trims, fades and loudness-normalises them with the local ffmpeg-static.
// Output: public/audio/sfx/<id>.ogg + public/audio/sfx/credits.json.
//   node scripts/audio/fetch-sfx.mjs [--force] [id…]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(root, '.cache', 'sfx-src');
const OUT = path.join(root, 'public', 'audio', 'sfx');
fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/**
 * Curated selection (Freesound sound ids, all Creative Commons 0), chosen for
 * realistic recordings. start: offset (s); len: kept length (s); lufs: loudness.
 */
export const SFX = [
  { id: 'coin', sound: 338260, len: 1.6, lufs: -18 }, // Money Bag
  { id: 'coinSmall', sound: 17502, len: 1.2, lufs: -22 }, // Coin dropping
  { id: 'conquest', sound: 52458, len: 0.9, lufs: -27 }, // sword
  { id: 'attack', sound: 107589, len: 1.0, lufs: -22 }, // unsheath sword
  { id: 'build', sound: 0, query: 'construction hammering', len: 1.6, lufs: -22 },
  { id: 'siren', sound: 206141, len: 6, lufs: -19 }, // Nuclear Alarm
  { id: 'launch', sound: 211617, len: 4.5, lufs: -18 }, // Far Away Rocket Launch
  { id: 'explosionA', sound: 235968, len: 5, lufs: -14 }, // Explosion_01
  { id: 'explosionH', sound: 259300, len: 9, lufs: -12 }, // Huge Explosion
  { id: 'explosionSmall', sound: 149966, len: 3, lufs: -20 }, // Muffled Distant Explosion
  { id: 'intercept', sound: 47252, len: 1.5, lufs: -19 }, // bad explosion
  { id: 'cannon', sound: 0, query: 'cannon shot', len: 2, lufs: -21 },
  { id: 'sunk', sound: 398032, len: 1.3, lufs: -21 }, // Splash
  { id: 'horn', sound: 420716, len: 3.5, lufs: -22 }, // ship horn very close
  { id: 'train', sound: 71778, len: 2.5, lufs: -25 }, // Steam Whistle
  { id: 'alliance', sound: 326961, len: 2.6, lufs: -19 }, // Pen signature on paper (a pact is signed)
  { id: 'betrayal', sound: 164273, len: 4, lufs: -17 }, // Orchestral Hit - The Villain Appears
  { id: 'event', sound: 425172, len: 4.5, lufs: -21 }, // Church bell
  { id: 'victory', sound: 456966, len: 4.4, lufs: -16 }, // Success Fanfare Trumpets
  { id: 'defeat', sound: 369394, len: 4, lufs: -18 }, // Timpani C2
  { id: 'eliminated', sound: 427803, len: 4.4, lufs: -18 }, // Cinematic Hit With Horns
  { id: 'warHorn', sound: 392180, len: 4.5, lufs: -19 }, // Battle horn
  { id: 'click', sound: 678248, len: 0.25, lufs: -25 }, // Mouse click
  { id: 'open', sound: 397548, len: 0.5, lufs: -24 }, // Page Turn 01
  { id: 'confirm', sound: 0, query: 'rubber stamp', len: 0.7, lufs: -22 },
  { id: 'error', sound: 0, query: 'wood knock', len: 0.5, lufs: -25 },
  { id: 'paper', sound: 181774, len: 1.2, lufs: -25 }, // rustling paper
  { id: 'torn', sound: 181773, len: 1.5, lufs: -21 }, // tearing paper (an ally betrays us: the pact is torn)
  { id: 'stamp', sound: 470710, len: 0.9, lufs: -19 }, // rubber stamp (an alliance offer stamped "refused")
  { id: 'rejected', sound: 715226, len: 1.7, lufs: -23 }, // short rejection tone under the stamp
  { id: 'tribeFall', sound: 486140, len: 1.8, lufs: -21 }, // single taiko hit (a tribe is wiped out)
];

async function bySound(id) {
  const html = await (await fetch(`https://freesound.org/s/${id}/`)).text();
  if (!html.includes('Creative Commons 0')) throw new Error(`sound ${id} is not CC0`);
  const mp3 = html.match(/data-mp3="([^"]*)"/)?.[1];
  const title = html.match(/data-title="([^"]*)"/)?.[1] ?? String(id);
  const user = html.match(/href="\/people\/([^/"]+)\/"/)?.[1] ?? '';
  if (!mp3) throw new Error(`sound ${id}: no preview`);
  return {
    id: String(id),
    title,
    user,
    duration: 0,
    downloads: 0,
    rating: 0,
    mp3: mp3.replace('-lq.mp3', '-hq.mp3'),
  };
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const creditsFile = path.join(OUT, 'credits.json');
const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : {};

const attr = (block, name) => block.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] ?? '';

async function search(s) {
  const [a, b] = s.dur;
  const f = `license:"Creative Commons 0" duration:[${a} TO ${b}]`;
  const url = `https://freesound.org/search/?q=${encodeURIComponent(s.q)}&f=${encodeURIComponent(f)}&s=${encodeURIComponent('Downloads (most first)')}`;
  const html = await (await fetch(url)).text();
  const blocks = html.split('class="bw-player"').slice(1);
  const out = [];
  for (const blk of blocks) {
    const id = attr(blk, 'sound-id');
    const mp3 = attr(blk, 'mp3');
    if (!id || !mp3) continue;
    const title = attr(blk, 'title');
    const rating = Number(blk.match(/Average rating of ([\d.]+)/)?.[1] ?? 0);
    out.push({
      id,
      title,
      user: attr(blk, 'username'),
      duration: Number(attr(blk, 'duration')),
      downloads: Number(attr(blk, 'num-downloads')),
      rating,
      mp3: mp3.replace('-lq.mp3', '-hq.mp3'),
    });
  }
  // Prefer well-rated sounds among the most downloaded.
  return out.filter((r) => r.rating === 0 || r.rating >= 3.5);
}

for (const s of SFX) {
  if (only.length && !only.includes(s.id)) continue;
  const dest = path.join(OUT, `${s.id}.ogg`);
  if (fs.existsSync(dest) && !force) {
    console.log(`= ${s.id}`);
    continue;
  }
  await new Promise((res) => setTimeout(res, 1500)); // be gentle with the site
  const r = s.sound ? await bySound(s.sound) : (await search({ q: s.query, dur: [0.1, 10] }))[0];
  if (!r) {
    console.log(`✗ ${s.id}: no CC0 result for "${s.query}"`);
    continue;
  }
  const src = path.join(SRC, `${s.id}-${r.id}.mp3`);
  if (!fs.existsSync(src)) fs.writeFileSync(src, Buffer.from(await (await fetch(r.mp3)).arrayBuffer()));
  // Trim leading silence, keep at most `len` s with a short fade-out, normalise loudness.
  const fadeStart = Math.max(0, s.len - Math.min(0.6, s.len * 0.3));
  const filter = [
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02',
    `atrim=0:${s.len}`,
    `afade=t=in:d=0.005`,
    `afade=t=out:st=${fadeStart.toFixed(2)}:d=${(s.len - fadeStart).toFixed(2)}`,
    `loudnorm=I=${s.lufs}:TP=-1.5:LRA=11`,
  ].join(',');
  execFileSync(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-af',
    filter,
    '-ar',
    '44100',
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    dest,
  ]);
  credits[s.id] = {
    title: r.title,
    author: r.user,
    url: `https://freesound.org/people/${r.user}/sounds/${r.id}/`,
    license: 'CC0 1.0',
  };
  console.log(`✓ ${s.id.padEnd(15)} ${r.title} — ${r.user}`);
}
fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2) + '\n');
