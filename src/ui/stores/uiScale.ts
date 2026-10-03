// Interface scale: how large the whole interface is drawn for a window of a given size.
// The HUD is laid out for a 1600 × 900 window (CSS pixels at scale 1); smaller windows
// (a 13" laptop, 1366 × 768) shrink it a little so the panels keep their room around the
// map, larger ones (1440p and up) grow it. The rest is the layout's job: the HUD's media
// queries fold panels and bars on what is still narrow or short (see GAME_DESIGN.md).
// Pure functions: the reactive part is in viewport.svelte.ts.

/** The window the HUD is designed for, in CSS pixels at scale 1. */
export const REF_W = 1600;
export const REF_H = 900;
/** Bounds of the automatic scale (below 0.85 the HUD's text would drop under 12 px). */
export const AUTO_MIN = 0.85;
export const AUTO_MAX = 1.25;
/** Bounds of the manual scale (Settings › Graphics). */
export const MANUAL_MIN = 0.75;
export const MANUAL_MAX = 1.5;
/** A manual scale never leaves less than this many CSS pixels to lay the HUD out in. */
const MIN_VIEW_W = 1024;
const MIN_VIEW_H = 600;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Rounds a scale so that one CSS pixel covers a whole number of twentieths of a device
 * pixel: borders and the map's canvas stay crisp, and a window resized by a pixel or two
 * does not change the scale.
 */
export function snapScale(s: number, dpr = 1): number {
  const d = dpr > 0 ? dpr : 1;
  return Math.round(s * d * 20) / (d * 20);
}

/**
 * The automatic scale for a window of `w` × `h` CSS pixels (at zoom 1) on a screen of
 * device pixel ratio `dpr`: the fit to 1600 × 900 below it; unchanged from there up to
 * 125 % of it (a 1920 × 1080 screen keeps the design size); beyond, two fifths of the
 * extra room (2560 × 1440: 115 %). Within [0.85, 1.25].
 */
export function autoUiScale(w: number, h: number, dpr = 1): number {
  if (!(w > 0 && h > 0)) return 1;
  const fit = Math.min(w / REF_W, h / REF_H);
  const s = fit <= 1 ? fit : 1 + Math.max(0, fit - 1.25) * 0.4;
  const snapped = snapScale(clamp(s, AUTO_MIN, AUTO_MAX), dpr);
  return clamp(snapped, AUTO_MIN - 0.025, AUTO_MAX);
}

/**
 * The scale in use: the player's (`setting` > 0) or the automatic one (`setting` = 0).
 * A manual scale is limited so the HUD keeps at least 1024 × 600 CSS pixels.
 */
export function effectiveUiScale(setting: number, w: number, h: number, dpr = 1): number {
  if (!(setting > 0)) return autoUiScale(w, h, dpr);
  const manual = clamp(setting, MANUAL_MIN, MANUAL_MAX);
  if (!(w > 0 && h > 0)) return manual;
  const limit = Math.min(w / MIN_VIEW_W, h / MIN_VIEW_H);
  return manual <= limit ? manual : Math.max(MANUAL_MIN, Math.floor(limit * 20) / 20);
}

/**
 * The page zoom of a screen: the scale in a game; the menus (chart paper) only grow with
 * it, never shrink: they reflow instead, and their print is small enough already.
 */
export function zoomFor(scale: number, inGame: boolean): number {
  return inGame ? scale : Math.max(1, scale);
}
