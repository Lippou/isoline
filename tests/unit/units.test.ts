import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, invariants, mapFromDisk } from '../helpers';
import {
  B,
  N,
  NUKE_COST,
  NUKE_FALLOUT_RADIUS,
  NUKE_SPEED,
  MERCHANT_HP,
  MIRV_COST_STEP,
  MAX_TRANSPORTS,
  MIRV_MIN_SPREAD,
  NUKE_TARGETABLE_RANGE,
  RETREAT_MALUS,
  SAM_COOLDOWN,
  TRANSPORT_HP,
  TRANSPORT_SPEED,
  WARSHIP_DOCK_RANGE,
  WARSHIP_HP,
  WARSHIP_MANUAL_LOCK_TICKS,
  WARSHIP_PATROL_RANGE,
  WARSHIP_RANGE,
  samRange,
} from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { U, makeUnit, sailOnPath, type Unit } from '../../src/core/units/unit';
import { nukeCost, maxLaunchable, detonate, hostileSams } from '../../src/core/units/nukes';
import { ARC_DOWN, ARC_UP, Trajectory, predictInterception } from '../../src/core/units/trajectory';
import { TRANSPORT_RETREATING, WS, addUnit, warshipCost } from '../../src/core/units/ships';
import type { Game } from '../../src/core/game/state';

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

// A wide sea: players 1 (west), 2 (east) and 3 (south) each hold a small island.
const SEA = Array.from({ length: 12 }, (_, y) =>
  Array.from({ length: 50 }, (_, x) =>
    (y >= 1 && y <= 2 && ((x >= 1 && x <= 3) || (x >= 46 && x <= 48))) ||
    (y >= 9 && y <= 10 && x >= 24 && x <= 26)
      ? '.'
      : '~',
  ).join(''),
);

function sea(): Game {
  const g = testGame(asciiMap(SEA, 6), 3);
  startWith(g, [
    [14, 11],
    [284, 11],
    [152, 59],
  ]);
  // Every player holds its whole island, coasts included.
  for (let i = 0; i < g.map.size; i++)
    if (g.map.isLand(i)) g.setOwner(i, g.map.y(i) > 40 ? 3 : g.map.x(i) < 150 ? 1 : 2);
  return g;
}

/** A ship of `owner` at (x, y) sailing straight to (tx, ty) at speed 1. */
function sail(g: Game, type: U, owner: number, x: number, y: number, tx: number, ty: number): Unit {
  const u = makeUnit(g.nextId(), type, owner, x + 0.5, y + 0.5);
  u.hp = u.maxHp = type === U.Warship ? WARSHIP_HP : type === U.Transport ? TRANSPORT_HP : MERCHANT_HP;
  u.path = [g.map.idx(tx, ty)];
  u.pathIdx = 0;
  if (type === U.Transport) {
    u.troops = 1_000;
    u.target = g.map.idx(14, 11);
  }
  return addUnit(g, u);
}

