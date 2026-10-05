// 1.15 map feedback: no more specks of land to ship troops to (an island floor, as OpenFront's
// map generator), and big maps full of nations, a game with fewer picking them across the map.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGame, mapFromDisk } from '../helpers';
import {
  landComponents,
  minIslandTiles,
  removeSmallIslands,
  removeSmallIslandsTerrain,
} from '../../src/core/map/islands';
import { defaultNationCount, pickNations } from '../../src/core/map/nationPick';
import { generateMapData } from '../../src/core/map/generator';
import { HABITABLE, IS_WATER, T } from '../../src/core/map/terrain';
import type { MapMeta, NationSpawn } from '../../src/core/map/gamemap';

const MAPS_DIR = path.resolve(import.meta.dirname, '../../assets/maps');
const meta = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${id}.json`), 'utf8')) as MapMeta;

/** A 60 × 40 mask: a 20 × 20 continent with a 4 × 4 lake holding a 1-tile islet, plus islets at sea. */
function scene() {
  const w = 60;
  const h = 40;
  const land = new Uint8Array(w * h);
  const lake = new Uint8Array(w * h);
  const set = (x0: number, y0: number, x1: number, y1: number, m: Uint8Array, v = 1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = v;
  };
  set(5, 5, 25, 25, land);
  set(12, 12, 16, 16, land, 0);
  set(12, 12, 16, 16, lake);
  land[13 * w + 13] = 1; // islet in the lake
  lake[13 * w + 13] = 0;
  set(40, 5, 42, 7, land); // 4-tile speck
  set(40, 20, 49, 25, land); // 45-tile island
  land[35 * w + 45] = 1; // 1-tile rock a nation stands on
  return { w, h, land, lake };
}

describe('small islands (OpenFront minIslandSize, scaled)', () => {
  it('floor: 40 tiles on an ordinary map, scaled with the fourth root of the area', () => {
    expect(minIslandTiles(1200, 800)).toBe(40);
    expect(minIslandTiles(1500, 1000)).toBe(40);
    expect(minIslandTiles(2000, 1007)).toBe(43);
    expect(minIslandTiles(3200, 1612)).toBe(54);
  });

  it('removes the specks, keeps islands at the floor, never touches lakes', () => {
    const { w, h, land, lake } = scene();
    const lakeBefore = lake.reduce((a, v) => a + v, 0);
    const r = removeSmallIslands(land, w, h, 40, { lake });
    expect(r.removed).toBe(3); // the lake islet, the 4-tile speck, the unclaimed rock
    expect(r.removedTiles).toBe(1 + 4 + 1);
    expect(land[5 * w + 40]).toBe(0);
    expect(land[35 * w + 45]).toBe(0);
    expect(land[20 * w + 40]).toBe(1); // 45 tiles ≥ 40: kept
    // The lake is still a lake, and its islet became lake (not sea).
    expect(lake[13 * w + 13]).toBe(1);
    expect(lake.reduce((a, v) => a + v, 0)).toBe(lakeBefore + 1);
    for (let i = 0; i < w * h; i++) if (lake[i]) expect(land[i]).toBe(0);
    // The continent is whole.
    expect(land[5 * w + 5]).toBe(1);
    expect(land[24 * w + 24]).toBe(1);
  });

  it("a nation's island is kept and grown to the floor, apart from other land", () => {
    const { w, h, land, lake } = scene();
    const rock = 35 * w + 45;
    const r = removeSmallIslands(land, w, h, 40, { lake, keep: [rock] });
    expect(r.kept).toBe(1);
    const c = landComponents(land, w, h);
    expect(c.sizes[c.id[rock]!]).toBeGreaterThanOrEqual(40);
    // Grown round its tile, and not merged with the 45-tile island above it.
    expect(c.id[rock]).not.toBe(c.id[20 * w + 40]);
    expect(c.sizes[c.id[20 * w + 40]!]).toBe(45);
  });

  it('on finished terrain: a speck takes the water around it, lakes and walls stay', () => {
    const { w, h, land, lake } = scene();
    const terrain = new Uint8Array(w * h);
    const elevation = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      terrain[i] = land[i] ? T.Plains : lake[i] ? T.Lake : T.DeepOcean;
      if (land[i]) elevation[i] = 80;
    }
    for (let x = 40; x < 49; x++) terrain[22 * w + x] = T.Impassable; // a wall across the island
    const r = removeSmallIslandsTerrain(terrain, elevation, w, h, 40);
    expect(terrain[13 * w + 13]).toBe(T.Lake);
    expect(terrain[5 * w + 40]).toBe(T.DeepOcean);
    expect(elevation[5 * w + 40]).toBe(0);
    for (let i = 0; i < w * h; i++) if (lake[i]) expect(terrain[i]).toBe(T.Lake);
    // The wall splits the island into 18 + 18 tiles: both are pockets now (game landmasses).
    expect(r.removed).toBe(5);
    expect(IS_WATER[terrain[20 * w + 40]!]).toBe(1);
    expect(terrain[22 * w + 41]).toBe(T.Impassable);
    expect(terrain[10 * w + 10]).toBe(T.Plains);
  });

  it('shipped maps: every landmass under the floor carries a nation', () => {
    for (const id of ['caribbean', 'british-isles', 'world', 'oceania', 'pirates']) {
      const map = mapFromDisk(id);
      const floor = minIslandTiles(map.width, map.height);
      const land = new Uint8Array(map.size);
      for (let i = 0; i < map.size; i++) land[i] = IS_WATER[map.terrain[i]!] ? 0 : 1;
      const c = landComponents(land, map.width, map.height);
      const withNation = new Set(map.meta.nations.map((n) => c.id[map.idx(n.x, n.y)]));
      for (let k = 0; k < c.sizes.length; k++)
        if (c.sizes[k]! < floor) expect(withNation.has(k), `${id}: island of ${c.sizes[k]} tiles`).toBe(true);
    }
  });

  it('procedural worlds have no specks either (and stay deterministic)', () => {
    const p = {
      seed: 99,
      width: 600,
      height: 400,
      landRatio: 0.35,
      islands: 0.9,
      mountains: 0.4,
      rivers: 0.3,
      nations: 12,
    };
    const a = generateMapData(p);
    const b = generateMapData(p);
    expect(Buffer.compare(Buffer.from(a.terrain), Buffer.from(b.terrain))).toBe(0);
    const land = new Uint8Array(600 * 400);
    for (let i = 0; i < land.length; i++) land[i] = IS_WATER[a.terrain[i]!] ? 0 : 1;
    const c = landComponents(land, 600, 400);
    expect(Math.min(...c.sizes)).toBeGreaterThanOrEqual(minIslandTiles(600, 400));
  });
});

describe('nations of big maps', () => {
  it('the Giant World lists nearly every country, Greenland and the Maghreb included', () => {
    const m = meta('world-giant');
    expect(m.nations.length).toBeGreaterThanOrEqual(180);
    const names = m.nations.map((n) => n.name.en);
    for (const c of [
      'Greenland',
      'Algeria',
      'Morocco',
      'Western Sahara',
      'Mauritania',
      'Qatar',
      'Kazakhstan',
      'Serbia',
      'Jamaica',
      'Siberia',
    ])
      expect(names, c).toContain(c);
    for (const c of ['Vatican', 'Monaco', 'Siachen Glacier', 'Jersey']) expect(names, c).not.toContain(c);
    const map = mapFromDisk('world-giant');
    for (const n of m.nations) {
      expect(HABITABLE[map.terrain[map.idx(n.x, n.y)]!], n.name.en).toBe(1);
      expect(n.name.fr.length, n.name.en).toBeGreaterThan(1);
      expect(n.room ?? 0, n.name.en).toBeGreaterThan(0);
    }
    expect(m.nations.find((n) => n.iso === 'gl')!.name.fr).toBe('Groenland');
    // A default giant game is full: one nation per ~9 000 land tiles.
    expect(m.defaultNations).toBeGreaterThanOrEqual(150);
    expect(meta('world').defaultNations).toBeGreaterThan(30);
    expect(defaultNationCount(100_000, 24)).toBe(24);
    expect(defaultNationCount(2_000_000, 300)).toBe(222);
    expect(defaultNationCount(607_000, 207)).toBe(43);
  });

  it('the pick is deterministic, keeps the whole list when asked for it, and covers every continent', () => {
    const m = meta('world');
    const a = pickNations(m.nations, 30, 7, m.width, m.height);
    expect(pickNations(m.nations, 30, 7, m.width, m.height)).toEqual(a);
    expect(new Set(a).size).toBe(30);
    expect(pickNations(m.nations, 500, 7, m.width, m.height)).toEqual(m.nations);
    expect(pickNations(m.nations, 0, 7, m.width, m.height)).toEqual([]);
    // Continents as rough longitude / row boxes on the 2000 × 1007 Miller world.
    const lonOf = (n: NationSpawn) => (n.x / m.width) * 360 - 180;
    const boxes: Record<string, (n: NationSpawn) => boolean> = {
      northAmerica: (n) => lonOf(n) < -50 && n.y < 470,
      southAmerica: (n) => lonOf(n) < -30 && n.y >= 470,
      europe: (n) => lonOf(n) > -12 && lonOf(n) < 40 && n.y < 330,
      africa: (n) => lonOf(n) > -20 && lonOf(n) < 52 && n.y >= 380,
      asia: (n) => lonOf(n) > 60 && n.y < 470,
      oceania: (n) => lonOf(n) > 110 && n.y >= 560,
    };
    for (const seed of [1, 2, 3, 12345]) {
      const pick = pickNations(m.nations, 30, seed, m.width, m.height);
      for (const [name, inBox] of Object.entries(boxes))
        expect(pick.filter(inBox).length, `${name}, seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the pick is spread wider than the most populous N', () => {
    const m = meta('world');
    const nearest = (list: NationSpawn[]) =>
      list.reduce(
        (s, a) => s + Math.min(...list.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
        0,
      ) / list.length;
    const pick = pickNations(m.nations, 40, 1, m.width, m.height);
    expect(nearest(pick)).toBeGreaterThan(1.3 * nearest(m.nations.slice(0, 40)));
    // « je vois jamais Algérie, Maroc » : at the default count, the Maghreb is never empty on
    // the World (43 of 207), and the Giant World (172 of 209) always has all of it, and Greenland.
    for (let s = 1; s <= 20; s++) {
      const names = pickNations(m.nations, m.defaultNations!, s, m.width, m.height).map((n) => n.name.en);
      expect(
        ['Algeria', 'Morocco', 'Tunisia', 'Libya'].some((c) => names.includes(c)),
        `seed ${s}`,
      ).toBe(true);
    }
    const g = meta('world-giant');
    for (let s = 1; s <= 10; s++) {
      const names = pickNations(g.nations, g.defaultNations!, s, g.width, g.height).map((n) => n.name.en);
      for (const c of ['Algeria', 'Morocco', 'Western Sahara', 'Mauritania', 'Greenland'])
        expect(names, `${c}, seed ${s}`).toContain(c);
    }
  });

  it('a game places exactly the pick (the lobby shows the same one)', () => {
    const g = makeGame('world', { seed: 4242, nations: 25, tribes: 0 });
    const m = g.map.meta;
    const want = pickNations(m.nations, 25, 4242, m.width, m.height).map((n) => n.name.en);
    const got = g.players.filter((p) => p && p.kind === 'nation').map((p) => p!.name.en);
    expect(got).toEqual(want);
  });
});
