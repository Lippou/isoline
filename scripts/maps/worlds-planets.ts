// Planets & moons (1.5): Mars in the age of its northern ocean, the Moon's near side
// (the maria as seas), Titan and its methane seas, and an ocean world. No offline
// elevation dataset is shipped, so the worlds are drawn from their major landmarks
// at roughly their real coordinates (equirectangular frames) and synthesised like
// the other fictional maps. Names come from the IAU nomenclature (public domain).
import { T } from '../../src/core/map/terrain';
import type { LocalizedName } from '../../src/core/map/gamemap';
import {
  clamp01,
  each,
  ell,
  polyline,
  smoothstep,
  type Ctx,
  type Retouch,
  type Spot,
  type WorldDef,
  type WorldShape,
} from './worlds';

const RAD = Math.PI / 180;

/** Equirectangular frame: tile ↔ (lon, lat). */
function frame(w: number, h: number, lonMin: number, lonMax: number, latMin: number, latMax: number) {
  const ppdX = w / (lonMax - lonMin);
  const ppdY = h / (latMax - latMin);
  return {
    lon: (x: number) => lonMin + (x + 0.5) / ppdX,
    lat: (y: number) => latMax - (y + 0.5) / ppdY,
    x: (lon: number) => (lon - lonMin) * ppdX,
    y: (lat: number) => (latMax - lat) * ppdY,
    ppdX,
    ppdY,
  };
}

/** Linear interpolation in a [x, y] table. */
function table(t: readonly (readonly [number, number])[], v: number): number {
  if (v <= t[0]![0]) return t[0]![1];
  for (let k = 1; k < t.length; k++) {
    const [x1, y1] = t[k]!;
    const [x0, y0] = t[k - 1]!;
    if (v <= x1) return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
  }
  return t[t.length - 1]![1];
}

const gauss = (dx: number, dy: number) => Math.exp(-(dx * dx + dy * dy));

interface Crater {
  lon: number;
  lat: number;
  /** Radius in degrees of latitude. */
  r: number;
  /** Dark, flooded floor (a lake). */
  flooded?: boolean;
}

const masks = (n: number) => ({
  land: new Uint8Array(n),
  lake: new Uint8Array(n),
  mountains: new Uint8Array(n),
  hills: new Uint8Array(n),
  deserts: new Uint8Array(n),
  tundra: new Uint8Array(n),
  glaciers: new Uint8Array(n),
  relief: new Float32Array(n),
  stamp: new Uint8Array(n),
});
type Masks = ReturnType<typeof masks>;

/**
 * Stamps a crater: raised rim (hills, or mountains for the big ones), a lower floor,
 * a central peak on large craters. `cosLat` corrects the longitude scale.
 */
function crater(
  m: Masks,
  c: Ctx,
  f: ReturnType<typeof frame>,
  k: Crater,
  opts: { big: number; floodLake: boolean },
): void {
  const cosLat = Math.max(0.35, Math.cos(k.lat * RAD));
  const rx = (k.r / cosLat) * f.ppdX;
  const ry = k.r * f.ppdY;
  const cx = f.x(k.lon);
  const cy = f.y(k.lat);
  const x0 = Math.max(0, Math.floor(cx - rx * 1.4));
  const x1 = Math.min(c.w - 1, Math.ceil(cx + rx * 1.4));
  const y0 = Math.max(0, Math.floor(cy - ry * 1.4));
  const y1 = Math.min(c.h - 1, Math.ceil(cy + ry * 1.4));
  const rimW = Math.max(0.16, 2.2 / Math.min(rx, ry));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * c.w + x;
      if (!m.land[i]) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + 0.06 * c.noiseC.get(x * 0.15, y * 0.15);
      if (d > 1.35) continue;
      if (Math.abs(d - 1) < rimW) {
        m.stamp[i] = (k.r >= opts.big ? T.Mountain : T.Hills) + 1;
        m.relief[i] = Math.max(m.relief[i]!, 0.12 + 0.08 * Math.min(1, k.r / 3));
      } else if (d < 1 - rimW) {
        m.relief[i] = Math.min(m.relief[i]!, -0.04);
        m.stamp[i] = 0;
        if (k.flooded && opts.floodLake && d < 0.85) {
          m.land[i] = 0;
          m.lake[i] = 1;
        } else if (k.r >= opts.big && d < 0.13) m.stamp[i] = T.Mountain + 1;
        else if (k.r >= opts.big * 0.7 && d < 0.2) m.stamp[i] = T.Hills + 1;
      }
    }
}

