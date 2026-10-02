import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd } from '../helpers';
import { B } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { TradeRoutes, ROUTE_CUT_TICKS } from '../../src/engine/tradeRoutes';
import type { Game } from '../../src/core/game/state';

// Two islands across a strait, each with a port: merchants sail between them.
const ISLANDS = [
  '~~~~~~~~~~~~~~~~~~~~~~~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~......~~~~~~~~~......~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~',
];

function trading(): { g: Game; routes: TradeRoutes; step: (cmds?: Parameters<Game['step']>[0]) => void } {
  const g = testGame(asciiMap(ISLANDS, 6), 2);
  startWith(g, [
    [20, 18],
    [110, 18],
  ]);
  for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i)) g.setOwner(i, g.map.x(i) < 72 ? 1 : 2);
  const [p1, p2] = [g.players[1]!, g.players[2]!];
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
  const routes = new TradeRoutes();
  const step = (cmds: Parameters<Game['step']>[0] = []) => {
    g.step(cmds);
    routes.track(g, g.events);
  };
  return { g, routes, step };
}

describe('trade routes on the map', () => {
  it('a lane follows the merchants between two ports, with the gold it paid', () => {
    const { g, routes, step } = trading();
    let paid = 0;
    for (let k = 0; k < 2000 && paid < 2; k++) {
      step();
      if (g.events.some((e) => e.k === 'tradePay')) paid++;
    }
    expect(paid).toBeGreaterThan(0);
    const v = routes.view(g, 1);
    expect(v.sea.length).toBe(1);
    const lane = v.sea[0]!;
    expect([lane.a, lane.b].sort()).toEqual([1, 2]);
    expect(lane.path.length).toBeGreaterThan(0);
    // Both ends were paid: the lane carries the sum of the two payouts.
    const both = g.players[1]!.stats.tradeGold + g.players[2]!.stats.tradeGold;
    expect(lane.gold).toBeGreaterThan(0);
    expect(lane.gold).toBeLessThanOrEqual(Math.ceil(both) + 2);
    expect(lane.cut).toBe(-1);
    expect(v.tick).toBe(g.tick);
  });

  it('an embargo shows our lane cut for ten seconds, then removes it', () => {
    const { g, routes, step } = trading();
    for (let k = 0; k < 2000 && routes.view(g, 1).sea.length === 0; k++) step();
    expect(routes.view(g, 1).sea.length).toBe(1);
    step([cmd(1, { t: 'embargo', target: 2, on: true })]);
    const cut = routes.view(g, 1).sea[0]!;
    expect(cut.cut).toBe(g.tick);
    // A spectator's map does not flash it: it simply goes away.
    expect(routes.view(g, 0).sea.length).toBe(0);
    expect(routes.view(g, 1).sea[0]?.cut).toBe(cut.cut);
    for (let k = 0; k < ROUTE_CUT_TICKS + 5; k++) step();
    expect(routes.view(g, 1).sea.length).toBe(0);
  });

  it('busy railways report the trips run on them', () => {
    const g = testGame(
      asciiMap(['~~~~~~~~~~', '~........~', '~........~', '~........~', '~~~~~~~~~~'], 14),
      1,
      { victoryThreshold: 101 },
    );
    startWith(g, [[30, 30]]);
    for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i)) g.setOwner(i, 1);
    const p = g.players[1]!;
    p.gold = 50_000_000;
    placeBuilding(g, p, B.City, g.map.idx(30, 30), true);
    placeBuilding(g, p, B.City, g.map.idx(90, 30), true);
    placeBuilding(g, p, B.Factory, g.map.idx(60, 40), true);
    const routes = new TradeRoutes();
    for (let k = 0; k < 1200; k++) {
      g.step([]);
      routes.track(g, g.events);
    }
    const rail = routes.view(g, 1).rail;
    expect(rail.length).toBeGreaterThan(0);
    expect(Math.max(...rail.map((r) => r.trips))).toBeGreaterThan(1);
    const alive = new Set(g.rails.filter((r) => r.alive).map((r) => r.id));
    expect(rail.every((r) => alive.has(r.id) && r.cut === -1)).toBe(true);
  });
});
