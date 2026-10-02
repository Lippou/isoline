// Myths & legends (1.5): original maps drawn from public-domain myths and folklore —
// Plato's Atlantis, the nine realms of the Norse world tree, the Olympian archipelago,
// a dragon-shaped continent and a sea of buccaneers. No copyrighted map or name is used.
import { T } from '../../src/core/map/terrain';
import type { LocalizedName } from '../../src/core/map/gamemap';
import {
  angDist,
  each,
  ell,
  polyline,
  segment,
  smoothstep,
  type Ctx,
  type Retouch,
  type Spot,
  type WorldDef,
  type WorldShape,
} from './worlds';

const N = (fr: string, en = fr): LocalizedName => ({ fr, en });

const masks = (n: number) => ({
  land: new Uint8Array(n),
  lake: new Uint8Array(n),
  mountains: new Uint8Array(n),
  hills: new Uint8Array(n),
  deserts: new Uint8Array(n),
  tundra: new Uint8Array(n),
  glaciers: new Uint8Array(n),
  relief: new Float32Array(n),
  ridgeBias: new Float32Array(n),
  rivers: new Uint8Array(n),
  stamp: new Uint8Array(n),
});

/** Spots given in normalised coordinates (units of the map height, centred). */
const spotsAt =
  (list: [LocalizedName, number, number][]) =>
  (r: Retouch): Spot[] =>
    list.map(([name, X, Y]) => ({ x: (r.w - 1) / 2 + X * r.h, y: (r.h - 1) / 2 + Y * r.h, name }));

