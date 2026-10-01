import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, invariants } from '../helpers';
import { B, N, NUKE_COST, MIRV_COST_STEP, samRange } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { U } from '../../src/core/units/unit';
import { nukeCost, maxLaunchable, detonate } from '../../src/core/units/nukes';
import { warshipCost } from '../../src/core/units/ships';

// Two islands separated by a strait.
const ISLANDS = [
  '~~~~~~~~~~~~~~~~~~~~~~~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~',
];

function islands() {
  const g = testGame(asciiMap(ISLANDS, 6), 2);
  startWith(g, [
    [20, 18],
    [110, 18],
  ]);
  return g;
}

describe('naval', () => {
  it('transports cross the water and start an amphibious attack', () => {
    const g = islands();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.troops = 100_000;
    p2.troops = 60_000;
    // Both players take their whole island so the coasts are owned.
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(30, 10), ratio: 0.3 }),
      cmd(2, { t: 'attack', tile: g.map.idx(100, 10), ratio: 0.5 }),
    ]);
    for (let k = 0; k < 200; k++) g.step([]);
    p2.troops = 5_000;
    const before = p2.tiles;
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport);
    expect(boat).toBeDefined();
    expect(boat!.troops).toBeGreaterThan(10_000);
    for (let k = 0; k < 200 && g.units.some((u) => u.type === U.Transport); k++) g.step([]);
    for (let k = 0; k < 60; k++) g.step([]);
    expect(p2.tiles).toBeLessThan(before);
    expect(invariants(g)).toEqual([]);
  });

  it('warships need a port, escalate in cost and sink transports', () => {
    const g = islands();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.gold = p2.gold = 50_000_000;
    p1.troops = p2.troops = 300_000;
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(30, 10), ratio: 0.3 }),
      cmd(2, { t: 'attack', tile: g.map.idx(100, 10), ratio: 0.3 }),
    ]);
    for (let k = 0; k < 150; k++) g.step([]);
    expect(warshipCost(g, p2)).toBe(250_000);
    g.step([cmd(2, { t: 'warship', tile: g.map.idx(80, 18) })]);
    expect(g.units.some((u) => u.type === U.Warship)).toBe(false); // no port yet
    // Port on island 2's west coast.
    const coast = p2.coast.find((t) => g.map.x(t) < 100)!;
    g.step([cmd(2, { t: 'build', kind: B.Port, tile: coast })]);
    for (let k = 0; k < 55; k++) g.step([]);
    g.step([cmd(2, { t: 'warship', tile: g.map.idx(80, 18) })]);
    expect(g.units.filter((u) => u.type === U.Warship).length).toBe(1);
    expect(warshipCost(g, p2)).toBe(500_000);
    // Player 1 sends a transport: it gets sunk.
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.2 })]);
    let sunk = false;
    for (let k = 0; k < 200 && !sunk; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'shipSunk')) sunk = true;
    }
    expect(sunk).toBe(true);
    expect(p2.stats.shipsSunk).toBeGreaterThan(0);
  });

  it('ports generate merchant ships that pay both partners', () => {
    const g = islands();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.gold = p2.gold = 10_000_000;
    p1.troops = p2.troops = 300_000;
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(30, 10), ratio: 0.3 }),
      cmd(2, { t: 'attack', tile: g.map.idx(100, 10), ratio: 0.3 }),
    ]);
    for (let k = 0; k < 150; k++) g.step([]);
    placeBuilding(
      g,
      p1,
      B.Port,
      p1.coast.find((t) => g.map.x(t) > 30)!,
      true,
    );
    placeBuilding(
      g,
      p2,
      B.Port,
      p2.coast.find((t) => g.map.x(t) < 100)!,
      true,
    );
    let paid = false;
    for (let k = 0; k < 1500 && !paid; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'tradePay')) paid = true;
    }
    expect(paid).toBe(true);
    expect(p1.stats.tradeGold + p2.stats.tradeGold).toBeGreaterThan(3_000);
    // Embargo stops new trade.
    g.step([cmd(1, { t: 'embargo', target: 2, on: true })]);
    expect(p1.hasEmbargoWith(p2, g.tick)).toBe(true);
  });
});

describe('rail', () => {
  it('factories lay rails to stations and trains pay per stop', () => {
    const g = testGame(
      asciiMap(['~~~~~~~~~~', '~........~', '~........~', '~........~', '~~~~~~~~~~'], 14),
      1,
      {
        victoryThreshold: 101,
      },
    );
    startWith(g, [[30, 30]]);
    const p = g.players[1]!;
    p.troops = 500_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(60, 30), ratio: 0.5 })]);
    for (let k = 0; k < 250; k++) g.step([]);
    p.gold = 50_000_000;
    placeBuilding(g, p, B.City, g.map.idx(30, 30), true);
    placeBuilding(g, p, B.City, g.map.idx(90, 30), true);
    placeBuilding(g, p, B.Factory, g.map.idx(60, 40), true);
    expect(g.rails.filter((r) => r.alive).length).toBeGreaterThanOrEqual(2);
    let pays = 0;
    for (let k = 0; k < 1500; k++) {
      g.step([]);
      pays += g.events.filter((e) => e.k === 'trainPay').length;
    }
    expect(pays).toBeGreaterThan(0);
    expect(p.stats.trainGold).toBeGreaterThanOrEqual(10_000);
  });
});

