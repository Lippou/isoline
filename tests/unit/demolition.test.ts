// Timed demolition (1.16, GAME_DESIGN.md §7): a building ordered down goes out of service at
// once, comes down after its type's construction time (5 s at least), then pays back 25 % of
// the gold invested; the order can be called off; the state is saved and hashed.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import { B, BUILD_TICKS, DEMOLISH_MIN_TICKS } from '../../src/core/game/constants';
import { placeBuilding, upgradeBuilding } from '../../src/core/buildings/buildings';
import { inService } from '../../src/core/buildings/building';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { maxTroops } from '../../src/core/game/economy';

const FIELD = Array.from({ length: 7 }, () => '.'.repeat(20));

/** Two players (the match goes on), player 1 holding the west half, rich. */
function field(): Game {
  const g = testGame(asciiMap(FIELD, 8), 2, { victoryThreshold: 101 });
  startWith(g, [
    [30, 28],
    [130, 28],
  ]);
  for (let i = 0; i < g.map.size; i++) g.setOwner(i, i % g.map.width < 80 ? 1 : 2);
  g.players[1]!.gold = 10_000_000;
  return g;
}
const steps = (g: Game, n: number) => {
  for (let k = 0; k < n; k++) g.step([]);
};

describe('demolition takes time', () => {
  it('out of service at once, down at the end with 25 % of the gold invested', () => {
    const g = field();
    const p = g.players[1]!;
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(40, 28) })]);
    const city = [...g.buildings.values()].find((b) => b.type === B.City)!;
    steps(g, BUILD_TICKS[B.City] + 1);
    expect(inService(city)).toBe(true);
    const cap = maxTroops(g, p);
    const invested = city.invested;
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    const total = Math.max(DEMOLISH_MIN_TICKS, BUILD_TICKS[B.City]);
    expect(city.demolishTotal).toBe(total);
    expect(city.demolishLeft).toBe(total - 1);
    expect(inService(city)).toBe(false);
    expect(maxTroops(g, p)).toBeLessThan(cap); // its troop ceiling goes at once
    // No second order, no upgrade while it comes down.
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    expect(city.demolishLeft).toBe(total - 2);
    expect(upgradeBuilding(g, p, city)).toBe(false);
    const gold = p.gold;
    let refund = 0;
    for (let k = 0; k < total && g.buildings.has(city.id); k++) {
      g.step([]);
      for (const e of g.events) if (e.k === 'demolished') refund = e.refund;
    }
    expect(g.buildings.has(city.id)).toBe(false);
    expect(refund).toBe(Math.round(invested * 0.25));
    expect(p.gold - gold).toBeGreaterThanOrEqual(refund - 1);
  });

  it('a silo takes as long as it took to build; cancelling puts it back in service, nothing lost', () => {
    const g = field();
    const p = g.players[1]!;
    const silo = placeBuilding(g, p, B.Silo, g.map.idx(40, 28), true)!;
    g.step([cmd(1, { t: 'demolish', id: silo.id })]);
    expect(silo.demolishTotal).toBe(BUILD_TICKS[B.Silo]);
    steps(g, 30);
    const gold = p.gold;
    g.step([cmd(1, { t: 'demolish', id: silo.id, cancel: true })]);
    expect(silo.demolishLeft).toBe(0);
    expect(inService(silo)).toBe(true);
    steps(g, BUILD_TICKS[B.Silo] + 5);
    expect(g.buildings.has(silo.id)).toBe(true);
    expect(p.gold).toBeGreaterThanOrEqual(gold);
  });

  it('halts a construction under way; only its owner may order or cancel it', () => {
    const g = field();
    const p = g.players[1]!;
    g.step([cmd(1, { t: 'build', kind: B.Sam, tile: g.map.idx(40, 28) })]);
    const sam = [...g.buildings.values()].find((b) => b.type === B.Sam)!;
    const left = sam.buildLeft;
    g.step([cmd(2, { t: 'demolish', id: sam.id })]);
    expect(sam.demolishLeft).toBe(0);
    g.step([cmd(1, { t: 'demolish', id: sam.id })]);
    steps(g, 10);
    expect(sam.buildLeft).toBe(left - 1); // frozen since the order
    g.step([cmd(2, { t: 'demolish', id: sam.id, cancel: true })]);
    expect(sam.demolishLeft).toBeGreaterThan(0);
    void p;
  });

  it('a building captured mid-demolition stays up for its new owner', () => {
    const g = field();
    const city = placeBuilding(g, g.players[1]!, B.City, g.map.idx(70, 28), true)!;
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    g.setOwner(city.tile, 2);
    expect(city.owner).toBe(2);
    expect(city.demolishLeft).toBe(0);
    steps(g, DEMOLISH_MIN_TICKS + 5);
    expect(g.buildings.has(city.id)).toBe(true);
  });

  it('is saved, restored and hashed', () => {
    const g = field();
    const city = placeBuilding(g, g.players[1]!, B.City, g.map.idx(40, 28), true)!;
    const before = hashGame(g);
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    const twin = field();
    placeBuilding(twin, twin.players[1]!, B.City, twin.map.idx(40, 28), true);
    twin.step([]);
    expect(hashGame(g)).not.toBe(hashGame(twin)); // the countdown is part of the state hash
    expect(before).not.toBe(hashGame(g));
    steps(g, 20);
    const r = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    const rc = r.buildings.get(city.id)!;
    expect(rc.demolishLeft).toBe(city.demolishLeft);
    expect(rc.demolishTotal).toBe(city.demolishTotal);
    for (let k = 0; k < 40; k++) {
      g.step([]);
      r.step([]);
      expect(hashGame(r)).toBe(hashGame(g));
    }
    expect(g.buildings.has(city.id)).toBe(false);
    expect(r.buildings.has(city.id)).toBe(false);
  });
});
