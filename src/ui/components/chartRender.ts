// Map previews drawn as a modern hydrographic chart (BRAND.md §4): white deep water, blue
// shoals along the coasts with a depth line, chamois land with contour lines every few
// metres (thicker index contours), a soft relief shading and a navy coastline.
// Rendered once per map and size in the browser, then cached as an object URL.
import { TERRAIN } from '../../core/map/terrain';
import { mapsBase } from '../bridge';
import { parseIsoMap } from '../../core/map/format';

type RGB = readonly [number, number, number];

// Terrain index order: deepOcean, shallow, lake, river, plains, hills, mountain, desert,
// forest, tundra, impassable.
const FILL: readonly RGB[] = [
  [247, 250, 250],
  [214, 232, 239],
  [206, 227, 237],
  [128, 172, 200],
  [234, 226, 202],
  [229, 216, 186],
  [219, 204, 172],
  [241, 228, 194],
  [222, 225, 196],
  [244, 244, 238],
  [208, 201, 188],
];
const SHOAL: RGB = [214, 232, 239];
const DEPTH_LINE: RGB = [176, 208, 222];
const COAST: RGB = [44, 80, 108];
const CONTOUR: RGB = [168, 146, 106];

const KEY = new Map<number, number>();
TERRAIN.forEach((tr, k) => KEY.set((tr.rgb[0] << 16) | (tr.rgb[1] << 8) | tr.rgb[2], k));

function classify(r: number, g: number, b: number): number {
  const exact = KEY.get((r << 16) | (g << 8) | b);
  if (exact !== undefined) return exact;
  let best = 0;
  let bd = Infinity;
  TERRAIN.forEach((tr, k) => {
    const d = (tr.rgb[0] - r) ** 2 + (tr.rgb[1] - g) ** 2 + (tr.rgb[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

const mix = (a: RGB, b: RGB, t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

async function pixels(blob: Blob, w: number, h: number, pixelated: boolean): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(blob, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: pixelated ? 'pixelated' : 'high',
  });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, w, h).data;
}

/** Renders a chart image (object URL) from the terrain and elevation PNGs of a map. */
export async function renderChart(terrainPng: Blob, elevPng: Blob, w: number, h: number): Promise<string> {
  const [tp, ep] = await Promise.all([pixels(terrainPng, w, h, true), pixels(elevPng, w, h, false)]);
  const n = w * h;
  const ter = new Uint8Array(n);
  const elev = new Float32Array(n);
  let maxElev = 1;
  for (let i = 0; i < n; i++) {
    ter[i] = classify(tp[i * 4]!, tp[i * 4 + 1]!, tp[i * 4 + 2]!);
    elev[i] = ep[i * 4]!;
    if (ter[i]! > 2 && elev[i]! > maxElev) maxElev = elev[i]!;
  }
  const water = (i: number) => ter[i]! <= 2;

  // Distance to the coast for water pixels (two-pass chamfer, capped): shoal tint + depth line.
  const CAP = Math.max(4, Math.round(w / 90));
  const dist = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) if (!water(i)) dist[i] = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i]!;
      if (x > 0) d = Math.min(d, dist[i - 1]! + 1);
      if (y > 0) d = Math.min(d, dist[i - w]! + 1);
      dist[i] = Math.min(d, 255);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i]!;
      if (x < w - 1) d = Math.min(d, dist[i + 1]! + 1);
      if (y < h - 1) d = Math.min(d, dist[i + w]! + 1);
      dist[i] = d;
    }

  // Contour interval: about eight levels between the coast and the highest summit.
  const interval = Math.max(10, maxElev / 8);
  const band = (i: number) => Math.floor(elev[i]! / interval);
  const relief = 2.2 / Math.max(1, interval);

  const out = new ImageData(w, h);
  const o = out.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = ter[i]!;
      let c: [number, number, number];
      if (t <= 2) {
        const d = dist[i]!;
        c = t === 0 ? mix(FILL[0]!, SHOAL, Math.max(0, 1 - d / CAP) ** 1.4) : [...FILL[t]!];
        if (t === 0 && d === Math.round(CAP * 0.75)) c = mix(c, DEPTH_LINE, 0.8);
        const coast =
          (x > 0 && !water(i - 1)) ||
          (x < w - 1 && !water(i + 1)) ||
          (y > 0 && !water(i - w)) ||
          (y < h - 1 && !water(i + w));
        if (coast) c = mix(c, COAST, 0.35);
      } else {
        c = [...FILL[t]!];
        // Relief shading, light from the north-west.
        const dx = elev[Math.min(i + 1, y * w + w - 1)]! - elev[Math.max(i - 1, y * w)]!;
        const dy = elev[Math.min(i + w, n - 1 - (w - 1 - x))]! - elev[Math.max(i - w, x)]!;
        const s = Math.max(-0.1, Math.min(0.08, (dx + dy) * relief * 0.04));
        c = s > 0 ? mix(c, [255, 252, 244], s * 2.5) : mix(c, [120, 100, 70], -s);
        // Contour lines (every fourth one is an index contour).
        const b = band(i);
        const edge =
          (x < w - 1 && ter[i + 1]! > 2 && band(i + 1) !== b) ||
          (y < h - 1 && ter[i + w]! > 2 && band(i + w) !== b);
        if (edge && b > 0) c = mix(c, CONTOUR, b % 4 === 0 ? 0.85 : 0.5);
        const coast =
          (x > 0 && water(i - 1)) ||
          (x < w - 1 && water(i + 1)) ||
          (y > 0 && water(i - w)) ||
          (y < h - 1 && water(i + w));
        if (coast) c = mix(c, COAST, 0.9);
      }
      o[i * 4] = c[0];
      o[i * 4 + 1] = c[1];
      o[i * 4 + 2] = c[2];
      o[i * 4 + 3] = 255;
    }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
}