// ------------------------------------------------------------------ Mars
const MARS = { w: 1800, h: 760, lon: [-180, 180], lat: [-76, 76] } as const;
// Latitude of the old shoreline (the crustal dichotomy) by longitude.
const DICHOTOMY: [number, number][] = [
  [-180, 2],
  [-150, 8],
  [-128, 20],
  [-100, 36],
  [-80, 44],
  [-62, 22],
  [-48, 16],
  [-32, 14],
  [-12, 30],
  [20, 40],
  [50, 37],
  [72, 26],
  [86, 8],
  [100, 18],
  [128, 10],
  [160, -2],
  [180, 2],
];
const MARS_VOLCANOES: [number, number, number, number][] = [
  // lon, lat, radius (deg), height
  [-134, 18.5, 7.5, 1.0], // Olympus Mons
  [-104.5, 11.8, 3.8, 0.8], // Ascraeus Mons
  [-112.8, 0.8, 3.8, 0.75], // Pavonis Mons
  [-120.5, -8.3, 4.2, 0.8], // Arsia Mons
  [-109, 40.5, 5.5, 0.45], // Alba Mons
  [147, 25, 4, 0.7], // Elysium Mons
  [150.2, 32, 2.2, 0.5], // Hecates Tholus
  [150.4, 19, 2, 0.45], // Albor Tholus
  [-90.8, 13.4, 1.8, 0.45], // Tharsis Tholus
  [106.5, -21.4, 3, 0.4], // Tyrrhenus Mons
];
const VALLES: [number, number][] = [
  [-103, -7],
  [-92, -8],
  [-80, -9.5],
  [-68, -10],
  [-57, -9],
  [-48, -7],
  [-43, -2],
  [-41, 6],
  [-42, 13],
  [-45, 19],
];
const MARS_CRATERS: Crater[] = [
  { lon: 16.7, lat: -2.7, r: 4.5 }, // Schiaparelli
  { lon: 55.6, lat: -14, r: 3.8 }, // Huygens
  { lon: 32, lat: 23.4, r: 3.5 }, // Cassini
  { lon: 61, lat: 21.7, r: 3.2 }, // Antoniadi
  { lon: -158, lat: -40.5, r: 3.4 }, // Newton
  { lon: -169, lat: -49, r: 3.6 }, // Copernicus
  { lon: -81, lat: -52, r: 2.6 }, // Lowell
  { lon: 137.8, lat: -5.4, r: 2.2, flooded: true }, // Gale
  { lon: -27, lat: -40, r: 2.8 }, // Galle
  { lon: 98, lat: -55, r: 2.6 }, // Kepler
];

