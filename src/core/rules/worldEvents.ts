// World events (GAME_DESIGN.md §12): every 4–6 minutes the world is hit by one event, the
// same for everybody, with one clear effect for a minute or two. The picker never repeats the
// last event and prefers the ones least recently seen, so a game shows many different ones.
// Everything here is deterministic (the game's rng, building and player order).
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import { B, sec, min } from '../game/constants';
import { inService } from '../buildings/building';
import { IS_LAND, Resource, T } from '../map/terrain';

export const WORLD_EVENTS = [
  'crisis',
  'pandemic',
  'boom',
  'solarStorm',
  'peaceSummit',
  // 1.16: more variety, not more often.
  'earthquake',
  'volcano',
  'hurricane',
  'harshWinter',
  'oilShock',
  'mutiny',
  'armsRace',
  'railStrike',
  'breakthrough',
  'publicWorks',
  'worldGames',
] as const;
export type WorldEventId = (typeof WORLD_EVENTS)[number];

/** Good news for everybody (the journal and the HUD chip print them as such). */
export const GOOD_WORLD_EVENTS: ReadonlySet<string> = new Set<WorldEventId>([
  'boom',
  'oilShock',
  'breakthrough',
  'worldGames',
  'publicWorks',
]);

/** How long each world event lasts (the news shows when it began and what is left). */
export const WORLD_EVENT_TICKS: Record<WorldEventId, number> = {
  crisis: min(2),
  pandemic: min(2),
  boom: min(2),
  solarStorm: sec(90),
  peaceSummit: sec(60),
  earthquake: sec(60),
  volcano: min(2),
  hurricane: sec(90),
  harshWinter: min(2),
  oilShock: min(2),
  mutiny: sec(90),
  armsRace: min(2),
  railStrike: sec(90),
  breakthrough: min(2),
  publicWorks: min(2),
  worldGames: min(2),
};

/** The event under way: its end, and the zone it strikes (earthquake, volcano; r = 0: the whole world). */
export interface WorldEventState {
  id: WorldEventId;
  until: number;
  x?: number;
  y?: number;
  r?: number;
}

// ------------------------------------------------------------------ numbers
/** Mutinies: no single order (attack or landing) may commit more than this share of the army. */
export const MUTINY_CAP = 0.25;
/** Harsh winter: conquering cold land (tundra, hills, mountains, glaciers, peaks) takes this much longer. */
export const WINTER_SLOWDOWN = 1.5;
/** Oil shock: oil deposits pay this much more. */
export const OIL_SHOCK_MULT = 2;
/** Scientific breakthrough: research centres produce this much more. */
export const BREAKTHROUGH_MULT = 1.5;
/** Arms race: silos and SAM batteries are built and upgraded this much faster. */
export const ARMS_RACE_SPEED = 2;
/** Public works: cities, ports and factories are built and upgraded this much faster. */
export const PUBLIC_WORKS_SPEED = 2;
/** World Games: every nation's opinion of every country rises at once by this… */
export const GAMES_GOODWILL = 20;
/** …then by this every second while the Games last (offsets the easing back to neutral). */
export const GAMES_GOODWILL_PER_SEC = 0.5;
/** Earthquake: radius (tiles) as a share of the map's size, within bounds. */
export const QUAKE_RADIUS_K = 0.03;
export const QUAKE_RADIUS_MIN = 20;
export const QUAKE_RADIUS_MAX = 70;
/** Volcanic ash cloud: × the earthquake's radius. */
export const ASH_RADIUS_MULT = 1.5;

/** Land slowed by a harsh winter. */
const COLD = new Uint8Array(13);
for (const t of [T.Tundra, T.Hills, T.Mountain, T.Glacier, T.Peaks]) COLD[t] = 1;

// ------------------------------------------------------------------ queries
/** Whether world event `id` is under way. */
export function eventOn(game: Game, id: WorldEventId): boolean {
  const e = game.features.event;
  return !!e && e.id === id && e.until > game.tick;
}

/** Share of the army one order may commit (1: no limit; MUTINY_CAP during mutinies). */
export function attackCap(game: Game): number {
  return eventOn(game, 'mutiny') ? MUTINY_CAP : 1;
}

/** Slowness of conquering terrain `t` (1, or WINTER_SLOWDOWN on cold land in a harsh winter). */
export function winterCost(game: Game, t: number): number {
  return COLD[t] && eventOn(game, 'harshWinter') ? WINTER_SLOWDOWN : 1;
}

/** Multiplier of the gold from oil deposits. */
export function oilMult(game: Game): number {
  return eventOn(game, 'oilShock') ? OIL_SHOCK_MULT : 1;
}

/** Multiplier of the trains' pay at stations (a rail strike: nothing). */
export function trainPayMult(game: Game): number {
  return eventOn(game, 'railStrike') ? 0 : 1;
}

