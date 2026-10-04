// Shared pipeline of the 1.5 map packs (arcade, planets, myths & legends): a shape
// function draws land / lakes / relief masks (or the whole terrain for blocky maps),
// then the same synthesis as fantasy.ts (altitude, rivers, biomes), an optional
// per-map retouch, an optional exact symmetry (arcade) and named nations.
// Everything is seeded: the output is byte-for-byte reproducible.
import { Noise2D } from '../../src/core/noise';
import { Rng, hashString } from '../../src/core/rng';
import { inventNationName } from '../../src/core/names';
import { synthesize, generateDeposits, generateSpawnPoints } from '../../src/core/map/synth';
import { flowParents, markEnclosedLakes } from '../../src/core/map/generator';
import { connectRivers } from '../../src/core/map/rivers';
import { HABITABLE, T } from '../../src/core/map/terrain';
import type {
  DepositSpec,
  LocalizedName,
  MapCategory,
  MapMeta,
  MapPalette,
  NationSpawn,
} from '../../src/core/map/gamemap';

export interface Ctx {
  w: number;
  h: number;
  rng: Rng;
  noise: Noise2D;
  noiseB: Noise2D;
  noiseC: Noise2D;
}

export interface WorldShape {
  /** 1 = land. */
  land: Uint8Array;
  /** 1 = lake water (subset of water). */
  lake?: Uint8Array;
  /** Extra altitude (0 … ~0.5). */
  relief?: Float32Array;
  /** Explicit mountain ranges (synth mask, blurred into altitude). */
  mountains?: Uint8Array;
  hills?: Uint8Array;
  deserts?: Uint8Array;
  tundra?: Uint8Array;
  glaciers?: Uint8Array;
  /** Explicit rivers / canals (river tiles). */
  rivers?: Uint8Array;
  /** Added to the ridged-noise field when `mountains` > 0 picks random ranges. */
  ridgeBias?: Float32Array;
  /** Terrain forced on land after synthesis (terrain id + 1; 0 = keep). */
  stamp?: Uint8Array;
}

export interface Retouch extends Ctx {
  terrain: Uint8Array;
  elevation: Uint8Array;
}

/** A nation spot: position and optional name (otherwise the def's names, then invented). */
export interface Spot {
  x: number;
  y: number;
  name?: LocalizedName;
}

export interface WorldDef {
  id: string;
  name: LocalizedName;
  desc: LocalizedName;
  category: MapCategory;
  palette?: MapPalette;
  seed: number;
  width: number;
  height: number;
  /** Random ridged mountains (0 = only the explicit ranges). */
  mountains: number;
  /** Random rivers (0 = only the explicit ones). */
  rivers: number;
  /** Latitude of the top / bottom rows (climate of the biomes). */
  latTop: number;
  latBottom: number;
  moistureBias?: number;
  /** km per tile (default: the procedural generator's nominal scale). */
  pxKm?: number;
  /** Land, lakes and relief masks (synthesised), or… */
  shape?: (c: Ctx) => WorldShape;
  /** …the finished terrain and altitude (blocky / hand-placed maps). */
  direct?: (c: Ctx) => { terrain: Uint8Array; elevation: Uint8Array };
  /** Last touches on the terrain (biome themes, walls, bridges). */
  retouch?: (r: Retouch) => void;
  /** Canonical tile of (x, y): terrain and altitude are copied from it (exact symmetry). */
  symmetry?: (x: number, y: number) => [number, number];
  /** Number of nations (auto-placed when `spots` is absent). */
  nations: number;
  /** Nation names, in importance order. */
  names?: LocalizedName[];
  /** Explicit nation spots, in importance order (snapped to free land). */
  spots?: (r: Retouch) => Spot[];
  /** Extra deposits (e.g. a contested centre). */
  deposits?: (r: Retouch) => DepositSpec[];
  /** Deposit density (default 1). */
  depositDensity?: number;
  /** Rivers ending this close to the sea are joined to it (navigable; default 6 tiles, 0 = off). */
  riverGap?: number;
}

