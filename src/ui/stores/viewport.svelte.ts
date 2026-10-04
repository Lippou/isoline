// The interface scale, applied: the page zoom follows the window's size (automatic) or
// the player's choice (Settings › Graphics › Interface scale). Zooming the page scales
// every panel, its text, the windows and the map's labels together, and the HUD's media
// queries then see the room actually left (in CSS pixels). See uiScale.ts for the rule.
import { bridge } from '../bridge';
import { settings } from './settings.svelte';
import { effectiveUiScale, autoUiScale, zoomFor } from './uiScale';

export const view = $state({
  /** The automatic scale for this window (shown next to the setting). */
  auto: 1,
  /** The scale in use (automatic or the player's). */
  scale: 1,
  /** The page zoom applied now (the menus never shrink: see zoomFor). */
  zoom: 1,
  /** The window, in CSS pixels at zoom 1. */
  w: 0,
  h: 0,
});

let inGame = false;
/** Device pixel ratio of the screen itself (at zoom 1). */
let baseDpr = 1;

const currentZoom = () => bridge.zoom?.get() ?? 1;

/**
 * QA (?automation): the interface laid out as on a screen of `w` × `h` pixels at device
 * pixel ratio `dpr`, shown scaled down in the real window (whose proportions the script
 * matches). Lets a 1920 × 1080 desk check a 4K or ultrawide layout. Null: the real window.
 */
let emulated: { w: number; h: number; dpr: number } | null = null;
export function emulateScreen(w = 0, h = 0, dpr = 1): void {
  emulated = w > 0 && h > 0 ? { w, h, dpr: dpr > 0 ? dpr : 1 } : null;
  applyUiScale();
}

/** Reads the window's size at zoom 1 (a pixel or two of rounding is ignored). */
function measure(): void {
  const z = currentZoom();
  const w = Math.round(window.innerWidth * z);
  const h = Math.round(window.innerHeight * z);
  if (Math.abs(w - view.w) > 2 || Math.abs(h - view.h) > 2) {
    view.w = w;
    view.h = h;
  }
  baseDpr = (window.devicePixelRatio || 1) / z;
}

/** Computes the scale and zooms the page to it (after a resize, a setting, a screen change). */
export function applyUiScale(): void {
  measure();
  const w = emulated?.w ?? view.w;
  const h = emulated?.h ?? view.h;
  const dpr = emulated?.dpr ?? baseDpr;
  view.auto = autoUiScale(w, h, dpr);
  view.scale = effectiveUiScale(settings.graphics.uiScale, w, h, dpr);
  // (An emulated screen is shown in the window as it is: scaled by the window's share of it.)
  const zoom = zoomFor(view.scale, inGame) * (emulated && view.w > 0 ? view.w / emulated.w : 1);
  view.zoom = zoom;
  if (bridge.zoom && Math.abs(currentZoom() - zoom) > 0.001) bridge.zoom.set(zoom);
}

/** The game screen takes the full scale; the menus only grow with it. */
export function setInGame(on: boolean): void {
  if (on === inGame) return;
  inGame = on;
  applyUiScale();
}

let started = false;
/** Follows the window's size from now on. */
export function startViewport(): void {
  if (started) return;
  started = true;
  window.addEventListener('resize', applyUiScale);
  applyUiScale();
}