describe('naval rules (OpenFront)', () => {
  it('ships sail one tile of a 4-connected route per tick', () => {
    const w = 100;
    const steps = (tx: number, ty: number) => {
      const u = makeUnit(1, U.Transport, 1, 0.5, 0.5);
      u.path = [ty * w + tx];
      let ticks = 0;
      while (u.pathIdx < u.path.length) {
        sailOnPath(u, TRANSPORT_SPEED, w);
        ticks++;
      }
      return ticks;
    };
    expect(TRANSPORT_SPEED).toBe(1);
    expect(steps(10, 0)).toBe(10);
    expect(steps(10, 10)).toBe(20); // a diagonal is a staircase
    // A real crossing lasts as many ticks as its route has tiles (|dx| + |dy| per leg).
    const g = islands();
    g.players[1]!.troops = 100_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(30, 10), ratio: 0.3 })]);
    for (let k = 0; k < 150; k++) g.step([]);
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.2 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    let left = 0;
    let [x, y] = [boat.x, boat.y];
    for (let k = boat.pathIdx; k < boat.path.length; k++) {
      const wx = g.map.x(boat.path[k]!) + 0.5;
      const wy = g.map.y(boat.path[k]!) + 0.5;
      left += Math.abs(wx - x) + Math.abs(wy - y);
      [x, y] = [wx, wy];
    }
    let ticks = 0;
    while (boat.alive && ticks < 500) {
      g.step([]);
      ticks++;
    }
    expect(left).toBeGreaterThan(40);
    expect(Math.abs(ticks - left)).toBeLessThanOrEqual(1);
  });

  it('a warship far from its patrol point (beyond the short searches) sails back to it', () => {
    // Back from a repair across the world, every short search for a patrol waypoint
    // failed: the ship stood still for good (and spent six searches a tick on it).
    const g = testGame(mapFromDisk('world'), 1);
    let land = 0;
    while (!g.map.isLand(land) || g.map.isCoastalLand(land)) land += 997;
    startWith(g, [[g.map.x(land), g.map.y(land)]]);
    const ws = sail(g, U.Warship, 1, 20, 50, 20, 50);
    ws.path = [];
    ws.patrol = g.map.idx(1860, 290);
    expect(g.map.nav.findPath(g.map.idx(20, 50), ws.patrol, 20_000)).toBeNull();
    for (let k = 0; k < 120; k++) g.step([]);
    expect(Math.abs(ws.x - 20.5) + Math.abs(ws.y - 50.5)).toBeGreaterThan(60);
  });

  it('water lines never slip through a land corner into another body of water', () => {
    // Sea (top left) and a lake (bottom right) touch only by a diagonal between two
    // land tiles: a straight leg used to cross from one to the other.
    const g = testGame(asciiMap(['~~~....', '~~~....', '...ooo.', '...ooo.', '.......'], 1), 1);
    const sea = g.map.idx(2, 1);
    const lake = g.map.idx(3, 2);
    expect(g.map.navBody[sea]).not.toBe(g.map.navBody[lake]);
    expect(g.map.nav.lineOfWater(sea, lake)).toBe(false);
    expect(g.map.nav.lineOfWater(g.map.idx(0, 0), g.map.idx(2, 1))).toBe(true);
    expect(g.map.nav.lineOfWater(lake, g.map.idx(5, 3))).toBe(true);
  });

  it('a warship caught on a corner of land with no route sails off it again', () => {
    // Legs are straight lines between waypoints: a ship can stand over a land corner.
    // With its route cleared there (new order, end of a chase), routes used to start
    // from that land tile and fail forever: the ship never moved again.
    const g = sea();
    const ws = sail(g, U.Warship, 2, 144, 54, 144, 54);
    expect(g.map.isNavigable(g.map.idx(144, 54))).toBe(false);
    ws.path = [];
    ws.patrol = g.map.idx(150, 30);
    for (let k = 0; k < 60; k++) g.step([]);
    expect(Math.abs(ws.y - 54.5)).toBeGreaterThan(5);
    expect(g.map.isNavigable(g.map.idx(Math.floor(ws.x), Math.floor(ws.y)))).toBe(true);
    // Same with a move order given while over the land corner.
    ws.x = 144.5;
    ws.y = 54.5;
    ws.path = [];
    g.step([cmd(2, { t: 'shipMove', ids: [ws.id], tile: g.map.idx(100, 40), patrol: false })]);
    for (let k = 0; k < 80; k++) g.step([]);
    expect(Math.hypot(ws.x - 100.5, ws.y - 40.5)).toBeLessThan(WARSHIP_PATROL_RANGE);
  });

  it('warships shell transports within range while staying on patrol (no chase)', () => {
    const g = sea();
    const ws = sail(g, U.Warship, 2, 150, 30, 150, 30);
    ws.patrol = g.map.idx(150, 30);
    ws.path = [];
    const shells = () => g.units.filter((u) => u.type === U.Shell && u.owner === 2).length;
    // Out of range (100 tiles, sailing away): ignored.
    const far = sail(g, U.Transport, 1, 50, 30, 40, 30);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(WARSHIP_RANGE).toBeLessThan(100);
    expect(ws.target).toBe(-1);
    expect(shells()).toBe(0);
    far.alive = false;
    // In range (75 tiles), sailing away west: shelled, but not chased.
    const near = sail(g, U.Transport, 1, 75, 34, 30, 34);
    let fired = 0;
    let maxDrift = 0;
    for (let k = 0; k < 60; k++) {
      g.step([]);
      fired = Math.max(fired, shells());
      maxDrift = Math.max(maxDrift, Math.abs(ws.x - 150.5), Math.abs(ws.y - 30.5));
    }
    expect(fired).toBeGreaterThan(0);
    expect(near.hp < TRANSPORT_HP || !near.alive).toBe(true);
    expect(maxDrift).toBeLessThanOrEqual(WARSHIP_PATROL_RANGE / 2 + 1);
  });

  it('warships only hunt merchants near their patrol point, bound for a foreign port', () => {
    const g = sea();
    const [p2, p3] = [g.players[2]!, g.players[3]!];
    const port2 = placeBuilding(
      g,
      p2,
      B.Port,
      p2.coast.find((t) => g.map.x(t) === 276)!,
      true,
    )!;
    const port3 = placeBuilding(
      g,
      p3,
      B.Port,
      p3.coast.find((t) => g.map.y(t) === 54)!,
      true,
    )!;
    const ws = sail(g, U.Warship, 2, 150, 30, 150, 30);
    ws.patrol = g.map.idx(110, 30);
    ws.path = [];
    const merchant = (x: number, y: number, tx: number, dest: number) => {
      const m = sail(g, U.Merchant, 1, x, y, tx, y);
      m.dest = dest;
      m.level = 1;
      return m;
    };
    // 40 tiles from the ship but 80 from its patrol point: out of its zone.
    const outside = merchant(190, 30, 270, port3.id);
    // In the zone, but bound for the warship owner's own port.
    const toOurPort = merchant(118, 26, 60, port2.id);
    // In the zone, bound for a third player: hunted at two steps a tick and captured.
    const prey = merchant(125, 36, 200, port3.id);
    for (let k = 0; k < 80 && prey.owner === 1; k++) g.step([]);
    expect(prey.owner).toBe(2);
    expect(outside.owner).toBe(1);
    expect(toOurPort.owner).toBe(1);
  });

  it('an A-bomb aimed at a transport catches it: it sails fewer tiles than the blast radius in flight', () => {
    const g = sea();
    const p1 = g.players[1]!;
    p1.gold = 10_000_000;
    placeBuilding(g, p1, B.Silo, g.map.idx(14, 11), true);
    const boat = sail(g, U.Transport, 2, 160, 40, 20, 40);
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(160, 40), count: 1 })]);
    const nuke = g.units.find((u) => u.type === U.Nuke)!;
    const flight = nuke.t1 - nuke.t0;
    expect(flight * TRANSPORT_SPEED).toBeLessThan(NUKE_FALLOUT_RADIUS[N.Atom]);
    for (let k = 0; k < flight + 2 && boat.alive; k++) g.step([]);
    expect(boat.alive).toBe(false);
  });

  it('a missile blown up in flight is lost: no blast, nothing refunded, only by its owner (1.23)', () => {
    const g = sea();
    const p1 = g.players[1]!;
    p1.gold = 10_000_000;
    placeBuilding(g, p1, B.Silo, g.map.idx(14, 11), true);
    const boat = sail(g, U.Transport, 2, 160, 40, 20, 40);
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(160, 40), count: 1 })]);
    const nuke = g.units.find((u) => u.type === U.Nuke)!;
    const gold = p1.gold;
    // Not someone else's to blow up.
    g.step([cmd(2, { t: 'nukeAbort', id: nuke.id })]);
    expect(nuke.alive).toBe(true);
    g.step([cmd(1, { t: 'nukeAbort', id: nuke.id })]);
    expect(nuke.alive).toBe(false);
    for (let k = 0; k < nuke.t1 - nuke.t0 + 5; k++) g.step([]);
    expect(boat.alive).toBe(true);
    expect(p1.gold - gold).toBeLessThan(200_000); // (an A-bomb costs 750 000: nothing back)
    expect(g.fallout.some((f) => f > 0)).toBe(false);
  });

  it('a player may strike its own land with an A or H bomb, never with a MIRV', () => {
    const g = sea();
    const p1 = g.players[1]!;
    p1.gold = 100_000_000;
    placeBuilding(g, p1, B.Silo, g.map.idx(14, 11), true);
    const own = g.map.idx(20, 14);
    expect(g.owner[own]).toBe(1);
    g.step([cmd(1, { t: 'nuke', kind: N.Mirv, tile: own, count: 1 })]);
    expect(g.units.some((u) => u.type === U.Nuke && u.alive)).toBe(false);
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: own, count: 1 })]);
    const nuke = g.units.find((u) => u.type === U.Nuke && u.alive);
    expect(nuke?.owner).toBe(1);
    expect(nuke?.kind).toBe(N.Atom);
  });
});

