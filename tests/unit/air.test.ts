// Aviation and radars (GAME_DESIGN.md §11): every plane has a role, with or without the fog.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, invariants, makeGame, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import type { GameEvent } from '../../src/core/game/events';
import {
  A,
  AIR_HP,
  AIR_SPEED,
  B,
  BOMBER_RANGE,
  RECON_LOSS_MULT,
  SCRAMBLE_REARM,
} from '../../src/core/game/constants';
import { placeBuilding, upgradeBuilding } from '../../src/core/buildings/buildings';
import type { Building } from '../../src/core/buildings/building';
import { U, makeUnit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';
import { launchAircraft } from '../../src/core/units/air';
import { Attack, attackLogic } from '../../src/core/rules/combat';
import { RadarWatch } from '../../src/engine/radarWatch';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** Two countries face to face: player 1 west of x = 60, player 2 east of it, rich. */
function duel(scale = 6): Game {
  const g = testGame(asciiMap(FIELD, scale), 2, { victoryThreshold: 101 });
  const mid = (10 * scale) | 0;
  startWith(g, [
    [Math.round(mid / 3), 3 * scale + 2],
    [Math.round(mid * 1.66), 3 * scale + 2],
  ]);
  for (let i = 0; i < g.map.size; i++) {
    if (!g.map.isLand(i)) continue;
    g.setOwner(i, i % g.map.width < mid ? 1 : 2);
  }
  g.players[1]!.gold = g.players[2]!.gold = 100_000_000;
  return g;
}

const at = (g: Game, x: number, y: number) => g.map.idx(x, y);
function build(g: Game, owner: number, type: B, x: number, y: number, level = 1): Building {
  const b = placeBuilding(g, g.players[owner]!, type, at(g, x, y), true)!;
  expect(b).toBeTruthy();
  for (let l = 1; l < level; l++) {
    expect(upgradeBuilding(g, g.players[owner]!, b)).toBe(true);
    b.upgradeLeft = 1;
    g.step([]);
  }
  return b;
}

/** Steps until no aircraft is left (or `max` ticks), collecting the events. */
function flyOut(g: Game, max = 400, first: GameEvent[] = []): GameEvent[] {
  const events = [...first];
  for (let k = 0; k < max; k++) {
    g.step([]);
    events.push(...g.events);
    if (!g.units.some((u) => u.alive && u.type >= U.Fighter && u.type <= U.Recon)) break;
  }
  return events;
}
const strikes = (ev: GameEvent[]) =>
  ev.filter((e) => e.k === 'airStrike') as Extract<GameEvent, { k: 'airStrike' }>[];
const downs = (ev: GameEvent[]) =>
  ev.filter((e) => e.k === 'planeDown') as Extract<GameEvent, { k: 'planeDown' }>[];

/** A bomber of `owner` placed in flight at (x, y), heading east far away (no target). */
function bomberAt(g: Game, owner: number, x: number, y: number): void {
  const u = makeUnit(g.nextId(), U.Bomber, owner, x, y);
  u.hp = u.maxHp = AIR_HP[A.Bomber];
  u.speed = 0.01;
  u.sx = x;
  u.sy = y;
  u.tx = x + 1;
  u.ty = y;
  u.t1 = 1e9;
  addUnit(g, u);
}

describe('bombers: the precise strike on buildings', () => {
  it('knock a level off the hostile building nearest the aim, raze a level-1 one, kill no troops', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    const city = build(g, 2, B.City, 85, 20, 3);
    const factory = build(g, 2, B.Factory, 100, 32);
    const p2 = g.players[2]!;
    const levels = p2.cityLevels;
    const lost = p2.stats.troopsLost;
    const gold = g.players[1]!.gold;
    // Aimed two tiles off: the bomber snaps to the city.
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: at(g, 87, 21) })]);
    expect(gold - g.players[1]!.gold).toBeCloseTo(450_000, -3); // (plus a tick of income)
    const ev = flyOut(g);
    expect(strikes(ev)).toMatchObject([{ owner: 1, victim: 2, type: B.City, levels: 1, destroyed: false }]);
    expect(city.level).toBe(2);
    expect(p2.cityLevels).toBe(levels - 1);
    expect(p2.stats.troopsLost).toBe(lost);
    // An attack in the victim's eyes.
    expect(p2.relation(1)).toBeLessThan(0);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: at(g, 100, 32) })]);
    expect(strikes(flyOut(g))[0]).toMatchObject({ type: B.Factory, destroyed: true });
    expect(g.buildings.has(factory.id)).toBe(false);
    expect(invariants(g)).toEqual([]);
  });

  it('empty the silos and SAMs they hit; a defence post is destroyed outright', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    const silo = build(g, 2, B.Silo, 70, 10, 2);
    const post = build(g, 2, B.DefensePost, 70, 30);
    expect(silo.tubes).toEqual([0, 0]);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: silo.tile })]);
    flyOut(g);
    expect(silo.level).toBe(1);
    expect(silo.tubes.length).toBe(1);
    expect(silo.tubes[0]).toBeGreaterThan(0);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: post.tile })]);
    flyOut(g);
    expect(g.buildings.has(post.id)).toBe(false);
  });

  it('reach BOMBER_RANGE from an airfield, never a teammate nor their own land', () => {
    const g = duel(20);
    build(g, 1, B.Airfield, 30, 70);
    const near = build(g, 2, B.City, 30 + BOMBER_RANGE - 20, 70);
    const far = build(g, 2, B.City, 30 + BOMBER_RANGE + 40, 70);
    const p1 = g.players[1]!;
    expect(launchAircraft(g, p1, A.Bomber, far.tile)).toBe(false);
    expect(launchAircraft(g, p1, A.Bomber, near.tile)).toBe(true);
    expect(launchAircraft(g, p1, A.Bomber, at(g, 40, 70))).toBe(false); // our own land
    p1.team = g.players[2]!.team = 1;
    expect(launchAircraft(g, p1, A.Bomber, near.tile)).toBe(false);
  });

  it('bombing an ally betrays it', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    const city = build(g, 2, B.City, 85, 20);
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(g.players[1]!.allies.has(2)).toBe(true);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile })]);
    expect(g.players[1]!.allies.has(2)).toBe(false);
    expect(g.players[1]!.isTraitor(g.tick)).toBe(true);
  });

  it('SAMs down one bomber per loaded missile: the next gets through', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    const sam = build(g, 2, B.Sam, 85, 20);
    const city = build(g, 2, B.City, 100, 20);
    g.step([
      cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile }),
      cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile }),
    ]);
    const ev = flyOut(g);
    expect(downs(ev)).toMatchObject([{ owner: 1, by: 2, cause: 'sam', kind: U.Bomber }]);
    expect(sam.tubes[0]).toBeGreaterThan(0);
    expect(strikes(ev)).toHaveLength(1);
    expect(g.buildings.has(city.id)).toBe(false);
  });
});

