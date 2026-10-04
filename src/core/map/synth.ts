// Terrain synthesis shared by the real-world map builder and the procedural
// generator: altitude from region masks + noise, then biomes from a small
// climate model (temperature from latitude/altitude, moisture from distance
// to the sea and latitude bands).
import { Noise2D } from '../noise';
import { Rng } from '../rng';
import type { DepositSpec } from './gamemap';
import { HABITABLE, HARSH, Resource, T } from './terrain';

export interface SynthInput {
  width: number;
  height: number;
  seed: number;
  /** Kilometres per pixel (drives noise frequencies and blur radii). */
  pxKm: number;
  /** 1 = land, 0 = water. */
  land: Uint8Array;
  /** 1 = lake water (subset of water). */
  lake?: Uint8Array;
  /** Signed latitude in degrees for row y (and optionally x). */
  latitude: (x: number, y: number) => number;
  mountains?: Uint8Array;
  plateaus?: Uint8Array;
  hills?: Uint8Array;
  deserts?: Uint8Array;
  tundra?: Uint8Array;
  glaciers?: Uint8Array;
  rivers?: Uint8Array;
  /** Optional extra relief (0..1) added on top (procedural maps). */
  relief?: Float32Array;
  /** Shifts moisture (procedural "dryness"). */
  moistureBias?: number;
  /** Amplitude of the moisture noise (breaks latitude bands). */
  moistureNoise?: number;
}

export interface SynthOutput {
  terrain: Uint8Array;
  elevation: Uint8Array;
}

/** Multi-source BFS distance (in pixels) from tiles where `isSource` holds, over tiles where `walk` holds. */
export function distanceField(
  w: number,
  h: number,
  isSource: (i: number) => boolean,
  walk: (i: number) => boolean,
  cap = 65000,
): Uint16Array {
  const n = w * h;
  const dist = new Uint16Array(n).fill(65535);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if (isSource(i)) {
      dist[i] = 0;
      q[qt++] = i;
    }
  }
  while (qh < qt) {
    const i = q[qh++]!;
    const d = dist[i]! + 1;
    if (d > cap) continue;
    const x = i % w;
    const visit = (j: number) => {
      if (dist[j]! > d && walk(j)) {
        dist[j] = d;
        q[qt++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  }
  return dist;
}

/** Separable box blur of a 0/1 (or 0..255) mask into a 0..1 float field (3 passes ≈ Gaussian). */
export function softMask(mask: Uint8Array | undefined, w: number, h: number, radius: number): Float32Array {
  const out = new Float32Array(w * h);
  if (!mask) return out;
  for (let i = 0; i < mask.length; i++) out[i] = mask[i]! > 0 ? 1 : 0;
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += out[row + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += out[row + Math.min(w - 1, x + r + 1)]! - out[row + Math.max(0, x - r)]!;
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
      }
    }
  }
  return out;
}

const ridge01 = (nz: Noise2D, x: number, y: number) => nz.ridged(x, y, 3);
/**
 * Chamfer (3-4) distance transform: approximately Euclidean distance in pixels
 * from source tiles, restricted to tiles where `walk` holds (two raster passes).
 */
export function chamferDistance(
  w: number,
  h: number,
  isSource: (i: number) => boolean,
  walk: (i: number) => boolean,
): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = isSource(i) ? 0 : INF;
  const relax = (i: number, j: number, c: number) => {
    const v = d[j]! + c;
    if (v < d[i]!) d[i] = v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0 || !walk(i)) continue;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) {
        relax(i, i - w, 3);
        if (x > 0) relax(i, i - w - 1, 4);
        if (x < w - 1) relax(i, i - w + 1, 4);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0 || !walk(i)) continue;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) {
        relax(i, i + w, 3);
        if (x < w - 1) relax(i, i + w + 1, 4);
        if (x > 0) relax(i, i + w - 1, 4);
      }
    }
  }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! / 3;
  return d;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Moisture contribution of latitude bands (ITCZ wet, subtropical highs dry). */
function latitudeMoisture(absLat: number): number {
  const table: [number, number][] = [
    [0, 0.38],
    [8, 0.32],
    [14, 0.08],
    [20, -0.26],
    [28, -0.3],
    [35, -0.06],
    [45, 0.1],
    [58, 0.08],
    [68, -0.04],
    [90, -0.1],
  ];
  for (let k = 1; k < table.length; k++) {
    const [l1, v1] = table[k]!;
    const [l0, v0] = table[k - 1]!;
    if (absLat <= l1) return v0 + ((v1 - v0) * (absLat - l0)) / (l1 - l0);
  }
  return -0.1;
}

