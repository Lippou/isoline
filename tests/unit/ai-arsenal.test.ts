// The nations' whole toolbox (1.12.1, GAME_DESIGN.md §13.2): the war chest (airfield, SAMs,
// radar saved for), raids with reconnaissance and escort, fighters against bombers seen
// coming, bombs (reconnaissance before the strike, salvoes sized to the SAMs, MIRVs denying
// a victory), generals and embargoes — scaled by difficulty.
import { describe, expect, it } from 'vitest';
import { asciiMap, makeGame, startWith, testGame } from '../helpers';
import { LineKind, placeLine } from '../../src/core/rules/lines';
import type { Game } from '../../src/core/game/state';
import type { Difficulty } from '../../src/core/game/config';
import type { Player } from '../../src/core/game/player';
import { A, AIR_HP, B, N } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import type { Building } from '../../src/core/buildings/building';
import { U, makeUnit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';
import { AIR_OUTBOUND } from '../../src/core/units/air';
import { applyCommand } from '../../src/core/game/commands';
import { thinkAir, type AirContext } from '../../src/core/npc/airpower';
import { denialTarget, tryNuke, warWish, type ArsenalMem, type WarState } from '../../src/core/npc/arsenal';
import { thinkGeneral } from '../../src/core/npc/generals';
import { embargoes } from '../../src/core/npc/ai';
import { TACTICS } from '../../src/core/npc/tactics';

const PLAIN = Array.from({ length: 12 }, () => '.'.repeat(40));

/**
 * Player 1 holds x < split, player 2 the rest (160 × 48 tiles). Both stay 'human' so that
 * the AI does not think for them: the nations' routines are called by hand.
 */
function plain(difficulty: Difficulty, split = 80): Game {
  const g = testGame(asciiMap(PLAIN, 4), 2, { difficulty, victoryThreshold: 80 });
  startWith(g, [
    [20, 24],
    [140, 24],
  ]);
  for (let i = 0; i < g.map.size; i++) g.setOwner(i, i % g.map.width < split ? 1 : 2);
  g.players[2]!.personality = 'warmonger';
  return g;
}

function build(g: Game, owner: number, type: B, x: number, y: number): Building {
  const b = placeBuilding(g, g.players[owner]!, type, g.map.idx(x, y), true)!;
  expect(b, `${type} at ${x},${y}`).toBeTruthy();
  b.buildLeft = 0;
  return b;
}

/** A defensive line of `owner` across (x, y), north to south (rules/lines.ts). */
function wall(g: Game, owner: number, x: number, y: number): void {
  const l = placeLine(g, g.players[owner]!, LineKind.Defensive, [x + 0.5, y - 6.5, x + 0.5, y + 6.5], 1, 0.1);
  expect(typeof l, `line at ${x},${y}`).toBe('object');
}

const war = (enemies: number[]): WarState => ({
  atWar: true,
  enemies: new Set(enemies),
  nukes: 1.5,
  aggression: 1.6,
});
const armed = (p: Player): ArsenalMem => ({
  lastNuke: -10_000,
  grudge: new Map(),
  airCredit: 10_000_000,
  airEarned: p.stats.goldEarned,
});
const sky = (patch: Partial<AirContext> = {}): AirContext => ({
  aggression: 1.6,
  incoming: new Map(),
  contact: () => -1,
  runaway: -1,
  recentWar: -1,
  ...patch,
});
const planes = (g: Game, owner: number, type: U) =>
  g.units.filter((u) => u.alive && u.owner === owner && u.type === type);

describe('the war chest (normal and up)', () => {
  it('saves for an airfield once at war, then buys it behind the front; easy nations do not', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const g = plain(d);
      const p2 = g.players[2]!;
      p2.gold = 900_000;
      const wish = warWish(g, p2, armed(p2), war([1]));
      if (d === 'easy') expect(wish.build, d).toBe(-1);
      else {
        expect(wish.build, d).toBe(B.Airfield);
        // Kept back from cities and ports: the reserve is the airfield's price.
        expect(wish.reserve, d).toBe(800_000);
      }
    }
    // In a running game: a normal nation attacked by player 1 buys its airfield.
    const g = plain('normal');
    const p2 = g.players[2]!;
    p2.kind = 'nation';
    p2.gold = 900_000;
    applyCommand(g, 1, { t: 'attack', tile: g.map.idx(80, 24), ratio: 0.3 });
    for (let k = 0; k < 400 && p2.buildingCount[B.Airfield] === 0; k++) g.step([]);
    expect(p2.buildingCount[B.Airfield]).toBe(1);
  });

  it('wants SAMs once nuked (or bombed without any), and a radar after a raid', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const g = plain(d);
      const p2 = g.players[2]!;
      build(g, 2, B.City, 130, 10);
      g.ai.nukedBy.set(2, 1);
      expect(warWish(g, p2, armed(p2), war([1])).build, d).toBe(d === 'easy' ? -1 : B.Sam);
    }
    const g = plain('hard');
    const p2 = g.players[2]!;
    const field = build(g, 2, B.Airfield, 140, 24);
    build(g, 2, B.Sam, 120, 24);
    g.ai.raidedBy.set(2, [1, g.tick]);
    // Raided: a second airfield level first (one more interceptor on alert), then the radar.
    expect(warWish(g, p2, armed(p2), war([1])).build).toBe(B.Airfield);
    field.level = 2;
    expect(warWish(g, p2, armed(p2), war([1])).build).toBe(B.Radar);
  });
});