// One render at a time keeps the menus responsive; results are cached for the session.
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job, job);
  queue = p.catch(() => undefined);
  return p;
}

/** Chart image of a shipped map, `width` pixels wide (height follows the map's ratio). */
export function chartOfMap(id: string, mapW: number, mapH: number, width: number): Promise<string> {
  const key = `${id}@${width}`;
  let p = cache.get(key);
  if (!p) {
    const h = Math.max(1, Math.round((width * mapH) / mapW));
    p = enqueue(async () => {
      const [t, e] = await Promise.all([
        fetch(`${mapsBase()}${id}.png`).then((r) => r.blob()),
        fetch(`${mapsBase()}${id}.elev.png`).then((r) => r.blob()),
      ]);
      return renderChart(t, e, width, h);
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Chart image of a custom map (.isomap text). */
export function chartOfIsoMap(key: string, text: string, width: number): Promise<string> {
  const k = `custom:${key}@${width}`;
  let p = cache.get(k);
  if (!p) {
    p = enqueue(async () => {
      const m = parseIsoMap(text);
      const h = Math.max(1, Math.round((width * m.meta.height) / m.meta.width));
      const t = new Blob([m.terrainPng as BlobPart], { type: 'image/png' });
      const e = new Blob([m.elevPng as BlobPart], { type: 'image/png' });
      return renderChart(t, e, width, h);
    });
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

export interface MapNation {
  x: number;
  y: number;
  name: { fr: string; en: string };
}
const metaCache = new Map<string, Promise<MapNation[]>>();
/** Nations of a shipped map, in file order (the game keeps the first N: core/game/spawn.ts). */
export function nationsOfMap(id: string): Promise<MapNation[]> {
  let p = metaCache.get(id);
  if (!p) {
    p = fetch(`${mapsBase()}${id}.json`)
      .then((r) => r.json() as Promise<{ nations?: MapNation[] }>)
      .then((m) => m.nations ?? []);
    p.catch(() => metaCache.delete(id));
    metaCache.set(id, p);
  }
  return p;
}
