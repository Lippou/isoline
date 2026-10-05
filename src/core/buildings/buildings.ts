// Building costs, placement rules, construction, upgrades and demolition.
import { buildRate } from '../rules/worldEvents';
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  AIRFIELD_COST,
  B,
  BUILD_TICKS,
  CAPTURE_OCCUPATION_TICKS,
  CITY_COST_BASE,
  CITY_COST_CAP,
  DEFENSE_POST_COST_CAP,
  DEFENSE_POST_COST_STEP,
  DEMOLISH_MIN_TICKS,
  DEMOLISH_REFUND,
  LAB_COST_BASE,
  LAB_COST_CAP,
  MIN_BUILDING_SPACING,
  RADAR_COST,
  SAM_COOLDOWN,
  SAM_COSTS,
  SILO_COST,
  SILO_RELOAD_TICKS,
  STATION_TYPES,
} from '../game/constants';
import { inService, type Building } from './building';
import { HABITABLE } from '../map/terrain';
import { onStationBuilt, onStationRemoved } from '../units/trains';
import { resourceBonus } from '../rules/resources';
import { RESEARCH_PER_LAB_LEVEL, buildingLock, techBuildCost, techBuildTime } from '../rules/tech';

/** Highest level per type (OpenFront: no cap on cities, ports, factories, silos and SAMs). */
export const MAX_LEVEL = [99, 99, 99, 1, 99, 99, 3, 3, 99] as const;

/** Building types whose levels share one price ladder. */
const PRICE_GROUP: readonly (readonly B[])[] = [
  [B.City],
  [B.Port, B.Factory],
  [B.Factory, B.Port],
  [B.DefensePost],
  [B.Silo],
  [B.Sam],
  [B.Radar],
  [B.Airfield],
  [B.Lab],
];

/** Levels of p's buildings of `type`; one under construction counts as 1, an upgrade under way as done. */
export function levelsOwned(game: Game, p: Player, type: B): number {
  let n = 0;
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === type) n += b.buildLeft > 0 ? 1 : paidLevels(b);
  return n;
}

/**
 * Levels of p's buildings per type, counted like levelsOwned (one under construction is 1,
 * an upgrade under way counts as done): a city stacked to level 2 is two cities' worth.
 */
export function levelsByType(game: Game, p: Player): number[] {
  const out = new Array<number>(p.buildingCount.length).fill(0);
  for (const b of game.buildings.values())
    if (b.owner === p.id) out[b.type]! += b.buildLeft > 0 ? 1 : paidLevels(b);
  return out;
}

/**
 * OpenFront's price index for `type`: n = Σ min(levels owned, levels ever built)
 * over its price group. Upgrades and buildings under construction raise it,
 * captured buildings never raise it beyond what p built, lost ones lower it.
 */
export function priceIndex(game: Game, p: Player, type: B): number {
  let n = 0;
  for (const t of PRICE_GROUP[type]!) n += Math.min(levelsOwned(game, p, t), p.levelsBuilt[t]!);
  return n;
}

/** Raw price of the next building (or upgrade) of `type` for player p (before discounts). */
function rawCost(game: Game, p: Player, type: B): number {
  switch (type) {
    case B.City:
    case B.Port:
    case B.Factory:
      return Math.min(CITY_COST_CAP, CITY_COST_BASE * 2 ** priceIndex(game, p, type));
    case B.DefensePost:
      return Math.min(DEFENSE_POST_COST_CAP, DEFENSE_POST_COST_STEP * (priceIndex(game, p, type) + 1));
    case B.Silo:
      return SILO_COST;
    case B.Sam:
      return Math.min(SAM_COSTS[1], SAM_COSTS[0] * (priceIndex(game, p, type) + 1));
    case B.Radar:
      return RADAR_COST;
    case B.Airfield:
      return AIRFIELD_COST;
    case B.Lab:
      return Math.min(LAB_COST_CAP, LAB_COST_BASE * 2 ** priceIndex(game, p, type));
    default:
      return 1e12;
  }
}

function discount(game: Game, p: Player): number {
  let d = 1;
  if (game.config.features.resources) d *= 1 - resourceBonus(game, p).buildDiscount;
  if (game.config.features.tech) d *= techBuildCost(p);
  return d;
}

export function buildCost(game: Game, p: Player, type: B): number {
  return Math.round(rawCost(game, p, type) * discount(game, p));
}

