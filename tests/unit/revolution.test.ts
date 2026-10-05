// Revolutions (GAME_DESIGN.md §6.5, 1.14): a country far ahead now and then sees a distant
// region rise up as a rebel faction without gold, which rejoins it unless put down first.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, testGame, startWith } from '../helpers';
import {
  B,
  REVOLUTION_CAPITAL_SAFE,
  REVOLUTION_CHECK_TICKS,
  REVOLUTION_COOLDOWN,
  REVOLUTION_GRACE,
  REVOLUTION_TICKS,
} from '../../src/core/game/constants';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { inService, type Building } from '../../src/core/buildings/building';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import {
  liveRevolutionOf,
  revolutionPressure,
  startRevolution,
  updateRevolutions,
} from '../../src/core/rules/revolution';
import type { Game } from '../../src/core/game/state';
import type { Player } from '../../src/core/game/player';
import type { GameConfig } from '../../src/core/game/config';

const FIELD = ['~'.repeat(24), ...Array<string>(8).fill(`~${'.'.repeat(22)}~`), '~'.repeat(24)];

/** Two players on a 192 × 80 field: player 1 holds x < split, player 2 the rest. */
function field(split = 150, patch: Partial<GameConfig> = {}): Game {
  const g = testGame(asciiMap(FIELD, 8), 2, { victoryThreshold: 101, ...patch });
  startWith(g, [
    [30, 40],
    [170, 40],
  ]);
  for (let y = 0; y < g.map.height; y++)
    for (let x = 0; x < g.map.width; x++) {
      const t = g.map.idx(x, y);
      if (g.map.isLand(t)) g.setOwner(t, x < split ? 1 : 2);
    }
  for (const p of g.players) if (p) p.troops = 200_000;
  return g;
}

const steps = (g: Game, n: number, f?: (g: Game) => void) => {
  for (let k = 0; k < n; k++) {
    g.step([]);
    f?.(g);
  }
};

/** Steps to the next revolution draw past the grace period (tick aligned on the check). */
function toDraw(g: Game): void {
  while (g.tick - g.startTick < REVOLUTION_GRACE || (g.tick - g.startTick) % REVOLUTION_CHECK_TICKS !== 0)
    g.step([]);
}

function tilesOf(g: Game, id: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.owner.length; i++) if (g.owner[i] === id) out.push(i);
  return out;
}

function city(g: Game, pid: number, tile: number): Building {
  return placeBuilding(g, g.players[pid]!, B.City, tile, true)!;
}

