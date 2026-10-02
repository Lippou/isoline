// The capital, an Isoline rule (OpenFront has none): every human and nation governs
// from its spawn tile. Losing that tile — conquered, annexed, landed on or razed by a
// nuke — disorganises the country for a minute (slower troop growth, less passive gold,
// slower attacks) and costs the treasury kept there (seized by the conqueror, burnt by a
// bomb). The country then chooses a new seat itself: humans with the 'moveCapital'
// command, nations automatically after a short delay. Until then a lingering malus on
// the passive income makes it worth doing.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  CAPITAL_AI_DELAY,
  CAPITAL_DISORG_GOLD,
  CAPITAL_DISORG_GROWTH,
  CAPITAL_DISORG_SPEED,
  CAPITAL_DISORG_TICKS,
  CAPITAL_FRONT_GAP,
  CAPITAL_LOOT,
  CAPITAL_MOVE_COOLDOWN,
  CAPITAL_NONE_GOLD,
  LOYALTY_MAX,
  sec,
} from '../game/constants';
import { IS_LAND } from '../map/terrain';
import { addGold } from '../game/economy';

/** Why a tile cannot host the capital ('ok' when it can). */
export type CapitalSpotError = 'ok' | 'notOwned' | 'fallout' | 'front';
/** Outcome of a 'moveCapital' order. */
export type CapitalMoveResult = CapitalSpotError | 'cooldown' | 'same' | 'phase';

/** What the placement check reads: the simulation's arrays, or the client's mirror of them. */
export interface CapitalSpotView {
  owner: ArrayLike<number>;
  terrain: ArrayLike<number>;
  fallout: ArrayLike<number>;
  flags: ArrayLike<number>;
  width: number;
  height: number;
}

/** Nations retry every 5 s when no spot fits (a thin country squeezed between enemies). */
const AI_RETRY = sec(5);
/** Interior depth (tiles) beyond which a spot is "safe enough": the score stops growing. */
const SAFE_DEPTH = 40;
/** Cities considered as new seats (the highest levels first). */
const MAX_CITY_CANDIDATES = 12;

/**
 * Whether `pid` may hold its capital on `tile`: its own land, free of fallout, more
 * than CAPITAL_FRONT_GAP tiles (square rings) from any foreign land — wilderness, allies
 * and teammates excepted. Pure: the simulation and the client's preview share it.
 */
export function capitalSpotError(
  view: CapitalSpotView,
  tile: number,
  pid: number,
  friendly: (owner: number) => boolean,
): CapitalSpotError {
  const { width: w, height: h, owner } = view;
  if (tile < 0 || tile >= w * h || owner[tile] !== pid || !IS_LAND[view.terrain[tile]!]) return 'notOwned';
  if (view.fallout[tile]! > 0 || (view.flags[tile]! & 1) === 1) return 'fallout';
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  const gap = CAPITAL_FRONT_GAP;
  for (let y = Math.max(0, y0 - gap); y <= Math.min(h - 1, y0 + gap); y++) {
    for (let x = Math.max(0, x0 - gap); x <= Math.min(w - 1, x0 + gap); x++) {
      const o = owner[y * w + x]!;
      if (o !== 0 && o !== pid && !friendly(o)) return 'front';
    }
  }
  return 'ok';
}

function spotView(game: Game): CapitalSpotView {
  const m = game.map;
  return {
    owner: game.owner,
    terrain: m.terrain,
    fallout: game.fallout,
    flags: game.flags,
    width: m.width,
    height: m.height,
  };
}

export function spotError(game: Game, p: Player, tile: number): CapitalSpotError {
  return capitalSpotError(spotView(game), tile, p.id, (o) => game.friendly(p.id, o));
}

// ------------------------------------------------------------- modifiers
export function isDisorganised(game: Game, p: Player): boolean {
  return p.disorgUntil > game.tick;
}

/** Troop growth multiplier (gains only). */
export function capitalGrowthMult(game: Game, p: Player): number {
  return p.disorgUntil > game.tick ? CAPITAL_DISORG_GROWTH : 1;
}

/** Passive gold multiplier: disorganised, or still without the capital lost earlier. */
export function capitalGoldMult(game: Game, p: Player): number {
  if (p.disorgUntil > game.tick) return CAPITAL_DISORG_GOLD;
  return p.capital < 0 && p.capitalLostTick >= 0 ? CAPITAL_NONE_GOLD : 1;
}