function mars(c: Ctx): WorldShape {
  const f = frame(c.w, c.h, MARS.lon[0], MARS.lon[1], MARS.lat[0], MARS.lat[1]);
  const m = masks(c.w * c.h);
  const height = new Float32Array(c.w * c.h);
  each(c, (i, _X, _Y, x, y) => {
    const lon = f.lon(x);
    const lat = f.lat(y);
    const nz = c.noise.fbm(x * 0.012, y * 0.012, 5);
    const b = table(DICHOTOMY, lon) + 5 * c.noiseB.fbm(x * 0.006, 3.7, 3);
    let H = 0.55 * Math.tanh((b - lat) / 5);
    H += 0.95 * gauss((lon + 108) / 30, lat / 26); // Tharsis rise
    H += 0.55 * gauss((lon + 110) / 13, (lat - 40) / 10); // Alba
    H += 0.6 * gauss((lon - 147) / 10, (lat - 25) / 9); // Elysium rise
    H -= 1.4 * gauss((lon - 70) / (13 / Math.cos(42 * RAD)) / 1.0, (lat + 42) / 11); // Hellas
    H -= 1.1 * gauss((lon + 43) / (7.5 / Math.cos(50 * RAD)), (lat + 50) / 7); // Argyre
    H -= 0.9 * gauss((lon - 88) / 7, (lat - 13) / 6); // Isidis
    H += 0.12 * nz;
    height[i] = H;
    // Valles Marineris: a flooded rift from Noctis Labyrinthus to the Chryse outflow.
    const [dv, tv] = polyline(lon, lat, VALLES);
    const vw = 0.9 + 0.8 * smoothstep(0.1, 0.6, tv);
    let land = H > 0;
    if (dv < vw + 0.25 * nz) land = false;
    else if (dv < vw + 2.2) m.hills[i] = 1;
    // Noctis Labyrinthus: a maze of troughs at the western end.
    if (Math.hypot(lon + 104, (lat + 7) * 1.4) < 5 && c.noiseC.ridged(x * 0.05, y * 0.05, 3) > 0.86)
      land = false;
    m.land[i] = land ? 1 : 0;
    // The ice cap.
    if (lat < -70.5 + 1.5 * c.noiseB.get(x * 0.02, 5)) m.glaciers[i] = 1;
    else if (lat < -64) m.tundra[i] = 1;
    if (lat > 64) m.tundra[i] = 1;
    m.relief[i] = 0.3 * clamp01(H - 0.15);
    // Basin rims: Hellespontus, Charitum and Nereidum mountains.
    const rh = Math.hypot((lon - 70) * Math.cos(42 * RAD), lat + 42);
    const ra = Math.hypot((lon + 43) * Math.cos(50 * RAD), lat + 50);
    if ((rh > 12.2 && rh < 15 && c.noiseC.fbm(x * 0.03, y * 0.03, 3) > -0.1) || (ra > 7.3 && ra < 9.2))
      m.mountains[i] = 1;
  });
  // Volcanoes: wide shields, mountain cores, calderas.
  each(c, (i, _X, _Y, x, y) => {
    if (!m.land[i]) return;
    const lon = f.lon(x);
    const lat = f.lat(y);
    for (const [vl, vb, r, hgt] of MARS_VOLCANOES) {
      const d = Math.hypot((lon - vl) * Math.cos(vb * RAD), lat - vb) / r;
      if (d > 1.2) continue;
      m.relief[i] = Math.max(m.relief[i]!, 0.45 * hgt * (1 - d * d * 0.7));
      if (d < 0.07)
        m.stamp[i] = T.Hills + 1; // caldera
      else if (d < 0.58) m.stamp[i] = T.Mountain + 1;
      else if (d < 0.88) m.stamp[i] = T.Hills + 1;
    }
  });
  // Craters: named ones, then scattered over the southern highlands.
  const opts = { big: 2.4, floodLake: true };
  for (const k of MARS_CRATERS) crater(m, c, f, k, opts);
  for (let k = 0; k < 140; k++) {
    const lon = c.rng.range(-180, 180);
    const lat = c.rng.range(-62, 30);
    const i = Math.floor(f.y(lat)) * c.w + Math.floor(f.x(lon));
    if (!m.land[i] || height[i]! < 0.3 || m.stamp[i]) continue;
    crater(m, c, f, { lon, lat, r: c.rng.range(0.7, 2.2) }, opts);
  }
  return m;
}

/** Earthly biomes → Martian ground (dust fields, dunes, frost); visual palette 'mars'. */
function marsRetouch({ w, h, terrain, noise }: Retouch): void {
  for (let i = 0; i < w * h; i++) {
    const t = terrain[i]!;
    if (t === T.Forest)
      terrain[i] = noise.get((i % w) * 0.03, Math.floor(i / w) * 0.03) > 0 ? T.Desert : T.Plains;
  }
}

