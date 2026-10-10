// Touch devices (phones, tablets without a mouse or trackpad): the web version's touch mode.
// Everything here is gated on `tactile`, which is false on a computer — and always false in
// the desktop app (Electron has its own bridge and never reads this): the PC game is unchanged.

/**
 * A device whose only pointer is a finger. An iPad with a trackpad or a mouse plugged in reports
 * a fine pointer too and keeps the computer controls (hover, right click, wheel).
 */
export const tactile =
  typeof window !== 'undefined' &&
  !window.isoline &&
  typeof matchMedia === 'function' &&
  matchMedia('(pointer: coarse)').matches &&
  !matchMedia('(any-pointer: fine)').matches;

/** The HUD needs at least this much room (CSS px) to lay out; a phone gets a smaller scale. */
const TOUCH_MIN_W = 1100;
const TOUCH_MIN_H = 560;
const TOUCH_SCALE_MIN = 0.55;

/**
 * The interface scale on a touch screen of `w` × `h` CSS pixels (at zoom 1): the desktop rule
 * stops at 85 % (a laptop), a phone needs less to keep the panels around the map.
 */
export function touchUiScale(w: number, h: number): number {
  if (!(w > 0 && h > 0)) return 1;
  const s = Math.min(1, w / TOUCH_MIN_W, h / TOUCH_MIN_H);
  return Math.max(TOUCH_SCALE_MIN, Math.round(s * 40) / 40);
}

let zoomNow = 1;

/**
 * The visible screen in CSS pixels at zoom 1, whatever the zoom and orientation: the width from
 * the screen (portrait or landscape), the height from the layout viewport scaled by the factor the
 * browser actually applied (it fits the layout width to the screen width).
 */
export function deviceSize(): { w: number; h: number } {
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const landscape = window.innerWidth > window.innerHeight;
  const w = landscape ? long : short;
  const applied = window.innerWidth > 0 ? w / window.innerWidth : 1;
  return { w, h: Math.round(window.innerHeight * applied) };
}

function viewportMeta(): HTMLMetaElement {
  let m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!m) {
    m = document.createElement('meta');
    m.name = 'viewport';
    document.head.appendChild(m);
  }
  return m;
}

/**
 * Page zoom for the touch web version (the desktop app zooms with webFrame): the layout viewport
 * is widened by 1 / factor and the browser fits it to the screen, so every CSS pixel shrinks
 * together and the HUD's media queries see the room actually left — exactly like the app's zoom.
 */
export const touchZoom = {
  get: (): number => zoomNow,
  set: (factor: number): void => {
    const f = Math.min(1, Math.max(TOUCH_SCALE_MIN, factor));
    const { w } = deviceSize();
    zoomNow = f;
    viewportMeta().content =
      f >= 0.999
        ? 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
        : `width=${Math.round(w / f)}, initial-scale=${f}, maximum-scale=${f}, viewport-fit=cover`;
  },
};

/** Marks the page for the touch styles (html.tactile) and keeps the browser's own gestures off it. */
export function installTactile(): void {
  if (!tactile) return;
  document.documentElement.classList.add('tactile');
  viewportMeta().content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
  // iOS: a double tap or a pinch outside the map must not zoom the page itself.
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}