/** An upgrade costs exactly what a new building of the same type would. */
export function upgradeCost(game: Game, p: Player, b: Building): number {
  if (MAX_LEVEL[b.type] <= 1) return Infinity;
  return buildCost(game, p, b.type);
}

export function buildingAllowed(game: Game, type: B): boolean {
  const cfg = game.config;
  switch (type) {
    case B.Port:
      return cfg.allowPorts;
    case B.Factory:
      return cfg.allowFactories;
    case B.Silo:
      return cfg.allowNukes;
    case B.Sam:
      return cfg.allowNukes || cfg.features.air;
    case B.Radar:
      return cfg.features.radar;
    case B.Airfield:
      return cfg.features.air;
    case B.Lab:
      return cfg.features.tech;
    default:
      return true;
  }
}

export type PlaceError =
  | 'ok'
  | 'notOwned'
  | 'notLand'
  | 'occupied'
  | 'tooClose'
  | 'notCoastal'
  | 'gold'
  | 'disabled'
  | 'phase'
  | 'locked';

/** Why (or whether) player p can place a new `type` on `tile`. */
export function checkPlacement(game: Game, p: Player, type: B, tile: number): PlaceError {
  if (game.phase !== 'playing') return 'phase';
  if (!buildingAllowed(game, type)) return 'disabled';
  // Tech tree: silos, SAMs, radars and airfields must be researched first.
  if (buildingLock(game, p, type) >= 0) return 'locked';
  const spot = spotError(game, p, type, tile);
  if (spot !== 'ok') return spot;
  if (p.gold < buildCost(game, p, type)) return 'gold';
  return 'ok';
}

/** The location part of checkPlacement (ownership, terrain, coast, spacing). */
function spotError(game: Game, p: Player, type: B, tile: number): PlaceError {
  if (tile < 0 || tile >= game.map.size) return 'notLand';
  if (game.owner[tile] !== p.id) return 'notOwned';
  // Glaciers and high peaks are held, never built on.
  if (!HABITABLE[game.map.terrain[tile]!] || game.isDead(tile)) return 'notLand';
  if (game.buildingAt[tile]! >= 0) return 'occupied';
  if (type === B.Port) {
    const wt = game.map.adjacentWater(tile);
    // A sea or lake coast, or the bank of a river flowing into one (river port).
    if (wt < 0 || game.map.navWater(wt) < 120) return 'notCoastal';
  }
  if (tooClose(game, tile)) return 'tooClose';
  return 'ok';
}

/** Whether a structure stands closer than MIN_BUILDING_SPACING (Euclidean) to `tile`. */
function tooClose(game: Game, tile: number): boolean {
  const w = game.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  const r2 = MIN_BUILDING_SPACING * MIN_BUILDING_SPACING;
  let close = false;
  game.grid.query(x, y, MIN_BUILDING_SPACING, (id) => {
    const b = game.buildings.get(id)!;
    if ((b.x - x) ** 2 + (b.y - y) ** 2 < r2) close = true;
  });
  return close;
}

/**
 * Where a build order on `tile` lands: the tile itself when it is a valid spot,
 * otherwise the nearest valid spot of p within MIN_BUILDING_SPACING (structures
 * must stand that far apart, so clicks are snapped like in OpenFront). -1 if none.
 */
export function snapBuildTile(game: Game, p: Player, type: B, tile: number): number {
  if (spotError(game, p, type, tile) === 'ok') return tile;
  const w = game.map.width;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  const r = MIN_BUILDING_SPACING - 1;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dy * dy;
      if (d >= bestD || d > r * r) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const i = y * w + x;
      if (game.owner[i] !== p.id || spotError(game, p, type, i) !== 'ok') continue;
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** p's building of `type` closest to `tile` within MIN_BUILDING_SPACING (upgrade by placement). */
export function buildingToUpgrade(game: Game, p: Player, type: B, tile: number): Building | null {
  const w = game.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  const r2 = MIN_BUILDING_SPACING * MIN_BUILDING_SPACING;
  let best: Building | null = null;
  let bestD = Infinity;
  game.grid.query(x, y, MIN_BUILDING_SPACING, (id) => {
    const b = game.buildings.get(id)!;
    if (b.owner !== p.id || b.type !== type) return;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < r2 && d < bestD) {
      best = b;
      bestD = d;
    }
  });
  return best;
}

/** Why a build order would fail: a placement error, or an upgrade already under way / a building still going up. */
export type BuildError = PlaceError | 'upgrading' | 'constructing';

