// Player flags: a real country's flag (ISO code) or a custom design built in the
// flag editor. Cosmetic only: carried by the player slot of the game config and
// by the views, never read by the simulation rules. Everything that arrives from
// elsewhere (profile file, LAN peers, saves, replays) goes through sanitizeFlag().

export const FLAG_LAYOUTS = [
  'plain',
  'bandsH2',
  'bandsH3',
  'bandsV2',
  'bandsV3',
  'stripes',
  'cross',
  'nordic',
  'saltire',
  'diagonal',
  'bend',
  'canton',
  'border',
  'disc',
  'triangle',
  'quartered',
] as const;
export type FlagLayout = (typeof FLAG_LAYOUTS)[number];

/** Field colours each layout paints (the first n of spec.colors). */
export const LAYOUT_COLORS: Record<FlagLayout, 1 | 2 | 3> = {
  plain: 1,
  bandsH2: 2,
  bandsH3: 3,
  bandsV2: 2,
  bandsV3: 3,
  stripes: 2,
  cross: 2,
  nordic: 3,
  saltire: 2,
  diagonal: 2,
  bend: 3,
  canton: 2,
  border: 2,
  disc: 2,
  triangle: 3,
  quartered: 2,
};

export const FLAG_EMBLEMS = [
  'none',
  'star',
  'sun',
  'crescent',
  'compass',
  'anchor',
  'mountain',
  'wave',
  'tree',
  'crown',
  'isoline',
] as const;
export type FlagEmblem = (typeof FLAG_EMBLEMS)[number];

export const EMBLEM_POSITIONS = ['center', 'hoist', 'canton'] as const;
export type EmblemPosition = (typeof EMBLEM_POSITIONS)[number];

/** Curated vexillological palette offered first by the editor (any #rrggbb is valid). */
export const FLAG_PALETTE: readonly string[] = [
  '#ffffff',
  '#f2ead3',
  '#141414',
  '#8a9196',
  '#c8102e',
  '#8d1b2c',
  '#e4572e',
  '#ee7623',
  '#fcd116',
  '#c8922a',
  '#00843d',
  '#1e5631',
  '#0f7b74',
  '#5aaee0',
  '#0055a4',
  '#002868',
  '#5b2a86',
  '#d45d87',
  '#6b3e26',
  '#16324a',
];

export interface FlagSpec {
  layout: FlagLayout;
  /** Field colours (#rrggbb), always three; the layout uses the first LAYOUT_COLORS[layout]. */
  colors: [string, string, string];
  emblem: FlagEmblem;
  emblemColor: string;
  emblemAt: EmblemPosition;
}

/** A player's chosen flag. Absent: the generated flag of its seed (pre-1.4 behaviour). */
export type PlayerFlag = { iso: string } | { spec: FlagSpec };

export function defaultFlagSpec(): FlagSpec {
  return {
    layout: 'bandsH3',
    colors: ['#16324a', '#f2ead3', '#0f7b74'],
    emblem: 'isoline',
    emblemColor: '#c8922a',
    emblemAt: 'center',
  };
}

const HEX = /^#[0-9a-f]{6}$/;
/** Lower-case #rrggbb, or null. Accepts #rgb shorthand. */
export function normalizeColor(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX.test(s) ? s : null;
}

/** ISO 3166 codes plus flag-icons' regional / organisation codes (gb-sct, es-ct, eu, un…). */
const ISO = /^[a-z]{2,6}(-[a-z]{2,3})?$/;

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** A clean FlagSpec from untrusted data, or null when it is not a flag spec at all. */
export function sanitizeFlagSpec(raw: unknown): FlagSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.layout !== 'string' || !(FLAG_LAYOUTS as readonly string[]).includes(r.layout)) return null;
  const d = defaultFlagSpec();
  const src = Array.isArray(r.colors) ? r.colors.slice(0, 3) : [];
  if (src.length === 0) return null;
  const colors = d.colors.map((fallback, k) => normalizeColor(src[k]) ?? fallback) as FlagSpec['colors'];
  // A colour missing from a short list repeats the last valid one (never an unrelated default).
  for (let k = src.length; k < 3; k++) colors[k] = colors[k - 1]!;
  return {
    layout: r.layout as FlagLayout,
    colors,
    emblem: oneOf(FLAG_EMBLEMS, r.emblem, 'none'),
    emblemColor: normalizeColor(r.emblemColor) ?? '#ffffff',
    emblemAt: oneOf(EMBLEM_POSITIONS, r.emblemAt, 'center'),
  };
}

