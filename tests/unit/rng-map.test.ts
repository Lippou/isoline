import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Rng, hashString, hash2 } from '../../src/core/rng';
import { Noise2D } from '../../src/core/noise';
import { mapFromDisk, asciiMap, makeGame, run, invariants } from '../helpers';
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
import { T, terrainFromRgb, TERRAIN, IS_LAND } from '../../src/core/map/terrain';
import type { GameMap } from '../../src/core/map/gamemap';
import { SPAWN_RADIUS } from '../../src/core/game/constants';
import { REGIONS } from '../../scripts/maps/catalogue';
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

// ------------------------------------------------------- shipped map catalogue
interface IndexEntry {
  id: string;
  name: { fr: string; en: string };
  desc?: { fr: string; en: string };
  category: string;
  width: number;
  height: number;
  nations: number;
}
const MAPS_DIR = path.resolve(import.meta.dirname, '../../assets/maps');
const INDEX = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, 'index.json'), 'utf8')) as IndexEntry[];
const FANTASY_IDS = ['twin-continents', 'fjords', 'ring'];
const NEW_IDS = [...REGIONS.map((r) => r.id), ...FANTASY_IDS];

/** Tile of (lon, lat) on a regional map (equirectangular frame from the catalogue). */
function regionTile(map: GameMap, lon: number, lat: number): number {
  const [lonMin, lonMax, latMin, latMax] = REGIONS.find((r) => r.id === map.meta.id)!.box;
  const k = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
  const scale = map.width / ((lonMax - lonMin) * k);
  return map.idx(Math.floor((lon - lonMin) * k * scale), Math.floor((latMax - lat) * scale));
}

/** Nearest tile (spiral search) matching `ok`. */
function nearest(map: GameMap, tile: number, ok: (i: number) => boolean): number {
  const x0 = tile % map.width;
  const y0 = Math.floor(tile / map.width);
  for (let r = 0; r < 60; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !map.inBounds(x0 + dx, y0 + dy)) continue;
        const i = map.idx(x0 + dx, y0 + dy);
        if (ok(i)) return i;
      }
  throw new Error(`no matching tile near ${x0},${y0}`);
}
const sea = (map: GameMap, lon: number, lat: number) =>
  map.component[nearest(map, regionTile(map, lon, lat), (i) => map.isWater(i) && map.coastDist[i]! > 2)];

