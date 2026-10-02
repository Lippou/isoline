import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, makeGame, run, invariants } from '../helpers';
import {
  ALLIANCE_TICKS,
  B,
  OVERTIME_START,
  DOOMSDAY_GRACE,
  BATTLE_ROYALE_STEP,
  GENERAL_COOLDOWN,
  COUNCIL_PERIOD,
  COUNCIL_VOTE_TICKS,
} from '../../src/core/game/constants';
import { currentThreshold } from '../../src/core/rules/victory';
import { placeBuilding, buildCost } from '../../src/core/buildings/buildings';
import { nextTechCost, techSam, techSpeedMultiplier, TECH_COST } from '../../src/core/rules/tech';
import { recountResources, resourceBonus } from '../../src/core/rules/resources';
import { Resource } from '../../src/core/map/terrain';
import { hashGame } from '../../src/core/net/hash';
import {
  takeSnapshot,
  restoreSnapshot,
  snapshotFromJson,
  snapshotToJson,
  rleEncode,
  rleDecodeInto,
} from '../../src/core/net/snapshot';
import type { StampedCommand } from '../../src/core/net/commands';
import { isWellFormed } from '../../src/core/net/commands';
import { isNight, dayPhase } from '../../src/core/rules/features';
import { mapFromDisk } from '../helpers';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

describe('diplomacy', () => {
  it('alliances form, expire without penalty and can be renewed', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    expect(b.allyRequests.has(1)).toBe(true);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(a.allies.get(2)).toBe(g.tick - 1 + ALLIANCE_TICKS);
    // Renewal window: both ask again.
    for (let k = 0; k < ALLIANCE_TICKS - 100; k++) g.step([]);
    const exp = a.allies.get(2)!;
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(a.allies.get(2)!).toBeGreaterThan(exp);
    for (let k = 0; k < ALLIANCE_TICKS + 20; k++) g.step([]);
    expect(a.allies.has(2)).toBe(false);
    expect(a.isTraitor(g.tick)).toBe(false);
  });

  it('refusals, donations and team checks', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: false })]);
    expect(a.allies.has(2)).toBe(false);
    a.gold = 1_000_000;
    g.step([cmd(1, { t: 'donate', target: 2, gold: 500_000, troops: 0 })]);
    expect(b.gold).toBeLessThan(400_000); // not allied → refused
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyRequest', target: 1 })]); // crossing requests = accept
    expect(a.allies.has(2)).toBe(true);
    const bg = b.gold;
    g.step([cmd(1, { t: 'donate', target: 2, gold: 500_000, troops: 1000 })]);
    expect(b.gold - bg).toBeGreaterThan(499_000);
    g.step([cmd(1, { t: 'embargoAll', on: true, exceptTeam: false })]);
    expect(a.embargo.has(2)).toBe(true);
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(a.allies.has(2)).toBe(false);
    expect(a.isTraitor(g.tick)).toBe(false);
  });

  it('validates command shapes', () => {
    expect(isWellFormed({ t: 'attack', tile: 3, ratio: 0.5 })).toBe(true);
    expect(isWellFormed({ t: 'attack', tile: 3, ratio: 2 })).toBe(false);
    expect(isWellFormed({ t: 'nuke', kind: 0, tile: 1, count: 99 })).toBe(false);
    expect(isWellFormed({ t: 'bogus' })).toBe(false);
    expect(isWellFormed(null)).toBe(false);
    expect(isWellFormed({ t: 'shipMove', ids: [1, 2], tile: 4, patrol: true })).toBe(true);
    expect(isWellFormed({ t: 'troopRatio', ratio: 0 })).toBe(true);
  });
});

describe('victory & modes', () => {
  it('territory threshold wins; overtime lowers it in FFA', () => {
    const g = testGame(asciiMap(FIELD, 4), 2, { victoryThreshold: 80 });
    startWith(g, [
      [10, 10],
      [70, 10],
    ]);
    expect(currentThreshold(g)).toBe(80);
    g.startTick = g.tick - OVERTIME_START - 1;
    expect(currentThreshold(g)).toBe(80);
    g.startTick = g.tick - OVERTIME_START - 5 * 600 - 1;
    expect(currentThreshold(g)).toBe(70);
    g.startTick = g.tick - OVERTIME_START - 60 * 600;
    expect(currentThreshold(g)).toBe(50);
    g.startTick = g.tick;
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++)
      if (g.map.isLand(i) && g.owner[i] === 0 && g.map.x(i) < 68) g.setOwner(i, 1);
    expect(p.usefulTiles / g.usefulLand).toBeGreaterThan(0.8);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(g.phase).toBe('ended');
    expect(g.victory.winner).toBe(1);
    expect(g.victory.reason).toBe('territory');
  });

  it('doomsday clock drains players below the threshold', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { mode: 'doomsday' });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    g.startTick = g.tick - DOOMSDAY_GRACE - 1;
    const p = g.players[2]!;
    p.troops = 100_000;
    for (let k = 0; k < 40; k++) g.step([]);
    expect(g.victory.doomsday).toBe(2);
    // ~1.7 % share each: both under 2 % → troops drain.
    expect(p.troops).toBeLessThan(100_000);
  });

  it('battle royale shrinks the ring and kills outer tiles', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { mode: 'battleRoyale' });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const land = g.usefulLand;
    for (let k = 0; k < BATTLE_ROYALE_STEP + 60; k++) g.step([]);
    expect(g.usefulLand).toBeLessThan(land);
    expect(g.isDead(g.map.idx(7, 7))).toBe(true);
  });
});

