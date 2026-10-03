// Where each country's name sits on the map (and where the camera goes to show it).
import type { Game } from './state';

/** Label anchor per player: [x, y, half-size in tiles]. */
export type Label = [number, number, number];

/**
 * Approximate "pole of inaccessibility" per player on a coarse grid. Countries too small
 * to cover a grid sample still get an anchor on one of their own tiles (size 0.5).
 */
export function computeLabels(g: Game): Map<number, Label> {
  const C = Math.max(4, Math.round(Math.sqrt(g.map.size) / 240));
  const w = Math.ceil(g.map.width / C);
  const h = Math.ceil(g.map.height / C);
  const own = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = Math.min(g.map.width - 1, x * C + (C >> 1));
      const ty = Math.min(g.map.height - 1, y * C + (C >> 1));
      own[y * w + x] = g.owner[ty * g.map.width + tx]!;
    }
  }
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = own[i]!;
    if (o === 0) {
      d[i] = 0;
      continue;
    }
    const x = i % w;
    const edge =
      x === 0 ||
      x === w - 1 ||
      i < w ||
      i >= w * (h - 1) ||
      own[i - 1] !== o ||
      own[i + 1] !== o ||
      own[i - w] !== o ||
      own[i + w] !== o;
    d[i] = edge ? 1 : INF;
  }
  for (let i = 0; i < w * h; i++) {
    if (d[i] === 0) continue;
    const x = i % w;
    if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + 1);
    if (i >= w) d[i] = Math.min(d[i]!, d[i - w]! + 1);
    if (i >= w && x > 0) d[i] = Math.min(d[i]!, d[i - w - 1]! + 1.414);
    if (i >= w && x < w - 1) d[i] = Math.min(d[i]!, d[i - w + 1]! + 1.414);
  }
  for (let i = w * h - 1; i >= 0; i--) {
    if (d[i] === 0) continue;
    const x = i % w;
    if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + 1);
    if (i < w * (h - 1)) d[i] = Math.min(d[i]!, d[i + w]! + 1);
    if (i < w * (h - 1) && x < w - 1) d[i] = Math.min(d[i]!, d[i + w + 1]! + 1.414);
    if (i < w * (h - 1) && x > 0) d[i] = Math.min(d[i]!, d[i + w - 1]! + 1.414);
  }
  const best = new Map<number, Label>();
  for (let i = 0; i < w * h; i++) {
    const o = own[i]!;
    if (o === 0) continue;
    const b = best.get(o);
    if (!b || d[i]! > b[2]) best.set(o, [((i % w) + 0.5) * C, (((i / w) | 0) + 0.5) * C, d[i]!]);
  }
  const labels = new Map<number, Label>();
  for (const [o, [x, y, dist]] of best) labels.set(o, [x, y, dist * C]);
  for (const p of g.players) {
    if (!p || p.tiles === 0 || labels.has(p.id)) continue;
    const t = ownTileNear(g, p.id, ...p.centroid(g.map.width));
    if (t >= 0) labels.set(p.id, [g.map.x(t) + 0.5, g.map.y(t) + 0.5, 0.5]);
  }
  return labels;
}

/** The owned tile of `id` closest to (cx, cy): its border and coast lists hold nearly all of a small country. */
function ownTileNear(g: Game, id: number, cx: number, cy: number): number {
  const p = g.players[id]!;
  let best = -1;
  let bestD = Infinity;
  for (const list of [p.border, p.coast]) {
    for (const t of list) {
      if (g.owner[t] !== id) continue;
      const dx = g.map.x(t) - cx;
      const dy = g.map.y(t) - cy;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = t;
      }
    }
  }
  if (best >= 0) return best;
  // A landlocked enclave with no border tile is impossible, but scan rather than guess.
  for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === id) return t;
  return -1;
}
