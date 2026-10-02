// Custom flags as SVG documents (pure string building: usable in tests, the UI's
// <img> tags and the map's label textures). Field 60 × 40 (3:2); emblems are drawn
// in a 100 × 100 box and placed by emblemBox().
import {
  sanitizeFlagSpec,
  type EmblemPosition,
  type FlagEmblem,
  type FlagLayout,
  type FlagSpec,
} from '../core/data/flagSpec';

export const FLAG_W = 60;
export const FLAG_H = 40;

const f2 = (n: number) => String(Math.round(n * 100) / 100);

/** Polygon of an n-pointed star centred in the 100-box. */
function starPoints(points: number, outer: number, inner: number, rot = -Math.PI / 2): string {
  const out: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? outer : inner;
    const a = rot + (k * Math.PI) / points;
    out.push(`${f2(50 + Math.cos(a) * r)} ${f2(50 + Math.sin(a) * r)}`);
  }
  return `M${out.join('L')}Z`;
}

/** Crescent: big circle minus an offset smaller one, as two arcs between their intersections. */
function crescentPath(): string {
  const [ax, ay, ra] = [44, 50, 40];
  const [bx, by, rb] = [60, 42, 33];
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  const a = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(ra * ra - a * a);
  const mx = ax + (a * dx) / d;
  const my = ay + (a * dy) / d;
  const [p1x, p1y] = [mx - (h * dy) / d, my + (h * dx) / d];
  const [p2x, p2y] = [mx + (h * dy) / d, my - (h * dx) / d];
  return (
    `M${f2(p2x)} ${f2(p2y)}A${ra} ${ra} 0 1 0 ${f2(p1x)} ${f2(p1y)}` +
    `A${rb} ${rb} 0 1 1 ${f2(p2x)} ${f2(p2y)}Z`
  );
}

function sunPath(): string {
  let d = '';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
    const w = 0.15;
    const p = (r: number, da: number) => `${f2(50 + Math.cos(a + da) * r)} ${f2(50 + Math.sin(a + da) * r)}`;
    d += `M${p(29, -w)}L${p(48, 0)}L${p(29, w)}Z`;
  }
  return d;
}

const CRESCENT = crescentPath();
const SUN_RAYS = sunPath();
const STAR = starPoints(5, 48, 19);
const COMPASS = starPoints(4, 48, 11) + starPoints(4, 30, 9, -Math.PI / 4);

/** Emblem markup (100-box) in one colour. Hand-drawn simple charges. */
export function emblemMarkup(e: FlagEmblem, color: string): string {
  const fill = `fill="${color}"`;
  const stroke = (w: number) =>
    `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (e) {
    case 'none':
      return '';
    case 'star':
      return `<path ${fill} d="${STAR}"/>`;
    case 'sun':
      return `<circle ${fill} cx="50" cy="50" r="22"/><path ${fill} d="${SUN_RAYS}"/>`;
    case 'crescent':
      return `<path ${fill} d="${CRESCENT}"/>`;
    case 'compass':
      return `<path ${fill} d="${COMPASS}"/>`;
    case 'anchor':
      return (
        `<g ${stroke(8)}><circle cx="50" cy="16" r="9"/><path d="M50 25V90M32 38H68` +
        `M17 60Q20 90 50 90Q80 90 83 60M10 67L17 58L25 65M90 67L83 58L75 65"/></g>`
      );
    case 'mountain':
      return `<path ${fill} d="M3 86L35 28L50 52L65 20L97 86Z"/>`;
    case 'wave':
      return `<path ${stroke(8)} d="M8 32q10.5 -11 21 0t21 0t21 0t21 0M8 54q10.5 -11 21 0t21 0t21 0t21 0M8 76q10.5 -11 21 0t21 0t21 0t21 0"/>`;
    case 'tree':
      return `<path ${fill} d="M50 4L76 40H63L84 67H57V94H43V67H16L37 40H24Z"/>`;
    case 'crown':
      return (
        `<path ${fill} d="M14 76L8 32L31 52L50 22L69 52L92 32L86 76Z"/>` +
        `<rect ${fill} x="14" y="81" width="72" height="11" rx="2"/>` +
        `<circle ${fill} cx="8" cy="28" r="6"/><circle ${fill} cx="50" cy="17" r="6"/><circle ${fill} cx="92" cy="28" r="6"/>`
      );
    case 'isoline':
      return (
        `<g ${stroke(7)}><path d="M50 7C75 7 93 24 91 48C89 73 72 93 47 91C23 89 7 72 9 49C11 25 27 7 50 7Z"/>` +
        `<path d="M52 25C68 25 77 37 75 52C73 66 62 75 48 73C34 71 25 62 27 48C29 34 38 25 52 25Z"/></g>` +
        `<path ${fill} d="M50 40C58 40 63 46 61 53C59 59 53 62 47 60C41 58 38 52 40 47C42 42 46 40 50 40Z"/>`
      );
  }
}

