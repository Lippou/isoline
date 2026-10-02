// Map textures: building markers (Lucide glyph on a dark badge with an owner
// ring), top-down unit sprites drawn as SVG (neutral hull + owner-coloured mark),
// deposits and particle sprites.
import { Graphics, Texture, type Renderer } from 'pixi.js';
import { BUILDING_ICONS, SIGNALS, iconMarkup, iconSvg, type IconName } from '../ui/icons/icons';

export interface UnitSprite {
  base: Texture;
  /** Parts painted in the owner's colour (white texture, tinted at runtime). */
  mark: Texture;
  /** Length in tiles at reference zoom. */
  length: number;
}

export interface IconSet {
  buildings: Texture[];
  /** Dark badge disc under building glyphs. */
  backdrop: Texture;
  /** Owner ring around the badge (white, tinted). */
  badgeRing: Texture;
  ring: Texture;
  warship: UnitSprite;
  transport: UnitSprite;
  merchant: UnitSprite;
  train: UnitSprite;
  fighter: UnitSprite;
  bomber: UnitSprite;
  recon: UnitSprite;
  dot: Texture;
  glow: Texture;
  spark: Texture;
  smoke: Texture;
  deposit: Texture[];
  /** Tactical signal badges, in SIGNALS order. */
  signals: Texture[];
}

function gen(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const t = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return t;
}

async function svgTexture(svg: string, width: number, height: number): Promise<Texture> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return Texture.from(canvas);
}

const svgDoc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// ------------------------------------------------------------- unit artwork
// All units point to the right (+x); 1 SVG unit = 1/4 px at the 4× raster.

const WARSHIP = {
  w: 100,
  h: 24,
  base: `
    <path d="M3 12 L13 4.5 L80 4.5 Q93 7 98 12 Q93 17 80 19.5 L13 19.5 Z" fill="#59626b" stroke="#22282e" stroke-width="1.2"/>
    <path d="M15 7.5 L79 7.5 Q88 9.5 92 12 Q88 14.5 79 16.5 L15 16.5 Z" fill="#76808a"/>
    <rect x="38" y="8.5" width="22" height="7" rx="1" fill="#9aa3ab" stroke="#3a4148" stroke-width="0.6"/>
    <rect x="54" y="9.5" width="5" height="5" fill="#c5ccd2"/>
    <rect x="44" y="9.6" width="4.5" height="4.8" rx="1" fill="#2d3237"/>
    <circle cx="25" cy="12" r="3.4" fill="#4a525a" stroke="#22282e" stroke-width="0.6"/>
    <rect x="13" y="11.2" width="10" height="1.6" fill="#3a4148"/>
    <circle cx="72" cy="12" r="3.4" fill="#4a525a" stroke="#22282e" stroke-width="0.6"/>
    <rect x="74" y="11.2" width="11" height="1.6" fill="#3a4148"/>
    <line x1="33" y1="12" x2="36" y2="12" stroke="#c5ccd2" stroke-width="0.8"/>`,
  mark: `<rect x="6" y="9" width="5" height="6" rx="0.8" fill="#fff"/><path d="M62 8.5 h3 v7 h-3 z" fill="#fff"/>`,
  length: 3.2,
};

const TRANSPORT = {
  w: 64,
  h: 26,
  base: `
    <path d="M3 4 L52 4 L61 9 L61 17 L52 22 L3 22 Z" fill="#6c6a5c" stroke="#2c2b24" stroke-width="1.2"/>
    <rect x="12" y="7" width="38" height="12" rx="1.5" fill="#4d4b40"/>
    <g fill="#a39c7c">${Array.from({ length: 12 }, (_, k) => `<circle cx="${16 + (k % 6) * 6}" cy="${k < 6 ? 10.5 : 15.5}" r="1.7"/>`).join('')}</g>
    <rect x="4" y="8" width="7" height="10" rx="1" fill="#8a8672"/>`,
  mark: `<rect x="52" y="8" width="4" height="10" fill="#fff"/>`,
  length: 2.2,
};