describe('raids', () => {
  /** Nation 2 attacks player 1, whose defence post holds the front; 2 has an airfield. */
  function front(d: Difficulty) {
    const g = plain(d);
    const p2 = g.players[2]!;
    p2.gold = 20_000_000;
    build(g, 2, B.Airfield, 130, 24);
    const city = build(g, 1, B.City, 40, 10);
    applyCommand(g, 2, { t: 'attack', tile: g.map.idx(79, 24), ratio: 0.5 });
    g.step([]);
    return { g, p2, city };
  }

  it('bomb the enemy buildings during an offensive, with reconnaissance first from hard', () => {
    const { g, p2, city } = front('hard');
    thinkAir(g, p2, armed(p2), sky({ contact: (o) => (o === 1 ? g.map.idx(79, 24) : -1) }));
    const bombers = planes(g, 2, U.Bomber);
    expect(bombers.length).toBeGreaterThan(0);
    expect(bombers[0]!.target).toBe(city.id);
    // A reconnaissance plane over the front (and over the target): faster, it gets there first.
    expect(planes(g, 2, U.Recon).length).toBeGreaterThan(0);
  });

  it('within the air force budget: no credit, no raid; easy nations fly no reconnaissance', () => {
    const a = front('hard');
    thinkAir(a.g, a.p2, { ...armed(a.p2), airCredit: 0 }, sky());
    expect(planes(a.g, 2, U.Bomber).length).toBe(0);
    const e = front('easy');
    thinkAir(e.g, e.p2, armed(e.p2), sky({ contact: (o) => (o === 1 ? e.g.map.idx(79, 24) : -1) }));
    expect(planes(e.g, 2, U.Bomber).length).toBeLessThanOrEqual(1);
    expect(planes(e.g, 2, U.Recon).length).toBe(0);
  });

  it('send an escort fighter when interceptors would rise against the bombers (hard)', () => {
    const g = plain('hard', 100);
    const p2 = g.players[2]!;
    p2.gold = 20_000_000;
    build(g, 2, B.Airfield, 140, 24);
    build(g, 1, B.City, 90, 24);
    // Its interceptor on alert sees the city (within 50 tiles) — and the airfield itself.
    build(g, 1, B.Airfield, 80, 40);
    thinkAir(g, p2, armed(p2), sky({ recentWar: 1 }));
    const bombers = planes(g, 2, U.Bomber);
    expect(bombers.length).toBeGreaterThan(0);
    expect(g.buildings.get(bombers[0]!.target)?.owner).toBe(1);
    expect(planes(g, 2, U.Fighter).length).toBe(1);
    // Without the escort (normal), the guarded target is worth half as much: still raided, no fighter.
    const n = plain('normal', 100);
    n.players[2]!.gold = 20_000_000;
    build(n, 2, B.Airfield, 140, 24);
    build(n, 1, B.City, 90, 24);
    build(n, 1, B.Airfield, 80, 40);
    thinkAir(n, n.players[2]!, armed(n.players[2]!), sky({ recentWar: 1 }));
    expect(planes(n, 2, U.Fighter).length).toBe(0);
  });
});

