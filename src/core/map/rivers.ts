// River network repair for map building (pipeline, editor, generators): rasterised river
// centrelines often stop a few tiles short of the coast (estuaries drawn as land) or break
// into pieces. Ships sail the rivers that reach a sea or a lake (GameMap.navBody), so every
// river fragment within `maxGap` tiles of the sea — or of a river already reaching it — is
// joined to it by carving the shortest land route as river.
import { HARSH, IS_WATER, T } from './terrain';

/**
 * Navigable river tiles (1): every river tile whose river — 4-connected river tiles —
 * touches a sea or a lake. Shared by the simulation (GameMap.navBody) and the renderer.
 */
export function navigableRivers(terrain: Uint8Array, w: number, h: number): Uint8Array {
  const size = w * h;
  const out = new Uint8Array(size);
  const stack: number[] = [];
  const touchesWater = (i: number) => {
    const x = i % w;
    return (
      (x > 0 && IS_WATER[terrain[i - 1]!] === 1) ||
      (x < w - 1 && IS_WATER[terrain[i + 1]!] === 1) ||
      (i >= w && IS_WATER[terrain[i - w]!] === 1) ||
      (i < size - w && IS_WATER[terrain[i + w]!] === 1)
    );
  };
  for (let i = 0; i < size; i++) {
    if (terrain[i] !== T.River || out[i] || !touchesWater(i)) continue;
    out[i] = 1;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      for (const j of [
        x > 0 ? k - 1 : -1,
        x < w - 1 ? k + 1 : -1,
        k >= w ? k - w : -1,
        k < size - w ? k + w : -1,
      ]) {
        if (j < 0 || out[j] || terrain[j] !== T.River) continue;
        out[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/**
 * Joins river fragments to the sea in place; returns the number of tiles turned to river.
 * `minWater`: water bodies smaller than this (ponds, estuary scraps) are not a destination,
 * but a channel may cross them. Two networks that already reach the water are never joined
 * to each other (no invented canals between seas); a fragment joins the nearest one.
 */
export function connectRivers(
  terrain: Uint8Array,
  w: number,
  h: number,
  maxGap: number,
  minWater = 120,
): number {
  const n = w * h;
  // Water bodies and their sizes.
  const wComp = new Int32Array(n).fill(-1);
  const wSize: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (wComp[s] !== -1 || !IS_WATER[terrain[s]!]) continue;
    const id = wSize.length;
    let count = 0;
    wComp[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || wComp[j] !== -1 || !IS_WATER[terrain[j]!]) continue;
        wComp[j] = id;
        stack.push(j);
      }
    }
    wSize.push(count);
  }
  const isSea = (i: number) => wComp[i]! >= 0 && wSize[wComp[i]!]! >= minWater;

  let carved = 0;
  const dist = new Int32Array(n);
  const parent = new Int32Array(n);
  const rComp = new Int32Array(n);
  const queue = new Int32Array(n);
  for (let round = 0; round < 12; round++) {
    // River fragments (4-connected) and whether each already reaches the sea.
    rComp.fill(-1);
    const reaches: boolean[] = [];
    for (let s = 0; s < n; s++) {
      if (rComp[s] !== -1 || terrain[s] !== T.River) continue;
      const id = reaches.length;
      let sea = false;
      rComp[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= n) continue;
          if (isSea(j)) sea = true;
          if (rComp[j] !== -1 || terrain[j] !== T.River) continue;
          rComp[j] = id;
          stack.push(j);
        }
      }
      reaches.push(sea);
    }
    if (!reaches.includes(false)) break;
    // Multi-source BFS (8-connected) from the shore water and every river reaching it.
    dist.fill(-1);
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < n; i++) {
      const src = rComp[i]! >= 0 ? reaches[rComp[i]!]! : isSea(i) && touchesLand(i);
      if (!src) continue;
      dist[i] = 0;
      parent[i] = -1;
      queue[qt++] = i;
    }
    const hit = new Map<number, number>(); // fragment -> first tile reached (nearest)
    while (qh < qt) {
      const i = queue[qh++]!;
      const d = dist[i]!;
      const c = rComp[i]!;
      if (c >= 0 && !reaches[c] && !hit.has(c)) hit.set(c, i);
      if (d >= maxGap) continue;
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (dist[j] !== -1 || HARSH[terrain[j]!] || isSea(j)) continue;
          // Diagonal steps need a corner to carve through.
          if (dx !== 0 && dy !== 0 && HARSH[terrain[y * w + nx]!] && HARSH[terrain[ny * w + x]!]) continue;
          dist[j] = d + 1;
          parent[j] = i;
          queue[qt++] = j;
        }
      }
    }
    if (hit.size === 0) break;
    for (const start of hit.values()) {
      for (let i = start; parent[i] !== -1; i = parent[i]!) {
        const p = parent[i]!;
        carved += carve(i);
        // A diagonal step needs one of its corners open, or the channel would break.
        const ix = i % w;
        const px = p % w;
        if (ix !== px && (i - ix) / w !== (p - px) / w) {
          const a = ((p - px) / w) * w + ix; // (ix, py)
          const b = ((i - ix) / w) * w + px; // (px, iy)
          const open = (t: number) => terrain[t] === T.River || IS_WATER[terrain[t]!] === 1;
          if (!open(a) && !open(b)) carved += carve(!HARSH[terrain[a]!] ? a : b);
        }
      }
    }
  }
  return carved;

  function touchesLand(i: number): boolean {
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
      if (j >= 0 && j < n && !IS_WATER[terrain[j]!]) return true;
    return false;
  }

  function carve(i: number): number {
    const t = terrain[i]!;
    if (t === T.River || HARSH[t] || IS_WATER[t]) return 0;
    terrain[i] = T.River;
    return 1;
  }
}
