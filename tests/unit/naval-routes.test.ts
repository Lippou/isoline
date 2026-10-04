// Naval routes: no leg across land, no needless tour of an island, transports leaving
// from the shore nearest their landing by sea, warships that never freeze.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, mapFromDisk, startWith, testGame } from '../helpers';
import type { GameMap } from '../../src/core/map/gamemap';
import { WARSHIP_HP } from '../../src/core/game/constants';
import { U, makeUnit } from '../../src/core/units/unit';
import { addUnit, planBoat } from '../../src/core/units/ships';

/** Ticks a ship takes along a route: |dx| + |dy| per leg (sailOnPath). */
function sailTicks(map: GameMap, path: readonly number[]): number {
  let n = 0;
  for (let k = 1; k < path.length; k++)
    n += Math.abs(map.x(path[k]!) - map.x(path[k - 1]!)) + Math.abs(map.y(path[k]!) - map.y(path[k - 1]!));
  return n;
}

function allAtSea(map: GameMap, path: readonly number[]): boolean {
  for (let k = 1; k < path.length; k++) if (!map.nav.lineOfWater(path[k - 1]!, path[k]!)) return false;
  return true;
}

describe('naval routes', () => {
  it('never step through a thin strip of land: the two sides of a cell are two nodes', () => {
    // A one-tile wall runs down from the top edge: its two sides shared one navigation
    // cell, so the search went straight through it and, the way round being out of the
    // local search's reach, the leg crossed the land.
    const rows = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => (x === 13 && y < 30 ? '.' : '~')).join(''),
    );
    const map = asciiMap(rows, 1);
    expect(map.nav.cell).toBe(3); // x = 13 lies inside the cell 12..14
    const path = map.nav.findPath(map.idx(10, 5), map.idx(16, 5))!;
    expect(path).not.toBeNull();
    expect(allAtSea(map, path)).toBe(true);
    expect(sailTicks(map, path)).toBeGreaterThanOrEqual(2 * 25 + 6); // round the end of the wall
  });

  it('take the short way instead of sailing round an island (Oceania)', () => {
    // From the north tip of an island, west past a long thin spit: the spit and the strait
    // beside it shared navigation cells, the search went through, and the local search
    // could only retrace that leg round the island's south — 219 tiles instead of 131.
    const map = mapFromDisk('oceania');
    const path = map.nav.findPath(map.idx(947, 184), map.idx(847, 153))!;
    expect(allAtSea(map, path)).toBe(true);
    expect(sailTicks(map, path)).toBeLessThan(145);
  });

  it('no route on the shipped maps crosses land', () => {
    // Mediterranean: before, one route in five from the Aegean crossed an isthmus.
    const map = mapFromDisk('mediterranean');
    for (const [a, b] of [
      [map.idx(580, 293), map.idx(1193, 314)],
      [map.idx(1210, 421), map.idx(819, 55)],
      [map.idx(1403, 685), map.idx(1364, 473)],
    ] as const) {
      const path = map.nav.findPath(a, b)!;
      expect(path).not.toBeNull();
      expect(allAtSea(map, path)).toBe(true);
    }
  });
});

