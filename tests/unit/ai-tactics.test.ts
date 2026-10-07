// The nations' 1.12 tactics: threat awareness (the runaway, the coalition's timed strikes),
// alliances refused to the runaway, fleets sent where they matter, and determinism of the
// new AI state across snapshots (with a scripted human that snowballs).
import { describe, expect, it } from 'vitest';
import { asciiMap, invariants, makeGame, mapFromDisk, startWith, testGame } from '../helpers';
import {
  STRIKE_PREP,
  STRIKE_WINDOW,
  THREAT_PERIOD,
  assessThreats,
  joinsCoalition,
  runawayOf,
  striking,
} from '../../src/core/npc/threat';
import { TACTICS } from '../../src/core/npc/tactics';
import { thinkNavy, NAVY_HEALTHY } from '../../src/core/npc/navy';
import { allianceOdds } from '../../src/core/npc/ai';
import type { Difficulty } from '../../src/core/game/config';
import { B, TRANSPORT_HP, WARSHIP_HP } from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { U, makeUnit } from '../../src/core/units/unit';
import { addUnit } from '../../src/core/units/ships';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import type { Game } from '../../src/core/game/state';
import { createBot } from '../../scripts/bots';

const PLAIN = Array.from({ length: 12 }, () => '.'.repeat(40));

/** Three countries on a plain: player 1 holds x < split, 2 and 3 share the rest. */
function plain(difficulty: Difficulty, split: number): Game {
  const g = testGame(asciiMap(PLAIN, 4), 3, { difficulty });
  startWith(g, [
    [10, 20],
    [130, 10],
    [130, 40],
  ]);
  const w = g.map.width;
  for (let i = 0; i < g.map.size; i++) {
    const x = i % w;
    g.setOwner(i, x < split ? 1 : ((i / w) | 0) < 24 ? 2 : 3);
  }
  for (const id of [2, 3]) {
    g.players[id]!.kind = 'nation';
    g.players[id]!.personality = 'diplomat';
  }
  return g;
}

describe('threat awareness', () => {
  it('singles out a runaway leader by difficulty (OpenFront: 3× / 2× / 1.5× the runner-up)', () => {
    // Player 1 holds 100 of 160 columns: 62 % of the land, 3.3× each other country.
    for (const [d, expected] of [
      ['easy', -1],
      ['normal', 1],
      ['hard', 1],
      ['impossible', 1],
    ] as const) {
      const g = plain(d, 100);
      assessThreats(g);
      expect(runawayOf(g), d).toBe(expected);
    }
    // 2.2× the runner-up: a runaway from hard only.
    for (const [d, expected] of [
      ['normal', -1],
      ['hard', 1],
    ] as const) {
      const g = plain(d, 85);
      assessThreats(g);
      expect(runawayOf(g), d).toBe(expected);
    }
    // No runaway in team games (OpenFront's crown is FFA-only).
    const t = testGame(asciiMap(PLAIN, 4), 3, { difficulty: 'hard', mode: 'teams' });
    startWith(t, [
      [10, 20],
      [130, 10],
      [130, 40],
    ]);
    assessThreats(t);
    expect(runawayOf(t)).toBe(-1);
  });

  it('times the coalition strikes: a first one after the preparation, then every strikeEvery', () => {
    const g = plain('hard', 100);
    assessThreats(g);
    const t0 = g.tick;
    const th = g.ai.threat!;
    expect(th.strikeAt).toBe(t0 + STRIKE_PREP * 10);
    expect(striking(g)).toBe(false);
    g.tick = th.strikeAt;
    expect(striking(g)).toBe(true);
    g.tick = th.strikeUntil;
    expect(striking(g)).toBe(false);
    g.tick += THREAT_PERIOD;
    const until = th.strikeUntil;
    assessThreats(g);
    expect(th.strikeAt).toBe(until + TACTICS.hard.strikeEvery * 10);
    expect(th.strikeUntil - th.strikeAt).toBe(STRIKE_WINDOW);
  });

  it('nations never ally with the runaway, and partners against it court each other', () => {
    const g = plain('impossible', 100);
    assessThreats(g);
    const [p1, p2, p3] = [g.players[1]!, g.players[2]!, g.players[3]!];
    const toRunaway = allianceOdds(g, p2, p1);
    expect(toRunaway.refusal).toBe('runaway');
    expect(toRunaway.chance).toBe(0);
    const partners = allianceOdds(g, p2, p3);
    expect(partners.factors.some(([k]) => k === 'coalition')).toBe(true);
    // Easy nations do not notice.
    const e = plain('easy', 100);
    assessThreats(e);
    expect(allianceOdds(e, e.players[2]!, e.players[1]!).refusal).toBe(null);
  });

  it('enlists every neighbour of the runaway on impossible, about half of them on normal and hard', () => {
    const g = plain('hard', 100);
    for (const [d, lo, hi] of [
      ['easy', 0, 0],
      ['normal', 30, 70],
      ['hard', 30, 70],
      ['impossible', 100, 100],
    ] as const) {
      g.config.difficulty = d;
      let n = 0;
      for (let id = 2; id < 102; id++) if (joinsCoalition(g, id, 1)) n++;
      expect(n, d).toBeGreaterThanOrEqual(lo);
      expect(n, d).toBeLessThanOrEqual(hi);
      expect(joinsCoalition(g, 1, 1)).toBe(false);
    }
  });
});

