// Map textures: building markers (Lucide glyph on a dark badge with an owner
// ring), top-down unit sprites drawn as SVG (neutral hull + owner-coloured mark; ships
// in shipArt.ts), deposits and particle sprites.
import { CanvasSource, Graphics, Texture, type Renderer } from 'pixi.js';
import { BUILDING_ICONS, SIGNALS, iconMarkup, iconSvg, type IconName } from '../ui/icons/icons';
import {
  CHEVRON_SVG,
  FLASH_SVG,
  MERCHANT_ART,
  REPAIR_SVG,
  SHIP_H,
  SHIP_RASTER,
  SHIP_W,
  TRANSPORT_ART,
  TURRET_H,
  TURRET_SVG,
  TURRET_W,
  WAKE_H,
  WAKE_SVG,
  WAKE_W,
  WARSHIP_ART,
  svgDoc,
  type ShipArt,
} from './shipArt';

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
  /** Ships: transport, warship and merchant layers, warship turret, flash and wake. */
  ships: { transport: ShipTextures; warship: ShipTextures; merchant: ShipTextures };
  turret: Texture;
  flash: Texture;
  wake: Texture;
  /** Veterancy chevron and repair cross over warships. */
  chevron: Texture;
  repair: Texture;
  train: UnitSprite;
  trainCar: UnitSprite;
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
  /** Diplomatic status badges shown above country names. */
  status: Record<StatusIcon, Texture>;
  /** White glyphs (tinted at runtime). */
  sword: Texture;
  /** Weather cell markers, by kind: storm, fog bank. */
  weather: Texture[];
}

/** Status badges above a country's name, in display order (left to right). */
export const STATUS_ICONS = [
  'revolt',
  'crown',
  'traitor',
  'inactive',
  'ally',
  'request',
  'war',
  'noTrade',
  'nuke',
  'nukeMe',
] as const;
export type StatusIcon = (typeof STATUS_ICONS)[number];

/** Glyph and colour of each status badge. */
export const STATUS_STYLE: Record<StatusIcon, { icon: IconName; color: string }> = {
  revolt: { icon: 'revolt', color: '#f3e7cf' },
  crown: { icon: 'crown', color: '#f5c542' },
  traitor: { icon: 'brokenShield', color: '#f6c343' },
  inactive: { icon: 'inactive', color: '#8ab8ff' },
  ally: { icon: 'alliance', color: '#5be08a' },
  request: { icon: 'mail', color: '#f3f1ea' },
  war: { icon: 'sword', color: '#ff6b6b' },
  noTrade: { icon: 'noTrade', color: '#f3f1ea' },
  nuke: { icon: 'nuke', color: '#f3f1ea' },
  nukeMe: { icon: 'nuke', color: '#ff4d4d' },
};

function statusSvg(k: StatusIcon): string {
  const { icon, color } = STATUS_STYLE[k];
  // The embargo badge keeps a white dollar under a red bar.
  const slash = k === 'noTrade' ? `<path d="m3 3 18 18" stroke="#ff5c5c" stroke-width="2.6"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="28" fill="#10141a" fill-opacity="0.92" stroke="${color}" stroke-width="3.5"/>` +
    `<g transform="translate(15 15) scale(1.4167)" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(icon)}${slash}</g>` +
    `</svg>`
  );
}

/** Marker at the centre of a weather cell: a light glyph on a dark, translucent disc. */
function weatherSvg(icon: IconName, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="27" fill="#0c1a26" fill-opacity="0.72" stroke="${color}" stroke-opacity="0.8" stroke-width="2.5"/>` +
    `<g transform="translate(16 16) scale(1.333)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(icon)}</g>` +
    `</svg>`
  );
}

function gen(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const t = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return t;
}

export async function svgTexture(svg: string, width: number, height: number): Promise<Texture> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return Texture.from(canvas);
}

/**
 * Like svgTexture, with mipmaps: ship art is drawn large (crisp when zoomed in) and shown
 * at 16–34 px, which plain linear filtering would alias.
 */
export async function svgTextureMip(svg: string, width: number, height: number): Promise<Texture> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return new Texture({
    source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' }),
  });
}

/**
 * A ship in two layers: the owner's mark (white, tinted; drawn first, a little wider so no
 * seam shows) and the hull with its details, open over the mark. Geometry in art units.
 */
export interface ShipTextures {
  mark: Texture;
  hull: Texture;
  stern: number;
  bow: number;
  turrets: number[];
}