const N = (fr: string, en = fr): LocalizedName => ({ fr, en });
const at = (f: ReturnType<typeof frame>, list: [LocalizedName, number, number][]): Spot[] =>
  list.map(([name, lon, lat]) => ({ x: f.x(lon), y: f.y(lat), name }));

const MARS_NATIONS: [LocalizedName, number, number][] = [
  [N('Tharsis'), -100, 0],
  [N('Arabia', 'Arabia'), 10, 22],
  [N('Elysium'), 140, 12],
  [N('Noachis'), -18, -45],
  [N('Hesperia'), 112, -24],
  [N('Syrtis'), 70, 6],
  [N('Sabaea'), 42, -5],
  [N('Cimmeria'), 150, -35],
  [N('Sirenum'), -150, -42],
  [N('Thaumasia'), -72, -32],
  [N('Olympe', 'Olympus'), -126, 9],
  [N('Daedalia'), -125, -24],
  [N('Memnonia'), -165, -12],
  [N('Margaritifer'), -24, -6],
  [N('Meridiani'), 2, 0],
  [N('Xanthe'), -57, 4],
  [N('Lunae'), -68, 14],
  [N('Tempe'), -73, 38],
  [N('Alba'), -100, 46],
  [N('Tyrrhena'), 95, -10],
  [N('Promethei'), 100, -60],
  [N('Aonia'), -95, -56],
  [N('Hellespontus'), 40, -46],
  [N('Iapygia'), 75, -18],
  [N('Libya'), 92, 2],
  [N('Nereidum'), -58, -40],
  [N('Aeolis'), 150, -5],
  [N('Solis'), -88, -22],
  [N('Malea'), 60, -66],
  [N('Amenthes'), 112, 4],
];