describe('revolutions: the trigger', () => {
  it('only a country well ahead qualifies; the chance grows with the lead', () => {
    const even = field(96);
    expect(revolutionPressure(even).chance).toBe(0);
    const ahead = field(130);
    const far = field(170);
    const a = revolutionPressure(ahead);
    const f = revolutionPressure(far);
    expect(a.leader).toBe(1);
    expect(a.lead).toBeGreaterThan(1.6);
    expect(a.chance).toBeGreaterThan(0);
    expect(f.chance).toBeGreaterThan(a.chance);
    expect(f.chance).toBeLessThanOrEqual(0.13 + 1e-9);
  });

  it('a runaway leader sees a region rise up, far from its capital, then waits for the cooldown', () => {
    const g = field(170);
    const p1 = g.players[1]!;
    const capital = p1.capital;
    let outbreak = -1;
    // Before the grace period: never.
    while (g.tick - g.startTick < REVOLUTION_GRACE - 1) {
      g.step([]);
      expect(liveRevolutionOf(g, p1)).toBeNull();
    }
    for (let k = 0; k < 600 * 20 && outbreak < 0; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'revolution' && e.phase === 'start')) outbreak = g.tick;
    }
    expect(outbreak).toBeGreaterThan(0);
    // Draws fall on the 10-second grid (the step that drew is outbreak - 1).
    expect((outbreak - 1 - g.startTick) % REVOLUTION_CHECK_TICKS).toBe(0);
    const rebels = liveRevolutionOf(g, p1)!;
    expect(rebels.kind).toBe('tribe');
    expect(rebels.revolution).toBe(true);
    expect(rebels.rebelOf).toBe(1);
    expect(rebels.name.fr.startsWith('Révolutionnaires')).toBe(true);
    expect(rebels.troops).toBeGreaterThan(1000);
    const land = tilesOf(g, rebels.id);
    expect(land.length).toBeGreaterThanOrEqual(60);
    const w = g.map.width;
    for (const t of land) {
      const d = Math.hypot((t % w) - (capital % w), ((t / w) | 0) - ((capital / w) | 0));
      expect(d).toBeGreaterThanOrEqual(REVOLUTION_CAPITAL_SAFE - 1);
    }
    expect(p1.revoltReadyTick).toBe(outbreak - 1 + REVOLUTION_COOLDOWN);
    // The victim's journal (danger, with the place) and everyone's.
    expect(g.events.some((e) => e.k === 'notify' && e.key === 'notify.revolution' && e.to === 1)).toBe(true);
    expect(g.events.some((e) => e.k === 'notify' && e.key === 'event.revolution' && e.to === -1)).toBe(true);
  });

  it('off in the lobby (or in a save from before 1.14): never', () => {
    const g = field(170, { features: { revolution: false } as GameConfig['features'] });
    steps(g, REVOLUTION_GRACE + 600 * 10);
    expect([...g.alivePlayers()].some((p) => p.revolution)).toBe(false);
  });

  it('works the same for a nation', () => {
    const g = field(170);
    g.players[1]!.kind = 'nation';
    g.players[2]!.immuneUntil = 1e9; // (the nation would otherwise annex the small human)
    toDraw(g);
    expect(startRevolution(g, g.players[1]!)).not.toBeNull();
  });
});

describe('revolutions: no gold', () => {
  it('rebels hoard nothing; conquering them pays nothing; their buildings burn for a third party', () => {
    const g = field(150);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    toDraw(g);
    const rebels = startRevolution(g, p1)!;
    expect(rebels).not.toBeNull();
    const land = tilesOf(g, rebels.id);
    // A city in the rebel region: idle while the rebels hold it.
    const c = city(g, rebels.id, land[Math.floor(land.length / 2)]!);
    expect(rebels.gold).toBe(0);
    steps(g, 50);
    expect(rebels.gold).toBe(0);
    expect(rebels.income).toBe(0);
    // Player 2 attacks the rebels: its gold only grows by its own passive income.
    const touching = land.find((t) => {
      const nb = new Int32Array(4);
      const n = g.map.neighbors4(t, nb);
      for (let j = 0; j < n; j++) if (g.owner[nb[j]!] === 2) return true;
      return false;
    });
    expect(touching).toBeDefined();
    p2.troops = 2_000_000;
    let passive = 0;
    const gold0 = p2.stats.goldEarned;
    g.step([cmd(2, { t: 'attack', tile: touching!, ratio: 0.9 })]);
    passive += p2.income;
    for (let k = 0; k < 900 && rebels.alive; k++) {
      g.step([]);
      passive += p2.income;
    }
    expect(rebels.alive).toBe(false);
    expect(p2.stats.goldEarned - gold0).toBeCloseTo(passive, 0);
    expect(g.events.every((e) => e.k !== 'loot')).toBe(true);
    // The city did not change hands: burnt.
    expect(c.alive).toBe(false);
  });
});

