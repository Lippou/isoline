// Generates the complete Isoline brand kit from code:
//   brand/*.svg + brand/png/*      logo symbol, logotype, full logos (dark/light/mono)
//   build-resources/icon.{icns,ico,png}, dmg-background(@2x).png
//   build-resources/Isoline.icon    the macOS 26+ icon (Icon Composer: layers + icon.json),
//                                   compiled by electron-builder into Assets.car
//   brand/moodboard.{svg,png}, brand/palette.svg
//   src/ui/assets/brand/*.svg      in-app copies
// Text is converted to outlines with opentype.js so every SVG is self-contained.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';
import { PLAYER_COLORS, CVD_PALETTES } from '../../src/render/palette';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BRAND = path.join(ROOT, 'brand');
const PNG_DIR = path.join(BRAND, 'png');
const BUILD_RES = path.join(ROOT, 'build-resources');
const UI_BRAND = path.join(ROOT, 'src/ui/assets/brand');
for (const d of [BRAND, PNG_DIR, BUILD_RES, UI_BRAND]) fs.mkdirSync(d, { recursive: true });

export const PALETTE = {
  abyss: '#0B1220', // background
  slate: '#16233A', // surface
  aurora: '#4FE3C1', // primary accent (isolines, selection)
  brass: '#F2B84B', // secondary accent (capitals, gold)
  signal: '#FF5A5F', // danger
  verdant: '#7BD88F', // success
  parchment: '#EAE6DA', // text
} as const;

