// Hand-shaped fantasy maps: a land mask drawn by a shape function (+ noise for
// organic coasts), then the same relief / river / biome pipeline as the in-game
// procedural generator (src/core/map/generator.ts), with fixed seeds.
import { Noise2D } from '../../src/core/noise';
import { Rng } from '../../src/core/rng';
import { inventNationName } from '../../src/core/names';
import { synthesize, generateDeposits, generateSpawnPoints } from '../../src/core/map/synth';
import { flowParents, markEnclosedLakes } from '../../src/core/map/generator';
import { settleNations } from '../../src/core/map/nationPick';
import { minIslandTiles, removeSmallIslands } from '../../src/core/map/islands';
import type { LocalizedName, MapMeta, NationSpawn } from '../../src/core/map/gamemap';

interface ShapeCtx {
  w: number;
  h: number;
  rng: Rng;
  noise: Noise2D;
  noiseB: Noise2D;
  noiseC: Noise2D;
}

interface Shape {
  /** 1 = land. */
  land: Uint8Array;
  /** 1 = lake water (subset of water). */
  lake?: Uint8Array;
  /** Added to the ridged-noise field: concentrates mountains (0 … ~0.5). */
  ridgeBias?: Float32Array;
  /** Extra altitude (0 … ~0.4) so that ranges stay continuous (synth `relief`). */
  relief?: Float32Array;
}

export interface FantasyDef {
  id: string;
  name: LocalizedName;
  seed: number;
  width: number;
  height: number;
  nations: number;
  /** 0 = flat, 1 = very mountainous. */
  mountains: number;
  /** 0 = none, 1 = many rivers. */
  rivers: number;
  latTop: number;
  latBottom: number;
  shape: (c: ShapeCtx) => Shape;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance from (px,py) to segment AB, and the projection parameter t ∈ [0,1]. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return [Math.hypot(px - ax - t * dx, py - ay - t * dy), t];
}

/** Fill a disc of radius r (px) with `value`. */
function disc(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  value: number,
): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) mask[y * w + x] = value;
}

/** Keeps an ocean rim: penalty growing near the frame (edge = Chebyshev distance 0 centre … 1 border). */
const rim = (x: number, y: number, w: number, h: number, start = 0.86) => {
  const edge = Math.max(Math.abs(x / w - 0.5), Math.abs(y / h - 0.5)) * 2;
  return Math.pow(Math.max(0, edge - start) / (1 - start), 2) * 1.4;
};

/** Relief of a range at distance d from its axis: wiggly, uneven massifs rather than a stripe. */
function rangeRelief(nz: Noise2D, x: number, y: number, d: number, amp: number, sigma: number): number {
  const dd = d + sigma * 0.8 * nz.get(x * 0.02 + 5, y * 0.02 - 5);
  const massif = clamp01(0.3 + 0.9 * nz.fbm(x * 0.009 + 77, y * 0.009 - 41, 3) + 0.4);
  return amp * massif * Math.exp(-((dd / sigma) ** 2));
}

function quantileThreshold(values: Float32Array, ratio: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 60000));
  for (let i = 0; i < values.length; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor((1 - ratio) * sample.length)))]!;
}

// ------------------------------------------------------------------ shapes