/** Where the emblem sits on the 60 × 40 field: centre and box size. */
export function emblemBox(layout: FlagLayout, at: EmblemPosition): { cx: number; cy: number; size: number } {
  if (at === 'canton') {
    if (layout === 'nordic') return { cx: 8, cy: 7.5, size: 11 };
    return { cx: 15, cy: 10, size: 14 };
  }
  if (at === 'hoist') {
    if (layout === 'triangle') return { cx: 8.5, cy: 20, size: 12 };
    if (layout === 'bandsV3') return { cx: 10, cy: 20, size: 15 };
    return { cx: 12, cy: 20, size: 15 };
  }
  if (layout === 'disc') return { cx: 30, cy: 20, size: 16 };
  if (layout === 'nordic') return { cx: 21, cy: 20, size: 12 };
  if (layout === 'bandsH3' || layout === 'bend') return { cx: 30, cy: 20, size: 17 };
  return { cx: 30, cy: 20, size: 22 };
}

/** Field markup for a layout (60 × 40). */
export function fieldMarkup(layout: FlagLayout, colors: readonly string[]): string {
  const [a, b, c] = colors as [string, string, string];
  const r = (x: number, y: number, w: number, h: number, col: string) =>
    `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${col}"/>`;
  const W = FLAG_W;
  const H = FLAG_H;
  const base = r(0, 0, W, H, a);
  switch (layout) {
    case 'plain':
      return base;
    case 'bandsH2':
      return base + r(0, H / 2, W, H / 2, b);
    case 'bandsH3':
      return base + r(0, H / 3, W, H / 3, b) + r(0, (2 * H) / 3, W, H / 3, c);
    case 'bandsV2':
      return base + r(W / 2, 0, W / 2, H, b);
    case 'bandsV3':
      return base + r(W / 3, 0, W / 3, H, b) + r((2 * W) / 3, 0, W / 3, H, c);
    case 'stripes': {
      let s = base;
      for (let k = 1; k < 7; k += 2) s += r(0, (k * H) / 7, W, H / 7, b);
      return s;
    }
    case 'cross':
      return base + r(25, 0, 10, H, b) + r(0, 15, W, 10, b);
    case 'nordic':
      return base + r(15, 0, 12, H, b) + r(0, 14, W, 12, b) + r(18, 0, 6, H, c) + r(0, 17, W, 6, c);
    case 'saltire':
      return base + `<path d="M0 0L60 40M60 0L0 40" stroke="${b}" stroke-width="8"/>`;
    case 'diagonal':
      return base + `<path d="M60 0V40H0Z" fill="${b}"/>`;
    case 'bend':
      return (
        base + `<path d="M60 0V40H0Z" fill="${c}"/><path d="M0 40L60 0" stroke="${b}" stroke-width="11"/>`
      );
    case 'canton':
      return base + r(0, 0, 30, 20, b);
    case 'border':
      return r(0, 0, W, H, b) + r(4.5, 4.5, W - 9, H - 9, a);
    case 'disc':
      return base + `<circle cx="30" cy="20" r="12" fill="${b}"/>`;
    case 'triangle':
      return base + r(0, H / 2, W, H / 2, c) + `<path d="M0 0L26 20L0 40Z" fill="${b}"/>`;
    case 'quartered':
      return base + r(W / 2, 0, W / 2, H / 2, b) + r(0, H / 2, W / 2, H / 2, b);
  }
}

/** Standalone SVG document of a custom flag (invalid specs are sanitised first). */
export function flagSvg(raw: FlagSpec, width = FLAG_W * 2): string {
  const s = sanitizeFlagSpec(raw) ?? sanitizeFlagSpec({ layout: 'plain', colors: ['#8a9196'] })!;
  let body = fieldMarkup(s.layout, s.colors);
  if (s.emblem !== 'none') {
    const { cx, cy, size } = emblemBox(s.layout, s.emblemAt);
    const k = size / 100;
    body +=
      `<g transform="translate(${f2(cx - size / 2)} ${f2(cy - size / 2)}) scale(${f2(k)})">` +
      emblemMarkup(s.emblem, s.emblemColor) +
      '</g>';
  }
  const height = Math.round((width * FLAG_H) / FLAG_W);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${FLAG_W} ${FLAG_H}" preserveAspectRatio="none">${body}</svg>`
  );
}

/** data: URL of a custom flag, for <img> and texture loading. */
export function flagSvgUrl(spec: FlagSpec, width = FLAG_W * 2): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flagSvg(spec, width))}`;
}