describe('airfields and radars: interceptors on alert', () => {
  it('scramble at a bomber detected within 50 tiles, rearm in 30 s', () => {
    const g = duel();
    const field = build(g, 2, B.Airfield, 90, 20);
    bomberAt(g, 1, 50, 20); // 40 tiles out
    g.step([]);
    const scr = g.events.filter((e) => e.k === 'scramble');
    expect(scr).toMatchObject([{ owner: 2, radar: false }]);
    expect(field.tubes[0]).toBe(SCRAMBLE_REARM);
    const ev = flyOut(g, 200);
    expect(downs(ev)).toMatchObject([{ owner: 1, by: 2, cause: 'fighter' }]);
    // A second intruder while the alert rearms: nobody rises.
    bomberAt(g, 1, 50, 25);
    g.step([]);
    expect(g.events.some((e) => e.k === 'scramble')).toBe(false);
  });

  it('beyond 50 tiles they need a radar to see the intruder (blind in a solar storm)', () => {
    const g = duel();
    build(g, 2, B.Airfield, 110, 20);
    bomberAt(g, 1, 40, 20); // 70 tiles out: within reach (90), out of the airfield's sight (50)
    g.step([]);
    expect(g.events.some((e) => e.k === 'scramble')).toBe(false);
    build(g, 2, B.Radar, 75, 20);
    g.features.radarsOffUntil = g.tick + 50;
    g.step([]);
    expect(g.events.some((e) => e.k === 'scramble')).toBe(false);
    g.features.radarsOffUntil = -1;
    g.step([]);
    expect(g.events.filter((e) => e.k === 'scramble')).toMatchObject([{ owner: 2, radar: true }]);
  });

  it('radar early warning: once, when a bomber bound for the viewer enters coverage', () => {
    for (const withRadar of [true, false]) {
      const g = duel();
      build(g, 1, B.Airfield, 25, 20);
      const city = build(g, 2, B.City, 100, 20);
      if (withRadar) build(g, 2, B.Radar, 85, 20);
      const watch = new RadarWatch();
      const warnings: GameEvent[] = [];
      g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile })]);
      for (let k = 0; k < 200 && g.units.some((u) => u.alive && u.type === U.Bomber); k++) {
        g.step([]);
        warnings.push(...watch.scan(g, 2));
      }
      if (withRadar) {
        expect(warnings).toMatchObject([
          {
            k: 'notify',
            to: 2,
            key: 'notify.radar.bomber',
            params: { by: 1, building: 'city' },
            tile: city.tile,
          },
        ]);
        // It came in range well before the drop (radar range 60, bomber 2.6 tiles a tick).
      } else expect(warnings).toEqual([]);
    }
  });
});

