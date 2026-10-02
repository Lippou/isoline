// Non-Earth map palettes (map meta `palette`): the shader code of each one (uWorld in
// shaders.ts) and its minimap colours. Visual only — terrain rules are unchanged.
import type { MapPalette } from '../core/map/gamemap';

const CODES: Record<MapPalette, number> = { mars: 1, moon: 2, titan: 3, pixel: 4 };

/** Value of the map shader's uWorld uniform (0 = Earth). */
export function worldCode(palette: MapPalette | undefined): number {
  return palette ? (CODES[palette] ?? 0) : 0;
}

type RGB = [number, number, number];
// Terrain order: deepOcean, shallow, lake, river, plains, hills, mountain, desert, forest, tundra, impassable.
const MINIMAP: Record<MapPalette, RGB[]> = {
  mars: [
    [12, 26, 40],
    [22, 44, 56],
    [26, 50, 62],
    [70, 40, 30],
    [118, 64, 40],
    [98, 56, 38],
    [80, 50, 40],
    [140, 92, 58],
    [90, 52, 34],
    [170, 150, 140],
    [200, 196, 194],
  ],
  moon: [
    [30, 32, 38],
    [44, 46, 52],
    [48, 50, 56],
    [80, 80, 78],
    [108, 107, 102],
    [98, 97, 93],
    [128, 127, 123],
    [126, 125, 120],
    [120, 119, 114],
    [126, 125, 120],
    [150, 150, 148],
  ],
  titan: [
    [14, 12, 12],
    [28, 22, 18],
    [34, 27, 21],
    [36, 27, 20],
    [112, 80, 46],
    [134, 112, 80],
    [146, 132, 108],
    [64, 45, 28],
    [96, 70, 40],
    [100, 84, 62],
    [156, 142, 118],
  ],
  pixel: [
    [26, 62, 170],
    [60, 122, 230],
    [60, 122, 230],
    [50, 110, 230],
    [92, 186, 66],
    [182, 152, 74],
    [140, 130, 124],
    [232, 206, 116],
    [26, 124, 50],
    [226, 232, 244],
    [80, 76, 84],
  ],
};

/** Minimap colours per terrain id for a palette, or null for Earth (the minimap's own). */
export function minimapPalette(palette: MapPalette | undefined): RGB[] | null {
  return palette ? (MINIMAP[palette] ?? null) : null;
}