// ------------------------------------------------------------------ helpers
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Distance from (px,py) to segment AB and the projection parameter t ∈ [0,1]. */
export function segment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return [Math.hypot(px - ax - t * dx, py - ay - t * dy), t];
}

/** Distance to a polyline, and the position along it (0 … 1 by segment count). */
export function polyline(
  px: number,
  py: number,
  pts: readonly (readonly [number, number])[],
): [number, number] {
  let best = Infinity;
  let at = 0;
  for (let k = 1; k < pts.length; k++) {
    const [d, t] = segment(px, py, pts[k - 1]![0], pts[k - 1]![1], pts[k]![0], pts[k]![1]);
    if (d < best) {
      best = d;
      at = (k - 1 + t) / (pts.length - 1);
    }
  }
  return [best, at];
}

/** Rotated-ellipse distance (1 on the outline). */
export function ell(dx: number, dy: number, rx: number, ry: number, rot = 0): number {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Math.hypot((dx * c + dy * s) / rx, (-dx * s + dy * c) / ry);
}

/** Smallest angle between two directions. */
export function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Calls fn for every tile with normalised coordinates (X, Y in units of the map height, centred). */
export function each(c: Ctx, fn: (i: number, X: number, Y: number, x: number, y: number) => void): void {
  const { w, h } = c;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) fn(y * w + x, (x - (w - 1) / 2) / h, (y - (h - 1) / 2) / h, x, y);
}

/** Exact symmetries of a w×h grid. */
export const SYM = {
  /** Left-right mirror. */
  mirrorX:
    (w: number) =>
    (x: number, y: number): [number, number] => [Math.min(x, w - 1 - x), y],
  /** Both mirrors (four identical quadrants). */
  mirrorXY:
    (w: number, h: number) =>
    (x: number, y: number): [number, number] => [Math.min(x, w - 1 - x), Math.min(y, h - 1 - y)],
  /** Half-turn rotation. */
  rot2:
    (w: number, h: number) =>
    (x: number, y: number): [number, number] =>
      y * 2 > h - 1 || (y * 2 === h - 1 && x * 2 > w - 1) ? [w - 1 - x, h - 1 - y] : [x, y],
  /** Dihedral symmetry of order 2k around the centre (k mirrors): the canonical wedge is [0, π/k]. */
  dihedral:
    (w: number, h: number, k: number) =>
    (x: number, y: number): [number, number] => {
      const cx = (w - 1) / 2;
      const cy = (h - 1) / 2;
      const r = Math.hypot(x - cx, y - cy);
      const wedge = Math.PI / k;
      let a = Math.atan2(y - cy, x - cx);
      a = ((a % (2 * wedge)) + 2 * wedge) % (2 * wedge);
      if (a > wedge) a = 2 * wedge - a;
      return [
        Math.max(0, Math.min(w - 1, Math.round(cx + r * Math.cos(a)))),
        Math.max(0, Math.min(h - 1, Math.round(cy + r * Math.sin(a)))),
      ];
    },
};

/** The images of a canonical point under the dihedral group of order 2k (rotations first, then mirrors). */
export function dihedralImages(w: number, h: number, k: number, X: number, Y: number): [number, number][] {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r = Math.hypot(X, Y) * h;
  const a0 = Math.atan2(Y, X);
  const out: [number, number][] = [];
  for (const sgn of [1, -1])
    for (let j = 0; j < k; j++) {
      const a = sgn * a0 + (j * 2 * Math.PI) / k;
      const p: [number, number] = [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))];
      if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 3)) out.push(p);
    }
  return out;
}

function quantileThreshold(values: Float32Array, ratio: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 60000));
  for (let i = 0; i < values.length; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor((1 - ratio) * sample.length)))]!;
}