/** Two islands, each taken whole by its player (coasts owned). */
function ownIslands(): Game {
  const g = islands();
  for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i)) g.setOwner(i, g.map.x(i) < 70 ? 1 : 2);
  g.players[1]!.troops = 100_000;
  return g;
}

describe('transports (OpenFront)', () => {
  it('at most 3 transports at sea per player', () => {
    const g = ownIslands();
    for (let k = 0; k < MAX_TRANSPORTS + 1; k++)
      g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 10 + 4 * k), ratio: 0.1 })]);
    expect(MAX_TRANSPORTS).toBe(3);
    expect(g.units.filter((u) => u.type === U.Transport && u.owner === 1).length).toBe(3);
    expect(g.events.some((e) => e.k === 'notify' && e.to === 1 && e.key === 'error.boat.max')).toBe(true);
  });

  it('a transport ordered back sails to its own coast; its troops rejoin the pool, a quarter lost', () => {
    const g = ownIslands();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    expect(boat.sx).toBeLessThan(60); // launched from the west island's coast
    for (let k = 0; k < 12; k++) g.step([]);
    const x = boat.x;
    // Only its owner can turn it back.
    g.step([cmd(2, { t: 'boatRetreat', id: boat.id })]);
    expect(boat.kind).toBe(0);
    g.step([cmd(1, { t: 'boatRetreat', id: boat.id })]);
    expect(boat.kind).toBe(TRANSPORT_RETREATING);
    expect(g.owner[boat.target]).toBe(1);
    const tiles2 = p2.tiles;
    const lost = p1.stats.troopsLost;
    let before = p1.troops;
    for (let k = 0; k < 200 && boat.alive; k++) {
      before = p1.troops;
      g.step([]);
      if (k === 2) expect(boat.x).toBeLessThan(x); // heading back west
    }
    expect(boat.alive).toBe(false);
    const home = p1.troops - p1.lastGrowth - before;
    expect(home).toBeCloseTo(boat.troops * (1 - RETREAT_MALUS), 3);
    expect(p1.stats.troopsLost - lost).toBeCloseTo(boat.troops * RETREAT_MALUS, 3);
    expect(p2.tiles).toBe(tiles2); // no landing
    expect(g.attacks.length).toBe(0);
  });

  it('with no coast to go back to, the troops come home at once, in full', () => {
    const g = ownIslands();
    const p1 = g.players[1]!;
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    g.step([]);
    for (const t of [...p1.coast]) g.setOwner(t, 0); // the whole coast is lost
    const [before, aboard] = [p1.troops, boat.troops];
    g.step([cmd(1, { t: 'boatRetreat', id: boat.id })]);
    expect(boat.alive).toBe(false);
    expect(p1.troops - p1.lastGrowth - before).toBeCloseTo(aboard, 3);
    expect(g.units.some((u) => u.type === U.Transport)).toBe(false);
  });

  it('a landing takes its tile outright and attacks from it, apart from the land attacks', () => {
    const g = ownIslands();
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p2.troops = 5_000;
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 18), ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    const landing = boat.target;
    for (let k = 0; k < 200 && boat.alive; k++) g.step([]);
    const attack = g.attacks.find((a) => a.attacker === 1 && a.target === 2);
    expect(g.owner[landing]).toBe(1);
    expect(attack?.boat).toBe(true);
    expect(p2.embargoUntil.has(1)).toBe(true); // hostilities open on landing
    expect(p2.relation(1)).toBeLessThan(0);
    expect(p1.tiles).toBeGreaterThan(1);
  });
});

