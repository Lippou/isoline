// Raster geometry of the map editor: lines, brush stamps along a stroke, rectangles,
// ellipses and the flood fill. Pure functions on tile coordinates (no DOM), unit-tested.
import { IS_WATER, T } from '../../core/map/terrain';

/** The tiles of an 8-connected (Bresenham) line from (x0, y0) to (x1, y1), both ends included. */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** Largest gap between two stamps of a brush of `size` tiles: half its radius, at least one tile. */
export function stampSpacing(size: number): number {
  return Math.max(1, Math.floor(size / 4));
}

/**
 * Where to stamp a brush of `size` tiles along a pointer segment, the start excluded (it
 * was stamped by the previous segment) and the end included. Follows the Bresenham line
 * so even a one-tile brush leaves an unbroken 8-connected trail, and never leaves more
 * than `stampSpacing(size)` tiles between two stamps.
 */
export function strokeStamps(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
): [number, number][] {
  const line = lineTiles(x0, y0, x1, y1);
  const step = stampSpacing(size);
  const out: [number, number][] = [];
  for (let k = step; k < line.length - 1; k += step) out.push(line[k]!);
  if (line.length > 1) out.push(line[line.length - 1]!);
  return out;
}

/**
 * Offsets of a round brush of `size` tiles (size 1 = one tile, 2 = a plus, 3 = a 3 × 3
 * square, then discs). Cached per size.
 */
const discCache = new Map<number, Int16Array>();
export function discOffsets(size: number): Int16Array {
  const s = Math.max(1, Math.round(size));
  let d = discCache.get(s);
  if (d) return d;
  const r = s / 2;
  const R = Math.ceil(r);
  const pts: number[] = [];
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.01) pts.push(dx, dy);
  d = Int16Array.from(pts);
  discCache.set(s, d);
  return d;
}

/** Normalised rectangle between two corners (inclusive), clipped to the map. */
export function rectBounds(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.min(ax, bx));
  const y0 = Math.max(0, Math.min(ay, by));
  const x1 = Math.min(w - 1, Math.max(ax, bx));
  const y1 = Math.min(h - 1, Math.max(ay, by));
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1 };
}

/** Constrains the drag (ax, ay) → (bx, by) to a square (Shift): returns the new end corner. */
export function squareCorner(ax: number, ay: number, bx: number, by: number): [number, number] {
  const s = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  return [ax + Math.sign(bx - ax || 1) * s, ay + Math.sign(by - ay || 1) * s];
}

/** Calls `f(x, y)` for every tile of the ellipse inscribed in the box (ax, ay)–(bx, by). */
export function forEllipse(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
  f: (x: number, y: number) => void,
): void {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const rx = (x1 - x0 + 1) / 2;
  const ry = (y1 - y0 + 1) / 2;
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    const ny = (y + 0.5 - cy) / ry;
    const span = 1 - ny * ny;
    if (span < 0) continue;
    const half = rx * Math.sqrt(span);
    const xa = Math.max(0, Math.max(x0, Math.ceil(cx - half - 0.5)));
    const xb = Math.min(w - 1, Math.min(x1, Math.floor(cx + half - 0.5)));
    for (let x = xa; x <= xb; x++) f(x, y);
  }
}

/** Flood fill tolerance on the terrain type. */
export type FillTolerance = 'same' | 'family' | 'medium';

/** Families of terrain for the fill's middle tolerance: waters, lowlands, highlands, walls. */
export function terrainFamily(t: number): number {
  switch (t) {
    case T.DeepOcean:
    case T.Shallow:
    case T.Lake:
      return 0;
    case T.Hills:
    case T.Mountain:
    case T.Peaks:
    case T.Glacier:
      return 2;
    case T.Impassable:
      return 3;
    default:
      return 1; // plains, desert, forest, tundra, river
  }
}

/** Whether a tile of terrain `t` joins a fill started on terrain `seed`. */
export function fillMatches(seed: number, t: number, tol: FillTolerance): boolean {
  if (tol === 'same') return t === seed;
  if (tol === 'family') return terrainFamily(t) === terrainFamily(seed);
  return !!IS_WATER[t] === !!IS_WATER[seed];
}

/**
 * The 4-connected region around (x, y) matching the start tile's terrain under `tol`
 * (scanline flood fill). Calls `f(i)` once per tile index. Returns the number of tiles.
 */
export function floodRegion(
  terrain: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  tol: FillTolerance,
  f: (i: number) => void,
): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const seed = terrain[y * w + x]!;
  const ok = new Uint8Array(16);
  for (let t = 0; t < 16; t++) ok[t] = fillMatches(seed, t, tol) ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [x, y];
  let n = 0;
  while (stack.length) {
    const sy = stack.pop()!;
    let sx = stack.pop()!;
    const row = sy * w;
    if (seen[row + sx] || !ok[terrain[row + sx]!]) continue;
    // Run left, then fill rightwards, queuing the rows above and below.
    while (sx > 0 && !seen[row + sx - 1] && ok[terrain[row + sx - 1]!]) sx--;
    let upOpen = false;
    let downOpen = false;
    for (let cx = sx; cx < w; cx++) {
      const i = row + cx;
      if (seen[i] || !ok[terrain[i]!]) break;
      seen[i] = 1;
      f(i);
      n++;
      if (sy > 0) {
        const u = i - w;
        const open = !seen[u] && !!ok[terrain[u]!];
        if (open && !upOpen) stack.push(cx, sy - 1);
        upOpen = open;
      }
      if (sy < h - 1) {
        const d = i + w;
        const open = !seen[d] && !!ok[terrain[d]!];
        if (open && !downOpen) stack.push(cx, sy + 1);
        downOpen = open;
      }
    }
  }
  return n;
}