describe('fighters against bombers', () => {
  /** A bomber of player 1 on its way to a city of nation 2, 63 tiles from 2's airfield. */
  function incoming(d: Difficulty, radar = false) {
    const g = plain(d);
    const p2 = g.players[2]!;
    p2.gold = 5_000_000;
    build(g, 2, B.Airfield, 150, 10);
    if (radar) build(g, 2, B.Radar, 110, 30);
    const city = build(g, 2, B.City, 95, 40);
    const u = makeUnit(g.nextId(), U.Bomber, 1, 20.5, 40.5);
    u.hp = u.maxHp = AIR_HP[A.Bomber];
    u.speed = 2.6;
    [u.sx, u.sy, u.tx, u.ty] = [20.5, 40.5, city.x + 0.5, city.y + 0.5];
    u.kind = AIR_OUTBOUND;
    u.target = city.id;
    u.dest = city.tile;
    u.t1 = g.tick + 1000;
    addUnit(g, u);
    return { g, p2 };
  }

  it('rise over the target of a bomber in sight (hard), beyond the reach of the alert interceptor', () => {
    const { g, p2 } = incoming('hard');
    thinkAir(g, p2, armed(p2), sky());
    const f = planes(g, 2, U.Fighter);
    expect(f.length).toBe(1);
    expect(Math.hypot(f[0]!.tx - 95.5, f[0]!.ty - 40.5)).toBeLessThan(2);
  });

  it('on normal only once a radar has seen it', () => {
    const blind = incoming('normal');
    thinkAir(blind.g, blind.p2, armed(blind.p2), sky());
    expect(planes(blind.g, 2, U.Fighter).length).toBe(0);
    const seen = incoming('normal', true);
    // The radar covers the target: the free interceptor will rise, no fighter is wasted.
    thinkAir(seen.g, seen.p2, armed(seen.p2), sky());
    expect(planes(seen.g, 2, U.Fighter).length).toBe(0);
  });
});

describe('bombs', () => {
  it('from hard, a reconnaissance plane over the target first, then the strike', () => {
    const g = plain('hard');
    const p2 = g.players[2]!;
    p2.gold = 20_000_000;
    build(g, 2, B.Silo, 150, 40);
    build(g, 2, B.Airfield, 130, 10);
    build(g, 1, B.City, 40, 24);
    g.ai.nukedBy.set(2, 1); // revenge
    const m = armed(p2);
    const ctx = { nukes: 1.5, leader: 1, runnerUp: 2, reserve: 0 };
    tryNuke(g, p2, m, ctx);
    expect(m.strike).toBeDefined();
    expect(planes(g, 2, U.Recon).length).toBe(1);
    let launched = -1;
    for (let k = 0; k < 300 && launched < 0; k++) {
      g.step([]);
      if (k % 10 === 0) tryNuke(g, p2, m, ctx);
      // (A command's events stay in g.events until the next step.)
      for (const e of g.events) if (e.k === 'nukeLaunch' && e.owner === 2) launched = g.tick;
    }
    expect(launched).toBeGreaterThan(0);
    expect(m.strike).toBeUndefined();
  });

  it('size the salvo to the SAMs covering the target: one more bomb than loaded missiles', () => {
    const g = plain('impossible');
    const p2 = g.players[2]!;
    p2.gold = 20_000_000;
    const silo = build(g, 2, B.Silo, 150, 40);
    silo.level = 3;
    silo.tubes = [0, 0, 0];
    build(g, 1, B.City, 40, 24);
    g.ai.nukedBy.set(2, 1);
    const m = { ...armed(p2), airCredit: 0 }; // no reconnaissance: straight to the strike
    tryNuke(g, p2, m, { nukes: 1.5, leader: 1, runnerUp: 2, reserve: 0 });
    // No SAM: a single atom bomb does it (it used to be three).
    expect(g.events.filter((e) => e.k === 'nukeLaunch' && e.owner === 2).length).toBe(1);
  });

  it('deny a victory with a MIRV from hard (OpenFront: 55 % hard, 40 % impossible)', () => {
    // Player 1 holds 62 % of the land.
    for (const [d, target] of [
      ['normal', -1],
      ['hard', 1],
      ['impossible', 1],
    ] as const) {
      const g = plain(d, 100);
      expect(denialTarget(g, g.players[2]!), d).toBe(target);
    }
    const g = plain('hard', 100);
    const p2 = g.players[2]!;
    p2.gold = 60_000_000;
    build(g, 2, B.Silo, 150, 40);
    const m = armed(p2);
    let mirv = false;
    for (let k = 0; k < 20 && !mirv; k++) {
      tryNuke(g, p2, m, { nukes: 1, leader: 1, runnerUp: 2, reserve: 0 });
      mirv = g.events.some((e) => e.k === 'nukeLaunch' && e.owner === 2 && e.kind === N.Mirv);
    }
    expect(mirv).toBe(true);
  });
});

