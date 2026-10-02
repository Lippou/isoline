// Economy balance (play-test, 5th batch: "17 M troops in 20 min shouldn't be possible").
// One deterministic 20-minute AI game on the Black Sea pins the targets loosely. With
// OpenFront's ceilings and payouts this game had, at 20 min: strongest army 8.7 M (ceiling
// 16.6 M), median nation 2.3 M, 76 M of trade and train gold per nation. Now: 2.9 M
// (ceiling 3.4 M), 0.56 M, 40 M.
import { describe, expect, it } from 'vitest';
import { makeGame, mapFromDisk, run } from '../helpers';

describe('economy balance', () => {
  it('after 20 min of AI play the strongest army stays in the low millions', () => {
    const g = makeGame('black-sea', {
      nations: mapFromDisk('black-sea').meta.nations.length,
      tribes: 40,
      players: [],
      seed: 1234,
    });
    while (g.phase !== 'playing') g.step([]);
    run(g, 20 * 600);
    const nations = [...g.alivePlayers()]
      .filter((p) => p.kind === 'nation')
      .sort((a, b) => b.troops - a.troops);
    const top = nations[0]!;
    const median = nations[Math.floor(nations.length / 2)]!;
    const tradeAndTrains =
      nations.reduce((s, p) => s + p.stats.tradeGold + p.stats.trainGold, 0) / nations.length;
    expect(top.troops).toBeGreaterThan(1_000_000);
    expect(top.troops).toBeLessThan(5_000_000);
    expect(top.popCap).toBeLessThan(7_000_000);
    expect(median.troops).toBeGreaterThan(150_000);
    expect(median.troops).toBeLessThan(2_000_000);
    expect(tradeAndTrains).toBeLessThan(60_000_000);
  });
});