/** Two big continents, mountain spines with passes, joined by one narrow isthmus. */
function twinContinents({ w, h, rng, noise, noiseB, noiseC }: ShapeCtx): Shape {
  const n = w * h;
  const land = new Uint8Array(n);
  const lake = new Uint8Array(n);
  const ridgeBias = new Float32Array(n);
  const relief = new Float32Array(n);
  // Ellipse distance (1 on the outline).
  const ell = (dx: number, dy: number, rx: number, ry: number, rot: number) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return Math.hypot((dx * c + dy * s) / rx, (-dx * s + dy * c) / ry);
  };
  type Blob = [number, number, number, number, number];
  // A continent: core ellipse + peninsulas (lobes) − bays, none of them facing the other continent.
  const continent = (cx: number, cy: number, rx: number, ry: number, rot: number, facing: number) => {
    const lobes: Blob[] = [[cx, cy, rx, ry, rot]];
    const bays: Blob[] = [];
    const away = () => {
      for (;;) {
        const a = rng.range(-Math.PI, Math.PI);
        if (Math.abs(Math.atan2(Math.sin(a - facing), Math.cos(a - facing))) >= 0.9) return a;
      }
    };
    for (let k = 0; k < 6; k++) {
      const a = away();
      const d = rng.range(0.7, 1.0);
      lobes.push([
        cx + Math.cos(a) * rx * d,
        cy + Math.sin(a) * ry * d,
        rng.range(0.06, 0.12),
        rng.range(0.04, 0.09),
        rng.range(0, Math.PI),
      ]);
    }
    for (let k = 0; k < 4; k++) {
      const a = away();
      bays.push([
        cx + Math.cos(a) * rx * 1.02,
        cy + Math.sin(a) * ry * 1.02,
        rng.range(0.05, 0.09),
        rng.range(0.03, 0.06),
        a,
      ]);
    }
    return { lobes, bays };
  };
  const L = continent(-0.43, -0.02, 0.27, 0.36, 0.35, 0);
  const R = continent(0.44, 0.03, 0.26, 0.35, -0.3, Math.PI);
  // Islets scattered in the strait and the outer ocean.
  const islets: [number, number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const side = k % 3;
    const X =
      side === 0 ? rng.range(-0.09, 0.09) : side === 1 ? rng.range(-0.84, -0.76) : rng.range(0.76, 0.84);
    const Y = side === 0 ? (rng.chance(0.5) ? -1 : 1) * rng.range(0.12, 0.4) : rng.range(-0.4, 0.4);
    islets.push([X, Y, rng.range(0.012, 0.03)]);
  }
  const spines: [number, number, number, number][] = [
    [-0.55, -0.28, -0.34, 0.28],
    [0.56, -0.3, 0.38, 0.26],
  ];
  const passes = [0.25, 0.52, 0.78];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const X = (x - w / 2) / h;
      const Y = (y - h / 2) / h;
      const wx = X + 0.06 * noise.fbm(x * 0.0035, y * 0.0035, 4);
      const wy = Y + 0.06 * noise.fbm(x * 0.0035 + 31, y * 0.0035 - 17, 4);
      let core = -1;
      let v = -1;
      for (const c of [L, R]) {
        const [cx, cy, rx, ry, rot] = c.lobes[0]!;
        core = Math.max(core, 1 - ell(wx - cx, wy - cy, rx, ry, rot));
        let f = -1;
        for (const [bx, by, brx, bry, brot] of c.lobes)
          f = Math.max(f, 1 - ell(wx - bx, wy - by, brx, bry, brot));
        for (const [bx, by, brx, bry, brot] of c.bays)
          f = Math.min(f, ell(wx - bx, wy - by, brx, bry, brot) - 1);
        v = Math.max(v, f);
      }
      for (const [ix, iy, ir] of islets) v = Math.max(v, 0.5 * (1 - Math.hypot(wx - ix, wy - iy) / ir));
      v += 0.2 * noiseB.fbm(x * 0.011, y * 0.011, 5);
      const bridgeY = 0.06 * Math.sin(X * 9 + 0.6) + 0.02 * noise.get(X * 8, 4.5);
      const bridgeW = 0.022 * (1 + 0.6 * Math.max(0, noiseC.get(X * 10, 9.5)));
      if (Math.abs(X) < 0.2) v = Math.max(v, 0.5 * (1 - Math.abs(Y - bridgeY) / bridgeW));
      v -= rim(x, y, w, h);
      if (v > 0) land[i] = 1;
      // Mountain spines, broken by passes.
      for (const [ax, ay, bx, by] of spines) {
        const [d, t] = segment(wx, wy, ax, ay, bx, by);
        if (passes.some((p) => Math.abs(t - p) < 0.035)) continue;
        ridgeBias[i] = Math.max(ridgeBias[i]!, 0.38 * Math.exp(-((d / 0.024) ** 2)));
        relief[i] = Math.max(relief[i]!, rangeRelief(noiseC, x, y, d, 0.34, 0.016));
      }
      // A few lakes in the continental interiors.
      if (core > 0.4 && noiseC.fbm(x * 0.02, y * 0.02, 3) > 0.48) {
        land[i] = 0;
        lake[i] = 1;
      }
    }
  }
  return { land, lake, ridgeBias, relief };
}