const CONTAINERS = ['#b5452f', '#2f6e9e', '#c9a227', '#3d8b5a', '#8a4f9e', '#d07a2a'];
const MERCHANT = {
  w: 96,
  h: 22,
  base: `
    <path d="M4 3.5 L80 3.5 Q92 6 95 11 Q92 16 80 18.5 L4 18.5 Q2 11 4 3.5 Z" fill="#2f3439" stroke="#15181b" stroke-width="1"/>
    <path d="M6 5.5 L79 5.5 Q88 7.5 91 11 Q88 14.5 79 16.5 L6 16.5 Z" fill="#7e3b30"/>
    <g>${Array.from({ length: 16 }, (_, k) => {
      const col = Math.floor(k / 2);
      const row = k % 2;
      return `<rect x="${24 + col * 7}" y="${6.5 + row * 4.8}" width="6.2" height="4.2" fill="${CONTAINERS[(k * 5 + col) % CONTAINERS.length]}"/>`;
    }).join('')}</g>
    <rect x="7" y="6" width="13" height="10" rx="1" fill="#e9e6dc" stroke="#6d6a62" stroke-width="0.5"/>
    <rect x="9" y="7.5" width="9" height="2" fill="#2d3237"/>`,
  mark: `<rect x="13" y="12" width="5" height="3" fill="#fff"/>`,
  length: 3,
};

const TRAIN = {
  w: 132,
  h: 16,
  base: `
    ${[0, 1, 2]
      .map(
        (k) =>
          `<rect x="${3 + k * 30}" y="3" width="27" height="10" rx="1.5" fill="${['#6b5844', '#5d6168', '#6b5844'][k]}" stroke="#25221e" stroke-width="0.8"/>` +
          `<line x1="${6 + k * 30}" y1="8" x2="${27 + k * 30}" y2="8" stroke="#00000055" stroke-width="0.8"/>`,
      )
      .join('')}
    <path d="M94 2.5 L122 2.5 Q129 3 130 8 Q129 13 122 13.5 L94 13.5 Z" fill="#2f3439" stroke="#15181b" stroke-width="0.8"/>
    <rect x="96" y="4.5" width="14" height="7" rx="1" fill="#454c53"/>
    <rect x="121" y="5" width="5" height="6" rx="1" fill="#d9e2e8"/>`,
  mark: `<rect x="111" y="3.5" width="9" height="9" rx="1" fill="#fff"/>`,
  length: 3.3,
};

const plane = (wing: string, body: string, extra = '') => ({
  w: 48,
  h: 48,
  base: `<path d="${wing}" fill="#7f8a94" stroke="#2b3138" stroke-width="1"/><path d="${body}" fill="#a3adb6" stroke="#2b3138" stroke-width="0.8"/>${extra}`,
  mark: `<circle cx="22" cy="14" r="2.6" fill="#fff"/><circle cx="22" cy="34" r="2.6" fill="#fff"/>`,
  length: 1.6,
});

const FIGHTER = plane(
  'M30 24 L18 6 L14 6 L18 22 L6 20 L4 21 L6 24 L4 27 L6 28 L18 26 L14 42 L18 42 Z',
  'M44 24 Q40 21.5 30 21.5 L6 22.5 L6 25.5 L30 26.5 Q40 26.5 44 24 Z',
  '<path d="M38 24 Q36 22.6 33 22.6 L33 25.4 Q36 25.4 38 24 Z" fill="#2d3540"/>',
);
const BOMBER = {
  ...plane(
    'M28 24 L22 2 L17 2 L18 21 L8 21 L5 18 L3 18 L5 24 L3 30 L5 30 L8 27 L18 27 L17 46 L22 46 Z',
    'M46 24 Q43 21 32 21 L4 22 L4 26 L32 27 Q43 27 46 24 Z',
  ),
  length: 2.2,
};
const RECON = {
  ...plane(
    'M28 24 L24 4 L21 4 L21 22 L10 22.5 L8 21 L6 21.5 L8 24 L6 26.5 L8 27 L10 25.5 L21 26 L21 44 L24 44 Z',
    'M44 24 Q41 22.4 32 22.4 L8 23 L8 25 L32 25.6 Q41 25.6 44 24 Z',
  ),
  length: 1.4,
};