describe('transports leave from the shore nearest their landing by sea', () => {
  // P1 holds the west coast and a small island in the east sea; P2 a thin peninsula between
  // them. The west coast is nearer the peninsula's east shore as the crow flies (16 tiles,
  // against 21 for the island) but 40 tiles away by sea, round the peninsula's tip.
  const MAP = [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '.....~~~.~~~~~~~~~~~~~~~~~~~~~',
    '.....~~~.~~~~~..~~~~~~~~~~~~~~',
    '.....~~~.~~~~~..~~~~~~~~~~~~~~',
    '.....~~~.~~~~~~~~~~~~~~~~~~~~~',
    '.............~~~~~~~~~~~~~~~~~',
    '.............~~~~~~~~~~~~~~~~~',
  ];
  function game() {
    const g = testGame(asciiMap(MAP, 4), 2);
    startWith(g, [
      [4, 24],
      [36, 28],
    ]);
    for (let i = 0; i < g.map.size; i++) {
      if (!g.map.isLand(i)) continue;
      const x = g.map.x(i);
      g.setOwner(i, x < 20 || x >= 52 ? 1 : 2);
    }
    g.players[1]!.troops = 100_000;
    return g;
  }

  it('the boat leaves from the island, not from across the peninsula', () => {
    const g = game();
    const p1 = g.players[1]!;
    const target = g.map.idx(35, 15); // the peninsula's east shore
    const plan = planBoat(g, p1, target);
    expect(plan.error).toBe('ok');
    expect(g.map.x(plan.from)).toBeGreaterThan(36); // east of the peninsula: the island
    expect(sailTicks(g.map, plan.path!)).toBeLessThanOrEqual(22);
    g.step([cmd(1, { t: 'boat', tile: target, ratio: 0.3 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    expect(boat.sx).toBeGreaterThan(50);
    let ticks = 0;
    while (boat.alive && ticks < 200) {
      g.step([]);
      ticks++;
    }
    expect(ticks).toBeLessThan(30); // straight across the strait, not round the peninsula
    expect(g.owner[plan.landing]).toBe(1);
  });

  it('a boat turned back makes for the coast nearest by sea', () => {
    const g = game();
    const p1 = g.players[1]!;
    // Launched from the west coast at a landing on the peninsula's west shore...
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(32, 15), ratio: 0.3 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    expect(boat.sx).toBeLessThan(24);
    // ...it is found east of the peninsula, and ordered back: the west coast is nearer as
    // the crow flies (17 tiles, against 20), the island by sea (20, against 34).
    boat.x = 36.5;
    boat.y = 16.5;
    boat.path = [g.map.idx(36, 15)];
    boat.pathIdx = 0;
    g.step([cmd(1, { t: 'boatRetreat', id: boat.id })]);
    expect(g.map.x(boat.target)).toBeGreaterThanOrEqual(56); // the island
    expect(sailTicks(g.map, [g.map.idx(36, 16), ...boat.path])).toBeLessThan(25);
    const before = p1.troops;
    for (let k = 0; k < 40 && boat.alive; k++) g.step([]);
    expect(boat.alive).toBe(false);
    expect(p1.troops).toBeGreaterThan(before);
  });
});

describe('warships never freeze', () => {
  it('a warship posted at the dead end of a river patrols up the river', () => {
    // A one-tile lake feeding a river: open water near the patrol point is the lake tile
    // alone, so every waypoint draw missed and the ship stood there for good.
    const rows = [
      '..............................',
      '....orrrrrrrrrrrrrrrrrrrrrr...',
      '..............................',
    ];
    const g = testGame(asciiMap(rows, 1), 1);
    startWith(g, [[2, 0]]);
    const map = g.map;
    expect(map.navBody[map.idx(4, 1)]).toBe(map.navBody[map.idx(20, 1)]);
    const ws = addUnit(g, makeUnit(g.nextId(), U.Warship, 1, 4.5, 1.5));
    ws.hp = ws.maxHp = WARSHIP_HP;
    ws.patrol = map.idx(4, 1);
    let far = 0;
    for (let k = 0; k < 100; k++) {
      g.step([]);
      far = Math.max(far, ws.x - 4.5);
    }
    expect(far).toBeGreaterThan(5);
  });

  it('a warship left inland by an old route finds its sea again', () => {
    // Standing over land more than two tiles from its water (a leg that crossed land),
    // the ship found no water under it: no route, no order obeyed, ever.
    const rows = Array.from({ length: 20 }, (_, y) =>
      Array.from({ length: 30 }, (_, x) => (y >= 5 && y < 15 && x >= 5 && x < 20 ? '.' : '~')).join(''),
    );
    const g = testGame(asciiMap(rows, 1), 1);
    startWith(g, [[12, 12]]);
    const ws = addUnit(g, makeUnit(g.nextId(), U.Warship, 1, 10.5, 10.5));
    ws.hp = ws.maxHp = WARSHIP_HP;
    ws.patrol = g.map.idx(25, 10);
    g.step([cmd(1, { t: 'shipMove', ids: [ws.id], tile: g.map.idx(27, 17), patrol: true })]);
    expect(ws.patrol).toBe(g.map.idx(27, 17)); // the order is taken
    for (let k = 0; k < 60; k++) g.step([]);
    expect(g.map.isNavigable(g.map.idx(Math.floor(ws.x), Math.floor(ws.y)))).toBe(true);
    expect(Math.hypot(ws.x - 10.5, ws.y - 10.5)).toBeGreaterThan(8);
  });
});