describe('fighters: air superiority', () => {
  it('a patrol shoots down an intruding bomber and sinks a transport bound for its coast only', () => {
    const g = duel();
    build(g, 2, B.Airfield, 95, 20);
    g.step([cmd(2, { t: 'air', kind: A.Fighter, tile: at(g, 80, 12) })]);
    const mk = (dest: number, x: number) => {
      const t = makeUnit(g.nextId(), U.Transport, 1, x, 3.5);
      t.hp = t.maxHp = 300;
      t.troops = 5_000;
      t.dest = dest;
      t.path = [at(g, x - 1, 3), at(g, 10, 3)];
      t.speed = 0.05;
      addUnit(g, t);
      return t;
    };
    const invader = mk(2, 82);
    const passer = mk(0, 70);
    bomberAt(g, 1, 70, 22);
    const ev = flyOut(g, 120);
    expect(downs(ev)).toMatchObject([{ owner: 1, by: 2, cause: 'fighter', kind: U.Bomber }]);
    expect(invader.alive).toBe(false);
    expect(passer.alive).toBe(true);
  });
});

describe('reconnaissance: intelligence that matters without the fog', () => {
  it('its zone makes attacks there cheaper and bombers hit two levels', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    const city = build(g, 2, B.City, 85, 20, 3);
    g.step([cmd(1, { t: 'air', kind: A.Recon, tile: at(g, 80, 20) })]);
    for (let k = 0; k < 40 && g.features.reveals.length === 0; k++) g.step([]);
    expect(g.features.reveals).toMatchObject([{ owner: 1, r: 40 }]);
    const a = new Attack(g.nextId(), 1, 2, 10_000, g.tick);
    const inside = attackLogic(g, a, at(g, 70, 20), 10).attackerLoss;
    const outside = attackLogic(g, a, at(g, 70, 34), 10).attackerLoss;
    const saved = g.features.reveals;
    g.features.reveals = [];
    const plain = attackLogic(g, a, at(g, 70, 20), 10).attackerLoss;
    g.features.reveals = saved;
    expect(inside / plain).toBeCloseTo(RECON_LOSS_MULT, 6);
    expect(outside).toBeCloseTo(attackLogic(g, a, at(g, 70, 34), 10).attackerLoss, 6);
    // Our own reconnaissance gives the enemy nothing.
    const back = new Attack(g.nextId(), 2, 1, 10_000, g.tick);
    g.features.reveals = [];
    const theirs = attackLogic(g, back, at(g, 55, 20), 10).attackerLoss;
    g.features.reveals = saved;
    expect(attackLogic(g, back, at(g, 55, 20), 10).attackerLoss).toBeCloseTo(theirs, 6);
    g.step([cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile })]);
    const hit = strikes(flyOut(g, 200)).find((e) => e.type === B.City);
    expect(hit?.levels).toBe(2);
    expect(city.level).toBe(1);
  });

  it('interceptors rise against it, and its zone ends when it is shot down', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    build(g, 2, B.Airfield, 112, 34); // the reconnaissance reaches its zone before the interceptor
    g.step([cmd(1, { t: 'air', kind: A.Recon, tile: at(g, 85, 20) })]);
    let zone = false;
    const ev: GameEvent[] = [];
    for (let k = 0; k < 200 && g.units.some((u) => u.alive && u.type === U.Recon); k++) {
      g.step([]);
      ev.push(...g.events);
      zone ||= g.features.reveals.length > 0;
    }
    expect(ev.filter((e) => e.k === 'scramble')).toMatchObject([{ owner: 2 }]);
    expect(downs(ev)).toMatchObject([{ owner: 1, by: 2, kind: U.Recon, cause: 'fighter' }]);
    expect(zone).toBe(true);
    expect(g.features.reveals).toEqual([]);
  });

  it('flies further than bombers (400 tiles), not beyond', () => {
    const g = duel(25); // 500 × 175 tiles, land from 25 to 474 × 25 to 149
    build(g, 1, B.Airfield, 26, 26);
    const p1 = g.players[1]!;
    const city = build(g, 2, B.City, 400, 100); // ≈ 381 tiles away
    expect(launchAircraft(g, p1, A.Bomber, city.tile)).toBe(false);
    expect(launchAircraft(g, p1, A.Recon, city.tile)).toBe(true);
    expect(launchAircraft(g, p1, A.Recon, at(g, 470, 140))).toBe(false); // ≈ 458 tiles
    expect(AIR_SPEED[A.Recon]).toBeGreaterThan(AIR_SPEED[A.Bomber]);
  });
});

