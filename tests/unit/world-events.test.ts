// World events (GAME_DESIGN.md §12): more variety, not more often. Sixteen events, each with
// one clear effect; the picker never repeats the last one and shows every event before any
// comes back; the 4–6 minute rhythm is unchanged; everything is deterministic and saved.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import { A, B, EVENT_MAX, EVENT_MIN, min, sec } from '../../src/core/game/constants';
import { Resource, T } from '../../src/core/map/terrain';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { inService } from '../../src/core/buildings/building';
import { launchAircraft } from '../../src/core/units/air';
import { buildWarship } from '../../src/core/units/ships';
import { Attack, attackLogic } from '../../src/core/rules/combat';
import { updateFeatures } from '../../src/core/rules/features';
import { updateEconomy } from '../../src/core/game/economy';
import { recountResources } from '../../src/core/rules/resources';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import {
  ARMS_RACE_SPEED,
  BREAKTHROUGH_MULT,
  GAMES_GOODWILL,
  MUTINY_CAP,
  OIL_SHOCK_MULT,
  PUBLIC_WORKS_SPEED,
  WINTER_SLOWDOWN,
  WORLD_EVENTS,
  WORLD_EVENT_TICKS,
  ashBlocks,
  endWorldEvent,
  eventEligible,
  eventOn,
  pickWorldEvent,
  quakeRadius,
  researchMult,
  startWorldEvent,
  trainPayMult,
  type WorldEventId,
} from '../../src/core/rules/worldEvents';
import { activeEvent, ashOnRoute, attackCapOf, EVENT_ICON, portsBlock } from '../../src/ui/hud/worldEvents';
import { ICONS } from '../../src/ui/icons/icons';
import fr from '../../src/ui/i18n/fr.json';
import en from '../../src/ui/i18n/en.json';

// Plains in the west, cold land (tundra, mountains) in the east, a sea in the south.
const ROWS = [
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '..........................tttttttMMMMMMM',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];
const SCALE = 4;

/** Seven countries in vertical strips (player 7 is a nation), rich, every feature on. */
function world(seed = 777): Game {
  const map = asciiMap(ROWS, SCALE);
  map.meta.deposits = [{ x: 10, y: 10, type: Resource.Oil }];
  const g = testGame(map, 7, {
    seed,
    victoryThreshold: 101,
    features: { events: true, tech: true, air: true, radar: true, resources: true } as never,
  });
  const w = map.width;
  startWith(
    g,
    Array.from({ length: 7 }, (_, k) => [Math.round(((k + 0.5) * w) / 7), 12] as [number, number]),
  );
  for (let i = 0; i < map.size; i++)
    if (map.isLand(i)) g.setOwner(i, 1 + Math.min(6, Math.floor(((i % w) * 7) / w)));
  g.players[7]!.kind = 'nation';
  for (const p of g.players) if (p) p.gold = 100_000_000;
  return g;
}

const owned = (g: Game, owner: number) => {
  const w = g.map.width;
  return [Math.round(((owner - 0.5) * w) / 7), 12] as const;
};
const at = (g: Game, x: number, y: number) => g.map.idx(x, y);

/** Picks and starts `n` events in a row (as the 4–6 minute clock would), returns their ids. */
function sequence(g: Game, n: number): WorldEventId[] {
  const out: WorldEventId[] = [];
  let rel = Math.max(0, ...Object.values(g.features.eventSeen));
  for (let k = 0; k < n; k++) {
    const id = pickWorldEvent(g);
    rel += EVENT_MIN;
    startWorldEvent(g, id, rel);
    endWorldEvent(g);
    out.push(id);
  }
  return out;
}

describe('world events: the list', () => {
  it('sixteen events, each with a duration, a glyph, a headline, a deck and its effect in both languages', () => {
    expect(WORLD_EVENTS.length).toBe(16);
    for (const id of WORLD_EVENTS) {
      expect(WORLD_EVENT_TICKS[id]).toBeGreaterThanOrEqual(sec(60));
      expect(WORLD_EVENT_TICKS[id]).toBeLessThanOrEqual(min(2));
      expect(ICONS[EVENT_ICON[id]]).toBeTruthy();
      for (const dict of [fr.worldEvent, en.worldEvent] as Record<string, string>[])
        for (const k of ['', '.short', '.title', '.desc', '.fx']) expect(dict[`${id}${k}`]).toBeTruthy();
    }
    // Distinct glyphs: an event is recognised by its shape, not only by its words.
    expect(new Set(Object.values(EVENT_ICON)).size).toBe(WORLD_EVENTS.length);
  });

  it('every event fits a full game; an event needs what it acts on', () => {
    const g = world();
    for (const id of WORLD_EVENTS) expect(eventEligible(g, id), id).toBe(true);
    const bare = testGame(asciiMap(['........'], 4), 2, {
      allowPorts: false,
      allowFactories: false,
      allowNukes: false,
      features: { air: false, radar: false, tech: false, resources: false } as never,
    });
    for (const id of [
      'hurricane',
      'railStrike',
      'armsRace',
      'volcano',
      'solarStorm',
      'breakthrough',
      'oilShock',
      'harshWinter',
      'worldGames',
      'boom',
    ] as const)
      expect(eventEligible(bare, id), id).toBe(false);
    // Whatever the rules, the picker always finds one.
    expect(WORLD_EVENTS).toContain(pickWorldEvent(bare));
  });
});