// ------------------------------------------------------------------ Moon
const MOON = { w: 1400, h: 1105, lon: [-95, 95], lat: [-75, 75] } as const;
// lon, lat, radius in longitude / latitude (deg), rotation.
const MARIA: [number, number, number, number, number][] = [
  [-57, 20, 17, 26, 0.2], // Oceanus Procellarum
  [-48, -2, 13, 12, 0], // southern Procellarum
  [-66, 38, 10, 9, 0],
  [-16, 33, 17, 12.5, 0], // Imbrium
  [-36, 45, 7, 5, 0.3], // Sinus Iridum
  [-30, 56, 17, 3.6, 0], // Frigoris
  [2, 57, 16, 3.6, 0],
  [28, 56, 12, 3.4, -0.1],
  [17.5, 28, 9, 8, 0], // Serenitatis
  [31, 8.5, 11, 9, 0.2], // Tranquillitatis
  [23, 3, 7, 5, 0],
  [59, 17, 7.5, 6, 0], // Crisium
  [51, -8, 7.5, 10, 0.1], // Fecunditatis
  [35, -15, 4.8, 4.6, 0], // Nectaris
  [-17, -21, 10, 8, 0], // Nubium
  [-39, -24, 5.5, 5, 0], // Humorum
  [-23, -10, 5, 4.5, 0], // Cognitum
  [-31, 7, 8, 6, 0], // Insularum
  [3.6, 13, 4, 3.5, 0], // Vaporum
  [1, 2, 3, 2.5, 0], // Sinus Medii
  [87, -2, 4, 5, 0], // Smythii
  [86, 13, 3, 4, 0], // Marginis
  [88, -42, 6, 8, 0], // Australe
  [-93, -20, 4.5, 5, 0], // Orientale (on the limb)
  [26, 34, 5, 4, 0], // Lacus Somniorum
  // Narrows joining the basins into one basalt sea (as on the real near side).
  [-36, 30, 8, 6, 0.4],
  [5, 31, 4.5, 3, 0],
  [25, 18, 4, 5, 0],
  [43, 1, 5, 4, 0.5],
  [-27, -15, 5, 4, 0.3],
  [-24, 47, 6, 4, 0],
];
const MOON_RANGES: [number, number][][] = [
  [
    [-13, 15],
    [-6, 19],
    [-2, 24],
    [1, 27],
  ], // Montes Apenninus
  [
    [7, 39],
    [9, 34],
  ], // Montes Caucasus
  [
    [-8, 49],
    [2, 46.5],
  ], // Montes Alpes
  [
    [-28, 14.5],
    [-17, 14],
  ], // Montes Carpatus
  [
    [-40, 46],
    [-32, 49],
  ], // Montes Jura
];
const MOON_CRATERS: [LocalizedName, number, number, number, boolean?][] = [
  [N('Copernic', 'Copernicus'), -20, 9.6, 2.6],
  [N('Tycho'), -11, -43.3, 2.6],
  [N('Clavius'), -14, -58.4, 3.8],
  [N('Ptolémée', 'Ptolemaeus'), -1.8, -9.3, 2.8],
  [N('Platon', 'Plato'), -9.3, 51.6, 2.0, true],
  [N('Grimaldi'), -68, -5.2, 3.0, true],
  [N('Petavius'), 60.4, -25.3, 2.8],
  [N('Langrenus'), 61, -9, 2.4],
  [N('Théophile', 'Theophilus'), 26.4, -11.4, 2.0],
  [N('Albategnius'), 4, -11.2, 2.2],
  [N('Maginus'), -6, -50.5, 2.8],
  [N('Schickard'), -54.6, -44.4, 3.5],
  [N('Archimède', 'Archimedes'), -4, 29.7, 1.6],
  [N('Ératosthène', 'Eratosthenes'), -11.3, 14.5, 1.4],
  [N('Gassendi'), -40, -17.5, 1.9],
  [N('Longomontanus'), -21.8, -49.6, 2.6],
  [N('Janssen'), 40.8, -45.4, 3.4],
  [N('Stöfler'), 6, -41, 2.6],
  [N('Hévélius', 'Hevelius'), -67.6, 2.2, 2.2],
  [N('Endymion'), 56.5, 53.6, 2.3, true],
  [N('Maurolycus'), 14, -42, 2.4],
  [N('Posidonius'), 29.9, 31.8, 1.8],
  [N('Hipparque', 'Hipparchus'), 5, -5, 2.4],
  [N('Walther'), 1, -33, 2.3],
  [N('Fracastor', 'Fracastorius'), 33, -21, 2.0],
  [N('Kepler'), -38, 8.1, 1.4],
  [N('Deslandres'), -5, -33, 3.2],
  [N('Atlas'), 44.4, 46.7, 1.8],
];

function moon(c: Ctx): WorldShape {
  const f = frame(c.w, c.h, MOON.lon[0], MOON.lon[1], MOON.lat[0], MOON.lat[1]);
  const m = masks(c.w * c.h);
  each(c, (i, _X, _Y, x, y) => {
    const lon = f.lon(x);
    const lat = f.lat(y);
    const nz = c.noise.fbm(x * 0.02, y * 0.02, 5);
    let sea = -1;
    for (const [ml, mb, rl, rb, rot] of MARIA) sea = Math.max(sea, 1 - ell(lon - ml, lat - mb, rl, rb, rot));
    sea += 0.12 * nz + 0.22 * c.noiseC.fbm(x * 0.007 + 13, y * 0.007, 4);
    m.land[i] = sea > 0 ? 0 : 1;
    // Highlands rise away from the maria.
    m.relief[i] = 0.18 * clamp01(-sea * 1.5) + 0.05 * c.noiseB.fbm(x * 0.01, y * 0.01, 4);
    for (const r of MOON_RANGES) {
      const [d] = polyline(lon, lat, r);
      if (d < 1.1 + 0.4 * nz) {
        m.mountains[i] = 1;
        if (m.land[i] && d < 0.7) m.stamp[i] = T.Mountain + 1;
      }
    }
  });
  const opts = { big: 2.3, floodLake: true };
  for (const [, lon, lat, r, flooded] of MOON_CRATERS)
    crater(m, c, f, { lon, lat, r, flooded: !!flooded }, opts);
  for (let k = 0; k < 380; k++) {
    const lon = c.rng.range(-92, 92);
    const lat = c.rng.range(-73, 73);
    const i = Math.floor(f.y(lat)) * c.w + Math.floor(f.x(lon));
    if (!m.land[i] || m.stamp[i]) continue;
    crater(m, c, f, { lon, lat, r: c.rng.range(0.5, 1.8) }, opts);
  }
  return m;
}

