import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, invariants } from '../helpers';
import { growthCurve, populationCap } from '../../src/core/game/economy';
import { B, CANCEL_PENALTY, GROWTH_PEAK, SPAWN_IMMUNITY_TICKS } from '../../src/core/game/constants';
import { buildCost, checkPlacement, placeBuilding, upgradeCost } from '../../src/core/buildings/buildings';
import { conquestLoss, launchAttack } from '../../src/core/rules/combat';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

describe('spawn', () => {
  it('claims an 8-tile disc and grants immunity to humans', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { spawnSeconds: 2 });
    g.step([cmd(1, { t: 'spawn', tile: g.map.idx(30, 20) })]);
    const p = g.players[1]!;
    expect(p.tiles).toBeGreaterThan(150);
    expect(p.tiles).toBeLessThan(230);
    // Moving the spawn releases the previous disc (player 2 has not chosen yet).
    g.step([cmd(1, { t: 'spawn', tile: g.map.idx(80, 20) })]);
    expect(g.owner[g.map.idx(30, 20)]).toBe(0);
    expect(g.owner[g.map.idx(80, 20)]).toBe(1);
    expect(g.phase).toBe('spawn');
    g.step([cmd(2, { t: 'spawn', tile: g.map.idx(30, 30) })]);
    // Once every human has placed, the match starts at once (no waiting for the timer).
    expect(g.phase).toBe('playing');
    expect(p.immuneUntil).toBe(g.tick - 1 + SPAWN_IMMUNITY_TICKS);
    expect(invariants(g)).toEqual([]);
  });

  it('auto-spawns humans who did not choose, on a spawn point', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.spawnPoints = [[40, 20]];
    const g = testGame(map, 1, { spawnSeconds: 0.2 });
    while (g.phase === 'spawn') g.step([]);
    expect(g.players[1]!.tiles).toBeGreaterThan(100);
  });
});

describe('land combat', () => {
  it('expands into wilderness and returns leftover troops', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[20, 20]]);
    const p = g.players[1]!;
    const before = p.tiles;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(30, 20), ratio: 0.5 })]);
    for (let k = 0; k < 200; k++) g.step([]);
    expect(p.tiles).toBeGreaterThan(before + 300);
    expect(g.attacks.length).toBe(0);
    expect(invariants(g)).toEqual([]);
  });

  it('terrain modifies losses (mountains cost more than plains)', () => {
    const g = testGame(asciiMap(['~~~~~~', '~..MM~', '~..MM~', '~~~~~~'], 5), 1);
    startWith(g, [[7, 7]]);
    const a = launchAttack(g, 1, 0, 1000)!;
    const plains = g.map.idx(11, 7);
    const mountain = g.map.idx(20, 7);
    expect(conquestLoss(g, a, mountain)).toBeGreaterThan(conquestLoss(g, a, plains) * 1.4);
  });

  it('attacks between players, defence posts multiply losses, cancel refunds 90 %', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [45, 20],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.troops = p2.troops = 200_000;
    // Fill the gap so the two territories touch.
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(35, 20), ratio: 0.3 }),
      cmd(2, { t: 'attack', tile: g.map.idx(35, 21), ratio: 0.3 }),
    ]);
    for (let k = 0; k < 200; k++) g.step([]);
    const w = g.map.width;
    expect(p1.border.some((t) => [t - 1, t + 1, t - w, t + w].some((n) => g.owner[n] === 2))).toBe(true);

    const a = launchAttack(g, 1, 2, 50_000);
    expect(a).not.toBeNull();
    const front = a!.heapTiles[0]!;
    const plain = conquestLoss(g, a!, front);
    p2.gold = 10_000_000;
    const post = placeBuilding(g, p2, B.DefensePost, front + 3, true);
    expect(post).not.toBeNull();
    expect(conquestLoss(g, a!, front)).toBeCloseTo(plain * 5, 0);

    p1.troopRatio = 1; // no troop→worker rebalancing during the check
    const troopsBefore = p1.troops;
    const inAttack = a!.troops;
    g.step([cmd(1, { t: 'cancelAttack', id: a!.id })]);
    expect(p1.troops).toBeGreaterThan(troopsBefore + inAttack * (1 - CANCEL_PENALTY) - 1);
    expect(invariants(g)).toEqual([]);
  });

  it('immune players cannot be attacked; allies cannot fight; betrayal applies penalties', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [40, 20],
    ]);
    g.players[2]!.immuneUntil = g.tick + 100;
    expect(g.attackAllowed(1, 2, true)).toBe(false);
    g.players[2]!.immuneUntil = -1;
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(g.players[1]!.allies.has(2)).toBe(true);
    expect(g.attackAllowed(1, 2, false)).toBe(false);
    // Betrayal by attacking.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(40, 20), ratio: 0.2 })]);
    const t = g.players[1]!;
    expect(t.allies.has(2)).toBe(false);
    expect(t.isTraitor(g.tick)).toBe(true);
    expect(t.debuffUntil).toBeGreaterThan(g.tick);
    expect(g.players[2]!.hasEmbargoWith(t, g.tick)).toBe(true);
  });

  it('eliminates a player who loses every tile', () => {
    const g = testGame(asciiMap(FIELD, 4), 2);
    startWith(g, [
      [15, 12],
      [30, 12],
    ]);
    g.players[1]!.troops = 3_000_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(22, 12), ratio: 0.2 })]);
    for (let k = 0; k < 60; k++) g.step([]);
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(30, 12), ratio: 0.9 })]);
    for (let k = 0; k < 400 && g.players[2]!.alive; k++) g.step([]);
    expect(g.players[2]!.alive).toBe(false);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(g.phase).toBe('ended');
    expect(g.victory.winner).toBe(1);
  });
});