describe('revolutions: endings', () => {
  it('left alone, the region rejoins its country with its buildings intact and in service', () => {
    const g = field(150);
    const p1 = g.players[1]!;
    toDraw(g);
    const before = p1.tiles;
    const rebels = startRevolution(g, p1)!;
    const land = tilesOf(g, rebels.id);
    // A city in the region, idle under the rebels as the outbreak leaves it.
    const c = city(g, rebels.id, land[Math.floor(land.length / 2)]!);
    c.occupiedLeft = c.occupiedTotal = REVOLUTION_TICKS;
    expect(c.owner).toBe(rebels.id);
    expect(c.level).toBe(1);
    expect(inService(c)).toBe(false);
    let over = false;
    steps(g, REVOLUTION_TICKS + 20, (gg) => {
      if (gg.events.some((e) => e.k === 'notify' && e.key === 'notify.revolutionOver' && e.to === 1))
        over = true;
    });
    expect(over).toBe(true);
    expect(rebels.alive).toBe(false);
    expect(tilesOf(g, rebels.id).length).toBe(0);
    expect(p1.tiles).toBe(before);
    expect(c.alive).toBe(true);
    expect(c.owner).toBe(1);
    expect(inService(c)).toBe(true);
  });

  it('a nation puts down the revolution in its land well before it runs out of steam', () => {
    const g = field(170);
    const p1 = g.players[1]!;
    p1.kind = 'nation';
    p1.troops = 400_000;
    g.players[2]!.immuneUntil = 1e9; // (the nation would otherwise annex the small human)
    toDraw(g);
    const rebels = startRevolution(g, p1)!;
    const start = tilesOf(g, rebels.id).length;
    let crushedAt = -1;
    let attacked = false;
    for (let k = 0; k < REVOLUTION_TICKS - 10 && crushedAt < 0; k++) {
      g.step([]);
      if (g.attacks.some((a) => a.attacker === 1 && a.target === rebels.id)) attacked = true;
      if (g.events.some((e) => e.k === 'revolution' && e.phase === 'crushed')) crushedAt = g.tick;
    }
    expect(start).toBeGreaterThan(100);
    expect(attacked).toBe(true);
    expect(crushedAt).toBeGreaterThan(0);
    expect(rebels.alive).toBe(false);
  });

  it('the rebels push into their former country now and then', () => {
    const g = field(150);
    const p1 = g.players[1]!;
    toDraw(g);
    const rebels = startRevolution(g, p1)!;
    rebels.troops = 50_000;
    let pushed = false;
    for (let k = 0; k < 600 && !pushed; k++) {
      g.step([]);
      pushed = g.attacks.some((a) => a.attacker === rebels.id && a.target === 1);
    }
    expect(pushed).toBe(true);
  });
});

describe('revolutions: determinism', () => {
  const play = (g: Game, n: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      g.step([]);
      out.push(hashGame(g));
    }
    return out;
  };

  it('same seed, same revolutions; a snapshot mid-revolution replays the same future', () => {
    const a = field(170);
    const b = field(170);
    const h1 = play(a, REVOLUTION_GRACE + 600 * 6);
    const h2 = play(b, REVOLUTION_GRACE + 600 * 6);
    expect(h1).toEqual(h2);
    const g = field(170);
    toDraw(g);
    const rebels = startRevolution(g, g.players[1]!)!;
    steps(g, 30);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const r = restoreSnapshot(g.map, snap);
    const rr = r.players[rebels.id]!;
    expect(rr.revolution).toBe(true);
    expect(rr.revoltUntil).toBe(rebels.revoltUntil);
    expect(rr.rebelOf).toBe(1);
    expect(r.players[1]!.revoltReadyTick).toBe(g.players[1]!.revoltReadyTick);
    expect(hashGame(r)).toBe(hashGame(g));
    expect(play(r, REVOLUTION_TICKS)).toEqual(play(g, REVOLUTION_TICKS));
  });

  it('the hash covers the revolution clock', () => {
    const g = field(170);
    toDraw(g);
    const rebels = startRevolution(g, g.players[1]!) as Player;
    const h = hashGame(g);
    rebels.revoltUntil += 1;
    expect(hashGame(g)).not.toBe(h);
  });

  it('updateRevolutions draws nothing while no country qualifies', () => {
    const g = field(96);
    toDraw(g);
    const rng = g.rng.getState().slice();
    updateRevolutions(g);
    expect(g.rng.getState()).toEqual(rng);
  });
});