function moonRetouch({ w, h, terrain }: Retouch): void {
  for (let i = 0; i < w * h; i++) {
    const t = terrain[i]!;
    if (t === T.Forest || t === T.Tundra) terrain[i] = T.Desert;
    else if (t === T.River) terrain[i] = T.Plains;
  }
}

// ------------------------------------------------------------------ Titan
const TITAN = { w: 1700, h: 732, lon: [-180, 180], lat: [-75, 80] } as const;
const TITAN_SEAS: [number, number, number, number, number][] = [
  [-30, 69, 24, 6.5, 0.1], // Kraken Mare
  [6, 73, 17, 5, -0.15],
  [-55, 63, 11, 4.5, 0.3],
  [18, 65, 8, 4, 0],
  [-100, 77, 15, 4.5, 0], // Ligeia Mare
  [-82, 75, 9, 4, 0.2],
  [-150, 78, 12, 3.2, 0], // Punga Mare
  [176, -71, 7, 3, 0], // Ontario Lacus
];
const TITAN_STRAITS: [number, number][][] = [
  [
    [-56, 66],
    [-68, 72],
    [-84, 75],
  ], // Trevize Fretum (Kraken ↔ Ligeia)
  [
    [-112, 78],
    [-128, 79],
    [-142, 78.5],
  ], // Ligeia ↔ Punga
];

function titan(c: Ctx): WorldShape {
  const f = frame(c.w, c.h, TITAN.lon[0], TITAN.lon[1], TITAN.lat[0], TITAN.lat[1]);
  const m = masks(c.w * c.h);
  each(c, (i, _X, _Y, x, y) => {
    const lon = f.lon(x);
    const lat = f.lat(y);
    const nz = c.noise.fbm(x * 0.015, y * 0.015, 5);
    let sea = -1;
    for (const [sl, sb, rl, rb, rot] of TITAN_SEAS)
      sea = Math.max(sea, 1 - ell(lon - sl, lat - sb, rl, rb, rot));
    sea += 0.18 * nz;
    for (const s of TITAN_STRAITS) {
      const [d] = polyline(lon, lat, s);
      if (d < 1.0) sea = Math.max(sea, 0.05);
    }
    // Lake districts around the poles.
    if (Math.abs(lat) > 58 && c.noiseC.fbm(x * 0.05, y * 0.05, 3) > 0.42 + (lat < 0 ? 0.06 : 0)) {
      m.lake[i] = 1;
      sea = Math.max(sea, 0.01);
    }
    m.land[i] = sea > 0 ? 0 : 1;
    // Xanadu: bright, rugged highlands.
    const xa = 1 - ell(lon + 100, lat + 10, 26, 16, 0.2) + 0.25 * nz;
    if (xa > 0) {
      m.hills[i] = 1;
      m.relief[i] = 0.22 * clamp01(xa * 2);
      if (c.noiseB.ridged(x * 0.03, y * 0.03, 4) > 0.82) m.mountains[i] = 1;
    }
    // Equatorial dune seas.
    if (Math.abs(lat) < 28 && xa < -0.1 && c.noiseB.fbm(x * 0.008 + 9, y * 0.02, 4) > -0.25) m.deserts[i] = 1;
    if (Math.abs(lat) > 52) m.tundra[i] = 1;
  });
  const opts = { big: 2.0, floodLake: false };
  for (const k of [
    { lon: -87, lat: 20, r: 4.2 }, // Menrva
    { lon: -16, lat: 11, r: 1.6 }, // Sinlap
    { lon: 161, lat: 7, r: 1.6 }, // Selk
    { lon: -65, lat: 14, r: 0.9 }, // Ksa
    { lon: 120, lat: 30, r: 1.4 }, // Afekan
  ])
    crater(m, c, f, k, opts);
  // Doom Mons and Sotra Patera: cryovolcanoes.
  each(c, (i, _X, _Y, x, y) => {
    const d = Math.hypot((f.lon(x) + 40) * 0.95, f.lat(y) + 15);
    if (d < 3.2 && m.land[i]) {
      m.relief[i] = Math.max(m.relief[i]!, 0.3 * (1 - d / 3.2));
      if (d < 1.8 && d > 0.5) m.stamp[i] = T.Mountain + 1;
    }
  });
  return m;
}

