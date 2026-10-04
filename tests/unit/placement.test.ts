// The build cursor: what a build order would do before the click (buildings.ts planBuild,
// the worker's 'placement' query) — and the 'build' command doing exactly that.
import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd } from '../helpers';
import { B, MIN_BUILDING_SPACING } from '../../src/core/game/constants';
import { levelsByType, placeBuilding, planBuild, upgradeBuilding } from '../../src/core/buildings/buildings';
import { restoreSnapshot, takeSnapshot } from '../../src/core/net/snapshot';
import { placementText } from '../../src/ui/game/placement';
import type { Game } from '../../src/core/game/state';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** Player 1 holds the west half of a 120 × 42 island, rich; player 2 the east. */
function field(): Game {
  const g = testGame(asciiMap(FIELD, 6), 2, { victoryThreshold: 101 });
  startWith(g, [
    [25, 20],
    [95, 20],
  ]);
  for (let y = 6; y < 36; y++) for (let x = 6; x < 114; x++) g.setOwner(g.map.idx(x, y), x < 60 ? 1 : 2);
  g.players[1]!.gold = 50_000_000;
  return g;
}

describe('build cursor: what an order would do', () => {
  it('on one of your buildings of that type: an upgrade, to the next level', () => {
    const g = field();
    const p = g.players[1]!;
    const city = placeBuilding(g, p, B.City, g.map.idx(30, 20), true)!;
    const plan = planBuild(g, p, B.City, g.map.idx(33, 22));
    expect(plan.building).toBe(city);
    expect(plan).toMatchObject({ tile: city.tile, error: 'ok' });
    upgradeBuilding(g, p, city);
    expect(planBuild(g, p, B.City, city.tile).error).toBe('upgrading');
    // Levels: a stacked city counts twice (the campaign's « own 2 cities »).
    expect(levelsByType(g, p)[B.City]).toBe(2);
    expect(p.buildingCount[B.City]).toBe(1);
  });

  it('too close to another building: snapped to the nearest free spot, or none at all', () => {
    const g = field();
    const p = g.players[1]!;
    placeBuilding(g, p, B.City, g.map.idx(30, 20), true);
    const click = g.map.idx(33, 20);
    const plan = planBuild(g, p, B.Factory, click);
    expect(plan.error).toBe('ok');
    expect(plan.tile).not.toBe(click);
    const [x, y] = [plan.tile % g.map.width, Math.floor(plan.tile / g.map.width)];
    expect(Math.hypot(x - 30, y - 20)).toBeGreaterThanOrEqual(MIN_BUILDING_SPACING);
    // Pack the land with defence posts: nowhere left near the click.
    for (let yy = 8; yy < 36; yy += 7)
      for (let xx = 8; xx < 58; xx += 7) {
        const t = g.map.idx(xx, yy);
        if (g.buildingAt[t]! < 0) placeBuilding(g, p, B.DefensePost, t, true);
      }
    const none = planBuild(g, p, B.Factory, g.map.idx(39, 25));
    expect(none).toMatchObject({ building: null, tile: -1, error: 'tooClose' });
  });

  it('says why not: outside your land, no coast, gold short, the research missing', () => {
    const g = field();
    const p = g.players[1]!;
    expect(planBuild(g, p, B.City, g.map.idx(80, 20)).error).toBe('notOwned');
    expect(planBuild(g, p, B.Port, g.map.idx(40, 20))).toMatchObject({ error: 'notCoastal', tile: -1 });
    // A port clicked near the shore goes on the coast.
    const port = planBuild(g, p, B.Port, g.map.idx(30, 9));
    expect(port.error).toBe('ok');
    expect(g.map.isCoastalLand(port.tile)).toBe(true);
    p.gold = 10;
    expect(planBuild(g, p, B.City, g.map.idx(30, 20))).toMatchObject({ error: 'gold' });
    const t = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101, features: { tech: true } as never });
    startWith(t, [[25, 20]]);
    t.players[1]!.gold = 50_000_000;
    const silo = planBuild(t, t.players[1]!, B.Silo, g.map.idx(25, 20));
    expect(silo.error).toBe('locked');
    expect(silo.lock).toBeGreaterThanOrEqual(0);
  });

  it('the build command does exactly what the cursor showed', () => {
    const g = field();
    const p = g.players[1]!;
    placeBuilding(g, p, B.City, g.map.idx(30, 20), true);
    placeBuilding(g, p, B.Port, g.map.idx(20, 6), true);
    placeBuilding(g, p, B.DefensePost, g.map.idx(45, 28), true);
    const snap = takeSnapshot(g);
    let checked = 0;
    for (let k = 0; k < 120; k++) {
      const kind = [B.City, B.Port, B.Factory, B.DefensePost][k % 4]!;
      const tile = g.map.idx(4 + ((k * 37) % 70), 4 + ((k * 13) % 34));
      const before = restoreSnapshot(g.map, snap);
      const plan = planBuild(before, before.players[1]!, kind, tile);
      const after = restoreSnapshot(g.map, snap);
      const n = after.buildings.size;
      after.step([cmd(1, { t: 'build', kind, tile })]);
      const errors = after.events.filter((e) => e.k === 'notify' && e.key.startsWith('error.build.'));
      if (plan.error !== 'ok') {
        expect(after.buildings.size, `${kind}@${tile}`).toBe(n);
        expect(errors.length, `${kind}@${tile} ${plan.error}`).toBe(1);
      } else if (plan.building) {
        expect(after.buildings.get(plan.building.id)!.upgradeLeft).toBeGreaterThan(0);
      } else {
        expect(after.buildingAt[plan.tile], `${kind}@${tile}`).toBeGreaterThanOrEqual(0);
        expect(after.buildings.size).toBe(n + 1);
      }
      checked++;
    }
    expect(checked).toBe(120);
    expect(g.players[1]!.levelsBuilt[B.City]).toBe(1);
  });
});

describe('build cursor: the label', () => {
  const tr = (k: string, p?: Record<string, string | number>) => (p ? `${k}${JSON.stringify(p)}` : k);
  const money = (v: number) => `${v}g`;
  const base = { error: 'ok', cost: 125_000, missing: 0, upgrade: false, level: 1, tech: '', snapped: false };
  it('words what the click would do, and why not', () => {
    expect(placementText(base, tr, money)).toEqual({ text: 'place.build{"cost":"125000g"}', ok: true });
    expect(placementText({ ...base, snapped: true }, tr, money).text).toMatch(/^place\.snapped/);
    expect(placementText({ ...base, upgrade: true, level: 3 }, tr, money).text).toBe(
      'place.upgrade{"level":3,"cost":"125000g"}',
    );
    expect(placementText({ ...base, error: 'tooClose' }, tr, money)).toEqual({
      text: 'place.tooClose',
      ok: false,
    });
    expect(placementText({ ...base, error: 'gold', missing: 4000 }, tr, money).text).toBe(
      'place.gold{"gold":"4000g"}',
    );
    expect(placementText({ ...base, error: 'locked', tech: 'tech.nuclear.2' }, tr, money).text).toBe(
      'place.locked{"tech":"tech.nuclear.2.name"}',
    );
  });
});