describe('determinism', () => {
  it('a snapshot taken mid-raid replays the same future (interceptors, SAM, recon)', () => {
    const g = duel();
    build(g, 1, B.Airfield, 25, 20);
    build(g, 2, B.Airfield, 95, 30);
    build(g, 2, B.Sam, 90, 12);
    build(g, 2, B.Radar, 80, 20);
    const city = build(g, 2, B.City, 100, 20, 2);
    g.step([
      cmd(1, { t: 'air', kind: A.Recon, tile: at(g, 85, 20) }),
      cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile }),
      cmd(1, { t: 'air', kind: A.Bomber, tile: city.tile }),
      cmd(1, { t: 'air', kind: A.Fighter, tile: at(g, 70, 20) }),
    ]);
    for (let k = 0; k < 12; k++) g.step([]);
    const copy = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(hashGame(copy)).toBe(hashGame(g));
    for (let k = 0; k < 150; k++) {
      g.step([]);
      copy.step([]);
    }
    expect(hashGame(copy)).toBe(hashGame(g));
    expect(city.level).toBe(copy.buildings.get(city.id)?.level ?? 0);
  });
});

describe('nations fly (normal difficulty)', () => {
  it('build airfields once at war and send bombers and reconnaissance within 20 minutes', () => {
    // (A seed whose wars start early enough: 20 min is close to the first airfields.)
    const g = makeGame('black-sea', { players: [], difficulty: 'normal', seed: 6 });
    const seen = new Set<number>();
    const flown = new Map<number, number>();
    while (g.tick < 20 * 600 && g.phase !== 'ended') {
      g.step([]);
      for (const u of g.units) {
        if (u.type < U.Fighter || u.type > U.Recon || seen.has(u.id)) continue;
        seen.add(u.id);
        flown.set(u.type, (flown.get(u.type) ?? 0) + 1);
      }
    }
    let fields = 0;
    for (const b of g.buildings.values()) if (b.type === B.Airfield) fields++;
    expect(fields).toBeGreaterThan(0);
    expect(flown.get(U.Bomber) ?? 0).toBeGreaterThan(0);
    expect(flown.get(U.Recon) ?? 0).toBeGreaterThan(0);
  }, 60_000);
});
