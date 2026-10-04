// Economy balance (play-test, 5th batch: "17 M troops in 20 min shouldn't be possible").
// One deterministic 20-minute AI game on the Black Sea pins the targets loosely. With
// OpenFront's ceilings and payouts this game had, at 20 min: strongest army 8.7 M (ceiling
// 16.6 M), median nation 2.3 M, 76 M of trade and train gold per nation. Now: 2.9 M
// (ceiling 3.4 M), 0.56 M, 40 M.
import { describe, expect, it } from 'vitest';
import { makeGame, mapFromDisk, run } from '../helpers';
import type { Player } from '../../src/core/game/player';

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

  it('late-game trade and train income saturates (1.11: trade capacity, one pay per station)', () => {
    // Play-test: « je gagne 300 000 or par seconde ». In this game, from minute 20 to the end,
    // the best minute of trade and train gold of any nation was 254k/s (219k/s of trade:
    // whoever held the most ports took a growing share of world trade) before 1.11; now 63k/s
    // (49k/s of trade).
    const g = makeGame('black-sea', {
      nations: mapFromDisk('black-sea').meta.nations.length,
      tribes: 40,
      players: [],
      seed: 1234,
    });
    while (g.phase !== 'playing') g.step([]);
    run(g, 20 * 600);
    let peak = 0;
    let peakTrade = 0;
    for (let minute = 20; minute < 40 && g.phase === 'playing'; minute++) {
      const flow = (p: Player) => p.stats.tradeGold + p.stats.trainGold;
      const before = new Map([...g.alivePlayers()].map((p) => [p.id, [flow(p), p.stats.tradeGold]] as const));
      run(g, 600);
      for (const p of g.alivePlayers()) {
        if (p.kind !== 'nation') continue;
        const [earned, trade] = before.get(p.id) ?? [flow(p), p.stats.tradeGold];
        peak = Math.max(peak, (flow(p) - earned) / 60);
        peakTrade = Math.max(peakTrade, (p.stats.tradeGold - trade) / 60);
      }
    }
    expect(peak).toBeLessThan(120_000);
    expect(peakTrade).toBeLessThan(80_000);
  });
});