export function synthesize(inp: SynthInput): SynthOutput {
  const { width: w, height: h, land, pxKm } = inp;
  const n = w * h;
  const noise = new Noise2D(inp.seed);
  const noise2 = new Noise2D(inp.seed ^ 0x9e3779b9);
  const terrain = new Uint8Array(n);
  const elevation = new Uint8Array(n);

  // Distances in pixels: inland distance from the sea, and offshore distance from land.
  const inland = chamferDistance(
    w,
    h,
    (i) => land[i] === 0 && !(inp.lake && inp.lake[i]),
    (i) => land[i] === 1,
  );
  const offshore = chamferDistance(
    w,
    h,
    (i) => land[i] === 1,
    (i) => land[i] === 0,
  );

  const k = (km: number) => km / pxKm; // km → px
  const mtn = softMask(inp.mountains, w, h, k(55));
  const mtnCore = softMask(inp.mountains, w, h, k(18));
  const plat = softMask(inp.plateaus, w, h, k(60));
  const hil = softMask(inp.hills, w, h, k(40));
  const des = softMask(inp.deserts, w, h, k(35));
  const tun = softMask(inp.tundra, w, h, k(60));
  const glacierInner = inp.glaciers
    ? distanceField(
        w,
        h,
        (i) => !inp.glaciers![i],
        (i) => inp.glaciers![i] === 1,
      )
    : null;

  // Noise frequencies expressed in "cycles per km".
  const fLow = pxKm / 1400;
  const fMid = pxKm / 420;
  const fRidge = pxKm / 260;
  const fDetail = pxKm / 90;

  const elevF = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!land[i]) continue;
      const coastKm = inland[i]! * pxKm;
      const base = 0.05 + 0.13 * Math.pow(clamp01(coastKm / 700), 0.7);
      const low = 0.13 * (noise.fbm(x * fLow, y * fLow, 4) + 0.55);
      const mid = 0.08 * noise.fbm(x * fMid + 50, y * fMid - 30, 4);
      const ridge = noise2.ridged(x * fRidge, y * fRidge, 5);
      const mountainH = mtn[i]! * (0.24 + 0.18 * ridge) + mtnCore[i]! * (0.12 + 0.26 * ridge);
      const plateauH = plat[i]! * (0.26 + 0.06 * noise.get(x * fMid, y * fMid));
      const hillsH = hil[i]! * (0.17 + 0.08 * ridge);
      const extra = inp.relief ? inp.relief[i]! : 0;
      const detail = 0.035 * noise2.fbm(x * fDetail, y * fDetail, 3);
      elevF[i] = clamp01(base + low + mid + mountainH + plateauH + hillsH + extra + detail);
    }
  }

  const shallowPx = Math.max(1.5, k(28));
  const moistBias = inp.moistureBias ?? 0;
  const moistNoise = inp.moistureNoise ?? 0.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!land[i]) {
        if (inp.lake && inp.lake[i]) terrain[i] = T.Lake;
        else terrain[i] = offshore[i]! <= shallowPx ? T.Shallow : T.DeepOcean;
        elevation[i] = 0;
        continue;
      }
      const e = elevF[i]!;
      elevation[i] = Math.max(6, Math.min(255, Math.round(e * 255)));
      const lat = inp.latitude(x, y);
      const absLat = Math.abs(lat);
      const temp = 1 - Math.pow(absLat / 84, 1.35) - e * 0.35 + 0.07 * noise.get(x * fMid + 300, y * fMid);
      const coastKm = inland[i]! * pxKm;
      const moist =
        0.18 +
        0.38 * Math.exp(-coastKm / 650) +
        latitudeMoisture(absLat) +
        moistNoise * noise2.fbm(x * fLow * 1.7 + 90, y * fLow * 1.7, 4) +
        moistBias;

      let t: number;
      if (glacierInner && inp.glaciers![i]) {
        t = glacierInner[i]! * pxKm > 90 ? T.Glacier : T.Tundra; // ice sheet, its rim tundra
      } else if (e >= 0.93 && mtnCore[i]! > 0.75 && ridge01(noise2, x * fRidge, y * fRidge) > 0.72) {
        t = T.Peaks; // jagged high peaks
      } else if (e >= 0.66) {
        t = T.Mountain;
      } else if (temp < 0.13 || (tun[i]! > 0.5 && temp < 0.3)) {
        t = T.Tundra;
      } else if (e >= 0.39) {
        t = des[i]! > 0.5 ? T.Desert : T.Hills;
      } else if (des[i]! > 0.45 || (moist < 0.12 && temp > 0.35)) {
        t = T.Desert;
      } else if (moist > 0.56 + 0.1 * noise.get(x * fDetail, y * fDetail) && temp > 0.14) {
        t = T.Forest;
      } else if (temp < 0.4 && moist > 0.22 + 0.1 * noise.get(x * fMid - 70, y * fMid)) {
        t = T.Forest; // boreal taiga
      } else if (temp < 0.18) {
        t = T.Tundra;
      } else {
        t = T.Plains;
        if (moist > 0.4 && noise.get(x * fDetail * 0.7 - 40, y * fDetail * 0.7) > 0.36) t = T.Forest;
      }
      if (inp.rivers && inp.rivers[i] && !HARSH[t]) t = T.River;
      terrain[i] = t;
    }
  }
  return { terrain, elevation };
}

