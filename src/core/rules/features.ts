// Original features driven by the simulation: weather & day/night, world events,
// loyalty & secession, generals, world council, research ticking, resources.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  COUNCIL_PERIOD,
  COUNCIL_VOTE_TICKS,
  DAY_LENGTH,
  EVENT_MAX,
  EVENT_MIN,
  GENERAL_COOLDOWN,
  LOYALTY_CHECK_TICKS,
  LOYALTY_MAX,
  LOYALTY_SECESSION_THRESHOLD,
  LOYALTY_STABILISE_RANGE,
  min,
  sec,
} from '../game/constants';
import { recountResources, type ResourceBonus } from './resources';
import { updateResearch } from './tech';
import { sabotageNear } from '../units/trains';
import { inventTribeName } from '../names';
import { IS_LAND } from '../map/terrain';

export interface WeatherCell {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  until: number;
  kind: 0 | 1; // 0 storm, 1 fog bank
}

export interface Reveal {
  owner: number;
  x: number;
  y: number;
  r: number;
  until: number;
}

export const WORLD_EVENTS = ['crisis', 'pandemic', 'boom', 'solarStorm', 'peaceSummit'] as const;
export type WorldEventId = (typeof WORLD_EVENTS)[number];
export const COUNCIL_OPTIONS = ['sanctions', 'nukeBan', 'ceasefire'] as const;

export interface FeatureState {
  weather: WeatherCell[];
  nextWeatherTick: number;
  nextEventTick: number;
  event: { id: WorldEventId; until: number } | null;
  incomeMult: number;
  growthMult: number;
  tradeMult: number;
  radarsOffUntil: number;
  ceasefireUntil: number;
  nukeBanUntil: number;
  sanction: { target: number; until: number } | null;
  council: { options: number[]; votes: Map<number, number>; closes: number } | null;
  nextCouncilTick: number;
  mirvLaunches: number;
  reveals: Reveal[];
  resourceBonus: Map<number, ResourceBonus>;
  loyaltyCursor: number;
  secessionCandidates: Map<number, number[]>;
  shipSpeedAt: (x: number, y: number) => number;
}

