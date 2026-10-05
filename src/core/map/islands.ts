// Small-island filter shared by the map builder (scripts/maps), the hand-shaped worlds and
// the procedural generator. OpenFront's map generator drops every landmass under 30 tiles
// (`minIslandSize`, 4-connected) and turns it into the water around it; Isoline does the
// same, with a floor scaled to the map's size, so nobody has to ship troops to a 3-tile rock
// (player feedback 1.15: « les petites îles, elles sont chiantes à récupérer »).
// Only land is ever removed: lakes and seas are untouched, and an islet in a lake becomes lake.
// Islands that carry a nation are kept, grown to the floor if they are smaller.
// User-made maps (editor) are never filtered: the author keeps what they drew.
import { IS_LAND, IS_WATER, T } from './terrain';

/** OpenFront's minimum island (tiles), and Isoline's floor on a ~1.5 M-tile map. */
export const OPENFRONT_MIN_ISLAND = 30;
export const MIN_ISLAND_BASE = 40;
const REFERENCE_TILES = 1_500_000;

/**
 * Smallest island kept on a map of w × h tiles: 40 tiles (a spawn disc is 52) on an ordinary
 * map, scaled with the fourth root of the area above 1.5 M tiles (World 43, Giant World 54):
 * a square root (74 on the Giant World) also erased Corsica, Crete and Hawaii's Big Island.
 */
export function minIslandTiles(w: number, h: number): number {
  return Math.round(MIN_ISLAND_BASE * Math.max(1, Math.pow((w * h) / REFERENCE_TILES, 0.25)));
}

export interface IslandReport {
  /** Islands turned into water. */
  removed: number;
  /** Land tiles turned into water. */
  removedTiles: number;
  /** Small islands kept because they carry a nation (grown to the floor). */
  kept: number;
  /** Water tiles turned into land to grow those islands. */
  grownTiles: number;
}

/** 4-connected components of `land` (1 = land): component id per tile (-1 = not land) and sizes. */
export function landComponents(land: Uint8Array, w: number, h: number): { id: Int32Array; sizes: number[] } {
  const n = w * h;
  const id = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (id[s] !== -1 || !land[s]) continue;
    const c = sizes.length;
    let sp = 0;
    let count = 0;
    stack[sp++] = s;
    id[s] = c;
    const visit = (j: number): void => {
      if (!land[j] || id[j] !== -1) return;
      id[j] = c;
      stack[sp++] = j;
    };
    while (sp > 0) {
      const i = stack[--sp]!;
      count++;
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < n - w) visit(i + w);
    }
    sizes.push(count);
  }
  return { id, sizes };
}

interface FilterOptions {
  /** Tiles (indices) whose island must survive: nation spawns. */
  keep?: Iterable<number>;
  /** Water tiles never used to grow a kept island (carved straits). */
  noGrow?: Uint8Array;
}

/**
 * Core of the filter on a land mask: returns the tiles to clear and the tiles to fill.
 * Kept islands grow roughly round from their centre, never touching another landmass.
 */
