// Procedural map generator (lobby "Procedural" category, and the fictional
// built-in maps Pangaea / Archipelago / Two Lakes, plus the Labyrinth arcade map).
import { Noise2D } from '../noise';
import { Rng } from '../rng';
import { inventNationName } from '../names';
import { GameMap, type MapMeta, type NationSpawn } from './gamemap';
import { generateDeposits, generateSpawnPoints, synthesize } from './synth';
import { IS_LAND, T } from './terrain';
import { minIslandTiles, removeSmallIslands } from './islands';
import { settleNations } from './nationPick';

export interface GenParams {
  seed: number;
  width: number;
  height: number;
  /** Target land fraction 0.15 … 0.8. */
  landRatio: number;
  /** 0 = one or two big continents, 1 = scattered archipelago. */
  islands: number;
  /** 0 = flat, 1 = very mountainous. */
  mountains: number;
  /** 0 = none, 1 = many rivers. */
  rivers: number;
  /** Optional shape: 'pangaea' | 'twoLakes' | undefined. */
  shape?: 'pangaea' | 'twoLakes';
  nations?: number;
  /** Pseudo-latitudes of the top and bottom rows (climate). */
  latTop?: number;
  latBottom?: number;
}

export function defaultGenParams(seed: number): GenParams {
  return {
    seed,
    width: 1200,
    height: 800,
    landRatio: 0.42,
    islands: 0.35,
    mountains: 0.5,
    rivers: 0.5,
    nations: 40,
  };
}

/** Threshold so that a fraction `ratio` of values is above it. */
function quantileThreshold(values: Float32Array, ratio: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(values.length / 60000));
  for (let i = 0; i < values.length; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor((1 - ratio) * sample.length)))]!;
}

export function generateMapData(p: GenParams): { meta: MapMeta; terrain: Uint8Array; elevation: Uint8Array } {
  const { width: w, height: h, seed } = p;
  const n = w * h;
  const noise = new Noise2D(seed);
  const noiseB = new Noise2D(seed + 101);
  const rng = new Rng(seed);
  const pxKm = (9000 / Math.sqrt(n)) * 1.6; // nominal scale: bigger maps = finer pixels

  // Continental field: low-frequency fbm, island noise, edge falloff.
  const field = new Float32Array(n);
  const contFreq = 2.2 / Math.max(w, h);
  const islFreq = (8 + 18 * p.islands) / Math.max(w, h);
  const blobs: [number, number, number][] = [];
  const blobCount = p.shape === 'pangaea' ? 1 : 1 + Math.round((1 - p.islands) * 3);
  for (let b = 0; b < blobCount; b++) {
    blobs.push([rng.range(0.25, 0.75) * w, rng.range(0.3, 0.7) * h, rng.range(0.22, 0.38) * Math.min(w, h)]);
  }
  if (p.shape === 'pangaea') blobs[0] = [w / 2, h / 2, Math.min(w, h) * 0.48];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = x / w - 0.5;
      const ny = y / h - 0.5;
      const edge = Math.max(Math.abs(nx) * 2, Math.abs(ny) * 2);
      let blob = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot((x - bx) / (br * (w / h > 1.4 ? 1.35 : 1)), (y - by) / br);
        blob = Math.max(blob, 1 - d);
      }
      const cont = noise.fbm(x * contFreq, y * contFreq, 5);
      const isl = noiseB.fbm(x * islFreq, y * islFreq, 4);
      let v = cont * (1 - p.islands * 0.6) + isl * (0.25 + p.islands * 0.75) + blob * (0.9 - p.islands * 0.7);
      v -= Math.pow(Math.max(0, edge - 0.72) / 0.28, 2) * 1.2; // keep an ocean rim
      field[i] = v;
    }
  }
  const thr = quantileThreshold(field, p.landRatio);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = field[i]! > thr ? 1 : 0;

  // Lakes for the "Two Lakes" layout: carve two big organic lakes in the continent.
  let lake: Uint8Array | undefined;
  if (p.shape === 'twoLakes') {
    lake = new Uint8Array(n);
    const centres: [number, number][] = [
      [w * 0.32, h * 0.5],
      [w * 0.68, h * 0.5],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        land[i] = 1; // the whole map is one continent with two inland seas
        const nx = x / w - 0.5;
        const ny = y / h - 0.5;
        if (Math.max(Math.abs(nx), Math.abs(ny)) > 0.485) land[i] = 0;
        for (const [cx, cy] of centres) {
          const r = Math.min(w, h) * 0.24 * (1 + 0.28 * noise.fbm(x * 0.012, y * 0.012, 4));
          if (Math.hypot(x - cx, (y - cy) * 1.15) < r) {
            land[i] = 0;
            lake[i] = 1;
          }
        }
      }
    }
  }

  // Specks under the island floor become sea or lake (islands.ts, as the shipped maps).
  removeSmallIslands(land, w, h, minIslandTiles(w, h), lake ? { lake } : {});

  // Mountains from ridged noise; rivers by steepest descent.
  const mountains = new Uint8Array(n);
  const mFreq = 6 / Math.max(w, h);
  const ridgeField = new Float32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    ridgeField[i] = noiseB.ridged(x * mFreq + 7, y * mFreq - 3, 4);
  }
  let landTiles = 0;
  for (let i = 0; i < n; i++) if (land[i]) landTiles++;
  const mThr = quantileThreshold(ridgeField, ((0.03 + 0.09 * p.mountains) * landTiles) / n);
  for (let i = 0; i < n; i++) if (land[i] && ridgeField[i]! > mThr) mountains[i] = 1;
  const latTop = p.latTop ?? 62;
  const latBottom = p.latBottom ?? -52;
  const latitude = (_x: number, y: number) => latTop + (y / h) * (latBottom - latTop);
  const common = { width: w, height: h, seed, pxKm, land, lake, latitude, mountains, moistureNoise: 0.34 };
  const pre = synthesize(common);
  const rivers = new Uint8Array(n);
  const parent = flowParents(land, pre.elevation, w, h);
  const riverCount = Math.round((p.rivers * Math.sqrt(n)) / 30);
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
      if (rivers[i]) break; // joined another river
    }
    if (path.length > 25) for (const j of path) rivers[j] = 1;
  }
  const out = synthesize({ ...common, rivers });

  // Remove tiny unreachable islands of impassable-only land and enclosed seas → lakes.
  markEnclosedLakes(out.terrain, w, h);

  const nations = placeNations(out.terrain, w, h, rng, p.nations ?? 40);
  const meta: MapMeta = {
    id: `procedural-${seed}`,
    name: { fr: `Monde procédural #${seed % 100000}`, en: `Procedural world #${seed % 100000}` },
    category: 'procedural',
    width: w,
    height: h,
    nations,
    spawnPoints: generateSpawnPoints(w, h, out.terrain, seed),
    deposits: generateDeposits(w, h, out.terrain, seed),
  };
  settleNations(meta, out.terrain);
  return { meta, terrain: out.terrain, elevation: out.elevation };
}