/** Multiplier of research output. */
export function researchMult(game: Game): number {
  return eventOn(game, 'breakthrough') ? BREAKTHROUGH_MULT : 1;
}

/** Construction and upgrade ticks a building of `type` progresses per tick (arms race, public works). */
export function buildRate(game: Game, type: B): number {
  if ((type === B.Silo || type === B.Sam) && eventOn(game, 'armsRace')) return ARMS_RACE_SPEED;
  if ((type === B.City || type === B.Port || type === B.Factory) && eventOn(game, 'publicWorks'))
    return PUBLIC_WORKS_SPEED;
  return 1;
}

/** Ports closed by a hurricane: no merchant sails and no warship is launched. */
export function portsClosed(game: Game): boolean {
  return eventOn(game, 'hurricane');
}

/** The ash cloud of a volcanic eruption under way, null otherwise. */
export function ashCloud(game: Game): { x: number; y: number; r: number } | null {
  const e = game.features.event;
  if (!e || e.id !== 'volcano' || e.until <= game.tick || !e.r) return null;
  return { x: e.x ?? 0, y: e.y ?? 0, r: e.r };
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * k - px, ay + dy * k - py);
}

/** Whether a flight from (ax, ay) to (bx, by) starts, ends or passes in a volcanic ash cloud. */
export function ashBlocks(game: Game, ax: number, ay: number, bx: number, by: number): boolean {
  const c = ashCloud(game);
  return !!c && segmentDistance(c.x, c.y, ax, ay, bx, by) <= c.r;
}

/** Radius (tiles) of an earthquake on this map (the ash cloud: × ASH_RADIUS_MULT). */
export function quakeRadius(width: number, height: number): number {
  return Math.round(
    Math.max(QUAKE_RADIUS_MIN, Math.min(QUAKE_RADIUS_MAX, Math.sqrt(width * height) * QUAKE_RADIUS_K)),
  );
}

// ------------------------------------------------------------------ picker
/** Cold land as a share of the land, per map (cached: the terrain never changes). */
const coldShares = new WeakMap<object, number>();
function coldShare(game: Game): number {
  const m = game.map;
  let s = coldShares.get(m);
  if (s === undefined) {
    let cold = 0;
    let land = 0;
    for (let i = 0; i < m.size; i++) {
      const t = m.terrain[i]!;
      if (!IS_LAND[t]) continue;
      land++;
      if (COLD[t]) cold++;
    }
    s = land > 0 ? cold / land : 0;
    coldShares.set(m, s);
  }
  return s;
}

const countries = (game: Game): Player[] => [...game.alivePlayers()].filter((p) => p.kind !== 'tribe');

/** Whether event `id` would mean anything in this game (its rules and its map). */
export function eventEligible(game: Game, id: WorldEventId): boolean {
  const cfg = game.config;
  switch (id) {
    case 'boom':
      return cfg.allowPorts || cfg.allowFactories;
    case 'solarStorm':
      return cfg.features.radar;
    case 'volcano':
      return cfg.features.air;
    case 'hurricane':
      return cfg.allowPorts;
    case 'harshWinter':
      return coldShare(game) >= 0.03;
    case 'oilShock':
      return cfg.features.resources && game.map.meta.deposits.some((d) => d.type === Resource.Oil);
    case 'armsRace':
      return cfg.allowNukes;
    case 'railStrike':
      return cfg.allowFactories;
    case 'breakthrough':
      return cfg.features.tech;
    case 'worldGames':
      return countries(game).some((p) => p.kind === 'nation');
    default:
      return true;
  }
}

/**
 * The next world event: never the last one again; among the others, one of the least recently
 * seen (never seen first, so every event shows up once before any comes back), at random.
 */
export function pickWorldEvent(game: Game): WorldEventId {
  const f = game.features;
  const seen = (id: WorldEventId) => f.eventSeen[id] ?? -1;
  let pool = WORLD_EVENTS.filter((id) => id !== f.lastEvent && eventEligible(game, id));
  if (pool.length === 0) pool = WORLD_EVENTS.filter((id) => id !== f.lastEvent);
  // Stable order: least recently seen first, then the table's order.
  pool = [...pool].sort((a, b) => seen(a) - seen(b) || WORLD_EVENTS.indexOf(a) - WORLD_EVENTS.indexOf(b));
  // Never seen yet: those first. Then any of the oldest third.
  const unseen = pool.filter((id) => seen(id) < 0);
  const cutoff = seen(pool[Math.max(0, Math.ceil(pool.length / 3) - 1)]!);
  const cands = unseen.length ? unseen : pool.filter((id) => seen(id) <= cutoff);
  return cands[game.rng.int(0, cands.length - 1)]!;
}

