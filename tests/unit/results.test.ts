// The final edition, page 2: the ranking and the reader's figures from the final stats.
import { describe, expect, it } from 'vitest';
import {
  maxOf,
  newAwards,
  outcomeOf,
  rankPlayers,
  shownRows,
  sortRows,
  sparkline,
} from '../../src/ui/hud/results';
import type { FinalStats } from '../../src/engine/protocol';

type P = FinalStats['players'][number];
const stat = (o: Partial<P['stats']> = {}): P['stats'] => ({
  tilesConquered: 0,
  tilesLost: 0,
  buildingsBuilt: 0,
  shipsSunk: 0,
  shipsLost: 0,
  nukesLaunched: 0,
  nukesIntercepted: 0,
  goldEarned: 0,
  tradeGold: 0,
  trainGold: 0,
  troopsLost: 0,
  enemiesKilled: 0,
  maxTiles: 0,
  betrayals: 0,
  ...o,
});
function player(id: number, o: Partial<P> = {}): P {
  return {
    id,
    name: { fr: `P${id}`, en: `P${id}` },
    kind: 'nation',
    color: 0,
    flagSeed: id,
    iso: '',
    team: 0,
    alive: true,
    tiles: 100,
    stats: stat(),
    history: [{ tick: 900, tiles: 100, gold: 5000, troops: 20000 }],
    eliminatedTick: -1,
    ...o,
  };
}
const game = (players: P[], o: Partial<FinalStats> = {}): FinalStats => ({
  players,
  tick: 6600,
  startTick: 600,
  winner: -1,
  winnerTeam: -1,
  reason: 'territory',
  ...o,
});

describe('rankPlayers', () => {
  it('puts the winner first, then the standing by territory, then the fallen, last to fall first', () => {
    const s = game(
      [
        player(1, { tiles: 500 }),
        player(2, { tiles: 900 }),
        player(3, { alive: false, tiles: 0, eliminatedTick: 3000 }),
        player(4, { alive: false, tiles: 0, eliminatedTick: 4200 }),
        player(5, { tiles: 50 }),
      ],
      { winner: 1 },
    );
    const rows = rankPlayers(s);
    expect(rows.map((r) => r.p.id)).toEqual([1, 2, 5, 4, 3]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.winner).toBe(true);
    expect(rows[1]!.winner).toBe(false);
    // The fallen: no troops nor gold, the time of the fall since the start of play.
    const fallen = rows.find((r) => r.p.id === 4)!;
    expect(fallen.troops).toBe(0);
    expect(fallen.gold).toBe(0);
    expect(fallen.fellAt).toBe(3600);
    expect(rows[0]!.troops).toBe(20000);
    expect(rows[0]!.fellAt).toBe(-1);
  });

  it('ranks the winning team first, the named winner at its head', () => {
    const s = game(
      [
        player(1, { team: 1, tiles: 300 }),
        player(2, { team: 2, tiles: 800 }),
        player(3, { team: 2, tiles: 200 }),
        player(4, { team: 1, tiles: 700 }),
      ],
      { winner: 4, winnerTeam: 1 },
    );
    const rows = rankPlayers(s);
    expect(rows.map((r) => r.p.id)).toEqual([4, 1, 2, 3]);
    expect(rows.filter((r) => r.winner).map((r) => r.p.id)).toEqual([4, 1]);
  });
});

describe('sorting and the rows shown', () => {
  const s = game(
    [
      player(1, { tiles: 900, stats: stat({ enemiesKilled: 10, nukesLaunched: 1 }) }),
      player(2, { tiles: 500, stats: stat({ enemiesKilled: 99 }) }),
      player(3, { tiles: 300, stats: stat({ enemiesKilled: 50, nukesLaunched: 4 }) }),
    ],
    { winner: 1 },
  );
  const rows = rankPlayers(s);
  it('sorts a column biggest first, the ranking back in rank order', () => {
    expect(sortRows(rows, 'kills').map((r) => r.p.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, 'nukes').map((r) => r.p.id)).toEqual([3, 1, 2]);
    expect(sortRows(sortRows(rows, 'kills'), 'rank').map((r) => r.p.id)).toEqual([1, 2, 3]);
    expect(maxOf(rows, 'tiles')).toBe(900);
  });
  it('keeps the reader in view below the top of a long table', () => {
    const many = rankPlayers(game(Array.from({ length: 20 }, (_, k) => player(k + 1, { tiles: 1000 - k }))));
    const shown = shownRows(many, 18, 12);
    expect(shown).toHaveLength(13);
    expect(shown.at(-1)!.p.id).toBe(18);
    expect(shownRows(many, 3, 12)).toHaveLength(12);
    // A table just one row too long is printed whole.
    expect(shownRows(many.slice(0, 13), 99, 12)).toHaveLength(13);
  });
});

describe('outcome, awards, sparkline', () => {
  const s = game([player(1), player(2)], { winner: 2 });
  it('names the result from the reader’s side', () => {
    expect(outcomeOf(s, 2, true)).toBe('victory');
    expect(outcomeOf(s, 1, false)).toBe('defeat');
    expect(outcomeOf(s, -1, false)).toBe('winnerIs');
    expect(outcomeOf(game([player(1)]), -1, false)).toBe('none');
  });
  it('lists the achievements this game unlocked', () => {
    expect(newAwards(['firstGame'], ['firstGame', 'firstWin', 'loyal'])).toEqual(['firstWin', 'loyal']);
    expect(newAwards(['a'], ['a'])).toEqual([]);
  });
  it('draws a series in its box', () => {
    expect(sparkline([0, 5, 10], 100, 20, 0)).toBe('0.0,20.0 50.0,10.0 100.0,0.0');
    expect(sparkline([0, 10], 100, 20)).toBe('0.0,20.0 100.0,3.0');
    expect(sparkline([3], 100, 20)).toBe('');
  });
});