/**
 * Priority-flood drainage: every land tile gets a downstream neighbour such that
 * following parents always reaches the sea (pits are filled implicitly).
 */
export function flowParents(land: Uint8Array, elev: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const parent = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heapI: number[] = [];
  const heapE: number[] = [];
  const push = (i: number, e: number) => {
    let k = heapI.length;
    heapI.push(i);
    heapE.push(e);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapE[p]! <= e) break;
      heapI[k] = heapI[p]!;
      heapE[k] = heapE[p]!;
      k = p;
    }
    heapI[k] = i;
    heapE[k] = e;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heapI[0]!, heapE[0]!];
    const li = heapI.pop()!;
    const le = heapE.pop()!;
    if (heapI.length) {
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= heapI.length) break;
        if (c + 1 < heapI.length && heapE[c + 1]! < heapE[c]!) c++;
        if (heapE[c]! >= le) break;
        heapI[k] = heapI[c]!;
        heapE[k] = heapE[c]!;
        k = c;
      }
      heapI[k] = li;
      heapE[k] = le;
    }
    return top;
  };
  for (let i = 0; i < n; i++) {
    if (!land[i]) {
      done[i] = 1;
      continue;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    const x = i % w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of nb) {
      if (j >= 0 && j < n && !land[j]) {
        parent[i] = j;
        done[i] = 1;
        push(i, elev[i]!);
        break;
      }
    }
  }
  while (heapI.length) {
    const [i, e] = pop();
    const x = i % w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of nb) {
      if (j < 0 || j >= n || done[j]) continue;
      done[j] = 1;
      parent[j] = i;
      push(j, Math.max(e, elev[j]!) + 0.01);
    }
  }
  return parent;
}

/** Water bodies that never touch the map border become lakes. */
export function markEnclosedLakes(terrain: Uint8Array, w: number, h: number): void {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const isW = (t: number) => t === T.DeepOcean || t === T.Shallow || t === T.Lake;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !isW(terrain[s]!)) continue;
    const comp: number[] = [];
    let border = false;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || seen[j] || !isW(terrain[j]!)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (!border) for (const i of comp) terrain[i] = T.Lake;
  }
}

function placeNations(terrain: Uint8Array, w: number, h: number, rng: Rng, count: number): NationSpawn[] {
  const spots = generateSpawnPoints(w, h, terrain, rng.nextU32(), count * 2);
  rng.shuffle(spots);
  return spots.slice(0, count).map(([x, y], k) => ({
    name: inventNationName(rng),
    x,
    y,
    flagSeed: rng.nextU32(),
    weight: count - k,
  }));
}