describe('shipped map catalogue', () => {
  it('index.json lists every map once, localised, with all four asset files', () => {
    expect(INDEX.length).toBeGreaterThanOrEqual(25);
    expect(new Set(INDEX.map((e) => e.id)).size).toBe(INDEX.length);
    for (const id of NEW_IDS) expect(INDEX.some((e) => e.id === id)).toBe(true);
    for (const e of INDEX) {
      expect(e.name.fr.length * e.name.en.length).toBeGreaterThan(0);
      expect((e.desc?.fr.length ?? 0) * (e.desc?.en.length ?? 0)).toBeGreaterThan(0);
      for (const ext of ['png', 'elev.png', 'json', 'thumb.png'])
        expect(fs.existsSync(path.join(MAPS_DIR, `${e.id}.${ext}`)), `${e.id}.${ext}`).toBe(true);
    }
  });

  it('every map in index.json loads with enough land and its nations on passable land', () => {
    for (const e of INDEX) {
      const map = mapFromDisk(e.id);
      expect([map.width, map.height]).toEqual([e.width, e.height]);
      expect(map.landCount, e.id).toBeGreaterThan(150_000);
      expect(map.meta.nations.length).toBe(e.nations);
      expect(e.nations, e.id).toBeGreaterThanOrEqual(15);
      expect(map.meta.spawnPoints.length).toBeGreaterThan(50);
      expect(map.meta.deposits.length).toBeGreaterThan(5);
      for (const n of map.meta.nations) {
        expect(map.inBounds(n.x, n.y)).toBe(true);
        expect(IS_LAND[map.terrain[map.idx(n.x, n.y)]!], `${e.id}: ${n.name.en}`).toBe(1);
      }
    }
  });

  it('new maps: 1–2.5 M tiles, nations on real landmasses and spaced beyond the spawn disc', () => {
    for (const id of NEW_IDS) {
      const map = mapFromDisk(id);
      expect(map.size, id).toBeGreaterThan(1_000_000);
      expect(map.size, id).toBeLessThanOrEqual(2_500_000);
      const ns = map.meta.nations;
      for (const [k, a] of ns.entries()) {
        const t = map.idx(a.x, a.y);
        expect(map.terrain[t], `${id}: ${a.name.en}`).not.toBe(T.Mountain);
        expect(map.componentSize[map.component[t]!], `${id}: ${a.name.en}`).toBeGreaterThanOrEqual(300);
        for (const b of ns.slice(k + 1))
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * SPAWN_RADIUS);
      }
      // Real-world regions carry real countries (flags / national colours by ISO code).
      if (REGIONS.some((r) => r.id === id))
        expect(ns.filter((n) => n.iso).length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('regional seas stay connected through their straits', () => {
    const me = mapFromDisk('middle-east');
    const med = sea(me, 31, 33.5);
    expect(sea(me, 38, 21)).toBe(med); // Red Sea (Suez)
    expect(sea(me, 50, 13)).toBe(med); // Gulf of Aden (Bab-el-Mandeb)
    expect(sea(me, 51, 27)).toBe(med); // Persian Gulf (Hormuz)
    expect(sea(me, 34, 42.3)).toBe(med); // Black Sea (Bosporus)
    expect(sea(me, 51, 40)).not.toBe(med); // the Caspian is landlocked
    const sc = mapFromDisk('scandinavia');
    expect(sea(sc, 19, 56)).toBe(sea(sc, 5, 57)); // Baltic ↔ North Sea (Øresund)
    expect(sea(sc, 20.5, 63)).toBe(sea(sc, 19, 56)); // Gulf of Bothnia
    const sea2 = mapFromDisk('southeast-asia');
    expect(sea(sea2, 113, 12)).toBe(sea(sea2, 96, 8)); // South China Sea ↔ Andaman Sea (Malacca)
    const ca = mapFromDisk('caribbean');
    expect(sea(ca, -75, 15)).toBe(sea(ca, -86, 8)); // Caribbean ↔ Pacific (Panama)
    expect(sea(ca, -90, 25)).toBe(sea(ca, -75, 15)); // Gulf of Mexico
    const ea = mapFromDisk('east-asia');
    expect(sea(ea, 135, 40)).toBe(sea(ea, 123, 35)); // Sea of Japan ↔ Yellow Sea (Korea Strait)
  });

  it('fantasy layouts: one isthmus between the twins, a ring around an open inner sea', () => {
    const twins = mapFromDisk('twin-continents');
    const land = (x: number, y: number) =>
      twins.component[
        nearest(twins, twins.idx(Math.round(x * twins.width), Math.round(y * twins.height)), (i) =>
          twins.isLand(i),
        )
      ];
    expect(land(0.25, 0.48)).toBe(land(0.76, 0.53));
    const ring = mapFromDisk('ring');
    const water = (x: number, y: number) =>
      ring.component[
        nearest(ring, ring.idx(Math.round(x * ring.width), Math.round(y * ring.height)), (i) =>
          ring.isWater(i),
        )
      ];
    expect(water(0.5, 0.33)).toBe(water(0.03, 0.03));
    expect(mapFromDisk('fjords').meta.nations.length).toBe(30);
  });

  it('games start, spawn every nation and expand on the new maps', () => {
    for (const id of NEW_IDS) {
      const nations = Math.min(30, mapFromDisk(id).meta.nations.length);
      const g = makeGame(id, { nations, tribes: 20, players: [] });
      run(g, 600);
      expect(g.phase, id).toBe('playing');
      const alive = [...g.alivePlayers()].filter((p) => p.kind === 'nation');
      expect(alive.length, id).toBe(nations);
      const start = Math.PI * SPAWN_RADIUS * SPAWN_RADIUS;
      expect(
        alive.reduce((a, p) => a + p.tiles, 0),
        id,
      ).toBeGreaterThan(nations * start * 2);
      expect(invariants(g), id).toEqual([]);
    }
  });
});
