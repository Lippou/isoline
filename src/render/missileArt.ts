// Nuclear missile artwork, top-down and pointing right (+x), in SVG art units (rastered ×4).
// Three layers per missile: `base` (the whole silhouette, shaded: also its shadow), `mark`
// (white, tinted with the owner's colour: fins and a band) and `top` (ink outlines and the
// shading laid over the mark). Kinds differ by shape and size, never by colour alone: the
// A-bomb is a slender rocket with swept fins; the H-bomb a bigger two-stage missile with a
// blunt re-entry nose and canards; the MIRV a fat carrier with lattice fins, three nozzles and
// three warheads crowding its open nose; a MIRV warhead a small dark cone; an interceptor a
// needle with cruciform fins.

const INK = '#0c1a26';

/** Shading of a round body, lit from above-left like the atlas (top → bottom). */
const bodyGrad = (id: string, top: string, mid: string, bottom: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/>` +
  `<stop offset="0.42" stop-color="${mid}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
/** Shading laid over the owner's band (the band itself is flat). */
const SHADE =
  `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/>` +
  `<stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/>` +
  `<stop offset="1" stop-color="#000" stop-opacity="0.42"/></linearGradient>`;
const FIN =
  `<linearGradient id="fn" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#57616b"/>` +
  `<stop offset="1" stop-color="#9aa4ad"/></linearGradient>`;
const PAPER = bodyGrad('b', '#fbf8f0', '#e4ddcd', '#9f9785');
const GRAPHITE = bodyGrad('g', '#8b8580', '#4d4945', '#211f1d');

export interface MissileArt {
  w: number;
  h: number;
  base: string;
  mark: string;
  top: string;
  /** Nozzles: offsets across the body (art units from the axis), at x = `tail`. */
  nozzles: number[];
  tail: number;
  /** Tip of the nose (art units). */
  nose: number;
}

const fin = (d: string) =>
  `<path d="${d}" fill="url(#fn)" stroke="${INK}" stroke-width="0.55" stroke-linejoin="round"/>`;
const finMark = (d: string) => `<path d="${d}" fill="#fff"/>`;
const outline = (d: string, w = 0.6) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

// ------------------------------------------------------------------ A-bomb
// 64 × 18: body 8…47, ogive nose to 62.6, swept fins at the tail.
const A_FIN_T = 'M11.6 6.2 L20.6 6.2 L13.4 1 L8.4 1 Z';
const A_FIN_B = 'M11.6 11.8 L20.6 11.8 L13.4 17 L8.4 17 Z';
const A_BODY = 'M8 6.2 H47 C54.6 6.2 59.6 7.3 62.6 9 C59.6 10.7 54.6 11.8 47 11.8 H8 Z';
const A_BAND = 'M29.5 6.2 H35 V11.8 H29.5 Z';
export const ATOM_ART: MissileArt = {
  w: 64,
  h: 18,
  base:
    `<defs>${PAPER}${FIN}</defs>` +
    fin(A_FIN_T) +
    fin(A_FIN_B) +
    `<path d="M3.4 6.8 L8.4 7.5 V10.5 L3.4 11.2 Z" fill="#2a3138" stroke="${INK}" stroke-width="0.5"/>` +
    `<path d="${A_BODY}" fill="url(#b)"/>` +
    `<path d="M57.6 7.7 C59.7 8.1 61.3 8.5 62.6 9 C61.3 9.5 59.7 9.9 57.6 10.3 Z" fill="#3a302b"/>` +
    `<path d="M24 6.4 V11.6 M41 6.4 V11.6 M47 6.4 V11.6" stroke="${INK}" stroke-opacity="0.25" stroke-width="0.45"/>`,
  mark: finMark(A_FIN_T) + finMark(A_FIN_B) + finMark(A_BAND),
  top:
    `<defs>${SHADE}</defs><path d="${A_BAND}" fill="url(#sh)"/>` +
    `<path d="M8.6 9 H19.6" stroke="#3d464f" stroke-width="1.15" stroke-linecap="round"/>` +
    `<path d="M8.6 6.9 H46" stroke="#fff" stroke-opacity="0.6" stroke-width="0.7" stroke-linecap="round"/>` +
    outline(A_FIN_T, 0.55) +
    outline(A_FIN_B, 0.55) +
    outline(A_BODY),
  nozzles: [0],
  tail: 3.6,
  nose: 62.6,
};

// ------------------------------------------------------------------ H-bomb
// 84 × 26: a fat first stage 9…40 (r 6, pale), interstage, a dark second stage 42…64 (r 4.8),
// blunt re-entry nose to 80.9: pale / dark / pale reads even without colour.
const H_FIN_T = 'M13.5 7 L29.5 7 L20.5 0.5 L9.5 0.5 Z';
const H_FIN_B = 'M13.5 19 L29.5 19 L20.5 25.5 L9.5 25.5 Z';
const H_CAN_T = 'M55 8.2 L61.6 8.2 L57.6 4.4 L54.6 4.4 Z';
const H_CAN_B = 'M55 17.8 L61.6 17.8 L57.6 21.6 L54.6 21.6 Z';
const H_BODY =
  'M9 7 H39.4 L42.4 8.2 H64 C71.5 8.3 77.6 10 80 12.1 Q80.9 13 80 13.9 C77.6 16 71.5 17.7 64 17.8 H42.4 L39.4 19 H9 Z';
const H_UPPER = 'M42.4 8.2 H64 V17.8 H42.4 Z';
const H_BAND = 'M30 7 H36.4 V19 H30 Z';
const H_BAND2 = 'M64 8.3 H66.4 V17.7 H64 Z';
export const HYDROGEN_ART: MissileArt = {
  w: 84,
  h: 26,
  base:
    `<defs>${PAPER}${FIN}${GRAPHITE}</defs>` +
    fin(H_FIN_T) +
    fin(H_FIN_B) +
    fin(H_CAN_T) +
    fin(H_CAN_B) +
    `<path d="M2.6 8.6 L9.6 9.6 V16.4 L2.6 17.4 Z" fill="#262c33" stroke="${INK}" stroke-width="0.55"/>` +
    `<path d="${H_BODY}" fill="url(#b)"/>` +
    `<path d="${H_UPPER}" fill="url(#g)"/>` +
    `<path d="M20 7.2 V18.8 M53 8.4 V17.6" stroke="${INK}" stroke-opacity="0.3" stroke-width="0.45"/>` +
    `<path d="M39.6 7.2 L42.2 8.4 V17.6 L39.6 18.8 Z" fill="#3a4148"/>` +
    // The re-entry vehicle: a blunt heat-shield tip.
    `<path d="M74 10.6 C77 11.2 79 11.7 80 12.1 Q80.9 13 80 13.9 C79 14.3 77 14.8 74 15.4 Z" fill="#3a302b"/>`,
  mark:
    finMark(H_FIN_T) +
    finMark(H_FIN_B) +
    finMark(H_CAN_T) +
    finMark(H_CAN_B) +
    finMark(H_BAND) +
    finMark(H_BAND2),
  top:
    `<defs>${SHADE}</defs><path d="${H_BAND}" fill="url(#sh)"/><path d="${H_BAND2}" fill="url(#sh)"/>` +
    `<path d="M10 13 H28" stroke="#3d464f" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M10 8.1 H39 M67 9.4 H74" stroke="#fff" stroke-opacity="0.6" stroke-width="0.8" stroke-linecap="round"/>` +
    `<path d="M43 9.2 H63" stroke="#fff" stroke-opacity="0.22" stroke-width="0.8" stroke-linecap="round"/>` +
    outline(H_FIN_T, 0.55) +
    outline(H_FIN_B, 0.55) +
    outline(H_CAN_T, 0.5) +
    outline(H_CAN_B, 0.5) +
    outline(H_BODY, 0.7),
  nozzles: [0],
  tail: 3.2,
  nose: 80.9,
};

// ------------------------------------------------------------------ MIRV carrier
// 96 × 30: fat body 8…58 (r 6), payload bus 58…72, three warheads out of the open nose.
const lattice = (x: number, y0: number, y1: number) => {
  const w = 6.4;
  let d = `<rect x="${x}" y="${y0}" width="${w}" height="${y1 - y0}" fill="#5d6770" fill-opacity="0.35" stroke="${INK}" stroke-width="0.6"/>`;
  for (let k = 1; k < 3; k++) {
    const xx = x + (w * k) / 3;
    d += `<path d="M${xx} ${y0} V${y1}" stroke="${INK}" stroke-width="0.45"/>`;
  }
  for (let k = 1; k < 4; k++) {
    const yy = y0 + ((y1 - y0) * k) / 4;
    d += `<path d="M${x} ${yy} H${x + w}" stroke="${INK}" stroke-width="0.45"/>`;
  }
  return d;
};
const M_FRAME_T = 'M13 1 H19.4 V9 H13 Z';
const M_FRAME_B = 'M13 21 H19.4 V29 H13 Z';
const M_BODY = 'M8 9 H58 L59 8.3 H72 V21.7 H59 L58 21 H8 Z';
const cone = (y: number, tip: number) =>
  `M72 ${y - 2.3} C${tip - 6} ${y - 2.2} ${tip - 2} ${y - 0.9} ${tip} ${y} C${tip - 2} ${y + 0.9} ${tip - 6} ${y + 2.2} 72 ${y + 2.3} Z`;
const M_CONES = [cone(10.6, 86), cone(15, 90.5), cone(19.4, 86)];
const M_BAND = 'M40 9 H46 V21 H40 Z';
export const MIRV_ART: MissileArt = {
  w: 96,
  h: 30,
  base:
    `<defs>${PAPER}${FIN}${GRAPHITE}</defs>` +
    `<path d="M3 9.4 L8.4 10.1 V12.9 L3 13.6 Z M3 13 L8.4 13.6 V16.4 L3 17 Z M3 16.4 L8.4 17.1 V19.9 L3 20.6 Z" fill="#262c33" stroke="${INK}" stroke-width="0.45"/>` +
    `<path d="M13 9 H19.4 V1 H13 Z M13 21 H19.4 V29 H13 Z" fill="#7a848d"/>` +
    lattice(13, 1, 9) +
    lattice(13, 21, 29) +
    `<path d="${M_BODY}" fill="url(#b)"/>` +
    M_CONES.map((d) => `<path d="${d}" fill="url(#g)" stroke="${INK}" stroke-width="0.5"/>`).join('') +
    `<path d="M71.6 8.6 V21.4" stroke="#2c3238" stroke-width="1.1"/>` +
    `<path d="M24 9.2 V20.8 M33 9.2 V20.8 M52 9.2 V20.8" stroke="${INK}" stroke-opacity="0.25" stroke-width="0.45"/>`,
  mark:
    finMark(M_FRAME_T) +
    finMark(M_FRAME_B) +
    finMark(M_BAND) +
    finMark('M59 8.3 H72 V9.6 H59 Z M59 20.4 H72 V21.7 H59 Z'),
  top:
    `<defs>${SHADE}</defs><path d="${M_BAND}" fill="url(#sh)"/>` +
    // The frames stay open: the lattice shows through the owner's colour.
    lattice(13, 1, 9) +
    lattice(13, 21, 29) +
    `<path d="M9 10 H57 M60 9.2 H71" stroke="#fff" stroke-opacity="0.6" stroke-width="0.9" stroke-linecap="round"/>` +
    `<path d="M58.6 8.6 V21.4" stroke="${INK}" stroke-width="0.6"/>` +
    outline(M_BODY, 0.75),
  nozzles: [-3.5, 0, 3.5],
  tail: 3.2,
  nose: 90.5,
};

// ------------------------------------------------------------------ MIRV warhead
// 26 × 12: a slender re-entry cone, its base ring in the owner's colour.
const W_CONE = 'M3 2.9 Q1.6 6 3 9.1 L22.5 6.8 Q24.6 6 22.5 5.2 Z';
export const WARHEAD_ART: MissileArt = {
  w: 26,
  h: 12,
  base:
    `<defs>${GRAPHITE}</defs><path d="${W_CONE}" fill="url(#g)"/>` +
    `<path d="M17 5.6 L22.5 5.2 Q24.6 6 22.5 6.8 L17 6.4 Z" fill="#7b4a34"/>`,
  mark: finMark('M3 2.9 Q1.6 6 3 9.1 L7.4 8.6 L7.4 3.4 Z'),
  top:
    `<defs>${SHADE}</defs><path d="M3 2.9 Q1.6 6 3 9.1 L7.4 8.6 L7.4 3.4 Z" fill="url(#sh)"/>` +
    `<path d="M4 4.2 L20 5.6" stroke="#fff" stroke-opacity="0.45" stroke-width="0.6" stroke-linecap="round"/>` +
    outline(W_CONE, 0.6),
  nozzles: [0],
  tail: 2,
  nose: 24.4,
};

// ------------------------------------------------------------------ interceptor
// 34 × 10: a needle with small cruciform fins.
const I_BODY = 'M6 3.8 H27.5 C30 3.9 32 4.4 33.4 5 C32 5.6 30 6.1 27.5 6.2 H6 Z';
const I_FINS =
  'M6.4 3.8 L11 3.8 L8 0.8 L6 0.8 Z M6.4 6.2 L11 6.2 L8 9.2 L6 9.2 Z M23 3.8 L26 3.8 L24.4 2.4 L23 2.4 Z M23 6.2 L26 6.2 L24.4 7.6 L23 7.6 Z';
export const INTERCEPTOR_ART: MissileArt = {
  w: 34,
  h: 10,
  base:
    `<defs>${bodyGrad('b', '#ffffff', '#e6edf1', '#9fb0ba')}${FIN}</defs>` +
    `<path d="${I_FINS}" fill="url(#fn)"/>` +
    `<path d="M3.4 4.1 L6.4 4.4 V5.6 L3.4 5.9 Z" fill="#262c33"/>` +
    `<path d="${I_BODY}" fill="url(#b)"/>`,
  mark: finMark(I_FINS),
  top: outline(I_FINS, 0.45) + outline(I_BODY, 0.5),
  nozzles: [0],
  tail: 3.4,
  nose: 33.4,
};

// ------------------------------------------------------------------ MIRV separation
/** One half of the carrier's payload fairing, tumbling away after the split. */
export const FAIRING_ART = {
  w: 22,
  h: 12,
  base:
    `<defs>${PAPER}</defs>` +
    `<path d="M1.5 10.5 C2 5 6 1.6 12 1.4 C16 1.3 19 2.4 20.6 4 L18.4 5.6 C16.8 4.6 14.6 4 12 4.1 C7.6 4.3 4.8 6.8 4.4 10.5 Z" fill="url(#b)" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round"/>`,
};
/** The bus left behind once its warheads are released: a squat platform with empty mounts. */
export const BUS_ART = {
  w: 34,
  h: 26,
  base:
    `<defs>${PAPER}</defs>` +
    `<path d="M3 10.6 L8 11.2 V14.8 L3 15.4 Z" fill="#262c33" stroke="${INK}" stroke-width="0.5"/>` +
    `<path d="M8 6 H28 Q31 6 31 9 V17 Q31 20 28 20 H8 Z" fill="url(#b)" stroke="${INK}" stroke-width="0.7"/>` +
    `<circle cx="27.2" cy="8.8" r="1.6" fill="#2c3238"/><circle cx="28.4" cy="13" r="1.6" fill="#2c3238"/><circle cx="27.2" cy="17.2" r="1.6" fill="#2c3238"/>` +
    `<path d="M9 7.4 H26" stroke="#fff" stroke-opacity="0.6" stroke-width="0.8" stroke-linecap="round"/>`,
};
