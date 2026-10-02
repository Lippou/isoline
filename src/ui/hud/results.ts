// Page 2 of the final edition: the results table and the reader's figures, from the
// final statistics. Pure logic (no Svelte store, no i18n).
import type { FinalStats } from '../../engine/protocol';

export type FinalPlayer = FinalStats['players'][number];

export interface ResultRow {
  p: FinalPlayer;
  /** Final rank (1 = the winner). */
  rank: number;
  winner: boolean;
  /** Troops and gold at the end (last sample; 0 once fallen). */
  troops: number;
  gold: number;
  /** Ticks since the start of play when it fell (-1: standing at the end). */
  fellAt: number;
}

/** Columns the table can be sorted by. */
export type SortKey = 'rank' | 'tiles' | 'troops' | 'gold' | 'kills' | 'buildings' | 'nukes';

const isWinner = (s: FinalStats, p: FinalPlayer) =>
  p.id === s.winner || (s.winnerTeam > 0 && p.team === s.winnerTeam);

/**
 * The final ranking: the winner (or the winning team, its biggest first), then the
 * nations standing at the end by territory, then the fallen, the last to fall first.
 * Troops and gold come from `live` (the client's view at the end) when given, else from
 * the last history sample.
 */
export function rankPlayers(
  stats: FinalStats,
  live?: (id: number) => { troops: number; gold: number } | undefined,
): ResultRow[] {
  const sorted = stats.players
    .slice()
    .sort(
      (a, b) =>
        Number(isWinner(stats, b)) - Number(isWinner(stats, a)) ||
        Number(b.id === stats.winner) - Number(a.id === stats.winner) ||
        Number(b.alive) - Number(a.alive) ||
        b.tiles - a.tiles ||
        b.eliminatedTick - a.eliminatedTick ||
        b.stats.maxTiles - a.stats.maxTiles,
    );
  return sorted.map((p, k) => {
    const last = live?.(p.id) ?? p.history.at(-1);
    return {
      p,
      rank: k + 1,
      winner: isWinner(stats, p),
      troops: p.alive ? (last?.troops ?? 0) : 0,
      gold: p.alive ? (last?.gold ?? 0) : 0,
      fellAt: !p.alive && p.eliminatedTick >= 0 ? Math.max(0, p.eliminatedTick - stats.startTick) : -1,
    };
  });
}

const METRIC: Record<Exclude<SortKey, 'rank'>, (r: ResultRow) => number> = {
  tiles: (r) => r.p.tiles,
  troops: (r) => r.troops,
  gold: (r) => r.gold,
  kills: (r) => r.p.stats.enemiesKilled,
  buildings: (r) => r.p.stats.buildingsBuilt,
  nukes: (r) => r.p.stats.nukesLaunched,
};

/** The table sorted by a column (biggest first; ties keep the ranking). */
export function sortRows(rows: ResultRow[], key: SortKey): ResultRow[] {
  if (key === 'rank') return rows.slice().sort((a, b) => a.rank - b.rank);
  const f = METRIC[key];
  return rows.slice().sort((a, b) => f(b) - f(a) || a.rank - b.rank);
}

/** The first `limit` rows, plus the reader's own row when it is further down. */
export function shownRows(rows: ResultRow[], viewer: number, limit: number): ResultRow[] {
  if (rows.length <= limit + 1) return rows;
  const top = rows.slice(0, limit);
  const mine = rows.find((r) => r.p.id === viewer);
  return mine && !top.includes(mine) ? [...top, mine] : top;
}

/** Biggest value of a column (for the bars beside the territory). */
export const maxOf = (rows: ResultRow[], key: Exclude<SortKey, 'rank'>): number =>
  Math.max(1, ...rows.map(METRIC[key]));

/** What the reader's result is called on page 2. */
export type Outcome = 'victory' | 'defeat' | 'winnerIs' | 'none';

export function outcomeOf(stats: FinalStats, viewer: number, won: boolean): Outcome {
  if (viewer > 0 && stats.players.some((p) => p.id === viewer)) return won ? 'victory' : 'defeat';
  return stats.winner > 0 ? 'winnerIs' : 'none';
}

/**
 * Achievements unlocked by this game: the ids present after the profile recorded it
 * and not before (order of the catalogue kept).
 */
export function newAwards(before: Iterable<string>, after: Iterable<string>): string[] {
  const had = new Set(before);
  return [...after].filter((id) => !had.has(id));
}

/**
 * Points of a history series, scaled to a w × h box (SVG polyline) from 0 at the bottom
 * to the peak `pad` below the top, for a sparkline.
 */
export function sparkline(values: number[], w: number, h: number, pad = 3): string {
  if (values.length < 2) return '';
  const max = Math.max(1, ...values);
  return values
    .map((v, k) => `${((k / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - pad)).toFixed(1)}`)
    .join(' ');
}
