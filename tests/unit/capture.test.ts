// Captured buildings (GAME_DESIGN.md §6.4, 1.12.0): looted (half their levels, rounded down)
// and occupied for a minute — out of service — instead of OpenFront's intact hand-over.
import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith } from '../helpers';
import { B, CAPTURE_OCCUPATION_TICKS, TROOPS_PER_CITY_LEVEL } from '../../src/core/game/constants';
import { buildCost, ownedBuildings, placeBuilding } from '../../src/core/buildings/buildings';
import { inService, type Building } from '../../src/core/buildings/building';
import { completedCityLevels, maxTroops } from '../../src/core/game/economy';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import { defaultConfig, defaultFeatures } from '../../src/core/game/config';
import type { Game } from '../../src/core/game/state';

const FIELD = ['~'.repeat(24), ...Array<string>(8).fill(`~${'.'.repeat(22)}~`), '~'.repeat(24)];

/** Two humans splitting a 144 × 60 field down the middle (x < 72: player 1). */
function duel(): Game {
  const g = testGame(asciiMap(FIELD, 6), 2, { victoryThreshold: 101 });
  startWith(g, [
    [30, 30],
    [110, 30],
  ]);
  for (let y = 0; y < g.map.height; y++)
    for (let x = 0; x < g.map.width; x++) {
      const t = g.map.idx(x, y);
      if (g.map.isLand(t)) g.setOwner(t, x < 72 ? 1 : 2);
    }
  for (const p of g.players) if (p) p.gold = 1e9;
  return g;
}

/** A building of player `pid`, built at once, raised to `level` (paid for like upgrades). */
function raise(g: Game, pid: number, type: B, x: number, y: number, level: number): Building {
  const p = g.players[pid]!;
  const b = placeBuilding(g, p, type, g.map.idx(x, y), true)!;
  b.level = level;
  b.invested = 125_000 * level;
  p.levelsBuilt[type] += level - 1;
  if (type === B.City) p.cityLevels += level - 1;
  return b;
}

const steps = (g: Game, n: number) => {
  for (let k = 0; k < n; k++) g.step([]);
};