// ------------------------------------------------------------------ effects
/** Starts event `id`: its immediate effects, its zone, the news. */
export function startWorldEvent(game: Game, id: WorldEventId, rel: number): void {
  const f = game.features;
  const until = game.tick + WORLD_EVENT_TICKS[id];
  const ev: WorldEventState = { id, until };
  switch (id) {
    case 'crisis':
      f.incomeMult = 0.75;
      break;
    case 'pandemic':
      f.growthMult = 0.5;
      for (const p of game.alivePlayers()) p.troops *= 0.97;
      break;
    case 'boom':
      f.tradeMult = 2;
      break;
    case 'solarStorm':
      f.radarsOffUntil = until;
      break;
    case 'peaceSummit':
      f.ceasefireUntil = Math.max(f.ceasefireUntil, until);
      break;
    case 'earthquake':
      earthquake(game, ev);
      break;
    case 'volcano':
      eruption(game, ev);
      break;
    case 'worldGames':
      goodwill(game, GAMES_GOODWILL);
      break;
    default:
      // The others act while they last (eventOn): see the queries above.
      break;
  }
  f.event = ev;
  f.lastEvent = id;
  f.eventSeen[id] = rel;
  game.emit({ k: 'worldEvent', id, until });
  game.notify(-1, `worldEvent.${id}`, GOOD_WORLD_EVENTS.has(id) ? 'good' : 'warn');
}

/** Called every tick while an event lasts. */
export function tickWorldEvent(game: Game): void {
  if (eventOn(game, 'worldGames') && game.tick % 50 === 0) goodwill(game, GAMES_GOODWILL_PER_SEC * 5);
}

/** The event is over: the multipliers are back to normal. */
export function endWorldEvent(game: Game): void {
  const f = game.features;
  f.event = null;
  f.incomeMult = 1;
  f.growthMult = 1;
  f.tradeMult = 1;
}

/** A random land tile, preferring `prefer` terrain (`tries` samples), -1 when the map has no land. */
function randomLand(game: Game, prefer: (t: number) => boolean, tries: number): number {
  const m = game.map;
  let land = -1;
  for (let k = 0; k < tries; k++) {
    const i = game.rng.int(0, m.size - 1);
    const t = m.terrain[i]!;
    if (!IS_LAND[t]) continue;
    if (prefer(t)) return i;
    if (land < 0) land = i;
  }
  return land;
}

/**
 * Earthquake: the epicentre is one of the countries' buildings in service, at random (so it
 * strikes where people live, more likely where they build most); every building within the
 * radius is out of service while the event lasts (being repaired, as an occupied building).
 */
function earthquake(game: Game, ev: WorldEventState): void {
  const built: { x: number; y: number }[] = [];
  for (const b of game.buildings.values()) {
    const o = game.players[b.owner];
    if (o && o.kind !== 'tribe' && inService(b)) built.push(b);
  }
  const r = quakeRadius(game.map.width, game.map.height);
  let x: number;
  let y: number;
  if (built.length) {
    const b = built[game.rng.int(0, built.length - 1)]!;
    [x, y] = [b.x, b.y];
  } else {
    const t = Math.max(
      0,
      randomLand(game, () => true, 400),
    );
    [x, y] = [t % game.map.width, (t / game.map.width) | 0];
  }
  Object.assign(ev, { x: x + 0.5, y: y + 0.5, r });
  const hit = new Map<number, number>();
  const ticks = WORLD_EVENT_TICKS.earthquake;
  game.grid.query(x, y, r, (id) => {
    const b = game.buildings.get(id)!;
    if (b.owner <= 0 || (b.x - x) ** 2 + (b.y - y) ** 2 > r * r || b.buildLeft > 0) return;
    if (game.players[b.owner]?.kind === 'tribe') return;
    if (b.occupiedLeft < ticks) {
      b.occupiedLeft = ticks;
      b.occupiedTotal = ticks;
    }
    hit.set(b.owner, (hit.get(b.owner) ?? 0) + 1);
  });
  if (hit.size) {
    game.buildingsDirty = true;
    game.buildingsVersion++;
  }
  const tile = game.map.idx(x, y);
  for (const [owner, n] of [...hit].sort((a, b) => a[0] - b[0]))
    game.notify(owner, 'notify.quakeHit', 'warn', { n }, tile);
}

/** Volcanic eruption: an ash cloud over a mountain (if one is found), where no aircraft may fly. */
function eruption(game: Game, ev: WorldEventState): void {
  const w = game.map.width;
  const t = randomLand(game, (k) => k === T.Mountain || k === T.Peaks || k === T.Hills, 600);
  const i = t >= 0 ? t : (game.map.size / 2) | 0;
  const r = Math.round(quakeRadius(w, game.map.height) * ASH_RADIUS_MULT);
  Object.assign(ev, { x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5, r });
}

/** World Games: every nation thinks better of every other country (AI opinions, alliance odds). */
function goodwill(game: Game, d: number): void {
  const list = countries(game);
  for (const p of list) {
    if (p.kind !== 'nation') continue;
    for (const q of list) if (q !== p) p.updateRelation(q.id, d, 'games');
  }
}