/** A cold coast slashed by fjords, a mountain wall with passes, a long gulf and a lake plateau. */
function fjords({ w, h, rng, noise, noiseB, noiseC }: ShapeCtx): Shape {
  const n = w * h;
  const land = new Uint8Array(n);
  const lake = new Uint8Array(n);
  const ridgeBias = new Float32Array(n);
  const relief = new Float32Array(n);
  const coastX = (Y: number) => 0.6 - 0.34 * Math.pow(1 - Math.pow(Math.abs((Y - 0.5) / 0.42), 5), 0.2);
  const northY = (X: number) =>
    0.5 - 0.42 * Math.pow(1 - Math.pow(Math.min(1, Math.abs((X - 0.6) / 0.36)), 5), 0.2);
  const gulfX = (Y: number) => 0.68 + 0.04 * Math.sin(Y * 7 + 1);
  const gulfW = (Y: number) => 0.02 + 0.04 * clamp01((Y - 0.3) / 0.5);
  const spineX = (Y: number) => coastX(Y) + 0.14 + 0.025 * noise.get(Y * 4, 3.3);
  const passes = [0.3, 0.52, 0.74];
  // Lofoten-like chain of islands off the north-west coast.
  const chain: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) chain.push([0.24 - k * 0.022, 0.2 - k * 0.012, rng.range(0.008, 0.016)]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const X = x / w + 0.045 * noise.fbm(x * 0.004 + 3, y * 0.004, 4);
      const Y = y / h + 0.045 * noise.fbm(x * 0.004, y * 0.004 + 11, 4);
      // Superellipse silhouette (rounded rectangle) with organic coasts.
      const se = Math.pow(Math.abs((X - 0.6) / 0.36) ** 5 + Math.abs((Y - 0.5) / 0.42) ** 5, 0.2);
      let v = (1 - se) * 0.4 + 0.03 * noiseB.fbm(x * 0.012, y * 0.012, 5);
      // The gulf (rounded northern end), with a few islands.
      const gy = Math.max(0, 0.32 - Y);
      const dg = Math.hypot((X - gulfX(Y)) / gulfW(Math.max(Y, 0.32)), gy / 0.03);
      if (dg < 1) v = noiseC.fbm(x * 0.03, y * 0.03 + 50, 4) > 0.5 ? 0.01 : Math.min(v, -0.01);
      // Skerries off the west coast.
      if (X < coastX(Y) + 0.01 && X > coastX(Y) - 0.11 && noiseC.fbm(x * 0.03, y * 0.03, 4) > 0.36) v = 0.01;
      for (const [cx, cy, r] of chain) if (Math.hypot(X - cx, (Y - cy) * 0.6) < r) v = 0.01;
      if (v > 0) land[i] = 1;
      // Mountain wall west of centre, broken by passes.
      const sx = spineX(Y);
      if (!passes.some((p) => Math.abs(Y - p) < 0.02) && Y > 0.12 && Y < 0.88) {
        ridgeBias[i] = 0.45 * Math.exp(-(((X - sx) / 0.016) ** 2));
        relief[i] = rangeRelief(noiseB, x, y, X - sx, 0.36, 0.012);
      }
      // Lake plateau east of the gulf.
      if (land[i] && X > gulfX(Y) + 0.08 && noiseC.fbm(x * 0.018 + 40, y * 0.018, 3) > 0.4) {
        land[i] = 0;
        lake[i] = 1;
      }
    }
  }
  // Fjords: long, narrowing, meandering inlets (one optional side branch).
  const carve = (sx: number, sy: number, angle: number, len: number, r0: number, branch: boolean): void => {
    let x = sx;
    let y = sy;
    const k = rng.int(0, 999);
    const at = branch ? Math.floor(len * rng.range(0.3, 0.6)) : -1;
    const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 1.0);
    const sub = rng.range(0.3, 0.5);
    for (let t = 0; t < len; t++) {
      const a = angle + 0.8 * noise.get(k * 0.37, t * 0.015);
      x += Math.cos(a);
      y += Math.sin(a);
      const r = (r0 + (2.2 - r0) * Math.sqrt(t / len)) * (0.85 + 0.3 * noiseB.get(k, t * 0.05));
      disc(land, w, h, x, y, r, 0);
      if (t === at) carve(x, y, a + turn, len * sub, r * 0.8, false);
    }
  };
  for (let k = 0; k < 18; k++) {
    const Y = 0.14 + (k / 17) * 0.72 + rng.range(-0.012, 0.012);
    carve(
      (coastX(Y) - 0.05) * w,
      Y * h,
      rng.range(-0.35, 0.35),
      rng.range(0.11, 0.24) * w,
      rng.range(8, 11),
      rng.chance(0.65),
    );
  }
  for (let k = 0; k < 7; k++) {
    const X = 0.33 + k * 0.085 + rng.range(-0.02, 0.02);
    carve(
      X * w,
      (northY(X) - 0.05) * h,
      Math.PI / 2 + rng.range(-0.35, 0.35),
      rng.range(0.1, 0.2) * h,
      rng.range(7, 9),
      rng.chance(0.5),
    );
  }
  for (let k = 0; k < 4; k++) {
    const X = 0.36 + k * 0.07 + rng.range(-0.015, 0.015);
    carve(
      X * w,
      0.96 * h,
      -Math.PI / 2 + rng.range(-0.3, 0.3),
      rng.range(0.08, 0.14) * h,
      rng.range(7, 9),
      false,
    );
  }
  for (let i = 0; i < n; i++) if (lake[i]) land[i] = 0;
  return { land, lake, ridgeBias, relief };
}

