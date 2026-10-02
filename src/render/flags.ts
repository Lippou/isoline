// Procedural flags / coats of arms generated from a seed (Canvas 2D).
import { Rng } from '../core/rng';
import { flagKey, type FlagSpec, type PlayerFlag } from '../core/data/flagSpec';
import { flagSvgUrl } from './flagSvg';

const FIELD = [
  '#1B3A6B',
  '#B22234',
  '#F2F2EE',
  '#0F7B4F',
  '#E8B530',
  '#111418',
  '#5B2A86',
  '#2F6FB5',
  '#C8553D',
  '#7A1E2B',
  '#3E8E7E',
  '#E3D3A4',
];

function contrastPair(rng: Rng): [string, string, string] {
  const a = rng.pick(FIELD);
  let b = rng.pick(FIELD);
  while (b === a) b = rng.pick(FIELD);
  let c = rng.pick(FIELD);
  while (c === a || c === b) c = rng.pick(FIELD);
  return [a, b, c];
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points = 5): void {
  ctx.beginPath();
  for (let k = 0; k < points * 2; k++) {
    const rr = k % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (k * Math.PI) / points;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function emblem(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (rng.int(0, 5)) {
    case 0:
      star(ctx, x, y, r);
      break;
    case 1:
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.8, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.8, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 3: {
      // Sun with rays.
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = r * 0.16;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    }
    case 4:
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.7);
      ctx.lineTo(x - r * 0.9, y + r * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      star(ctx, x, y, r, 7);
  }
}

/** Draws a 3:2 flag for `seed` into a new canvas of the given width. */
export function drawFlag(seed: number, width = 60): HTMLCanvasElement {
  const h = Math.round((width * 2) / 3);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const rng = new Rng(seed ^ 0xf1a6);
  const [a, b, d] = contrastPair(rng);
  const w = width;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  const layout = rng.int(0, 8);
  switch (layout) {
    case 0: // horizontal tricolour
      ctx.fillStyle = b;
      ctx.fillRect(0, h / 3, w, h / 3);
      ctx.fillStyle = d;
      ctx.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case 1: // vertical tricolour
      ctx.fillStyle = b;
      ctx.fillRect(w / 3, 0, w / 3, h);
      ctx.fillStyle = d;
      ctx.fillRect((2 * w) / 3, 0, w / 3, h);
      break;
    case 2: // nordic cross
      ctx.fillStyle = b;
      ctx.fillRect(w * 0.3, 0, h * 0.22, h);
      ctx.fillRect(0, h * 0.39, w, h * 0.22);
      break;
    case 3: // diagonal band
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w * 0.25, h);
      ctx.lineTo(w, h * 0.0);
      ctx.lineTo(w * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 4: // canton
      ctx.fillStyle = b;
      for (let k = 0; k < 5; k++) if (k % 2 === 1) ctx.fillRect(0, (k * h) / 5, w, h / 5);
      ctx.fillStyle = d;
      ctx.fillRect(0, 0, w * 0.42, h * 0.6);
      emblem(ctx, rng, w * 0.21, h * 0.3, h * 0.2, a === '#F2F2EE' ? '#1B3A6B' : '#F2F2EE');
      break;
    case 5: // chevron
      ctx.fillStyle = b;
      ctx.fillRect(0, h / 2, w, h / 2);
      ctx.fillStyle = d;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.45, h / 2);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      break;
    case 6: // quartered
      ctx.fillStyle = b;
      ctx.fillRect(w / 2, 0, w / 2, h / 2);
      ctx.fillRect(0, h / 2, w / 2, h / 2);
      break;
    case 7: // bordered
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = a;
      ctx.fillRect(w * 0.1, h * 0.14, w * 0.8, h * 0.72);
      break;
    default: // bicolour with disc
      ctx.fillStyle = b;
      ctx.fillRect(0, h / 2, w, h / 2);
  }
  if (layout !== 4 && rng.chance(0.65)) {
    const ex = layout === 2 ? w * 0.36 : layout === 5 ? w * 0.16 : w / 2;
    emblem(ctx, rng, ex, h / 2, h * 0.24, d === a ? b : d);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, width / 40);
  ctx.strokeRect(0, 0, w, h);
  return c;
}

const urlCache = new Map<string, string>();
export function flagDataUrl(seed: number, width = 48): string {
  const key = `${seed}:${width}`;
  let u = urlCache.get(key);
  if (!u) {
    u = drawFlag(seed, width).toDataURL('image/png');
    urlCache.set(key, u);
  }
  return u;
}

// Real national flags (flag-icons, MIT): bundled as URLs, 4:3 SVG.
const REAL = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const REAL_BY_ISO = new Map<string, string>();
for (const [k, url] of Object.entries(REAL)) REAL_BY_ISO.set(k.slice(k.lastIndexOf('/') + 1, -4), url);

/** Every real flag the picker offers ('xx', the "unknown" placeholder, left out). */
export const REAL_FLAG_CODES: readonly string[] = [...REAL_BY_ISO.keys()].filter((c) => c !== 'xx').sort();

/** URL of a real flag by code, or undefined when it is not bundled. */
export function realFlagUrl(iso: string): string | undefined {
  return REAL_BY_ISO.get(iso);
}

/** Anything that carries a flag: player views, final stats, front-page rosters. */
export interface FlagOwner {
  flagSeed: number;
  iso?: string;
  /** The player's chosen flag (humans, 1.4+); absent: real flag by iso, else generated. */
  flag?: PlayerFlag | null;
}

const customCache = new Map<string, string>();
/** data: URL of a custom flag design (cached by its key). */
export function customFlagUrl(spec: FlagSpec): string {
  const key = flagKey({ spec });
  let u = customCache.get(key);
  if (!u) {
    u = flagSvgUrl(spec, 120);
    customCache.set(key, u);
  }
  return u;
}

/** The flag actually shown for an owner: chosen flag, else real flag, else generated. */
export function resolveFlag(p: FlagOwner): PlayerFlag | null {
  const f = p.flag;
  if (f) {
    if ('spec' in f) return f;
    if ('iso' in f && REAL_BY_ISO.has(f.iso)) return f;
  }
  if (p.iso && REAL_BY_ISO.has(p.iso)) return { iso: p.iso };
  return null;
}

/** Width / height of the flag image an owner shows (real flags are 4:3, the others 3:2). */
export function flagAspect(p: FlagOwner): number {
  const f = resolveFlag(p);
  return f && 'iso' in f ? 4 / 3 : 3 / 2;
}

/** Stable cache key of the flag an owner shows. */
export function ownerFlagKey(p: FlagOwner): string {
  const f = resolveFlag(p);
  return f ? flagKey(f) : `seed:${p.flagSeed >>> 0}`;
}

/** Flag image for a player: its chosen flag, the real flag of a real country, else its generated emblem. */
export function flagUrl(p: FlagOwner, width = 48): string {
  const f = resolveFlag(p);
  if (f) return 'iso' in f ? REAL_BY_ISO.get(f.iso)! : customFlagUrl(f.spec);
  return flagDataUrl(p.flagSeed, width);
}