const font = (file: string): opentype.Font => {
  const buf = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const fraunces = font('fraunces/files/fraunces-latin-600-normal.woff');
const fraunces400 = font('fraunces/files/fraunces-latin-400-normal.woff');
const plex = font('ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff');
const plex600 = font('ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff');

/** Serialises an opentype path ourselves (opentype's rounding turns tiny floats into NaN). */
function pathData(p: opentype.Path): string {
  const n = (v: number | undefined) => (v ?? 0).toFixed(2);
  return p.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${n(c.x)} ${n(c.y)}`;
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
        default:
          return 'Z';
      }
    })
    .join('');
}

/** Outlined text path with optional tracking (em fraction). Returns path d + width. */
function textPath(f: opentype.Font, text: string, x: number, y: number, size: number, tracking = 0) {
  let cx = x;
  const parts: string[] = [];
  const glyphs = f.stringToGlyphs(text);
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    parts.push(pathData(g.getPath(cx, y, size)));
    let adv = ((g.advanceWidth ?? 0) / f.unitsPerEm) * size;
    if (i < glyphs.length - 1) {
      const kern = Number(f.getKerningValue(g, glyphs[i + 1]!));
      if (Number.isFinite(kern)) adv += (kern / f.unitsPerEm) * size;
    }
    cx += adv + (i < glyphs.length - 1 ? tracking * size : 0);
  }
  return { d: parts.join(''), width: cx - x };
}

/** Smooth closed organic contour (sum of harmonics) as a cubic Bézier path. */
function contour(cx: number, cy: number, r: number, harm: [number, number, number][], n = 72): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let k = 1;
    for (const [amp, freq, ph] of harm) k += amp * Math.sin(freq * t + ph);
    pts.push([cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k]);
  }
  const p = (i: number) => pts[(i + n) % n]!;
  let d = `M${p(0)[0].toFixed(2)},${p(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1),
      p1 = p(i),
      p2 = p(i + 1),
      p3 = p(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]!.toFixed(2)},${c1[1]!.toFixed(2)} ${c2[0]!.toFixed(2)},${c2[1]!.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}

const HARM: [number, number, number][] = [
  [0.07, 2, 0.6],
  [0.045, 3, 2.1],
  [0.02, 5, 4.0],
];

interface MarkStyle {
  rings: string[]; // stroke colours outer → inner
  summit: string;
  stroke: number;
  simple?: boolean;
}

/** The Isoline mark: nested contour lines climbing to a brass summit. Drawn in a 1024 box. */
function markGroup(s: MarkStyle, cx = 512, cy = 520, scale = 1): string {
  const radii = s.simple ? [300, 165] : [320, 225, 132];
  const out: string[] = [];
  radii.forEach((r, i) => {
    const shift = i * (s.simple ? 34 : 26);
    const harm = HARM.map(([a, f, p]) => [a * (1 - i * 0.18), f, p + i * 0.35] as [number, number, number]);
    out.push(
      `<path d="${contour(cx - shift * 0.6, cy - shift, r, harm)}" fill="none" stroke="${s.rings[i] ?? s.rings[s.rings.length - 1]}" stroke-width="${s.stroke}" stroke-linejoin="round"/>`,
    );
  });
  const sx = cx - (radii.length - 1) * (s.simple ? 34 : 26) * 0.6 - 10;
  const sy = cy - (radii.length - 1) * (s.simple ? 34 : 26) - 14;
  const sr = s.simple ? 62 : 46;
  // Summit: a brass rhombus (cartographic triangulation mark).
  out.push(
    `<path d="M${sx},${sy - sr} L${sx + sr * 0.8},${sy} L${sx},${sy + sr} L${sx - sr * 0.8},${sy} Z" fill="${s.summit}"/>`,
  );
  return `<g transform="translate(${512 * (1 - scale)} ${512 * (1 - scale)}) scale(${scale})">${out.join('')}</g>`;
}

function iconSvg(simple: boolean, fullBleed: boolean): string {
  const inset = fullBleed ? 24 : 100;
  const size = 1024 - inset * 2;
  const rx = fullBleed ? 210 : 185;
  const grid: string[] = [];
  if (!simple) {
    for (let i = 1; i < 8; i++) {
      const v = inset + (size / 8) * i;
      grid.push(`<line x1="${inset}" y1="${v}" x2="${inset + size}" y2="${v}"/>`);
      grid.push(`<line x1="${v}" y1="${inset}" x2="${v}" y2="${inset + size}"/>`);
    }
  }
  const scale = (size / 824) * (simple ? 0.95 : 0.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1B2C48"/><stop offset="1" stop-color="${PALETTE.abyss}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.45" cy="0.4" r="0.6">
      <stop offset="0" stop-color="${PALETTE.aurora}" stop-opacity="0.22"/><stop offset="1" stop-color="${PALETTE.aurora}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip"><rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${rx}"/></clipPath>
    ${fullBleed ? '' : `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/></filter>`}
  </defs>
  <rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${rx}" fill="url(#body)" ${fullBleed ? '' : 'filter="url(#shadow)"'}/>
  <g clip-path="url(#clip)">
    <rect x="${inset}" y="${inset}" width="${size}" height="${size}" fill="url(#glow)"/>
    <g stroke="${PALETTE.aurora}" stroke-opacity="0.07" stroke-width="3">${grid.join('')}</g>
    ${markGroup(
      simple
        ? { rings: [PALETTE.aurora, PALETTE.aurora], summit: PALETTE.brass, stroke: 74, simple: true }
        : { rings: ['#2A8F7C', '#3BC2A5', PALETTE.aurora], summit: PALETTE.brass, stroke: 40 },
      512,
      530,
      scale,
    )}
  </g>
  <rect x="${inset + 3}" y="${inset + 3}" width="${size - 6}" height="${size - 6}" rx="${rx - 3}" fill="none" stroke="${PALETTE.aurora}" stroke-opacity="0.22" stroke-width="6"/>
</svg>`;
}

/**
 * The macOS 26+ icon, as Icon Composer saves it (`Isoline.icon`: icon.json + layers): the
 * system draws it in its own squircle, with its depth. Two full-bleed 1024 layers, the
 * chart (body, glow, grid) and the isolines with their summit; the system masks the corners.
 * electron-builder compiles it with actool into Assets.car (CFBundleIconName), which the
 * system's own surfaces read (Game Mode, notifications, the menu bar), and an icns.
 */
function iconComposer(): { json: string; layers: Record<string, string> } {
  const grid: string[] = [];
  for (let i = 1; i < 8; i++) {
    const v = (1024 / 8) * i;
    grid.push(`<line x1="0" y1="${v}" x2="1024" y2="${v}"/>`, `<line x1="${v}" y1="0" x2="${v}" y2="1024"/>`);
  }
  const chart = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1B2C48"/><stop offset="1" stop-color="${PALETTE.abyss}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.45" cy="0.4" r="0.6">
      <stop offset="0" stop-color="${PALETTE.aurora}" stop-opacity="0.22"/><stop offset="1" stop-color="${PALETTE.aurora}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#body)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <g stroke="${PALETTE.aurora}" stroke-opacity="0.07" stroke-width="3">${grid.join('')}</g>
</svg>`;
  // The mark at the size it has in the squircle of the classic icon (824 of 1024, ×0.9).
  const scale = (1024 / 824) * 0.9;
  const marks = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${markGroup(
    { rings: ['#2A8F7C', '#3BC2A5', PALETTE.aurora], summit: PALETTE.brass, stroke: 40 },
    512,
    530,
    scale,
  )}</svg>`;
  const json = {
    fill: { solid: 'extended-srgb:0.04314,0.07059,0.12549,1.00000' },
    groups: [
      {
        layers: [{ 'image-name': 'isolines.png', name: 'isolines' }],
        shadow: { kind: 'neutral', opacity: 0.4 },
        translucency: { enabled: false, value: 0 },
      },
      { layers: [{ 'image-name': 'chart.png', name: 'chart' }] },
    ],
    'supported-platforms': { squares: 'shared' },
  };
  return {
    json: JSON.stringify(json, null, 2) + '\n',
    layers: { 'chart.png': chart, 'isolines.png': marks },
  };
}

type Variant = 'dark' | 'light' | 'mono' | 'mono-white';
const VARIANTS: Record<Variant, { bg: string | null; text: string; rings: string[]; summit: string }> = {
  dark: {
    bg: PALETTE.abyss,
    text: PALETTE.parchment,
    rings: ['#2A8F7C', '#3BC2A5', PALETTE.aurora],
    summit: PALETTE.brass,
  },
  light: {
    bg: PALETTE.parchment,
    text: PALETTE.abyss,
    rings: ['#7FB8AC', '#2E8C79', '#0E6B5A'],
    summit: '#C98A16',
  },
  mono: {
    bg: null,
    text: PALETTE.abyss,
    rings: [PALETTE.abyss, PALETTE.abyss, PALETTE.abyss],
    summit: PALETTE.abyss,
  },
  'mono-white': { bg: null, text: '#FFFFFF', rings: ['#FFFFFF', '#FFFFFF', '#FFFFFF'], summit: '#FFFFFF' },
};

function symbolSvg(v: Variant): string {
  const c = VARIANTS[v];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 150 724 724" width="724" height="724">
  ${c.bg ? `<rect x="150" y="150" width="724" height="724" rx="140" fill="${c.bg}"/>` : ''}
  ${markGroup({ rings: c.rings, summit: c.summit, stroke: 44 }, 512, 540, 0.95)}
</svg>`;
}

function logotype(size = 180) {
  return textPath(fraunces, 'ISOLINE', 0, 0, size, 0.16);
}

function fullLogoSvg(v: Variant, withSlogan = false): string {
  const c = VARIANTS[v];
  const lt = logotype();
  const h = 420;
  const markSize = 330;
  const textX = 60 + markSize + 50;
  const w = textX + lt.width + 70;
  const baseline = withSlogan ? 236 : 270;
  const slogan = withSlogan ? textPath(plex, 'DRAW THE LINE. HOLD THE WORLD.', 0, 0, 34, 0.22) : null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h}" width="${w.toFixed(0)}" height="${h}">
  ${c.bg ? `<rect width="100%" height="100%" rx="36" fill="${c.bg}"/>` : ''}
  <g transform="translate(60 ${(h - markSize) / 2}) scale(${markSize / 1024})">
    ${markGroup({ rings: c.rings, summit: c.summit, stroke: 46 }, 512, 540, 1.15)}
  </g>
  <path transform="translate(${textX} ${baseline})" d="${lt.d}" fill="${c.text}"/>
  ${slogan ? `<path transform="translate(${textX + 4} ${baseline + 80})" d="${slogan.d}" fill="${v === 'dark' ? PALETTE.aurora : c.text}" fill-opacity="0.9"/>` : ''}
</svg>`;
}

function render(svg: string, width: number, file: string): Buffer {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
  fs.writeFileSync(file, png);
  return png;
}

function writeIco(entries: { size: number; png: Buffer }[], file: string): void {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    header.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(e.png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...entries.map((e) => e.png)]));
}

/** Decorative terrain contours used by the DMG background and the moodboard. */
function contourField(w: number, h: number, seed: number, color: string, count = 9): string {
  const out: string[] = [];
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 3; k++) {
    const cx = rnd() * w,
      cy = rnd() * h,
      base = 40 + rnd() * 60;
    const harm: [number, number, number][] = [
      [0.12, 2, rnd() * 6],
      [0.07, 3, rnd() * 6],
      [0.03, 5, rnd() * 6],
    ];
    for (let i = 0; i < count; i++) {
      const r = base + i * (28 + rnd() * 6);
      out.push(
        `<path d="${contour(cx + i * 4, cy - i * 3, r, harm, 64)}" fill="none" stroke="${color}" stroke-opacity="${(0.32 - i * 0.03).toFixed(2)}" stroke-width="${i % 4 === 0 ? 2.2 : 1.1}"/>`,
      );
    }
  }
  return out.join('');
}

function dmgBackground(scale: number): string {
  const w = 660,
    h = 420;
  const title = textPath(fraunces, 'ISOLINE', 0, 0, 30, 0.2);
  const hint = textPath(
    plex,
    'Glissez Isoline dans Applications  ·  Drag Isoline to Applications',
    0,
    0,
    12.5,
    0.02,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14223A"/><stop offset="1" stop-color="${PALETTE.abyss}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${contourField(w, h, 7, PALETTE.aurora, 8)}
  <path transform="translate(${(w - title.width) / 2} 70)" d="${title.d}" fill="${PALETTE.parchment}"/>
  <path d="M290,210 L360,210" stroke="${PALETTE.brass}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 9"/>
  <path d="M362,200 L378,210 L362,220 Z" fill="${PALETTE.brass}"/>
  <path transform="translate(${(w - hint.width) / 2} 370)" d="${hint.d}" fill="${PALETTE.parchment}" fill-opacity="0.75"/>
</svg>`;
}

function moodboard(): string {
  const W = 1920,
    H = 1080;
  const sw = Object.entries(PALETTE);
  const swatches = sw
    .map(([name, hex], i) => {
      const x = 80 + i * 150;
      const label = textPath(plex600, name.toUpperCase(), 0, 0, 16, 0.08);
      const code = textPath(plex, hex, 0, 0, 15, 0.02);
      return `<rect x="${x}" y="760" width="130" height="130" rx="18" fill="${hex}" stroke="#ffffff" stroke-opacity="0.12"/>
      <path transform="translate(${x} 920)" d="${label.d}" fill="${PALETTE.parchment}"/>
      <path transform="translate(${x} 944)" d="${code.d}" fill="${PALETTE.parchment}" fill-opacity="0.6"/>`;
    })
    .join('');
  const players = PLAYER_COLORS.slice(0, 40)
    .map(
      (c, i) =>
        `<rect x="${1180 + (i % 10) * 64}" y="${760 + Math.floor(i / 10) * 52}" width="56" height="44" rx="8" fill="${c}"/>`,
    )
    .join('');
  const t1 = textPath(fraunces, 'ISOLINE', 0, 0, 120, 0.16);
  const t2 = textPath(fraunces400, 'Atlas nocturne · encre lumineuse', 0, 0, 44, 0);
  const t3 = textPath(
    plex,
    'Night atlas & luminous ink — topographic isolines, translucent ink washes, glowing living borders.',
    0,
    0,
    22,
    0,
  );
  const t4 = textPath(
    plex600,
    'FRAUNCES — TITLES     IBM PLEX SANS — INTERFACE     IBM PLEX MONO — NUMBERS',
    0,
    0,
    16,
    0.1,
  );
  const t5 = textPath(plex600, 'PLAYER INKS (40)', 0, 0, 16, 0.1);
  // Mini "map" vignette: ink territories over contour terrain.
  const vignette = `<g transform="translate(1180 120)">
    <rect width="640" height="560" rx="28" fill="#0E1A2E"/>
    <clipPath id="vc"><rect width="640" height="560" rx="28"/></clipPath>
    <g clip-path="url(#vc)">
      ${contourField(640, 560, 42, '#8FB7A8', 10)}
      <path d="${contour(
        220,
        250,
        170,
        [
          [0.18, 3, 1],
          [0.08, 5, 2],
        ],
        64,
      )}" fill="${PLAYER_COLORS[0]}" fill-opacity="0.32" stroke="${PLAYER_COLORS[0]}" stroke-width="4"/>
      <path d="${contour(
        450,
        330,
        150,
        [
          [0.16, 2, 3],
          [0.09, 4, 1],
        ],
        64,
      )}" fill="${PLAYER_COLORS[3]}" fill-opacity="0.32" stroke="${PLAYER_COLORS[3]}" stroke-width="4"/>
      <path d="${contour(
        400,
        110,
        90,
        [
          [0.2, 3, 5],
          [0.08, 5, 1],
        ],
        64,
      )}" fill="${PLAYER_COLORS[7]}" fill-opacity="0.32" stroke="${PLAYER_COLORS[7]}" stroke-width="4"/>
      <path d="M200,240 l14,-22 l14,22 z" fill="${PALETTE.brass}"/>
      <circle cx="450" cy="330" r="10" fill="none" stroke="${PALETTE.parchment}" stroke-width="3"/>
    </g>
    <rect width="640" height="560" rx="28" fill="none" stroke="${PALETTE.aurora}" stroke-opacity="0.3" stroke-width="2"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${PALETTE.abyss}"/>
  ${contourField(W, H, 3, PALETTE.aurora, 10)}
  <g transform="translate(80 110) scale(0.3)">${markGroup({ rings: VARIANTS.dark.rings, summit: PALETTE.brass, stroke: 40 }, 512, 540, 1.1)}</g>
  <path transform="translate(420 280)" d="${t1.d}" fill="${PALETTE.parchment}"/>
  <path transform="translate(84 470)" d="${t2.d}" fill="${PALETTE.aurora}"/>
  <path transform="translate(84 530)" d="${t3.d}" fill="${PALETTE.parchment}" fill-opacity="0.8"/>
  <path transform="translate(84 640)" d="${t4.d}" fill="${PALETTE.brass}"/>
  <path transform="translate(1180 740)" d="${t5.d}" fill="${PALETTE.brass}"/>
  ${vignette}
  ${swatches}
  ${players}
</svg>`;
}

function paletteSheet(): string {
  const rows = [['standard', PLAYER_COLORS] as const, ...Object.entries(CVD_PALETTES)];
  const W = 40 * 34 + 260,
    H = rows.length * 60 + 40;
  const body = rows
    .map(([name, cols], r) => {
      const label = textPath(plex600, String(name).toUpperCase(), 0, 0, 16, 0.06);
      return (
        `<path transform="translate(20 ${50 + r * 60})" d="${label.d}" fill="${PALETTE.parchment}"/>` +
        (cols as readonly string[])
          .map(
            (c, i) =>
              `<rect x="${240 + i * 34}" y="${26 + r * 60}" width="30" height="40" rx="5" fill="${c}"/>`,
          )
          .join('')
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${PALETTE.abyss}"/>${body}</svg>`;
}

function main(): void {
  // Symbols + logos.
  for (const v of Object.keys(VARIANTS) as Variant[]) {
    const sym = symbolSvg(v);
    fs.writeFileSync(path.join(BRAND, `symbol-${v}.svg`), sym);
    render(sym, 512, path.join(PNG_DIR, `symbol-${v}-512.png`));
    const full = fullLogoSvg(v);
    fs.writeFileSync(path.join(BRAND, `logo-${v}.svg`), full);
    render(full, 1600, path.join(PNG_DIR, `logo-${v}-1600.png`));
  }
  const lockup = fullLogoSvg('dark', true);
  fs.writeFileSync(path.join(BRAND, 'logo-dark-slogan.svg'), lockup);
  render(lockup, 1600, path.join(PNG_DIR, 'logo-dark-slogan-1600.png'));
  const lt = logotype();
  const ltSvg = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -150 ${(lt.width + 20).toFixed(0)} 190" width="${(lt.width + 20).toFixed(0)}" height="190"><path d="${lt.d}" fill="${fill}"/></svg>`;
  fs.writeFileSync(path.join(BRAND, 'logotype-light-text.svg'), ltSvg(PALETTE.parchment));
  fs.writeFileSync(path.join(BRAND, 'logotype-dark-text.svg'), ltSvg(PALETTE.abyss));

  // App icons.
  const icon = iconSvg(false, false);
  const iconSmall = iconSvg(true, false);
  const iconWin = iconSvg(false, true);
  const iconWinSmall = iconSvg(true, true);
  fs.writeFileSync(path.join(BRAND, 'app-icon-macos.svg'), icon);
  fs.writeFileSync(path.join(BRAND, 'app-icon-small.svg'), iconSmall);
  fs.writeFileSync(path.join(BRAND, 'app-icon-windows.svg'), iconWin);
  render(icon, 1024, path.join(BUILD_RES, 'icon.png'));
  render(icon, 1024, path.join(PNG_DIR, 'app-icon-1024.png'));
  for (const s of [16, 32, 64, 128, 256]) {
    render(s <= 32 ? iconSmall : icon, s, path.join(PNG_DIR, `app-icon-${s}.png`));
  }

  const iconset = path.join(ROOT, '.cache/brand/Isoline.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const icnsSizes: [string, number][] = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, s] of icnsSizes) render(s <= 32 ? iconSmall : icon, s, path.join(iconset, name));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD_RES, 'icon.icns')]);
  fs.copyFileSync(path.join(BUILD_RES, 'icon.icns'), path.join(BRAND, 'icon.icns'));

  // The macOS 26+ icon (Icon Composer), next to the icns that older systems read.
  const composer = iconComposer();
  const iconDir = path.join(BUILD_RES, 'Isoline.icon');
  fs.rmSync(iconDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(iconDir, 'Assets'), { recursive: true });
  fs.writeFileSync(path.join(iconDir, 'icon.json'), composer.json);
  for (const [name, svg] of Object.entries(composer.layers))
    render(svg, 1024, path.join(iconDir, 'Assets', name));

  const ico = [16, 24, 32, 48, 64, 128, 256].map((s) => ({
    size: s,
    png: new Resvg(s <= 32 ? iconWinSmall : iconWin, { fitTo: { mode: 'width', value: s } }).render().asPng(),
  }));
  writeIco(ico, path.join(BUILD_RES, 'icon.ico'));
  fs.copyFileSync(path.join(BUILD_RES, 'icon.ico'), path.join(BRAND, 'icon.ico'));

  // DMG background (1x + Retina).
  render(dmgBackground(1), 660, path.join(BUILD_RES, 'dmg-background.png'));
  render(dmgBackground(2), 1320, path.join(BUILD_RES, 'dmg-background@2x.png'));

  // Moodboard + palette sheet.
  const mb = moodboard();
  fs.writeFileSync(path.join(BRAND, 'moodboard.svg'), mb);
  render(mb, 1920, path.join(BRAND, 'moodboard.png'));
  const ps = paletteSheet();
  fs.writeFileSync(path.join(BRAND, 'player-palettes.svg'), ps);
  render(ps, 1620, path.join(BRAND, 'player-palettes.png'));

  // In-app copies.
  fs.writeFileSync(path.join(UI_BRAND, 'symbol.svg'), symbolSvg('dark').replace(/<rect[^>]*\/>/, ''));
  fs.writeFileSync(path.join(UI_BRAND, 'logotype.svg'), ltSvg(PALETTE.parchment));
  fs.writeFileSync(path.join(UI_BRAND, 'logo-slogan.svg'), fullLogoSvg('mono-white', true));
  console.log('brand kit generated');
}

main();