describe('captured buildings are looted and occupied', () => {
  it('a city loses half its levels (rounded down) and adds no troops until the occupation ends', () => {
    const g = duel();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    const city = raise(g, 2, B.City, 100, 30, 8);
    expect(p2.cityLevels).toBe(8);
    g.setOwner(city.tile, 1);
    expect(city.owner).toBe(1);
    expect(city.level).toBe(4);
    expect(city.invested).toBe(125_000 * 4);
    expect(city.occupiedLeft).toBe(CAPTURE_OCCUPATION_TICKS);
    expect(inService(city)).toBe(false);
    expect(p1.cityLevels).toBe(4);
    expect(p2.cityLevels).toBe(0);
    // Occupied: nothing for the troop ceiling yet.
    g.step([]);
    expect(completedCityLevels(g, p1)).toBe(0);
    expect(p1.popCap).toBeCloseTo(maxTroops(g, p1, 0));
    steps(g, CAPTURE_OCCUPATION_TICKS);
    expect(city.occupiedLeft).toBe(0);
    expect(inService(city)).toBe(true);
    expect(completedCityLevels(g, p1)).toBe(4);
    expect(maxTroops(g, p1) - maxTroops(g, p1, 0)).toBeCloseTo(4 * TROOPS_PER_CITY_LEVEL);
  });

  it('levels kept: 1 → 1, 2 → 1, 3 → 2, 5 → 3, 10 → 5; an upgrade under way is lost', () => {
    const g = duel();
    const kept = [1, 2, 3, 5, 10].map((lv, k) => {
      const b = raise(g, 2, B.City, 80 + 15 * (k % 4), 12 + 30 * Math.floor(k / 4), lv);
      g.setOwner(b.tile, 1);
      return b.level;
    });
    expect(kept).toEqual([1, 1, 2, 3, 5]);
    const p2 = g.players[2]!;
    const b = raise(g, 2, B.City, 130, 45, 2);
    b.upgradeLeft = 10;
    b.upgradeTotal = 20;
    p2.cityLevels++;
    const before = g.players[1]!.cityLevels;
    g.setOwner(b.tile, 1);
    expect(b.upgradeLeft).toBe(0);
    expect(b.level).toBe(1);
    expect(g.players[1]!.cityLevels - before).toBe(1);
    expect(p2.cityLevels).toBe(0);
  });

  it("prices: captured levels never raise the captor's ladder, the loser's falls", () => {
    const g = duel();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    placeBuilding(g, p1, B.City, g.map.idx(30, 20));
    expect(buildCost(g, p1, B.City)).toBe(250_000);
    const city = raise(g, 2, B.City, 100, 30, 6);
    expect(buildCost(g, p2, B.City)).toBe(1_000_000);
    g.setOwner(city.tile, 1);
    expect(buildCost(g, p1, B.City)).toBe(250_000);
    expect(buildCost(g, p2, B.City)).toBe(125_000);
    // Upgrading the captured city is paid on the captor's own ladder.
    steps(g, CAPTURE_OCCUPATION_TICKS);
    const gold = p1.gold;
    g.step([{ p: 1, c: { t: 'upgrade', id: city.id } }]);
    expect(gold - p1.gold).toBeCloseTo(250_000 - 100);
  });

  it('every building that changes hands is occupied: silos, SAMs, airfields, ports, factories', () => {
    const g = duel();
    const silo = raise(g, 2, B.Silo, 100, 30, 3);
    silo.tubes = [0, 0, 0];
    const fact = raise(g, 2, B.Factory, 120, 15, 1);
    g.setOwner(silo.tile, 1);
    g.setOwner(fact.tile, 1);
    expect(silo.level).toBe(2);
    expect(silo.tubes.length).toBe(2);
    expect(ownedBuildings(g, 1, B.Silo)).toEqual([]);
    expect(ownedBuildings(g, 1, B.Factory)).toEqual([]);
    steps(g, CAPTURE_OCCUPATION_TICKS);
    expect(ownedBuildings(g, 1, B.Silo)).toEqual([silo]);
    expect(ownedBuildings(g, 1, B.Factory)).toEqual([fact]);
  });

  it('a seceding region takes its buildings as they stand; they come home intact', () => {
    const g = duel();
    const city = raise(g, 1, B.City, 40, 30, 4);
    const rebel = g.addPlayer({ fr: 'R', en: 'R' }, 'tribe');
    rebel.rebelOf = 1;
    g.setOwner(city.tile, rebel.id);
    expect(city.owner).toBe(rebel.id);
    expect(city.level).toBe(4);
    expect(city.occupiedLeft).toBe(0);
    g.setOwner(city.tile, 1);
    expect(city.level).toBe(4);
    expect(city.occupiedLeft).toBe(0);
    expect(g.players[1]!.cityLevels).toBe(4);
  });

  it('journal: the captor reads what it took, the loot and the occupation; the loser what it lost', () => {
    const g = duel();
    const city = raise(g, 2, B.City, 100, 30, 3);
    g.events.length = 0;
    g.setOwner(city.tile, 1);
    const notes = g.events.flatMap((e) => (e.k === 'notify' ? [[e.to, e.key, e.params] as const] : []));
    expect(notes).toEqual([
      [2, 'notify.buildingLost', { by: 1, building: 'city' }],
      [1, 'notify.buildingLooted', { player: 2, building: 'city', from: 3, level: 2, s: 60 }],
    ]);
  });

  it('determinism: a snapshot taken during an occupation restores it exactly', () => {
    const g = duel();
    const city = raise(g, 2, B.City, 100, 30, 4);
    g.setOwner(city.tile, 1);
    steps(g, 100);
    const r = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(hashGame(r)).toBe(hashGame(g));
    expect(r.buildings.get(city.id)!.occupiedLeft).toBe(CAPTURE_OCCUPATION_TICKS - 100);
    steps(g, CAPTURE_OCCUPATION_TICKS);
    steps(r, CAPTURE_OCCUPATION_TICKS);
    expect(hashGame(r)).toBe(hashGame(g));
    expect(r.buildings.get(city.id)!.occupiedLeft).toBe(0);
    // A save from before 1.12.0 has no occupation fields: none is under way.
    const old = takeSnapshot(g);
    for (const b of old.buildings as Record<string, unknown>[]) {
      delete b.occupiedLeft;
      delete b.occupiedTotal;
    }
    const o = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(old)));
    expect([...o.buildings.values()].every((b) => b.occupiedLeft === 0 && inService(b))).toBe(true);
  });
});

describe('loyalty is off by default (1.12.0)', () => {
  it('a new game has no loyalty nor secessions; the lobby can still switch them on', () => {
    expect(defaultFeatures().loyalty).toBe(false);
    expect(defaultConfig(1).features.loyalty).toBe(false);
    // The other features stay on.
    expect(defaultFeatures().events).toBe(true);
  });
});