function titanRetouch({ w, h, terrain }: Retouch): void {
  for (let i = 0; i < w * h; i++) if (terrain[i] === T.Forest) terrain[i] = T.Plains;
}

const TITAN_NATIONS: [LocalizedName, number, number][] = [
  [N('Xanadu'), -100, -8],
  [N('Shangri-La'), -160, -5],
  [N('Adiri'), 150, -10],
  [N('Belet'), 105, -6],
  [N('Fensal'), -30, 10],
  [N('Aztlan'), -10, -14],
  [N('Senkyo'), 25, -6],
  [N('Dilmun'), -175, 18],
  [N('Tui'), -125, -28],
  [N('Hotei'), -78, -27],
  [N('Quivira'), -55, 2],
  [N('Tsegihi'), -15, -40],
  [N('Mezzoramia'), 60, -70],
  [N('Ching-tu'), 70, 30],
  [N('Tollan'), 40, 38],
  [N('Menrva'), -87, 30],
  [N('Sinlap'), -5, 22],
  [N('Selk'), 165, 18],
  [N('Afekan'), 120, 40],
  [N('Aaru'), 20, 20],
  [N('Eir'), -150, 35],
  [N('Sotra'), -45, -24],
  [N('Hano'), 145, -42],
  [N('Omacatl'), -120, 30],
  [N('Bazaruto'), 80, -32],
  [N('Mindanao'), -60, 48],
  [N('Vid'), -100, 64],
  [N('Gabes'), 10, 52],
];