/** A ring continent around an inner sea with a mountain citadel island, cut by three straits. */
function ring({ w, h, noise, noiseB }: ShapeCtx): Shape {
  const n = w * h;
  const land = new Uint8Array(n);
  const ridgeBias = new Float32Array(n);
  const relief = new Float32Array(n);
  const straits = [-1.25, 0.95, 2.95];
  const passes = [-2.4, -0.3, 0.4, 1.7, 2.3, 3.9];
  const angDist = (a: number, b: number) => {
    const d = Math.abs(a - b) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const X = (x - w / 2) / h;
      const Y = (y - h / 2) / h;
      const wx = X + 0.035 * noise.fbm(x * 0.005, y * 0.005, 4);
      const wy = Y + 0.035 * noise.fbm(x * 0.005 + 19, y * 0.005 - 23, 4);
      const r = Math.hypot(wx, wy);
      const a = Math.atan2(wy, wx);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const R0 = 0.31 + 0.025 * noise.get(ca * 1.5 + 9, sa * 1.5);
      const hw = 0.085 + 0.03 * noise.get(ca * 2 + 5, sa * 2 + 5);
      let v = 1 - Math.abs(r - R0) / hw;
      v = Math.max(v, 1 - r / 0.075); // central island
      v += 0.22 * noiseB.fbm(x * 0.012, y * 0.012, 5);
      v -= rim(x, y, w, h, 0.84);
      // Straits: guaranteed water channels across the ring.
      for (const s of straits) {
        const across = angDist(a, s + 0.06 * noise.get(r * 18, s)) * r * h;
        if (r > 0.12 && r < R0 + hw + 0.06 && across < 9 + 3 * noise.get(r * 12, s + 4))
          v = Math.min(v, -0.2);
      }
      if (v > 0) land[i] = 1;
      // Mountains along the ring's spine (with passes) and on the citadel island.
      const gap = passes.some((p) => angDist(a, p) < 0.07);
      const spine = gap ? 0 : Math.exp(-(((r - R0) / 0.028) ** 2));
      ridgeBias[i] = Math.max(0.36 * spine, 0.55 * clamp01(1 - r / 0.06));
      relief[i] = Math.max(
        gap ? 0 : rangeRelief(noise, x, y, r - R0, 0.3, 0.016),
        0.3 * clamp01(1 - r / 0.04),
      );
    }
  }
  return { land, ridgeBias, relief };
}

export const FANTASY: FantasyDef[] = [
  {
    id: 'twin-continents',
    name: { fr: 'Continents jumeaux', en: 'Twin Continents' },
    seed: 5150,
    width: 1700,
    height: 1000,
    nations: 40,
    mountains: 0.55,
    rivers: 0.65,
    latTop: 48,
    latBottom: -30,
    shape: twinContinents,
  },
  {
    id: 'fjords',
    name: { fr: 'Fjords', en: 'Fjords' },
    seed: 6060,
    width: 1500,
    height: 1100,
    nations: 30,
    mountains: 0.6,
    rivers: 0.5,
    latTop: 68,
    latBottom: 55,
    shape: fjords,
  },
  {
    id: 'ring',
    name: { fr: "L'Anneau", en: 'The Ring' },
    seed: 3333,
    width: 1400,
    height: 1400,
    nations: 36,
    mountains: 0.5,
    rivers: 0.55,
    latTop: 58,
    latBottom: 8,
    shape: ring,
  },
];

