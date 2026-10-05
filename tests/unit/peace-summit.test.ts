// The peace summit (world event, GAME_DESIGN.md §12): a forced 60-second truce between all
// countries. Nobody launches a nuclear weapon while it lasts (players and nations alike, at a
// country or a tribe), and the truce holds for sabotage and fighters too.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import type { GameEvent } from '../../src/core/game/events';
import { B, N, sec } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { maxLaunchable, nuclearHalt } from '../../src/core/units/nukes';
import { tryNuke, type ArsenalMem } from '../../src/core/npc/arsenal';
import { sabotageNear } from '../../src/core/units/trains';
import { U, makeUnit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';

const PLAIN = Array.from({ length: 12 }, () => '.'.repeat(40));

/** Player 1 west, player 2 east, player 3 (a tribe) in a pocket of the east; 1 and 2 hold silos and gold. */
function world(): Game {
  const g = testGame(asciiMap(PLAIN, 4), 3, { difficulty: 'hard' });
  startWith(g, [
    [20, 24],
    [140, 24],
    [100, 10],
  ]);
  for (let i = 0; i < g.map.size; i++) {
    const x = i % g.map.width;
    const y = (i / g.map.width) | 0;
    g.setOwner(i, x < 80 ? 1 : x < 110 && y < 16 ? 3 : 2);
  }
  g.players[3]!.kind = 'tribe';
  for (const [id, x] of [
    [1, 20],
    [2, 150],
  ] as const) {
    const p = g.players[id]!;
    p.gold = 100_000_000;
    const silo = placeBuilding(g, p, B.Silo, g.map.idx(x, 40), true)!;
    silo.buildLeft = 0;
  }
  g.players[2]!.personality = 'warmonger';
  return g;
}

function summit(g: Game, ticks = sec(60)): void {
  const until = g.tick + ticks;
  g.features.event = { id: 'peaceSummit', until };
  g.features.ceasefireUntil = until;
}

const missiles = (g: Game) => g.units.filter((u) => u.alive && u.type === U.Nuke);
const notices = (g: Game, to: number) =>
  g.events.filter((e) => e.k === 'notify' && e.to === to).map((e) => (e as { key: string }).key);

describe('peace summit', () => {
  it('stops every silo: no bomb of any kind, at a country or a tribe, and no gold spent', () => {
    const g = world();
    const p = g.players[1]!;
    expect(maxLaunchable(g, p, N.Atom)).toBeGreaterThan(0);
    summit(g);
    expect(nuclearHalt(g)).toBe('peaceSummit');
    for (const kind of [N.Atom, N.Hydrogen, N.Mirv]) expect(maxLaunchable(g, p, kind)).toBe(0);
    const gold = p.gold;
    for (const [kind, x, y] of [
      [N.Atom, 140, 30], // a country
      [N.Hydrogen, 140, 30],
      [N.Mirv, 140, 30],
      [N.Atom, 100, 8], // a tribe: still attackable on land, but not with a bomb
    ] as const) {
      g.step([cmd(1, { t: 'nuke', kind, tile: g.map.idx(x, y), count: 1 })]);
      expect(missiles(g)).toHaveLength(0);
      expect(notices(g, 1)).toContain('error.nukeHalt.peaceSummit');
    }
    expect(p.gold).toBeGreaterThanOrEqual(gold);
    expect(g.features.mirvLaunches).toBe(0);
  });

  it('missiles fly again once the summit is over', () => {
    const g = world();
    summit(g, 5);
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    expect(missiles(g)).toHaveLength(0);
    for (let k = 0; k < 6; k++) g.step([]);
    expect(nuclearHalt(g)).toBeNull();
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    expect(missiles(g)).toHaveLength(1);
  });

  it('the Council ban is reported as such', () => {
    const g = world();
    g.features.nukeBanUntil = g.tick + 100;
    expect(nuclearHalt(g)).toBe('nukeBan');
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    expect(notices(g, 1)).toContain('error.nukeHalt.nukeBan');
  });

  it('nations hold their fire: no launch, no gold spent, a pending strike keeps waiting', () => {
    const g = world();
    const p2 = g.players[2]!;
    g.ai.nukedBy.set(2, 1); // revenge: the strongest reason to fire
    const m: ArsenalMem = { lastNuke: -10_000, grudge: new Map([[1, 50]]), airCredit: 0, airEarned: 0 };
    summit(g);
    const gold = p2.gold;
    for (let k = 0; k < 30; k++) {
      tryNuke(g, p2, m, { nukes: 2, leader: 1, runnerUp: 2, reserve: 0 });
      g.step([]);
    }
    expect(missiles(g)).toHaveLength(0);
    expect(p2.gold).toBeGreaterThanOrEqual(gold);
    expect(m.lastNuke).toBe(-10_000);
    // The same nation fires as soon as the summit closes.
    g.features.event = null;
    g.features.ceasefireUntil = -1;
    tryNuke(g, p2, m, { nukes: 2, leader: 1, runnerUp: 2, reserve: 0 });
    expect(g.units.some((u) => u.type === U.Nuke && u.owner === 2)).toBe(true);
  });

  it('a strike waiting for its reconnaissance is not spent during the summit', () => {
    const g = world();
    const p2 = g.players[2]!;
    const target = g.map.idx(40, 24);
    const m: ArsenalMem = {
      lastNuke: 0,
      grudge: new Map(),
      airCredit: 0,
      airEarned: 0,
      strike: [target, N.Atom, g.tick + 10],
    };
    summit(g);
    tryNuke(g, p2, m, { nukes: 1, leader: 1, runnerUp: 2, reserve: 0 });
    expect(m.strike).toBeDefined();
    expect(missiles(g)).toHaveLength(0);
  });

  it('no sabotage between countries during the truce; tribes stay fair game', () => {
    const g = world();
    const train = makeUnit(g.nextId(), U.Train, 2, 120.5, 30.5);
    addUnit(g, train);
    summit(g);
    expect(sabotageNear(g, 1, g.map.idx(120, 30))).toBe(false);
    expect(train.alive).toBe(true);
    const tribal = makeUnit(g.nextId(), U.Train, 3, 100.5, 8.5);
    addUnit(g, tribal);
    expect(sabotageNear(g, 1, g.map.idx(100, 8))).toBe(true);
    expect(tribal.alive).toBe(false);
    g.features.ceasefireUntil = -1;
    expect(sabotageNear(g, 1, g.map.idx(120, 30))).toBe(true);
  });

  it('the truce covers countries, never tribes', () => {
    const g = world();
    summit(g);
    expect(g.inTruce(1, 2)).toBe(true);
    expect(g.inTruce(1, 3)).toBe(false);
    expect(g.attackAllowed(1, 2, true)).toBe(false);
    expect(g.attackAllowed(1, 3, true)).toBe(true);
  });
});

/** The notices sent to `to` this tick, with their parameters. */
const said = (g: Game, to: number) =>
  g.events.filter((e) => e.k === 'notify' && e.to === to) as Extract<GameEvent, { k: 'notify' }>[];

describe('refusals name their real reason (1.16)', () => {
  it('an attack or a landing during the summit names the summit and its time left', () => {
    const g = world();
    g.players[1]!.troops = 100_000;
    summit(g, sec(42));
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(81, 24), ratio: 0.2 })]);
    const n = said(g, 1);
    expect(n.map((e) => e.key)).toEqual(['error.refused.summit']);
    expect(n[0]!.params).toMatchObject({ act: 'attack' });
    expect(n[0]!.params!.left).toBeGreaterThan(sec(40));
    expect(g.attacks).toHaveLength(0);
    // The tribe is not covered: that attack goes.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(100, 8), ratio: 0.1 })]);
    expect(said(g, 1)).toHaveLength(0);
  });

  it("the Council's ceasefire is named as such", () => {
    const g = world();
    g.players[1]!.troops = 100_000;
    g.features.ceasefireUntil = g.tick + sec(30);
    expect(g.truce()).toEqual({ reason: 'ceasefire', until: g.features.ceasefireUntil });
    expect(g.attackRefusal(1, 2, true)).toBe('ceasefire');
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(81, 24), ratio: 0.2 })]);
    expect(said(g, 1)[0]!.key).toBe('error.refused.ceasefire');
    // A summit over it: the summit names it.
    summit(g, sec(60));
    expect(g.truce()!.reason).toBe('summit');
    expect(g.attackRefusal(1, 2, true)).toBe('summit');
  });

  it('an immunity and a teammate are named too', () => {
    const g = world();
    g.players[2]!.immuneUntil = g.tick + 100;
    expect(g.attackRefusal(1, 2, true)).toBe('immune');
    g.players[1]!.team = g.players[2]!.team = 1;
    expect(g.attackRefusal(1, 2, true)).toBe('team');
  });

  it('a nuclear halt and the silo itself say why: summit time left, no silo, reloading, gold', () => {
    const g = world();
    summit(g, sec(20));
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    const halt = said(g, 1)[0]!;
    expect(halt.key).toBe('error.nukeHalt.peaceSummit');
    expect(halt.params!.left).toBeGreaterThan(sec(18));
    g.features.event = null;
    g.features.ceasefireUntil = -1;
    const p1 = g.players[1]!;
    p1.gold = 0;
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    expect(said(g, 1)[0]!.key).toBe('error.nukeWhy.gold');
    p1.gold = 1e8;
    for (const b of g.buildings.values()) if (b.owner === 1 && b.type === B.Silo) b.tubes[0] = 50;
    g.step([cmd(1, { t: 'nuke', kind: N.Atom, tile: g.map.idx(140, 30), count: 1 })]);
    expect(said(g, 1)[0]!.key).toBe('error.nukeWhy.reloading');
  });

  it('a sabotage during the summit names the truce; with nothing around, says so', () => {
    const g = testGame(asciiMap(PLAIN, 4), 3, { difficulty: 'hard', features: { generals: true } as never });
    startWith(g, [
      [20, 24],
      [140, 24],
      [100, 10],
    ]);
    const p1 = g.players[1]!;
    p1.general = 'sabotage';
    p1.generalReadyTick = 0;
    g.step([cmd(1, { t: 'general', tile: g.map.idx(120, 30) })]);
    expect(said(g, 1)[0]!.key).toBe('error.generalWhy.noTarget');
    addUnit(g, makeUnit(g.nextId(), U.Train, 2, 120.5, 30.5));
    summit(g);
    g.step([cmd(1, { t: 'general', tile: g.map.idx(120, 30) })]);
    const n = said(g, 1)[0]!;
    expect(n.key).toBe('error.refused.summit');
    expect(n.params).toMatchObject({ act: 'sabotage' });
  });

  it('a warship order says which: no port, out of reach, or the gold', () => {
    const g = world();
    g.step([cmd(1, { t: 'warship', tile: g.map.idx(20, 46) })]);
    expect(said(g, 1)[0]!.key).toBe('error.warshipWhy.noPort');
  });
});