function plan(
  land: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  opts: FilterOptions,
): { clear: number[][]; fill: number[]; report: IslandReport } {
  const { id, sizes } = landComponents(land, w, h);
  const keepComp = new Set<number>();
  for (const k of opts.keep ?? []) if (k >= 0 && k < w * h && id[k]! >= 0) keepComp.add(id[k]!);
  const report: IslandReport = { removed: 0, removedTiles: 0, kept: 0, grownTiles: 0 };
  const small = new Map<number, number[]>();
  for (let i = 0; i < w * h; i++) {
    const c = id[i]!;
    if (c < 0 || sizes[c]! >= minSize) continue;
    let list = small.get(c);
    if (!list) small.set(c, (list = []));
    list.push(i);
  }
  const clear: number[][] = [];
  const fill: number[] = [];
  const taken = new Uint8Array(w * h);
  for (const [c, tiles] of small) {
    if (!keepComp.has(c)) {
      clear.push(tiles);
      report.removed++;
      report.removedTiles += tiles.length;
      continue;
    }
    report.kept++;
    // Grow: water tiles by distance from the island's centre, each one 4-adjacent to the
    // island so far, never 8-adjacent to another landmass (no merging, straits stay open).
    let cx = 0;
    let cy = 0;
    for (const i of tiles) {
      cx += i % w;
      cy += (i / w) | 0;
    }
    cx /= tiles.length;
    cy /= tiles.length;
    const mine = new Set(tiles);
    const free = (j: number): boolean => {
      if (land[j] || taken[j] || opts.noGrow?.[j]) return false;
      const x = j % w;
      const y = (j / w) | 0;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) return false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = j + dy * w + dx;
          if (land[k] && id[k] !== c) return false;
          if (taken[k] && !mine.has(k)) return false;
        }
      return true;
    };
    const touches = (j: number): boolean => {
      const x = j % w;
      return (
        (x > 0 && mine.has(j - 1)) || (x < w - 1 && mine.has(j + 1)) || mine.has(j - w) || mine.has(j + w)
      );
    };
    for (let r = 1; mine.size < minSize && r <= 2 * Math.sqrt(minSize) + 4; r++) {
      const ring: [number, number][] = [];
      const x0 = Math.floor(cx - r);
      const x1 = Math.ceil(cx + r);
      const y0 = Math.floor(cy - r);
      const y1 = Math.ceil(cy + r);
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= r) ring.push([y * w + x, d]);
        }
      ring.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      let added = true;
      while (added && mine.size < minSize) {
        added = false;
        for (const [j] of ring) {
          if (mine.size >= minSize) break;
          if (mine.has(j) || !free(j) || !touches(j)) continue;
          mine.add(j);
          taken[j] = 1;
          fill.push(j);
          report.grownTiles++;
          added = true;
        }
      }
    }
  }
  return { clear, fill, report };
}

/**
 * Filters a land mask in place (1 = land), before terrain synthesis: islands under `minSize`
 * tiles become water, those holding a `keep` tile grow to `minSize`. With a `lake` mask, an
 * islet standing in a lake becomes lake, and a kept island may grow into its lake.
 */
export function removeSmallIslands(
  land: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  opts: FilterOptions & { lake?: Uint8Array } = {},
): IslandReport {
  const { clear, fill, report } = plan(land, w, h, minSize, opts);
  const lake = opts.lake;
  for (const tiles of clear) {
    let lakeVotes = 0;
    let seaVotes = 0;
    if (lake) {
      const seen = new Set<number>();
      for (const i of tiles) {
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= w * h || land[j] || seen.has(j)) continue;
          seen.add(j);
          if (lake[j]) lakeVotes++;
          else seaVotes++;
        }
      }
    }
    for (const i of tiles) {
      land[i] = 0;
      if (lake && lakeVotes > seaVotes) lake[i] = 1;
    }
  }
  for (const j of fill) {
    land[j] = 1;
    if (lake) lake[j] = 0;
  }
  return report;
}

/**
 * The same filter on finished terrain (blocky or retouched worlds), on passable land as the
 * game's landmasses: walls (impassable) separate them like water. A removed island takes the
 * terrain most common around it, water or wall (OpenFront's `majorityNeighborType`),
 * altitude 0 for water. Kept islands grow into water only, as plains.
 */
export function removeSmallIslandsTerrain(
  terrain: Uint8Array,
  elevation: Uint8Array,
  w: number,
  h: number,
  minSize: number,
  opts: FilterOptions = {},
): IslandReport {
  const n = w * h;
  const land = new Uint8Array(n);
  const noGrow = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    land[i] = IS_LAND[terrain[i]!]!;
    noGrow[i] = IS_WATER[terrain[i]!] && !opts.noGrow?.[i] ? 0 : 1;
  }
  const { clear, fill, report } = plan(land, w, h, minSize, { ...opts, noGrow });
  for (const tiles of clear) {
    const votes = new Map<number, number>();
    const seen = new Set<number>();
    for (const i of tiles) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || land[j] || seen.has(j)) continue;
        seen.add(j);
        votes.set(terrain[j]!, (votes.get(terrain[j]!) ?? 0) + 1);
      }
    }
    let water: number = T.Shallow;
    let best = 0;
    for (const [t, v] of votes)
      if (v > best || (v === best && t < water)) {
        best = v;
        water = t;
      }
    for (const i of tiles) {
      if (IS_WATER[water]) elevation[i] = 0;
      terrain[i] = water;
    }
  }
  for (const j of fill) {
    terrain[j] = T.Plains;
    elevation[j] = 20;
  }
  return report;
}