/** Attack speed multiplier (divides the cost of every tile a front takes). */
export function capitalSpeedMult(game: Game, p: Player): number {
  return p.disorgUntil > game.tick ? CAPITAL_DISORG_SPEED : 1;
}

/** Ticks before p may move the capital it holds again (0: now; a lost one is re-established at once). */
export function capitalCooldown(game: Game, p: Player): number {
  if (p.capital < 0 || p.capitalSetTick < 0) return 0;
  return Math.max(0, p.capitalSetTick + CAPITAL_MOVE_COOLDOWN - game.tick);
}

// ------------------------------------------------------------ placement
function establish(game: Game, p: Player, tile: number, stamp: boolean): void {
  p.capital = tile;
  p.capitalLostTick = -1;
  if (stamp) p.capitalSetTick = game.tick;
  // The seat of government never secedes (loyalty, §15).
  game.loyalty[tile] = LOYALTY_MAX;
}

/** Game start: every human and nation governs from its spawn tile (tribes have no capital). */
export function assignCapitals(game: Game): void {
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe' || p.tiles === 0) continue;
    const tile = p.spawnTile >= 0 && game.owner[p.spawnTile] === p.id ? p.spawnTile : legacyCapital(game, p);
    if (tile >= 0) establish(game, p, tile, false);
  }
}

/**
 * Saves from before capitals existed: the largest city, else the country's centre
 * (its label point, roughly), else the spawn tile, else the safest spot found.
 */
export function legacyCapital(game: Game, p: Player): number {
  let best = -1;
  let level = 0;
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.City && b.level > level && game.owner[b.tile] === p.id) {
      best = b.tile;
      level = b.level;
    }
  if (best >= 0) return best;
  const c = centreTile(game, p);
  if (c >= 0 && game.owner[c] === p.id) return c;
  if (p.spawnTile >= 0 && game.owner[p.spawnTile] === p.id) return p.spawnTile;
  return bestCapitalSpot(game, p);
}

/** Old saves restored without capitals: give every living country one. */
export function migrateCapitals(game: Game): void {
  if (game.phase === 'spawn') return;
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe' || p.tiles === 0 || p.capital >= 0) continue;
    const tile = legacyCapital(game, p);
    if (tile >= 0) establish(game, p, tile, false);
  }
}

function centreTile(game: Game, p: Player): number {
  const m = game.map;
  const [cx, cy] = p.centroid(m.width);
  const x = Math.max(0, Math.min(m.width - 1, Math.round(cx)));
  const y = Math.max(0, Math.min(m.height - 1, Math.round(cy)));
  return y * m.width + x;
}

/** Distance (square rings, up to `max`; max + 1 beyond) from `tile` to foreign land that is not p's friend. */
export function frontDistance(game: Game, p: Player, tile: number, max: number): number {
  const m = game.map;
  const w = m.width;
  const h = m.height;
  const own = game.owner;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  const hostile = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const o = own[y * w + x]!;
    return o !== 0 && o !== p.id && !game.friendly(p.id, o);
  };
  for (let r = 1; r <= max; r++) {
    for (let d = -r; d <= r; d++) {
      if (hostile(x0 + d, y0 - r) || hostile(x0 + d, y0 + r)) return r;
      if (d > -r && d < r && (hostile(x0 - r, y0 + d) || hostile(x0 + r, y0 + d))) return r;
    }
  }
  return max + 1;
}

/**
 * The safest seat for a new capital: among p's largest completed cities, its centre,
 * its spawn tile and a few points between its border and its centre, the valid spot
 * deepest inside its land (up to SAFE_DEPTH tiles from foreign land), with a bonus of
 * 3 tiles per city level. -1 when no candidate fits. Deterministic (no RNG).
 */