export function createFeatureState(game: Game): FeatureState {
  const fs: FeatureState = {
    weather: [],
    nextWeatherTick: sec(40),
    nextEventTick: EVENT_MIN,
    event: null,
    incomeMult: 1,
    growthMult: 1,
    tradeMult: 1,
    radarsOffUntil: -1,
    ceasefireUntil: -1,
    nukeBanUntil: -1,
    sanction: null,
    council: null,
    nextCouncilTick: COUNCIL_PERIOD,
    mirvLaunches: 0,
    reveals: [],
    resourceBonus: new Map(),
    loyaltyCursor: 0,
    secessionCandidates: new Map(),
    shipSpeedAt: () => 1,
  };
  fs.shipSpeedAt = (x, y) => {
    if (!game.config.features.weather) return 1;
    for (const c of fs.weather) if (c.kind === 0 && (c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return 0.6;
    return 1;
  };
  return fs;
}

/** 0..1 position in the 8-minute day; night is 0.5..1. */
export function dayPhase(tick: number): number {
  return (tick % DAY_LENGTH) / DAY_LENGTH;
}

export function isNight(tick: number): boolean {
  return dayPhase(tick) >= 0.5;
}

export function updateFeatures(game: Game): void {
  const f = game.features;
  const cfg = game.config.features;
  const rel = game.tick - game.startTick;
  if (game.tick % 50 === 0 && cfg.resources) recountResources(game);
  if (cfg.weather) updateWeather(game);
  if (cfg.events) updateWorldEvents(game, rel);
  if (cfg.loyalty) updateLoyalty(game);
  if (cfg.council) updateCouncil(game, rel);
  if (cfg.tech) {
    for (const p of game.alivePlayers()) {
      if (p.kind === 'tribe') continue;
      const done = updateResearch(p);
      if (done) game.notify(p.id, 'notify.researchDone', 'good', { tech: done });
    }
  }
  if (f.sanction && f.sanction.until <= game.tick) f.sanction = null;
}

// ---------------------------------------------------------------- weather
function updateWeather(game: Game): void {
  const f = game.features;
  const { width, height } = game.map;
  for (const c of f.weather) {
    c.x += c.vx;
    c.y += c.vy;
  }
  f.weather = f.weather.filter((c) => c.until > game.tick);
  if (game.tick >= f.nextWeatherTick) {
    const rng = game.rng;
    const kind = rng.chance(0.6) ? 0 : 1;
    const scale = Math.sqrt(width * height) / 1400;
    const angle = rng.next() * Math.PI * 2;
    f.weather.push({
      x: rng.range(0.1, 0.9) * width,
      y: rng.range(0.1, 0.9) * height,
      r: rng.range(40, 95) * scale,
      vx: Math.cos(angle) * 0.25 * scale,
      vy: Math.sin(angle) * 0.25 * scale,
      until: game.tick + rng.int(sec(90), sec(180)),
      kind,
    });
    f.nextWeatherTick = game.tick + rng.int(sec(45), sec(100));
  }
}

// ----------------------------------------------------------- world events
function updateWorldEvents(game: Game, rel: number): void {
  const f = game.features;
  if (f.event && f.event.until <= game.tick) {
    f.event = null;
    f.incomeMult = 1;
    f.growthMult = 1;
    f.tradeMult = 1;
  }
  if (rel < f.nextEventTick) return;
  const rng = game.rng;
  const id = WORLD_EVENTS[rng.int(0, WORLD_EVENTS.length - 1)]!;
  let until = game.tick + min(2);
  switch (id) {
    case 'crisis':
      f.incomeMult = 0.75;
      break;
    case 'pandemic':
      f.growthMult = 0.5;
      for (const p of game.alivePlayers()) {
        p.workers *= 0.95;
        p.troops *= 0.97;
      }
      break;
    case 'boom':
      f.tradeMult = 2;
      break;
    case 'solarStorm':
      until = game.tick + sec(90);
      f.radarsOffUntil = until;
      break;
    case 'peaceSummit':
      until = game.tick + sec(60);
      f.ceasefireUntil = Math.max(f.ceasefireUntil, until);
      break;
  }
  f.event = { id, until };
  f.nextEventTick = rel + rng.int(EVENT_MIN, EVENT_MAX);
  game.emit({ k: 'worldEvent', id, until });
  game.notify(-1, `worldEvent.${id}`, id === 'boom' ? 'good' : 'warn');
}

// ---------------------------------------------------------------- loyalty
const SWEEP_CHUNKS = 60;

function updateLoyalty(game: Game): void {
  const f = game.features;
  const map = game.map;
  const n = map.size;
  if (f.loyaltyCursor === 0) f.secessionCandidates.clear();
  // Coarse "stabilised" cells around cities and defence posts.
  const stable = stabilityGrid(game);
  const cell = 16;
  const cw = Math.ceil(map.width / cell);
  const chunk = Math.ceil(n / SWEEP_CHUNKS);
  const start = f.loyaltyCursor;
  const end = Math.min(n, start + chunk);
  const own = game.owner;
  const loy = game.loyalty;
  const w = map.width;
  for (let i = start; i < end; i++) {
    const o = own[i]!;
    if (o === 0) continue;
    const l = loy[i]!;
    if (l >= LOYALTY_MAX) continue;
    const p = game.players[o]!;
    const c = ((((i / w) | 0) / cell) | 0) * cw + (((i % w) / cell) | 0);
    let gain = 4;
    if (stable.get(c) === o) gain += 12;
    if (p.propagandaUntil > game.tick) gain *= 1.5;
    loy[i] = Math.min(LOYALTY_MAX, l + gain);
    if (l < LOYALTY_SECESSION_THRESHOLD && p.kind !== 'tribe') {
      let list = f.secessionCandidates.get(o);
      if (!list) {
        list = [];
        f.secessionCandidates.set(o, list);
      }
      if (list.length < 64) list.push(i);
    }
  }
  f.loyaltyCursor = end >= n ? 0 : end;
  if (game.tick % LOYALTY_CHECK_TICKS === 0) checkSecessions(game);
}

// Cache keyed by the buildings version: a pure function of the state, so it is
// safe across snapshot restores (no hidden temporal state).
const stableCaches = new WeakMap<Game, { version: number; map: Map<number, number> }>();
function stabilityGrid(game: Game): Map<number, number> {
  const stableCache = stableCaches.get(game);
  if (stableCache && stableCache.version === game.buildingsVersion) return stableCache.map;
  const m = new Map<number, number>();
  const cell = 16;
  const cw = Math.ceil(game.map.width / cell);
  const rc = Math.ceil(LOYALTY_STABILISE_RANGE / cell);
  for (const b of game.buildings.values()) {
    if ((b.type !== B.City && b.type !== B.DefensePost) || b.buildLeft > 0) continue;
    const cx = (b.x / cell) | 0;
    const cy = (b.y / cell) | 0;
    for (let dy = -rc; dy <= rc; dy++)
      for (let dx = -rc; dx <= rc; dx++) m.set((cy + dy) * cw + cx + dx, b.owner);
  }
  stableCaches.set(game, { version: game.buildingsVersion, map: m });
  return m;
}

function checkSecessions(game: Game): void {
  const f = game.features;
  for (const [o, cands] of f.secessionCandidates) {
    const p = game.players[o]!;
    if (!p.alive || p.tiles < 400 || cands.length < 8) continue;
    const density = p.troops / Math.max(1, p.tiles);
    if (density >= 6 || p.propagandaUntil > game.tick) continue;
    const seed = cands[game.rng.int(0, cands.length - 1)]!;
    if (game.owner[seed] !== o || game.loyalty[seed]! >= LOYALTY_SECESSION_THRESHOLD) continue;
    secede(game, p, seed);
    break; // at most one secession per check
  }
}

function secede(game: Game, p: Player, seed: number): void {
  const map = game.map;
  const maxTiles = Math.min(3000, Math.floor(p.tiles * 0.12));
  const region: number[] = [];
  const seen = new Set<number>([seed]);
  const q = [seed];
  const nb = new Int32Array(4);
  while (q.length && region.length < maxTiles) {
    const t = q.shift()!;
    region.push(t);
    const k = map.neighbors4(t, nb);
    for (let j = 0; j < k; j++) {
      const v = nb[j]!;
      if (seen.has(v) || game.owner[v] !== p.id || game.loyalty[v]! >= 130 || !IS_LAND[map.terrain[v]!])
        continue;
      seen.add(v);
      q.push(v);
    }
  }
  if (region.length < 30) return;
  const rebel = game.addPlayer(inventTribeName(game.rng), 'tribe');
  rebel.color = -1;
  rebel.flagSeed = game.rng.nextU32();
  rebel.spawned = true;
  rebel.spawnTile = seed;
  const density = p.troops / Math.max(1, p.tiles);
  const troops = density * region.length * 0.8;
  p.troops -= troops;
  rebel.troops = troops + 2000;
  for (const t of region) {
    game.setOwner(t, rebel.id);
    game.loyalty[t] = 180;
  }
  game.emit({ k: 'secession', from: p.id, tribe: rebel.id, tile: seed });
  game.notify(p.id, 'notify.secession', 'danger', { tiles: region.length }, seed);
}

// --------------------------------------------------------------- generals
export function useGeneral(game: Game, p: Player, tile: number): boolean {
  if (!game.config.features.generals || game.phase !== 'playing') return false;
  if (game.tick < p.generalReadyTick) return false;
  switch (p.general) {
    case 'blitz':
      p.blitzUntil = game.tick + sec(30);
      break;
    case 'rampart':
      p.rampartUntil = game.tick + sec(30);
      break;
    case 'sabotage':
      if (!sabotageNear(game, p.id, tile)) return false;
      break;
    case 'propaganda':
      p.propagandaUntil = game.tick + sec(60);
      break;
  }
  p.generalReadyTick = game.tick + GENERAL_COOLDOWN;
  game.emit({ k: 'general', player: p.id, ability: p.general, tile });
  return true;
}

// ---------------------------------------------------------------- council
function updateCouncil(game: Game, rel: number): void {
  const f = game.features;
  if (!f.council && rel >= f.nextCouncilTick) {
    f.council = { options: [0, 1, 2], votes: new Map(), closes: game.tick + COUNCIL_VOTE_TICKS };
    game.emit({ k: 'council', phase: 'open', option: -1, options: f.council.options });
    game.notify(-1, 'council.open', 'info');
    f.nextCouncilTick = rel + COUNCIL_PERIOD;
    return;
  }
  if (f.council && game.tick >= f.council.closes) {
    const tally = [0, 0, 0];
    for (const [pid, opt] of f.council.votes) {
      const p = game.players[pid];
      if (p && p.alive) tally[opt] = (tally[opt] ?? 0) + Math.sqrt(p.population);
    }
    let best = -1;
    let bestV = 0;
    tally.forEach((v, k) => {
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    });
    f.council = null;
    game.emit({ k: 'council', phase: 'result', option: best, options: [0, 1, 2] });
    if (best === 0) {
      let leader: Player | null = null;
      for (const p of game.alivePlayers())
        if (p.kind !== 'tribe' && (!leader || p.tiles > leader.tiles)) leader = p;
      if (leader) {
        f.sanction = { target: leader.id, until: game.tick + min(3) };
        game.notify(-1, 'council.sanctions', 'warn', { target: leader.id });
      }
    } else if (best === 1) {
      f.nukeBanUntil = game.tick + min(3);
      game.notify(-1, 'council.nukeBan', 'warn');
    } else if (best === 2) {
      f.ceasefireUntil = Math.max(f.ceasefireUntil, game.tick + sec(60));
      game.notify(-1, 'council.ceasefire', 'warn');
    } else {
      game.notify(-1, 'council.noMajority', 'info');
    }
  }
}

export function castVote(game: Game, p: Player, option: number): void {
  const c = game.features.council;
  if (!c || !p.alive || p.kind === 'tribe' || option < 0 || option > 2) return;
  c.votes.set(p.id, option);
}
