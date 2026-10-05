// Which of a map's nations take part when the lobby asks for fewer than the map lists.
// Before 1.15 the game kept the N most populous, so a 30-nation World had no Algeria, no
// Morocco, no Greenland and whole regions stayed empty (« je vois jamais Algérie, Maroc »).
// The pick now covers the map: each nation is worth the land around it (its `room`, measured
// when the map is built), a little of its importance, and how far it stands from the nations
// already picked; a remote islet is worth little because its room is small. Deterministic:
// the same nations, map and seed always give the same pick (the lobby shows it before launch).
import { IS_LAND } from './terrain';
import type { MapMeta } from './gamemap';

export interface PickableNation {
  x: number;
  y: number;
  /** Importance (population / area). */
  weight: number;
  /** Land tiles closer to this nation than to any other of the map (build time). */
  room?: number;
}

/** 0 ≤ u < 1 from a seed and an index (deterministic, platform-independent). */
function unit(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The `count` nations of a game, in pick order (all of them, in list order, when the map has
 * no more than `count`). Greedy cover: score = room^0.3 × √weight × jitter (±15 %) × proximity, where
 * proximity = min(1, distance to the nearest nation already picked ÷ the spacing that
 * `count` nations would have on the land), so neighbours of a picked nation wait their turn.
 */
export function pickNations<N extends PickableNation>(
  nations: readonly N[],
  count: number,
  seed: number,
  width: number,
  height: number,
): N[] {
  if (count <= 0) return [];
  if (count >= nations.length) return [...nations];
  // Spacing of `count` nations over the land (the rooms add up to the land; without them,
  // assume 40 % of the map is land).
  let land = 0;
  for (const n of nations) land += n.room ?? 0;
  if (land <= 0) land = width * height * 0.4;
  const spacing = Math.sqrt(land / count);
  const base = nations.map(
    (n, k) =>
      Math.pow(Math.max(1, n.room ?? 1), 0.3) *
      Math.sqrt(Math.max(1, n.weight)) *
      (0.85 + 0.3 * unit(seed, k)),
  );
  const dmin = new Float64Array(nations.length).fill(Infinity);
  const taken = new Uint8Array(nations.length);
  const out: N[] = [];
  while (out.length < count) {
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < nations.length; k++) {
      if (taken[k]) continue;
      const s = base[k]! * Math.min(1, dmin[k]! / spacing);
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    if (best < 0) break;
    const p = nations[best]!;
    taken[best] = 1;
    out.push(p);
    for (let k = 0; k < nations.length; k++) {
      if (taken[k]) continue;
      const d = Math.hypot(nations[k]!.x - p.x, nations[k]!.y - p.y);
      if (d < dmin[k]!) dmin[k] = d;
    }
  }
  return out;
}

/**
 * Each nation's room: land tiles (sampled on a grid) closer to it than to any other nation.
 * Stored in the map file by the builder and the procedural generator.
 */
export function nationRooms(
  terrain: Uint8Array,
  w: number,
  h: number,
  nations: readonly { x: number; y: number }[],
): number[] {
  const rooms = nations.map(() => 0);
  if (!nations.length) return rooms;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 200_000)));
  const xs = nations.map((n) => n.x);
  const ys = nations.map((n) => n.y);
  for (let y = step >> 1; y < h; y += step)
    for (let x = step >> 1; x < w; x += step) {
      if (!IS_LAND[terrain[y * w + x]!]) continue;
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < xs.length; k++) {
        const d = (xs[k]! - x) ** 2 + (ys[k]! - y) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      rooms[best]! += step * step;
    }
  return rooms;
}

/**
 * Nations of a default lobby game on a map, at least 30 (the old default) and at most the
 * map's list: one per 9 000 land tiles on a big map (a 52-tile spawn disc and room to grow:
 * 173 on the Giant World), fewer on smaller ones, where each nation gets 9 000 × √(1.5 M ÷
 * land) tiles (World: 14 000, 43 nations). Measured (scripts/pacing.ts, Normal, 3 seeds):
 * the World at 68 nations ran to 49, 60 and 88 min; at 43, 45 to 50 min.
 */
export const LAND_PER_DEFAULT_NATION = 9000;
export function defaultNationCount(landTiles: number, listed: number): number {
  const perNation = LAND_PER_DEFAULT_NATION * Math.max(1, Math.sqrt(1_500_000 / Math.max(1, landTiles)));
  return Math.min(listed, Math.max(30, Math.round(landTiles / perNation)));
}

/** Fills each nation's room and the map's default nation count (every map builder calls it). */
export function settleNations(meta: MapMeta, terrain: Uint8Array): void {
  const { width: w, height: h } = meta;
  const rooms = nationRooms(terrain, w, h, meta.nations);
  meta.nations.forEach((n, k) => (n.room = rooms[k]!));
  let land = 0;
  for (let i = 0; i < w * h; i++) if (IS_LAND[terrain[i]!]) land++;
  meta.defaultNations = defaultNationCount(land, meta.nations.length);
}