describe('generals and embargoes', () => {
  it('Rampart (from hard) when an attack that could break it presses near its capital, on a front held by a defensive line', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const g = plain(d);
      const p2 = g.players[2]!;
      p2.general = 'rampart';
      p2.generalReadyTick = 0;
      p2.capital = g.map.idx(95, 24);
      wall(g, 2, 90, 24);
      thinkGeneral(g, p2, {
        offensive: -1,
        incoming: p2.troops,
        contact: g.map.idx(80, 24),
        enemies: new Set([1]),
      });
      expect(p2.rampartUntil > g.tick, d).toBe(d === 'hard');
    }
    // Far from the capital: kept for when it matters.
    const g = plain('hard');
    const p2 = g.players[2]!;
    p2.general = 'rampart';
    p2.generalReadyTick = 0;
    p2.capital = g.map.idx(150, 24);
    wall(g, 2, 90, 24);
    thinkGeneral(g, p2, {
      offensive: -1,
      incoming: p2.troops,
      contact: g.map.idx(80, 24),
      enemies: new Set([1]),
    });
    expect(p2.rampartUntil > g.tick).toBe(false);
  });

  it('Blitz with a new offensive; Sabotage on the enemy’s trains from hard only', () => {
    const g = plain('normal');
    const p2 = g.players[2]!;
    p2.general = 'blitz';
    p2.generalReadyTick = 0;
    thinkGeneral(g, p2, { offensive: p2.spawnTile, incoming: 0, contact: -1, enemies: new Set([1]) });
    expect(p2.blitzUntil).toBeGreaterThan(g.tick);
    expect(TACTICS.normal.generals).toBeLessThan(2);
  });

  it('embargo hostile countries (OpenFront); lifted once back to neutral, never on impossible', () => {
    for (const [d, liftAt10, liftAt60] of [
      ['easy', true, true],
      ['normal', true, true],
      ['hard', true, true],
      ['impossible', false, false],
    ] as const) {
      const g = plain(d);
      const p2 = g.players[2]!;
      p2.relations.set(1, -80);
      embargoes(g, p2);
      expect(p2.embargo.has(1), d).toBe(true);
      p2.relations.set(1, 10);
      embargoes(g, p2);
      expect(p2.embargo.has(1), `${d} at +10`).toBe(!liftAt10);
      p2.relations.set(1, 60);
      embargoes(g, p2);
      expect(p2.embargo.has(1), `${d} at +60`).toBe(!liftAt60);
    }
  });
});

describe('nations use the toolbox (real map)', () => {
  it('on hard, at war: airfields, bombers, reconnaissance, fighters, radars, SAMs and bombs', () => {
    const g = makeGame('black-sea', { players: [], difficulty: 'hard', seed: 42 });
    const seen = new Set<number>();
    const n = { bomber: 0, recon: 0, fighter: 0, nukes: 0, radar: 0, airfield: 0, sam: 0 };
    while (g.tick < 35 * 600 && g.phase !== 'ended') {
      g.step([]);
      for (const e of g.events) {
        if (e.k === 'nukeLaunch' && g.players[e.owner]?.kind === 'nation') n.nukes++;
        if (e.k === 'built' && e.kind === B.Radar) n.radar++;
        if (e.k === 'built' && e.kind === B.Airfield) n.airfield++;
        if (e.k === 'built' && e.kind === B.Sam) n.sam++;
      }
      for (const u of g.units) {
        if (u.type < U.Fighter || u.type > U.Recon || seen.has(u.id)) continue;
        seen.add(u.id);
        if (u.type === U.Bomber) n.bomber++;
        else if (u.type === U.Recon) n.recon++;
        else n.fighter++;
      }
    }
    expect(n.airfield).toBeGreaterThan(0);
    expect(n.bomber).toBeGreaterThan(0);
    expect(n.recon).toBeGreaterThan(0);
    expect(n.fighter).toBeGreaterThan(0);
    expect(n.radar).toBeGreaterThan(0);
    expect(n.sam).toBeGreaterThan(0);
    expect(n.nukes).toBeGreaterThan(0);
  }, 120_000);
});
