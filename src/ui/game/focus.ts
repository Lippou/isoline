// Where the camera goes to show a country (a click on its name in the leaderboard, the
// diplomacy or trade windows, an alliance offer): its centre, a zoom at which it can be
// seen, and the box its land fills (the locator drawn round it, renderer.locate).
//
// 1.14 zoomed by the label alone, capped at ×6: a country of one tile (or a few) sat in
// the middle of the screen as a speck of 6 px, and its spotlight (+8 % ink) did not show.
// Small countries are now measured on the map itself: the camera centres on their land and
// zooms in until it is plain to see.
import type { Label } from '../../core/game/labels';

/** Up to this many tiles a country is measured tile by tile (else by its label). */
export const FOCUS_SMALL = 2500;
/** Zoom range of a focus: never further out than the old floor, never closer than this. */
export const FOCUS_MIN_ZOOM = 1.2;
export const FOCUS_MAX_ZOOM = 20;
/** A small country fills about this share of the view's shorter side. */
const FILL = 0.2;

export interface FocusView {
  /** World point the camera centres on (tile coordinates). */
  x: number;
  y: number;
  zoom: number;
  /** The land's bounding box [x0, y0, x1, y1] (tile edges). */
  box: [number, number, number, number];
}

/**
 * How to show country `id`. `owner`: the map's owners (row-major, `width` wide); `label`:
 * its anchor [x, y, half-size]; `tiles`: its land; `viewW` × `viewH`: the view in pixels.
 * Null when it holds no land (nothing to show).
 */
export function focusView(
  owner: ArrayLike<number>,
  width: number,
  id: number,
  label: Label,
  tiles: number,
  viewW: number,
  viewH: number,
): FocusView | null {
  if (tiles <= 0) return null;
  const [lx, ly, ls] = label;
  if (tiles > FOCUS_SMALL && ls > 0) {
    // A big country: its heart (the label's anchor) filling the view, as before.
    const zoom = clamp(400 / Math.max(10, ls * 4), FOCUS_MIN_ZOOM, 6);
    return { x: lx, y: ly, zoom, box: [lx - ls, ly - ls, lx + ls, ly + ls] };
  }
  const box = landBox(owner, width, id, label, tiles);
  if (!box) {
    if (ls <= 0) return null;
    return { x: lx, y: ly, zoom: FOCUS_MAX_ZOOM, box: [lx - 0.5, ly - 0.5, lx + 0.5, ly + 0.5] };
  }
  const [x0, y0, x1, y1] = box;
  const extent = Math.max(x1 - x0, y1 - y0, 1);
  const zoom = clamp((Math.min(viewW, viewH) * FILL) / extent, FOCUS_MIN_ZOOM, FOCUS_MAX_ZOOM);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom, box };
}

/**
 * The box of `id`'s land around its label (a window of the map: a scattered country is
 * shown where its name is), or anywhere on the map when the label is stale or missing
 * (labels are refreshed every 2 s: a country reduced to one tile may have moved).
 */
function landBox(
  owner: ArrayLike<number>,
  width: number,
  id: number,
  label: Label,
  tiles: number,
): [number, number, number, number] | null {
  const height = Math.floor(owner.length / width);
  const [lx, ly, ls] = label;
  if (ls > 0) {
    const r = Math.ceil(48 + ls * 2 + Math.sqrt(tiles));
    const hit = scan(
      owner,
      width,
      id,
      Math.max(0, Math.floor(lx - r)),
      Math.max(0, Math.floor(ly - r)),
      Math.min(width - 1, Math.ceil(lx + r)),
      Math.min(height - 1, Math.ceil(ly + r)),
    );
    if (hit) return hit;
  }
  return scan(owner, width, id, 0, 0, width - 1, height - 1);
}

function scan(
  owner: ArrayLike<number>,
  width: number,
  id: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = ay; y <= by; y++) {
    const row = y * width;
    for (let x = ax; x <= bx; x++) {
      if (owner[row + x] !== id) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