describe('warship repairs (OpenFront)', () => {
  /** sea() with a level-1 port on player 2's west coast and one of its warships at (200, 30). */
  function navy(hp: number) {
    const g = sea();
    const p2 = g.players[2]!;
    const port = placeBuilding(
      g,
      p2,
      B.Port,
      p2.coast.find((t) => g.map.x(t) === 276)!,
      true,
    )!;
    const ws = sail(g, U.Warship, 2, 200, 30, 200, 30);
    ws.patrol = g.map.idx(200, 30);
    ws.path = [];
    ws.hp = hp;
    return { g, port, ws };
  }

  it('above half its hp a damaged warship stays on patrol', () => {
    const { g, ws } = navy(600);
    for (let k = 0; k < 20; k++) g.step([]);
    expect(ws.kind).toBe(WS.Patrolling);
  });

  it('below half its hp a warship breaks off for port: it no longer fires, but can still be shot', () => {
    const { g, port, ws } = navy(450);
    sail(g, U.Transport, 1, 190, 34, 100, 34); // within range: a healthy warship would shell it
    const hunter = sail(g, U.Warship, 1, 215, 34, 215, 34);
    hunter.patrol = g.map.idx(215, 34);
    hunter.path = [];
    g.step([]);
    expect(ws.kind).toBe(WS.Retreating);
    expect(ws.home).toBe(port.id);
    let fired = 0;
    let shotAt = 0;
    for (let k = 0; k < 40; k++) {
      g.step([]);
      for (const u of g.units) {
        if (u.type !== U.Shell) continue;
        if (u.owner === 2) fired++;
        if (u.owner === 1 && u.target === ws.id) shotAt++;
      }
      expect(ws.target).toBe(-1);
    }
    expect(fired).toBe(0);
    expect(shotAt).toBeGreaterThan(0);
    expect(!ws.alive || ws.hp < 700).toBe(true);
  });

  it('it docks at the nearest port, heals 1 + 5 × port level a tick out of reach, then resumes its patrol', () => {
    const { g, port, ws } = navy(400);
    for (let k = 0; k < 300 && ws.kind !== WS.Docked; k++) g.step([]);
    expect(ws.kind).toBe(WS.Docked);
    expect(Math.hypot(port.x + 0.5 - ws.x, port.y + 0.5 - ws.y)).toBeLessThanOrEqual(WARSHIP_DOCK_RANGE);
    // A docked ship cannot be targeted.
    const [ex, ey] = [Math.floor(ws.x) - 30, Math.floor(ws.y)];
    const enemy = sail(g, U.Warship, 1, ex, ey, ex, ey);
    enemy.patrol = g.map.idx(ex, ey);
    enemy.path = [];
    let hp = ws.hp;
    g.step([]);
    expect(ws.hp - hp).toBeCloseTo(1 + 5, 9); // passive 1 near one of its ports + the port's pool
    port.level = 2;
    hp = ws.hp;
    g.step([]);
    expect(ws.hp - hp).toBeCloseTo(1 + 10, 9);
    for (let k = 0; k < 100 && ws.kind === WS.Docked; k++) {
      g.step([]);
      if (ws.kind === WS.Docked) expect(enemy.target).not.toBe(ws.id);
    }
    expect(ws.kind).toBe(WS.Patrolling);
    expect(ws.hp).toBe(ws.maxHp);
    expect(ws.home).toBe(-1);
    enemy.alive = false;
    const d0 = Math.hypot(ws.x - 200.5, ws.y - 30.5);
    for (let k = 0; k < 20; k++) g.step([]);
    expect(Math.hypot(ws.x - 200.5, ws.y - 30.5)).toBeLessThan(d0 - 5); // back towards its patrol
  });

  it('a move order calls the retreat off and holds it back for 5 s', () => {
    const { g, ws } = navy(400);
    g.step([]);
    expect(ws.kind).toBe(WS.Retreating);
    g.step([cmd(2, { t: 'shipMove', ids: [ws.id], tile: g.map.idx(180, 40), patrol: true })]);
    expect(ws.kind).toBe(WS.Patrolling);
    for (let k = 1; k < WARSHIP_MANUAL_LOCK_TICKS; k++) {
      g.step([]);
      expect(ws.kind).toBe(WS.Patrolling);
    }
    for (let k = 0; k < 3; k++) g.step([]);
    expect(ws.kind).toBe(WS.Retreating);
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
    expect(p.stats.trainGold).toBeGreaterThanOrEqual(5_000); // at least one own stop
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
    expect(g.fallout[g.map.idx(70 + 40, 35)]).toBe(0);
    // Between the inner (12) and outer (30) radii, about half of the land is razed.
    let ring = 0;
    let razed = 0;
    for (let dy = -30; dy <= 30; dy++)
      for (let dx = -30; dx <= 30; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= 13 * 13 || d2 > 29 * 29 || !g.map.inBounds(70 + dx, 35 + dy)) continue;
        if (g.map.terrain[g.map.idx(70 + dx, 35 + dy)]! < 3) continue;
        ring++;
        if (g.fallout[g.map.idx(70 + dx, 35 + dy)] === 255) razed++;
      }
    expect(razed / ring).toBeGreaterThan(0.35);
    expect(razed / ring).toBeLessThan(0.65);
    expect(p.troops).toBeLessThan(100_000);
    expect(g.usefulLand).toBeLessThan(g.map.landCount);
  });

  it('SAM range grows with level: OpenFront’s 150 − 480/(level+5) at Isoline’s scale (×0.7), halved (1.15)', () => {
    expect(samRange(1)).toBeCloseTo(24.5, 9);
    expect(samRange(5)).toBeCloseTo(35.7, 9);
    expect(samRange(10)).toBeCloseTo(0.35 * (150 - 32), 9);
    expect(samRange(1_000_000)).toBeLessThan(52.5);
    // Missiles are only within reach this close to their silo or their target (OpenFront's 150, same scale).
    expect(NUKE_TARGETABLE_RANGE).toBe(105);
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

  it('MIRV: the carrier climbs out of reach, then warheads rain over the whole target country', () => {
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
    const [a, b] = [g.players[1]!, g.players[2]!];
    for (let y = 14; y < 56; y++) for (let x = 100; x < 182; x++) g.setOwner(g.map.idx(x, y), 2);
    const before = b.tiles;
    a.gold = 100_000_000;
    placeBuilding(g, a, B.Silo, g.map.idx(25, 30), true);
    placeBuilding(g, b, B.Sam, g.map.idx(60, 20), true); // under the carrier's climb
    g.step([cmd(1, { t: 'nuke', kind: N.Mirv, tile: g.map.idx(150, 30), count: 1 })]);
    const carrier = g.units.find((u) => u.type === U.Nuke && u.kind === N.Mirv)!;
    expect(carrier).toBeDefined();
    let warheads: { dest: number }[] = [];
    for (let k = 0; k < 80 && warheads.length === 0; k++) {
      g.step([]);
      expect(carrier.target).toBe(-1); // never targeted by a SAM
      warheads = g.units.filter((u) => u.type === U.Nuke && u.kind === N.MirvWarhead);
    }
    expect(warheads.length).toBeGreaterThanOrEqual(2);
    const w = g.map.width;
    for (const h of warheads) expect(g.owner[h.dest]).toBe(2);
    for (let i = 0; i < warheads.length; i++)
      for (let j = i + 1; j < warheads.length; j++) {
        const [p, q] = [warheads[i]!.dest, warheads[j]!.dest];
        expect(Math.abs((p % w) - (q % w)) + Math.abs(((p / w) | 0) - ((q / w) | 0))).toBeGreaterThanOrEqual(
          MIRV_MIN_SPREAD,
        );
      }
    for (let k = 0; k < 80; k++) g.step([]);
    expect(b.tiles).toBeLessThan(before * 0.9);
  });

  // A wide plain: A launches from the west at B in the east; C's SAM sits north of A's silo.
  function arcRange() {
    const g = testGame(
      asciiMap(
        Array.from({ length: 20 }, () => '.'.repeat(40)),
        15,
      ),
      3,
    );
    startWith(g, [
      [100, 150],
      [500, 150],
      [170, 70],
    ]);
    const [a, , c] = [g.players[1]!, g.players[2]!, g.players[3]!];
    a.gold = 100_000_000;
    placeBuilding(g, a, B.Silo, g.map.idx(100, 150), true);
    placeBuilding(g, c, B.Sam, g.map.idx(170, 70), true);
    return g;
  }

  it('the arc can be mirrored to fly around a SAM, and the preview predicts it', () => {
    for (const up of [true, false]) {
      const g = arcRange();
      const target = g.map.idx(500, 150);
      const sams = hostileSams(g, g.players[1]!);
      const path = new Trajectory(100.5, 150.5, 500.5, 150.5, up ? ARC_UP : ARC_DOWN, g.map.height);
      const predicted = predictInterception(path, 500.5, 150.5, NUKE_SPEED[N.Atom], sams) >= 0;
      g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: target, count: 1, up })]);
      let intercepted = false;
      let exploded = false;
      for (let k = 0; k < 120; k++) {
        g.step([]);
        if (g.events.some((e) => e.k === 'intercept')) intercepted = true;
        if (g.events.some((e) => e.k === 'explosion')) exploded = true;
      }
      expect(intercepted).toBe(up); // the upward arc passes over C's SAM, the downward one does not
      expect(exploded).toBe(!up);
      expect(predicted).toBe(up);
    }
  });

  it('a SAM holds one missile per level, each reloading for 9 s', () => {
    for (const level of [1, 2]) {
      const g = testGame(
        asciiMap(
          Array.from({ length: 10 }, () => '.'.repeat(30)),
          10,
        ),
        2,
      );
      startWith(g, [
        [40, 50],
        [240, 50],
      ]);
      const [a, b] = [g.players[1]!, g.players[2]!];
      a.gold = 100_000_000;
      const silo = placeBuilding(g, a, B.Silo, g.map.idx(40, 50), true)!;
      silo.level = 2;
      silo.tubes = [0, 0];
      const sam = placeBuilding(g, b, B.Sam, g.map.idx(235, 50), true)!;
      sam.level = level;
      for (let k = 0; k < SAM_COOLDOWN + 5; k++) g.step([]);
      g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(240, 50), count: 2 })]);
      let intercepts = 0;
      let explosions = 0;
      for (let k = 0; k < 80; k++) {
        g.step([]);
        intercepts += g.events.filter((e) => e.k === 'intercept').length;
        explosions += g.events.filter((e) => e.k === 'explosion').length;
      }
      expect(intercepts).toBe(level);
      expect(explosions).toBe(2 - level);
    }
  });

  it('only the countries under the blast are alerted, not those overflown', () => {
    const g = testGame(
      asciiMap(
        Array.from({ length: 10 }, () => '.'.repeat(40)),
        10,
      ),
      3,
    );
    startWith(g, [
      [30, 50],
      [360, 50],
      [200, 50],
    ]);
    const a = g.players[1]!;
    a.gold = 100_000_000;
    for (let y = 20; y < 80; y++) for (let x = 150; x < 250; x++) g.setOwner(g.map.idx(x, y), 3);
    placeBuilding(g, a, B.Silo, g.map.idx(30, 50), true);
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(360, 50), count: 1, up: true })]);
    const launch = g.events.find((e) => e.k === 'nukeLaunch');
    expect(launch && launch.k === 'nukeLaunch' && launch.threatened).toEqual([2]);
    const alerts = g.events
      .filter((e) => e.k === 'notify' && e.key === 'alert.nuke')
      .map((e) => e.k === 'notify' && e.to);
    expect(alerts).toEqual([2]);
  });
});