/**
 * What a build order of `type` on `tile` would do — the 'build' command acts on exactly
 * this, and the cursor shows it before the click. On (or next to) one of p's buildings of
 * that type below its top level: upgrade it (`building`). Otherwise a new building on
 * `tile`, the click snapped to the nearest free spot (ports first to the nearest owned
 * coast); `tile` is -1 when no spot is found nearby. `error` is 'ok' when the order
 * goes through, `cost` what it would cost, `lock` the technology missing ('locked').
 */
export interface BuildPlan {
  building: Building | null;
  tile: number;
  error: BuildError;
  cost: number;
  lock: number;
}

export function planBuild(game: Game, p: Player, type: B, tile: number): BuildPlan {
  const lock = buildingLock(game, p, type);
  const existing = buildingToUpgrade(game, p, type, tile);
  if (existing && existing.level < MAX_LEVEL[type]) {
    const cost = upgradeCost(game, p, existing);
    const error: BuildError =
      existing.upgradeLeft > 0
        ? 'upgrading'
        : existing.buildLeft > 0
          ? 'constructing'
          : lock >= 0
            ? 'locked'
            : p.gold < cost
              ? 'gold'
              : 'ok';
    return { building: existing, tile: existing.tile, error, cost, lock };
  }
  const cost = buildCost(game, p, type);
  let at = tile;
  if (type === B.Port && !game.map.isCoastalLand(at)) at = snapPortTile(game, p, at);
  if (at < 0) {
    // No owned coast within reach of the click (the order is dropped).
    const error = game.phase !== 'playing' ? 'phase' : game.owner[tile] !== p.id ? 'notOwned' : 'notCoastal';
    return { building: null, tile: -1, error, cost, lock };
  }
  // Structures stand MIN_BUILDING_SPACING apart: the click snaps to the nearest free spot.
  const spot = snapBuildTile(game, p, type, at);
  const error = checkPlacement(game, p, type, spot >= 0 ? spot : at);
  return { building: null, tile: spot, error, cost, lock };
}

