// Player state. Plain data + small helpers; systems live in their own modules.
import type { GeneralType } from './config';
import type { LocalizedName } from '../map/gamemap';
import { BUILDING_COUNT, DEFAULT_TROOP_RATIO } from './constants';

export type PlayerKind = 'human' | 'nation' | 'tribe';
export type Personality = 'expansionist' | 'builder' | 'merchant' | 'diplomat' | 'isolationist' | 'warmonger';
export const PERSONALITIES: readonly Personality[] = [
  'expansionist',
  'builder',
  'merchant',
  'diplomat',
  'isolationist',
  'warmonger',
];

export interface PlayerStats {
  tilesConquered: number;
  tilesLost: number;
  buildingsBuilt: number;
  shipsSunk: number;
  shipsLost: number;
  nukesLaunched: number;
  nukesIntercepted: number;
  goldEarned: number;
  tradeGold: number;
  trainGold: number;
  troopsLost: number;
  enemiesKilled: number;
  maxTiles: number;
  betrayals: number;
}

export interface HistorySample {
  tick: number;
  tiles: number;
  gold: number;
  troops: number;
}

export class Player {
  readonly id: number;
  name: LocalizedName;
  kind: PlayerKind;
  team = 0;
  color = 0;
  flagSeed = 0;
  slot = -1;
  personality: Personality = 'expansionist';
  general: GeneralType = 'blitz';

  alive = true;
  spawned = false;
  spawnTile = -1;
  eliminatedTick = -1;
  inactive = false;
  surrendered = false;

  troops = 0;
  workers = 0;
  troopRatio = DEFAULT_TROOP_RATIO;
  gold = 0;
  tiles = 0;
  /** Tiles that do not carry fallout (victory / territory bonus). */
  usefulTiles = 0;
  popCap = 0;
  lastGrowth = 0;
  income = 0; // gold per tick (last computed)
  incomeBreakdown = { base: 0, workers: 0, trade: 0, trains: 0, resources: 0 };

  /** Dense list of owned tiles that touch a different-owner land tile. */
  border: number[] = [];
  /** Dense list of owned tiles that touch water. */
  coast: number[] = [];
  /** Running sums for the centroid (labels, AI). */
  sumX = 0;
  sumY = 0;

  buildingCount = new Int32Array(BUILDING_COUNT);
  cityLevels = 0;
  /** Shared port/factory purchase counter. */
  portFactoryBought = 0;
  cityBought = 0;
  defenseBought = 0;
  warshipsBought = 0;
  mirvLaunched = 0;

  allies = new Map<number, number>(); // ally id → expiry tick
  allyRequests = new Map<number, number>(); // requester id → expiry tick (incoming)
  embargo = new Set<number>();
  embargoUntil = new Map<number, number>(); // automatic (traitor) embargo expiry
  traitorUntil = -1;
  debuffUntil = -1;
  immuneUntil = -1;
  betrayedBy = new Map<number, number>(); // who betrayed me (id → tick)

  // Tech tree (5 branches × 4 levels) and research.
  tech = new Uint8Array(5);
  researchPoints = 0;
  researching = -1;

  // Generals.
  generalReadyTick = 0;
  blitzUntil = -1;
  rampartUntil = -1;
  propagandaUntil = -1;

  // Doomsday warnings.
  doomsdayWarned = false;

  stats: PlayerStats = {
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
  };
  history: HistorySample[] = [];

  constructor(id: number, name: LocalizedName, kind: PlayerKind) {
    this.id = id;
    this.name = name;
    this.kind = kind;
  }

  get population(): number {
    return this.troops + this.workers;
  }

  isAlliedWith(other: number): boolean {
    return this.allies.has(other);
  }

  isTraitor(tick: number): boolean {
    return this.traitorUntil > tick;
  }

  hasEmbargoWith(other: Player, tick: number): boolean {
    if (this.embargo.has(other.id) || other.embargo.has(this.id)) return true;
    const a = this.embargoUntil.get(other.id);
    const b = other.embargoUntil.get(this.id);
    return (a !== undefined && a > tick) || (b !== undefined && b > tick);
  }

  centroid(width: number): [number, number] {
    if (this.tiles === 0) return [this.spawnTile % width, (this.spawnTile / width) | 0];
    return [this.sumX / this.tiles, this.sumY / this.tiles];
  }

  displayName(lang: 'fr' | 'en'): string {
    return this.name[lang] || this.name.en;
  }
}