/** A clean PlayerFlag from untrusted data (profile, LAN peer, save, replay), else undefined. */
export function sanitizeFlag(raw: unknown): PlayerFlag | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.iso === 'string') {
    const iso = r.iso.trim().toLowerCase();
    return iso.length <= 10 && ISO.test(iso) ? { iso } : undefined;
  }
  if ('spec' in r) {
    const spec = sanitizeFlagSpec(r.spec);
    return spec ? { spec } : undefined;
  }
  return undefined;
}

/** Stable identity of a flag (texture / image caches). */
export function flagKey(f: PlayerFlag): string {
  if ('iso' in f) return `iso:${f.iso}`;
  const s = f.spec;
  return `c:${s.layout}:${s.colors.join('')}:${s.emblem}:${s.emblemColor}:${s.emblemAt}`;
}

/** Compact text form (one JSON line) and back; parse returns null for anything invalid. */
export function serializeFlag(f: PlayerFlag): string {
  return JSON.stringify(f);
}
export function parseFlag(text: string): PlayerFlag | null {
  if (typeof text !== 'string' || text.length > 400) return null;
  try {
    return sanitizeFlag(JSON.parse(text)) ?? null;
  } catch {
    return null;
  }
}

/** Relative luminance (sRGB), 0..1. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The field colour the emblem sits on (for contrast checks). */
export function emblemGround(s: FlagSpec): string {
  const [a, b, c] = s.colors;
  if (s.emblemAt === 'canton') return s.layout === 'canton' ? b : a;
  if (s.emblemAt === 'hoist') return s.layout === 'triangle' || s.layout === 'bandsH3' ? b : a;
  switch (s.layout) {
    case 'bandsH3':
    case 'bandsV3':
    case 'bend':
      return b;
    case 'disc':
    case 'cross':
    case 'saltire':
      return b;
    case 'nordic':
      return c;
    default:
      return a;
  }
}

/**
 * A random, readable design: distinct neighbouring colours from the palette and an
 * emblem that contrasts with the field it sits on. `rand` returns [0, 1) (the UI
 * passes Math.random; tests pass a seeded generator).
 */
export function randomFlagSpec(rand: () => number): FlagSpec {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length) % a.length]!;
  const layout = pick(FLAG_LAYOUTS);
  const colors: string[] = [];
  while (colors.length < 3) {
    const c = pick(FLAG_PALETTE);
    const prev = colors[colors.length - 1];
    if (prev && (c === prev || contrast(c, prev) < 1.6)) continue;
    if (colors.includes(c) && colors.length < LAYOUT_COLORS[layout]) continue;
    colors.push(c);
  }
  const spec: FlagSpec = {
    layout,
    colors: colors as FlagSpec['colors'],
    emblem: rand() < 0.7 ? pick(FLAG_EMBLEMS.slice(1)) : 'none',
    emblemColor: '#ffffff',
    emblemAt:
      layout === 'canton' ? 'canton' : layout === 'triangle' || layout === 'bandsV3' ? 'hoist' : 'center',
  };
  if (layout === 'triangle' && rand() < 0.5) spec.emblemAt = 'hoist';
  const ground = emblemGround(spec);
  const options = FLAG_PALETTE.filter((c) => contrast(c, ground) >= 3);
  spec.emblemColor = options.length ? pick(options) : luminance(ground) > 0.4 ? '#141414' : '#ffffff';
  return spec;
}
