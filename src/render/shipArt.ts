// Top-down ship artwork (« Levé hydrographique »): one family of crisp silhouettes drawn
// as SVG, bow to the right (+x). Each ship is three layers on the same canvas:
//   base: soft shadow + navy outline + hull sides (neutral)
//   mark: the parts painted in the owner's colour (white, tinted at runtime)
//   top:  superstructure, cargo and deck details (neutral) over the owner's colour
// Warship turrets are separate sprites so they can train on a target.

/** Ship canvas, in SVG units; rasterised at SHIP_RASTER px per unit. */
export const SHIP_W = 128;
export const SHIP_H = 40;
export const SHIP_RASTER = 4;
/** Turret canvas (pivot at TURRET_PIVOT_X, mid-height). */
export const TURRET_W = 32;
export const TURRET_H = 16;
export const TURRET_PIVOT_X = 10;
/** Wake canvas: apex at the right edge, mid-height. */
export const WAKE_W = 64;
export const WAKE_H = 32;

export interface ShipArt {
  base: string;
  mark: string;
  top: string;
  /** Hull extent along x (units): stern and bow. */
  stern: number;
  bow: number;
  /** Turret pivots along the centreline (warships). */
  turrets: number[];
}

const INK = '#0c1a26';
const STEEL = '#3a4856';
const PAPER = '#dfe6ea';
const shadow = (d: string) =>
  `<path d="${d}" fill="#06111a" fill-opacity="0.55" filter="url(#s)" transform="translate(0.8 1.3)"/>`;
const defs = `<defs><filter id="s" x="-10%" width="120%" height="200%" y="-50%"><feGaussianBlur stdDeviation="1.5"/></filter></defs>`;

// ------------------------------------------------------------------ warship
// A destroyer: clipper bow, transom stern, two gun turrets, bridge and funnel amidships.
const WS_HULL =
  'M8 12.6 C8 10 10 8.6 13 8.5 L70 8 C93 8 111 13 124 20 C111 27 93 32 70 32 L13 31.5 C10 31.4 8 30 8 27.4 Z';
const WS_DECK = 'M12.6 12 L70 11.5 C90 11.5 104 15.2 116 20 C104 24.8 90 28.5 70 28.5 L12.6 28 Z';

export const WARSHIP_ART: ShipArt = {
  base: `${defs}${shadow(WS_HULL)}<path d="${WS_HULL}" fill="${STEEL}" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`,
  mark: `<path d="${WS_DECK}" fill="#fff"/>`,
  top: `
    <path d="${WS_DECK}" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="1.2"/>
    <line x1="14" y1="20" x2="112" y2="20" stroke="#000" stroke-opacity="0.12" stroke-width="0.8"/>
    <rect x="36" y="15" width="10.5" height="10" rx="1.8" fill="#b9c3cb" stroke="${INK}" stroke-width="1.1"/>
    <rect x="48.5" y="15.4" width="9" height="9.2" rx="4" fill="#26303a" stroke="${INK}" stroke-width="1.1"/>
    <ellipse cx="53" cy="20" rx="2.6" ry="2.5" fill="#0d141b"/>
    <path d="M59 13.8 L76 13.8 Q82 13.8 83 20 Q82 26.2 76 26.2 L59 26.2 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M77.4 15.8 Q80.4 16.8 80.8 20 Q80.4 23.2 77.4 24.2" fill="none" stroke="#1b2a36" stroke-width="1.6"/>
    <circle cx="68" cy="20" r="2" fill="#9aa6b0" stroke="${INK}" stroke-width="0.8"/>
    <path d="M110 18.4 L118 20 L110 21.6 Z" fill="#000" fill-opacity="0.18"/>`,
  stern: 8,
  bow: 124,
  turrets: [96, 27],
};

/** Gun turret seen from above, guns pointing to +x from the pivot. */
export const TURRET_SVG = `
  <rect x="13" y="5.4" width="13" height="1.9" rx="0.7" fill="#1a232c" stroke="${INK}" stroke-width="0.5"/>
  <rect x="13" y="8.7" width="13" height="1.9" rx="0.7" fill="#1a232c" stroke="${INK}" stroke-width="0.5"/>
  <path d="M6 2.8 L11 2.8 Q16.4 3.2 16.4 8 Q16.4 12.8 11 13.2 L6 13.2 Q3.6 13.2 3.6 10.8 L3.6 5.2 Q3.6 2.8 6 2.8 Z" fill="#a4afb8" stroke="${INK}" stroke-width="1.2"/>
  <path d="M6.5 4.8 L10.4 4.8" stroke="#fff" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round"/>`;

/** Muzzle flash (white, tinted warm), centred: a short cone with a hot core. */
export const FLASH_SVG = `
  <defs><radialGradient id="f" cx="0.35" cy="0.5" r="0.6"><stop offset="0" stop-color="#fff"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <path d="M2 16 L22 6 L30 16 L22 26 Z" fill="url(#f)"/>
  <circle cx="8" cy="16" r="6" fill="url(#f)"/>`;

// ---------------------------------------------------------------- transport
// A landing ship: tapered bow ramp, stern wheelhouse, an open well packed with troops.
// The well floor and the ramp carry the owner's colour; the troops are helmets in rows.
const TR_HULL =
  'M14 5.6 L99 5.6 C112 5.6 119.6 12 119.6 20 C119.6 28 112 34.4 99 34.4 L14 34.4 C10.4 34.4 8.4 32.2 8.4 28.6 L8.4 11.4 C8.4 7.8 10.4 5.6 14 5.6 Z';