describe('port radius of action', () => {
  it('warships can only be laid down within the port range', () => {
    const g = testGame(
      asciiMap(['~'.repeat(60), '~'.repeat(60), '~~' + '.'.repeat(10) + '~'.repeat(48), '~'.repeat(60)], 6),
      1,
    );
    startWith(g, [[30, 15]]);
    const p = g.players[1]!;
    p.gold = 50_000_000;
    const coast = p.coast[0]!;
    g.step([cmd(1, { t: 'build', kind: B.Port, tile: coast })]);
    for (let k = 0; k < 55; k++) g.step([]);
    const port = [...g.buildings.values()].find((b) => b.type === B.Port)!;
    expect(port).toBeDefined();
    // Far beyond 60 tiles: refused. Within range: accepted.
    g.step([cmd(1, { t: 'warship', tile: g.map.idx(Math.min(359, port.x + 200), 3) })]);
    expect(g.units.some((u) => u.type === U.Warship)).toBe(false);
    g.step([cmd(1, { t: 'warship', tile: g.map.idx(port.x + 30, 3) })]);
    expect(g.units.some((u) => u.type === U.Warship)).toBe(true);
  });
});

describe('fallout accounting', () => {
  it('keeps every player useful-tile count exact through nuclear strikes (regression: 256 wrapped to 0)', () => {
    const g = testGame(
      asciiMap(
        Array.from({ length: 20 }, () => '.'.repeat(30)),
        6,
      ),
      2,
    );
    startWith(g, [
      [40, 60],
      [130, 60],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.troops = p2.troops = 800_000;
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(90, 60), ratio: 0.5 }),
      cmd(2, { t: 'attack', tile: g.map.idx(90, 60), ratio: 0.5 }),
    ]);
    for (let k = 0; k < 300; k++) g.step([]);
    for (const [x, y] of [
      [60, 50],
      [120, 70],
      [90, 30],
    ] as const)
      detonate(g, N.Hydrogen, x, y, 1);
    const counted = new Map<number, number>();
    for (let i = 0; i < g.owner.length; i++) {
      const o = g.owner[i]!;
      if (o > 0 && g.isUsefulLand(i)) counted.set(o, (counted.get(o) ?? 0) + 1);
    }
    for (const p of [p1, p2]) expect(p.usefulTiles).toBe(counted.get(p.id) ?? 0);
    expect(g.fallout.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});
