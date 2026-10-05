// Map file formats.
//  - Built-in maps: `<id>.png` (RGB, colour = terrain), `<id>.elev.png` (8-bit grey
//    altitude) and `<id>.json` (MapMeta). Shipped in Resources/maps.
//  - Shared/custom maps: a single `.isomap` JSON document embedding both PNGs in base64.
import { decode, encode } from 'fast-png';
import { GameMap, type MapMeta } from './gamemap';
import { TERRAIN, TERRAIN_COUNT, terrainFromRgb } from './terrain';

export const ISOMAP_VERSION = 1;

const colorKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const EXACT = new Map<number, number>(TERRAIN.map((t, i) => [colorKey(t.rgb[0], t.rgb[1], t.rgb[2]), i]));

export function decodeTerrainPng(png: Uint8Array, width: number, height: number): Uint8Array {
  const img = decode(png);
  if (img.width !== width || img.height !== height) throw new Error('terrain png size mismatch');
  const ch = img.channels;
  const data = img.data;
  const out = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  for (let i = 0, p = 0; i < out.length; i++, p += ch) {
    const r = data[p]!;
    const g = ch >= 3 ? data[p + 1]! : r;
    const b = ch >= 3 ? data[p + 2]! : r;
    const k = colorKey(r, g, b);
    let t = EXACT.get(k);
    if (t === undefined) {
      t = cache.get(k);
      if (t === undefined) {
        t = terrainFromRgb(r, g, b);
        cache.set(k, t);
      }
    }
    out[i] = t;
  }
  return out;
}

export function decodeGreyPng(png: Uint8Array, width: number, height: number): Uint8Array {
  const img = decode(png);
  if (img.width !== width || img.height !== height) throw new Error('grey png size mismatch');
  const ch = img.channels;
  if (ch === 1 && img.depth === 8) return new Uint8Array(img.data as Uint8Array);
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += ch) out[i] = img.data[p]! & 255;
  return out;
}

export function encodeTerrainPng(terrain: Uint8Array, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < terrain.length; i++) {
    const t = terrain[i]! < TERRAIN_COUNT ? terrain[i]! : 0;
    const c = TERRAIN[t]!.rgb;
    data[i * 3] = c[0];
    data[i * 3 + 1] = c[1];
    data[i * 3 + 2] = c[2];
  }
  return encode({ width, height, data, channels: 3, depth: 8 });
}

export function encodeGreyPng(values: Uint8Array, width: number, height: number): Uint8Array {
  return encode({ width, height, data: values, channels: 1, depth: 8 });
}

export function loadMap(meta: MapMeta, terrainPng: Uint8Array, elevPng: Uint8Array): GameMap {
  const terrain = decodeTerrainPng(terrainPng, meta.width, meta.height);
  const elevation = decodeGreyPng(elevPng, meta.width, meta.height);
  return new GameMap(meta, terrain, elevation);
}

// ---- base64 helpers usable in Node, browsers and workers -------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64[c & 63]! : '=';
    if (out.length > 8192) {
      parts.push(out);
      out = '';
    }
  }
  parts.push(out);
  return parts.join('');
}

export function fromBase64(str: string): Uint8Array {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)]!;
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)]!;
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0;
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0;
    if (o < len) out[o++] = (a << 2) | (b >> 4);
    if (o < len && i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (o < len && i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export interface IsoMapFile {
  format: 'isoline-map';
  version: number;
  meta: MapMeta;
  terrain: string; // base64 PNG
  elevation: string; // base64 PNG
}

export function exportIsoMap(map: GameMap): string {
  return exportIsoMapData(map.meta, map.terrain, map.elevation);
}

/** The .isomap text of raw map data (the editor: no topology to build just to save). */
export function exportIsoMapData(meta: MapMeta, terrain: Uint8Array, elevation: Uint8Array): string {
  const file: IsoMapFile = {
    format: 'isoline-map',
    version: ISOMAP_VERSION,
    meta,
    terrain: toBase64(encodeTerrainPng(terrain, meta.width, meta.height)),
    elevation: toBase64(encodeGreyPng(elevation, meta.width, meta.height)),
  };
  return JSON.stringify(file);
}

export function parseIsoMap(json: string): { meta: MapMeta; terrainPng: Uint8Array; elevPng: Uint8Array } {
  const file = JSON.parse(json) as Partial<IsoMapFile>;
  if (file.format !== 'isoline-map' || !file.meta || !file.terrain || !file.elevation) {
    throw new Error('not an Isoline map file');
  }
  const meta = migrateMeta(file.meta, file.version ?? 1);
  return { meta, terrainPng: fromBase64(file.terrain), elevPng: fromBase64(file.elevation) };
}

/** Versioned migrations of map metadata. */
export function migrateMeta(meta: MapMeta, _version: number): MapMeta {
  return {
    ...meta,
    nations: meta.nations ?? [],
    spawnPoints: meta.spawnPoints ?? [],
    deposits: meta.deposits ?? [],
    version: ISOMAP_VERSION,
  };
}
