// The interface scale, applied: the page zoom follows the window's size (automatic) or
// the player's choice (Settings › Graphics › Interface scale). Zooming the page scales
// every panel, its text, the windows and the map's labels together, and the HUD's media
// queries then see the room actually left (in CSS pixels). See uiScale.ts for the rule.
import { bridge } from '../bridge';
import { settings } from './settings.svelte';
import { effectiveUiScale, autoUiScale, zoomFor } from './uiScale';
import { deviceSize, safeInsets, tactile, touchUiScale } from '../tactile';

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
  /** Touch web version: the edges the interface keeps off (notch, island, home bar), CSS px. */
  safe: { t: 0, r: 0, b: 0, l: 0 },
});

/** Touch web version: the safe edges, as `--safe-t/r/b/l` on the page (0 on a computer). */
function applySafe(): void {
  if (!tactile) return;
  const s = safeInsets();
  const v = view.safe;
  if (s.t !== v.t || s.r !== v.r || s.b !== v.b || s.l !== v.l) view.safe = s;
  const st = document.documentElement.style;
  for (const k of ['t', 'r', 'b', 'l'] as const) st.setProperty(`--safe-${k}`, `${s[k]}px`);
}

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
  // Touch web version: the screen itself (the page is zoomed through the viewport there).
  const d = tactile ? deviceSize() : null;
  const w = d ? d.w : Math.round(window.innerWidth * z);
  const h = d ? d.h : Math.round(window.innerHeight * z);
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
  view.auto = tactile ? touchUiScale(w, h) : autoUiScale(w, h, dpr);
  view.scale = tactile ? view.auto : effectiveUiScale(settings.graphics.uiScale, w, h, dpr);
  // (An emulated screen is shown in the window as it is: scaled by the window's share of it.)
  // Touch web version: the game takes its touch scale (tactile.ts); the menus stay at 100 %
  // (they reflow: Lobby stacks its steps on a narrow screen). A computer keeps zoomFor's rule.
  const base = tactile ? (inGame ? view.scale : 1) : zoomFor(view.scale, inGame);
  const zoom = base * (emulated && view.w > 0 ? view.w / emulated.w : 1);
  view.zoom = zoom;
  if (bridge.zoom && Math.abs(currentZoom() - zoom) > 0.001) bridge.zoom.set(zoom);
  applySafe();
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
  // Touch web version: a turn of the phone, Safari's bars, a zoom that took late — the visual
  // viewport says so (no window resize sometimes on iOS).
  if (tactile) {
    let wait: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(wait);
      wait = setTimeout(applyUiScale, 120);
    };
    window.visualViewport?.addEventListener('resize', later);
    screen.orientation?.addEventListener('change', later);
  }
  applyUiScale();
}