describe('economy', () => {
  it('growth peaks at 42 % troops/cap', () => {
    expect(growthCurve(GROWTH_PEAK)).toBeCloseTo(1, 6);
    expect(growthCurve(0.2)).toBeLessThan(1);
    expect(growthCurve(0.7)).toBeLessThan(1);
    expect(growthCurve(0.1)).toBeLessThan(growthCurve(0.3));
    expect(growthCurve(0.9)).toBeLessThan(growthCurve(0.6));
  });

  it('cap = 100k + 150k per city level + territory bonus; gold accrues', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    const base = populationCap(g, p);
    p.gold = 5_000_000;
    placeBuilding(g, p, B.City, g.map.idx(30, 20), true);
    expect(populationCap(g, p) - base).toBeCloseTo(150_000, 0);
    const gold = p.gold;
    for (let k = 0; k < 10; k++) g.step([]);
    expect(p.gold - gold).toBeGreaterThan(900); // ≥ 1 000 gold/s base income
    const pop = p.troops + p.workers;
    for (let k = 0; k < 50; k++) g.step([]);
    expect(p.troops + p.workers).toBeGreaterThan(pop);
  });

  it('troop/worker slider rebalances gradually; 0 = automatic', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    g.step([cmd(1, { t: 'troopRatio', ratio: 0.1 })]);
    for (let k = 0; k < 400; k++) g.step([]);
    expect(p.workers).toBeGreaterThan(p.troops);
    g.step([cmd(1, { t: 'troopRatio', ratio: 0 })]);
    for (let k = 0; k < 50; k++) g.step([]);
    expect(p.troopRatio).toBe(0);
  });
});