describe('world events: the picker', () => {
  it('never the same twice in a row, and every event once before any comes back', () => {
    const g = world();
    const seq = sequence(g, 16);
    expect(new Set(seq).size).toBe(16);
    const long = [...seq, ...sequence(g, 300)];
    for (let k = 1; k < long.length; k++) expect(long[k]).not.toBe(long[k - 1]);
    // Over a long run every event keeps coming, none twice within five events.
    const counts = new Map<string, number>();
    for (const id of long) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const id of WORLD_EVENTS) expect(counts.get(id) ?? 0).toBeGreaterThanOrEqual(10);
    for (let k = 16; k < long.length; k++) expect(long.slice(k - 5, k)).not.toContain(long[k]);
  });

  it('is deterministic: same seed, same events', () => {
    expect(sequence(world(5), 40)).toEqual(sequence(world(5), 40));
    expect(sequence(world(5), 40)).not.toEqual(sequence(world(6), 40));
  });

  it('keeps the rhythm: one event every 4 to 6 minutes, each over before the next', () => {
    const g = world();
    g.config.features.council = false;
    const starts: number[] = [];
    const start = g.startTick;
    for (let k = 0; k < min(90); k++) {
      updateFeatures(g);
      for (const e of g.events) if (e.k === 'worldEvent') starts.push(g.tick);
      g.events.length = 0;
      g.tick++;
    }
    expect(starts[0]! - start).toBe(EVENT_MIN);
    for (let k = 1; k < starts.length; k++) {
      expect(starts[k]! - starts[k - 1]!).toBeGreaterThanOrEqual(EVENT_MIN);
      expect(starts[k]! - starts[k - 1]!).toBeLessThanOrEqual(EVENT_MAX);
    }
    expect(starts.length).toBeGreaterThanOrEqual(15);
    expect(g.features.lastEvent).not.toBe('');
  });

  it('the hash and the save carry the event under way and the picker’s memory', () => {
    const g = world();
    sequence(g, 3);
    startWorldEvent(g, 'volcano', 4 * EVENT_MIN);
    const h = hashGame(g);
    const back = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(hashGame(back)).toBe(h);
    expect(back.features.event).toEqual(g.features.event);
    expect(back.features.eventSeen).toEqual(g.features.eventSeen);
    expect(back.features.lastEvent).toBe('volcano');
    expect(pickWorldEvent(back)).toBe(pickWorldEvent(g));
    g.features.eventSeen.crisis = 12345;
    expect(hashGame(g)).not.toBe(h);
  });
});

