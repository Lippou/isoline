import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, invariants, startWith, testGame } from '../helpers';
import { B, RIVER_SAIL_SPEED } from '../../src/core/game/constants';
import { T } from '../../src/core/map/terrain';
import { connectRivers, navigableRivers } from '../../src/core/map/rivers';
import { checkPlacement, placeBuilding } from '../../src/core/buildings/buildings';
import { planBoat } from '../../src/core/units/ships';
import { U } from '../../src/core/units/unit';
import { hashGame } from '../../src/core/net/hash';
import type { Game } from '../../src/core/game/state';

// A sea in the north; a river runs south from the coast (x 10), east along y 14, then south
// again (x 30) deep inland. A second river (x 40) never reaches the water.
const W = 48;
const H = 32;
function riverRows(): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < H; y++) rows.push(Array.from({ length: W }, () => (y < 4 ? '~' : '.')));
  for (let y = 4; y <= 14; y++) rows[y]![10] = 'r';
  for (let x = 10; x <= 30; x++) rows[14]![x] = 'r';
  for (let y = 14; y <= 28; y++) rows[y]![30] = 'r';
  for (let y = 20; y <= 28; y++) rows[y]![40] = 'r';
  return rows.map((r) => r.join(''));
}

/** P1 holds the west (with the river mouth), P2 the east and the river's upper course. */
function riverGame(): Game {
  const g = testGame(asciiMap(riverRows()), 2);
  startWith(g, [
    [3, 20],
    [44, 10],
  ]);
  for (let y = 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = g.map.idx(x, y);
      const want = x <= 20 ? 1 : 2;
      if (g.owner[t] !== want) g.setOwner(t, want);
    }
  for (const p of g.players) if (p) p.immuneUntil = -1;
  return g;
}

describe('navigable rivers', () => {
  it('rivers flowing into the sea share its naval body; landlocked ones do not', () => {
    const map = asciiMap(riverRows());
    const sea = map.idx(5, 1);
    const inland = map.idx(30, 28);
    expect(map.isLand(inland)).toBe(true); // still land: owned, conquered, built on
    expect(map.isNavigable(inland)).toBe(true);
    expect(map.navBody[inland]).toBe(map.navBody[sea]);
    expect(map.navWater(inland)).toBe(4 * W);
    expect(map.isNavigable(map.idx(40, 24))).toBe(false);
    expect(map.isCoastalLand(map.idx(31, 28))).toBe(true); // a river bank
    expect(map.isCoastalLand(map.idx(41, 24))).toBe(false); // the landlocked river's bank
  });

  it('naval paths sail up the river tile by tile, never over land', () => {
    const map = asciiMap(riverRows());
    const path = map.nav.findPath(map.idx(40, 1), map.idx(30, 28));
    expect(path).not.toBeNull();
    for (let k = 1; k < path!.length; k++) expect(map.nav.lineOfWater(path![k - 1]!, path![k]!)).toBe(true);
    // It went through the bend at (10, 14) and (30, 14).
    expect(path!.some((t) => map.x(t) === 10 && map.y(t) >= 12)).toBe(true);
    expect(path!.some((t) => map.x(t) === 30 && map.y(t) <= 16)).toBe(true);
  });

  it('a transport sails up the river and lands deep inland', () => {
    const g = riverGame();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.troops = 200_000;
    p2.troops = 5_000;
    const target = g.map.idx(32, 27);
    const plan = planBoat(g, p1, target);
    expect(plan.error).toBe('ok');
    // The landing is on the river, far from the sea coast (y 4).
    expect(g.map.y(plan.landing)).toBeGreaterThan(20);
    g.step([cmd(1, { t: 'boat', tile: target, ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    expect(boat).toBeDefined();
    let onRiver = false;
    for (let k = 0; k < 600 && g.units.some((u) => u.type === U.Transport); k++) {
      g.step([]);
      const u = g.units.find((v) => v.type === U.Transport);
      if (u && g.map.terrain[g.map.idx(Math.floor(u.x), Math.floor(u.y))] === T.River) onRiver = true;
    }
    expect(onRiver).toBe(true);
    expect(g.units.some((u) => u.type === U.Transport)).toBe(false);
    expect(g.owner[plan.landing]).toBe(1);
    expect(invariants(g)).toEqual([]);
  });

  it('ports stand on banks of rivers reaching the sea, and launch warships there', () => {
    const g = riverGame();
    const p2 = g.players[2]!;
    p2.gold = 50_000_000;
    expect(checkPlacement(g, p2, B.Port, g.map.idx(31, 24))).toBe('ok');
    expect(checkPlacement(g, p2, B.Port, g.map.idx(41, 24))).toBe('notCoastal');
    placeBuilding(g, p2, B.Port, g.map.idx(31, 24), true);
    for (let k = 0; k < 80; k++) g.step([]);
    g.step([cmd(2, { t: 'warship', tile: g.map.idx(30, 20) })]);
    const ship = g.units.find((u) => u.type === U.Warship);
    expect(ship).toBeDefined();
    expect(g.map.terrain[g.map.idx(Math.floor(ship!.x), Math.floor(ship!.y))]).toBe(T.River);
  });

  it('ships go slower on rivers', () => {
    expect(RIVER_SAIL_SPEED).toBeGreaterThan(0);
    expect(RIVER_SAIL_SPEED).toBeLessThan(1);
  });

  it('river landings are deterministic', () => {
    const play = () => {
      const g = riverGame();
      g.players[1]!.troops = 200_000;
      g.players[2]!.troops = 30_000;
      for (let k = 0; k < 300; k++)
        g.step(k === 1 ? [cmd(1, { t: 'boat', tile: g.map.idx(33, 26), ratio: 0.4 })] : []);
      return hashGame(g);
    };
    expect(play()).toBe(play());
  });
});

describe('river repair (map pipeline)', () => {
  it('joins a river stopping short of the coast, and leaves far fragments alone', () => {
    const rows = riverRows().map((r, y) => (y >= 4 && y <= 6 ? r.slice(0, 10) + '.' + r.slice(11) : r));
    const map = asciiMap(rows);
    const terrain = map.terrain.slice();
    expect(navigableRivers(terrain, W, H)[map.idx(30, 28)]).toBe(0); // 3 tiles short
    const carved = connectRivers(terrain, W, H, 4);
    expect(carved).toBeGreaterThan(0);
    const nav = navigableRivers(terrain, W, H);
    expect(nav[map.idx(30, 28)]).toBe(1);
    expect(nav[map.idx(40, 24)]).toBe(0); // 16 tiles from anything: still landlocked
  });
});
