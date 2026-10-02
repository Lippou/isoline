// Custom cursors (BRAND.md §4): an ink arrow tipped with the logo's brass summit
// diamond, a brass variant for clickable things, and surveyor's reticles on the map
// (ink by default, brass to build, hazard magenta to aim a missile). SVG data URIs,
// exposed as CSS variables so every component can use them.

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
  pointer: `${arrow(BRASS)} 3 3, pointer`,
  map: `${reticle(INK)} 16 16, crosshair`,
  build: `${reticle(BRASS)} 16 16, crosshair`,
  aim: `${reticle(HAZARD)} 16 16, crosshair`,
} as const;

/** Publishes the cursors as CSS variables (--cursor-default, --cursor-pointer…). */
export function installCursors(): void {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(CURSORS)) root.setProperty(`--cursor-${k}`, v);
}
