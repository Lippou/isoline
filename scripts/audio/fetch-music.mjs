// Fetches the orchestral soundtrack (Kevin MacLeod, incompetech.com — CC BY 4.0),
// normalises loudness and converts it to Ogg Vorbis with the local ffmpeg-static.
// Output: public/audio/music/<id>.ogg + public/audio/music/credits.json.
//   node scripts/audio/fetch-music.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(root, '.cache', 'music-src');
const OUT = path.join(root, 'public', 'audio', 'music');
fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/** id → track; `mood` drives the adaptive score (see src/audio/audio.ts). */
export const TRACKS = [
  { id: 'menu', title: 'Lord of the Land', mood: 'menu' },
  { id: 'calm1', title: 'Lasting Hope', mood: 'calm' },
  { id: 'calm2', title: 'Unwritten Return', mood: 'calm' },
  { id: 'calm3', title: 'Reawakening', mood: 'calm' },
  { id: 'tension1', title: 'Gathering Darkness', mood: 'tension' },
  { id: 'tension2', title: 'Interloper', mood: 'tension' },
  { id: 'war1', title: 'Five Armies', mood: 'war' },
  { id: 'war2', title: 'Prelude and Action', mood: 'war' },
  { id: 'war3', title: 'Volatile Reaction', mood: 'war' },
  { id: 'war4', title: 'Clash Defiant', mood: 'war' },
  { id: 'victory', title: 'Heroic Age', mood: 'victory' },
  { id: 'defeat', title: 'Lightless Dawn', mood: 'defeat' },
];

const force = process.argv.includes('--force');
const credits = {};
for (const tr of TRACKS) {
  const dest = path.join(OUT, `${tr.id}.ogg`);
  const url = `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(tr.title)}.mp3`;
  credits[tr.id] = {
    title: tr.title,
    author: 'Kevin MacLeod (incompetech.com)',
    url: 'https://incompetech.com',
    license: 'CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/',
    mood: tr.mood,
  };
  if (fs.existsSync(dest) && !force) {
    console.log(`= ${tr.id}`);
    continue;
  }
  const src = path.join(SRC, `${tr.id}.mp3`);
  if (!fs.existsSync(src)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${tr.title}: HTTP ${res.status}`);
    fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-threads',
    '4',
    '-i',
    src,
    '-af',
    'loudnorm=I=-20:TP=-2:LRA=14',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-c:a',
    'libvorbis',
    '-q:a',
    '3',
    dest,
  ]);
  console.log(`✓ ${tr.id.padEnd(9)} ${tr.title} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 2) + '\n');
