// Threat awareness shared by the nations (deterministic, part of the AI state): who is
// running away with the map, how fast everyone grows, how many fronts each country fights
// on, and the clock of the coalition's strikes against the runaway. OpenFront's nations
// notice a "runaway leader" (land ≥ 3× / 2× / 1.5× the runner-up's by difficulty) and gang
// up on it; Isoline's also notice a country that snowballs (land growing fast while it
// already leads), and time their offensives together so that it is hit from every side at
// once instead of one neighbour after another.
import type { Game } from '../game/state';
import { TACTICS } from './tactics';
import { hash2 } from '../rng';

/** Ticks between two assessments, and between two land samples (growth). */
export const THREAT_PERIOD = 50;
export const LAND_SAMPLE = 300;
/** Land samples kept per country (LAND_SAMPLES × LAND_SAMPLE = 3 min of history). */
export const LAND_SAMPLES = 6;
/** A leader whose land grew this much over the last 2 min is snowballing… */
export const SNOWBALL_GROWTH = 1.5;
/** …and counts as a runaway from this share of the usual ratio to the runner-up. */
export const SNOWBALL_RATIO = 0.6;
/** A runaway is dropped once its lead falls under this share of the detection ratio. */
export const RUNAWAY_RELEASE = 0.7;
/** Seconds between the detection of a runaway and the coalition's first strike. */
export const STRIKE_PREP = 20;
/** Length of a strike window, in ticks: every coalition member thinks at least once in it. */
export const STRIKE_WINDOW = 100;

export interface ThreatState {
  /** Tick of the last assessment. */
  at: number;
  /** Useful tiles per country, newest first, one sample every LAND_SAMPLE ticks. */
  land: Map<number, number[]>;
  /** The country running away with the map (-1: none), and since when. */
  runaway: number;
  since: number;
  /** Next coalition strike window against the runaway: [strikeAt, strikeUntil). */
  strikeAt: number;
  strikeUntil: number;
  /** Distinct countries each country is attacking right now (tribes and wilderness aside). */
  fronts: Map<number, number>;
}

export function createThreatState(): ThreatState {
  return {
    at: -THREAT_PERIOD,
    land: new Map(),
    runaway: -1,
    since: -1,
    strikeAt: -1,
    strikeUntil: -1,
    fronts: new Map(),
  };
}

/** Modes where every country plays for itself (OpenFront's crown logic is FFA-only). */
export function solo(game: Game): boolean {
  const m = game.config.mode;
  return m === 'ffa' || m === 'doomsday' || m === 'battleRoyale';
}

/** Land growth of `id` over the last `samples` land samples (1: none; 0 when unknown). */
export function growth(t: ThreatState, id: number, samples = 4): number {
  const h = t.land.get(id);
  if (!h || h.length <= samples) return 0;
  return h[0]! / Math.max(1, h[samples]!);
}

/** Refresh the shared threat picture (every THREAT_PERIOD ticks). Cost ≈ players + attacks. */
export function assessThreats(game: Game): void {
  const t = (game.ai.threat ??= createThreatState());
  if (game.tick - t.at < THREAT_PERIOD) return;
  t.at = game.tick;
  const tactics = TACTICS[game.config.difficulty];

  // Fronts: distinct countries attacked by each country.
  const fr = new Map<number, Set<number>>();
  for (const a of game.attacks) {
    if (a.done || a.target <= 0 || game.players[a.target]!.kind === 'tribe') continue;
    let s = fr.get(a.attacker);
    if (!s) fr.set(a.attacker, (s = new Set()));
    s.add(a.target);
  }
  t.fronts.clear();
  for (const [id, s] of fr) t.fronts.set(id, s.size);

  // Land history (growth).
  const sample = game.tick % LAND_SAMPLE < THREAT_PERIOD;
  let leader = -1;
  let lead = -1;
  let second = 0;
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe') continue;
    if (sample) {
      let h = t.land.get(p.id);
      if (!h) t.land.set(p.id, (h = []));
      h.unshift(p.usefulTiles);
      if (h.length > LAND_SAMPLES + 1) h.length = LAND_SAMPLES + 1;
    }
    if (p.usefulTiles > lead) {
      second = Math.max(second, lead);
      lead = p.usefulTiles;
      leader = p.id;
    } else if (p.usefulTiles > second) second = p.usefulTiles;
  }
  if (sample) for (const id of [...t.land.keys()]) if (!game.players[id]?.alive) t.land.delete(id);

  // The runaway (OpenFront's findRunawayLeader, plus the snowball): land well ahead of the
  // runner-up, or ahead and growing half again in two minutes.
  if (tactics.runaway <= 0 || !solo(game) || leader < 0) {
    t.runaway = -1;
    return;
  }
  const share = lead / Math.max(1, game.usefulLand);
  const ratio = lead / Math.max(1, second);
  const g = growth(t, leader);
  const prev = t.runaway;
  let runaway = -1;
  if (share >= tactics.runawayShare) {
    if (ratio >= tactics.runaway) runaway = leader;
    else if (ratio >= tactics.runaway * SNOWBALL_RATIO && g >= SNOWBALL_GROWTH) runaway = leader;
    // Hysteresis: a runaway already singled out stays so until its lead melts.
    else if (prev === leader && ratio >= tactics.runaway * RUNAWAY_RELEASE) runaway = leader;
  }
  if (runaway !== prev) {
    t.runaway = runaway;
    t.since = game.tick;
    t.strikeAt = runaway >= 0 ? game.tick + STRIKE_PREP * 10 : -1;
    t.strikeUntil = runaway >= 0 ? t.strikeAt + STRIKE_WINDOW : -1;
  } else if (runaway >= 0 && game.tick >= t.strikeUntil) {
    t.strikeAt = t.strikeUntil + tactics.strikeEvery * 10;
    t.strikeUntil = t.strikeAt + STRIKE_WINDOW;
  }
}

/** The runaway country (-1: none). */
export function runawayOf(game: Game): number {
  const r = game.ai.threat?.runaway ?? -1;
  return r > 0 && game.players[r]?.alive ? r : -1;
}

/** Whether the coalition's strike window is open now. */
export function striking(game: Game): boolean {
  const t = game.ai.threat;
  return !!t && t.runaway > 0 && game.tick >= t.strikeAt && game.tick < t.strikeUntil;
}

/** Ticks until the next strike window opens (0 when open, Infinity when there is none). */
export function untilStrike(game: Game): number {
  const t = game.ai.threat;
  if (!t || t.runaway <= 0) return Infinity;
  return Math.max(0, t.strikeAt - game.tick);
}

/** Distinct countries `id` is attacking now (tribes and wilderness aside). */
export function frontsOf(game: Game, id: number): number {
  return game.ai.threat?.fronts.get(id) ?? 0;
}

/**
 * Whether nation `id` joins the coalition against `runaway` (a deterministic share of
 * the nations, TACTICS.coalition: half of them on normal, all of them from hard).
 */
export function joinsCoalition(game: Game, id: number, runaway: number): boolean {
  const share = TACTICS[game.config.difficulty].coalition;
  if (share <= 0 || runaway <= 0 || id === runaway) return false;
  if (share >= 1) return true;
  return hash2(id, runaway, game.config.seed) % 1000 < share * 1000;
}