async function unit(art: {
  w: number;
  h: number;
  base: string;
  mark: string;
  length: number;
}): Promise<UnitSprite> {
  const W = art.w * 4;
  const H = art.h * 4;
  return {
    base: await svgTexture(svgDoc(art.w, art.h, art.base), W, H),
    mark: await svgTexture(svgDoc(art.w, art.h, art.mark), W, H),
    length: art.length,
  };
}

// ------------------------------------------------------------------ deposits

const DEPOSIT: (IconName | null)[] = [null, 'oil', 'uranium', 'fertile', 'metals'];
const DEPOSIT_COLOR = ['#ffffff', '#1d1f22', '#9be564', '#e6c55a', '#8fc7ee'];

function badgeSvg(icon: IconName, ring: string, fill = '#14181d'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="28" fill="${fill}" fill-opacity="0.9" stroke="${ring}" stroke-width="4"/>` +
    `<g transform="translate(16 16) scale(1.333)" fill="none" stroke="#f3f1ea" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(icon)}</g>` +
    `</svg>`
  );
}

export async function buildIcons(renderer: Renderer): Promise<IconSet> {
  const buildings: Texture[] = [];
  for (const name of BUILDING_ICONS)
    buildings.push(await svgTexture(iconSvg(name, '#f5f3ec', 2.1, 24), 96, 96));
  const soft = (r: number, steps = 10) =>
    gen(renderer, (g) => {
      for (let k = steps; k >= 1; k--) g.circle(r, r, (r * k) / steps).fill({ color: 0xffffff, alpha: 0.11 });
    });
  const deposit: Texture[] = [];
  for (let k = 0; k < DEPOSIT.length; k++) {
    const icon = DEPOSIT[k];
    deposit.push(
      icon
        ? await svgTexture(badgeSvg(icon, DEPOSIT_COLOR[k]!), 64, 64)
        : gen(renderer, (g) => g.circle(8, 8, 8).fill(0xffffff)),
    );
  }
  const signals: Texture[] = [];
  for (const sig of SIGNALS) signals.push(await svgTexture(badgeSvg(sig.icon, '#e9b44c', '#1a1d22'), 96, 96));
  return {
    signals,
    buildings,
    backdrop: await svgTexture(
      svgDoc(64, 64, `<circle cx="32" cy="32" r="27" fill="#12161b" fill-opacity="0.92"/>`),
      128,
      128,
    ),
    badgeRing: await svgTexture(
      svgDoc(64, 64, `<circle cx="32" cy="32" r="28.5" fill="none" stroke="#fff" stroke-width="5"/>`),
      128,
      128,
    ),
    ring: gen(renderer, (g) => g.circle(64, 64, 62).stroke({ width: 3, color: 0xffffff })),
    warship: await unit(WARSHIP),
    transport: await unit(TRANSPORT),
    merchant: await unit(MERCHANT),
    train: await unit(TRAIN),
    fighter: await unit(FIGHTER),
    bomber: await unit(BOMBER),
    recon: await unit(RECON),
    dot: gen(renderer, (g) => g.circle(8, 8, 8).fill({ color: 0xffffff })),
    glow: soft(64, 14),
    spark: gen(renderer, (g) => {
      g.circle(6, 6, 6).fill({ color: 0xffffff, alpha: 0.35 });
      g.circle(6, 6, 2.5).fill({ color: 0xffffff });
    }),
    smoke: soft(32, 8),
    deposit,
  };
}