/** For ports: snap a clicked tile to the nearest owned coastal tile within a small radius. */
export function snapPortTile(game: Game, p: Player, tile: number, radius = 8): number {
  const w = game.map.width;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const i = y * w + x;
      if (game.owner[i] !== p.id || !game.map.isCoastalLand(i)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

export function placeBuilding(game: Game, p: Player, type: B, tile: number, free = false): Building | null {
  if (!free && checkPlacement(game, p, type, tile) !== 'ok') return null;
  const cost = free ? 0 : buildCost(game, p, type);
  p.gold -= cost;
  const w = game.map.width;
  // Megaprojects (tech): construction goes faster.
  const ticks = buildTicks(game, p, type);
  const b: Building = {
    id: game.nextId(),
    type,
    owner: p.id,
    tile,
    x: tile % w,
    y: (tile / w) | 0,
    level: 1,
    buildLeft: free ? 0 : ticks,
    buildTotal: ticks,
    cooldown: 0,
    tubes: type === B.Silo ? [0] : [],
    timer: 0,
    rejections: 0,
    createdTick: game.tick,
    alive: true,
    invested: cost,
    upgradeLeft: 0,
    upgradeTotal: 0,
    occupiedLeft: 0,
    occupiedTotal: 0,
    demolishLeft: 0,
    demolishTotal: 0,
  };
  game.buildings.set(b.id, b);
  game.grid.add(b);
  game.buildingAt[tile] = b.id;
  p.buildingCount[type]++;
  p.levelsBuilt[type]++;
  if (type === B.City) p.cityLevels += 1;
  p.stats.buildingsBuilt++;
  game.buildingsDirty = true;
  game.buildingsVersion++;
  if (b.buildLeft === 0) completeBuilding(game, b);
  return b;
}

/** Construction time of `type` for p (Megaprojects, tech tree: faster); upgrades take as long. */
export function buildTicks(game: Game, p: Player, type: B): number {
  return game.config.features.tech ? Math.round(BUILD_TICKS[type] * techBuildTime(p)) : BUILD_TICKS[type];
}

function completeBuilding(game: Game, b: Building): void {
  game.buildingsVersion++;
  game.buildingsDirty = true;
  game.emit({ k: 'built', owner: b.owner, kind: b.type, tile: b.tile });
  if (STATION_TYPES.includes(b.type)) onStationBuilt(game, b);
  if (b.type === B.Lab) labNotice(game, b);
}

/** Journal: a new research centre starts producing (upgrades stay silent, like cities). */
function labNotice(game: Game, b: Building): void {
  if (game.players[b.owner]?.kind !== 'human') return;
  game.notify(b.owner, 'notify.labReady', 'good', { n: RESEARCH_PER_LAB_LEVEL * b.level });
}

/**
 * Pays for the next level. Isoline (the player's request; OpenFront levels up at once): the
 * new level is built like a new building, in the type's construction time, while the
 * building keeps working at its current level; one upgrade at a time. The price ladder
 * counts the paid level right away.
 */
export function upgradeBuilding(game: Game, p: Player, b: Building): boolean {
  if (b.owner !== p.id || b.buildLeft > 0 || b.upgradeLeft > 0 || b.level >= MAX_LEVEL[b.type]) return false;
  if (b.demolishLeft > 0) return false;
  if (buildingLock(game, p, b.type) >= 0) return false; // captured before researching it
  const cost = upgradeCost(game, p, b);
  if (p.gold < cost) return false;
  p.gold -= cost;
  b.invested += cost;
  p.levelsBuilt[b.type]++;
  if (b.type === B.City) p.cityLevels++;
  b.upgradeTotal = buildTicks(game, p, b.type);
  b.upgradeLeft = b.upgradeTotal;
  game.buildingsDirty = true;
  if (b.upgradeLeft === 0) completeUpgrade(game, b);
  return true;
}

/** Levels paid for: the current one plus an upgrade under way (Player.cityLevels counts both). */
export function paidLevels(b: Building): number {
  return b.level + (b.upgradeLeft > 0 ? 1 : 0);
}

function completeUpgrade(game: Game, b: Building): void {
  b.upgradeLeft = 0;
  b.level++;
  if (b.type === B.Silo) b.tubes.push(0);
  game.buildingsDirty = true;
  game.buildingsVersion++;
  game.emit({ k: 'built', owner: b.owner, kind: b.type, tile: b.tile });
}

/** How long demolishing a `type` takes p: its construction time, DEMOLISH_MIN_TICKS at least. */
export function demolishTicks(game: Game, p: Player, type: B): number {
  return Math.max(DEMOLISH_MIN_TICKS, buildTicks(game, p, type));
}

/**
 * Orders p's building down (1.16: timed, like a construction). It goes out of service at
 * once, its construction or upgrade halted, and comes down after demolishTicks; then
 * DEMOLISH_REFUND of the gold invested comes back (finishDemolition). False when it is not
 * p's or already being demolished.
 */
export function demolishBuilding(game: Game, p: Player, b: Building): boolean {
  if (b.owner !== p.id || !b.alive || b.demolishLeft > 0) return false;
  b.demolishTotal = demolishTicks(game, p, b.type);
  b.demolishLeft = b.demolishTotal;
  game.buildingsDirty = true;
  game.buildingsVersion++;
  return true;
}

/** Calls off a demolition under way: the building is back in service, nothing lost. */
export function cancelDemolition(game: Game, p: Player, b: Building): boolean {
  if (b.owner !== p.id || b.demolishLeft === 0) return false;
  b.demolishLeft = 0;
  b.demolishTotal = 0;
  game.buildingsDirty = true;
  game.buildingsVersion++;
  return true;
}

/** The demolition is over: the refund, then the building goes. */
function finishDemolition(game: Game, b: Building): void {
  const p = game.players[b.owner];
  const refund = b.invested * DEMOLISH_REFUND;
  if (p && p.alive) p.gold += refund;
  game.emit({ k: 'demolished', owner: b.owner, kind: b.type, tile: b.tile, refund: Math.round(refund) });
  removeBuilding(game, b, true);
}

/**
 * A bomb hit (GAME_DESIGN.md §11): `levels` come off the building, an upgrade under way
 * first; a building under construction, at level 1 or that cannot be upgraded (defence
 * post) is destroyed. A silo or a SAM that survives has every missile to reload. True when
 * the building is gone.
 */
export function damageBuilding(game: Game, b: Building, levels: number): boolean {
  const p = game.players[b.owner];
  for (let k = 0; k < levels; k++) {
    if (b.buildLeft > 0 || (b.upgradeLeft === 0 && b.level <= 1)) {
      removeBuilding(game, b, false);
      return true;
    }
    if (b.upgradeLeft > 0) {
      b.upgradeLeft = 0;
      b.upgradeTotal = 0;
    } else {
      b.invested *= (b.level - 1) / b.level;
      b.level--;
      if (b.type === B.Silo) b.tubes.pop();
    }
    if (b.type === B.City && p) p.cityLevels--;
  }
  if (b.type === B.Silo)
    for (let k = 0; k < b.tubes.length; k++) b.tubes[k] = Math.max(b.tubes[k]!, SILO_RELOAD_TICKS);
  if (b.type === B.Sam) for (let k = 0; k < b.tubes.length; k++) b.tubes[k] = SAM_COOLDOWN;
  if (b.type === B.Airfield) b.tubes.length = Math.min(b.tubes.length, b.level);
  game.buildingsDirty = true;
  game.buildingsVersion++;
  return false;
}

/**
 * Isoline's capture rule (GAME_DESIGN.md §6.4; OpenFront hands buildings over intact): a
 * building taken by conquest is looted — an upgrade under way is lost, then half of its
 * levels, rounded down (levels 1 and 2 keep one, 3 keeps 2, 8 keeps 4) — and occupied for
 * CAPTURE_OCCUPATION_TICKS, out of service meanwhile (inService). The caller moves the
 * levels between the two owners' cityLevels around it. Returns the levels lost (the
 * upgrade under way not counted).
 */
export function lootBuilding(game: Game, b: Building): number {
  if (b.upgradeLeft > 0) {
    b.upgradeLeft = 0;
    b.upgradeTotal = 0;
  }
  const lost = Math.floor(b.level / 2);
  if (lost > 0) {
    b.invested *= (b.level - lost) / b.level;
    b.level -= lost;
    // Silo tubes and airfield alert slots go with their levels.
    if (b.type === B.Silo || b.type === B.Airfield) b.tubes.length = Math.min(b.tubes.length, b.level);
  }
  b.occupiedTotal = CAPTURE_OCCUPATION_TICKS;
  b.occupiedLeft = CAPTURE_OCCUPATION_TICKS;
  game.buildingsDirty = true;
  game.buildingsVersion++;
  return lost;
}

/** General "Propaganda": p's occupied buildings rally to it at once (rules/features.ts). */
export function endOccupations(game: Game, owner: number): number {
  let n = 0;
  for (const b of game.buildings.values()) {
    if (b.owner !== owner || b.occupiedLeft === 0) continue;
    b.occupiedLeft = 0;
    n++;
  }
  if (n > 0) {
    game.buildingsDirty = true;
    game.buildingsVersion++;
  }
  return n;
}

export function removeBuilding(game: Game, b: Building, _voluntary: boolean): void {
  if (!b.alive) return;
  b.alive = false;
  const p = game.players[b.owner];
  if (p) {
    p.buildingCount[b.type]--;
    if (b.type === B.City) p.cityLevels -= paidLevels(b);
  }
  game.buildings.delete(b.id);
  game.grid.remove(b);
  if (game.buildingAt[b.tile] === b.id) game.buildingAt[b.tile] = -1;
  if (STATION_TYPES.includes(b.type)) onStationRemoved(game, b);
  game.buildingsDirty = true;
  game.buildingsVersion++;
}

export function updateBuildings(game: Game): void {
  for (const b of game.buildings.values()) {
    // Occupation counts down alongside a construction, an upgrade or a demolition.
    if (b.occupiedLeft > 0 && --b.occupiedLeft === 0) {
      game.buildingsDirty = true;
      game.buildingsVersion++;
    }
    // Being demolished: nothing else moves (construction and upgrade halted).
    if (b.demolishLeft > 0) {
      if (--b.demolishLeft === 0) finishDemolition(game, b);
      continue;
    }
    // An arms race (world event) builds silos and SAM batteries faster.
    const rate = buildRate(game, b.type);
    if (b.buildLeft > 0) {
      b.buildLeft = Math.max(0, b.buildLeft - rate);
      if (b.buildLeft === 0) completeBuilding(game, b);
      continue;
    }
    if (b.upgradeLeft > 0) {
      b.upgradeLeft = Math.max(0, b.upgradeLeft - rate);
      if (b.upgradeLeft === 0) completeUpgrade(game, b);
    }
    if (b.cooldown > 0) b.cooldown--;
    // Silo tubes reload; airfields rearm their alert interceptors (units/air.ts).
    if (b.type === B.Silo || b.type === B.Airfield) {
      for (let k = 0; k < b.tubes.length; k++) if (b.tubes[k]! > 0) b.tubes[k]!--;
    }
  }
}

/** Buildings of a type owned by a player and in service (built, not occupied), in id order. */
export function ownedBuildings(game: Game, owner: number, type: B): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values())
    if (b.owner === owner && b.type === type && inService(b)) out.push(b);
  return out;
}
