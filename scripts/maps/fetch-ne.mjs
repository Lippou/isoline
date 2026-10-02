// Downloads the Natural Earth (public domain) layers used by `npm run maps` into
// .cache/ne/. Only needed to rebuild the shipped maps: assets/maps/ is committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.cache', 'ne');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const LAYERS = [
  'ne_10m_land',
  'ne_10m_minor_islands',
  'ne_10m_lakes',
  'ne_10m_glaciated_areas',
  'ne_10m_rivers_lake_centerlines',
  'ne_10m_geography_regions_polys',
  'ne_50m_admin_0_countries',
];

fs.mkdirSync(out, { recursive: true });
for (const name of LAYERS) {
  const file = path.join(out, `${name}.geojson`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && !process.argv.includes('--force')) {
    console.log(`✔ ${name} (cached)`);
    continue;
  }
  const res = await fetch(`${BASE}${name}.geojson`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`↓ ${name} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}