describe('world events: the effects', () => {
  it('earthquake: every building near the epicentre is out of service while it lasts', () => {
    const g = world();
    const [x, y] = owned(g, 1);
    const near = placeBuilding(g, g.players[1]!, B.City, at(g, x, y), true)!;
    near.buildLeft = 0;
    const r = quakeRadius(g.map.width, g.map.height);
    startWorldEvent(g, 'earthquake', EVENT_MIN);
    const ev = g.features.event!;
    expect(ev.r).toBe(r);
    expect(Math.hypot(ev.x! - x - 0.5, ev.y! - y - 0.5)).toBeLessThan(1);
    expect(inService(near)).toBe(false);
    expect(near.occupiedLeft).toBe(WORLD_EVENT_TICKS.earthquake);
    const notes = g.events.filter((e) => e.k === 'notify' && e.key === 'notify.quakeHit');
    expect(notes.map((e) => (e as { to: number }).to)).toEqual([1]);
  });

  it('volcano: no flight from, to or across the ash cloud; elsewhere planes fly', () => {
    const g = world();
    g.config.features.tech = false; // (no Aerospace research needed here)
    const p = g.players[1]!;
    const [x, y] = owned(g, 1);
    const field = placeBuilding(g, p, B.Airfield, at(g, x, y), true)!;
    field.buildLeft = 0;
    g.features.event = { id: 'volcano', until: g.tick + 100, x: x + 30, y: 12, r: 6 };
    expect(ashBlocks(g, x, y, x + 60, 12)).toBe(true);
    expect(ashBlocks(g, x, y, x, 30)).toBe(false);
    const gold = p.gold;
    expect(launchAircraft(g, p, A.Recon, at(g, x + 60, 12))).toBe(false);
    expect(p.gold).toBe(gold);
    expect(launchAircraft(g, p, A.Recon, at(g, x + 2, 28))).toBe(true);
    // The HUD reads the same cloud (the aiming verdict).
    const view = { event: g.features.event } as never;
    expect(ashOnRoute(view, g.tick, x, y, x + 60, 12)).toBe(true);
    expect(activeEvent(view, g.tick)?.id).toBe('volcano');
  });

  it('hurricane: no warship is launched while the ports are closed', () => {
    const g = world();
    const p = g.players[3]!;
    const [x] = owned(g, 3);
    const port = placeBuilding(g, p, B.Port, at(g, x, 31), true);
    expect(port).toBeTruthy();
    port!.buildLeft = 0;
    startWorldEvent(g, 'hurricane', EVENT_MIN);
    expect(buildWarship(g, p, at(g, x, 34))).toBe(false);
    expect(portsBlock({ event: g.features.event } as never, g.tick)?.id).toBe('hurricane');
    g.tick = g.features.event!.until;
    expect(buildWarship(g, p, at(g, x, 34))).toBe(true);
  });

  it('harsh winter: cold land takes 50 % longer to conquer, plains are unchanged', () => {
    const g = world();
    const a = new Attack(1, 3, 4, 50_000, g.tick);
    const tundra = at(g, 27 * SCALE + 1, 4);
    const plains = at(g, 4, 4);
    expect(g.map.terrain[tundra]).toBe(T.Tundra);
    const before = [attackLogic(g, a, tundra, 10).tickFraction, attackLogic(g, a, plains, 10).tickFraction];
    startWorldEvent(g, 'harshWinter', EVENT_MIN);
    expect(attackLogic(g, a, tundra, 10).tickFraction).toBeCloseTo(before[0]! * WINTER_SLOWDOWN, 6);
    expect(attackLogic(g, a, plains, 10).tickFraction).toBeCloseTo(before[1]!, 6);
  });

  it('oil shock: oil deposits pay double', () => {
    const g = world();
    recountResources(g);
    const p = g.players[g.owner[at(g, 10, 10)]!]!;
    updateEconomy(g);
    const base = p.incomeBreakdown.resources;
    expect(base).toBeGreaterThan(0);
    startWorldEvent(g, 'oilShock', EVENT_MIN);
    updateEconomy(g);
    expect(p.incomeBreakdown.resources).toBeCloseTo(base * OIL_SHOCK_MULT, -1);
  });

  it('mutinies: an order commits at most a quarter of the army, the rest stays home', () => {
    const g = world();
    const p = g.players[1]!;
    p.troops = 100_000;
    startWorldEvent(g, 'mutiny', EVENT_MIN);
    expect(attackCapOf({ event: g.features.event } as never, g.tick)).toBe(MUTINY_CAP);
    g.step([cmd(1, { t: 'attack', tile: at(g, owned(g, 2)[0], 12), ratio: 1 })]);
    const a = g.attacks.find((x) => x.attacker === 1 && !x.done)!;
    expect(a).toBeTruthy();
    expect(a.troops).toBeLessThanOrEqual(100_000 * MUTINY_CAP + 1);
    expect(p.troops).toBeGreaterThan(100_000 * (1 - MUTINY_CAP) - 2_000);
  });

  it('arms race: silos are built twice as fast, cities as usual', () => {
    const g = world();
    const p = g.players[2]!;
    const [x, y] = owned(g, 2);
    const silo = placeBuilding(g, p, B.Silo, at(g, x, y), true)!;
    const city = placeBuilding(g, p, B.City, at(g, x, y + 12), true)!;
    silo.buildLeft = city.buildLeft = 100;
    startWorldEvent(g, 'armsRace', EVENT_MIN);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(silo.buildLeft).toBe(100 - 10 * ARMS_RACE_SPEED);
    expect(city.buildLeft).toBe(90);
  });

  it('rail strike and breakthrough: trains earn nothing, research runs faster', () => {
    const g = world();
    expect(trainPayMult(g)).toBe(1);
    startWorldEvent(g, 'railStrike', EVENT_MIN);
    expect(trainPayMult(g)).toBe(0);
    endWorldEvent(g);
    startWorldEvent(g, 'breakthrough', 2 * EVENT_MIN);
    expect(researchMult(g)).toBe(BREAKTHROUGH_MULT);
    expect(eventOn(g, 'breakthrough')).toBe(true);
  });

  it('public works: cities, ports and factories are built twice as fast, silos as usual', () => {
    const g = world();
    const p = g.players[2]!;
    const [x, y] = owned(g, 2);
    const city = placeBuilding(g, p, B.City, at(g, x, y), true)!;
    const silo = placeBuilding(g, p, B.Silo, at(g, x, y + 12), true)!;
    city.buildLeft = silo.buildLeft = 100;
    startWorldEvent(g, 'publicWorks', EVENT_MIN);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(city.buildLeft).toBe(100 - 10 * PUBLIC_WORKS_SPEED);
    expect(silo.buildLeft).toBe(90);
  });

  it('World Games: every nation thinks better of every country, and it holds while they last', () => {
    const g = world();
    const nation = g.players[7]!;
    startWorldEvent(g, 'worldGames', EVENT_MIN);
    expect(nation.relation(1)).toBe(GAMES_GOODWILL);
    expect(nation.relationCauses.get(1)?.games).toBe(GAMES_GOODWILL);
    for (let k = 0; k < sec(60); k++) g.step([]);
    expect(nation.relation(1)).toBeGreaterThan(GAMES_GOODWILL * 0.9);
  });
});