// ------------------------------------------------------------------ ocean world
function oceanWorld(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const { rng } = c;
  type Isle = [number, number, number, number]; // X, Y, radius, kind (0 volcanic, 1 atoll)
  const isles: Isle[] = [];
  // Island arcs: chains of volcanic islands along gentle curves.
  const arcs: [number, number, number, number, number][] = [
    // centre X, centre Y, radius, start angle, end angle
    [-0.62, -0.5, 0.42, 0.2, 1.35],
    [0.7, 0.55, 0.45, -2.9, -1.6],
    [0.15, -0.75, 0.48, 1.1, 2.15],
    [-0.3, 0.75, 0.42, -1.25, -0.25],
  ];
  for (const [cx, cy, R, a0, a1] of arcs)
    for (let k = 0; k < 7; k++) {
      const a = a0 + ((a1 - a0) * (k + rng.range(-0.15, 0.15))) / 6;
      isles.push([cx + R * Math.cos(a), cy + R * Math.sin(a), rng.range(0.036, 0.056), 0]);
    }
  // Two big volcanic islands and a hotspot chain fading away.
  isles.push([-0.05, -0.05, 0.11, 0], [0.42, -0.12, 0.085, 0]);
  for (let k = 0; k < 5; k++) isles.push([-0.42 - k * 0.075, 0.08 + k * 0.035, 0.06 - k * 0.006, 0]);
  // Giant atolls.
  isles.push([0.2, 0.3, 0.1, 1], [-0.62, -0.3, 0.085, 1], [0.66, -0.36, 0.08, 1]);
  each(c, (i, X, Y, x, y) => {
    const nz = c.noise.fbm(x * 0.012, y * 0.012, 5);
    let v = -1;
    let peak = 0;
    for (const [ix, iy, r, kind] of isles) {
      const d = Math.hypot(X - ix, Y - iy) / r + 0.25 * nz;
      if (kind === 1) {
        // Ring reef with three passes.
        const a = Math.atan2(Y - iy, X - ix);
        const pass = [0.4, 2.5, 4.3].some(
          (p) => Math.abs(((a - p + 7 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.1,
        );
        const ring = 0.22 - Math.abs(d - 0.82);
        if (!pass) v = Math.max(v, ring);
      } else {
        v = Math.max(v, 1 - d);
        peak = Math.max(peak, clamp01(1 - d * 1.6));
      }
    }
    m.land[i] = v > 0 ? 1 : 0;
    m.relief[i] = 0.4 * peak * peak;
    if (peak > 0.62) m.mountains[i] = 1;
  });
  return m;
}

export const PLANETS: WorldDef[] = [
  {
    id: 'mars',
    name: { fr: 'Mars', en: 'Mars' },
    desc: {
      fr: 'Mars au temps de son océan boréal : Olympus Mons, Valles Marineris inondée, Hellas.',
      en: 'Mars in the age of its northern ocean: Olympus Mons, a flooded Valles Marineris, Hellas.',
    },
    category: 'planets',
    palette: 'mars',
    seed: 7101,
    width: MARS.w,
    height: MARS.h,
    pxKm: 11.8,
    mountains: 0.15,
    rivers: 0.2,
    latTop: MARS.lat[1],
    latBottom: MARS.lat[0],
    moistureBias: -0.15,
    shape: mars,
    retouch: marsRetouch,
    nations: 30,
    spots: () => at(frame(MARS.w, MARS.h, MARS.lon[0], MARS.lon[1], MARS.lat[0], MARS.lat[1]), MARS_NATIONS),
  },
  {
    id: 'moon',
    name: { fr: 'La Lune', en: 'The Moon' },
    desc: {
      fr: 'La face visible : les mers de basalte se traversent en bateau, les cratères font des forteresses.',
      en: 'The near side: basalt seas are crossed by boat, craters make fortresses.',
    },
    category: 'planets',
    palette: 'moon',
    seed: 7202,
    width: MOON.w,
    height: MOON.h,
    pxKm: 4.1,
    mountains: 0,
    rivers: 0,
    latTop: 30,
    latBottom: 30,
    moistureBias: -0.2,
    shape: moon,
    retouch: moonRetouch,
    nations: 28,
    spots: () =>
      at(
        frame(MOON.w, MOON.h, MOON.lon[0], MOON.lon[1], MOON.lat[0], MOON.lat[1]),
        MOON_CRATERS.map(([name, lon, lat]) => [name, lon, lat]),
      ),
  },
  {
    id: 'titan',
    name: { fr: 'Titan', en: 'Titan' },
    desc: {
      fr: 'La lune orange de Saturne : mers de méthane au nord, champs de dunes, hauts plateaux de Xanadu.',
      en: "Saturn's orange moon: methane seas in the north, dune fields, the Xanadu highlands.",
    },
    category: 'planets',
    palette: 'titan',
    seed: 7303,
    width: TITAN.w,
    height: TITAN.h,
    pxKm: 9.5,
    mountains: 0.1,
    rivers: 0.3,
    latTop: TITAN.lat[1],
    latBottom: TITAN.lat[0],
    shape: titan,
    retouch: titanRetouch,
    nations: 28,
    spots: () =>
      at(frame(TITAN.w, TITAN.h, TITAN.lon[0], TITAN.lon[1], TITAN.lat[0], TITAN.lat[1]), TITAN_NATIONS),
  },
  {
    id: 'ocean-world',
    name: { fr: 'Océanide', en: 'Oceanid' },
    desc: {
      fr: 'Une planète-océan : arcs d’îles volcaniques, atolls géants à lagon et deux grandes îles.',
      en: 'An ocean planet: volcanic island arcs, giant lagoon atolls and two great islands.',
    },
    category: 'planets',
    seed: 7404,
    width: 1500,
    height: 1000,
    mountains: 0.2,
    rivers: 0.35,
    latTop: 22,
    latBottom: -22,
    shape: oceanWorld,
    nations: 30,
  },
];
