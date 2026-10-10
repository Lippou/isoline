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

/** The page's width at zoom 1 in each orientation, as measured there (the visible width). */
const ideal: { landscape?: number; portrait?: number } = {};
const orientation = (): 'landscape' | 'portrait' =>
  window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';

/** The visible width at zoom 1 is known for the way the device is held now. */
export function idealKnown(): boolean {
  return ideal[orientation()] !== undefined;
}

/**
 * The visible screen in CSS pixels at zoom 1, whatever the zoom and orientation: the width the
 * page had at zoom 1 held this way (the screen's own may be wider: Android's buttons take a
 * side in landscape), else the screen's; the height from the layout viewport scaled by the factor
 * the browser actually applied (it fits the layout width to that width).
 */
export function deviceSize(): { w: number; h: number } {
  const o = orientation();
  if (zoomNow >= 0.999 && window.innerWidth > 0) ideal[o] = window.innerWidth;
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const w = ideal[o] ?? (o === 'landscape' ? long : short);
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

/** The screen's edges to keep the interface off (CSS px of the page as laid out now). */
export interface SafeInsets {
  t: number;
  r: number;
  b: number;
  l: number;
}

let probe: HTMLElement | null = null;

/**
 * The notch, the Dynamic Island, the rounded corners and the home bar (viewport-fit=cover lets
 * the map run under them; the panels and buttons stay clear). iOS gives the same inset on both
 * sides in landscape: the island's side keeps it whole, the other only what its rounded corners
 * need. WebKit gives them at zoom 1: the page zoomed out, they are as many more CSS pixels.
 */
export function safeInsets(): SafeInsets {
  if (!tactile) return { t: 0, r: 0, b: 0, l: 0 };
  let raw: SafeInsets;
  const test = (() => {
    try {
      return sessionStorage.getItem('isoline.safeTest');
    } catch {
      return null;
    }
  })();
  if (test) {
    const [t = 0, r = 0, b = 0, l = 0] = test.split(',').map(Number);
    raw = { t, r, b, l };
  } else {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(probe);
    }
    const cs = getComputedStyle(probe);
    raw = {
      t: parseFloat(cs.paddingTop) || 0,
      r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0,
    };
  }
  const f = zoomNow > 0 ? zoomNow : 1;
  let { l, r } = raw;
  if (l > 0 && Math.abs(l - r) < 1) {
    // Landscape: 90° turned the top of the device (the island) to the left, 270° to the right.
    const angle = screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0);
    const corner = Math.round(l * 0.4);
    if (angle === 90) r = corner;
    else if (angle === 270 || angle === -90) l = corner;
  }
  const px = (v: number) => Math.round(v / f);
  return { t: px(raw.t), r: px(r), b: px(raw.b * 0.7), l: px(l) };
}

/** Marks the page for the touch styles (html.tactile) and keeps the browser's own gestures off it. */
export function installTactile(): void {
  if (!tactile) return;
  document.documentElement.classList.add('tactile');
  viewportMeta().content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
  // iOS: a double tap or a pinch outside the map must not zoom the page itself.
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}
