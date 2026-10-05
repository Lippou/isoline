// Player inks (standard + colour-blind palettes) and colour helpers.
import { CVD_PALETTES, PLAYER_COLORS, REBEL_INK, TRIBE_COLOR } from './palette';
import { NATIONAL_COLORS } from '../core/data/nationalColors';

export type ColorVision = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToNum([r, g, b]: [number, number, number]): number {
  return (r << 16) | (g << 8) | b;
}

export function inkHex(colorIndex: number, vision: ColorVision): string {
  if (colorIndex === -2) return REBEL_INK;
  if (colorIndex < 0) return TRIBE_COLOR;
  // 100+: a real country's traditional map colour (colour-blind modes use the safe palettes).
  if (colorIndex >= 100 && vision === 'none')
    return NATIONAL_COLORS[colorIndex - 100]?.[1] ?? PLAYER_COLORS[0]!;
  const pal = vision === 'none' ? PLAYER_COLORS : CVD_PALETTES[vision];
  return pal[colorIndex % pal.length]!;
}

export function inkRgb(colorIndex: number, vision: ColorVision): [number, number, number] {
  return hexToRgb(inkHex(colorIndex, vision));
}

export function inkNum(colorIndex: number, vision: ColorVision): number {
  return rgbToNum(inkRgb(colorIndex, vision));
}

export const UI = {
  abyss: 0x15405e, // open sea beyond the map edges (daylight chart)
  slate: 0x16233a,
  aurora: 0x4fe3c1,
  brass: 0xf2b84b,
  signal: 0xff5a5f,
  verdant: 0x7bd88f,
  parchment: 0xeae6da,
} as const;
