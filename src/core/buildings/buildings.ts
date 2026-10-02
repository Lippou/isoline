// Building costs, placement rules, construction, upgrades and demolition.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  CITY_COST_BASE,
  CITY_COST_GROWTH,
  PORT_COST_GROWTH,
  B,
  BUILD_TICKS,
  DEMOLISH_REFUND,
  MIN_BUILDING_SPACING,
  SAM_COSTS,
  STATION_TYPES,
} from '../game/constants';
import type { Building } from './building';
import { IS_LAND } from '../map/terrain';
import { onStationBuilt, onStationRemoved } from '../units/trains';
import { resourceBonus } from '../rules/resources';
import { techBuildCost } from '../rules/tech';

export const MAX_LEVEL = [99, 5, 5, 1, 5, 5, 3, 3] as const;

/** Raw price of the next building of `type` for player p (before discounts). */
function rawCost(game: Game, p: Player, type: B): number {
  const c = p.buildingCount;
  switch (type) {
    case B.City:
      return cityCost(p.cityLevels);
    case B.Port:
    case B.Factory:
      return portFactoryCost(portFactoryLevels(game, p));
    case B.DefensePost:
      return Math.min(250_000, 50_000 * (c[B.DefensePost]! + 1));
    case B.Silo:
      return 1_000_000;
    case B.Sam:
      return SAM_COSTS[0];
    case B.Radar:
      return 300_000;
    case B.Airfield:
      return 800_000;
    default:
      return 1e12;
  }
}

/**
 * Cities and ports/factories get steadily more expensive (no cap): gold buys
 * population, so a capped price would make the economy grow exponentially.
 */
export function cityCost(levels: number): number {
  return Math.round(CITY_COST_BASE * Math.pow(CITY_COST_GROWTH, levels));
}

export function portFactoryCost(levels: number): number {
  return Math.round(CITY_COST_BASE * Math.pow(PORT_COST_GROWTH, levels));
}

function portFactoryLevels(game: Game, p: Player): number {
  let n = 0;
  for (const b of game.buildings.values())
    if (b.owner === p.id && (b.type === B.Port || b.type === B.Factory)) n += b.level;
  return n;
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

export function upgradeCost(game: Game, p: Player, b: Building): number {
  let raw: number;
  switch (b.type) {
    case B.City:
      raw = cityCost(p.cityLevels);
      break;
    case B.Port:
    case B.Factory:
      raw = portFactoryCost(portFactoryLevels(game, p));
      break;
    case B.Silo:
      raw = 1_000_000;
      break;
    case B.Sam:
      raw = SAM_COSTS[1];
      break;
    case B.Radar:
      raw = 300_000;
      break;
    case B.Airfield:
      raw = 800_000;
      break;
    default:
      return Infinity;
  }
  return Math.round(raw * discount(game, p));
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
    default:
      return true;
  }
}

export type PlaceError =
  'ok' | 'notOwned' | 'notLand' | 'occupied' | 'tooClose' | 'notCoastal' | 'gold' | 'disabled' | 'phase';

/** Why (or whether) player p can place `type` on `tile`. Upgrade-by-placement of cities returns 'ok'. */
export function checkPlacement(game: Game, p: Player, type: B, tile: number): PlaceError {
  if (game.phase !== 'playing') return 'phase';
  if (!buildingAllowed(game, type)) return 'disabled';
  if (tile < 0 || tile >= game.map.size) return 'notLand';
  if (game.owner[tile] !== p.id) return 'notOwned';
  if (!IS_LAND[game.map.terrain[tile]!] || game.isDead(tile)) return 'notLand';
  if (game.buildingAt[tile]! >= 0) return 'occupied';
  if (type === B.Port) {
    const wt = game.map.adjacentWater(tile);
    if (wt < 0 || (game.map.componentSize[game.map.component[wt]!] ?? 0) < 120) return 'notCoastal';
  }
  const w = game.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  let close = false;
  game.grid.query(x, y, MIN_BUILDING_SPACING, (id) => {
    const b = game.buildings.get(id)!;
    if (Math.abs(b.x - x) < MIN_BUILDING_SPACING && Math.abs(b.y - y) < MIN_BUILDING_SPACING) close = true;
  });
  if (close) return 'tooClose';
  if (p.gold < buildCost(game, p, type)) return 'gold';
  return 'ok';
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
  const b: Building = {
    id: game.nextId(),
    type,
    owner: p.id,
    tile,
    x: tile % w,
    y: (tile / w) | 0,
    level: 1,
    buildLeft: free ? 0 : BUILD_TICKS[type],
    buildTotal: BUILD_TICKS[type],
    cooldown: 0,
    tubes: type === B.Silo ? [0] : [],
    timer: 0,
    createdTick: game.tick,
    alive: true,
    invested: cost,
  };
  game.buildings.set(b.id, b);
  game.grid.add(b);
  game.buildingAt[tile] = b.id;
  p.buildingCount[type]++;
  if (type === B.City) p.cityLevels += 1;
  p.stats.buildingsBuilt++;
  game.buildingsDirty = true;
  game.buildingsVersion++;
  if (b.buildLeft === 0) completeBuilding(game, b);
  return b;
}

function completeBuilding(game: Game, b: Building): void {
  game.buildingsVersion++;
  game.buildingsDirty = true;
  game.emit({ k: 'built', owner: b.owner, kind: b.type, tile: b.tile });
  if (STATION_TYPES.includes(b.type)) onStationBuilt(game, b);
}

export function upgradeBuilding(game: Game, p: Player, b: Building): boolean {
  if (b.owner !== p.id || b.buildLeft > 0 || b.level >= MAX_LEVEL[b.type]) return false;
  const cost = upgradeCost(game, p, b);
  if (p.gold < cost) return false;
  p.gold -= cost;
  b.invested += cost;
  b.level++;
  if (b.type === B.City) p.cityLevels++;
  if (b.type === B.Silo) b.tubes.push(0);
  game.buildingsDirty = true;
  game.emit({ k: 'built', owner: b.owner, kind: b.type, tile: b.tile });
  return true;
}

export function demolishBuilding(game: Game, p: Player, b: Building): boolean {
  if (b.owner !== p.id) return false;
  p.gold += b.invested * DEMOLISH_REFUND;
  removeBuilding(game, b, true);
  return true;
}

export function removeBuilding(game: Game, b: Building, _voluntary: boolean): void {
  if (!b.alive) return;
  b.alive = false;
  const p = game.players[b.owner];
  if (p) {
    p.buildingCount[b.type]--;
    if (b.type === B.City) p.cityLevels -= b.level;
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
    if (b.buildLeft > 0) {
      b.buildLeft--;
      if (b.buildLeft === 0) completeBuilding(game, b);
      continue;
    }
    if (b.cooldown > 0) b.cooldown--;
    if (b.type === B.Silo) {
      for (let k = 0; k < b.tubes.length; k++) if (b.tubes[k]! > 0) b.tubes[k]!--;
    }
  }
}

/** Ready (constructed) buildings of a type owned by a player, in id order. */
export function ownedBuildings(game: Game, owner: number, type: B): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values())
    if (b.owner === owner && b.type === type && b.buildLeft === 0) out.push(b);
  return out;
}
