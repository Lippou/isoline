// Bombers against ships (1.16, GAME_DESIGN.md §11): aimed at sea, a bomber follows the hostile
// ship nearest the aim and its bombs hit every hostile ship around the drop; SAMs and
// fighters stop it as on land; a truce refuses it with its real reason.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, invariants, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import type { GameEvent } from '../../src/core/game/events';
import { A, B, BOMBER_SHIP_DAMAGE, TRANSPORT_HP, WARSHIP_HP, sec } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { U, makeUnit, type Unit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';
import { bomberAim, planAircraft } from '../../src/core/units/air';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** Two countries face to face (player 1 west of x = 60), a sea strip along the north. */
function duel(): Game {
  const g = testGame(asciiMap(FIELD, 6), 2, { victoryThreshold: 101 });
  startWith(g, [
    [20, 24],
    [100, 24],
  ]);
  for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i)) g.setOwner(i, i % g.map.width < 60 ? 1 : 2);
  g.players[1]!.gold = g.players[2]!.gold = 100_000_000;
  placeBuilding(g, g.players[1]!, B.Airfield, g.map.idx(25, 20), true);
  return g;
}

/** A ship of `owner` at (x, y), sailing east along the strip. */
function ship(g: Game, type: U, owner: number, x: number, y: number): Unit {
  const u = makeUnit(g.nextId(), type, owner, x + 0.5, y + 0.5);
  u.hp = u.maxHp = type === U.Warship ? WARSHIP_HP : TRANSPORT_HP;
  u.path = [g.map.idx(x + 60, y)];
  u.pathIdx = 0;
  if (type === U.Transport) {
    u.troops = 20_000;
    u.target = g.map.idx(x + 60, y + 2);
  } else u.patrol = g.map.idx(x, y);
  return addUnit(g, u);
}

function flyOut(g: Game, max = 400): GameEvent[] {
  const events: GameEvent[] = [];
  for (let k = 0; k < max; k++) {
    g.step([]);
    events.push(...g.events);
    if (!g.units.some((u) => u.alive && u.type >= U.Fighter && u.type <= U.Recon)) break;
  }
  return events;
}
const strikes = (ev: GameEvent[]) =>
  ev.filter((e) => e.k === 'airStrike') as Extract<GameEvent, { k: 'airStrike' }>[];
const notices = (ev: GameEvent[], to: number) =>
  ev.filter((e) => e.k === 'notify' && e.to === to) as Extract<GameEvent, { k: 'notify' }>[];

describe('bombers against ships', () => {
  it('aimed at sea, lock on the hostile ship and follow it; on land, the building comes first', () => {
    const g = duel();
    const p1 = g.players[1]!;
    const boat = ship(g, U.Transport, 2, 80, 4);
    const aim = bomberAim(g, p1, g.map.idx(82, 4))!;
    expect(aim.ship?.id).toBe(boat.id);
    const city = placeBuilding(g, g.players[2]!, B.City, g.map.idx(84, 16), true)!;
    // Aimed on land near the city: the city.
    expect(bomberAim(g, p1, g.map.idx(84, 14))!.building?.id).toBe(city.id);
    // Our own ships are never a target.
    ship(g, U.Warship, 1, 30, 4);
    expect(bomberAim(g, p1, g.map.idx(30, 4))).toBeNull();
  });

  it('sink a transport (its troops with it) and a trade ship; a warship loses 60 % and a second bomber sinks it', () => {
    const g = duel();
    const boat = ship(g, U.Transport, 2, 80, 4);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: g.map.idx(81, 4) })]);
    const bomber = g.units.find((u) => u.alive && u.type === U.Bomber)!;
    expect(bomber.patrol).toBe(boat.id);
    const ev = flyOut(g);
    expect(boat.alive).toBe(false);
    expect(ev.some((e) => e.k === 'shipSunk' && e.owner === 2 && e.by === 1)).toBe(true);
    expect(strikes(ev)).toMatchObject([
      { owner: 1, victim: 2, type: -1, ship: U.Transport, destroyed: true },
    ]);
    expect(notices(ev, 2).map((e) => e.key)).toContain('notify.raidShipSunk');
    expect(g.players[2]!.relation(1)).toBeLessThan(0);

    const ws = ship(g, U.Warship, 2, 90, 3);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: g.map.idx(90, 3) })]);
    flyOut(g);
    expect(ws.alive).toBe(true);
    expect(ws.hp).toBeCloseTo(WARSHIP_HP - BOMBER_SHIP_DAMAGE, 0);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: g.map.idx(Math.floor(ws.x), Math.floor(ws.y)) })]);
    flyOut(g);
    expect(ws.alive).toBe(false);
    expect(invariants(g)).toEqual([]);
  });

  it('are shot down by a SAM on the way, as over land', () => {
    const g = duel();
    const sam = placeBuilding(g, g.players[2]!, B.Sam, g.map.idx(70, 14), true)!;
    sam.buildLeft = 0;
    const boat = ship(g, U.Transport, 2, 80, 4);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: g.map.idx(80, 4) })]);
    const ev = flyOut(g);
    expect(ev.some((e) => e.k === 'planeDown' && e.cause === 'sam')).toBe(true);
    expect(boat.alive).toBe(true);
  });

  it('a peace summit refuses the raid with its reason and time left, before any gold talk', () => {
    const g = duel();
    ship(g, U.Transport, 2, 80, 4);
    const until = g.tick + sec(42);
    g.features.event = { id: 'peaceSummit', until };
    g.features.ceasefireUntil = until;
    const p1 = g.players[1]!;
    p1.gold = 0; // broke too: the summit is still the reason given
    expect(planAircraft(g, p1, A.Bomber, g.map.idx(80, 4)).error).toBe('summit');
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: g.map.idx(80, 4) })]);
    const n = notices(g.events, 1);
    expect(n.map((e) => e.key)).toEqual(['error.refused.summit']);
    expect(n[0]!.params).toMatchObject({ act: 'bomber' });
    expect(n[0]!.params!.left).toBeGreaterThan(sec(40));
    expect(g.units.some((u) => u.type === U.Bomber)).toBe(false);
  });
});
