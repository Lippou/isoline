// Pixels of the editor's plate: one pixel per tile, coloured by terrain, lit by altitude
// and a light hill shade, with optional motifs (a pattern per terrain, for colour-blind
// reading). Only the changed box is recomputed: painting stays smooth on a 3200 × 1612 map.
import { IS_LAND, T, TERRAIN_COUNT } from '../../core/map/terrain';
import { EDITOR_COLORS } from './editorModel';
import type { Box } from './history';

/**
 * Motif of a terrain at tile (x, y): 0 plain, -1 darker ink, +1 lighter. Patterns are a
 * few tiles wide, so they show from a moderate zoom and fade into a tint when far.
 */
export function motif(t: number, x: number, y: number): number {
  switch (t) {
    case T.Shallow:
      return y % 4 === 0 && (x + ((y >> 2) & 1) * 3) % 6 < 3 ? 1 : 0; // dashes: ripples
    case T.Lake:
      return (x + y) % 5 === 0 ? 1 : 0; // fine diagonals
    case T.Desert:
      return (x * 3 + y * 7) % 11 === 0 ? -1 : 0; // stipple
    case T.Forest:
      return x % 3 === 1 && y % 3 === 1 ? -1 : 0; // dots: trees
    case T.Tundra:
      return (x + 2 * y) % 7 === 0 ? -1 : 0;
    case T.Hills:
      return y % 5 === 0 && x % 6 < 3 ? -1 : 0; // short dashes
    case T.Mountain:
      return (x + y) % 6 === 0 || (x - y + 600) % 6 === 0 ? -1 : 0; // cross hatch
    case T.Peaks:
      return (x + y) % 4 === 0 ? 1 : 0;
    case T.Glacier:
      return (x - y + 400) % 5 === 0 ? -1 : 0;
    case T.Impassable:
      return (x + y) % 3 === 0 ? 1 : 0;
    default:
      return 0;
  }
}

/** Writes the RGBA pixels of the tiles in `box` (grown by one for the hill shade). */
export function paintPixels(
  terrain: Uint8Array,
  elevation: Uint8Array,
  w: number,
  h: number,
  out: Uint8ClampedArray,
  box: Box,
  motifs: boolean,
): Box {
  const x0 = Math.max(0, box.x0 - 1);
  const y0 = Math.max(0, box.y0 - 1);
  const x1 = Math.min(w - 1, box.x1 + 1);
  const y1 = Math.min(h - 1, box.y1 + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0, i = y * w + x0; x <= x1; x++, i++) {
      const t = terrain[i]! < TERRAIN_COUNT ? terrain[i]! : 0;
      const c = EDITOR_COLORS[t]!;
      let k = 1;
      if (IS_LAND[t]) {
        const e = elevation[i]!;
        const n = x > 0 && y > 0 ? elevation[i - w - 1]! : e;
        k = 0.86 + (e / 255) * 0.26 + Math.max(-0.14, Math.min(0.14, (e - n) * 0.012));
      }
      if (motifs) {
        const m = motif(t, x, y);
        if (m) k *= m > 0 ? 1.22 : 0.74;
      }
      const p = i * 4;
      out[p] = c[0] * k;
      out[p + 1] = c[1] * k;
      out[p + 2] = c[2] * k;
      out[p + 3] = 255;
    }
  }
  return { x0, y0, x1, y1 };
}