/** Deterministic deposits of strategic resources, spaced apart, weighted by terrain. */
export function generateDeposits(
  w: number,
  h: number,
  terrain: Uint8Array,
  seed: number,
  density = 1,
): DepositSpec[] {
  const rng = new Rng(seed ^ 0xdeadbeef);
  let landCount = 0;
  for (let i = 0; i < terrain.length; i++) if (HABITABLE[terrain[i]!]) landCount++;
  const target = Math.max(10, Math.min(180, Math.round((landCount / 9000) * density)));
  const minDist = Math.max(12, Math.sqrt(landCount / target) * 0.55);
  const out: DepositSpec[] = [];
  const weights = (t: number): number[] => {
    // [oil, uranium, fertile, rare metals]
    switch (t) {
      case T.Desert:
        return [5, 1, 0, 1];
      case T.Tundra:
        return [3, 1, 0, 1];
      case T.Plains:
        return [1, 0, 4, 0.5];
      case T.River:
        return [0, 0, 6, 0];
      case T.Forest:
        return [0.5, 0, 2, 1.5];
      case T.Hills:
        return [1, 2, 0.5, 3];
      case T.Mountain:
        return [0, 3, 0, 4];
      default:
        return [0, 0, 0, 0];
    }
  };
  let attempts = 0;
  while (out.length < target && attempts < target * 400) {
    attempts++;
    const x = rng.int(3, w - 4);
    const y = rng.int(3, h - 4);
    const t = terrain[y * w + x]!;
    if (!HABITABLE[t]) continue;
    if (out.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 < minDist * minDist)) continue;
    const wts = weights(t);
    if (wts.every((v) => v === 0)) continue;
    out.push({ x, y, type: (rng.weighted(wts) + 1) as Resource });
  }
  return out;
}

/** Spaced candidate spawn points on reasonably large landmasses. */
export function generateSpawnPoints(
  w: number,
  h: number,
  terrain: Uint8Array,
  seed: number,
  count = 300,
): [number, number][] {
  const rng = new Rng(seed ^ 0x51ed270b);
  // Landmass sizes (skip tiny islets).
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (comp[s] !== -1 || !HABITABLE[terrain[s]!]) continue;
    const id = sizes.length;
    let c = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      c++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= w * h || comp[j] !== -1 || !HABITABLE[terrain[j]!]) continue;
        comp[j] = id;
        stack.push(j);
      }
    }
    sizes.push(c);
  }
  let land = 0;
  for (let i = 0; i < w * h; i++) if (HABITABLE[terrain[i]!]) land++;
  const minDist = Math.max(6, Math.sqrt(land / count) * 0.7);
  const out: [number, number][] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 300) {
    attempts++;
    const x = rng.int(2, w - 3);
    const y = rng.int(2, h - 3);
    const i = y * w + x;
    const t = terrain[i]!;
    if (!HABITABLE[t] || t === T.Mountain) continue;
    if ((sizes[comp[i]!] ?? 0) < 250) continue;
    if (out.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < minDist * minDist)) continue;
    out.push([x, y]);
  }
  return out;
}

export { smooth as smoothstep };