// A wide sea: player 1 (west) and nation 2 (east) each hold a small island.
const SEA = Array.from({ length: 12 }, (_, y) =>
  Array.from({ length: 50 }, (_, x) =>
    y >= 1 && y <= 2 && ((x >= 1 && x <= 3) || (x >= 46 && x <= 48)) ? '.' : '~',
  ).join(''),
);

function sea(difficulty: Difficulty): Game {
  const g = testGame(asciiMap(SEA, 6), 2, { difficulty });
  startWith(g, [
    [14, 11],
    [284, 11],
  ]);
  for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i)) g.setOwner(i, g.map.x(i) < 150 ? 1 : 2);
  g.players[2]!.kind = 'nation';
  return g;
}

function ship(g: Game, type: U, owner: number, x: number, y: number) {
  const u = makeUnit(g.nextId(), type, owner, x + 0.5, y + 0.5);
  u.hp = u.maxHp = type === U.Warship ? WARSHIP_HP : TRANSPORT_HP;
  u.patrol = type === U.Warship ? g.map.idx(x, y) : -1;
  return addUnit(g, u);
}

describe('nations at sea', () => {
  it('send a healthy warship at a transport sailing for them, leave a damaged one to its repairs', () => {
    const g = sea('normal');
    const p2 = g.players[2]!;
    placeBuilding(
      g,
      p2,
      B.Port,
      p2.coast.find((t) => g.map.x(t) < 280)!,
      true,
    )!.buildLeft = 0;
    const ws = ship(g, U.Warship, 2, 260, 30);
    const hurt = ship(g, U.Warship, 2, 262, 40);
    hurt.hp = hurt.maxHp * (NAVY_HEALTHY - 0.2);
    const boat = ship(g, U.Transport, 1, 150, 30);
    boat.troops = 20_000;
    boat.dest = 2;
    thinkNavy(g, p2, { enemies: new Set([1]), war: 1, naval: 1 });
    const w = g.map.width;
    expect(Math.hypot((ws.patrol % w) - 150, ((ws.patrol / w) | 0) - 30)).toBeLessThan(3);
    expect(hurt.patrol).toBe(g.map.idx(262, 40));
  });

  it('easy nations leave their warships where they were built (as before 1.12)', () => {
    const g = sea('easy');
    const p2 = g.players[2]!;
    placeBuilding(
      g,
      p2,
      B.Port,
      p2.coast.find((t) => g.map.x(t) < 280)!,
      true,
    )!.buildLeft = 0;
    const ws = ship(g, U.Warship, 2, 260, 30);
    const boat = ship(g, U.Transport, 1, 150, 30);
    boat.troops = 20_000;
    boat.dest = 2;
    for (let k = 0; k < 20; k++) thinkNavy(g, p2, { enemies: new Set([1]), war: 1, naval: 1 });
    expect(ws.patrol).toBe(g.map.idx(260, 30));
  });
});