describe('buildings', () => {
  it('follows the cost formulas', () => {
    const g = testGame(asciiMap(FIELD, 8), 1);
    startWith(g, [[40, 28]]);
    const p = g.players[1]!;
    expect(buildCost(g, p, B.City)).toBe(125_000);
    p.cityLevels = 3;
    expect(buildCost(g, p, B.City)).toBe(Math.round(125_000 * 1.32 ** 3));
    p.cityLevels = 20; // no price cap: gold cannot buy population exponentially
    expect(buildCost(g, p, B.City)).toBeGreaterThan(30_000_000);
    p.cityLevels = 0;
    expect(buildCost(g, p, B.DefensePost)).toBe(50_000);
    p.buildingCount[B.DefensePost] = 9;
    expect(buildCost(g, p, B.DefensePost)).toBe(250_000);
    p.buildingCount[B.DefensePost] = 0;
    expect(buildCost(g, p, B.Silo)).toBe(1_000_000);
    expect(buildCost(g, p, B.Sam)).toBe(1_500_000);
    expect(buildCost(g, p, B.Radar)).toBe(300_000);
    expect(buildCost(g, p, B.Airfield)).toBe(800_000);
    // Port and factory share one counter.
    expect(buildCost(g, p, B.Factory)).toBe(125_000);
    p.gold = 10_000_000;
    const f = placeBuilding(g, p, B.Factory, g.map.idx(40, 28))!;
    expect(f.buildLeft).toBe(20);
    expect(buildCost(g, p, B.Port)).toBe(Math.round(125_000 * 1.4));
    expect(upgradeCost(g, p, f)).toBe(Math.round(125_000 * 1.4));
  });

  it('validates placement and refunds 25 % on demolition', () => {
    const g = testGame(asciiMap(FIELD, 8), 1);
    startWith(g, [[40, 28]]);
    const p = g.players[1]!;
    expect(checkPlacement(g, p, B.City, g.map.idx(40, 28))).toBe('gold');
    p.gold = 1_000_000;
    expect(checkPlacement(g, p, B.City, g.map.idx(5, 5))).toBe('notOwned');
    expect(checkPlacement(g, p, B.Port, g.map.idx(40, 28))).toBe('notCoastal');
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(40, 28) })]);
    const city = [...g.buildings.values()][0]!;
    expect(checkPlacement(g, p, B.City, g.map.idx(41, 28))).toBe('tooClose');
    const gold = p.gold;
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    // 25 % refund (+ one tick of income).
    expect(p.gold - gold - 125_000 * 0.25).toBeGreaterThanOrEqual(0);
    expect(p.gold - gold - 125_000 * 0.25).toBeLessThan(200);
    expect(g.buildings.size).toBe(0);
  });

  it('upgrades by building on the same tile and transfers/destroys on capture', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [40, 20],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p2.gold = 10_000_000;
    const t = g.map.idx(40, 20);
    g.step([cmd(2, { t: 'build', kind: B.City, tile: t })]);
    for (let k = 0; k < 25; k++) g.step([]);
    g.step([cmd(2, { t: 'build', kind: B.City, tile: t })]);
    const city = g.buildings.get(g.buildingAt[t]!)!;
    expect(city.level).toBe(2);
    expect(p2.cityLevels).toBe(2);
    const post = placeBuilding(g, p2, B.DefensePost, g.map.idx(40, 16), true)!;
    g.setOwner(t, 1);
    expect(city.owner).toBe(1);
    expect(p1.cityLevels).toBe(2);
    g.setOwner(post.tile, 1);
    expect(g.buildings.has(post.id)).toBe(false);
  });
});

describe('front shape', () => {
  it('grows round territories on open plains (no Manhattan diamonds)', () => {
    const map = asciiMap(
      Array.from({ length: 30 }, () => '.'.repeat(30)),
      8,
    );
    const g = testGame(map, 1, { victoryThreshold: 101 });
    startWith(g, [[120, 120]]);
    for (let t = 1; g.players[1]!.tiles < 12000 && t < 20000; t++) {
      g.step(t % 10 === 0 ? [cmd(1, { t: 'attack', tile: map.idx(239, 239), ratio: 0.15 })] : []);
    }
    const own = (x: number, y: number) => g.owner[map.idx(x, y)] === 1;
    const ext = (dx: number, dy: number) => {
      let r = 0;
      while (r < 118 && own(120 + Math.round(dx * (r + 1)), 120 + Math.round(dy * (r + 1)))) r++;
      return r;
    };
    const s = Math.SQRT1_2;
    const axis = ext(1, 0) + ext(-1, 0) + ext(0, 1) + ext(0, -1);
    const diag = ext(s, s) + ext(-s, s) + ext(s, -s) + ext(-s, -s);
    // A diamond gives 0.71, a disc 1.0.
    expect(diag / axis).toBeGreaterThan(0.88);
  });
});
