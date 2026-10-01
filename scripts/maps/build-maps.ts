// Builds every shipped map into assets/maps/:
//   <id>.png (terrain colours), <id>.elev.png (altitude), <id>.json (meta), <id>.thumb.png
// Real-world maps are rasterised from Natural Earth (public domain) vector data
// downloaded into .cache/ne/ (see README). Fictional and arcade maps come from the
// in-game procedural generator with fixed seeds.
import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'fast-png';
import { synthesize, generateDeposits, generateSpawnPoints } from '../../src/core/map/synth';
import { encodeTerrainPng, encodeGreyPng } from '../../src/core/map/format';
import { generateMapData, generateLabyrinth, markEnclosedLakes } from '../../src/core/map/generator';
import type { MapMeta, MapCategory, NationSpawn, LocalizedName } from '../../src/core/map/gamemap';
import { IS_LAND, T, TERRAIN } from '../../src/core/map/terrain';
import { hashString } from '../../src/core/rng';

const ROOT = path.resolve(import.meta.dirname, '../..');
const NE = path.join(ROOT, '.cache/ne');
const OUT = path.join(ROOT, 'assets/maps');
fs.mkdirSync(OUT, { recursive: true });

type Ring = [number, number][];
type Polygon = Ring[];
interface Feature {
  props: Record<string, unknown>;
  polys: Polygon[];
  lines: Ring[];
}

