// Procedural flags / coats of arms generated from a seed (Canvas 2D).
import { Rng } from '../core/rng';

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