export function generateMap(p: GenParams): GameMap {
  const d = generateMapData(p);
  return new GameMap(d.meta, d.terrain, d.elevation);
}

/** Arcade "Labyrinth": a maze of land corridors, walls and canals. */
export function generateLabyrinth(
  seed: number,
  cellsX = 24,
  cellsY = 16,
  cellPx = 40,
): {
  meta: MapMeta;
  terrain: Uint8Array;
  elevation: Uint8Array;
} {
  const rng = new Rng(seed);
  const noise = new Noise2D(seed);
  const w = cellsX * cellPx;
  const h = cellsY * cellPx;
  const terrain = new Uint8Array(w * h).fill(T.Plains);
  const elevation = new Uint8Array(w * h);
  // Recursive-backtracker maze over cells; walls between unvisited neighbours.
  const visited = new Uint8Array(cellsX * cellsY);
  const openE = new Uint8Array(cellsX * cellsY);
  const openS = new Uint8Array(cellsX * cellsY);
  const stack: number[] = [0];
  visited[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1]!;
    const cx = c % cellsX;
    const cy = (c / cellsX) | 0;
    const nb: [number, number][] = [];
    if (cx > 0 && !visited[c - 1]) nb.push([c - 1, 0]);
    if (cx < cellsX - 1 && !visited[c + 1]) nb.push([c + 1, 1]);
    if (cy > 0 && !visited[c - cellsX]) nb.push([c - cellsX, 2]);
    if (cy < cellsY - 1 && !visited[c + cellsX]) nb.push([c + cellsX, 3]);
    if (!nb.length) {
      stack.pop();
      continue;
    }
    const [m, dir] = rng.pick(nb);
    if (dir === 0) openE[m] = 1;
    else if (dir === 1) openE[c] = 1;
    else if (dir === 2) openS[m] = 1;
    else openS[c] = 1;
    visited[m] = 1;
    stack.push(m);
  }
  // Knock out ~12% extra walls so the maze has loops (more tactical).
  for (let c = 0; c < cellsX * cellsY; c++) {
    if (rng.chance(0.12)) openE[c] = 1;
    if (rng.chance(0.12)) openS[c] = 1;
  }
  const wall = Math.max(3, Math.round(cellPx * 0.16));
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const c = cy * cellsX + cx;
      const x0 = cx * cellPx;
      const y0 = cy * cellPx;
      // Every 5th wall is a canal (navigable water) instead of a wall.
      const canal = (cx * 7 + cy * 3) % 5 === 0;
      const fill = (xa: number, ya: number, xb: number, yb: number, t: number) => {
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) terrain[y * w + x] = t;
      };
      if (!openE[c]) fill(x0 + cellPx - wall, y0, x0 + cellPx, y0 + cellPx, canal ? T.Shallow : T.Impassable);
      if (!openS[c]) fill(x0, y0 + cellPx - wall, x0 + cellPx, y0 + cellPx, canal ? T.Shallow : T.Impassable);
      fill(x0 + cellPx - wall, y0 + cellPx - wall, x0 + cellPx, y0 + cellPx, T.Impassable);
      // Room flavour.
      const flavour = rng.weighted([5, 2, 1.5, 1.2, 1]);
      const room = [T.Plains, T.Forest, T.Hills, T.Desert, T.Mountain][flavour]!;
      for (let y = y0 + 4; y < y0 + cellPx - wall - 4; y++)
        for (let x = x0 + 4; x < x0 + cellPx - wall - 4; x++)
          if (noise.get(x * 0.08, y * 0.08) > -0.1) terrain[y * w + x] = room;
    }
  }
  // Outer frame of walls.
  for (let x = 0; x < w; x++) {
    terrain[x] = T.Impassable;
    terrain[(h - 1) * w + x] = T.Impassable;
  }
  for (let y = 0; y < h; y++) {
    terrain[y * w] = T.Impassable;
    terrain[y * w + w - 1] = T.Impassable;
  }
  for (let i = 0; i < w * h; i++) {
    const t = terrain[i]!;
    const x = i % w;
    const y = (i / w) | 0;
    const base = t === T.Mountain ? 210 : t === T.Hills ? 140 : t === T.Impassable ? 250 : 60;
    elevation[i] =
      IS_LAND[t] || t === T.Impassable
        ? Math.min(255, base + Math.round(noise.fbm(x * 0.05, y * 0.05) * 25))
        : 0;
  }
  const nations = placeNations(terrain, w, h, rng, 24);
  const meta: MapMeta = {
    id: 'labyrinth',
    name: { fr: 'Labyrinthe', en: 'Labyrinth' },
    category: 'arcade',
    width: w,
    height: h,
    nations,
    spawnPoints: generateSpawnPoints(w, h, terrain, seed, 200),
    deposits: generateDeposits(w, h, terrain, seed, 1.4),
  };
  settleNations(meta, terrain);
  return { meta, terrain, elevation };
}