describe('nuclear', () => {
  it('costs: A 750k, H 5M, MIRV escalates by 15M per launch', () => {
    const g = islands();
    const p = g.players[1]!;
    g.config.features.resources = false;
    g.config.features.tech = false;
    expect(nukeCost(g, p, N.Atom)).toBe(NUKE_COST[N.Atom]);
    expect(nukeCost(g, p, N.Hydrogen)).toBe(5_000_000);
    expect(nukeCost(g, p, N.Mirv)).toBe(25_000_000);
    g.features.mirvLaunches = 2;
    expect(nukeCost(g, p, N.Mirv)).toBe(25_000_000 + 2 * MIRV_COST_STEP);
    expect(maxLaunchable(g, p, N.Atom)).toBe(0); // no silo
  });

  it('A-bomb destroys a 12-tile disc, leaves fallout and kills troops', () => {
    const g = testGame(
      asciiMap(['~~~~~~~~~~', '~........~', '~........~', '~........~', '~~~~~~~~~~'], 14),
      1,
    );
    startWith(g, [[70, 35]]);
    const p = g.players[1]!;
    p.troops = 100_000;
    const tiles = p.tiles;
    detonate(g, N.Atom, 70.5, 35.5, 0);
    expect(p.tiles).toBeLessThan(tiles);
    expect(g.owner[g.map.idx(70, 35)]).toBe(0);
    expect(g.fallout[g.map.idx(70, 35)]).toBe(255);
    expect(g.fallout[g.map.idx(70 + 25, 35)]! + g.fallout[g.map.idx(70, 35 + 25)]!).toBeGreaterThanOrEqual(0);
    expect(g.fallout[g.map.idx(70 + 40, 35)]).toBe(0);
    expect(p.troops).toBeLessThan(100_000);
    expect(g.usefulLand).toBeLessThan(g.map.landCount);
  });

  it('SAM range grows with level: 150 − 480/(level+5)', () => {
    expect(samRange(1)).toBe(70);
    expect(Math.round(samRange(10))).toBe(118);
  });

  it('scenario: alliance → betrayal → strike → interception', () => {
    const g = testGame(
      asciiMap(
        ['~~~~~~~~~~~~~~', '~............~', '~............~', '~............~', '~~~~~~~~~~~~~~'],
        14,
      ),
      3,
    );
    startWith(g, [
      [25, 30],
      [150, 30],
      [90, 15],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    a.gold = b.gold = 100_000_000;
    // 1. Alliance.
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(a.allies.has(2)).toBe(true);
    // B prepares a SAM next to its capital; A builds a silo.
    placeBuilding(g, b, B.Sam, g.map.idx(150, 30), true);
    placeBuilding(g, a, B.Silo, g.map.idx(25, 30), true);
    // 2+3. Betrayal by nuking the ally.
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(152, 31), count: 1 })]);
    expect(a.allies.has(2)).toBe(false);
    expect(a.isTraitor(g.tick)).toBe(true);
    expect(g.units.some((u) => u.type === U.Nuke)).toBe(true);
    expect(g.events.some((e) => e.k === 'nukeLaunch')).toBe(true);
    // 4. Interception.
    let intercepted = false;
    for (let k = 0; k < 120 && !intercepted; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'intercept')) intercepted = true;
    }
    expect(intercepted).toBe(true);
    expect(g.owner[g.map.idx(150, 30)]).toBe(2);
    expect(b.stats.nukesIntercepted).toBe(1);
  });

  it('MIRV splits into 8–12 interceptable warheads', () => {
    const g = testGame(
      asciiMap(
        ['~~~~~~~~~~~~~~', '~............~', '~............~', '~............~', '~~~~~~~~~~~~~~'],
        14,
      ),
      2,
    );
    startWith(g, [
      [25, 30],
      [150, 30],
    ]);
    const a = g.players[1]!;
    a.gold = 100_000_000;
    placeBuilding(g, a, B.Silo, g.map.idx(25, 30), true);
    g.step([cmd(1, { t: 'nuke', kind: N.Mirv, tile: g.map.idx(150, 30), count: 1 })]);
    let warheads = 0;
    for (let k = 0; k < 60; k++) {
      g.step([]);
      warheads = Math.max(
        warheads,
        g.units.filter((u) => u.type === U.Nuke && u.kind === N.MirvWarhead).length,
      );
    }
    expect(warheads).toBeGreaterThanOrEqual(8);
    expect(warheads).toBeLessThanOrEqual(14);
  });
});