/** Size (tiles) of the passable landmass of each tile (0 for water). */
function landmassSizes(terrain: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const out = new Int32Array(n);
  const stack: number[] = [];
  const members: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1 || !HABITABLE[terrain[s]!]) continue;
    members.length = 0;
    comp[s] = s;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || comp[j] !== -1 || !HABITABLE[terrain[j]!]) continue;
        comp[j] = s;
        stack.push(j);
      }
    }
    for (const i of members) out[i] = members.length;
  }
  return out;
}

// ------------------------------------------------------------------ build
export function buildWorld(def: WorldDef): { meta: MapMeta; terrain: Uint8Array; elevation: Uint8Array } {
  const { width: w, height: h, seed } = def;
  const n = w * h;
  const rng = new Rng(seed);
  const ctx: Ctx = {
    w,
    h,
    rng,
    noise: new Noise2D(seed),
    noiseB: new Noise2D(seed + 101),
    noiseC: new Noise2D(seed + 202),
  };
  let terrain: Uint8Array;
  let elevation: Uint8Array;
  if (def.direct) {
    ({ terrain, elevation } = def.direct(ctx));
  } else {
    const s = def.shape!(ctx);
    const mountains = s.mountains ?? new Uint8Array(n);
    if (def.mountains > 0) {
      const mFreq = 6 / Math.max(w, h);
      const ridge = new Float32Array(n).fill(-1);
      let landTiles = 0;
      for (let i = 0; i < n; i++) {
        if (!s.land[i]) continue;
        landTiles++;
        const x = i % w;
        const y = (i / w) | 0;
        ridge[i] = ctx.noiseB.ridged(x * mFreq + 7, y * mFreq - 3, 4) + (s.ridgeBias ? s.ridgeBias[i]! : 0);
      }
      const thr = quantileThreshold(ridge, ((0.03 + 0.09 * def.mountains) * landTiles) / n);
      for (let i = 0; i < n; i++) if (s.land[i] && ridge[i]! > thr) mountains[i] = 1;
    }
    const common = {
      width: w,
      height: h,
      seed,
      pxKm: def.pxKm ?? (9000 / Math.sqrt(n)) * 1.6,
      land: s.land,
      latitude: (_x: number, y: number) => def.latTop + (y / h) * (def.latBottom - def.latTop),
      mountains,
      moistureNoise: 0.34,
      ...(s.lake ? { lake: s.lake } : {}),
      ...(s.relief ? { relief: s.relief } : {}),
      ...(s.hills ? { hills: s.hills } : {}),
      ...(s.deserts ? { deserts: s.deserts } : {}),
      ...(s.tundra ? { tundra: s.tundra } : {}),
      ...(s.glaciers ? { glaciers: s.glaciers } : {}),
      ...(def.moistureBias ? { moistureBias: def.moistureBias } : {}),
    };
    const pre = synthesize(common);
    // Rivers by steepest descent from mid-altitude sources (as fantasy.ts), plus explicit ones.
    const rivers = s.rivers ? Uint8Array.from(s.rivers) : new Uint8Array(n);
    for (let i = 0; i < n; i++) if (!s.land[i]) rivers[i] = 0;
    if (def.rivers > 0) {
      const parent = flowParents(s.land, pre.elevation, w, h);
      const count = Math.round((def.rivers * Math.sqrt(n)) / 30);
      for (let r = 0; r < count; r++) {
        let src = -1;
        for (let tries = 0; tries < 300; tries++) {
          const c = rng.int(0, n - 1);
          if (s.land[c] && pre.elevation[c]! > 110 && pre.elevation[c]! < 190 && !rivers[c]) {
            src = c;
            break;
          }
        }
        if (src < 0) continue;
        const path: number[] = [];
        for (let i = src; i >= 0 && s.land[i] && path.length < 6000; i = parent[i]!) {
          path.push(i);
          if (rivers[i]) break;
        }
        // Straight runs come from flat slopes (artefacts): keep winding rivers only.
        const a = path[0]!;
        const z = path[path.length - 1]!;
        const span = Math.max(Math.abs((a % w) - (z % w)), Math.abs(((a / w) | 0) - ((z / w) | 0)));
        if (path.length > 25 && span < 0.9 * path.length) for (const j of path) rivers[j] = 1;
      }
    }
    ({ terrain, elevation } = synthesize({ ...common, rivers }));
    if (s.stamp)
      for (let i = 0; i < n; i++) {
        const t = s.stamp[i]! - 1;
        if (t < 0 || !HABITABLE[terrain[i]!] || terrain[i] === T.River) continue;
        terrain[i] = t;
        if (t === T.Mountain) elevation[i] = Math.max(elevation[i]!, 175);
        else if (t === T.Hills) elevation[i] = Math.max(elevation[i]!, 105);
      }
  }
  const r: Retouch = { ...ctx, terrain, elevation };
  def.retouch?.(r);
  if (def.symmetry) {
    const t0 = Uint8Array.from(terrain);
    const e0 = Uint8Array.from(elevation);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [sx, sy] = def.symmetry(x, y);
        terrain[y * w + x] = t0[sy * w + sx]!;
        elevation[y * w + x] = e0[sy * w + sx]!;
      }
  }
  markEnclosedLakes(terrain, w, h);
  // Navigable rivers (as the real maps): fragments close to the sea are joined to it.
  // Symmetric boards are left alone (a carved channel would break the symmetry).
  if (!def.symmetry && (def.riverGap ?? 6) > 0) connectRivers(terrain, w, h, def.riverGap ?? 6);

  // Nations: explicit spots (snapped to free land on a sizeable landmass) or spaced auto spots.
  const sizes = landmassSizes(terrain, w, h);
  const ok = (x: number, y: number) => {
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) return false;
    const i = y * w + x;
    const t = terrain[i]!;
    return HABITABLE[t] === 1 && t !== T.Mountain && sizes[i]! >= 400;
  };
  const snap = (x0: number, y0: number): [number, number] | null => {
    const xi = Math.round(x0);
    const yi = Math.round(y0);
    for (let d = 0; d < 40; d++)
      for (let dy = -d; dy <= d; dy++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          if (ok(xi + dx, yi + dy)) return [xi + dx, yi + dy];
        }
    return null;
  };
  const raw: Spot[] = def.spots
    ? def.spots(r)
    : generateSpawnPoints(w, h, terrain, seed ^ 0x2545f491, def.nations).map(([x, y]) => ({ x, y }));
  const nations: NationSpawn[] = [];
  const used = new Set<string>();
  let k = 0;
  for (const sp of raw) {
    if (nations.length >= def.nations) break;
    const s = snap(sp.x, sp.y);
    if (!s || nations.some((o) => Math.hypot(o.x - s[0], o.y - s[1]) < 14)) {
      console.warn(`  ${def.id}: dropped spot ${Math.round(sp.x)},${Math.round(sp.y)}`);
      continue;
    }
    let name = sp.name ?? def.names?.[k];
    k++;
    while (!name || used.has(name.en)) name = inventNationName(rng);
    used.add(name.en);
    nations.push({
      name,
      x: s[0],
      y: s[1],
      flagSeed: hashString(name.en + def.id),
      weight: def.nations - nations.length,
    });
  }
  const meta: MapMeta = {
    id: def.id,
    name: def.name,
    category: def.category,
    width: w,
    height: h,
    nations,
    spawnPoints: generateSpawnPoints(w, h, terrain, seed, 320),
    deposits: [...(def.deposits?.(r) ?? []), ...generateDeposits(w, h, terrain, seed, def.depositDensity)],
    ...(def.palette ? { palette: def.palette } : {}),
    author: 'Isoline (procedural)',
    version: 1,
  };
  return { meta, terrain, elevation };
}