describe('nations against a snowballing human', () => {
  /**
   * Black Sea, impossible, all 15 nations (independent of the lobby's pick, map/nationPick.ts):
   * a scripted attacker whose troops grow 1.5× as fast (a runaway in two minutes).
   */
  function snowball(): { g: Game; bot: ReturnType<typeof createBot> } {
    const g = makeGame('black-sea', {
      nations: 15,
      tribes: 20,
      difficulty: 'impossible',
      spawnSeconds: 30,
      players: [{ slot: 0, name: 'Bot', kind: 'human', team: 0 }],
    });
    const bot = createBot('aggressive', 5);
    bot.id = g.players.find((p) => p && p.kind === 'human')!.id;
    return { g, bot };
  }
  function step(g: Game, bot: ReturnType<typeof createBot>): void {
    g.step(bot.commands(g));
    const me = g.players[bot.id]!;
    if (g.phase === 'playing' && me.alive && me.lastGrowth > 0)
      me.troops = Math.min(me.popCap, me.troops + me.lastGrowth * 0.5);
  }

  it('gang up on it: it is singled out and several nations strike it at once', () => {
    const { g, bot } = snowball();
    let singled = false;
    let gang = 0;
    for (let k = 0; k < 9000 && g.phase !== 'ended' && g.players[bot.id]!.alive; k++) {
      step(g, bot);
      if (runawayOf(g) === bot.id) singled = true;
      if (k % 10 === 0) {
        const attackers = new Set<number>();
        for (const a of g.attacks)
          if (!a.done && a.target === bot.id && g.players[a.attacker]!.kind === 'nation')
            attackers.add(a.attacker);
        gang = Math.max(gang, attackers.size);
      }
      if (singled && gang >= 3) break;
    }
    expect(singled).toBe(true);
    expect(gang).toBeGreaterThanOrEqual(3);
    expect(invariants(g)).toEqual([]);
  });

  it('a snapshot taken mid-coalition reproduces the exact future', () => {
    const { g, bot } = snowball();
    for (let k = 0; k < 4200; k++) step(g, bot);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const h = restoreSnapshot(mapFromDisk('black-sea'), snap);
    expect(hashGame(h)).toBe(hashGame(g));
    expect(h.ai.threat?.runaway).toBe(g.ai.threat?.runaway);
    // The same bot commands for both (computed on the original), the same future.
    for (let k = 0; k < 900; k++) {
      const cmds = bot.commands(g);
      g.step(cmds);
      h.step(cmds);
    }
    expect(hashGame(h)).toBe(hashGame(g));
  });

  it('an attack-only player does not sweep a hard Black Sea in 20 minutes (it did in 9 in 1.11)', () => {
    // scripts/versus.ts black-sea hard aggressive 42 with BOT_BOOST=1.25: WIN 9.1 min on the 1.11 AI.
    // One game is a coin toss (over ten seeds this bot won 3 in 1.17, 4 in 1.18, 3 in 1.19,
    // 2 in 1.20): three games, and it must lose most of them.
    let wins = 0;
    for (const seed of [42, 7, 23]) {
      const g = makeGame('black-sea', {
        seed,
        nations: 30,
        tribes: 40,
        difficulty: 'hard',
        spawnSeconds: 30,
        players: [{ slot: 0, name: 'Bot', kind: 'human', team: 0 }],
      });
      const bot = createBot('aggressive', seed);
      bot.id = g.players.find((p) => p && p.kind === 'human')!.id;
      while (g.phase !== 'ended' && (g.phase === 'spawn' || g.tick - g.startTick < 20 * 600)) {
        g.step(bot.commands(g));
        const me = g.players[bot.id]!;
        if (g.phase === 'playing' && me.alive && me.lastGrowth > 0)
          me.troops = Math.min(me.popCap, me.troops + me.lastGrowth * 0.25);
        if (!me.alive) break;
      }
      if (g.victory.winner === bot.id) wins++;
    }
    expect(wins).toBeLessThanOrEqual(1);
  }, 180_000);
});
