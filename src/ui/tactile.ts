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
 * The visible screen in CSS pixels at zoom 1, whatever the zoom and orientation: the visual
 * viewport times its scale (the page zoom actually applied). Nothing to reset to measure it,
 * and Android's buttons or Safari's bars are left out.
 */
export function deviceSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.scale > 0)
    return { w: Math.round(vv.width * vv.scale), h: Math.round(vv.height * vv.scale) };
  const landscape = window.innerWidth > window.innerHeight;
  const w = landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const applied = window.innerWidth > 0 ? w / window.innerWidth : 1;
  return { w, h: Math.round(window.innerHeight * applied) };
}

/** The page zoom the browser actually applies (it may refuse a new one for a moment: iOS). */
export function appliedZoom(): number {
  return window.visualViewport?.scale ?? zoomNow;
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
const metaFor = (f: number, w: number) =>
  f >= 0.999
    ? 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
    : `width=${Math.round(w / f)}, initial-scale=${f}, minimum-scale=${f}, maximum-scale=${f}, viewport-fit=cover`;

let checks: ReturnType<typeof setTimeout>[] = [];
/** Tags given again, by content: twice at most each (a browser that never takes it is left be). */
const retried = new Map<string, number>();

export const touchZoom = {
  get: (): number => zoomNow,
  set: (factor: number): void => {
    const f = Math.min(1, Math.max(TOUCH_SCALE_MIN, factor));
    const { w } = deviceSize();
    zoomNow = f;
    const content = metaFor(f, w);
    const meta = viewportMeta();
    if (meta.content !== content) meta.content = content;
    // iOS may keep its old zoom (after a turn of the phone): checked a few times, and if the
    // zoom has not taken, the tag is given again (through device-width, which it re-reads).
    for (const c of checks) clearTimeout(c);
    checks = [250, 700, 1600].map((ms) =>
      setTimeout(() => {
        if (zoomNow !== f || Math.abs(appliedZoom() - f) < 0.02) return;
        const n = retried.get(content) ?? 0;
        if (n >= 2) return;
        retried.set(content, n + 1);
        const m = viewportMeta();
        m.content = metaFor(1, w);
        requestAnimationFrame(() => (m.content = metaFor(f, deviceSize().w)));
      }, ms),
    );
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
  const f = appliedZoom() > 0 ? appliedZoom() : 1;
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