async function ship(art: ShipArt): Promise<ShipTextures> {
  const W = SHIP_W * SHIP_RASTER;
  const H = SHIP_H * SHIP_RASTER;
  const cut = art.mark.replaceAll('fill="#fff"', 'fill="#000"');
  const hull =
    `<defs><mask id="d" maskUnits="userSpaceOnUse" x="0" y="0" width="${SHIP_W}" height="${SHIP_H}">` +
    `<rect width="${SHIP_W}" height="${SHIP_H}" fill="#fff"/>${cut}</mask></defs>` +
    `<g mask="url(#d)">${art.base}</g>${art.top}`;
  const mark = art.mark.replaceAll(
    'fill="#fff"',
    'fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"',
  );
  return {
    mark: await svgTextureMip(svgDoc(SHIP_W, SHIP_H, mark), W, H),
    hull: await svgTextureMip(svgDoc(SHIP_W, SHIP_H, hull), W, H),
    stern: art.stern,
    bow: art.bow,
    turrets: art.turrets,
  };
}

// ------------------------------------------------------------- unit artwork
// All units point to the right (+x); 1 SVG unit = 1/4 px at the 4× raster.

// Trains are articulated: a locomotive and wagons drawn one by one along the track.
const TRAIN_LOCO = {
  w: 40,
  h: 16,
  base: `
    <path d="M2 2.5 L30 2.5 Q37 3 38 8 Q37 13 30 13.5 L2 13.5 Z" fill="#2f3439" stroke="#15181b" stroke-width="0.8"/>
    <rect x="4" y="4.5" width="14" height="7" rx="1" fill="#454c53"/>
    <rect x="29" y="5" width="5" height="6" rx="1" fill="#d9e2e8"/>`,
  mark: `<rect x="19" y="3.5" width="9" height="9" rx="1" fill="#fff"/>`,
  length: 1.33,
};

const TRAIN_CAR = {
  w: 30,
  h: 16,
  base: `
    <rect x="1.5" y="3" width="27" height="10" rx="1.5" fill="#6b5844" stroke="#25221e" stroke-width="0.8"/>
    <line x1="4.5" y1="8" x2="25.5" y2="8" stroke="#00000055" stroke-width="0.8"/>`,
  mark: ``,
  length: 1,
};

const plane = (wing: string, body: string, extra = '') => ({
  w: 48,
  h: 48,
  base: `<path d="${wing}" fill="#7f8a94" stroke="#2b3138" stroke-width="1"/><path d="${body}" fill="#a3adb6" stroke="#2b3138" stroke-width="0.8"/>${extra}`,
  mark: `<circle cx="22" cy="14" r="2.6" fill="#fff"/><circle cx="22" cy="34" r="2.6" fill="#fff"/>`,
  length: 2.4,
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
  length: 3.2,
};
const RECON = {
  ...plane(
    'M28 24 L24 4 L21 4 L21 22 L10 22.5 L8 21 L6 21.5 L8 24 L6 26.5 L8 27 L10 25.5 L21 26 L21 44 L24 44 Z',
    'M44 24 Q41 22.4 32 22.4 L8 23 L8 25 L32 25.6 Q41 25.6 44 24 Z',
  ),
  length: 2,
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
  const status = {} as Record<StatusIcon, Texture>;
  for (const k of STATUS_ICONS) status[k] = await svgTexture(statusSvg(k), 96, 96);
  return {
    signals,
    status,
    sword: await svgTexture(iconSvg('sword', '#ffffff', 2.4, 24), 64, 64),
    weather: [
      await svgTexture(weatherSvg('storm', '#c9d6e8'), 96, 96),
      await svgTexture(weatherSvg('fogBank', '#eef3f2'), 96, 96),
    ],
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
    ships: {
      transport: await ship(TRANSPORT_ART),
      warship: await ship(WARSHIP_ART),
      merchant: await ship(MERCHANT_ART),
    },
    turret: await svgTextureMip(svgDoc(TURRET_W, TURRET_H, TURRET_SVG), TURRET_W * 4, TURRET_H * 4),
    flash: await svgTextureMip(svgDoc(32, 32, FLASH_SVG), 128, 128),
    wake: await svgTextureMip(svgDoc(WAKE_W, WAKE_H, WAKE_SVG), WAKE_W * 4, WAKE_H * 4),
    chevron: await svgTextureMip(svgDoc(16, 16, CHEVRON_SVG), 64, 64),
    repair: await svgTextureMip(svgDoc(16, 16, REPAIR_SVG), 64, 64),
    train: await unit(TRAIN_LOCO),
    trainCar: await unit(TRAIN_CAR),
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
