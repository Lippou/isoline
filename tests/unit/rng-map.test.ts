import { describe, expect, it } from 'vitest';
import { Rng, hashString, hash2 } from '../../src/core/rng';
import { Noise2D } from '../../src/core/noise';
import { mapFromDisk, asciiMap } from '../helpers';
import {
  generateMap,
  generateMapData,
  generateLabyrinth,
  defaultGenParams,
} from '../../src/core/map/generator';
import {
  exportIsoMap,
  parseIsoMap,
  loadMap,
  toBase64,
  fromBase64,
  decodeTerrainPng,
  encodeTerrainPng,
} from '../../src/core/map/format';
import { T, terrainFromRgb, TERRAIN } from '../../src/core/map/terrain';
import { pathLength } from '../../src/core/map/nav';
import { inventName, inventTribeName } from '../../src/core/names';

describe('Rng (xoshiro128**)', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 20 }, () => a.nextU32());
    const sb = Array.from({ length: 20 }, () => b.nextU32());
    const sc = Array.from({ length: 20 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('respects ranges and restores state', () => {
    const r = new Rng(1);
    for (let k = 0; k < 2000; k++) {
      const v = r.int(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(7);
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    const s = r.getState();
    const x = r.nextU32();
    r.setState(s);
    expect(r.nextU32()).toBe(x);
    expect(r.weighted([0, 0, 5])).toBe(2);
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
    expect(typeof r.chance(0.5)).toBe('boolean');
    expect(r.range(2, 3)).toBeGreaterThanOrEqual(2);
  });

  it('hashes are stable', () => {
    expect(hashString('isoline')).toBe(hashString('isoline'));
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
  });

  it('noise is deterministic and bounded', () => {
    const n = new Noise2D(7);
    const m = new Noise2D(7);
    for (let k = 0; k < 100; k++) {
      const v = n.fbm(k * 0.37, k * 0.11);
      expect(v).toBe(m.fbm(k * 0.37, k * 0.11));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.5);
      const r = n.ridged(k * 0.2, k * 0.3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('maps', () => {
  it('loads the shipped world map with ≥ 2 M tiles and derived topology', () => {
    const map = mapFromDisk('world');
    expect(map.size).toBeGreaterThanOrEqual(2_000_000);
    expect(map.landCount).toBeGreaterThan(400_000);
    expect(map.meta.nations.length).toBeGreaterThanOrEqual(80);
    // Straits/canals are carved: Black Sea ↔ Mediterranean ↔ Red Sea ↔ Indian Ocean, Caribbean ↔ Pacific.
    const my = (lat: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((lat * Math.PI) / 180)));
    const scale = map.width / (2 * Math.PI);
    const tile = (lon: number, lat: number) =>
      map.idx(Math.floor(((lon + 180) * Math.PI * scale) / 180), Math.floor((my(82) - my(lat)) * scale));
    const body = (lon: number, lat: number) => map.component[tile(lon, lat)];
    const med = body(18, 35);
    expect(map.isWater(tile(18, 35))).toBe(true);
    expect(body(34, 43)).toBe(med); // Black Sea
    expect(body(38, 21)).toBe(med); // Red Sea
    expect(body(65, -10)).toBe(med); // Indian Ocean
    expect(body(-75, 15)).toBe(body(-100, 5)); // Caribbean ↔ Pacific (Panama)
  });

  it('finds naval paths across oceans and through canals', () => {
    const map = mapFromDisk('world');
    // Find two open-water tiles: North Atlantic and Indian Ocean.
    const findWater = (lon: number, latY: number) => {
      const x = Math.round(((lon + 180) / 360) * map.width);
      for (let r = 0; r < 40; r++) {
        for (let dx = -r; dx <= r; dx++) {
          const i = map.idx(x + dx, latY);
          if (map.isWater(i) && map.coastDist[i]! > 3) return i;
        }
      }
      return -1;
    };
    const atlantic = findWater(-35, Math.round(map.height * 0.3));
    const indian = findWater(75, Math.round(map.height * 0.6));
    expect(atlantic).toBeGreaterThan(0);
    expect(indian).toBeGreaterThan(0);
    const path = map.nav.findPath(atlantic, indian);
    expect(path).not.toBeNull();
    expect(pathLength(path!, map.width)).toBeGreaterThan(300);
    for (let k = 1; k < path!.length; k++) expect(map.isWater(path![k]!)).toBe(true);
  });

  it('every shipped map loads and has spawn points and deposits', () => {
    for (const id of ['europe', 'africa', 'black-sea', 'pangaea', 'archipelago', 'two-lakes', 'labyrinth']) {
      const map = mapFromDisk(id);
      expect(map.meta.spawnPoints.length).toBeGreaterThan(50);
      expect(map.meta.deposits.length).toBeGreaterThan(5);
      expect(map.landCount).toBeGreaterThan(10_000);
    }
  });

  it('procedural generator is deterministic and respects the land ratio', () => {
    const p = { ...defaultGenParams(99), width: 300, height: 200, landRatio: 0.4 };
    const a = generateMapData(p);
    const b = generateMapData(p);
    expect(a.terrain).toEqual(b.terrain);
    const map = generateMap(p);
    const ratio = map.landCount / map.size;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.55);
    const lake = generateMapData({ ...p, shape: 'twoLakes' });
    expect(lake.terrain.some((t) => t === T.Lake)).toBe(true);
  });

  it('labyrinth has walls and canals', () => {
    const lab = generateLabyrinth(1, 6, 4, 30);
    expect(lab.terrain.some((t) => t === T.Impassable)).toBe(true);
    expect(lab.terrain.some((t) => t === T.Shallow)).toBe(true);
  });

  it('.isomap round-trips and PNG codecs are exact', () => {
    const map = asciiMap(['~~~~~', '~..h~', '~.M.~', '~~~~~'], 3);
    const text = exportIsoMap(map);
    const parsed = parseIsoMap(text);
    const back = loadMap(parsed.meta, parsed.terrainPng, parsed.elevPng);
    expect(back.terrain).toEqual(map.terrain);
    expect(back.elevation).toEqual(map.elevation);
    const png = encodeTerrainPng(map.terrain, map.width, map.height);
    expect(decodeTerrainPng(png, map.width, map.height)).toEqual(map.terrain);
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 7]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(() => parseIsoMap('{"format":"nope"}')).toThrow();
  });

  it('maps arbitrary colours to the nearest terrain', () => {
    for (let k = 0; k < TERRAIN.length; k++) {
      const [r, g, b] = TERRAIN[k]!.rgb;
      expect(terrainFromRgb(r, g, b)).toBe(k);
    }
    expect(terrainFromRgb(240, 215, 140)).toBe(T.Desert);
  });

  it('names are pronounceable and localised', () => {
    const r = new Rng(3);
    const n = inventName(r);
    expect(n.length).toBeGreaterThan(2);
    const t = inventTribeName(r);
    expect(t.fr).toMatch(/^(Clan|Tribu|Horde|Peuple|Confrérie)/);
    expect(t.en.length).toBeGreaterThan(3);
  });
});