describe('original features', () => {
  it('research progresses with cities and applies effects', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    p.cityLevels = 9;
    g.step([cmd(1, { t: 'research', tech: 1 })]);
    expect(nextTechCost(p, 1)).toBe(TECH_COST[0]);
    for (let k = 0; k < 2000; k++) g.step([]);
    expect(p.tech[1]).toBeGreaterThanOrEqual(2);
    expect(techSpeedMultiplier(p)).toBeGreaterThan(1);
    p.tech[4] = 4;
    expect(techSam(p).targets).toBe(2);
  });

  it('strategic deposits grant bonuses', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.deposits = [
      { x: 30, y: 20, type: Resource.Oil },
      { x: 33, y: 20, type: Resource.RareMetals },
    ];
    const g = testGame(map, 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    recountResources(g);
    const bonus = resourceBonus(g, p);
    expect(bonus.gold).toBeGreaterThan(0);
    expect(bonus.buildDiscount).toBeGreaterThan(0);
    expect(buildCost(g, p, B.Silo)).toBeLessThan(1_000_000);
  });

  it('generals: ability then cooldown', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    p.generalReadyTick = 0;
    g.step([cmd(1, { t: 'general', tile: 0 })]);
    expect(p.blitzUntil).toBeGreaterThan(g.tick);
    expect(p.generalReadyTick).toBe(g.tick - 1 + GENERAL_COOLDOWN);
  });

  it('world council opens, counts weighted votes and applies the result', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { features: { council: true } as never });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    g.startTick = g.tick - COUNCIL_PERIOD;
    g.step([]);
    expect(g.features.council).not.toBeNull();
    g.step([cmd(1, { t: 'vote', option: 2 }), cmd(2, { t: 'vote', option: 2 })]);
    for (let k = 0; k < COUNCIL_VOTE_TICKS + 2; k++) g.step([]);
    expect(g.features.council).toBeNull();
    expect(g.features.ceasefireUntil).toBeGreaterThan(g.tick);
    expect(g.attackAllowed(1, 2, true)).toBe(false);
  });

  it('day/night cycle lasts 8 minutes', () => {
    expect(isNight(0)).toBe(false);
    expect(isNight(2400)).toBe(true);
    expect(dayPhase(4800)).toBe(0);
  });

  it('low loyalty with few troops can trigger a secession', () => {
    const g = testGame(asciiMap(FIELD, 8), 1, {
      victoryThreshold: 101,
      features: { loyalty: true } as never,
    });
    startWith(g, [[30, 28]]);
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i) && g.owner[i] === 0) g.setOwner(i, 1);
    g.loyalty.fill(10);
    p.troops = 100;
    p.troopRatio = 0.05; // keep the garrison thin
    let seceded = false;
    for (let k = 0; k < 400 && !seceded; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'secession')) seceded = true;
    }
    expect(seceded).toBe(true);
    expect(g.players.length).toBeGreaterThan(2);
    expect(invariants(g)).toEqual([]);
  });

  it('defence posts and SAMs: AI-independent placement on owned land', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    p.gold = 10_000_000;
    expect(placeBuilding(g, p, B.Sam, g.map.idx(30, 20))).not.toBeNull();
  });
});

describe('determinism & snapshots', () => {
  const script = (tick: number): StampedCommand[] => {
    if (tick === 5) return [{ p: 1, c: { t: 'spawn', tile: 0 } }];
    return [];
  };

  it('same seed + same commands = same hash (world map, AI nations)', () => {
    const a = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    const b = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    run(a, 900, script);
    run(b, 900, script);
    expect(hashGame(a)).toBe(hashGame(b));
    const c = makeGame('black-sea', { nations: 8, tribes: 10, players: [], seed: 999 });
    run(c, 900, script);
    expect(hashGame(c)).not.toBe(hashGame(a));
  });

  it('restoring a snapshot reproduces the exact future', () => {
    const a = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    run(a, 700);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(a)));
    const b = restoreSnapshot(mapFromDisk('black-sea'), snap);
    expect(hashGame(b)).toBe(hashGame(a));
    run(a, 600);
    run(b, 600);
    expect(hashGame(b)).toBe(hashGame(a));
    expect(invariants(b)).toEqual([]);
  });

  it('RLE codec round-trips', () => {
    const src = new Uint16Array([0, 0, 0, 5, 5, 9, 0, 0]);
    const dst = new Uint16Array(src.length);
    rleDecodeInto(rleEncode(src), dst);
    expect(dst).toEqual(src);
  });
});

describe('automated nations', () => {
  it('nations expand, build, ally and stay consistent over 4 minutes', () => {
    const g = makeGame('europe', { nations: 25, tribes: 30, players: [], difficulty: 'hard' });
    run(g, 2400);
    const nations = g.players.filter((p) => p && p.kind === 'nation');
    expect(nations.some((p) => p!.tiles > 5000)).toBe(true);
    expect(g.buildings.size).toBeGreaterThan(10);
    expect(invariants(g)).toEqual([]);
  });
});

describe('sandbox threshold', () => {
  it('a threshold above 100 % disables both victory and overtime', () => {
    const map = asciiMap(
      Array.from({ length: 10 }, () => '.'.repeat(10)),
      4,
    );
    for (const [th, expected] of [
      [101, 101],
      [80, 50],
    ] as const) {
      const g = testGame(map, 2, { victoryThreshold: th });
      startWith(g, [
        [5, 5],
        [30, 30],
      ]);
      (g as { tick: number }).tick = g.startTick + 60 * 60 * 10;
      expect(currentThreshold(g)).toBe(expected);
    }
  });
});