/** Point in polygon (even-odd). */
function inPoly(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
    const [xa, ya] = poly[k]!;
    const [xb, yb] = poly[j]!;
    if (ya > y !== yb > y && x < xa + ((y - ya) * (xb - xa)) / (yb - ya)) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ Atlantis
const CITY = { x: 0, y: 0.27 };
// Concentric rings of Plato's Critias: acropolis, water, land, water, land, water.
const RINGS = [0.03, 0.046, 0.071, 0.087, 0.116, 0.133];

function atlantis(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const isles: [number, number, number][] = [
    [-0.6, -0.36, 0.05],
    [-0.63, 0.08, 0.045],
    [-0.56, 0.4, 0.042],
    [0.5, -0.42, 0.04],
    [0.36, 0.45, 0.032],
  ];
  each(c, (i, X, Y, x, y) => {
    const nz = c.noise.fbm(x * 0.006, y * 0.006, 5);
    let v = 1 - ell(X, Y - 0.02, 0.5, 0.4) + 0.12 * nz + 0.05 * c.noiseB.fbm(x * 0.02, y * 0.02, 4);
    for (const [ix, iy, r] of isles) v = Math.max(v, 1 - Math.hypot(X - ix, Y - iy) / r + 0.2 * nz);
    // The Pillars of Heracles: two mainland capes on the eastern edge, a strait between.
    const halfW = (c.w - 1) / 2 / c.h;
    if (X > halfW - 0.07 + 0.03 * nz && Math.abs(Y) > 0.05) v = Math.max(v, 0.2);
    // The sea canal from the outer ring to the southern sea.
    const rc = Math.hypot(X - CITY.x, Y - CITY.y);
    if (Math.abs(X - CITY.x) < 0.011 && Y > CITY.y + RINGS[4]!) v = Math.min(v, -0.1);
    // The city rings: water rings are crossed by three bridges (north, east, west) and pierced
    // by the ship channel to the south.
    const a = Math.atan2(Y - CITY.y, X - CITY.x);
    const bridge = [-Math.PI / 2, 0, Math.PI].some((b) => angDist(a, b) * rc < 0.012);
    const channel = Math.abs(X - CITY.x) < 0.008 && Y > CITY.y;
    const waterRing =
      (rc > RINGS[0]! && rc < RINGS[1]!) ||
      (rc > RINGS[2]! && rc < RINGS[3]!) ||
      (rc > RINGS[4]! && rc < RINGS[5]!);
    if (rc < RINGS[5]!) {
      v = waterRing && !bridge ? -0.1 : channel ? -0.1 : 0.2;
    }
    m.land[i] = v > 0 ? 1 : 0;
    // Mountains sheltering the north of the island.
    m.ridgeBias[i] = 0.35 * smoothstep(-0.1, -0.3, Y);
    m.relief[i] = 0.18 * smoothstep(-0.12, -0.32, Y);
    // The great plain: flat, ringed by a ditch and crossed by canals (river tiles).
    if (Math.abs(X) < 0.36 && Y > -0.16 && Y < 0.12) {
      m.relief[i] = 0;
      m.ridgeBias[i] = -1;
      const ex = Math.abs(Math.abs(X) - 0.36) * c.h;
      const ey = Math.min(Math.abs(Y + 0.16), Math.abs(Y - 0.12)) * c.h;
      const grid = [-0.24, -0.12, 0, 0.12, 0.24].some((g) => Math.abs(X - g) * c.h < 1.3);
      if (ex < 1.6 || ey < 1.6 || grid || Math.abs(Y + 0.02) * c.h < 1.3) m.rivers[i] = 1;
      else m.stamp[i] = (c.noiseC.fbm(x * 0.015, y * 0.015, 3) > 0.3 ? T.Forest : T.Plains) + 1;
    }
    // The acropolis hill.
    if (rc < RINGS[0]!) m.stamp[i] = T.Hills + 1;
    else if (rc < RINGS[5]!) m.stamp[i] = T.Plains + 1;
  });
  return m;
}

const ATLANTIS_NATIONS: [LocalizedName, number, number][] = [
  [N('Atlas'), 0, 0.27],
  [N('Gadir', 'Gadeirus'), 0.42, -0.04],
  [N('Amphérès', 'Ampheres'), -0.24, -0.05],
  [N('Évémon', 'Evaemon'), 0.24, -0.05],
  [N('Mnésée', 'Mneseus'), -0.1, -0.1],
  [N('Autochthon'), 0.1, 0.06],
  [N('Élasippe', 'Elasippus'), -0.36, 0.24],
  [N('Mestor'), 0.36, 0.24],
  [N('Azaès', 'Azaes'), -0.3, -0.29],
  [N('Diaprépès', 'Diaprepes'), 0.3, -0.29],
  [N('Clito', 'Cleito'), 0, -0.3],
  [N('Évenor', 'Evenor'), -0.44, -0.08],
  [N('Leucippe'), 0.46, 0.1],
  [N('Poséidonie', 'Poseidonia'), -0.19, 0.3],
  [N('Orichalque', 'Orichalcum'), 0.19, 0.3],
  [N('Hespérie', 'Hesperia'), -0.6, -0.36],
  [N('Érythie', 'Erytheia'), -0.63, 0.08],
  [N('Îles Fortunées', 'Fortunate Isles'), -0.56, 0.4],
  [N('Cerné', 'Cerne'), 0.5, -0.42],
  [N('Ibérie', 'Iberia'), 0.64, -0.3],
  [N('Libye', 'Libya'), 0.64, 0.3],
];

// ------------------------------------------------------------------ the nine realms
type Realm = { key: string; X: number; Y: number; rx: number; ry: number };
const REALMS: Realm[] = [
  { key: 'asgard', X: 0, Y: -0.37, rx: 0.16, ry: 0.09 },
  { key: 'vanaheim', X: -0.31, Y: -0.23, rx: 0.1, ry: 0.085 },
  { key: 'alfheim', X: 0.31, Y: -0.23, rx: 0.1, ry: 0.085 },
  { key: 'midgard', X: 0, Y: -0.02, rx: 0.165, ry: 0.125 },
  { key: 'jotunheim', X: -0.32, Y: 0.03, rx: 0.095, ry: 0.115 },
  { key: 'svartalfheim', X: 0.32, Y: 0.03, rx: 0.095, ry: 0.115 },
  { key: 'niflheim', X: -0.27, Y: 0.31, rx: 0.12, ry: 0.095 },
  { key: 'muspelheim', X: 0.27, Y: 0.31, rx: 0.12, ry: 0.095 },
  { key: 'helheim', X: 0, Y: 0.39, rx: 0.13, ry: 0.075 },
];
// Branches and roots of the world tree (land bridges), and Bifröst.
const BRANCHES: [number, number, number, number, number][] = [
  [0, -0.15, 0, -0.28, 0.009], // Bifröst
  [-0.1, -0.11, -0.25, -0.19, 0.014],
  [0.1, -0.11, 0.25, -0.19, 0.014],
  [-0.15, 0.02, -0.24, 0.02, 0.016],
  [0.15, 0.02, 0.24, 0.02, 0.016],
  [0, 0.1, 0, 0.32, 0.02], // the trunk down to Hel
  [-0.08, 0.09, -0.2, 0.24, 0.014],
  [0.08, 0.09, 0.2, 0.24, 0.014],
];

function realmOf(c: Ctx, X: number, Y: number, x: number, y: number): [number, number] {
  const nz = c.noise.fbm(x * 0.008, y * 0.008, 5);
  let best = -1;
  let bv = -Infinity;
  for (const [k, r] of REALMS.entries()) {
    const v = 1 - ell(X - r.X, Y - r.Y, r.rx, r.ry) + 0.22 * nz;
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  return [best, bv];
}

function nineRealms(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  each(c, (i, X, Y, x, y) => {
    const [k, v] = realmOf(c, X, Y, x, y);
    let land = v > 0;
    let branch = Infinity;
    for (const [ax, ay, bx, by, hw] of BRANCHES) {
      const [d] = segment(X, Y, ax, ay, bx, by);
      branch = Math.min(branch, d / hw);
    }
    if (branch < 1) land = true;
    m.land[i] = land ? 1 : 0;
    if (!land) return;
    const key = v > 0 ? REALMS[k]!.key : 'branch';
    const r = REALMS[k]!;
    const rr = ell(X - r.X, Y - r.Y, r.rx, r.ry);
    const rid = c.noiseB.ridged(x * 0.012, y * 0.012, 4);
    switch (key) {
      case 'asgard': {
        // The walls of Asgard: a ring of mountains with one gate, facing Bifröst.
        const a = Math.atan2(Y - r.Y, (X - r.X) * (r.ry / r.rx));
        if (Math.abs(rr - 0.55) < 0.07 && angDist(a, Math.PI / 2) > 0.22) m.stamp[i] = T.Mountain + 1;
        else if (rr < 0.48) m.stamp[i] = T.Plains + 1;
        break;
      }
      case 'jotunheim':
        m.relief[i] = 0.25 * rid;
        if (rid > 0.72) m.mountains[i] = 1;
        m.tundra[i] = rid > 0.5 ? 1 : 0;
        break;
      case 'svartalfheim':
        m.hills[i] = 1;
        if (rid > 0.76) m.mountains[i] = 1;
        break;
      case 'niflheim':
        m.tundra[i] = 1;
        if (rr < 0.45) m.glaciers[i] = 1;
        break;
      case 'muspelheim':
        m.deserts[i] = 1;
        if (rid > 0.78) m.stamp[i] = T.Mountain + 1;
        if (rr < 0.12) m.stamp[i] = T.Impassable + 1; // the fire of Surtr
        break;
      case 'helheim':
        m.tundra[i] = 1;
        m.hills[i] = rid > 0.6 ? 1 : 0;
        break;
      case 'vanaheim':
      case 'alfheim':
        if (c.noiseC.fbm(x * 0.02, y * 0.02, 3) > -0.15) m.stamp[i] = T.Forest + 1;
        break;
      case 'branch':
        m.stamp[i] = (Y < -0.15 && Math.abs(X) < 0.012 ? T.Plains : T.Forest) + 1; // Bifröst / branches
        break;
      default:
        // Midgard: a natural land with a central lake (the eye of the world tree).
        if (rr < 0.16) {
          m.land[i] = 0;
          m.lake[i] = 1;
        }
    }
  });
  return m;
}

const NINE_NATIONS: [LocalizedName, number, number][] = [
  [N('Midgard'), -0.08, -0.06],
  [N('Asgard'), 0, -0.37],
  [N('Jotunheim'), -0.32, 0.0],
  [N('Muspelheim'), 0.24, 0.27],
  [N('Niflheim'), -0.24, 0.27],
  [N('Vanaheim'), -0.31, -0.23],
  [N('Alfheim'), 0.31, -0.23],
  [N('Svartalfheim'), 0.32, 0.0],
  [N('Helheim'), 0, 0.39],
  [N('Mannheim'), 0.08, 0.04],
  [N('Valhöll', 'Valhalla'), -0.1, -0.39],
  [N('Bilskirnir'), 0.1, -0.39],
  [N('Utgard'), -0.32, 0.1],
  [N('Nidavellir'), 0.32, 0.1],
  [N('Nóatún', 'Noatun'), -0.36, -0.2],
  [N('Gimlé', 'Gimle'), 0.36, -0.2],
  [N('Hvergelmir'), -0.32, 0.34],
  [N('Forge de Surt', "Surtr's Forge"), 0.33, 0.34],
  [N('Nástrond', 'Nastrond'), -0.08, 0.4],
  [N('Gjallarbrú', 'Gjallarbru'), 0.08, 0.4],
  [N('Vígríd', 'Vigrid'), 0.1, -0.08],
  [N('Járnvid', 'Ironwood'), -0.08, 0.06],
  [N('Thrymheim'), -0.3, -0.06],
  [N('Fólkvangr', 'Folkvangr'), -0.26, -0.26],
  [N('Breidablik'), 0.0, -0.34],
];

// ------------------------------------------------------------------ Olympian archipelago
function olympus(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const isles: [number, number, number][] = [];
  // Cyclades: a ring of islands around the sacred mountain.
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * 2 * Math.PI + 0.2;
    isles.push([0.02 + 0.29 * Math.cos(a), -0.04 + 0.24 * Math.sin(a), c.rng.range(0.03, 0.042)]);
  }
  isles.push(
    [0.24, -0.43, 0.04], // Lemnos
    [0.06, -0.45, 0.034], // Samothrace
    [0.43, 0.38, 0.04], // Rhodes
    [-0.6, 0.43, 0.04], // Ogygia
    [-0.36, 0.43, 0.04], // Scheria
    [-0.66, 0.2, 0.034], // Ithaca
    [0.62, 0.45, 0.034], // Thrinacia
  );
  each(c, (i, X, Y, x, y) => {
    const nz = c.noise.fbm(x * 0.008, y * 0.008, 5);
    const fine = 0.06 * c.noiseB.fbm(x * 0.03, y * 0.03, 4);
    // Hellas: the western mainland with a Peloponnese.
    let v = -0.42 + 0.06 * Math.sin(Y * 9) - X + 0.12 * nz;
    if (Y > 0.22) v = Math.min(v, 0.22 - Y + 0.1 * nz);
    v = Math.max(v, 1 - ell(X + 0.48, Y - 0.28, 0.1, 0.085) + 0.3 * nz);
    // Anatolia: the eastern mainland, Troy in the north.
    v = Math.max(v, X - 0.5 + 0.05 * Math.sin(Y * 7 + 1) + 0.12 * nz);
    // Olympus, Crete and the isles.
    v = Math.max(v, 1 - ell(X - 0.02, Y + 0.04, 0.15, 0.115) + 0.25 * nz);
    v = Math.max(v, 1 - ell(X - 0.0, Y - 0.34, 0.22, 0.045, -0.05) + 0.25 * nz);
    for (const [ix, iy, r] of isles) v = Math.max(v, 1 - Math.hypot(X - ix, Y - iy) / r + 0.3 * nz);
    v += fine;
    m.land[i] = v > 0 ? 1 : 0;
    // The sacred mountain: a massif whose summit is the unreachable throne of the gods.
    const ro = Math.hypot(X - 0.02, Y + 0.04);
    if (ro < 0.075) {
      m.relief[i] = 0.4 * (1 - ro / 0.075);
      m.mountains[i] = 1;
      if (ro < 0.02) m.stamp[i] = T.Impassable + 1;
    }
    m.ridgeBias[i] = 0.15 * smoothstep(0.2, 0.05, Math.abs(X + 0.6));
  });
  return m;
}

const OLYMPUS_NATIONS: [LocalizedName, number, number][] = [
  [N('Olympe', 'Olympus'), 0.1, -0.02],
  [N('Athènes', 'Athens'), -0.5, 0.08],
  [N('Sparte', 'Sparta'), -0.5, 0.3],
  [N('Troie', 'Troy'), 0.62, -0.38],
  [N('Crète', 'Crete'), -0.12, 0.34],
  [N('Mycènes', 'Mycenae'), -0.6, 0.24],
  [N('Thèbes', 'Thebes'), -0.58, -0.06],
  [N('Delphes', 'Delphi'), -0.6, -0.2],
  [N('Thessalie', 'Thessaly'), -0.56, -0.38],
  [N('Lydie', 'Lydia'), 0.62, -0.12],
  [N('Carie', 'Caria'), 0.62, 0.14],
  [N('Ionie', 'Ionia'), 0.58, 0.3],
  [N('Cnossos', 'Knossos'), 0.14, 0.34],
  [N('Délos', 'Delos'), 0.31, -0.04],
  [N('Naxos'), 0.24, 0.13],
  [N('Lemnos'), 0.24, -0.43],
  [N('Samothrace'), 0.06, -0.45],
  [N('Lesbos'), 0.24, -0.22],
  [N('Rhodes'), 0.43, 0.38],
  [N('Ithaque', 'Ithaca'), -0.66, 0.2],
  [N('Ogygie', 'Ogygia'), -0.6, 0.43],
  [N('Schérie', 'Scheria'), -0.36, 0.43],
  [N('Éa', 'Aeaea'), -0.24, 0.12],
  [N('Thrinacie', 'Thrinacia'), 0.62, 0.45],
  [N('Cythère', 'Kythira'), -0.24, -0.2],
  [N('Argos'), -0.44, 0.2],
];

// ------------------------------------------------------------------ dragon
const SPINE: [number, number][] = [
  [0, -0.45],
  [0, -0.37],
  [0.012, -0.3],
  [0.018, -0.22],
  [0, -0.12],
  [0, 0.02],
  [0, 0.12],
  [-0.02, 0.22],
  [0.03, 0.32],
  [0.14, 0.38],
  [0.26, 0.36],
  [0.31, 0.29],
  [0.27, 0.23],
];
// Half-width along the spine (position 0 … 1).
const GIRTH: [number, number][] = [
  [0, 0.022],
  [0.06, 0.055],
  [0.12, 0.035],
  [0.22, 0.04],
  [0.33, 0.08],
  [0.45, 0.085],
  [0.52, 0.065],
  [0.62, 0.04],
  [0.8, 0.026],
  [1, 0.012],
];
const lerpTable = (t: readonly (readonly [number, number])[], v: number): number => {
  for (let k = 1; k < t.length; k++)
    if (v <= t[k]![0]) {
      const [x0, y0] = t[k - 1]!;
      const [x1, y1] = t[k]!;
      return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
    }
  return t[t.length - 1]![1];
};
// Left wing (the right one is its mirror): shoulder, elbow, wrist, finger tips, flank.
const WING: [number, number][] = [
  [-0.05, -0.15],
  [-0.27, -0.31],
  [-0.5, -0.37],
  [-0.73, -0.2],
  [-0.69, 0.0],
  [-0.56, 0.11],
  [-0.32, 0.07],
  [-0.06, -0.03],
];

function dragon(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const wrist = WING[2]!;
  const tips = WING.slice(3, 7);
  each(c, (i, X, Y, x, y) => {
    const nz = c.noise.fbm(x * 0.01, y * 0.01, 5);
    const jag = 0.008 * nz;
    const [ds, ts] = polyline(X, Y, SPINE);
    let land = ds < lerpTable(GIRTH, ts) + jag;
    // Horns.
    for (const s of [-1, 1]) {
      const [dh, th] = segment(X, Y, s * 0.025, -0.38, s * 0.1, -0.47);
      if (dh < 0.014 * (1 - th) + 0.004) land = true;
    }
    // Wings: a membrane between the bones, scalloped between the finger tips.
    const wx = -Math.abs(X);
    if (inPoly(wx, Y, WING)) {
      land = true;
      const edge = [...tips, WING[7]!];
      for (let k = 0; k + 1 < edge.length; k++) {
        const [ax, ay] = edge[k]!;
        const [bx, by] = edge[k + 1]!;
        const mx = (ax + bx) / 2 + (wrist[0] - (ax + bx) / 2) * 0.16;
        const my = (ay + by) / 2 + (wrist[1] - (ay + by) / 2) * 0.16;
        if (Math.hypot(wx - mx, Y - my) < 0.36 * Math.hypot(ax - bx, ay - by) + jag) land = false;
      }
    }
    // Bones: arm and fingers are mountain ridges (with passes), crossing the membrane.
    const bones: [number, number, number, number][] = [
      [WING[0]![0], WING[0]![1], WING[1]![0], WING[1]![1]],
      [WING[1]![0], WING[1]![1], wrist[0], wrist[1]],
      ...tips.map(([tx, ty]) => [wrist[0], wrist[1], tx, ty] as [number, number, number, number]),
    ];
    for (const [ax, ay, bx, by] of bones) {
      const [db, tb] = segment(wx, Y, ax, ay, bx, by);
      if (db < 0.012 && (tb < 0.4 || tb > 0.55)) {
        land = true;
        m.mountains[i] = 1;
        m.relief[i] = Math.max(m.relief[i]!, 0.25 * (1 - db / 0.012));
      }
    }
    // Hind legs and talons.
    for (const s of [-1, 1]) {
      const leg: [number, number][] = [
        [s * 0.05, 0.1],
        [s * 0.13, 0.16],
        [s * 0.15, 0.21],
      ];
      const [dl] = polyline(X, Y, leg);
      if (dl < 0.024 + jag) land = true;
      for (const tx of [-0.035, 0, 0.035]) {
        const [dt, tt] = segment(X, Y, s * 0.15, 0.21, s * (0.15 + tx), 0.255);
        if (dt < 0.009 * (1 - tt) + 0.002) land = true;
      }
    }
    // Tail tip: islets continuing the curl.
    for (const [ix, iy, r] of [
      [0.21, 0.205, 0.012],
      [0.17, 0.215, 0.009],
    ] as const)
      if (Math.hypot(X - ix, Y - iy) < r) land = true;
    m.land[i] = land ? 1 : 0;
    // Eyes and heart: lakes.
    for (const [lx, ly, r] of [
      [-0.022, -0.385, 0.008],
      [0.022, -0.385, 0.008],
      [0.0, -0.09, 0.02],
    ] as const)
      if (Math.hypot(X - lx, Y - ly) < r + 0.003 * nz) {
        m.land[i] = 0;
        m.lake[i] = 1;
      }
    // Dorsal crest along the spine (with passes), volcanic head.
    if (
      ds < 0.012 &&
      ts > 0.12 &&
      ts < 0.85 &&
      ![0.3, 0.42, 0.58, 0.72].some((p) => Math.abs(ts - p) < 0.025)
    ) {
      m.mountains[i] = 1;
      m.relief[i] = Math.max(m.relief[i]!, 0.3 * (1 - ds / 0.012));
    }
    if (Y < -0.3 && ds < 0.07) m.deserts[i] = 1;
  });
  return m;
}

const DRAGON_NATIONS: [LocalizedName, number, number][] = [
  [N('La Gueule', 'The Maw'), 0, -0.41],
  [N('Le Cœur', 'The Heart'), 0.04, -0.13],
  [N('Aile du Couchant', 'Sunset Wing'), -0.42, -0.16],
  [N("Aile de l'Aube", 'Dawn Wing'), 0.42, -0.16],
  [N('Le Ventre', 'The Belly'), 0, 0.03],
  [N('La Queue', 'The Tail'), 0.14, 0.37],
  [N('Rémige du Couchant', 'Sunset Pinion'), -0.63, -0.17],
  [N("Rémige de l'Aube", 'Dawn Pinion'), 0.63, -0.17],
  [N('La Nuque', 'The Nape'), 0.015, -0.26],
  [N('Les Reins', 'The Loins'), 0, 0.13],
  [N('Voile Écarlate', 'Scarlet Sail'), -0.56, 0.0],
  [N("Voile d'Ébène", 'Ebony Sail'), 0.56, 0.0],
  [N('Coude du Couchant', 'Sunset Elbow'), -0.27, -0.25],
  [N("Coude de l'Aube", 'Dawn Elbow'), 0.27, -0.25],
  [N("Écailles d'Or", 'Golden Scales'), -0.15, -0.13],
  [N("Écailles d'Argent", 'Silver Scales'), 0.15, -0.13],
  [N('Griffe du Couchant', 'Sunset Talon'), -0.15, 0.2],
  [N("Griffe de l'Aube", 'Dawn Talon'), 0.15, 0.2],
  [N('Le Dard', 'The Sting'), 0.29, 0.31],
  [N('Le Repaire', 'The Lair'), -0.4, 0.04],
  [N('Le Trésor', 'The Hoard'), 0.4, 0.04],
  [N('La Crête', 'The Crest'), -0.03, 0.26],
];

// ------------------------------------------------------------------ buccaneer sea
function pirates(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const halfW = (c.w - 1) / 2 / c.h;
  type Blob = [number, number, number, number, number];
  const big: Blob[] = [
    [-0.3, -0.2, 0.2, 0.065, 0.18], // Grande Tortue
    [0.32, -0.22, 0.11, 0.06, -0.1], // Hispaniole
    [0.14, 0.04, 0.085, 0.07, 0.4], // Treasure Island
    [-0.36, 0.06, 0.07, 0.045, -0.3], // Jamaique-like
  ];
  const cays: [number, number, number][] = [];
  // The outer arc of small islands, from north-east to south-east.
  for (let k = 0; k < 9; k++) {
    const a = -1.25 + (k / 8) * 1.9;
    cays.push([0.42 + 0.3 * Math.cos(a), 0.0 + 0.4 * Math.sin(a), c.rng.range(0.024, 0.036)]);
  }
  // Named cays, then scattered ones.
  cays.push([0.5, -0.1, 0.03], [-0.05, -0.3, 0.032]);
  for (let k = 0; k < 10; k++)
    cays.push([c.rng.range(-0.55, 0.5), c.rng.range(-0.42, 0.2), c.rng.range(0.016, 0.024)]);
  // Coves cut into the big islands.
  const coves: [number, number, number][] = [];
  for (const [bx, by, rx, ry, rot] of big)
    for (let k = 0; k < 3; k++) {
      const a = c.rng.range(-Math.PI, Math.PI);
      const cx = bx + Math.cos(a) * rx * Math.cos(rot) - Math.sin(a) * ry * Math.sin(rot);
      const cy = by + Math.cos(a) * rx * Math.sin(rot) + Math.sin(a) * ry * Math.cos(rot);
      coves.push([cx, cy, c.rng.range(0.014, 0.022)]);
    }
  each(c, (i, X, Y, x, y) => {
    const nz = c.noise.fbm(x * 0.009, y * 0.009, 5);
    const fine = 0.08 * c.noiseB.fbm(x * 0.03, y * 0.03, 4);
    // The Main: a jungle coast along the south and the west.
    let v = Y - 0.3 - 0.05 * Math.sin(X * 6) + 0.1 * nz;
    v = Math.max(v, -X - halfW + 0.13 + 0.05 * Math.sin(Y * 8) + 0.08 * nz);
    for (const [bx, by, rx, ry, rot] of big)
      v = Math.max(v, 1 - ell(X - bx, Y - by, rx, ry, rot) + 0.25 * nz);
    for (const [ix, iy, r] of cays) v = Math.max(v, 1 - Math.hypot(X - ix, Y - iy) / r + 0.3 * nz);
    v += fine;
    for (const [cx, cy, r] of coves) if (Math.hypot(X - cx, Y - cy) < r) v = Math.min(v, -0.05);
    m.land[i] = v > 0 ? 1 : 0;
    // Treasure Island's lagoon and its volcanic peak.
    const rt = Math.hypot(X - 0.16, Y - 0.06);
    if (rt < 0.02) {
      m.land[i] = 0;
      m.lake[i] = 1;
    }
    const rp = Math.hypot(X - 0.1, Y - 0.02);
    if (rp < 0.03) {
      m.mountains[i] = 1;
      m.relief[i] = 0.3 * (1 - rp / 0.03);
    }
  });
  return m;
}

const PIRATE_NATIONS: [LocalizedName, number, number][] = [
  [N('Île au Trésor', 'Treasure Island'), 0.12, 0.08],
  [N('Grande Tortue', 'Great Tortuga'), -0.3, -0.2],
  [N('Port-Royal'), -0.36, 0.06],
  [N('Hispaniole', 'Hispaniola'), 0.32, -0.22],
  [N('Crique du Crâne', 'Skull Cove'), -0.46, -0.24],
  [N('Baie des Requins', 'Shark Bay'), -0.14, -0.16],
  [N('Port-Doublon', 'Doubloon Port'), 0.0, 0.42],
  [N('Récif du Kraken', 'Kraken Reef'), 0.53, -0.37],
  [N('Anse du Rhum', 'Rum Cove'), 0.68, -0.2],
  [N('Fort Sabre', 'Fort Cutlass'), -0.6, 0.36],
  [N('Port-Corsaire', 'Corsair Port'), 0.4, 0.43],
  [N('Île des Naufragés', 'Castaway Isle'), 0.72, 0.05],
  [N('Pointe du Perroquet', 'Parrot Point'), -0.75, -0.2],
  [N('Cap Boucanier', 'Buccaneer Cape'), -0.75, 0.1],
  [N('Baie de la Potence', 'Gallows Bay'), -0.3, 0.42],
  [N("Lagon d'Émeraude", 'Emerald Lagoon'), 0.66, 0.24],
  [N('Pic du Pavillon noir', 'Black Flag Peak'), 0.24, -0.25],
  [N('Côte des Épices', 'Spice Coast'), 0.66, 0.43],
  [N('Sierra Galion', 'Galleon Sierra'), -0.7, -0.4],
  [N('Fort Boulet', 'Cannonball Fort'), 0.2, 0.4],
  [N('Caye Longue-Vue', 'Spyglass Cay'), 0.6, 0.32],
  [N('Baie des Contrebandiers', "Smugglers' Bay"), -0.62, 0.15],
  [N('Morne Corsaire', 'Privateer Bluff'), 0.52, -0.1],
  [N('Île Sabordée', 'Scuttled Isle'), -0.05, -0.3],
];

// ------------------------------------------------------------------ catalogue
export const LEGENDS: WorldDef[] = [
  {
    id: 'atlantis',
    name: { fr: 'Atlantide', en: 'Atlantis' },
    desc: {
      fr: 'L’île de Platon : la cité aux anneaux d’eau et de terre, la grande plaine quadrillée de canaux, les dix rois.',
      en: "Plato's island: the city of rings of water and land, the great plain gridded with canals, the ten kings.",
    },
    category: 'legends',
    seed: 8101,
    width: 1500,
    height: 1100,
    mountains: 0.4,
    rivers: 0.35,
    latTop: 40,
    latBottom: 28,
    shape: atlantis,
    // The plain's canals reach the city's rings and the sea (ships sail them).
    riverGap: 24,
    nations: 21,
    spots: spotsAt(ATLANTIS_NATIONS),
  },
  {
    id: 'nine-realms',
    name: { fr: 'Les Neuf Mondes', en: 'The Nine Realms' },
    desc: {
      fr: 'Les neuf mondes de l’arbre Yggdrasil, reliés par ses branches ; Asgard ne s’atteint que par Bifröst.',
      en: 'The nine worlds of the tree Yggdrasil, linked by its branches; Asgard is reached only by Bifröst.',
    },
    category: 'legends',
    seed: 8202,
    width: 1200,
    height: 1400,
    mountains: 0.15,
    rivers: 0.35,
    latTop: 52,
    latBottom: 40,
    shape: nineRealms,
    nations: 25,
    spots: spotsAt(NINE_NATIONS),
  },
  {
    id: 'olympus',
    name: { fr: "Archipel de l'Olympe", en: 'Olympian Archipelago' },
    desc: {
      fr: 'Une mer de héros entre deux rivages : l’Olympe inaccessible au centre, les Cyclades, Crète, Troie, Ithaque.',
      en: 'A sea of heroes between two shores: unreachable Olympus in the middle, the Cyclades, Crete, Troy, Ithaca.',
    },
    category: 'legends',
    seed: 8303,
    width: 1500,
    height: 1100,
    mountains: 0.35,
    rivers: 0.3,
    latTop: 42,
    latBottom: 33,
    moistureBias: -0.1,
    shape: olympus,
    nations: 26,
    spots: spotsAt(OLYMPUS_NATIONS),
  },
  {
    id: 'dragon',
    name: { fr: 'Terre du Dragon', en: 'Dragonland' },
    desc: {
      fr: 'Un continent en forme de dragon, ailes déployées : crête dorsale, os des ailes en montagnes, lac du Cœur.',
      en: 'A continent shaped like a dragon, wings spread: a dorsal crest, wing bones of mountains, the Heart lake.',
    },
    category: 'legends',
    seed: 8404,
    width: 1700,
    height: 1100,
    mountains: 0.12,
    rivers: 0.4,
    latTop: 45,
    latBottom: 20,
    shape: dragon,
    nations: 22,
    spots: spotsAt(DRAGON_NATIONS),
  },
  {
    id: 'pirates',
    name: { fr: 'Mer des Flibustiers', en: 'Buccaneer Sea' },
    desc: {
      fr: 'Îles à criques, cayes et une côte de jungle : l’Île au Trésor garde son lagon au milieu.',
      en: 'Islands full of coves, cays and a jungle coast: Treasure Island keeps its lagoon in the middle.',
    },
    category: 'legends',
    seed: 8505,
    width: 1600,
    height: 1000,
    mountains: 0.25,
    rivers: 0.3,
    latTop: 24,
    latBottom: 10,
    moistureBias: 0.1,
    shape: pirates,
    nations: 24,
    spots: spotsAt(PIRATE_NATIONS),
  },
];
