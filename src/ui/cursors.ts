// Custom cursors (BRAND.md §4): an ink arrow tipped with the logo's brass summit
// diamond; a pointing hand on the map (ink) and on what can be clicked (brass); a sword
// over an enemy country (a click attacks it); surveyor's reticles to place a building
// (brass) or aim a missile (hazard magenta). SVG data URIs, exposed as CSS variables so
// every component can use them.

const INK = '#16324a';
const PAPER = '#f7faf9';
const BRASS = '#c8962b';
const HAZARD = '#e0456f';

const svg = (body: string) =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`,
  )}")`;

/** Arrow (hotspot at the tip, 3 3). */
function arrow(fill: string): string {
  return svg(
    `<path d="M3.5 3.5 L3.5 24 L9 18.8 L12.6 27 L16.4 25.4 L12.9 17.4 L20.5 17.4 Z" fill="${fill}" stroke="${PAPER}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M3.5 1.2 L5.8 3.5 L3.5 5.8 L1.2 3.5 Z" fill="${BRASS}" stroke="${PAPER}" stroke-width="0.9"/>`,
  );
}

/**
 * Pointing hand, index finger up (hotspot at the fingertip, 12 2). Drawn twice: a paper
 * outline under all the parts, then the parts filled, so they merge into one silhouette.
 */
function hand(fill: string): string {
  const parts =
    `<rect x="10" y="1.5" width="5" height="17" rx="2.5"/>` +
    `<rect x="14.6" y="9.5" width="4.6" height="11" rx="2.3"/>` +
    `<rect x="18.8" y="11" width="4.4" height="10" rx="2.2"/>` +
    `<rect x="22.8" y="13" width="4" height="8.5" rx="2"/>` +
    `<path d="M10 15.5 H26.8 V22 C26.8 27 23.8 30 19 30 H15.2 C11.7 30 9.7 28.2 8.2 25.7 L4.7 19.9 C4 18.7 4.4 17.2 5.6 16.6 C6.7 16 8 16.4 8.7 17.4 L10 19.4 Z"/>`;
  return svg(
    `<g fill="${PAPER}" stroke="${PAPER}" stroke-width="3" stroke-linejoin="round">${parts}</g>` +
      `<g fill="${fill}">${parts}</g>` +
      `<path d="M14.8 15.5 V19 M19 16 V20 M23 16.5 V20.5" stroke="${PAPER}" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>`,
  );
}

/** Sword, point up-left (hotspot at the point, 3 3): steel blade, brass guard and pommel. */
function sword(): string {
  const blade = 'M3 3 L8 4.3 L21.2 17.5 L17.5 21.2 L4.3 8 Z';
  return svg(
    `<path d="${blade}" fill="${PAPER}" stroke="${PAPER}" stroke-width="3.4" stroke-linejoin="round"/>` +
      `<path d="M15 25.4 L25.4 15" stroke="${PAPER}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="M21 21 L26.6 26.6" stroke="${PAPER}" stroke-width="6" stroke-linecap="round"/>` +
      `<path d="${blade}" fill="#dfe7eb" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>` +
      `<path d="M5 5 L18.8 18.8" stroke="${INK}" stroke-width="0.8" opacity="0.45"/>` +
      `<path d="M15 25.4 L25.4 15" stroke="${BRASS}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path d="M21 21 L26 26" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<circle cx="27.4" cy="27.4" r="2.6" fill="${BRASS}" stroke="${PAPER}" stroke-width="1"/>`,
  );
}

/** Surveyor's reticle (hotspot at the centre, 16 16). */
function reticle(color: string): string {
  const tick = (d: string) =>
    `<path d="${d}" stroke="${PAPER}" stroke-width="4" stroke-linecap="round"/><path d="${d}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
  return svg(
    `<circle cx="16" cy="16" r="9" fill="none" stroke="${PAPER}" stroke-width="4"/>` +
      `<circle cx="16" cy="16" r="9" fill="none" stroke="${color}" stroke-width="2"/>` +
      tick('M16 2.5 V8') +
      tick('M16 24 V29.5') +
      tick('M2.5 16 H8') +
      tick('M24 16 H29.5') +
      `<path d="M16 13.6 L18.4 16 L16 18.4 L13.6 16 Z" fill="${BRASS}" stroke="${PAPER}" stroke-width="0.8"/>`,
  );
}

export const CURSORS = {
  default: `${arrow(INK)} 3 3, auto`,
  pointer: `${hand(BRASS)} 12 2, pointer`,
  map: `${hand(INK)} 12 2, pointer`,
  attack: `${sword()} 3 3, crosshair`,
  build: `${reticle(BRASS)} 16 16, crosshair`,
  aim: `${reticle(HAZARD)} 16 16, crosshair`,
} as const;

/** Publishes the cursors as CSS variables (--cursor-default, --cursor-pointer…). */
export function installCursors(): void {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(CURSORS)) root.setProperty(`--cursor-${k}`, v);
}