export function buildFantasy(def: FantasyDef): { meta: MapMeta; terrain: Uint8Array; elevation: Uint8Array } {
  const { width: w, height: h, seed } = def;
  const n = w * h;
  const rng = new Rng(seed);
  const noise = new Noise2D(seed);
  const noiseB = new Noise2D(seed + 101);
  const noiseC = new Noise2D(seed + 202);
  const { land, lake, ridgeBias, relief } = def.shape({ w, h, rng, noise, noiseB, noiseC });
  const pxKm = (9000 / Math.sqrt(n)) * 1.6; // same nominal scale as the procedural generator
  // Specks under the island floor become sea or lake (core/map/islands.ts).
  const isl = removeSmallIslands(land, w, h, minIslandTiles(w, h), lake ? { lake } : {});
  if (isl.removed)
    console.log(
      `  ${def.id}: ${isl.removed} islands < ${minIslandTiles(w, h)} tiles removed (${isl.removedTiles} tiles)`,
    );

  // Mountains: ridged noise (+ shape bias), top fraction of the land.
  const mFreq = 6 / Math.max(w, h);
  const ridgeField = new Float32Array(n).fill(-1);
  let landTiles = 0;
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    landTiles++;
    const x = i % w;
    const y = (i / w) | 0;
    ridgeField[i] = noiseB.ridged(x * mFreq + 7, y * mFreq - 3, 4) + (ridgeBias ? ridgeBias[i]! : 0);
  }
  const mThr = quantileThreshold(ridgeField, ((0.03 + 0.09 * def.mountains) * landTiles) / n);
  const mountains = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land[i] && ridgeField[i]! > mThr) mountains[i] = 1;

  const latitude = (_x: number, y: number) => def.latTop + (y / h) * (def.latBottom - def.latTop);
  const common = {
    width: w,
    height: h,
    seed,
    pxKm,
    land,
    lake,
    relief,
    latitude,
    mountains,
    moistureNoise: 0.34,
  };
  const pre = synthesize(common);

  // Rivers by steepest descent from mid-altitude sources.
  const rivers = new Uint8Array(n);
  const parent = flowParents(land, pre.elevation, w, h);
  const riverCount = Math.round((def.rivers * Math.sqrt(n)) / 30);
  for (let r = 0; r < riverCount; r++) {
    let src = -1;
    for (let tries = 0; tries < 300; tries++) {
      const c = rng.int(0, n - 1);
      if (land[c] && pre.elevation[c]! > 110 && pre.elevation[c]! < 190 && !rivers[c]) {
        src = c;
        break;
      }
    }
    if (src < 0) continue;
    const path: number[] = [];
    for (let i = src; i >= 0 && land[i] && path.length < 6000; i = parent[i]!) {
      path.push(i);
      if (rivers[i]) break;
    }
    if (path.length > 25) for (const j of path) rivers[j] = 1;
  }
  const out = synthesize({ ...common, rivers });
  markEnclosedLakes(out.terrain, w, h);

  // Nations: well-spaced spawn points on sizeable landmasses, invented names.
  const spots = generateSpawnPoints(w, h, out.terrain, seed ^ 0x2545f491, def.nations);
  const used = new Set<string>();
  const nations: NationSpawn[] = spots.map(([x, y], k) => {
    let name = inventNationName(rng);
    while (used.has(name.en)) name = inventNationName(rng);
    used.add(name.en);
    return { name, x, y, flagSeed: rng.nextU32(), weight: def.nations - k };
  });
  const meta: MapMeta = {
    id: def.id,
    name: def.name,
    category: 'fictional',
    width: w,
    height: h,
    nations,
    spawnPoints: generateSpawnPoints(w, h, out.terrain, seed, 320),
    deposits: generateDeposits(w, h, out.terrain, seed),
    author: 'Isoline (procedural)',
    version: 1,
  };
  settleNations(meta, out.terrain);
  return { meta, terrain: out.terrain, elevation: out.elevation };
}