export function bestCapitalSpot(game: Game, p: Player): number {
  const w = game.map.width;
  const cands: [number, number][] = [];
  const cities = [...game.buildings.values()]
    .filter((b) => b.owner === p.id && b.type === B.City && b.buildLeft === 0)
    .sort((a, b) => b.level - a.level || a.id - b.id)
    .slice(0, MAX_CITY_CANDIDATES);
  for (const b of cities) cands.push([b.tile, 3 * b.level]);
  const centre = centreTile(game, p);
  cands.push([centre, 0]);
  if (p.spawnTile >= 0) cands.push([p.spawnTile, 0]);
  const border = p.border;
  const cx = centre % w;
  const cy = (centre / w) | 0;
  for (let k = 0; k < 8 && border.length > 0; k++) {
    const b = border[Math.floor(((k + 0.5) / 8) * border.length)]!;
    const bx = b % w;
    const by = (b / w) | 0;
    for (const f of [0.35, 0.65])
      cands.push([Math.round(by + (cy - by) * f) * w + Math.round(bx + (cx - bx) * f), 0]);
  }
  let best = -1;
  let bestScore = -1;
  for (const [tile, bonus] of cands) {
    if (spotError(game, p, tile) !== 'ok') continue;
    const score = Math.min(SAFE_DEPTH, frontDistance(game, p, tile, SAFE_DEPTH)) + bonus;
    if (score > bestScore || (score === bestScore && tile < best)) {
      best = tile;
      bestScore = score;
    }
  }
  return best;
}

/** The 'moveCapital' command: establish the capital on one of p's tiles (see capitalSpotError). */
export function moveCapital(game: Game, p: Player, tile: number): CapitalMoveResult {
  if (game.phase !== 'playing' || p.kind === 'tribe' || !p.alive) return 'phase';
  if (tile === p.capital) return 'same';
  const err = spotError(game, p, tile);
  if (err !== 'ok') return err;
  if (capitalCooldown(game, p) > 0) return 'cooldown';
  establish(game, p, tile, true);
  game.emit({ k: 'capitalMoved', player: p.id, tile });
  game.notify(p.id, 'notify.capitalMoved', 'good', {}, tile);
  return 'ok';
}

// ---------------------------------------------------------------- ticking
/** Called by Game.setOwner when a capital tile changes hands: handled at the end of the tick. */
export function capitalTileTaken(game: Game, tile: number, loser: number, by: number): void {
  game.capitalFalls.push(tile, loser, by);
}

/**
 * The capital of `loser` fell to `by` (0: razed): disorganisation, treasury lost, news.
 * A country eliminated in the same tick just loses it (its fall makes the news).
 */
function fall(game: Game, tile: number, loserId: number, by: number): void {
  const p = game.players[loserId];
  if (!p || p.capital !== tile || game.owner[tile] === p.id) return;
  p.capital = -1;
  p.capitalLostTick = game.tick;
  if (!p.alive) return;
  p.disorgUntil = game.tick + CAPITAL_DISORG_TICKS;
  const q = by > 0 ? game.players[by] : null;
  const conqueror = q && q.alive && q.id !== p.id ? q : null;
  p.capitalLostBy = conqueror?.id ?? 0;
  const gold = Math.floor(Math.max(0, p.gold) * CAPITAL_LOOT);
  p.gold -= gold;
  const w = game.map.width;
  if (conqueror && gold > 0) {
    addGold(conqueror, gold);
    game.emit({ k: 'loot', x: tile % w, y: (tile / w) | 0, owner: conqueror.id, amount: gold });
  }
  game.emit({ k: 'capitalLost', player: p.id, by: conqueror?.id ?? 0, tile, gold });
  if (conqueror) {
    game.notify(p.id, 'notify.capitalLost', 'danger', { by: conqueror.id, gold }, tile);
    game.notify(conqueror.id, 'notify.capitalTaken', 'good', { player: p.id, gold }, tile);
    game.notify(-1, 'event.capitalFell', 'info', { player: p.id, by: conqueror.id }, tile);
  } else {
    game.notify(p.id, 'notify.capitalRazed', 'danger', { gold }, tile);
    game.notify(-1, 'event.capitalRazed', 'info', { player: p.id }, tile);
  }
}

/** Every tick (playing): capitals that fell this tick, then nations re-establishing theirs. */
export function updateCapitals(game: Game): void {
  const falls = game.capitalFalls;
  if (falls.length > 0) {
    for (let k = 0; k + 2 < falls.length; k += 3) fall(game, falls[k]!, falls[k + 1]!, falls[k + 2]!);
    falls.length = 0;
  }
  for (const p of game.alivePlayers()) {
    if (p.kind !== 'nation' || p.capital >= 0 || p.capitalLostTick < 0) continue;
    const since = game.tick - p.capitalLostTick;
    if (since < CAPITAL_AI_DELAY || (since - CAPITAL_AI_DELAY) % AI_RETRY !== 0) continue;
    const tile = bestCapitalSpot(game, p);
    if (tile < 0) continue;
    establish(game, p, tile, true);
    game.emit({ k: 'capitalMoved', player: p.id, tile });
  }
}