const TR_WELL = 'M31 11 L96 11 Q99.4 11 99.4 14.4 L99.4 25.6 Q99.4 29 96 29 L31 29 Z';
const TR_RAMP = 'M102.6 10.8 C110.6 11.4 116 15 116.4 20 C116 25 110.6 28.6 102.6 29.2 Z';
const TR_TROOPS = (() => {
  const dots: string[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 13; c++) {
      const x = 35 + c * 5.4 + (r % 2) * 2.7;
      if (x > 96) continue;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${(13.9 + r * 4.07).toFixed(2)}" r="1.5"/>`);
    }
  return dots.join('');
})();

export const TRANSPORT_ART: ShipArt = {
  base: `${defs}${shadow(TR_HULL)}<path d="${TR_HULL}" fill="#4b5443" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
    <path d="M14.4 8.8 L99 8.8 C109.6 8.8 116.4 13.8 116.4 20 C116.4 26.2 109.6 31.2 99 31.2 L14.4 31.2 Q11.6 31.2 11.6 28.4 L11.6 11.6 Q11.6 8.8 14.4 8.8 Z" fill="#6c745e"/>`,
  mark: `<path d="${TR_WELL}" fill="#fff"/><path d="${TR_RAMP}" fill="#fff"/>`,
  top: `
    <path d="${TR_WELL}" fill="#000" fill-opacity="0.12" stroke="${INK}" stroke-width="1.2"/>
    <g fill="#18201a" fill-opacity="0.7">${TR_TROOPS}</g>
    <path d="${TR_RAMP}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M104 20 H116" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>
    <rect x="12.6" y="12.2" width="15" height="15.6" rx="2.2" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>
    <rect x="24" y="14.4" width="2.2" height="11.2" rx="0.8" fill="#1b2a36"/>
    <circle cx="18.6" cy="20" r="2.3" fill="#26303a"/>`,
  stern: 8.4,
  bow: 119.6,
  turrets: [],
};

// ----------------------------------------------------------------- merchant
// A container ship: bluff bow, containers in muted chart tints, bridge and funnel aft;
// the owner's colour shows on the deck between the bays.
const MC_HULL =
  'M8 11.6 C8 9.2 9.8 7.6 12.6 7.6 L92 7.6 C108 7.6 119 12.6 123 20 C119 27.4 108 32.4 92 32.4 L12.6 32.4 C9.8 32.4 8 30.8 8 28.4 Z';
const MC_DECK = 'M11.6 11 L92 11 C104 11 113 14.6 117 20 C113 25.4 104 29 92 29 L11.6 29 Z';
const BOXES = ['#a85a43', '#c4a76c', '#5d7d8e', '#7d8c69', '#8d929a', '#b9875a'];
const MC_BOXES = (() => {
  const out: string[] = [];
  for (let b = 0; b < 7; b++)
    for (let r = 0; r < 4; r++) {
      const x = 33 + b * 10;
      out.push(
        `<rect x="${x}" y="${(12.6 + r * 3.8).toFixed(1)}" width="9" height="3.4" fill="${BOXES[(b * 3 + r * 5) % BOXES.length]}"/>`,
      );
    }
  return out.join('');
})();

export const MERCHANT_ART: ShipArt = {
  base: `${defs}${shadow(MC_HULL)}<path d="${MC_HULL}" fill="#2a323b" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`,
  mark: `<path d="${MC_DECK}" fill="#fff"/>`,
  top: `
    <path d="${MC_DECK}" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="1.1"/>
    <g stroke="${INK}" stroke-width="0.5">${MC_BOXES}</g>
    <rect x="12.6" y="12.4" width="13" height="15.2" rx="1.6" fill="${PAPER}" stroke="${INK}" stroke-width="1.1"/>
    <rect x="22.8" y="14" width="1.9" height="12" rx="0.6" fill="#1b2a36"/>
    <rect x="26.6" y="16.2" width="5" height="7.6" rx="1.8" fill="#26303a" stroke="${INK}" stroke-width="0.8"/>`,
  stern: 8,
  bow: 123,
  turrets: [],
};

/**
 * Foam wake, apex at the right edge (the stern), fading aft: the churned water right
 * behind the hull and the two faint arms of the V.
 */
export const WAKE_SVG = `
  <defs>
    <linearGradient id="w" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.55"/></linearGradient>
    <linearGradient id="c" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.8" stop-color="#fff" stop-opacity="0.38"/><stop offset="1" stop-color="#fff" stop-opacity="0.6"/></linearGradient>
    <filter id="b" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="0.8"/></filter>
  </defs>
  <g filter="url(#b)">
    <path d="M63 10.6 Q36 7.6 2 1.6 L2 3.6 Q36 9.6 63 11.8 Z" fill="url(#w)"/>
    <path d="M63 21.4 Q36 24.4 2 30.4 L2 28.4 Q36 22.4 63 20.2 Z" fill="url(#w)"/>
    <path d="M64 11.4 Q44 10.6 16 9.6 Q12 16 16 22.4 Q44 21.4 64 20.6 Z" fill="url(#c)"/>
  </g>`;

/** Veterancy chevron (brass, navy outline), pointing up. */
export const CHEVRON_SVG = `<path d="M1.6 10.4 L8 4 L14.4 10.4 L14.4 14.6 L8 8.2 L1.6 14.6 Z" fill="#f2c45a" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;

/** Repair badge of a docked warship: a white cross on the success green. */
export const REPAIR_SVG = `<circle cx="8" cy="8" r="6.8" fill="#2f7d55" stroke="${INK}" stroke-width="1.3"/><path d="M8 4.2 V11.8 M4.2 8 H11.8" stroke="#fff" stroke-width="2.6" stroke-linecap="butt"/>`;

export const svgDoc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