function loadGeo(name: string): Feature[] {
  const file = path.join(NE, `${name}.geojson`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — see README (map data download)`);
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    features: {
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown } | null;
    }[];
  };
  return g.features
    .filter((f) => f.geometry)
    .map((f) => {
      const geom = f.geometry!;
      const polys: Polygon[] = [];
      const lines: Ring[] = [];
      if (geom.type === 'Polygon') polys.push(geom.coordinates as Polygon);
      else if (geom.type === 'MultiPolygon') polys.push(...(geom.coordinates as Polygon[]));
      else if (geom.type === 'LineString') lines.push(geom.coordinates as Ring);
      else if (geom.type === 'MultiLineString') lines.push(...(geom.coordinates as Ring[]));
      return { props: f.properties, polys, lines };
    });
}

// ---------------------------------------------------------------- projections
interface Projection {
  width: number;
  height: number;
  project(lon: number, lat: number): [number, number];
  latitude(x: number, y: number): number;
  pxKm: number;
  normLon(lon: number): number;
}

const RAD = Math.PI / 180;
const millerY = (lat: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD));

function miller(width: number, lonMin: number, lonMax: number, latMin: number, latMax: number): Projection {
  const yTop = millerY(latMax);
  const yBot = millerY(latMin);
  const xSpan = (lonMax - lonMin) * RAD;
  const scale = width / xSpan;
  const height = Math.round((yTop - yBot) * scale);
  return {
    width,
    height,
    pxKm: (6371 * xSpan) / width,
    normLon: (l) => l,
    project: (lon, lat) => [(lon - lonMin) * RAD * scale, (yTop - millerY(lat)) * scale],
    latitude: (_x, y) => {
      const my = yTop - y / scale;
      return (Math.atan(Math.exp(my / 1.25)) - Math.PI / 4) / 0.4 / RAD;
    },
  };
}

function equirect(width: number, lonMin: number, lonMax: number, latMin: number, latMax: number): Projection {
  const phi0 = ((latMin + latMax) / 2) * RAD;
  const k = Math.cos(phi0);
  const scale = width / ((lonMax - lonMin) * k);
  const height = Math.round((latMax - latMin) * scale);
  return {
    width,
    height,
    pxKm: (6371 * RAD * (lonMax - lonMin) * k) / width,
    normLon: (l) => (lonMax > 180 && l < 0 ? l + 360 : l),
    project: (lon, lat) => [(lon - lonMin) * k * scale, (latMax - lat) * scale],
    latitude: (_x, y) => latMax - y / scale,
  };
}

// --------------------------------------------------------------- rasterising
function fillPolygon(mask: Uint8Array, proj: Projection, poly: Polygon, value = 1): void {
  const { width: w, height: h } = proj;
  const rings = poly.map((r) => r.map(([lon, lat]) => proj.project(proj.normLon(lon), lat)));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (maxX < 0 || maxY < 0 || minX >= w || minY >= h) return;
  // Sub-pixel polygons (small islands): stamp the centroid so they survive.
  if (maxX - minX < 1.5 && maxY - minY < 1.5) {
    const cx = Math.floor((minX + maxX) / 2);
    const cy = Math.floor((minY + maxY) / 2);
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) mask[cy * w + cx] = value;
    return;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        const [xa, ya] = r[k]!;
        const [xb, yb] = r[j]!;
        if (ya > sy !== yb > sy) xs.push(xa + ((sy - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * w + x] = value;
    }
  }
}

/** 4-connected polyline raster (so 1-px channels stay navigable). */
function drawLine(mask: Uint8Array, proj: Projection, line: Ring, value = 1, thick = 0): void {
  const { width: w, height: h } = proj;
  const pts = line.map(([lon, lat]) => proj.project(proj.normLon(lon), lat));
  const plot = (x: number, y: number) => {
    for (let dy = -thick; dy <= thick; dy++)
      for (let dx = -thick; dx <= thick; dx++) {
        const px = x + dx,
          py = y + dy;
        if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = value;
      }
  };
  for (let k = 1; k < pts.length; k++) {
    let [x0, y0] = pts[k - 1]!.map(Math.floor) as [number, number];
    const [x1, y1] = pts[k]!.map(Math.floor) as [number, number];
    plot(x0, y0);
    while (x0 !== x1 || y0 !== y1) {
      if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) x0 += Math.sign(x1 - x0);
      else y0 += Math.sign(y1 - y0);
      plot(x0, y0);
    }
  }
}

// ------------------------------------------------------------- map catalogue
interface RealMapDef {
  id: string;
  name: LocalizedName;
  category: MapCategory;
  proj: Projection;
  riverRank: number;
  maxNations: number;
}

const STRAITS: Ring[] = [
  [
    [28.95, 40.95],
    [29.05, 41.1],
    [29.12, 41.3],
  ], // Bosporus
  [
    [26.1, 39.95],
    [26.45, 40.2],
    [26.75, 40.5],
  ], // Dardanelles
  [
    [-6.2, 35.95],
    [-5.6, 35.97],
    [-5.0, 36.0],
  ], // Gibraltar
  [
    [32.56, 29.6],
    [32.5, 30.0],
    [32.35, 30.6],
    [32.32, 31.0],
    [32.3, 31.45],
  ], // Suez
  [
    [-80.0, 9.6],
    [-79.9, 9.3],
    [-79.7, 9.1],
    [-79.55, 8.85],
    [-79.5, 8.6],
  ], // Panama
  [
    [36.45, 45.1],
    [36.55, 45.3],
    [36.6, 45.5],
  ], // Kerch
  [
    [12.7, 55.4],
    [12.65, 55.8],
    [12.55, 56.2],
  ], // Øresund
  [
    [10.95, 55.0],
    [10.9, 55.5],
    [10.95, 55.9],
  ], // Great Belt
  [
    [43.2, 12.45],
    [43.4, 12.65],
    [43.6, 12.75],
  ], // Bab-el-Mandeb
  [
    [15.6, 38.0],
    [15.63, 38.25],
    [15.67, 38.45],
  ], // Messina
  [
    [103.6, 1.15],
    [103.9, 1.2],
    [104.2, 1.25],
  ], // Singapore
];

const REAL_MAPS: RealMapDef[] = [
  {
    id: 'world',
    name: { fr: 'Monde', en: 'World' },
    category: 'continents',
    proj: miller(2000, -180, 180, -62, 82),
    riverRank: 4,
    maxNations: 100,
  },
  {
    id: 'world-giant',
    name: { fr: 'Monde géant', en: 'Giant World' },
    category: 'continents',
    proj: miller(3200, -180, 180, -62, 82),
    riverRank: 5,
    maxNations: 100,
  },
  {
    id: 'europe',
    name: { fr: 'Europe', en: 'Europe' },
    category: 'continents',
    proj: equirect(1500, -25, 45, 34, 71.5),
    riverRank: 7,
    maxNations: 60,
  },
  {
    id: 'north-america',
    name: { fr: 'Amérique du Nord', en: 'North America' },
    category: 'continents',
    proj: equirect(1600, -170, -50, 7, 75),
    riverRank: 6,
    maxNations: 40,
  },
  {
    id: 'south-america',
    name: { fr: 'Amérique du Sud', en: 'South America' },
    category: 'continents',
    proj: equirect(1100, -93, -30, -57, 14),
    riverRank: 7,
    maxNations: 30,
  },
  {
    id: 'africa',
    name: { fr: 'Afrique', en: 'Africa' },
    category: 'continents',
    proj: equirect(1350, -20, 55, -37, 39),
    riverRank: 7,
    maxNations: 60,
  },
  {
    id: 'asia',
    name: { fr: 'Asie', en: 'Asia' },
    category: 'continents',
    proj: equirect(1700, 25, 150, -12, 78),
    riverRank: 6,
    maxNations: 60,
  },
  {
    id: 'oceania',
    name: { fr: 'Océanie', en: 'Oceania' },
    category: 'continents',
    proj: equirect(1600, 105, 185, -50, 5),
    riverRank: 7,
    maxNations: 30,
  },
  {
    id: 'mediterranean',
    name: { fr: 'Méditerranée', en: 'Mediterranean' },
    category: 'regions',
    proj: equirect(1800, -10, 42, 29, 47),
    riverRank: 9,
    maxNations: 40,
  },
  {
    id: 'black-sea',
    name: { fr: 'Mer Noire', en: 'Black Sea' },
    category: 'regions',
    proj: equirect(1200, 25, 45, 39, 48.5),
    riverRank: 10,
    maxNations: 16,
  },
];

// Sub-national nations for maps where countries are too few or too big.
const EXTRA_NATIONS: Record<string, { fr: string; en: string; lon: number; lat: number }[]> = {
  'black-sea': [
    { fr: 'Crimée', en: 'Crimea', lon: 34.1, lat: 45.0 },
    { fr: 'Anatolie', en: 'Anatolia', lon: 33, lat: 39.8 },
    { fr: 'Pont', en: 'Pontus', lon: 37.5, lat: 40.7 },
    { fr: 'Thrace', en: 'Thrace', lon: 27.3, lat: 41.7 },
    { fr: 'Kouban', en: 'Kuban', lon: 39.5, lat: 45.2 },
    { fr: 'Dobroudja', en: 'Dobruja', lon: 28.4, lat: 44.2 },
    { fr: 'Bessarabie', en: 'Bessarabia', lon: 29, lat: 46.9 },
    { fr: 'Colchide', en: 'Colchis', lon: 42.2, lat: 42.3 },
    { fr: 'Donbass', en: 'Donbas', lon: 38.3, lat: 47.9 },
    { fr: 'Valachie', en: 'Wallachia', lon: 25.6, lat: 44.6 },
  ],
  mediterranean: [
    { fr: 'Sicile', en: 'Sicily', lon: 14.2, lat: 37.5 },
    { fr: 'Sardaigne', en: 'Sardinia', lon: 9.0, lat: 40.1 },
    { fr: 'Crète', en: 'Crete', lon: 24.9, lat: 35.2 },
    { fr: 'Andalousie', en: 'Andalusia', lon: -4.6, lat: 37.4 },
    { fr: 'Provence', en: 'Provence', lon: 5.9, lat: 43.7 },
    { fr: 'Anatolie', en: 'Anatolia', lon: 32, lat: 38.5 },
    { fr: 'Levant', en: 'Levant', lon: 36.5, lat: 34.5 },
    { fr: 'Cyrénaïque', en: 'Cyrenaica', lon: 21.5, lat: 32.2 },
  ],
};

function buildReal(def: RealMapDef, data: Record<string, Feature[]>): void {
  const t0 = Date.now();
  const { proj } = def;
  const { width: w, height: h } = proj;
  const n = w * h;
  const land = new Uint8Array(n);
  const lake = new Uint8Array(n);
  const masks = {
    mountains: new Uint8Array(n),
    plateaus: new Uint8Array(n),
    hills: new Uint8Array(n),
    deserts: new Uint8Array(n),
    tundra: new Uint8Array(n),
    glaciers: new Uint8Array(n),
    rivers: new Uint8Array(n),
  };
  for (const f of [...data.land!, ...data.islands!]) for (const p of f.polys) fillPolygon(land, proj, p);
  for (const f of data.lakes!) {
    const rank = Number(f.props.scalerank ?? 0);
    if (rank > def.riverRank + 1) continue;
    for (const p of f.polys) fillPolygon(lake, proj, p);
  }
  for (let i = 0; i < n; i++) if (lake[i]) land[i] = 0;
  for (const f of data.glaciers!) for (const p of f.polys) fillPolygon(masks.glaciers, proj, p);
  for (const f of data.regions!) {
    const cla = String(f.props.FEATURECLA);
    const target =
      cla === 'Range/mtn'
        ? masks.mountains
        : cla === 'Plateau'
          ? masks.plateaus
          : cla === 'Foothills'
            ? masks.hills
            : cla === 'Desert'
              ? masks.deserts
              : cla === 'Tundra'
                ? masks.tundra
                : null;
    if (target) for (const p of f.polys) fillPolygon(target, proj, p);
  }
  for (const f of data.rivers!) {
    const rank = Number(f.props.scalerank ?? 99);
    if (rank > def.riverRank || String(f.props.featurecla).includes('Lake')) continue;
    for (const l of f.lines) drawLine(masks.rivers, proj, l);
  }
  // Straits & canals are carved as water after land rasterisation.
  const straits = new Uint8Array(n);
  for (const s of STRAITS) drawLine(straits, proj, s, 1, proj.pxKm < 6 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    if (straits[i]) {
      land[i] = 0;
      masks.rivers[i] = 0;
    }
    if (!land[i]) masks.rivers[i] = 0;
  }

  const seed = hashString(def.id);
  const { terrain, elevation } = synthesize({
    width: w,
    height: h,
    seed,
    pxKm: proj.pxKm,
    land,
    lake,
    latitude: proj.latitude,
    ...masks,
  });
  for (let i = 0; i < n; i++) if (straits[i]) terrain[i] = T.Shallow;
  markEnclosedLakes(terrain, w, h);

  // Nations from Natural Earth country label points (+ curated regional extras).
  const nations: NationSpawn[] = [];
  const snap = (x: number, y: number): [number, number] | null => {
    const xi = Math.round(x),
      yi = Math.round(y);
    for (let r = 0; r < 25; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = xi + dx,
            py = yi + dy;
          if (px < 2 || py < 2 || px >= w - 2 || py >= h - 2) continue;
          const t = terrain[py * w + px]!;
          if (IS_LAND[t] && t !== T.Mountain) return [px, py];
        }
    }
    return null;
  };
  for (const f of data.countries!) {
    const p = f.props;
    const lon = proj.normLon(Number(p.LABEL_X));
    const lat = Number(p.LABEL_Y);
    const [x, y] = proj.project(lon, lat);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const s = snap(x, y);
    if (!s) continue;
    const pop = Number(p.POP_EST ?? 0);
    const en = String(p.NAME ?? p.NAME_EN);
    const fr = String(p.NAME_FR ?? en);
    if (nations.some((nn) => Math.hypot(nn.x - s[0], nn.y - s[1]) < 6)) continue;
    nations.push({
      name: { fr, en },
      x: s[0],
      y: s[1],
      flagSeed: hashString(en + def.id),
      weight: Math.round(Math.sqrt(pop) + 400),
    });
  }
  for (const e of EXTRA_NATIONS[def.id] ?? []) {
    const [x, y] = proj.project(proj.normLon(e.lon), e.lat);
    const s = snap(x, y);
    if (!s || nations.some((nn) => Math.hypot(nn.x - s[0], nn.y - s[1]) < 10)) continue;
    nations.push({
      name: { fr: e.fr, en: e.en },
      x: s[0],
      y: s[1],
      flagSeed: hashString(e.en + def.id),
      weight: 2500,
    });
  }
  nations.sort((a, b) => b.weight - a.weight);
  const meta: MapMeta = {
    id: def.id,
    name: def.name,
    category: def.category,
    width: w,
    height: h,
    nations: nations.slice(0, def.maxNations),
    spawnPoints: generateSpawnPoints(w, h, terrain, seed, 320),
    deposits: generateDeposits(w, h, terrain, seed),
    author: 'Isoline (Natural Earth data)',
    version: 1,
  };
  writeMap(meta, terrain, elevation);
  console.log(
    `${def.id.padEnd(14)} ${w}×${h} (${(n / 1e6).toFixed(2)} M) nations=${meta.nations.length} ${Date.now() - t0} ms`,
  );
}

// ------------------------------------------------------------------- output
const PREVIEW: Record<number, [number, number, number]> = {
  [T.DeepOcean]: [14, 28, 48],
  [T.Shallow]: [26, 52, 78],
  [T.Lake]: [34, 66, 96],
  [T.River]: [70, 140, 170],
  [T.Plains]: [88, 120, 84],
  [T.Hills]: [120, 118, 84],
  [T.Mountain]: [150, 140, 128],
  [T.Desert]: [176, 156, 106],
  [T.Forest]: [52, 92, 64],
  [T.Tundra]: [190, 200, 205],
  [T.Impassable]: [80, 76, 80],
};

function writeMap(meta: MapMeta, terrain: Uint8Array, elevation: Uint8Array): void {
  const { width: w, height: h, id } = meta;
  fs.writeFileSync(path.join(OUT, `${id}.png`), encodeTerrainPng(terrain, w, h));
  fs.writeFileSync(path.join(OUT, `${id}.elev.png`), encodeGreyPng(elevation, w, h));
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(meta));
  // Thumbnail 320 px wide, shaded by altitude.
  const tw = 320;
  const th = Math.round((h / w) * tw);
  const data = new Uint8Array(tw * th * 3);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) / tw) * w));
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) / th) * h));
      const i = sy * w + sx;
      const c = PREVIEW[terrain[i]!] ?? TERRAIN[terrain[i]!]!.rgb;
      const shade = IS_LAND[terrain[i]!] ? 0.8 + (elevation[i]! / 255) * 0.45 : 1;
      const o = (y * tw + x) * 3;
      data[o] = Math.min(255, c[0] * shade);
      data[o + 1] = Math.min(255, c[1] * shade);
      data[o + 2] = Math.min(255, c[2] * shade);
    }
  fs.writeFileSync(
    path.join(OUT, `${id}.thumb.png`),
    encode({ width: tw, height: th, data, channels: 3, depth: 8 }),
  );
}

function buildFictional(): void {
  const defs: {
    id: string;
    name: LocalizedName;
    category: MapCategory;
    gen: Parameters<typeof generateMapData>[0];
  }[] = [
    {
      id: 'pangaea',
      name: { fr: 'Pangée', en: 'Pangaea' },
      category: 'fictional',
      gen: {
        seed: 1912,
        width: 1600,
        height: 1000,
        landRatio: 0.5,
        islands: 0.1,
        mountains: 0.55,
        rivers: 0.7,
        shape: 'pangaea',
        nations: 50,
      },
    },
    {
      id: 'archipelago',
      name: { fr: 'Archipel', en: 'Archipelago' },
      category: 'fictional',
      gen: {
        seed: 7741,
        width: 1400,
        height: 1000,
        landRatio: 0.33,
        islands: 0.95,
        mountains: 0.45,
        rivers: 0.3,
        nations: 40,
        latTop: 35,
        latBottom: -25,
      },
    },
    {
      id: 'two-lakes',
      name: { fr: 'Deux lacs', en: 'Two Lakes' },
      category: 'fictional',
      gen: {
        seed: 2222,
        width: 1100,
        height: 700,
        landRatio: 0.7,
        islands: 0.1,
        mountains: 0.4,
        rivers: 0.6,
        shape: 'twoLakes',
        nations: 24,
        latTop: 56,
        latBottom: 34,
      },
    },
  ];
  for (const d of defs) {
    const t0 = Date.now();
    const out = generateMapData(d.gen);
    out.meta.id = d.id;
    out.meta.name = d.name;
    out.meta.category = d.category;
    out.meta.author = 'Isoline (procedural)';
    writeMap(out.meta, out.terrain, out.elevation);
    console.log(`${d.id.padEnd(14)} ${d.gen.width}×${d.gen.height} ${Date.now() - t0} ms`);
  }
  const lab = generateLabyrinth(4242);
  lab.meta.author = 'Isoline (procedural)';
  writeMap(lab.meta, lab.terrain, lab.elevation);
  console.log(`labyrinth      ${lab.meta.width}×${lab.meta.height}`);
}

function main(): void {
  const only = process.argv[2];
  if (!only || only === 'fictional') buildFictional();
  if (only !== 'fictional') buildAllReal(only);
  writeIndex();
}

function buildAllReal(only: string | undefined): void {
  const data = {
    land: loadGeo('ne_10m_land'),
    islands: loadGeo('ne_10m_minor_islands'),
    lakes: loadGeo('ne_10m_lakes'),
    rivers: loadGeo('ne_10m_rivers_lake_centerlines'),
    glaciers: loadGeo('ne_10m_glaciated_areas'),
    regions: loadGeo('ne_10m_geography_regions_polys'),
    countries: loadGeo('ne_50m_admin_0_countries'),
  };
  for (const def of REAL_MAPS) if (!only || only === def.id) buildReal(def, data);
}

function writeIndex(): void {
  const index = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => {
      const m = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) as MapMeta;
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        width: m.width,
        height: m.height,
        nations: m.nations.length,
      };
    });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
}

main();
